// 空・水槽・水面のシェーダ。
//
// 水面は 2 つの高さ場（FFT と波紋）を足して読む。どちらも
// 「勾配 x, 勾配 z, 高さ, ラプラシアン」の順に RGBA16F へ畳んであるので、
// 頂点でもフラグメントでも 1 回のサンプルで必要なものが揃う。

import { HEAD, NOISE, SKYLIB, AMBIENT, VS_FULL } from './common.js';

/** 水面の読み出しと、壁ぎわの減衰。水底のコースティクスでも使う。 */
const WATERLIB = `
uniform sampler2D uDisp;    // FFT の変位 (Dx, Dy, Dz)
uniform sampler2D uNormF;   // FFT の (∂h/∂x, ∂h/∂z, 泡, ∇²h)
uniform sampler2D uRipN;    // 波紋の (∂h/∂x, ∂h/∂z, h, ∇²h)
uniform float uPatch;
uniform float uRipSpan;
uniform vec2 uTankHalf;

vec2 patchUv(vec2 p){ return p / uPatch; }
vec2 ripUv(vec2 p){ return p / uRipSpan + 0.5; }

/** 壁に近いほど 0。たらいの水は縁で動けないので、変位をここで殺す。 */
float edgeMask(vec2 p){
  const float fade = 0.028;
  return smoothstep(0.0, fade, uTankHalf.x - abs(p.x))
       * smoothstep(0.0, fade, uTankHalf.y - abs(p.y));
}`;

// ---------------------------------------------------------------- 空と提灯

export const FS_SKY = `${HEAD}
${NOISE}
${SKYLIB}
in vec2 vNdc;
uniform vec3 uCam;
uniform vec3 uRight, uUp, uFwd;
uniform float uTanHalf, uAspect;
uniform float uGroundY;
uniform float uTime;
out vec4 frag;

void main(){
  vec3 d = normalize(uFwd + uRight * vNdc.x * uTanHalf * uAspect + uUp * vNdc.y * uTanHalf);
  vec3 col = skyColor(d);

  // 地面。濡れたアスファルトに提灯が滲む
  if(d.y < -0.001){
    float t = (uGroundY - uCam.y) / d.y;
    if(t > 0.0){
      vec3 p = uCam + d * t;
      float grain = fbm(p.xz * 42.0) * 0.5 + fbm(p.xz * 7.0) * 0.5;
      vec3 base = vec3(0.010, 0.010, 0.013) * (0.55 + 0.9 * grain);
      // 上向きの面が受ける光と、斜めに伸びる映り込み
      vec3 lit = lanternLight(p, vec3(0.0, 1.0, 0.0), 1.0) * 0.055;
      vec3 glint = lanternLight(p, reflect(d, vec3(0.0, 1.0, 0.0)), 70.0) * 0.080;
      float fog = exp(-t * 0.26);
      col = mix(col, base + lit + glint, clamp(fog, 0.0, 1.0));
    }
  }

  // 提灯そのもの。手前のものが奥を隠すよう、一番近い当たりを採る
  float best = 1e9;
  vec3 lamp = vec3(0.0);
  for(int i=0;i<NLANT;i++){
    vec3 c = uLanternP[i].xyz;
    float rad = uLanternP[i].w;
    // 提灯は縦長なので、y だけ縮めた座標で球と交差させる
    vec3 oc = uCam - c;
    vec3 dd = d;      oc.y *= 0.78; dd.y *= 0.78;
    float a = dot(dd, dd);
    float b = 2.0 * dot(oc, dd);
    float cc = dot(oc, oc) - rad * rad;
    float disc = b*b - 4.0*a*cc;
    if(disc < 0.0) continue;
    float t = (-b - sqrt(disc)) / (2.0 * a);
    if(t < 0.0 || t > best) continue;
    best = t;
    vec3 hit = uCam + d * t;
    vec3 n = normalize((hit - c) * vec3(1.0, 1.0/0.78, 1.0));
    // 紙越しの光。輪郭に向かって厚みが増し、骨の横縞が出る
    float edge = pow(1.0 - abs(dot(n, d)), 1.6);
    float rib = 0.80 + 0.20 * smoothstep(0.25, 0.75, fract((hit.y - c.y) / (rad * 0.21)));
    float flick = 0.90 + 0.10 * sin(uTime * (2.3 + float(i)) + float(i) * 2.1);
    vec3 glow = uLanternC[i].rgb;
    lamp = glow * (0.85 + 1.5 * edge) * rib * flick * 1.35;
    // 口金と房
    float cap = smoothstep(0.80, 0.92, abs(n.y));
    lamp = mix(lamp, vec3(0.045, 0.030, 0.018), cap);
  }
  if(best < 1e8) col = lamp;

  frag = vec4(col, 1.0);
}`;

