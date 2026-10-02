// 仕上げ。明るい所の滲みと、トーンマップ。
//
// 太陽のきらめきは輝度 1 を大きく超える。そのまま出すとただの白い点に
// なるので、明るい所を 1/4 解像度に落としてぼかし、足してからトーンマップする。

import { HEAD, TONEMAP, NOISE } from './common.js?v=202610022334';

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
  float k = 0.0016 * (1.0 - uPlain);
  return vec3(
    texture(uSrc, 0.5 + d * (1.0 + k)).r,
    texture(uSrc, uv).g,
    texture(uSrc, 0.5 + d * (1.0 - k)).b);
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
  c = c * 0.90 + 0.052;
  // 彩度をほんの少し抜く
  c = mix(vec3(l * 0.90 + 0.052), c, 0.90);
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
