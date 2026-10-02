// 舟に入っている物。水草・泡・エアストーンとチューブ・酸素ボンベ。
//
// 寸法は実物を調べて入れてある。
//
//   アナカリス（オオカナダモ）… 茎の直径 2〜3mm、葉は長さ 15〜30mm・幅 3〜6mm、
//                               1 節に 3〜6 枚の輪生、株の横幅 3〜4cm、草丈 1m 超。
//                               縁日の舟には 15〜20cm に切った束を沈めてある。
//   エアストーン            … 直径 15mm・長さ 30mm ほどの円筒。
//   エアチューブ            … 内径 4mm の軟質塩ビ。半透明。
//
// 水深は 14.5cm しかないので、15cm を超える茎は途中で倒れて水面の下を這う。
// 真上から見る絵でこれは大事で、まっすぐ立てると茎が点にしか見えない。

import { HEAD, NOISE, SKYLIB, AMBIENT, WATERLIB, CAUSTICS } from './common.js?v=202610021520';

// ---------------------------------------------------------------- 浮き葉

// スイレンの浮き葉。
//
//   浮き葉は直径 10〜30cm の円形〜楕円形で、縁から中心へ深い切れ込みが入り、
//   表に光沢がある。日本に自生するヒツジグサはさらに小さく 8〜19 × 5〜12cm。
//   （切れ込みが無く光沢も無い直径 30〜50cm の円は、スイレンではなくハス。）
//
// 舟の内寸が 83cm なので、12cm 前後の葉を浮かべるとちょうど収まる。
// 葉は水面に浮いているので、波に合わせて上下し、傾く。
// 金魚はこの下の日陰に集まる。

export const VS_PAD = `${HEAD}
${WATERLIB}
layout(location=0) in vec3 aUvi;   // x = 中心からの距離(0..1), y = 角度(0..1), z = 表裏
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec2 uPadPos;
uniform float uPadR;
uniform float uYaw;
uniform float uTime;
uniform float uSeed;
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vFace;
out float vDist;

const float TAU = 6.2831853;

/** 葉の輪郭。真円ではなく、少し波打った卵形。 */
float padR(float th){
  return 1.0 + 0.022 * sin(th * 5.0 + uSeed * 20.0) + 0.028 * sin(th * 2.0 + uSeed);
}

void main(){
  float rr = aUvi.x, th = aUvi.y * TAU;
  float face = aUvi.z;

  // 水面の高さと傾きは、葉の中心で 1 回だけ取る。
  // 頂点ごとに取ると、葉が波の形に沿って折れ曲がり、紙くずになる。
  // 実際の葉は硬いので、浮きながら全体が同じだけ上下して傾く
  float h0 = texture(uDisp, patchUv(uPadPos)).y + texture(uRipN, ripUv(uPadPos)).z;
  vec2 sl = slopeAt(uPadPos) * edgeMask(uPadPos);
  // 傾きは抑える。葉は水面に張り付いているので、波の傾き全部は追わない
  sl *= 0.45;

  float a = th + uYaw;
  vec2 off = vec2(cos(a), sin(a)) * uPadR * padR(th) * rr;
  vec2 q = uPadPos + off;

  // 縁は水を弾いて少し反り返り、中心はへこむ
  float lift = uPadR * 0.042 * smoothstep(0.62, 1.0, rr);
  float dip = -uPadR * 0.028 * (1.0 - rr * rr);
  // 葉の厚みは 1.5mm ほど。裏の面は下へずらす。
  // ずらさないと、同じ深さで裏が表を塗り潰して葉が真っ黒になる
  float thick = face > 0.5 ? 0.0 : -0.0015;

  vec3 w = vec3(q.x,
                h0 + 0.0020 + lift + dip + thick - (sl.x * off.x + sl.y * off.y),
                q.y);

  // 法線。水面の傾きと、縁の反り返りから
  float curl = smoothstep(0.62, 1.0, rr) * 0.30;
  vec3 n = normalize(vec3(-sl.x - cos(a) * curl, 1.0, -sl.y - sin(a) * curl));
  vN = face > 0.5 ? n : -n;
  vW = w;
  vUv = vec2(rr, aUvi.y);
  vFace = face;
  vDist = distance(w, uCam);
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const FS_PAD = `${HEAD}
${NOISE}
${SKYLIB}
${AMBIENT}
${WATERLIB}
${CAUSTICS}
in vec3 vW;
in vec3 vN;
in vec2 vUv;
in float vFace;
in float vDist;
uniform vec3 uCam;
uniform float uSeed;
uniform float uPadR;
uniform float uTime;
out vec4 frag;

