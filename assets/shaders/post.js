// 仕上げ。提灯の滲みと、トーンマップ。
//
// 夜景なので、光源そのものの輝度は 1 を大きく超える。そのまま出すと
// 提灯がただの白い丸になるので、明るい所を 1/4 解像度に落としてぼかし、
// 足してからトーンマップする。

import { HEAD, TONEMAP, NOISE } from './common.js';

export const FS_BRIGHT = `${HEAD}
in vec2 vUv;
uniform sampler2D uSrc;
uniform float uThreshold;
out vec4 frag;
void main(){
  vec3 c = texture(uSrc, vUv).rgb;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  frag = vec4(c * smoothstep(uThreshold, uThreshold * 2.2, l), 1.0);
}`;

/** 分離ブラー。uDir に (1/w, 0) か (0, 1/h) を入れて 2 回通す。 */
export const FS_BLUR = `${HEAD}
in vec2 vUv;
uniform sampler2D uSrc;
uniform vec2 uDir;
out vec4 frag;
void main(){
  // 線形補間を使った 9 タップ相当の 5 タップ
  const float o[3] = float[3](0.0, 1.3846153846, 3.2307692308);
  const float w[3] = float[3](0.2270270270, 0.3162162162, 0.0702702703);
  vec3 c = texture(uSrc, vUv).rgb * w[0];
  for(int i=1;i<3;i++){
    c += texture(uSrc, vUv + uDir * o[i]).rgb * w[i];
    c += texture(uSrc, vUv - uDir * o[i]).rgb * w[i];
  }
  frag = vec4(c, 1.0);
}`;

export const FS_COMPOSITE = `${HEAD}
${TONEMAP}
${NOISE}
in vec2 vUv;
uniform sampler2D uSrc;
uniform sampler2D uBloom;
uniform float uBloomAmt;
uniform float uExposure;
uniform float uTime;
out vec4 frag;

/** わずかな倍率色収差。画面の端ほど赤と青がずれる。
 *  実際のレンズがそうなっているので、ほんの少し入れると写真らしくなる。 */
vec3 fetchCA(vec2 uv){
  vec2 d = uv - 0.5;
  float k = 0.0016;
  return vec3(
    texture(uSrc, 0.5 + d * (1.0 + k)).r,
    texture(uSrc, uv).g,
    texture(uSrc, 0.5 + d * (1.0 - k)).b);
}

void main(){
  vec3 c = fetchCA(vUv) + texture(uBloom, vUv).rgb * uBloomAmt;

  // 周辺減光。舟に目が行くように、ごく弱く
  vec2 q = (vUv - 0.5) * vec2(1.0, 0.92);
  c *= 1.0 - dot(q, q) * 0.34;

  c = aces(c * uExposure);
  c = toSRGB(c);

  // 暗部のバンディングを散らす粒子
  c += (hash12(gl_FragCoord.xy + uTime) - 0.5) * 0.006;
  frag = vec4(c, 1.0);
}`;