export { VS_FULL };

// ---------------------------------------------------------------- 水槽

export const VS_TANK = `${HEAD}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aRegion;
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uBowlPos;    // 手元の器の置き場所。画面の向きで変える
out vec3 vW;
out vec3 vN;
out float vRegion;
out float vDist;

void main(){
  vec3 p = aPos, n = aNrm;
  // 器は回転対称なので、向きは要らない。置き場所だけずらす
  if(aRegion > 3.5) p += uBowlPos;
  vW = p;
  vN = n;
  vRegion = aRegion;
  vDist = distance(p, uCam);
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const FS_TANK = `${HEAD}
${NOISE}
${SKYLIB}
${AMBIENT}
${WATERLIB}
in vec3 vW;
in vec3 vN;
in float vRegion;
in float vDist;
uniform vec3 uCam;
uniform int uUnderwater;
uniform vec4 uFish[16];     // xz = 位置, z 成分 = 影の半径, w = 濃さ
uniform int uFishCount;
uniform float uDepth;
uniform float uBowlRim;
out vec4 frag;

void main(){
  int region = int(vRegion + 0.5);

  // 水中パスでは外側を描かない。描いても水面からは見えず、手前を塞ぐだけ
  if(uUnderwater == 1 && region >= 2) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 col;

  if(region <= 1){
    // 舟の内側。濃い藍のビニルに、底は細かい砂利
    float g = fbm(vW.xz * 120.0);
    float pebble = smoothstep(0.50, 0.82, fbm(vW.xz * 70.0 + 3.1));
    vec3 vinyl = vec3(0.016, 0.034, 0.068);
    vec3 base = region == 0
      ? mix(vinyl, vec3(0.030, 0.036, 0.048) * (0.6 + 0.6 * g), pebble * 0.40)
      : vinyl * (0.9 + 0.2 * g);

    if(uUnderwater == 1){
      float below = max(-vW.y, 0.0);           // 水面からの深さ
      vec2 pq = vW.xz;
      float lap = texture(uNormF, patchUv(pq)).w + texture(uRipN, ripUv(pq)).w;
      // 屈折写像のヤコビアンを ∇²h の一次で近似する。
      // 波頭（∇²h < 0）が凸レンズになって光が集まる
      float conv = 1.0 - lap * below * 0.25;
      float caus = pow(max(conv, 0.0), 2.4) * edgeMask(pq);
      // 底ほど模様がはっきりする。壁は斜めなので弱める
      float face = region == 0 ? 1.0 : 0.45;

      vec3 lit = waterAmbient(vW, N) * 0.42 + vec3(0.004, 0.007, 0.009);
      lit += vec3(0.014, 0.024, 0.032);        // 夜空からの回り込み
      col = base * (lit * (0.55 + 1.45 * caus * face));
      col += vec3(0.22, 0.26, 0.20) * caus * face * 0.090;

      // 金魚の影
      for(int i=0;i<16;i++){
        if(i >= uFishCount) break;
        float d = length(vW.xz - uFish[i].xy) / max(uFish[i].z, 1e-3);
        col *= 1.0 - uFish[i].w * (1.0 - smoothstep(0.55, 1.0, d));
      }
    } else {
      // 水の上に出ている内壁。濡れて黒く光る
      vec3 lit = lanternLight(vW, N, 1.0) * 0.60
               + lanternLight(vW, vec3(0.0, 1.0, 0.0), 1.0) * 0.55   // 水面からの照り返し
               + vec3(0.030, 0.040, 0.052);
      col = base * lit + lanternLight(vW, reflect(-V, N), 90.0) * 0.05;
    }
  } else if(region >= 4){
    // 手元の器。白磁に藍の線
    vec3 lit = waterAmbient(vW, N) * 0.95 + skyColor(N) * 0.7 + vec3(0.02, 0.025, 0.03);
    if(region == 6){
      // 器の水面。ほとんど真上から見るので、薄い藍を乗せて照りを足す
      vec3 tint = vec3(0.07, 0.26, 0.40);
      float F = 0.02 + 0.98 * pow(1.0 - max(dot(N, V), 0.0), 5.0);
      col = tint * (0.30 + 0.45 * length(lit))
          + lanternLight(vW, reflect(-V, N), 500.0) * 0.16
          + lanternLight(vW, reflect(-V, N), 60.0) * 0.05 + vec3(0.004, 0.008, 0.012);
      frag = vec4(col, clamp(0.32 + F * 0.5, 0.0, 0.80));
      return;
    }
    vec3 cer = vec3(0.62, 0.64, 0.66) * (0.92 + 0.12 * fbm(vW.xz * 90.0));
    // 口元の藍の輪
    cer = mix(cer, vec3(0.10, 0.16, 0.34), smoothstep(0.004, 0.0, abs(vW.y - uBowlRim) - 0.006));
    if(region == 5) cer = cer * 0.30 + vec3(0.010, 0.022, 0.034);
    col = cer * lit + lanternLight(vW, reflect(-V, N), 70.0) * 0.10;
  } else {
    // 縁と外側。使い込んだ木
    float grain = fbm(vec2(vW.x * 5.0 + vW.z * 5.0, vW.y * 90.0)) * 0.6
                + fbm(vec2(vW.x, vW.z) * 60.0) * 0.4;
    vec3 wood = mix(vec3(0.085, 0.052, 0.030), vec3(0.150, 0.095, 0.058), grain);
    if(region == 2) wood *= 1.15;              // 縁の上面は手で擦れて明るい
    vec3 diff = lanternLight(vW, N, 1.0) * 0.55;
    vec3 amb = skyColor(N) * 0.55;
    vec3 spec = lanternLight(vW, reflect(-V, N), 28.0) * 0.030;
    col = wood * (diff + amb) + spec;
  }

  frag = vec4(col, vDist);
}`;

// ---------------------------------------------------------------- 水面

export const VS_WATER = `${HEAD}
${WATERLIB}
layout(location=0) in vec2 aUv;    // 0..1
uniform mat4 uVP;
uniform vec3 uCam;
out vec3 vW;
out vec2 vP;
out float vEdge;
out float vDist;