void main(){
  float rr = vUv.x, th = vUv.y * 6.2831853;
  // 切れ込み。縁から中心へ入る V。中心では幅 0 になるので、
  // 二枚の葉がそこで合わさっているように見える。
  // 中心に幅を残すと、葉に丸い穴が開いたように見えてしまう
  if(abs(th - 3.14159) < 0.30 * rr) discard;

  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  vec3 col;
  if(vFace > 0.5){
    // 表。濃い緑に、中心から放射する葉脈。艶があって水を弾く
    vec3 g1 = vec3(0.038, 0.088, 0.030);
    vec3 g2 = vec3(0.072, 0.142, 0.046);
    vec3 base = mix(g1, g2, fbm(vec2(th * 2.4, rr * 3.0) + uSeed * 11.0));
    // 主脈。中心から縁へ 16 本ほど。間に細い支脈が入る
    float vein = abs(fract(th / 6.2831853 * 17.0 + uSeed) - 0.5) * 2.0;
    float main_ = smoothstep(0.86, 1.0, vein) * smoothstep(0.08, 0.45, rr);
    float sub = smoothstep(0.80, 1.0, abs(fract(th / 6.2831853 * 51.0) - 0.5) * 2.0);
    base *= 1.0 + main_ * 0.17 + sub * 0.06 * smoothstep(0.2, 0.8, rr);
    // 古い葉は縁から茶色く枯れる
    float old = smoothstep(0.72, 1.0, rr) * smoothstep(0.45, 0.80, fbm(vec2(th * 3.0, 1.0) + uSeed * 7.0));
    base = mix(base, vec3(0.105, 0.072, 0.034), old * 0.40);
    // 縁は赤みが差す
    base = mix(base, base * vec3(1.30, 0.94, 0.86), smoothstep(0.90, 1.0, rr) * 0.40);

    col = base * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N) * 1.15);
    // 蝋の膜。水を弾くので、芯の硬い照りが乗る
    col += ggx(N, V, uSunDir, 0.085, vec3(0.055)) * uSunColor * PI * 1.1;
    // 葉の上に残った水玉
    // 弾かれた水が玉になって残る。細かくしすぎると病斑に見えるので、
    // 数を絞って大きめに置く
    vec2 bp = vec2(cos(th), sin(th)) * rr * uPadR * 150.0;
    float bead = smoothstep(0.86, 0.99, 1.0 - worley(bp));
    col += uSunColor * bead * 0.16 * smoothstep(0.1, 0.5, rr);
  } else {
    // 裏。赤紫を帯びて、太い葉脈が浮き出る。水の中なので光の網が落ちる
    float below = max(-vW.y, 0.0);
    vec2 entry = vW.xz + uSunHoriz * below * uRefrTan;
    vec3 caus = mix(vec3(1.0), caustics(vW.xz, below), edgeMask(entry));
    vec3 base = vec3(0.095, 0.042, 0.055);
    float vein = abs(fract(th / 6.2831853 * 17.0 + uSeed) - 0.5) * 2.0;
    base *= 1.0 + smoothstep(0.80, 1.0, vein) * 0.55;
    col = base * (underAmbient(N) * 1.2 + underSun(N) * caus * 0.5);
  }

  frag = vec4(col, vDist);
}`;

// ---------------------------------------------------------------- 泡

export const VS_BUBBLE = `${HEAD}
layout(location=0) in vec3 aUvi;   // xy = 板の中の位置 (-1..1), z = 泡の通し番号
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uRight, uUp;
uniform vec3 uStone;      // エアストーンの位置
uniform float uTime;
uniform float uCount;
out vec2 vP;
out vec3 vW;
out float vDist;
out float vFade;

float h11(float x){ return fract(sin(x * 127.1) * 43758.5453); }

void main(){
  float i = aUvi.z;
  float r1 = h11(i * 1.7), r2 = h11(i * 3.1 + 5.0), r3 = h11(i * 7.3 + 11.0);

  // 泡は一定の速さで上がる。上がるほど水圧が下がって少し膨らみ、速くなる
  float rise = 0.14 + r1 * 0.07;                 // [m/s]
  float t = fract(uTime * rise / 0.16 + r2);     // 0 で石、1 で水面
  float y = uStone.y + t * (-0.004 - uStone.y);

  // 石の口のばらつきと、上がりながらのふらつき
  float wob = sin(uTime * (2.2 + r3 * 1.8) + i * 2.3) * 0.004 * t;
  vec3 c = uStone + vec3((r1 - 0.5) * 0.020 + wob, 0.0, (r3 - 0.5) * 0.012);
  c.y = y;

  // 粒の大きさ。エアストーンから出る泡は 1〜3mm
  float rad = (0.0009 + r3 * 0.0014) * (1.0 + 0.35 * t);
  vP = aUvi.xy;
  vW = c + (uRight * aUvi.x + uUp * aUvi.y) * rad;
  // 水面に着く直前に消す。はじけるところまでは描かない
  // 出口で全部が重なると、石の上に明るい四角の塊ができる。
  // 出てすぐは薄く、水面の手前で消す
  vFade = smoothstep(0.0, 0.10, t) * smoothstep(1.0, 0.84, t) * step(i, uCount);
  vDist = distance(vW, uCam);
  gl_Position = uVP * vec4(vW, 1.0);
}`;

export const FS_BUBBLE = `${HEAD}
${SKYLIB}
${AMBIENT}
in vec2 vP;
in vec3 vW;
in float vDist;
in float vFade;
uniform vec3 uCam;
out vec4 frag;

