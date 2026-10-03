// 空・舟・水面のシェーダ。
//
// 水面は 2 つの高さ場（FFT と波紋）を足して読む。どちらも
// 「勾配 x, 勾配 z, …」の順に RGBA16F へ畳んであるので、
// 頂点でもフラグメントでも 1 回のサンプルで必要なものが揃う。
//
// 浅い水の見せ方は、反射を盛ることではなく、底の砂利が屈折で揺らいで
// 見える状態を残すこと。白い帯で底を隠さない。

import { HEAD, NOISE, SKYLIB, AMBIENT, MATERIAL, WATERLIB, CAUSTICS, VS_FULL } from './common.js?v=202610030535';



// 視差遮蔽（POM）は入れてみたが外した。
// 1 画素あたり十数回も高さを引くので、得られる見た目に対して重すぎる。
// 1 段の視差で十分に厚みは出る。

// ---------------------------------------------------------------- 空と地面

/**
 * 金魚の影を 1 枚の絵に焼く。
 *
 * これまでは舟の底のシェーダが、画素ごとに全部の魚を舐めて丸い斑を
 * 落としていた。1 画素あたり 30 回も繰り返すので匹数を増やせず、
 * 52 匹いるのに影は 30 個しか出ていなかった。しかも形が円なので、
 * 日が傾いて影が長く伸びる時刻に「丸くておかしい」と分かる。
 *
 * 256² の絵に先に焼いてしまえば、繰り返しは 6 万画素ぶんで済む。
 * 舟の底は 1 回読むだけ。匹数を増やしても底の負荷は変わらない。
 * ついでに、影を魚の形にできる。
 */
export const FS_FISHSHADOW = `${HEAD}
uniform vec4 uFish[56];    // xy = 位置, z = 体長, w = 濃さ
uniform vec4 uFishB[56];   // xy = 進む向き, z = ぼけ具合, w = 1 なら亀
uniform int uFishCount;
uniform vec2 uArea;        // この絵が覆う範囲（半分）
in vec2 vUv;
out vec4 frag;

void main(){
  vec2 p = (vUv * 2.0 - 1.0) * uArea;
  float dark = 0.0;
  for(int i = 0; i < 56; i++){
    if(i >= uFishCount) break;
    vec4 f = uFish[i];
    vec4 b = uFishB[i];
    float L = max(f.z, 1e-4);
    vec2 d = p - f.xy;
    // 粗い切り落とし。遠い魚は計算しない
    if(dot(d, d) > L * L * 2.6) continue;
    // 進む向きを +x に合わせて回す
    vec2 q = vec2(d.x * b.x + d.y * b.y, -d.x * b.y + d.y * b.x);
    float soft = b.z;

    float shape;
    if(b.w > 0.5){
      // 亀は甲羅なので、ほぼ楕円
      shape = 1.0 - smoothstep(0.52 - soft, 1.0 + soft,
        length(vec2(q.x / (0.52 * L), q.y / (0.42 * L))));
    } else {
      // 胴。前寄りの楕円
      float body = 1.0 - smoothstep(0.50 - soft, 1.0 + soft,
        length(vec2((q.x - 0.07 * L) / (0.36 * L), q.y / (0.165 * L))));
      // 尾。後ろへ広がって薄れる
      float ts = (-q.x / L - 0.18) / 0.66;
      float tail = 0.0;
      if(ts > 0.0 && ts < 1.0){
        float tw = (0.05 + 0.33 * ts) * L;
        tail = (1.0 - smoothstep(0.45 - soft, 1.0 + soft, abs(q.y) / tw))
             * (1.0 - ts * ts) * 0.82;
      }
      shape = max(body, tail);
    }
    dark += f.w * shape;
  }
  frag = vec4(clamp(dark, 0.0, 0.95), 0.0, 0.0, 1.0);
}`;

