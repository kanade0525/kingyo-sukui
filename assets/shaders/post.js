// 仕上げ。明るい所の滲みと、トーンマップ。
//
// 太陽のきらめきは輝度 1 を大きく超える。そのまま出すとただの白い点に
// なるので、明るい所を 1/4 解像度に落としてぼかし、足してからトーンマップする。

import { HEAD, TONEMAP, NOISE } from './common.js?v=202610060217';

/** NaN と Inf を落とす。1 画素でもぼかしに入ると、塊になって画面に残る。 */
const SANE = `
vec3 sane(vec3 c){
  c = mix(vec3(0.0), c, vec3(equal(c, c)));     // NaN は自分自身と等しくない
  return clamp(c, vec3(0.0), vec3(64.0));
}`;

export const FS_BRIGHT = `${HEAD}
${SANE}
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uThreshold;
out vec4 frag;
void main(){
  vec3 c = sane(texture(uSrc, vUv).rgb);
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  frag = vec4(c * smoothstep(uThreshold, uThreshold * 2.0, l), 1.0);
}`;

/** 分離ブラー。uDir に (1/w, 0) か (0, 1/h) を入れて 2 回通す。 */
export const FS_BLUR = `${HEAD}
${SANE}
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 frag;
void main(){
  // 線形補間を使った 9 タップ相当の 5 タップ
  const float o[3] = float[3](0.0, 1.3846153846, 3.2307692308);
  const float w[3] = float[3](0.2270270270, 0.3162162162, 0.0702702703);
  vec3 c = sane(texture(uSrc, vUv).rgb) * w[0];
  for(int i=1;i<3;i++){
    c += sane(texture(uSrc, vUv + uDir * o[i]).rgb) * w[i];
    c += sane(texture(uSrc, vUv - uDir * o[i]).rgb) * w[i];
  }
  frag = vec4(c, 1.0);
}`;

export const FS_COMPOSITE = `${HEAD}
${TONEMAP}
${NOISE}
${SANE}
in vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform float uBloomAmt;
uniform float uExposure;
uniform float uTime;
uniform sampler2D uDof;
uniform float uFocus;
uniform float uDofScale;
uniform float uBloomOff;
uniform float uPlain;      // 1 = フィルムの調子も粒子も外す（切り分け用）
out vec4 frag;

/** わずかな倍率色収差。画面の端ほど赤と青がずれる。
 *  実際のレンズがそうなっているので、ほんの少し入れると写真らしくなる。 */
vec3 fetchCA(vec2 uv){
  vec2 d = uv - 0.5;
  float k = 0.0008 * (1.0 - uPlain);
  vec3 c = vec3(
    texture(uSrc, 0.5 + d * (1.0 + k)).r,
    texture(uSrc, uv).g,
    texture(uSrc, 0.5 + d * (1.0 - k)).b);
  vec3 flat_ = texture(uSrc, uv).rgb;
  // 明暗の差が大きい輪郭では、ずらした分がそのまま橙と青の縁になって
  // 絵に出てしまう。舟と地面の境がまさにそれだった。
  // 段差の大きい所ではずらさない。
  // 0.08〜0.30 では緩く、舟の輪郭に橙と青の縁が残っていた。
  // 人の目は色の縁に敏感なので、写真らしさより先に気づかれる
  float edge = length(c - flat_) / max(length(flat_) + 0.04, 0.04);
  return mix(c, flat_, smoothstep(0.025, 0.11, edge));
}

/**
 * フィルムの調子。
 *
 * 狙いは「よく晴れた日に撮った、少し褪せた写真」。
 * 黒を持ち上げ、彩度をわずかに落とし、ハイライトを暖色・影を青へ割る。
 * 現像のクセをそのまま真似ているので、物理的な意味はない。
 */
vec3 film(vec3 c){
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  // ハイライトは陽に焼けた暖色、影は空の青を拾う
  c += vec3(0.052, 0.022, -0.016) * smoothstep(0.42, 1.0, l);
  c += vec3(-0.014, 0.002, 0.034) * (1.0 - smoothstep(0.0, 0.40, l));
  // 褪せた印画紙。黒が沈みきらない
  c = c * 0.92 + 0.038;
  // 彩度を抜く量。測ると 0.90 では水槽の中の彩度が 0.379 から 0.301 へ、
  // 2 割も落ちていた。褪せた感じは黒の持ち上げと色の振り分けで出ているので、
  // ここはほとんど抜かないでよい
  c = mix(vec3(l * 0.92 + 0.038), c, 0.965);
  return c;
}

void main(){
  // ハレーション。滲みを暖色に寄せると、昔のレンズらしくなる
  vec3 glow = sane(texture(uBloom, vUv).rgb) * uBloomAmt * uBloomOff * vec3(1.00, 0.70, 0.46);
  vec3 c = sane(fetchCA(vUv));

  // 被写界深度。α にカメラからの距離が入っているので、それで錯乱円を作る
  float d = texture(uSrc, vUv).a;
  float coc = d > 0.0 ? clamp(abs(d - uFocus) * uDofScale, 0.0, 1.0) : 0.0;
  c = mix(c, sane(texture(uDof, vUv).rgb), coc * 0.55);
  c += glow;

  // 周辺減光
  vec2 q = (vUv - 0.5) * vec2(1.0, 0.92);
  c *= 1.0 - dot(q, q) * 0.52;

  c = aces(c * uExposure);
  c = toSRGB(c);
  if(uPlain < 0.5){
    c = film(c);
    // 粒子。暗い所ほど目立つのはフィルムと同じ
    float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
    c += (hash12(gl_FragCoord.xy + uTime) - 0.5) * 0.020 * (0.35 + 0.65 * (1.0 - l));
  }
  frag = vec4(c, 1.0);
}`;

