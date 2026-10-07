// ポイと金魚が立てる波紋。
//
// FFT は定常な波のスペクトルを逆変換しているだけなので、後から
// 「ここで水を叩いた」を混ぜ込めない。そこで波紋だけ 2D 波動方程式を
// 別に解き、水面では両者の高さと勾配を足す。
//
//   h[n+1] = 2h[n] - h[n-1] + K·∇²h[n]
//
// 壁は Neumann（傾き 0）にして反射させる。たらいの中の波は端で跳ね返るので、
// これが無いと波紋が端で消えて嘘くさくなる。

import { HEAD } from './common.js?v=202610070355';

export const FS_STEP = `${HEAD}
uniform sampler2D uPrev;   // r = h[n], g = h[n-1]
uniform int uN;
uniform float uK;
uniform float uDamp;
uniform int uDropCount;
uniform vec4 uDrops[12];   // xy = uv(0..1), z = 半径(uv), w = 強さ
out vec4 frag;

float at(ivec2 p){
  // 壁で折り返す。端の値をそのまま複製するのが傾き 0 の離散版
  p = clamp(p, ivec2(0), ivec2(uN - 1));
  return texelFetch(uPrev, p, 0).r;
}

void main(){
  ivec2 x = ivec2(gl_FragCoord.xy);
  vec2 cur = texelFetch(uPrev, x, 0).rg;

  float lap = at(x+ivec2(1,0)) + at(x-ivec2(1,0))
            + at(x+ivec2(0,1)) + at(x-ivec2(0,1)) - 4.0 * cur.r;

  float h = (2.0 * cur.r - cur.g + uK * lap) * uDamp;

  // 波源。ガウスで押し込む
  vec2 uv = (vec2(x) + 0.5) / float(uN);
  for(int i=0;i<12;i++){
    if(i >= uDropCount) break;
    vec4 d = uDrops[i];
    float r = length(uv - d.xy) / max(d.z, 1e-4);
    h += d.w * exp(-r * r * 2.3);
  }

  frag = vec4(clamp(h, -0.05, 0.05), cur.r, 0.0, 0.0);
}`;

/**
 * 波紋の高さ場を、水面が 1 回のサンプルで読める形に畳む。
 * (∂h/∂x, ∂h/∂z, h, ∇²h)。RGBA16F なので線形補間がそのまま効く。
 */
export const FS_NORMAL = `${HEAD}
uniform sampler2D uH;
uniform int uN;
uniform float uSpan;   // この格子が覆うワールドの一辺 [m]
out vec4 frag;

float at(ivec2 p){
  p = clamp(p, ivec2(0), ivec2(uN - 1));
  return texelFetch(uH, p, 0).r;
}

void main(){
  ivec2 x = ivec2(gl_FragCoord.xy);
  float cell = uSpan / float(uN);
  float inv2 = 1.0 / (2.0 * cell);
  float l = at(x-ivec2(1,0)), r = at(x+ivec2(1,0));
  float d = at(x-ivec2(0,1)), u = at(x+ivec2(0,1));
  float c = at(x);
  frag = vec4((r-l)*inv2, (u-d)*inv2, c, (l+r+u+d-4.0*c)/(cell*cell));
}`;
