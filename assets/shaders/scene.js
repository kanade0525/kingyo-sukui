// 空・舟・水面のシェーダ。
//
// 水面は 2 つの高さ場（FFT と波紋）を足して読む。どちらも
// 「勾配 x, 勾配 z, …」の順に RGBA16F へ畳んであるので、
// 頂点でもフラグメントでも 1 回のサンプルで必要なものが揃う。
//
// 浅い水の見せ方は、反射を盛ることではなく、底の砂利が屈折で揺らいで
// 見える状態を残すこと。白い帯で底を隠さない。

import { HEAD, NOISE, SKYLIB, AMBIENT, WATERLIB, CAUSTICS, VS_FULL } from './common.js';



// ---------------------------------------------------------------- 空と地面

export const FS_SKY = `${HEAD}
${NOISE}
${SKYLIB}
in vec2 vNdc;
uniform vec3 uCam;
uniform vec3 uRight, uUp, uFwd;
uniform float uTanHalf, uAspect;
uniform float uGroundY;
out vec4 frag;

void main(){
  vec3 d = normalize(uFwd + uRight * vNdc.x * uTanHalf * uAspect + uUp * vNdc.y * uTanHalf);
  vec3 col = skyWithSun(d);

  // 地面。夏の縁日の砂利まじりの土
  if(d.y < -0.001){
    float t = (uGroundY - uCam.y) / d.y;
    if(t > 0.0){
      vec3 p = uCam + d * t;
      float coarse = fbm(p.xz * 3.2);
      float fine = fbm(p.xz * 80.0);
      vec3 base = mix(vec3(0.138, 0.126, 0.110), vec3(0.228, 0.212, 0.186), coarse);
      base *= 0.88 + 0.22 * fine;
      vec3 n = normalize(vec3((fine - 0.5) * 0.4, 1.0, (fbm(p.zx * 80.0) - 0.5) * 0.4));
      vec3 lit = uSunColor * max(dot(n, uSunDir), 0.0) + skyAmbient(n);
      // 遠景のフェードは緩く。きつくすると、画面の大半が「地平線より下の
      // 空の色」に飲まれて、明るい地面が茶色く沈む
      float fog = exp(-t * 0.085);
      col = mix(col, base * lit, clamp(fog, 0.0, 1.0));
    }
  }
  frag = vec4(col, 1.0);
}`;

export { VS_FULL };