void main(){
  vec2 p = (aUv * 2.0 - 1.0) * uTankHalf;
  float m = edgeMask(p);

  vec3 D = texture(uDisp, patchUv(p)).xyz;
  float rh = texture(uRipN, ripUv(p)).z;

  // 壁ぎわは動けないぶん、水がわずかに這い上がる（メニスカス）
  float men = (1.0 - m) * 0.0013;

  vW = vec3(p.x + D.x * m, (D.y + rh) * m + men, p.y + D.z * m);
  vP = p;
  vEdge = m;
  vDist = distance(vW, uCam);
  gl_Position = uVP * vec4(vW, 1.0);
}`;

export const FS_WATER = `${HEAD}
${SKYLIB}
${WATERLIB}
in vec3 vW;
in vec2 vP;
in float vEdge;
in float vDist;
uniform sampler2D uScene;   // 水中パスの色 (rgb) とカメラからの距離 (a)
uniform vec3 uCam;
uniform mat4 uVP;
uniform vec2 uRes;
out vec4 frag;

void main(){
  vec4 nf = texture(uNormF, patchUv(vP));
  vec4 nr = texture(uRipN, ripUv(vP));
  vec2 slope = (nf.xy + nr.xy) * vEdge;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  // 真上から覗くと屈折のずれは本来ごく小さい。水深 16cm では
  // 波紋が通っても底がほとんど動かず、水に見えない。
  // 反射とハイライトは正しい N のまま、屈折に使う法線だけ傾きを誇張する
  vec3 Nr = normalize(vec3(-slope.x * 2.4, 1.0, -slope.y * 2.4));
  vec3 V = normalize(uCam - vW);
  float ndv = max(dot(N, V), 1e-3);

  // ---- 屈折 ----
  // 屈折方向に進めた点を画面へ投影し直して拾う。板ポリで近似しないので、
  // 浅い角度でも金魚が水面の起伏どおりに歪む。
  //
  // 拾った先が水中でなかったときに「採らない」を if で切ると、金魚の輪郭で
  // 水面がブロック状に裂ける。採否を 0..1 の重みにして混ぜ、境目をぼかす。
  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 Rd = refract(-V, Nr, 1.0 / 1.333);
  float t = max(texture(uScene, suv).a - vDist, 0.0);
  vec2 uvOut = suv;
  for(int i = 0; i < 2; i++){
    vec4 cp = uVP * vec4(vW + Rd * t, 1.0);
    if(cp.w < 1e-4) break;
    vec2 uv = clamp(cp.xy / cp.w * 0.5 + 0.5, vec2(0.0015), vec2(0.9985));
    float d = texture(uScene, uv).a;
    float ok = smoothstep(vDist, vDist + 0.020, d);
    uvOut = mix(uvOut, uv, ok);
    t = mix(t, d - vDist, ok);
  }
  vec4 hit = texture(uScene, uvOut);
  vec3 under = hit.rgb;
  float path = max(hit.a - vDist, 0.0);

  // 吸収と、水そのものの色。
  // 吸収係数は清水の実測に近い値（赤から先に消える）。舟の水深は 16cm しか
  // ないので、海の値を使うと底が沈んで見えなくなる。
  // 散乱ぶんは「水の色 × 深さで効く一次元の濃さ」として足す。
  // (1-trans) をそのまま色に掛けると、いちばん吸収される赤が最も濃くなって
  // 水が茶色く見えるので、濃さはスカラーで持つ。
  vec3 sigma = vec3(0.70, 0.16, 0.05);
  vec3 trans = exp(-sigma * path * 2.0);
  float thick = 1.0 - exp(-path * 3.4);
  vec3 body = vec3(0.012, 0.058, 0.110);
  vec3 refr = under * trans + body * thick;

  // ---- 反射 ----
  // 提灯は 2 本のローブで表す。細いほうが提灯の実像、
  // 広いほうがそのまわりの暈け。どちらもフレネルの中に入れる。
  // 外で足すと水面全体が一様に明るくなり、水に見えなくなる
  vec3 Rr = reflect(-V, N);
  Rr.y = max(Rr.y, 0.003);     // 真横に逃げた反射が地面を舐めないように
  vec3 refl = skyColor(Rr)
            + lanternLight(vW, Rr, 900.0) * 0.95
            + lanternLight(vW, Rr, 90.0) * 0.14;

  float F = 0.02 + 0.98 * pow(1.0 - ndv, 5.0);
  vec3 col = mix(refr, refl, F);

  // 月のきらめき
  vec3 H = normalize(uMoonDir + V);
  col += vec3(0.50, 0.54, 0.64) * pow(max(dot(N, H), 0.0), 380.0) * 0.8 * F;

  // 波頭の白み。たらいなので本当に少しだけ
  float foam = clamp(nf.z * 1.4, 0.0, 1.0) * vEdge;
  col = mix(col, vec3(0.42, 0.47, 0.50), foam * 0.22);

  // 水際の明るい線
  col += vec3(0.08, 0.12, 0.16) * pow(1.0 - vEdge, 2.2) * 0.45;

  frag = vec4(col, 1.0);
}`;
