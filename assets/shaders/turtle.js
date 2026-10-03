// ミドリガメ（ミシシッピアカミミガメ）。
//
// 金魚と同じで、形は頂点シェーダの中で作る。(u, v, 部位) だけを頂点に持たせ、
// 甲羅・手足・頭を同じ関数の別の枝として書く。
//
// 真上から見たときの手がかりは、甲羅の鱗板の割れ方と、四肢の漕ぐ動き、
// それに目の後ろの赤い斑。この三つが揃うと一目でミドリガメになる。

import { HEAD, NOISE, SKYLIB, AMBIENT, WATERLIB, CAUSTICS } from './common.js?v=202610030535';

export const VS_TURTLE = `${HEAD}
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
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vDist;
flat out int vPart;

const float TAU = 6.2831853;

/** 甲羅の輪郭。前はやや狭く、後ろが広い。 */
float shellR(float th){
  // 前後に長く、後ろがわずかに広い楕円
  float c = cos(th), s2 = sin(th);
  float a = 0.52, bb = 0.41;
  float r = 1.0 / sqrt((c * c) / (a * a) + (s2 * s2) / (bb * bb));
  return r * (1.0 - 0.055 * c);
}

/** 四肢の付け根の角度。前脚は斜め前、後脚は斜め後ろ。 */
float limbAngle(int i){
  if(i == 0) return 0.78;
  if(i == 1) return -0.78;
  if(i == 2) return 2.30;
  return -2.30;
}

vec3 shapeOf(float u, float v, int part){
  if(part == 0 || part == 1){
    // 甲羅の上面と、腹側。中心 v=0、縁 v=1
    float th = u * TAU;
    float rr = v;
    float R = shellR(th);
    float dome = 0.165 * sqrt(max(1.0 - rr * rr * 0.97, 0.0));
    float y = part == 0 ? dome : -0.050 * sqrt(max(1.0 - rr * rr, 0.0));
    return vec3(cos(th) * R * rr, y, sin(th) * R * rr);
  }

  if(part == 6){
    // 頭と首。前へ伸びる丸い棒
    float s = u, ang = v * TAU;
    // 首は細く、頭でふくらむ
    float rr = 0.055 + 0.055 * smoothstep(0.35, 1.0, s);
    float reach = 0.40 + 0.30 * s;
    float lift = 0.010 + 0.022 * s;
    return vec3(reach, lift + cos(ang) * rr * 0.88, sin(ang) * rr * 1.02);
  }

  if(part == 7){
    // 尾
    float s = u, ang = v * TAU;
    float rr = 0.038 * (1.0 - s * 0.85);
    return vec3(-0.46 - 0.16 * s, 0.004 + cos(ang) * rr, sin(ang) * rr);
  }

  // 四肢。短くて幅の広い櫂。後ろへ払うように付く
  int li = part - 2;
  float th = limbAngle(li);
  float R = shellR(th) * 0.86;
  vec3 root = vec3(cos(th) * R, -0.015, sin(th) * R);
  // 漕ぐ。前脚と後脚で位相をずらす
  float swing = sin(uTime * uBeat + uPhase + float(li) * 1.7) * 0.38;
  float sweep = (li < 2 ? -0.30 : 0.26) + swing * 0.55;   // 後ろへ寝かせる
  float out_ = li < 2 ? 0.26 : 0.22;
  float a = th + sweep;
  vec3 dir = vec3(cos(a), -0.10, sin(a));
  vec3 side = vec3(-sin(a), 0.0, cos(a));
  // 付け根は細く、先で広がって、端はまた丸まる
  float w = 0.20 * sin(3.14159 * clamp(u * 0.78 + 0.22, 0.0, 1.0));
  return root + dir * (out_ * u) + side * (v - 0.5) * w
       + vec3(0.0, swing * 0.07 * u, 0.0);
}

vec3 toWorld(vec3 p){
  p *= uLen;
  float c = cos(uYaw), s = sin(uYaw);
  return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c) + uPos;
}

void main(){
  int part = int(aPart + 0.5);
  float e = 0.010;
  vec3 p  = shapeOf(aUv.x, aUv.y, part);
  vec3 pu = shapeOf(aUv.x + e, aUv.y, part);
  vec3 pv = shapeOf(aUv.x, min(aUv.y + e, 1.0), part);

  vec3 n = cross(pu - p, pv - p);
  float nl = length(n);
  n = nl > 1e-7 ? n / nl : vec3(0.0, 1.0, 0.0);
  if(part == 0 && n.y < 0.0) n = -n;          // 甲羅は常に上向き
  // 頭・首・尾は筒。(u,v) の取り方の都合で法線が内向きに出るので返す
  if(part == 6 || part == 7) n = -n;

  vec3 w = toWorld(p);
  float c = cos(uYaw), s = sin(uYaw);
  vW = w;
  vN = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  vUv = aUv;
  vPart = part;
  vDist = distance(w, uCam);
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const FS_TURTLE = `${HEAD}
${NOISE}
${SKYLIB}
${AMBIENT}
${WATERLIB}
${CAUSTICS}
in vec3 vW;
in vec3 vN;
in vec2 vUv;
in float vDist;
flat in int vPart;
uniform vec3 uCam;
uniform float uSeed;
out vec4 frag;

