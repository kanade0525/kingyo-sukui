// シェーダの共有部品。文字列として他のシェーダへ差し込む。
//
// fetch で .glsl を読む作りにしなかったのは、file:// で開いたときに黙って
// 動かなくなるのを避けるため。GLSL は JS の文字列のまま持つ。

export const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
`;

/** 画面いっぱいの三角形。vUv は 0..1、vNdc は -1..1。 */
export const VS_FULL = `${HEAD}
layout(location=0) in vec2 aP;
out vec2 vUv;
out vec2 vNdc;
void main(){
  vUv = aP * 0.5 + 0.5;
  vNdc = aP;
  gl_Position = vec4(aP, 0.0, 1.0);
}`;

/** 値ノイズ。砂利、金魚の斑、紙の繊維に使う。 */
export const NOISE = `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*0.1031);
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.xx+p3.yz)*p3.zy);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x),
             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
/** 砂利の粒。セルごとの距離場。 */
float worley(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float d = 1e9;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i+g);
    d = min(d, length(g + o - f));
  }
  return d;
}`;

/**
 * 空と太陽。
 *
 * 光源は太陽ひとつ。方向の揃った光でないと、水底のコースティクスも
 * 水面のきらめきも芯が出ない。空の色は時刻から JS 側（sky.js）で作って渡す。
 */
export const SKYLIB = `
uniform vec3 uSunDir;       // 太陽へ向かう単位ベクトル
uniform vec3 uSunColor;     // 直達光。1 を超える
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform float uHaze;

const float PI = 3.14159265;

vec3 skyColor(vec3 d){
  float up = clamp(d.y, -1.0, 1.0);
  vec3 c = up > 0.0
    ? mix(uSkyHorizon, uSkyZenith, pow(up, 0.42))
    : mix(uSkyHorizon, uSkyGround, pow(-up, 0.55));
  // 太陽のまわりの暈け（前方散乱）
  float mu = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (0.050 * pow(mu, 9.0) + 0.008 * pow(mu, 2.0)) * uHaze;
  return c;
}

/** 太陽の本体まで描く版。背景のフルスクリーンパスだけで使う。 */
vec3 skyWithSun(vec3 d){
  vec3 c = skyColor(d);
  float mu = max(dot(d, uSunDir), 0.0);
  c += uSunColor * smoothstep(0.99965, 0.99988, mu) * 42.0;
  return c;
}

/** 半球の空からの照り返し。法線の向きで上下を混ぜるだけ。 */
vec3 skyAmbient(vec3 n){
  float up = n.y * 0.5 + 0.5;
  return mix(uSkyGround, mix(uSkyHorizon, uSkyZenith, 0.55), up) * 0.9;
}

/** GGX 1 本。F0 はフレネルの垂直入射値。 */
vec3 ggx(vec3 N, vec3 V, vec3 L, float rough, vec3 F0){
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 1e-4);
  float ndh = max(dot(N, H), 0.0);
  float vdh = max(dot(V, H), 1e-4);
  float a = max(rough * rough, 1e-5);
  float a2 = a * a;
  float t = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * t * t);
  // Smith の可視項（高さ相関なし）
  float gv = ndl * sqrt(ndv * ndv * (1.0 - a2) + a2);
  float gl = ndv * sqrt(ndl * ndl * (1.0 - a2) + a2);
  float Vis = 0.5 / max(gv + gl, 1e-5);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
  return D * Vis * F * ndl;
}

float fresnelSchlick(float ndv, float f0){
  return f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
}`;

/**
 * 水の中にあるものが受ける光。
 * 水面で屈折した太陽光は、空気中より立って降ってくる。
 */
export const AMBIENT = `
vec3 underSunDir(){
  // スネルの法則で、水中での太陽の向きを立てる
  vec3 d = -uSunDir;                       // 進行方向
  float ci = max(-d.y, 0.02);
  float si = sqrt(max(1.0 - ci * ci, 0.0));
  float st = si / 1.333;
  float ct = sqrt(max(1.0 - st * st, 0.0));
  vec2 h = normalize(d.xz + vec2(1e-6));
  return -vec3(h.x * st, -ct, h.y * st);   // 水中で太陽へ向かう向き
}
vec3 underSun(vec3 N){
  float t = 1.0 - fresnelSchlick(max(uSunDir.y, 0.02), 0.02);
  return uSunColor * t * max(dot(N, underSunDir()), 0.0);
}
vec3 underAmbient(vec3 N){
  return skyAmbient(N) * 0.7;
}`;

/** ACES のフィルミックな近似。 */
export const TONEMAP = `
vec3 aces(vec3 x){
  const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }`;