// ---------------------------------------------------------------- 舟と器

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
  vec3 p = aPos;
  // 器は回転対称なので、向きは要らない。置き場所だけずらす
  if(aRegion > 3.5) p += uBowlPos;
  vW = p;
  vN = aNrm;
  vRegion = aRegion;
  vDist = distance(p, uCam);
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const FS_TANK = `${HEAD}
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
uniform vec4 uFish[16];     // xy = 位置, z = 影の半径, w = 濃さ
uniform int uFishCount;
uniform float uDepth;
uniform float uBowlRim;
uniform vec3 uBowlPos;
out vec4 frag;

void main(){
  int region = int(vRegion + 0.5);

  // 水中パスでは外側を描かない。描いても水面からは見えず、手前を塞ぐだけ
  if(uUnderwater == 1 && region >= 2) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  vec3 col;

  if(region <= 1){
    // 舟の内側。青いビニルに細かい砂利
    // 青いビニルの舟。素地はほぼ無地にして、模様はコースティクスに任せる。
    // 粒立ったテクスチャを敷くと、水玉や砂嵐になって水に見えなくなる
    float mottle = fbm(vW.xz * 7.0);
    float grain = fbm(vW.xz * 90.0);
    vec3 vinyl = vec3(0.052, 0.112, 0.148);
    vec3 base = vinyl * (0.82 + 0.34 * mottle) * (0.95 + 0.10 * grain);
    if(region == 1) base *= 0.88;
    // 細かい凹凸ぶんだけ法線をずらす
    vec3 bn = normalize(vec3((grain - 0.5) * 0.35, 1.0, (fbm(vW.zx * 90.0) - 0.5) * 0.35));

    if(uUnderwater == 1){
      float below = max(-vW.y, 0.0);                // 水面からの深さ
      float face = region == 0 ? 1.0 : 0.5;         // 壁は斜めなので弱める
      // マスクは 0 ではなく 1 へ寄せる。0 に寄せると、外周で直射光ごと
      // 消えて、太陽と無関係な紺色の額縁が四辺に出る
      vec2 entry = vW.xz + uSunHoriz * below * uRefrTan;
      vec3 caus = mix(vec3(1.0), caustics(vW.xz, below), edgeMask(entry) * face);

      vec3 sun = underSun(bn) * caus * wallShade(entry);
      vec3 amb = underAmbient(bn);
      col = base * (sun + amb);

      // 金魚の影
      for(int i=0;i<16;i++){
        if(i >= uFishCount) break;
        float d = length(vW.xz - uFish[i].xy) / max(uFish[i].z, 1e-3);
        col *= 1.0 - uFish[i].w * (1.0 - smoothstep(0.55, 1.0, d));
      }
    } else {
      // 水の上に出ている内壁。濡れて黒く光る
      col = base * 0.55 * (uSunColor * max(dot(bn, uSunDir), 0.0) * 0.5 + skyAmbient(bn));
      col += ggx(N, V, uSunDir, 0.18, vec3(0.04)) * uSunColor * 0.6 * PI;
    }
  } else if(region >= 4){
    // 手元の器。白磁に藍の線
    if(region == 6){
      // 器の水面。舟と同じ考えで、反射より「水の色と透けぐあい」で見せる
      float F = fresnelSchlick(max(dot(N, V), 0.0), 0.02);
      vec3 refl = skyColor(reflect(-V, N));
      // 水の身。浅いので薄く
      vec3 body = vec3(0.030, 0.115, 0.150) * (skyAmbient(N) * 1.2 + uSunColor * 0.30);
      col = body + refl * F + ggx(N, V, uSunDir, 0.085, vec3(0.02)) * uSunColor * 0.8 * PI;
      // 縁に寄るほど厚く見える
      float r = length(vW.xz - uBowlPos.xz) / 0.085;
      frag = vec4(col, clamp(0.26 + 0.30 * r * r + F * 0.5, 0.0, 0.78));
      return;
    }
    vec3 cer = vec3(0.50, 0.51, 0.52) * (0.94 + 0.10 * fbm(vW.xz * 90.0));
    if(region == 5){
      cer *= 0.78;
      // 水に浸かっている所は水の色を帯びる。白磁のままだと水が入って見えない
      if(vW.y < uBowlRim - 0.020) cer = mix(cer, vec3(0.075, 0.215, 0.265), 0.62);
    }
    col = cer * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N))
        + ggx(N, V, uSunDir, 0.22, vec3(0.05)) * uSunColor * PI;
  } else {
    // 縁と外側。使い込んだ木。背景が明るいので、ここは暗く締めて輪郭を残す
    float grain = fbm(vec2(vW.x * 5.0 + vW.z * 5.0, vW.y * 90.0)) * 0.6
                + fbm(vec2(vW.x, vW.z) * 60.0) * 0.4;
    vec3 wood = mix(vec3(0.038, 0.024, 0.016), vec3(0.092, 0.058, 0.034), grain);
    if(region == 2) wood *= 1.2;              // 縁の上面は手で擦れて明るい
    col = wood * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N))
        + ggx(N, V, uSunDir, 0.42, vec3(0.04)) * uSunColor * 0.5 * PI;
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
${NOISE}
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
uniform float uDepth;
uniform float uTime;
out vec4 frag;

/** 水中の浮遊物。深さを変えて 3 段、まばらに置く。水の厚みが出る。 */
vec3 specks(vec3 origin, vec3 dir){
  float s = 0.0;
  for(int i = 0; i < 3; i++){
    float t = 0.022 + 0.040 * float(i);
    vec3 q = origin + dir * (t / max(-dir.y, 0.25));
    q.xz += vec2(uTime * 0.0035 * (1.0 + float(i)), uTime * 0.0021);
    vec2 g = q.xz * 300.0 + float(i) * 23.0;
    float h = hash12(floor(g));
    float d = length(fract(g) - 0.5);
    s += smoothstep(0.17, 0.03, d) * step(0.988, h) * (1.0 - 0.28 * float(i));
  }
  return uSunColor * s * 0.05;
}

void main(){
  vec2 slope = slopeAt(vP) * vEdge;
  vec3 N = normalize(vec3(-slope.x, 1.0, -slope.y));
  vec3 V = normalize(uCam - vW);
  float ndv = max(dot(N, V), 1e-3);

  // 水深 16cm では、底の横ずれは D·(1−1/n)·∇h ≈ 2mm しかない。
  // 誇張しても見えるほどにはならず、反射と法線がずれるだけなので素直に使う。
  // たらいの揺らぎの正体は幾何的な歪みではなく、コースティクスの明暗。

  // ---- 屈折 ----
  // 屈折方向へ進めた点を画面へ投影し直して水中パスを読む。
  // 拾った先が水中でなかったときに「採らない」を if で切ると、金魚の輪郭で
  // 水面がブロック状に裂ける。採否を 0..1 の重みにして混ぜ、境目をぼかす
  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 Rd = refract(-V, N, 1.0 / 1.333);
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
  float path = max(hit.a - vDist, 0.0);

  // 吸収と散乱。係数は清水の実測に近い値（赤から先に消える）。
  // 散乱ぶんは深さで効く一次元の濃さとして足す。(1-trans) を色に掛けると
  // いちばん吸収される赤が最も濃くなり、水が茶色く見えてしまう
  vec3 trans = exp(-vec3(0.45, 0.075, 0.035) * path * 2.0);
  float thick = 1.0 - exp(-path * 2.4);
  vec3 inscat = uSunColor * vec3(0.014, 0.062, 0.082) * thick;
  vec3 refr = hit.rgb * trans + inscat + specks(vW, Rd);

  // ---- 反射 ----
  vec3 Rr = reflect(-V, N);
  Rr.y = max(Rr.y, 0.0015);
  vec3 refl = skyColor(Rr);

  float F = fresnelSchlick(ndv, 0.02);
  vec3 col = mix(refr, refl, F);

  // ---- 太陽のきらめき ----
  // 画素の中で波の傾きがどれだけばらついているかで、ざらつきを広げる。
  // 固定の粗さだと、遠い所や縮小時にハイライトが点滅する
  // 粗さの下限は「格子で表せていないさざ波の傾き分散」。
  // FFT が持っているのは数 cm 以上の帯だけなので、mm 級のさざ波は
  // 粗さとして戻すのが正しい（Cox-Munk の凪で σ ≈ 0.05、α = √2σ ≈ 0.07）。
  // 太陽の円盤ぶん（α ≥ 0.0047）はこれに埋もれる。
  // 画素内のばらつきは α² の空間で足す
  // ローブの幅が「鏡面条件に必要な傾き」と同じくらい広いと、帯ではなく
  // 面全体の靄になる。格子で 8mm まで解けているので、粗さに戻すぶんは少なく
  // してローブを細くし、きらめきを粒に割る。
  // 画素内のばらつきは α² の空間で足す（Kaplanyan / Tokuyoshi）
  vec2 dsx = dFdx(slope), dsy = dFdy(slope);
  float a2 = 0.00013 + (dot(dsx, dsx) + dot(dsy, dsy));
  float rough = sqrt(sqrt(a2));
  // ggx() の D は 1/π を持つので、ランバート側と揃えるため π を掛け戻す
  col += min(ggx(N, V, uSunDir, rough, vec3(0.02)) * uSunColor * PI, vec3(0.9));

  // 水際の明るい線
  col += vec3(0.06, 0.10, 0.13) * pow(1.0 - vEdge, 2.2) * 0.5;

  frag = vec4(col, 1.0);
}`;
