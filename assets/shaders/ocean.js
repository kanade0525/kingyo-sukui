// FFT 水面のシェーダ一式（Tessendorf 法）。
//
// 流れ:
//   h0（JS で一度だけ生成）
//     → FS_SPECTRUM  時刻 t のスペクトル h(k,t) と choppy 変位 Dx, Dz
//     → FS_BUTTERFLY  横 log2N 回 + 縦 log2N 回のバタフライで逆 FFT
//     → FS_ASSEMBLE   fftshift と正規化。変位マップ (Dx, Dy, Dz) が出る
//     → FS_NORMAL     中心差分で勾配・ヤコビアン・ラプラシアン
//
// MRT を使い、(h, Dx) と (Dz, 予備) の 2 枚を 1 パスで同時に変換している。
// RGBA の RG と BA にそれぞれ複素数を 1 つずつ詰めるので、
// 1 パスあたり 4 本の複素 FFT が同時に進む。

import { HEAD } from './common.js?v=202610030031';

const CPLX = `
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x - a.y*b.y, a.x*b.y + a.y*b.x); }
`;

/**
 * 時刻 t のスペクトル。
 *   h(k,t) = h0(k)·e^{iωt} + conj(h0(-k))·e^{-iωt}
 *   D(k,t) = -i·(k/|k|)·h(k,t)
 * ω は浅水を含む分散関係 ω = √(g·k·tanh(k·H))。
 */
export const FS_SPECTRUM = `${HEAD}
${CPLX}
uniform sampler2D uH0;     // rg = h0(k), ba = conj(h0(-k))
uniform float uTime;
uniform float uPatch;      // パッチの一辺 [m]
uniform float uDepth;      // 水深 [m]
uniform int uN;
layout(location=0) out vec4 o0;   // rg = h,  ba = Dx
layout(location=1) out vec4 o1;   // rg = Dz, ba = 未使用

const float G = 9.80665;

void main(){
  ivec2 ip = ivec2(gl_FragCoord.xy);
  vec4 h0 = texelFetch(uH0, ip, 0);

  // テクスチャの中心が k=0。x,y をそのまま波数に写す
  vec2 n = vec2(ip) - float(uN) * 0.5;
  vec2 k = 6.283185307 * n / uPatch;
  float kl = length(k);

  if(kl < 1e-5){
    // 直流成分は水位そのもので、波ではない
    o0 = vec4(0.0); o1 = vec4(0.0); return;
  }

  // 分散関係。重力＋表面張力。
  // λ が 1.7cm を切ると毛管波が支配し、位相速度が重力だけの式の 2 倍以上になる。
  // これを入れずに細かい波を足すと、さざ波がぬるぬる這って水に見えない。
  //
  // tanh の引数は頭打ちにする。実装によっては内部で e^(2x) を通るので、
  // kl*uDepth が 100 を超えると Inf/Inf = NaN になり、FFT 全体が壊れる。
  // 物理的にも kH > 10 は深水と変わらないので、切っても結果は同じ。
  const float SIGMA_RHO = 7.28e-5;    // 表面張力 / 密度 [m³/s²]
  float w = sqrt((G * kl + SIGMA_RHO * kl * kl * kl) * tanh(min(kl * uDepth, 10.0)));
  float c = cos(w * uTime), s = sin(w * uTime);
  vec2 h = cmul(h0.rg, vec2(c, s)) + cmul(h0.ba, vec2(c, -s));

  // choppy 変位。-i·k̂·h を複素数のまま作る
  vec2 kh = k / kl;
  vec2 dx = cmul(vec2(0.0, -kh.x), h);
  vec2 dz = cmul(vec2(0.0, -kh.y), h);

  o0 = vec4(h, dx);
  o1 = vec4(dz, 0.0, 0.0);
}`;

/**
 * バタフライ 1 段。uButterfly は幅 log2N・高さ N で、
 * rg = ツイドル因子、ba = 読みに行く 2 本の添字。段 0 はビット反転済み。
 */