export const FS_SKY = `${HEAD}
${NOISE}
${SKYLIB}
${MATERIAL}
in vec2 vNdc;
uniform vec3 uCam;
uniform vec3 uRight, uUp, uFwd;
uniform float uTanHalf, uAspect;
uniform float uGroundY;
uniform vec2 uTankOuter;   // 舟の外寸の半分（いちばん張り出す縁の上端で）
uniform float uTankOuterR; // その角の丸み

/** 角の丸い長方形までの距離。正なら外側。 */
float outerDist(vec2 p){
  vec2 q = abs(p) - uTankOuter + uTankOuterR;
  return min(max(q.x, q.y), 0.0) + length(max(q, 0.0)) - uTankOuterR;
}
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
  sh *= smoothstep(-0.004, 0.028, outerDist(q));

  // お椀は水面に浮いているので、地面には影を落とさない

  return mix(0.26, 1.0, sh);   // 影の中にも空からの光は回り込む
}

/** 接地の陰り。物の足元がいちばん濃い。 */
float contactAO(vec3 p){
  return 1.0 - 0.55 * exp(-max(outerDist(p.xz), 0.0) / 0.045);
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
      //
      // 「大きなむら・埋まった粒・細かい砂」を重ねたうえで、
      // 高さぶんの視差、粒の谷の遮蔽、面内で変わる粗さ、濡れた膜の
      // 四つを足す。平らな面に模様を貼っただけだと、斜めから見ても
      // 模様が動かないので、すぐ「絵が貼ってある」と分かってしまう。
      // 1 段の視差。高さぶんだけ見ている向きへずらす
      float cav0;
      float h0 = gravel(p.xz, 38.0, cav0);
      vec2 pp = parallax(p.xz, h0, -d, vec3(0.0, 1.0, 0.0), 0.004);

      // 下地は神社の参道の石畳。その上に玉砂利が撒いてある。
      //
      // 粒の大きさを間違えると、どれだけ重ねても漆喰の壁にしか見えない。
      // 実際の玉砂利は 2〜3cm なので、周波数は 40/m 前後。前は 165/m で、
      // カメラから 1m 離れると 1 粒が 1 画素より小さく、全部ならされて
      // 平らな灰色になっていた。
      float coarse = fbm(pp * 2.4);
      float cav, cav2;
      // 粒を 2 段に重ねる。1 段だけだと大きさが揃いすぎて、
      // 砂利ではなく緩衝材の粒に見える
      // 大小 2 段。同じ大きさを 2 枚重ねても、粒が揃ったままになる
      float peb  = gravel(pp, 38.0, cav);         // 玉砂利（3cm ほど）
      float peb2 = gravel(pp + 11.0, 82.0, cav2); // 間を埋める小粒（1.2cm）
      float grit = fbm(pp * 150.0);               // その上の細かい砂

      float joint, sid, dish;
      float gran = flagstone(pp * 4.0, joint, sid, dish);
      // 花崗岩。青みの強い灰色で、砂利より明るく、つるりとしている
      vec3 slab = vec3(0.196, 0.198, 0.196) * gran;
      // 石ごとの振れを大きく取る。実際の参道は一枚ずつ色が違う
      slab *= vec3(0.62 + 0.72 * sid, 0.66 + 0.64 * sid, 0.72 + 0.54 * sid);
      slab *= 0.88 + 0.22 * (1.0 - dish);         // 踏まれて中央が磨ける
      // 石肌の目。細かい彫り跡が残っている
      slab *= 0.93 + 0.14 * fbm(pp * vec2(90.0, 24.0) + sid * 30.0);

      // 玉砂利。石畳より暗く、黄みが強い。粒ごとに色が振れる
      // 砂利の被り。
      //
      // なだらかに混ぜていたら、灰色の濃淡が塗ってあるようにしか
      // 見えなかった。砂利は 1 粒ずつ置かれているので、石畳との境は
      // 粒の単位で切れる。粒ごとの乱数で「在る／無い」を決め、
      // 粒の形で切り抜く
      float density = smoothstep(0.26, 0.80, fbm(pp * 1.6 + 3.0));
      float here = step(1.0 - density, hash12(floor(pp * 38.0) + 3.0));
      float here2 = step(1.0 - density * 0.8, hash12(floor(pp * 82.0 + 11.0) + 7.0));
      float cover = clamp(here * peb + here2 * peb2 * 0.9, 0.0, 1.0);

      // 粒ごとの色。
      //
      // 玉砂利は 1 粒ずつ色が違う。白っぽい石、灰色の石、茶や黒が
      // 混じっているから砂利に見える。色の幅が狭いと、同じ大きさの
      // 円盤が並んでいるようにしか見えず、硬貨を撒いたようになる。
      float pid = hash12(floor(pp * 38.0));
      float pid2 = hash12(floor(pp * 82.0 + 11.0));
      vec3 soil = mix(vec3(0.052, 0.044, 0.034), vec3(0.098, 0.085, 0.065), coarse);
      // 白・灰・茶・黒の 4 系統から引く
      vec3 stone = pid < 0.30 ? vec3(0.235, 0.228, 0.205)      // 白っぽい石
                 : pid < 0.62 ? vec3(0.145, 0.142, 0.132)      // 灰色の石
                 : pid < 0.86 ? vec3(0.125, 0.098, 0.068)      // 茶の石
                              : vec3(0.058, 0.055, 0.052);     // 黒い石
      stone *= 0.80 + 0.40 * fract(pid * 37.0);
      vec3 stone2 = mix(vec3(0.092, 0.086, 0.074), vec3(0.182, 0.172, 0.148), pid2);
      vec3 gravelCol = mix(mix(soil, stone, peb), stone2, here2 * peb2 * 0.55);
      gravelCol *= 0.86 + 0.28 * grit;
      gravelCol = mix(gravelCol, soil * 0.72, cav * 0.55);

      vec3 base = mix(slab, gravelCol, cover);
      // 目地は最後に落とす。砂が溜まっていても、凹んでいるぶんは必ず暗い
      base = mix(base, vec3(0.055, 0.048, 0.038), joint * 0.80 * (1.0 - cover * 0.45));

      // 踏まれて土埃が擦り込まれる。目地のまわりがいちばん黒い
      base = grime(base, joint * 0.8 + (1.0 - cover) * 0.2, vec3(0.045, 0.038, 0.028), 0.45);

      // 舟と器のまわりは水が跳ねて濡れている
      float ring = outerDist(pp);
      float wet = clamp((1.0 - smoothstep(0.0, 0.30, ring)) * 0.75
                      + smoothstep(0.54, 0.82, fbm(pp * 1.6 + 7.0)) * 0.45, 0.0, 1.0);
      base *= 1.0 - wet * 0.40;

      // 粒の谷は空が見えないので、環境光だけを落とす。
      // 直射まで落とすと、谷が日向でも真っ黒になる
      float ao = 1.0 - cav * 0.86 * cover;    // 粒の間の影を深く
      ao *= 1.0 - joint * 0.45;                      // 目地は空が見えにくい
      // 粗さは面内で変わる。踏まれて磨けた石畳はつるりとして、砂利はざらつく
      float rough = mix(mix(0.26, 0.48, dish), mix(0.78, 0.46, peb), cover);

      // 法線は細かい方の高さだけから取る。粒の形は陰影で足りていて、
      // worley をもう 3 回引く価値はない
      // 法線。砂利の粒の丸みと、目地の落ち込み
      // 法線。粒の丸みは控えめに。強くすると、砂利ではなく
      // 梱包用の緩衝材のように粒が立って見える
      float e = 0.0050;
      float hs = gravel(pp + vec2(e, 0.0), 38.0, cav) - peb;
      float hz = gravel(pp + vec2(0.0, e), 38.0, cav) - peb;
      // 粒の縁に強い法線を立てると、石ではなく鱗や硬貨が並んで見える。
      // 真上から見える砂利は「平らな天面」が並んだもので、粒を分けて
      // いるのは縁の照りではなく、粒と粒の間に落ちる影のほう
      vec3 n = normalize(vec3(-hs * 0.11 * cover, 1.0, -hz * 0.11 * cover));

      float sh = groundShadow(p);
      vec3 sky = skyColor(reflect(d, n));
      base = base * (uSunColor * max(dot(n, uSunDir), 0.0) * sh
                   + skyAmbient(n) * contactAO(p) * ao
                   + (lanternLight(p, n) + lanternAmbient(p)) * contactAO(p) * ao)
           + ggx(n, -d, uSunDir, rough, vec3(0.035)) * uSunColor * PI * sh * 0.5
           + clearcoat(n, -d, uSunDir, wet, uSunColor * sh, sky) * 0.55;
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
uniform sampler2D uFishShadow;   // 焼いておいた金魚の影
uniform vec2 uShadowArea;
uniform int uFishCount;
uniform float uDepth;
uniform float uBowlRim;
uniform vec3 uBowlPos;
uniform float uGroundY;
uniform float uRimTop2;
#define TANK_RIM uRimTop2
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
    // 水色のポリエチレンのトレー（トロ舟）。縁日の金魚すくいで一番多い。
    //
    // プラスチックに見える手掛かりは三つ。型で付いた細かい梨地、
    // 擦れて白く粉を吹いた傷、それに地の色がどこまでも均一なこと。
    // 木やシートと違って、むらが無いことそのものが手掛かりになる。
    //
    // 水の線には必ず緑の膜と白い水垢が付く。これが無いと、
    // 下ろしたてのトレーに見えて、縁日の匂いがしない。

    // 面ごとの座標。
    //
    // 底は xz でよいが、内壁は垂直な面なので xz だけで模様を取ると
    // 高さ方向にまったく変化せず、のっぺりした帯になる。
    // 壁では「壁に沿った横の距離」と「高さ」で取る。
    vec2 surf = region == 0 ? vW.xz
              : (abs(N.x) > abs(N.z) ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y));

    // 梨地。型のシボ。細かく、起伏は低い
    float grain = fbm(surf * 520.0);
    // 擦り傷。ポリエチレンは擦れると白化する。
    //
    // 以前はここを 52 : 6 まで引き伸ばしていた。引き伸ばした側の周期が
    // 17cm もあるので、細い傷ではなく幅 2cm の帯が舟じゅうに並び、
    // 水越しに見ると水面に縞が入っているようにしか見えなかった。
    // 傷は 1mm 級でよく、代わりに本数を増やす
    float scuff = scratch(surf, 0.45, 1.3) * 0.7 + scratch(surf, -0.9, 0.8) * 0.3;
    // 日に焼けた色あせ
    float fade = fbm(surf * 2.6);

    vec3 poly = vec3(0.088, 0.252, 0.330);
    vec3 base = poly * (0.88 + 0.18 * fade) * (0.97 + 0.06 * grain);
    base = mix(base, base * 0.52 + vec3(0.26, 0.30, 0.31), scuff * 0.46);
    // 梨地を目に見える濃さで出す。3% では何も見えない
    base *= 0.90 + 0.20 * grain;
    if(region == 1) base *= 1.06;     // 壁は斜めで暗くなりがちなので素地を上げる

    // 水際の緑。水面からわずかに下に帯で付く
    float algae = (1.0 - smoothstep(0.0, 0.030, abs(vW.y + 0.012)))
                * smoothstep(0.35, 0.68, fbm(vec2((vW.x + vW.z) * 22.0, vW.y * 40.0)));
    base = mix(base, vec3(0.072, 0.102, 0.048), algae * 0.70);
    // 底の隅には沈んだ汚れが溜まる
    // 壁が傾いているので、内寸はその高さで測る
    float corner = smoothstep(0.10, 0.004, tankIn(vW.xz - uTankDraft * vW.y));
    base *= 1.0 - corner * 0.22;

    // 一夏使ったトレーの汚し。
    //
    // 隅の垢は底にだけ効かせる。corner は「内寸の境からの距離」なので、
    // 壁の上ではどこでも 1 になる。壁にも掛けていたら、内壁が一枚まるごと
    // 黒く沈んでいた
    if(region == 0) base = grime(base, corner, vec3(0.026, 0.035, 0.028), 0.55);
    if(region == 1){
      // 内壁。水位が下がった跡が縦に残る
      float down = clamp((TANK_RIM - vW.y) / 0.19, 0.0, 1.0);
      base = mix(base, vec3(0.040, 0.055, 0.042), runStain(surf, down) * 0.38);
    }


    vec3 bn = normalize(vec3((grain - 0.5) * 0.10, 1.0, (fade - 0.5) * 0.05));
    float tarpAO = 0.88 + 0.12 * grain;
    vec3 tarpT = normalize(vec3(1.0, 0.0, 0.0));

    if(uUnderwater == 1){
      float below = max(-vW.y, 0.0);                // 水面からの深さ
      float face = region == 0 ? 1.0 : 0.5;         // 壁は斜めなので弱める
      // マスクは 0 ではなく 1 へ寄せる。0 に寄せると、外周で直射光ごと
      // 消えて、太陽と無関係な紺色の額縁が四辺に出る
      vec2 entry = vW.xz + uSunHoriz * below * uRefrTan;
      vec3 caus = mix(vec3(1.0), caustics(vW.xz, below), edgeMask(entry) * face);

      vec3 sun = underSun(bn) * caus * wallShade(entry);
      vec3 amb = (underAmbient(bn) + underLantern(vW, bn)) * tarpAO;
      col = base * (sun + amb);
      // 塩ビは濡れているので、織り目に沿って照りが伸びる
      // ポリエチレンは半艶。織り目が無いので照りは等方で、やや広い
      col += ggx(bn, V, underSunDir(), 0.30, vec3(0.042))
           * uSunColor * PI * 0.22 * caus;

      // 金魚の影。先に 1 枚へ焼いてあるので、ここは読むだけ
      col *= 1.0 - texture(uFishShadow, vW.xz / (uShadowArea * 2.0) + 0.5).r;
    } else {
      // 水の上に出ている内壁。濡れて黒く光る
      // 水から出ている内壁。水位が下がったばかりで濡れているので、
      // 乾いた所より暗く、照りが強い。暗くしすぎると黒い帯になる
      col = base * 0.80 * (uSunColor * max(dot(bn, uSunDir), 0.0) * 0.6 + skyAmbient(bn)
                         + lanternLight(vW, bn) + lanternAmbient(vW));
      col += ggx(N, V, uSunDir, 0.18, vec3(0.04)) * uSunColor * 0.6 * PI;
    }
  } else if(region >= 4){
    // 手元の器。白磁に藍の線
    if(region == 6){
      // 器の水面。舟と同じ考えで、反射より「水の色と透けぐあい」で見せる
      float F = fresnelSchlick(max(dot(N, V), 0.0), 0.02);
      vec3 refl = skyColor(reflect(-V, N));
      // 水の身。浅いので薄く
      vec3 body = vec3(0.030, 0.115, 0.150) * (skyAmbient(N) * 1.2 + uSunColor * 0.30
                                               + lanternAmbient(vW) * 1.4);
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
    // 使い込んだ器。貫入に茶渋が入り、糸底の近くは土埃で曇る
    cer = grime(cer, craze, vec3(0.145, 0.105, 0.062), 0.65);
    cer = mix(cer, vec3(0.195, 0.175, 0.145),
              (1.0 - smoothstep(uBowlRim - 0.075, uBowlRim - 0.040, vW.y)) * 0.30 * uWear);
    cer = mix(cer, cer * 0.70 + vec3(0.16), scratch(bp * 0.05, 1.1, 0.9) * 0.22);
    if(region == 5){
      cer *= 0.80;
      // 水に浸かっている所は水の色を帯びる。白磁のままだと水が入って見えない
      if(vW.y < uBowlRim - 0.020) cer = mix(cer, vec3(0.075, 0.215, 0.265), 0.62);
    }
    col = cer * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N)
               + lanternLight(vW, N) + lanternAmbient(vW))
        + ggx(N, V, uSunDir, 0.085, vec3(0.055)) * uSunColor * PI;
  } else {
    // 縁と外側。内側と同じ一枚のトレー。
    //
    // 樹脂の成形品だと分かるのは、縁が丸く巻いてあること、外壁に
    // 補強の横リブが通っていること、そして角に型の合わせ目が残ること。
    // 木と違って継ぎ目が無く、全部ひと続きなのが効く。
    vec2 surf2 = region == 2 ? vW.xz
               : (abs(N.x) > abs(N.z) ? vec2(vW.z, vW.y) : vec2(vW.x, vW.y));
    float grain2 = fbm(surf2 * 520.0);
    float fade2 = fbm(surf2 * 2.2 + 5.0);
    float scuff2 = scratch(surf2, 0.0, 1.2);

    vec3 poly2 = vec3(0.105, 0.300, 0.395);
    // 外に出ている面は日に焼けて白茶ける
    vec3 wood = poly2 * (0.80 + 0.26 * fade2) * (0.97 + 0.06 * grain2);
    wood = mix(wood, wood * 0.50 + vec3(0.28, 0.31, 0.32), scuff2 * 0.40);
    wood *= 0.90 + 0.20 * grain2;

    // 外壁の横リブ。等間隔に通る補強の筋
    if(region == 3){
      float rib = cos((vW.y - uGroundY) * 185.0);
      float ribFade = 1.0 - smoothstep(0.0025, 0.010, fwidth(vW.y) * 29.0);
      wood *= 1.0 + rib * 0.085 * ribFade;
      // 底に向かって一段すぼまる。成形品の抜き勾配
      wood *= 0.92 + 0.14 * smoothstep(uGroundY, uGroundY + 0.10, vW.y);
    }

    // 角の型合わせ目。縦に一本だけ細く入る
    vec2 q = abs(vW.xz) - uTankHalf - uTankDraft * vW.y;
    float miter = 1.0 - smoothstep(0.0, 0.0030, abs(q.x - q.y));
    float onRim = step(0.0, min(q.x, q.y));
    wood *= 1.0 - miter * onRim * 0.26;

    if(region == 2){
      // 縁は丸く巻いてある。光が乗って一本の筋になる
      wood *= 1.10;
      float di = tankIn(vW.xz - uTankDraft * vW.y);
      vec2 doo = abs(vW.xz) - uTankOuter2;
      float edge = max(1.0 - smoothstep(0.0, 0.007, abs(di)),
                       1.0 - smoothstep(0.0, 0.007, abs(max(doo.x, doo.y))));
      wood *= 1.0 + 0.26 * edge;
      // 内側のきわには水垢の白い線が残る
      float scale = 1.0 - smoothstep(0.0, 0.012, abs(di));
      wood = mix(wood, vec3(0.26, 0.265, 0.255), scale * 0.26);
    }

    // 水の跳ねた跡。乾くと白い輪が残る
    float splash = smoothstep(0.52, 0.80, fbm(vW.xz * 7.0 + 5.0));
    wood = mix(wood, wood * 0.80 + vec3(0.10, 0.11, 0.11), splash * 0.35);
    // 外壁を伝って下りた水の跡。下へ行くほど広がって薄れる
    float down3 = clamp((TANK_RIM - vW.y) / 0.21, 0.0, 1.0);
    wood = mix(wood, vec3(0.044, 0.052, 0.048), runStain(surf2, down3) * 0.50);
    // 乾いた水垢の輪
    // 乾いた水滴の輪。大きく出すと白いレース模様になるので、
    // 1cm 級の小さな輪をまばらに置く
    // 乾いた水滴。輪で出すと網目模様になるので、まばらな白い粉として置く
    float spot = smoothstep(0.70, 0.90, fbm(vW.xz * 190.0 + 17.0)) * uWear;
    wood = mix(wood, wood * 0.70 + vec3(0.22, 0.225, 0.215), spot * 0.30);
    // 地面に近いほど土埃をかぶる
    wood = mix(wood, vec3(0.085, 0.074, 0.058),
               (1.0 - smoothstep(uGroundY, uGroundY + 0.07, vW.y)) * 0.55 * uWear);
    // 擦り傷。立てかけたり引きずったりで、横向きに付く
    wood = mix(wood, wood * 0.62 + vec3(0.18, 0.20, 0.20), scratch(surf2 * 1.7 + 9.0, 1.1, 0.8) * 0.22);

    // 下へ行くほど地面の照り返ししか届かない
    float toGround = smoothstep(uGroundY, uGroundY + 0.14, vW.y);
    float woodAO = 0.86 + 0.14 * grain2;
    float wwet = splash * (0.45 + 0.55 * (1.0 - toGround));

    col = wood * (uSunColor * max(dot(N, uSunDir), 0.0)
                + skyAmbient(N) * (0.35 + 0.65 * toGround) * woodAO
                + lanternLight(vW, N) + lanternAmbient(vW) * woodAO)
        + ggx(N, V, uSunDir, 0.34, vec3(0.042)) * uSunColor * PI * 0.30
        + lanternSpec(vW, N, V, 0.34, vec3(0.042)) * 0.5
        + clearcoat(N, V, uSunDir, wwet, uSunColor, skyColor(reflect(-V, N)));
    col *= 0.62 + 0.38 * toGround;
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
  // 格子は四角いので、角の R からはみ出した頂点を丸みの上へ寄せる。
  // そうしないと、角で水が舟の外へこぼれる
  vec2 p = tankClamp((aUv * 2.0 - 1.0) * uTankHalf);
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
  for(int i = 0; i < 2; i++){
    float t = 0.026 + 0.048 * float(i);
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
  // 3 点でならす。5 点から減らしたのは、1 画素あたりのテクスチャ引きが
  // そのまま効くため。斜めに 2 点取れば、十分に細かい波は落ちる
  vec2 slopeR = (slopeAt(vP)
               + slopeAt(vP + vec2(SMOOTH, SMOOTH * 0.7))
               + slopeAt(vP - vec2(SMOOTH, SMOOTH * 0.7))) * 0.3333 * vEdge;
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
  // 粗さの下限は「格子で表せていないさざ波の傾き分散」。
  //
  // ここを 0.00013（α ≈ 0.107）に置いていた。外洋の凪の実測値だが、
  // たらいの水にそのまま当てると広すぎる。平らな水面に映る太陽は
  // 本来ほとんど点なのに、幅 6° のローブが 80cm の舟をまたいで、
  // 水面の一帯がぼんやり明るくなっていた。
  // 波を止めて撮り比べると、この項だけで右半分の靄が消える。
  // ただし絞りすぎると今度は尖りすぎて、頭打ちに貼り付いた白い筋が
  // ガラスの引っかき傷のように出る。たらいのさざ波に見合う
  // α ≈ 0.05 のあたりで、粒に割れつつ潰れない
  float a2 = 0.0000062 + (dot(dsx, dsx) + dot(dsy, dsy)) * 0.45;
  float rough = sqrt(sqrt(a2));
  // ggx() の D は 1/π を持つので、ランバート側と揃えるため π を掛け戻す
  //
  // 頭打ちは低く取る。ここを 0.30 にしていたら、きらめくはずの範囲が
  // まるごと上限に貼り付いて、平らな灰色の板になっていた。
  // 画素を測ると、飽和は 0% なのに一帯が 220 前後の無彩色になっていて、
  // 「白飛び」ではなく「頭打ちの平野」だと分かった。
  // 1 枚の板にするくらいなら、数画素の粒が散るほうが水に見える
  col += min(ggx(N, V, uSunDir, rough, vec3(0.02)) * uSunColor * PI, vec3(0.26));
  // 提灯の照り返し。夜はこれが水面の主役になる
  col += min(lanternSpec(vW, N, V, rough, vec3(0.02)), vec3(0.55));

  // 水際の明るい線
  // 水際の明るい線。壁ぎわで水が薄くなって、底の色が透けるぶん。
  // ここを定数で足していたら、夜になって周りが真っ暗になったときだけ
  // 残り、舟のまわりが白く光る輪になっていた。周りの明るさに比例させる
  col += vec3(0.06, 0.10, 0.13) * pow(1.0 - vEdge, 2.2) * 0.5
       * (skyAmbient(vec3(0.0, 1.0, 0.0)) + lanternAmbient(vW)) * 3.0;

  frag = vec4(col, 1.0);
}`;
