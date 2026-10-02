// 金魚とポイのシェーダ。
//
// 金魚の形は頂点シェーダの中で作る。胴は u（頭→尾）と v（断面まわり）の
// 2 変数の関数で、ひれは同じ関数の別の枝。こうしておくと、法線も
// その場で差分を取るだけで出せるし、泳ぎのうねりを形と一緒にかけられる。
//
// ひれの半透明は α ブレンドではなく 4x4 の秩序あるディザで抜く。
// 水中パスの α にはカメラからの距離を入れているので、ここをブレンドで
// 混ぜると距離が壊れ、水面の屈折が狂う。

import { HEAD, NOISE, SKYLIB, AMBIENT } from './common.js';

const BAYER = `
float bayer4(vec2 fc){
  int m[16] = int[16](0,8,2,10, 12,4,14,6, 3,11,1,9, 15,7,13,5);
  ivec2 p = ivec2(mod(fc, 4.0));
  return (float(m[p.y*4 + p.x]) + 0.5) / 16.0;
}`;

// ---------------------------------------------------------------- 金魚

export const VS_FISH = `${HEAD}
layout(location=0) in vec2 aUv;
layout(location=1) in float aPart;
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uPos;
uniform float uYaw;
uniform float uLen;
uniform float uTime;
uniform float uPhase;
uniform float uBeat;
uniform float uBulge;     // 出目金の目の張り出し
uniform float uBend;      // 旋回中の体の曲がり
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vDist;
flat out int vPart;

/** 胴の半径。鼻先で丸まり、腹で膨らみ、尾柄で細る。 */
float prof(float u){
  float nose  = smoothstep(0.0, 0.13, u);
  float taper = 1.0 - smoothstep(0.50, 0.93, u);
  float belly = 0.60 + 0.40 * sin(3.14159265 * clamp(u / 0.72, 0.0, 1.0));
  return 0.29 * nose * (taper * 0.88 + 0.12) * belly;
}

vec3 shapeOf(float u, float v, int part){
  if(part == 0){
    float ang = v * 6.2831853;
    float ca = cos(ang), sa = sin(ang);
    float r = prof(u);
    float bulge = 1.0 + uBulge * exp(-pow((u - 0.105) / 0.075, 2.0)) * abs(sa);
    return vec3(0.5 - u, ca * r * (1.16 - 0.13 * ca) * bulge, sa * r * 0.74 * bulge);
  }
  if(part == 1){              // 尾びれ
    float s = u, t = v * 2.0 - 1.0;
    float spread = 0.040 + 0.21 * pow(s, 0.75);
    return vec3(-0.44 - 0.36 * s, t * spread - 0.010 * s, 0.055 * s * s * sin(t * 3.1));
  }
  if(part == 2){              // 背びれ
    float uu = mix(0.26, 0.66, u);
    float back = prof(uu) * 1.16;
    return vec3(0.5 - uu, back + v * 0.105 * sin(3.14159 * u) * (0.45 + 0.55 * (1.0 - u)), 0.0);
  }
  if(part == 5){              // 尻びれ
    float uu = mix(0.62, 0.84, u);
    return vec3(0.5 - uu, -prof(uu) * 1.30 - v * 0.075 * sin(3.14159 * u), 0.0);
  }
  // 胸びれ。part 3 が右、4 が左
  float side = part == 3 ? 1.0 : -1.0;
  float r = prof(0.22);
  vec3 root = vec3(0.5 - 0.22, -r * 0.30, side * r * 0.80);
  vec3 dir  = vec3(-0.17, -0.055, side * 0.095);
  vec3 wid  = vec3(0.022, 0.060, 0.0);
  return root + dir * u + wid * (v - 0.5) * (0.35 + 0.65 * u);
}

/** 泳ぎのうねり。尾へ行くほど大きく、頭もわずかに振れる。 */
vec3 swim(vec3 p){
  float s = clamp((0.5 - p.x) / 1.3, 0.0, 1.0);
  p.z += 0.055 * s * s * sin(p.x * 7.5 - uTime * uBeat + uPhase);
  p.z += 0.007 * sin(-uTime * uBeat + uPhase);
  p.z += uBend * s * s;                       // 旋回で内側へ曲がる
  return p;
}

vec3 toWorld(vec3 p){
  p *= uLen;
  float c = cos(uYaw), s = sin(uYaw);
  return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c) + uPos;
}

void main(){
  int part = int(aPart + 0.5);
  float e = 0.012;
  vec3 p  = swim(shapeOf(aUv.x, aUv.y, part));
  vec3 pu = swim(shapeOf(min(aUv.x + e, 1.0), aUv.y, part));
  vec3 pv = swim(shapeOf(aUv.x, aUv.y + e, part));

  vec3 n = cross(pu - p, pv - p);
  float nl = length(n);
  n = nl > 1e-7 ? n / nl : vec3(0.0, 1.0, 0.0);

  vec3 w = toWorld(p);
  float c = cos(uYaw), s = sin(uYaw);
  vW = w;
  vN = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  vUv = aUv;
  vPart = part;
  vDist = distance(w, uCam);
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const FS_FISH = `${HEAD}
${NOISE}
${SKYLIB}
${AMBIENT}
${BAYER}
in vec3 vW;
in vec3 vN;
in vec2 vUv;
in float vDist;
flat in int vPart;
uniform vec3 uCam;
uniform int uKind;        // 0 素赤 / 1 更紗 / 2 出目金
uniform float uSeed;
out vec4 frag;

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  // 胴は閉じた面なので、頂点側で作った外向き法線をそのまま信じる。
  // gl_FrontFacing で裏返すと、三角形の巻き方向しだいで体の半分が影になる。
  // ひれは薄い一枚なので、見ている側へ向け直す
  if(vPart != 0 && dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  float u = vUv.x, v = vUv.y;
  vec3 base;
  float alpha = 1.0;

  if(vPart == 0){
    float side = abs(sin(v * 6.2831853));          // 横腹ほど 1
    float up = cos(v * 6.2831853) * 0.5 + 0.5;     // 背が 1、腹が 0
    if(uKind == 0){
      base = mix(vec3(1.00, 0.56, 0.20), vec3(0.86, 0.15, 0.015), smoothstep(0.15, 0.85, up));
    } else if(uKind == 1){
      float n = fbm(vec2(u * 4.2 + uSeed * 13.0, v * 3.0 + uSeed * 7.0));
      float blotch = smoothstep(0.44, 0.56, n + up * 0.14);
      base = mix(vec3(0.94, 0.91, 0.87), vec3(0.90, 0.15, 0.02), blotch);
    } else {
      base = vec3(0.045, 0.032, 0.052) + vec3(0.11, 0.03, 0.15) * pow(1.0 - ndv, 3.0);
    }
    // 鱗
    base *= 0.92 + 0.08 * sin(u * 118.0) * sin(v * 46.0);
    // 目
    float eye = min(length(vec2((u - 0.105) * 2.7, v - 0.195)),
                    length(vec2((u - 0.105) * 2.7, v - 0.805)));
    float eyeR = uKind == 2 ? 0.052 : 0.034;
    float m = 1.0 - smoothstep(eyeR * 0.78, eyeR, eye);
    base = mix(base, vec3(0.015, 0.012, 0.014), m);
    base += vec3(0.9) * (1.0 - smoothstep(0.004, 0.010, length(vec2((u - 0.085) * 2.7, v - 0.182)))) * m;
  } else {
    // ひれ。先へ行くほど薄く、体の色をわずかに引き継ぐ
    vec3 tint = uKind == 2 ? vec3(0.09, 0.07, 0.11)
              : uKind == 1 ? vec3(0.95, 0.60, 0.48)
                           : vec3(0.95, 0.38, 0.16);
    float along = vPart == 1 ? u : (vPart == 2 || vPart == 5 ? v : u);
    // 透けて見えるぶんは色で表す。ディザで抜くと、小さく映ったときに
    // 網目だけが見えて、かえって汚くなる
    base = mix(tint, vec3(0.98, 0.80, 0.74), 0.18 + along * 0.42);
    base *= 0.88 + 0.24 * fbm(vec2(u * 18.0, v * 6.0));
    base *= 0.55 + 0.45 * pow(1.0 - ndv, 1.5);     // 斜めに見ると厚く、濃く見える
  }

  if(alpha < 0.999 && bayer4(gl_FragCoord.xy) > alpha) discard;

  vec3 lit = underSun(N) + underAmbient(N);
  float up = N.y * 0.5 + 0.5;                      // 背のほうが明るい
  vec3 col = base * lit * (0.78 + 0.35 * up);
  col += ggx(N, V, underSunDir(), 0.30, vec3(0.03)) * uSunColor * 0.7;
  col += base * pow(1.0 - ndv, 4.0) * 0.12 * lit;  // 縁の照り返し

  frag = vec4(col, vDist);
}`;

// ---------------------------------------------------------------- ポイ

export const VS_POI = `${HEAD}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aRegion;
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uPos;
uniform vec3 uTiltAxis;
uniform float uTilt;
uniform float uSag;        // 紙のたわみ
uniform float uRadius;
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vRegion;
out float vDist;