/**
 * 甲羅の鱗板の継ぎ目。
 *
 * カメの背甲を真上から見ると、中央に椎甲板が 5 枚、その左右に肋甲板が
 * 4 対、さらに外へ縁甲板が 11〜12 対並ぶ。四角い板が並ぶ形で、
 * 中心から放射する線ではない。極座標で切ると車輪の輻のようになって、
 * 甲羅ではなく蓮の葉に見えてしまう。
 *
 * so 体に沿った座標（前後 u・左右 v）で切る。
 */
float scuteSeam(float th, float rr, out float plate){
  float u = cos(th) * rr;        // -1 後ろ … +1 前
  float v = sin(th) * rr;        // 左右
  float av = abs(v);
  float seam = 0.0;
  float id = 0.0;

  // 縁甲板。外周の帯を 12 対に刻む。ここは細かい
  float rim = smoothstep(0.70, 0.80, rr);
  float marg = abs(fract(th / 6.2831853 * 24.0) - 0.5) * 2.0;
  seam = max(seam, (1.0 - smoothstep(0.55, 0.92, marg)) * rim);
  // 椎甲板との境（縁甲板の内側のふち）
  seam = max(seam, 1.0 - smoothstep(0.0, 0.045, abs(rr - 0.745)));

  float body = 1.0 - rim;
  // 椎甲板と肋甲板の境。左右に 2 本、前後に通る
  seam = max(seam, (1.0 - smoothstep(0.0, 0.055, abs(av - 0.255))) * body);
  // 肋甲板と縁甲板の境
  seam = max(seam, (1.0 - smoothstep(0.0, 0.055, abs(av - 0.615))) * body);

  // 前後の刻み。椎甲板は 5 枚、肋甲板は 4 対で、継ぎ目の位置がずれている
  float n = av < 0.255 ? 5.0 : 4.0;
  float off = av < 0.255 ? 0.0 : 0.5;
  float cut = abs(fract((u * 0.5 + 0.5) * n + off) - 0.5) * 2.0;
  seam = max(seam, (1.0 - smoothstep(0.55, 0.95, cut)) * body);

  // 板ごとの通し番号。板ごとに色を振るのに使う
  plate = floor((u * 0.5 + 0.5) * n + off) * 3.0 + floor(av * 3.3) + rim * 11.0;
  return seam;
}

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if(vPart >= 2 && vPart <= 5 && dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  float u = vUv.x, v = vUv.y;
  vec3 base;
  float gloss = 0.30;

  if(vPart == 0){
    // 甲羅。濃い苔色に、黄緑の筋が放射状に入る
    float th = u * 6.2831853, rr = v;
    vec3 dark  = vec3(0.052, 0.068, 0.036);
    vec3 olive = vec3(0.115, 0.135, 0.062);
    float plate;
    float seam = scuteSeam(th, rr, plate);
    float mottle = fbm(vec2(th * 2.4 + uSeed * 9.0, rr * 3.2));
    base = mix(dark, olive, mottle);
    // 板ごとに地の濃さが違う
    base *= 0.84 + 0.32 * hash12(vec2(plate, uSeed * 31.0));
    // アカミミガメの甲羅には、板ごとに黄緑の細い筋が渦を巻いて入る。
    // 中心から全体へ放射するのではなく、板の中で閉じている
    vec2 lp = vec2(cos(th), sin(th)) * rr * 9.0;
    float swirl = 0.5 + 0.5 * sin(length(fract(lp) - 0.5) * 26.0 + plate);
    base = mix(base, vec3(0.150, 0.168, 0.072), swirl * 0.28 * (1.0 - seam));
    // 板の中の成長輪。縁ほど詰む
    base *= 0.94 + 0.10 * sin(rr * 46.0 + plate * 2.0);
    // 継ぎ目は溝なので暗い
    base *= 1.0 - seam * 0.62;
    // 縁甲板は黄色みが強い
    base = mix(base, vec3(0.150, 0.145, 0.058), smoothstep(0.76, 0.95, rr) * 0.7);
    gloss = 0.46;
  } else if(vPart == 1){
    // 腹側。黄色い
    base = vec3(0.260, 0.235, 0.105) * (0.88 + 0.22 * fbm(vUv * 9.0));
    gloss = 0.22;
  } else if(vPart == 6){
    // 頭と首。暗い緑に黄色の縦縞、目の後ろに赤い斑
    float ang = v * 6.2831853;
    base = vec3(0.105, 0.130, 0.072);
    float stripe = 0.5 + 0.5 * sin(ang * 6.0 + u * 1.2);
    base = mix(base, vec3(0.330, 0.310, 0.110), smoothstep(0.50, 0.92, stripe) * 0.9);
    // 目
    float eye = min(length(vec2((u - 0.72) * 1.7, v - 0.21)),
                    length(vec2((u - 0.72) * 1.7, v - 0.79)));
    base = mix(base, vec3(0.020, 0.018, 0.012), 1.0 - smoothstep(0.034, 0.044, eye));
    // 耳のうしろの赤。ミドリガメの目印
    float red = min(length(vec2((u - 0.47) * 1.5, v - 0.19)),
                    length(vec2((u - 0.47) * 1.5, v - 0.81)));
    base = mix(base, vec3(0.330, 0.075, 0.045), (1.0 - smoothstep(0.050, 0.085, red)) * 0.9);
    gloss = 0.35;
  } else if(vPart == 7){
    base = vec3(0.110, 0.132, 0.068);
  } else {
    // 四肢。甲羅より明るい緑に、細かい鱗
    float sc = 0.5 + 0.5 * sin(u * 34.0) * sin(v * 22.0);
    base = mix(vec3(0.115, 0.140, 0.072), vec3(0.195, 0.210, 0.100), sc);
    base *= 0.85 + 0.25 * fbm(vec2(u * 10.0, v * 6.0));
    // 水掻きの縁は薄い
    base = mix(base, base * 1.4 + 0.015, smoothstep(0.65, 1.0, u) * 0.5);
    gloss = 0.28;
  }

  // 水中にいる間は、水面で結んだ光の網が甲羅にも落ちる
  vec3 caus = vec3(1.0);
  if(vW.y < -0.002){
    float below = -vW.y;
    vec2 entry = vW.xz + uSunHoriz * below * uRefrTan;
    caus = mix(vec3(1.0), caustics(vW.xz, below), edgeMask(entry));
  }

  vec3 lit = underSun(N) * caus + underAmbient(N) + underLantern(vW, N);
  float up = N.y * 0.5 + 0.5;
  vec3 col = base * lit * (0.80 + 0.30 * up);
  // 濡れた甲羅はよく照る
  col += ggx(N, V, underSunDir(), gloss, vec3(0.040)) * uSunColor * PI * 0.35;
  col += base * pow(1.0 - ndv, 4.0) * 0.10 * lit;

  frag = vec4(col, vDist);
}`;
