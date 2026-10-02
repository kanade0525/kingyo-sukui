// 空・舟・水面のシェーダ。
//
// 水面は 2 つの高さ場（FFT と波紋）を足して読む。どちらも
// 「勾配 x, 勾配 z, …」の順に RGBA16F へ畳んであるので、
// 頂点でもフラグメントでも 1 回のサンプルで必要なものが揃う。
//
// 浅い水の見せ方は、反射を盛ることではなく、底の砂利が屈折で揺らいで
// 見える状態を残すこと。白い帯で底を隠さない。

import { HEAD, NOISE, SKYLIB, AMBIENT, MATERIAL, WATERLIB, CAUSTICS, VS_FULL } from './common.js?v=202610020729';



// ---------------------------------------------------------------- 空と地面

export const FS_SKY = `${HEAD}
${NOISE}
${SKYLIB}
${MATERIAL}
in vec2 vNdc;
uniform vec3 uCam;
uniform vec3 uRight, uUp, uFwd;
uniform float uTanHalf, uAspect;
uniform float uGroundY;
uniform vec2 uTankOuter;   // 舟の外寸の半分
uniform float uRimTop;     // 舟の上端
uniform vec3 uBowlPos;
uniform float uBowlR;
uniform float uBowlRimY;
out vec4 frag;

/**
 * 地面に落ちる影。
 *
 * 太陽へ向かう直線が、舟（直方体）か器（円柱）の上端の高さで
 * その輪郭の中に入るなら、そこは日陰。平らな地面しか受け手がないので、
 * この一段だけで足りる。影が無いと、物がどれだけ精密でも
 * 「地面に貼った絵」に見える。
 */
float groundShadow(vec3 p){
  float sy = max(uSunDir.y, 0.05);
  float sh = 1.0;

  // 舟
  vec2 q = p.xz + uSunDir.xz * ((uRimTop - p.y) / sy);
  vec2 d = abs(q) - uTankOuter;
  sh *= smoothstep(-0.004, 0.028, max(d.x, d.y));

  // 器
  vec2 b = p.xz + uSunDir.xz * ((uBowlRimY - p.y) / sy) - uBowlPos.xz;
  sh *= smoothstep(-0.002, 0.022, length(b) - uBowlR);

  return mix(0.26, 1.0, sh);   // 影の中にも空からの光は回り込む
}

/** 接地の陰り。物の足元がいちばん濃い。 */
float contactAO(vec3 p){
  vec2 d = abs(p.xz) - uTankOuter;
  float dt = length(max(d, 0.0)) + min(max(d.x, d.y), 0.0);
  float ao = 1.0 - 0.55 * exp(-max(dt, 0.0) / 0.045);
  float db = length(p.xz - uBowlPos.xz) - uBowlR;
  ao *= 1.0 - 0.45 * exp(-max(db, 0.0) / 0.030);
  return ao;
}

void main(){
  vec3 d = normalize(uFwd + uRight * vNdc.x * uTanHalf * uAspect + uUp * vNdc.y * uTanHalf);
  vec3 col = skyWithSun(d);

  // 地面。夏の縁日の砂利まじりの土
  if(d.y < -0.001){
    float t = (uGroundY - uCam.y) / d.y;
    if(t > 0.0){
      vec3 p = uCam + d * t;
      // 乾いた土に砂利が埋まった地面。舟のまわりは水が跳ねて濡れている。
      // 「大きなむら・埋まった粒・細かい砂」の三層を重ね、
      // 粒の継ぎ目に影を落として、ようやく土に見える
      float coarse = fbm(p.xz * 2.4);
      float fine = fbm(p.xz * 120.0);
      float cav;
      float peb = gravel(p.xz, 165.0, cav);   // 粒は 6mm

      vec3 soil  = mix(vec3(0.128, 0.114, 0.096), vec3(0.212, 0.195, 0.168), coarse);
      vec3 stone = mix(vec3(0.185, 0.180, 0.170), vec3(0.268, 0.260, 0.244), fine);
      vec3 base = mix(soil, stone, peb * 0.28);
      base *= 1.0 - cav * 0.20;                       // 粒の継ぎ目に溜まる影
      base *= 0.90 + 0.20 * fine;

      // 舟と器のまわりは濡れている。濡れた土は暗く、よく照る
      vec2 dd = abs(p.xz) - uTankOuter;
      float ring = length(max(dd, 0.0)) + min(max(dd.x, dd.y), 0.0);
      float damp = (1.0 - smoothstep(0.0, 0.30, ring)) * 0.75
                 + smoothstep(0.52, 0.80, fbm(p.xz * 1.6 + 7.0)) * 0.5;
      damp = clamp(damp, 0.0, 1.0);
      base *= 1.0 - damp * 0.42;

      float e = 0.0022;
      float h0 = peb * 0.5 + fine * 0.18;
      float hx = gravel(p.xz + vec2(e, 0.0), 165.0, cav) * 0.5 + fbm((p.xz + vec2(e, 0.0)) * 120.0) * 0.18;
      float hz = gravel(p.xz + vec2(0.0, e), 165.0, cav) * 0.5 + fbm((p.xz + vec2(0.0, e)) * 120.0) * 0.18;
      vec3 n = normalize(vec3((h0 - hx) * 1.8, 1.0, (h0 - hz) * 1.8));

      float sh = groundShadow(p);
      vec3 lit = uSunColor * max(dot(n, uSunDir), 0.0) * sh
               + skyAmbient(n) * contactAO(p);
      // 濡れた所の照り返し
      base = base * lit
           + ggx(n, -d, uSunDir, mix(0.72, 0.22, damp), vec3(0.04)) * uSunColor * PI * sh * (0.15 + 0.85 * damp);
      lit = vec3(1.0);
      // 遠景のフェードは緩く。きつくすると、画面の大半が「地平線より下の
      // 空の色」に飲まれて、明るい地面が茶色く沈む
      float fog = exp(-t * 0.085);
      col = mix(col, base, clamp(fog, 0.0, 1.0));
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
${MATERIAL}
${WATERLIB}
${CAUSTICS}
in vec3 vW;
in vec3 vN;
in float vRegion;
in float vDist;
uniform vec3 uCam;
uniform int uUnderwater;
uniform vec4 uFish[20];     // xy = 位置, z = 影の半径, w = 濃さ
uniform int uFishCount;
uniform float uDepth;
uniform float uBowlRim;
uniform vec3 uBowlPos;
uniform float uGroundY;
uniform float uRimTop2;
uniform vec2 uTankOuter2;
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
    // 木枠に敷いたブルーシート。縁日の金魚すくいでいちばん多い作り。
    //
    // ブルーシートの見分けがつく一番の手掛かりは、平たいテープを縦横に
    // 編んだ織り目。それに、折り畳んだ跡の折り目（白く色が抜ける）と、
    // 水を張ったときの大きなたるみ。この三つを入れると、
    // 「青く塗った箱」ではなく「水を張ったシート」になる
    vec2 sp = region == 1 ? vec2(vW.x + vW.z, vW.y) * 1.0 : vW.xz;
    vec2 wb;
    float w = tarpWeave(sp, wb);
    float sag = fbm(vW.xz * 4.0);
    float creaseN = fbm(region == 1 ? vec2((vW.x + vW.z) * 13.0, vW.y * 2.6)
                                    : vW.xz * vec2(9.0, 3.2));
    float crease = 1.0 - smoothstep(0.0, 0.055, abs(creaseN - 0.5));

    vec3 vinyl = vec3(0.050, 0.108, 0.144);
    vec3 base = vinyl * (0.86 + 0.26 * sag) * (0.92 + 0.14 * w);
    // 折り目は樹脂が白く疲れる
    base = mix(base, base * 1.8 + vec3(0.012, 0.016, 0.018), crease * 0.55);
    if(region == 1) base *= 1.16;     // 壁は斜めで暗くなりがちなので素地を上げる

    vec3 bn = normalize(vec3(wb.x * 0.08, 1.0, wb.y * 0.08));

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
      for(int i=0;i<20;i++){
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
    // 白磁の器。釉薬のむらと、細かい貫入、口元の呉須の線。
    // 陶器は艶が命なので、粗さを小さく取って芯のあるハイライトを出す
    vec2 bp = (vW.xz - uBowlPos.xz) * 30.0;
    float glaze = fbm(bp * 1.4) * 0.6 + fbm(bp * 5.0) * 0.4;
    vec3 cer = vec3(0.520, 0.528, 0.530) * (0.93 + 0.12 * glaze);
    // 貫入。釉薬に入る細かいひび
    float craze = 1.0 - smoothstep(0.0, 0.035, abs(fbm(bp * 3.2 + 2.0) - 0.5));
    cer *= 1.0 - craze * 0.10;
    // 口元の呉須の一本線
    float lip = 1.0 - smoothstep(0.0, 0.0035, abs(vW.y - (uBowlRim - 0.009)));
    cer = mix(cer, vec3(0.085, 0.135, 0.300), lip * 0.85);
    if(region == 5){
      cer *= 0.80;
      // 水に浸かっている所は水の色を帯びる。白磁のままだと水が入って見えない
      if(vW.y < uBowlRim - 0.020) cer = mix(cer, vec3(0.075, 0.215, 0.265), 0.62);
    }
    col = cer * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N))
        + ggx(N, V, uSunDir, 0.085, vec3(0.055)) * uSunColor * PI;
  } else {
    // 縁と外側。使い込んだ木。背景が明るいので、ここは暗く締めて輪郭を残す
    // 使い込んだ杉の板。
    //
    // 板目は、年輪を板の長手方向へ強く伸ばした同心の縞として作る。
    // 面ごとに板の向きが違うので、どちらの辺に沿っているかで座標を取り替える。
    // 日に当たる面は銀色に褪せ、水の跳ねる所は色が抜けて黒ずむ。
    bool lengthX = abs(vW.z) > abs(vW.x);
    vec2 wp = lengthX ? vec2(vW.x, vW.y * 3.0 + vW.z * 0.6)
                      : vec2(vW.z, vW.y * 3.0 + vW.x * 0.6);
    float seed = floor((lengthX ? vW.z : vW.x) * 2.0) * 0.7;

    float ring = woodRings(wp * vec2(2.6, 2.2), seed);
    float fibre = fbm(wp * vec2(90.0, 320.0));
    float grain = ring * 0.72 + fibre * 0.28;
    vec3 wood = mix(vec3(0.028, 0.018, 0.011), vec3(0.118, 0.078, 0.046), grain);

    // 日に焼けて銀化した所
    float silver = smoothstep(0.48, 0.86, fbm(wp * vec2(1.6, 1.1) + 3.0));
    wood = mix(wood, vec3(0.098, 0.092, 0.082), silver * 0.45);
    // 水が跳ねて黒ずんだ所。縁の上と内側に出る
    float splash = smoothstep(0.52, 0.80, fbm(vW.xz * 7.0 + 5.0));
    wood *= 1.0 - splash * 0.30;

    // 角の留め継ぎ。4 枚の板を 45 度に切って突き合わせてあるので、
    // 角から斜めに細い継ぎ目が走る。板目の向きが切り替わるのもこの線。
    // 線を引かないと、向きが変わった所がただの食い違いに見える
    vec2 q = abs(vW.xz) - uTankHalf;
    float miter = 1.0 - smoothstep(0.0, 0.0035, abs(q.x - q.y));
    float onRim = step(0.0, min(q.x, q.y));       // 角の板が重なる所だけ
    wood *= 1.0 - miter * onRim * 0.42;
    if(region == 2) wood *= 1.25;             // 縁の上面は手で擦れて明るい

    // シートの折り返し。内側の縁に青が乗る。これがあると
    // 「木の箱」ではなく「木枠に水を張った舟」に見える
    if(region == 2){
      vec2 d2 = abs(vW.xz) - uTankHalf;
      float over = smoothstep(0.016, 0.002, max(d2.x, d2.y));
      vec3 sheet = vec3(0.070, 0.150, 0.190) * (0.86 + 0.28 * fbm(vW.xz * 34.0));
      wood = mix(wood, sheet, over);
    }
    // 面取り。縁の内側と外側のきわだけ、擦れて明るい。
    // y だけで見ると上面が丸ごと光ってしまう
    if(region == 2){
      vec2 di = abs(vW.xz) - uTankHalf;
      vec2 doo = abs(vW.xz) - uTankOuter2;
      float edge = max(1.0 - smoothstep(0.0, 0.006, abs(max(di.x, di.y))),
                       1.0 - smoothstep(0.0, 0.006, abs(max(doo.x, doo.y))));
      wood *= 1.0 + 0.55 * edge;
    }
    // 下へ行くほど地面の照り返ししか届かない
    float toGround = smoothstep(uGroundY, uGroundY + 0.14, vW.y);
    vec3 wn = normalize(vec3((grain - 0.5) * 0.10, 1.0, (fibre - 0.5) * 0.06) * 0.0 + N);
    col = wood * (uSunColor * max(dot(wn, uSunDir), 0.0) + skyAmbient(wn) * (0.35 + 0.65 * toGround))
        + ggx(wn, V, uSunDir, 0.62, vec3(0.035)) * uSunColor * 0.5 * PI;
    col *= 0.55 + 0.45 * toGround;
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

  // 屈折に使う傾きは、細かい波をならしたもの。
  //
  // 実際の浅い水で底の像を動かすのは大きなうねりで、cm 級のさざ波は
  // 照りに出るだけで像をほとんど動かさない。全部の波を同じように
  // 屈折へ入れると、隣り合う画素が遠く離れた所を拾い、金魚の胴が
  // 途中で切れて二匹に見える。
  const float SMOOTH = 0.016;      // この長さより短い波は屈折に効かせない
  vec2 slopeR = (slopeAt(vP)
               + slopeAt(vP + vec2(SMOOTH, 0.0)) + slopeAt(vP - vec2(SMOOTH, 0.0))
               + slopeAt(vP + vec2(0.0, SMOOTH)) + slopeAt(vP - vec2(0.0, SMOOTH))) * 0.2 * vEdge;
  vec3 Nr = normalize(vec3(-slopeR.x, 1.0, -slopeR.y));

  // 水深 16cm では、底の横ずれは D·(1−1/n)·∇h ≈ 2mm しかない。
  // 誇張しても見えるほどにはならず、反射と法線がずれるだけなので素直に使う。
  // たらいの揺らぎの正体は幾何的な歪みではなく、コースティクスの明暗。

  // ---- 屈折 ----
  // 屈折方向へ進めた点を画面へ投影し直して水中パスを読む。
  // 拾った先が水中でなかったときに「採らない」を if で切ると、金魚の輪郭で
  // 水面がブロック状に裂ける。採否を 0..1 の重みにして混ぜ、境目をぼかす
  vec2 suv = gl_FragCoord.xy / uRes;
  vec3 Rd = refract(-V, Nr, 1.0 / 1.333);

  // 進める距離には上限がある。水面から底まで、斜めに通っても水深の数倍。
  // 上限を置かないと、浅い角度のとき遠くの金魚を拾って壁に貼り付けてしまう
  float maxT = uDepth * 2.2;
  float t = clamp(texture(uScene, suv).a - vDist, 0.0, maxT);

  // 1 回だけ進めて、ずれの大きさに蓋をする。
  // 反復して詰めると、金魚のように深さが急に変わる所で行き先を見失い、
  // 同じ金魚をもう一匹、別の場所に貼り付けてしまう（幽霊が出る）。
  // 真上から見た 16cm の水では、本来のずれは数 mm しかない
  vec4 cp = uVP * vec4(vW + Rd * t, 1.0);
  vec2 uv = cp.w > 1e-4 ? cp.xy / cp.w * 0.5 + 0.5 : suv;
  vec2 off = uv - suv;
  const float LIMIT = 0.006;            // 画面の 0.6% まで
  float len = length(off);
  if(len > LIMIT) off *= LIMIT / len;
  vec2 uvOut = clamp(suv + off, vec2(0.0015), vec2(0.9985));
  // 拾った先が水中でなければ、素直に真下を見る
  float ok = smoothstep(vDist, vDist + 0.015, texture(uScene, uvOut).a);
  uvOut = mix(suv, uvOut, ok);
  vec4 hit = texture(uScene, uvOut);
  float path = max(hit.a - vDist, 0.0);

  // 吸収と散乱。係数は清水の実測に近い値（赤から先に消える）。
  // 散乱ぶんは深さで効く一次元の濃さとして足す。(1-trans) を色に掛けると
  // いちばん吸収される赤が最も濃くなり、水が茶色く見えてしまう
  vec3 trans = exp(-vec3(0.45, 0.075, 0.035) * path * 2.0);
  float thick = 1.0 - exp(-path * 2.4);
  // 夕方は、水の中に回る光そのものが暖色に転ぶ
  vec3 inscat = uSunColor * vec3(0.012, 0.070, 0.098) * thick
              * mix(vec3(1.0), vec3(1.9, 1.15, 0.70), uWarmth);
  vec3 refr = hit.rgb * trans + inscat + specks(vW, Rd);

  // ---- 反射 ----
  vec3 Rr = reflect(-V, N);
  Rr.y = max(Rr.y, 0.0015);
  // 真上寄りの構図では、反射が拾うのは中天の青ばかりになる。
  // 日が傾くと空全体が暖色になるので、地平の色を混ぜて寄せる
  vec3 refl = mix(skyColor(Rr), uSkyHorizon * 1.3, uWarmth * 0.6);

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
  col += min(ggx(N, V, uSunDir, rough, vec3(0.02)) * uSunColor * PI, vec3(0.30));

  // 水際の明るい線
  col += vec3(0.06, 0.10, 0.13) * pow(1.0 - vEdge, 2.2) * 0.5;

  frag = vec4(col, 1.0);
}`;