/**
 * FXAA。輪郭のぎざぎざを、出来上がった絵の上でならす。
 *
 * MSAA をやめてこちらにした。MSAA は多重サンプルのレンダーバッファを
 * 普通のテクスチャへ blit する必要があり、タイル式の GPU（Apple Silicon など）
 * ではその blit が化けて、縁に点線状のノイズが乗る。実際にそうなった。
 * FXAA は出来上がった 1 枚を読み直すだけなので、その経路が無い。
 *
 * 解像度を落として使う前提なので、効き目は強め（しきい値は緩め）に取る。
 */
export const FS_FXAA = `${HEAD}
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uTexel;
out vec4 frag;

float luma(vec3 c){ return dot(c, vec3(0.299, 0.587, 0.114)); }

void main(){
  vec3 cM = texture(uSrc, vUv).rgb;
  float lM = luma(cM);
  float lN = luma(texture(uSrc, vUv + vec2(0.0, -uTexel.y)).rgb);
  float lS = luma(texture(uSrc, vUv + vec2(0.0,  uTexel.y)).rgb);
  float lW = luma(texture(uSrc, vUv + vec2(-uTexel.x, 0.0)).rgb);
  float lE = luma(texture(uSrc, vUv + vec2( uTexel.x, 0.0)).rgb);

  float lo = min(lM, min(min(lN, lS), min(lW, lE)));
  float hi = max(lM, max(max(lN, lS), max(lW, lE)));
  float range = hi - lo;
  // 平らな所は触らない
  if(range < max(0.028, hi * 0.115)){ frag = vec4(cM, 1.0); return; }

  float lNW = luma(texture(uSrc, vUv + vec2(-uTexel.x, -uTexel.y)).rgb);
  float lNE = luma(texture(uSrc, vUv + vec2( uTexel.x, -uTexel.y)).rgb);
  float lSW = luma(texture(uSrc, vUv + vec2(-uTexel.x,  uTexel.y)).rgb);
  float lSE = luma(texture(uSrc, vUv + vec2( uTexel.x,  uTexel.y)).rgb);

  // 輪郭が縦か横かを決める
  float edgeH = abs(lNW + lNE - 2.0 * lN) * 2.0 + abs(lW + lE - 2.0 * lM) * 4.0
              + abs(lSW + lSE - 2.0 * lS) * 2.0;
  float edgeV = abs(lNW + lSW - 2.0 * lW) * 2.0 + abs(lN + lS - 2.0 * lM) * 4.0
              + abs(lNE + lSE - 2.0 * lE) * 2.0;
  bool horz = edgeH >= edgeV;

  // 輪郭をまたぐ向きへ、勾配の急なほうへ半画素ずらして読む
  float l1 = horz ? lN : lW;
  float l2 = horz ? lS : lE;
  float g1 = abs(l1 - lM), g2 = abs(l2 - lM);
  float step_ = horz ? uTexel.y : uTexel.x;
  if(g1 < g2) step_ = -step_;

  vec2 off = horz ? vec2(0.0, step_) : vec2(step_, 0.0);
  vec3 a = texture(uSrc, vUv + off * 0.5).rgb;
  vec3 b = texture(uSrc, vUv + off * 1.5).rgb;
  // 両脇も混ぜて、階段の段差をならす
  vec2 perp = horz ? vec2(uTexel.x, 0.0) : vec2(0.0, uTexel.y);
  vec3 c1 = texture(uSrc, vUv + off * 0.5 - perp).rgb;
  vec3 c2 = texture(uSrc, vUv + off * 0.5 + perp).rgb;

  vec3 blend = (a * 0.40 + b * 0.18 + c1 * 0.14 + c2 * 0.14 + cM * 0.14);
  // 勾配がきついほど強くならす
  float amt = clamp(range / max(hi, 1e-3) * 2.2, 0.0, 1.0);
  frag = vec4(mix(cM, blend, amt), 1.0);
}`;
