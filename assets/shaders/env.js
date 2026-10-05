// 環境マップ。
//
// 水面も樹脂も、これまで空を「鏡として 1 点」から拾っていた。
// 粗い面でもハイライトが点のままなので、硬い。粗さに応じてぼかした
// 環境を引けるように、遠景を立方体テクスチャへ焼いて段を作る。
//
// 入れるのは空・天幕・遠くの地面だけ。
//
// 太陽は入れない。水面には解析のきらめきを別に足しているので、
// 焼くと二重に数えることになる。そのうえ 1 面 64 画素では太陽の
// 角半径 0.26° が 1 画素の 1/5 しかなく、回しただけでちらつく。
//
// 提灯も入れない。舟から 50cm しか離れていないので、焼いた 1 点からの
// 眺めを全画素へ配ると、せっかく位置を合わせた映り込みが消えてしまう。

import { HEAD, NOISE, SKYLIB } from './common.js?v=202610052307';

/** 面と画面座標から、その方向を出す。 */
const FACEDIR = `
vec3 faceDir(int f, vec2 uv){
  if(f == 0) return normalize(vec3( 1.0, -uv.y, -uv.x));
  if(f == 1) return normalize(vec3(-1.0, -uv.y,  uv.x));
  if(f == 2) return normalize(vec3( uv.x,  1.0,  uv.y));
  if(f == 3) return normalize(vec3( uv.x, -1.0, -uv.y));
  if(f == 4) return normalize(vec3( uv.x, -uv.y,  1.0));
  return normalize(vec3(-uv.x, -uv.y, -1.0));
}
`;

/** 0 段目を焼く。遠景だけ。 */
export const FS_ENVBAKE = `${HEAD}
${NOISE}
${SKYLIB}
${FACEDIR}
uniform int uFace;
uniform vec2 uRes;
out vec4 frag;

void main(){
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec3 d = faceDir(uFace, uv);

  vec3 c;
  if(d.y < -0.002){
    // 遠くの地面。玉砂利の平均色が空の光を返しているだけなので、
    // 粒まで描く必要はない
    c = uSkyGround * 0.92;
  } else {
    float up = clamp(d.y, 0.0, 1.0);
    c = mix(uSkyHorizon, uSkyZenith, pow(up, 0.42));
    float mu = max(dot(d, uSunDir), 0.0);
    c += uSunColor * (0.050 * pow(mu, 9.0) + 0.008 * pow(mu, 2.0)) * uHaze;
    vec4 tent = tentLook(d);
    c = mix(c, tent.rgb, tent.w);
  }
  frag = vec4(c, 1.0);
}`;

/**
 * 段をぼかす。GGX の分布に沿って前の段から拾う。
 *
 * 反射の向き・法線・視線をすべて同じと置く、よくある近似。
 * 斜めから見たときの伸びは出ないが、段 1 枚あたり数十回で済む。
 */
export const FS_ENVFILTER = `${HEAD}
${FACEDIR}
uniform samplerCube uSrc;
uniform int uFace;
uniform vec2 uRes;
uniform float uRough;
uniform float uSrcLod;
out vec4 frag;

const float PI = 3.14159265;

/** 低食い違い列。並びの偏りが少ないので、少ない回数でも斑にならない */
vec2 hammersley(int i, int n){
  uint b = uint(i);
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return vec2(float(i) / float(n), float(b) * 2.3283064365386963e-10);
}

vec3 ggxSample(vec2 xi, vec3 N, float a){
  float phi = 2.0 * PI * xi.x;
  float ct = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  float st = sqrt(1.0 - ct * ct);
  vec3 h = vec3(st * cos(phi), st * sin(phi), ct);
  vec3 up = abs(N.z) < 0.999 ? vec3(0.0, 0.0, 1.0) : vec3(1.0, 0.0, 0.0);
  vec3 tx = normalize(cross(up, N));
  vec3 ty = cross(N, tx);
  return normalize(tx * h.x + ty * h.y + N * h.z);
}

void main(){
  vec2 uv = (gl_FragCoord.xy / uRes) * 2.0 - 1.0;
  vec3 N = faceDir(uFace, uv);
  float a = max(uRough * uRough, 1e-3);

  const int N_SAMP = 48;
  vec3 sum = vec3(0.0);
  float wsum = 0.0;
  for(int i = 0; i < N_SAMP; i++){
    vec3 H = ggxSample(hammersley(i, N_SAMP), N, a);
    vec3 L = reflect(-N, H);
    float nl = dot(N, L);
    if(nl <= 0.0) continue;
    sum += textureLod(uSrc, L, uSrcLod).rgb * nl;
    wsum += nl;
  }
  frag = vec4(sum / max(wsum, 1e-4), 1.0);
}`;