export const FS_BUTTERFLY = `${HEAD}
${CPLX}
uniform sampler2D uBf;
uniform sampler2D uSrc0;
uniform sampler2D uSrc1;
uniform int uStage;
uniform int uVertical;   // 0 = 横方向, 1 = 縦方向
layout(location=0) out vec4 o0;
layout(location=1) out vec4 o1;

void main(){
  ivec2 x = ivec2(gl_FragCoord.xy);
  int along = uVertical == 1 ? x.y : x.x;
  vec4 d = texelFetch(uBf, ivec2(uStage, along), 0);

  ivec2 pa, pb;
  if(uVertical == 1){ pa = ivec2(x.x, int(d.z)); pb = ivec2(x.x, int(d.w)); }
  else              { pa = ivec2(int(d.z), x.y); pb = ivec2(int(d.w), x.y); }

  vec4 a0 = texelFetch(uSrc0, pa, 0), b0 = texelFetch(uSrc0, pb, 0);
  vec4 a1 = texelFetch(uSrc1, pa, 0), b1 = texelFetch(uSrc1, pb, 0);
  vec2 w = d.xy;

  o0 = vec4(a0.rg + cmul(w, b0.rg), a0.ba + cmul(w, b0.ba));
  o1 = vec4(a1.rg + cmul(w, b1.rg), a1.ba + cmul(w, b1.ba));
}`;

/**
 * 逆 FFT の後始末。(-1)^(x+y) で fftshift を戻し、N² で割って正規化する。
 * 出力は変位マップ (Dx, Dy, Dz)。a には使い道が無いので 0。
 */
export const FS_ASSEMBLE = `${HEAD}
uniform sampler2D uSrc0;
uniform sampler2D uSrc1;
uniform float uAmp;
uniform float uChoppy;
out vec4 frag;

void main(){
  ivec2 x = ivec2(gl_FragCoord.xy);
  // 1/N² で割らない。h(x) = Σ h̃(k)e^{ikx} の約束で、分散は Σ|h̃|² に一致する。
  // h0 を作るときに実効波高へ正規化してあるので、ここで割ると桁が落ちるだけ。
  float f = (((x.x + x.y) % 2 == 0) ? 1.0 : -1.0) * uAmp;

  vec4 s0 = texelFetch(uSrc0, x, 0);
  float hy = s0.r * f;          // 高さ
  float hx = s0.b * f;          // 横変位 x
  float hz = texelFetch(uSrc1, x, 0).r * f;

  frag = vec4(hx * uChoppy, hy, hz * uChoppy, 0.0);
}`;

/**
 * 変位マップから勾配・泡・ラプラシアンを作る。
 * ラプラシアンは後で水底のコースティクスに使い回す（屈折写像の
 * ヤコビアンを ∇²h の一次で近似すると、ちょうど光の集まり具合になる）。
 */
export const FS_NORMAL = `${HEAD}
uniform sampler2D uDisp;
uniform int uN;
uniform float uPatch;
out vec4 frag;

vec4 at(ivec2 p){
  int n = uN;
  return texelFetch(uDisp, ivec2((p.x + n) % n, (p.y + n) % n), 0);
}

void main(){
  ivec2 x = ivec2(gl_FragCoord.xy);
  float cell = uPatch / float(uN);
  float inv2 = 1.0 / (2.0 * cell);

  vec4 l = at(x - ivec2(1,0)), r = at(x + ivec2(1,0));
  vec4 d = at(x - ivec2(0,1)), u = at(x + ivec2(0,1));
  vec4 c = at(x);

  float dhdx = (r.y - l.y) * inv2;
  float dhdz = (u.y - d.y) * inv2;
  float lap  = (l.y + r.y + u.y + d.y - 4.0 * c.y) / (cell * cell);

  // choppy 変位の折り畳み（ヤコビアン）。1 を下回るほど波頭が立っている
  float jxx = 1.0 + (r.x - l.x) * inv2;
  float jzz = 1.0 + (u.z - d.z) * inv2;
  float jxz = (u.x - d.x) * inv2;
  float jzx = (r.z - l.z) * inv2;
  float j = jxx * jzz - jxz * jzx;
  float foam = clamp(1.0 - j, 0.0, 1.0);

  frag = vec4(dhdx, dhdz, foam, lap);
}`;
