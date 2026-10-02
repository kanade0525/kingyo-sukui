import { LANTERNS } from '../js/world.js';

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

/** 値ノイズ。金魚の斑、紙の繊維、木目に使う。 */
export const NOISE = `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*0.1031);
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
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
}`;

/**
 * 夜空と提灯。水面の反射でも背景でも同じ関数を使うので、ここに一本化する。
 * 提灯は点ではなく有限の大きさを持つ球光源として扱う。そうしないと
 * 水面に映る光が点のままで、うねりに沿って伸びない。
 */
export const SKYLIB = `
#define NLANT ${LANTERNS.length}
uniform vec4 uLanternP[NLANT];   // xyz = 位置, w = 半径
uniform vec4 uLanternC[NLANT];   // rgb = 色 * 明るさ, a = 揺らぎ
uniform vec3 uMoonDir;

vec3 skyColor(vec3 d){
  float up = clamp(d.y, -1.0, 1.0);
  vec3 zenith  = vec3(0.009, 0.017, 0.040);
  vec3 horizon = vec3(0.052, 0.046, 0.062);
  vec3 below   = vec3(0.013, 0.012, 0.016);
  vec3 c = up > 0.0 ? mix(horizon, zenith, pow(up, 0.5))
                    : mix(horizon, below, pow(-up, 0.55));
  // 屋台の連なりが地平の少し上を橙に染めている
  c += vec3(0.048, 0.019, 0.005) * pow(max(1.0 - abs(up) * 1.5, 0.0), 7.0);
  // 月
  float m = max(dot(d, uMoonDir), 0.0);
  c += vec3(0.30, 0.33, 0.40) * pow(m, 900.0) * 2.4;
  c += vec3(0.030, 0.034, 0.046) * pow(m, 9.0);
  return c;
}

/**
 * 点 P から向き R を見たときに提灯が返す光。
 * sharp が大きいほど鏡に近く、1 なら拡散反射に相当する。
 *
 * ローブは正規化してある。提灯の見かけの角半径を ang とすると、
 *   ・鏡に近いローブ … 指数を 2/ang² で頭打ちにし、覆う量を 1 に寄せる
 *     （鏡に映った光源は、光源そのものの明るさで見えるのが正しい）
 *   ・広いローブ … 覆う量が ang² に比例し、自然に距離の二乗で減る
 * 上限 0.09 は、鏡面の輝きが提灯の実体より明るくなりすぎないための蓋。
 */
vec3 lanternLight(vec3 P, vec3 R, float sharp){
  vec3 sum = vec3(0.0);
  for(int i=0;i<NLANT;i++){
    vec3 L = uLanternP[i].xyz - P;
    float d2 = max(dot(L, L), 1e-4);
    L *= inversesqrt(d2);
    float cosA = max(dot(R, L), 0.0);
    float ang2 = uLanternP[i].w * uLanternP[i].w / d2;
    float n = min(sharp, 2.0 / max(ang2, 1e-5));
    float cover = min((n + 1.0) * ang2 * 0.5, 0.09);
    sum += uLanternC[i].rgb * uLanternC[i].a * pow(cosA, n) * cover;
  }
  return sum;
}`;

/**
 * 水の中にあるものが受ける、向きのゆるい光。
 *
 * 提灯は水面すれすれの低い位置に吊ってあるので、法線との内積を素直に取ると
 * 横を向いた面が真っ黒になる。実際には水面で屈折した光が上から降ってくるので、
 * 法線を上に寄せて拾い、真上からの成分も足す。
 */
export const AMBIENT = `
vec3 waterAmbient(vec3 P, vec3 N){
  vec3 up = normalize(N + vec3(0.0, 1.7, 0.0));
  return lanternLight(P, up, 1.0) * 0.80 + lanternLight(P, vec3(0.0, 1.0, 0.0), 1.0) * 0.45;
}`;

/** ACES のフィルミックな近似。夜景なので高輝度側の丸まりが効く。 */
export const TONEMAP = `
vec3 aces(vec3 x){
  const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }`;