void main(){
  float r = length(vP);
  if(r > 1.0 || vFade < 0.01) discard;

  // 泡は水より屈折率が低いので、縁が全反射して明るい輪になる。
  // 中は向こうが透けて見えるだけなので、ほとんど何も足さない
  float rim = smoothstep(0.62, 0.99, r);
  float ndv = sqrt(max(1.0 - r * r, 0.0));

  vec3 up = vec3(0.0, 1.0, 0.0);
  vec3 lit = underAmbient(up) + underSun(up) * 0.5;
  vec3 col = lit * (0.30 + 1.70 * rim);
  // 上側に小さな照り返しが一点入る
  float spot = smoothstep(0.34, 0.0, length(vP - vec2(-0.30, 0.34)));
  col += uSunColor * spot * 0.55;

  float a = (0.10 + 0.80 * rim) * vFade;
  frag = vec4(col * a, a);
}`;

// ---------------------------------------------------------------- 器具

export const VS_GEAR = `${HEAD}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aReg;   // 0 = エアストーン, 1 = チューブ, 2 = ボンベ, 3 = ボンベの金具
uniform mat4 uVP;
uniform vec3 uCam;
out vec3 vW;
out vec3 vN;
out float vRegion;
out float vDist;
void main(){
  vW = aPos;
  vN = aNrm;
  vRegion = aReg;
  vDist = distance(aPos, uCam);
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

export const FS_GEAR = `${HEAD}
${NOISE}
${SKYLIB}
${AMBIENT}
${WATERLIB}
${CAUSTICS}
in vec3 vW;
in vec3 vN;
in float vRegion;
in float vDist;
uniform vec3 uCam;
uniform int uUnderwater;
out vec4 frag;

void main(){
  // 水中パスと本パスで描き分ける。両方で描くと水面ごしに二重に出る
  if(uUnderwater == 1 && vW.y > 0.004) discard;
  if(uUnderwater == 0 && vW.y < -0.004) discard;

  int region = int(vRegion + 0.5);
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if(dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  vec3 base;
  float rough;
  if(region == 0){
    // エアストーン。焼結した砂を固めたもの。灰色でざらつき、気孔が開いている
    float g = fbm(vW.xz * 520.0 + vW.y * 300.0);
    float pore = smoothstep(0.58, 0.76, fbm(vW.xz * 900.0 + 3.0));
    base = mix(vec3(0.038, 0.037, 0.035), vec3(0.072, 0.070, 0.066), g);
    base *= 1.0 - pore * 0.45;
    rough = 0.85;
  } else if(region == 1){
    // 軟質塩ビのチューブ。半透明で、曲がった所に白い折り癖が出る
    base = vec3(0.205, 0.215, 0.200) * (0.90 + 0.18 * fbm(vW.xz * 300.0));
    base += vec3(0.05) * pow(1.0 - ndv, 3.0);
    rough = 0.16;
  } else if(region == 2){
    // 酸素ボンベの胴。塗装した鋼。細かい擦り傷が縦に走る
    float scr = fbm(vec2(atan(vW.z, vW.x) * 26.0, vW.y * 420.0));
    base = vec3(0.090, 0.150, 0.178) * (0.88 + 0.24 * scr);
    base = mix(base, base * 0.6 + vec3(0.10), smoothstep(0.66, 0.88, scr) * 0.35);
    rough = 0.34;
  } else {
    // 肩の金具とバルブ。真鍮
    base = vec3(0.330, 0.245, 0.095);
    rough = 0.22;
  }

  vec3 col;
  if(vW.y < -0.004){
    // 水の中。光の網が落ちる
    float below = -vW.y;
    vec2 entry = vW.xz + uSunHoriz * below * uRefrTan;
    vec3 caus = mix(vec3(1.0), caustics(vW.xz, below), edgeMask(entry));
    col = base * (underSun(N) * caus * wallShade(entry) + underAmbient(N));
    col += ggx(N, V, underSunDir(), rough, vec3(0.040)) * uSunColor * PI * 0.4 * caus;
  } else {
    col = base * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N));
    col += ggx(N, V, uSunDir, rough, vec3(region == 3 ? 0.35 : 0.045)) * uSunColor * PI * 0.8;
  }

  if(uUnderwater == 1){ frag = vec4(col, vDist); return; }
  frag = vec4(col, 1.0);
}`;