vec3 rotAxis(vec3 p, vec3 a, float ang){
  float c = cos(ang), s = sin(ang);
  return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}

void main(){
  vec3 p = aPos;
  vUv = aPos.xz / uRadius;
  if(aRegion < 0.5){
    // 水と金魚の重みで中央が落ちる
    float r = clamp(length(vUv), 0.0, 1.0);
    p.y -= uSag * (1.0 - r * r);
  }
  p = rotAxis(p, uTiltAxis, uTilt) + uPos;
  vW = p;
  vN = rotAxis(aNrm, uTiltAxis, uTilt);
  vRegion = aRegion;
  vDist = distance(p, uCam);
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const FS_POI = `${HEAD}
${NOISE}
${SKYLIB}
${AMBIENT}
in vec3 vW;
in vec3 vN;
in vec2 vUv;
in float vRegion;
in float vDist;
uniform vec3 uCam;
uniform int uUnderwater;   // 1 = 水中パス。α には距離を入れる
uniform float uHealth;     // 1 = 新品, 0 = 破れきり
uniform float uWet;        // 0 = 乾き, 1 = ずぶ濡れ
uniform float uSeed;
out vec4 frag;

void main(){
  int region = int(vRegion + 0.5);
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if(dot(N, V) < 0.0) N = -N;     // 紙も枠も薄いので、見ている側へ向け直す
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  vec3 col;
  float alpha;

  if(region == 0){
    // 和紙。破れは中心から広がる
    float r = clamp(length(vUv), 0.0, 1.0);
    float n = fbm(vUv * 5.2 + uSeed * 9.0);
    float thr = (1.0 - uHealth) * 1.06;
    if(n * 0.60 + r * 0.40 < thr) discard;
    // 破れ口のまわりは毛羽立って濃くなる
    float lip = smoothstep(thr, thr + 0.09, n * 0.60 + r * 0.40);

    float fiber = 0.86 + 0.14 * fbm(vUv * vec2(26.0, 7.0) + 2.0);
    vec3 dry = vec3(0.78, 0.74, 0.70);
    vec3 wet = vec3(0.62, 0.58, 0.56);
    col = mix(dry, wet, uWet) * fiber;
    col = mix(vec3(0.72, 0.56, 0.48), col, lip);
    // 紙は光を透かす
    // 和紙は光を透かす。裏から回った分を足す
    // 和紙は光を透かす。表から当たる分と、裏へ回って透けてくる分を足す。
    // 反射率 0.75 の紙なので、両方を足しても 1 を大きく超えないようにする
    vec3 lit = uSunColor * max(dot(N, uSunDir), 0.0) * 0.45
             + uSunColor * max(dot(-N, uSunDir), 0.0) * 0.30
             + skyAmbient(N) * 0.6;
    col *= lit;
    col += ggx(N, V, uSunDir, 0.30, vec3(0.03)) * uSunColor * uWet;
    alpha = mix(0.72, 0.42, uWet) * (0.55 + 0.45 * lip);
    alpha = mix(alpha, 1.0, pow(1.0 - ndv, 3.0) * 0.4);
  } else if(region == 1){
    // 枠。朱に塗った輪
    col = vec3(0.78, 0.17, 0.09);
    col *= 0.8 + 0.3 * fbm(vUv * 30.0);
    col = col * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N))
        + ggx(N, V, uSunDir, 0.20, vec3(0.05)) * uSunColor;
    alpha = 1.0;
  } else {
    // 柄。竹
    float grain = fbm(vec2(vW.y * 70.0, 0.5)) * 0.5 + 0.5;
    col = mix(vec3(0.52, 0.42, 0.24), vec3(0.72, 0.62, 0.40), grain);
    col = col * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N))
        + ggx(N, V, uSunDir, 0.35, vec3(0.04)) * uSunColor * 0.6;
    alpha = 1.0;
  }

  // 水中パスでは α にカメラからの距離を入れる（水面の屈折がこれを読む）。
  // 混ぜられないので、薄い所はディザで抜く
  if(uUnderwater == 1){
    if(alpha < 0.985 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > alpha) discard;
    frag = vec4(col, vDist);
    return;
  }
  frag = vec4(col, alpha);
}`;
