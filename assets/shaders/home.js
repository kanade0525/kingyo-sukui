// 家の縁側と、ガラスの金魚鉢。
//
// 屋台とは別に書いてある。FS_SKY は「参道の玉砂利と花崗岩の切石と
// 舟のきわの濡れ」に 130 行を割いた縁日専用のシェーダで、家には使えない。
// 代わりに、材質の道具（NOISE / MATERIAL / SKYLIB / AMBIENT）は全部使い回す。

import { HEAD, NOISE, SKYLIB, MATERIAL, AMBIENT } from './common.js?v=202610042356';

/**
 * 縁側。
 *
 * 作るのは三つだけ。板の間（鉢の載る床）、奥の柱と障子、外の庭。
 * カメラは左右 ±60 度までしか回らないので、後ろ側は作らない。
 *
 * 主役は鉢なので、背景は作り込まない。ただし「板の間に置いてある」
 * ことだけは伝わらないといけないので、木目と、鉢の落とす影は入れる。
 */
export const FS_ROOM = `${HEAD}
${NOISE}
${SKYLIB}
${MATERIAL}
in vec2 vNdc;
uniform vec3 uCam;
uniform vec3 uRight;
uniform vec3 uUp;
uniform vec3 uFwd;
uniform float uTanHalf;
uniform float uAspect;
uniform float uFloorY;
uniform float uTime;
out vec4 frag;

/** 鉢の落とす影。鉢は丸いので、円ひとつで足りる */
float jarShadow(vec2 p){
  float d = length(p);
  // 接地のきわが濃い。離れるほど広がって薄れる
  return 1.0 - smoothstep(0.055, 0.155, d) * 0.62;
}

void main(){
  vec3 d = normalize(uFwd + uRight * (vNdc.x * uTanHalf * uAspect) + uUp * (vNdc.y * uTanHalf));

  vec3 col;
  if(d.y < -0.002){
    // ---- 板の間 ----
    float t = (uFloorY - uCam.y) / d.y;
    vec3 p = uCam + d * t;

    // 杉の縁甲板。幅 10.5cm の板を並べる。木目は板の向きに走る
    float board = floor(p.x / 0.105);
    float across = fract(p.x / 0.105);
    float seam = 1.0 - smoothstep(0.0, 0.035, min(across, 1.0 - across));
    float id = hash12(vec2(board, 3.0));

    // 木目。年輪が板の長手に沿って流れる
    float grain = fbm(vec2(p.x * 26.0, p.z * 2.2) + id * 40.0);
    float ring = fbm(vec2(p.x * 95.0, p.z * 5.0) + id * 11.0);
    vec3 light = vec3(0.172, 0.118, 0.068);
    vec3 dark  = vec3(0.098, 0.062, 0.034);
    col = mix(light, dark, grain * 0.75 + ring * 0.25);
    // 板ごとに色が振れる
    col *= 0.86 + 0.28 * id;
    // 継ぎ目は落ち込んで暗い
    col *= 1.0 - seam * 0.55;
    // 節。たまに入る
    float knot = smoothstep(0.80, 0.95, fbm(vec2(p.x * 7.0, p.z * 1.4) + id * 70.0));
    col = mix(col, col * 0.42, knot * 0.7);

    // 踏まれて磨けている。歩く筋だけ艶が出る
    float worn = smoothstep(0.62, 0.20, abs(p.z + 0.35));
    col = grime(col, (1.0 - worn) * 0.5, vec3(0.040, 0.028, 0.016), 0.35);

    vec3 n = vec3(0.0, 1.0, 0.0);
    float sh = jarShadow(p.xz);
    // 縁側は庇の下だが、庭からの照り返しで明るい。
    // 屋内だからと落としすぎると、真昼でも夜のような絵になる
    col *= uSunColor * 0.52 * sh + skyAmbient(n) * 1.8 * sh
         + lanternLight(p, n) + lanternAmbient(p) * 1.2;
    // 拭き込まれた板は照る。磨けた筋ほど強い
    col += ggx(n, -d, uSunDir, mix(0.42, 0.18, worn), vec3(0.035))
         * uSunColor * PI * 0.35 * sh;
    col += lanternSpec(p, n, -d, mix(0.42, 0.18, worn), vec3(0.035)) * 0.8;

    // 遠くは霞む
    col = mix(col, uSkyGround * 0.6, smoothstep(1.2, 4.0, t));
  } else {
    // ---- 奥。障子と、その向こうの庭 ----
    // 庭は作り込まない。緑をぼかして置くだけ。主役は鉢
    float up = clamp(d.y, 0.0, 1.0);
    vec3 garden = mix(vec3(0.052, 0.078, 0.034), vec3(0.086, 0.118, 0.052),
                      fbm(d.xz * 9.0) * 0.7 + 0.3);
    garden *= uSunColor * 0.30 + skyAmbient(vec3(0.0, 1.0, 0.0)) * 0.9;
    vec3 sky = mix(uSkyHorizon, uSkyZenith, pow(up, 0.5));
    col = mix(garden, sky, smoothstep(0.06, 0.34, d.y));

    // 障子。画面の上のほうを覆う。和紙を透かした光
    float shoji = smoothstep(0.18, 0.40, d.y);
    vec2 h = d.xz * (1.4 / max(d.y, 0.02));
    // 桟。縦 6 本・横 4 本
    float barX = 1.0 - smoothstep(0.0, 0.012, abs(fract(h.x * 4.2) - 0.5) * 0.24);
    float barY = 1.0 - smoothstep(0.0, 0.012, abs(fract(d.y * 7.0) - 0.5) * 0.14);
    vec3 paper = vec3(0.240, 0.228, 0.198) * (0.90 + 0.16 * fbm(h * 30.0));
    paper *= 1.0 - max(barX, barY) * 0.45;
    paper *= uSunColor * 0.16 + skyAmbient(vec3(0.0, 0.0, 1.0)) * 1.3
           + lanternAmbient(uCam) * 1.6;
    col = mix(col, paper, shoji);
  }
  frag = vec4(col, 1.0);
}`;

/**
 * ガラスの金魚鉢。
 *
 * 屈折は屋台の水面と同じ手。鉢の中身を別の板へ描いておき、
 * ガラスの面で法線から屈折ベクトルを出して、そこを読み直す。
 *
 * 二重屈折（入る面と出る面）はやらない。得られる絵に対して重すぎる。
 * 外面で 1 回曲げ、厚みぶんの緑と縁の照りで厚みを見せる。
 */
export const VS_JAR = `${HEAD}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aRegion;
uniform mat4 uVP;
uniform vec3 uCam;
out vec3 vW;
out vec3 vN;
out float vRegion;
out float vDist;
void main(){
  vW = aPos;
  vN = aNrm;
  vRegion = aRegion;
  vDist = distance(aPos, uCam);
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

export const FS_JAR = `${HEAD}
${NOISE}
${SKYLIB}
${MATERIAL}
${AMBIENT}
in vec3 vW;
in vec3 vN;
in float vRegion;
in float vDist;
uniform vec3 uCam;
uniform sampler2D uScene;   // 鉢の中身。α にカメラからの距離
uniform vec2 uRes;
uniform vec4 uJar;          // 外径, 高さ, 口径, 底径
uniform float uWall;
uniform float uWaterY;
uniform float uTime;
/**
 * どちらの段か。
 *   0 = 鉢の中身（砂利・水面・内壁）を別の板へ描く
 *   1 = ガラスの外側。中身を屈折して読み直し、1 枚で仕上げる
 *
 * 屋台の水面と同じ作り。中身を本パスにも描くと、素の像とガラス越しの
 * 像が二重に重なって、曇りガラスのように見える。
 */
uniform int uPass;
out vec4 frag;

void main(){
  int region = int(vRegion + 0.5);
  // 段ごとに、担当しない面は捨てる
  if(uPass == 0 && region == 7) discard;
  if(uPass == 1 && region != 7) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec2 uv = gl_FragCoord.xy / uRes;

  if(region == 8){
    // ---- 底の砂利。鉢の中なので、水の色を帯びる ----
    vec2 g = vW.xz * 150.0;
    float cav;
    float peb = gravel(g, 1.0, cav);
    float pid = hash12(floor(g));
    vec3 stone = pid < 0.34 ? vec3(0.180, 0.172, 0.158)
               : pid < 0.68 ? vec3(0.118, 0.108, 0.092)
                            : vec3(0.070, 0.064, 0.058);
    vec3 col = mix(vec3(0.052, 0.048, 0.040), stone, peb);
    col *= 1.0 - cav * 0.55;
    vec3 n = vec3(0.0, 1.0, 0.0);
    // 鉢は四方から光が入る。舟の底のように上からだけではない
    col *= underSun(n) * 0.9 + underAmbient(n) * 2.2 + underLantern(vW, n) * 1.4;
    frag = vec4(col, vDist);
    return;
  }

  // 内側の殻は描かない。
  //
  // ここを不透明な壁として描いていたら、鉢の中が真っ黒な球になった。
  // ガラスの鉢は向こう側も透けていて、鉢越しに部屋が見える。
  // 中身の板には先に部屋を敷いてあるので、何も描かなければそれが残る。
  if(region == 10) discard;

  if(region == 9){
    // ---- 鉢の中の水面。上から覗くと見える ----
    // ゆるい正弦 2 本。小さい鉢なので大きくは揺れない
    float w = sin(vW.x * 120.0 + uTime * 1.3) * 0.5 + sin(vW.z * 97.0 - uTime * 1.1) * 0.5;
    vec3 n = normalize(vec3(-w * 0.03, 1.0, -w * 0.024));
    float F = fresnelSchlick(clamp(dot(n, V), 0.0, 1.0), 0.02);
    vec3 refl = envSpec(reflect(-V, n), 0.06) + lanternOrbs(reflect(-V, n), vW);
    vec3 body = vec3(0.028, 0.098, 0.122) * (skyAmbient(n) * 1.1 + uSunColor * 0.22
                                             + lanternAmbient(vW) * 1.3);
    vec3 col = body + refl * F;
    col += min(ggx(n, V, uSunDir, 0.07, vec3(0.02)) * uSunColor * PI, vec3(0.30));
    frag = vec4(col, vDist);
    return;
  }

  // ---- ガラス ----
  //
  // 見え方を作るのは四つ。フレネル、厚みぶんの緑、映り込み、そして
  // 屈折のずれ。曲面なので、横から見ると向こう側の金魚が大きく歪む。
  // これが丸鉢のいちばんの特徴で、これさえ出れば足りる。
  bool outer = dot(N, V) > 0.0;
  vec3 Nf = outer ? N : -N;

  // 屈折。空気（1.0）からガラス（1.52）へ入る分だけ曲げる。
  // 画面の上でどれだけずらすかは、面の傾きにそのまま比例させる
  vec3 R = refract(-V, Nf, 1.0 / 1.52);
  // 曲げる量。水の中はガラスと水の二重で大きく曲がり、
  // 空気の層ではガラスの厚みぶんしか曲がらない
  float underEarly = smoothstep(uWaterY + 0.002, uWaterY - 0.002, vW.y);
  vec2 off = R.xy * mix(0.022, 0.105, underEarly) * (1.0 - ndv * 0.55);
  vec2 suv = clamp(uv + off, vec2(0.002), vec2(0.998));
  vec3 inside = texture(uScene, suv).rgb;

  // 水面より下か。
  //
  // 鉢いっぱいに水が入っているわけではない。口の下に空気の層がある。
  // ここを分けないと、鉢ぜんぶが水のように見えるか、逆に
  // どこにも水が無いように見えるかのどちらかになる
  float under = smoothstep(uWaterY + 0.0016, uWaterY - 0.0016, vW.y);

  // 水を通る距離。
  //
  // 真正面から覗くと鉢の差し渡しぶん、縁をかすめるとほとんど通らない。
  // 水は赤から先に吸うので、長く通るほど青緑に沈む
  float path = uJar.x * 2.0 * ndv * under;
  // 実際の水の吸収は、20cm ではほとんど効かない（赤でも 1 割ほど）。
  // 3.4 で入れていたら、鉢の水が泥のような緑に濁った。
  // 水に見せているのは色ではなく、水面の線と屈折のほう。
  // 少しだけ誇張して、ほんのり青緑に寄せる程度に留める
  inside *= exp(-vec3(1.05, 0.20, 0.09) * path);
  // 水そのものが散らす分。奥ほど淡く霞む
  inside += vec3(0.012, 0.040, 0.048) * (1.0 - exp(-path * 6.0))
          * (skyAmbient(vec3(0.0, 1.0, 0.0)) * 1.1 + lanternAmbient(vW) * 1.4);

  // ガラスの厚み。斜めに貫くほど光路が長い。ソーダ石灰ガラスの断面は緑
  float thick = uWall / max(ndv, 0.12);
  inside *= exp(-vec3(0.9, 0.25, 0.7) * thick * 26.0);

  // 映り込み
  vec3 Rr = reflect(-V, Nf);
  vec3 refl = envSpec(Rr, 0.03) + lanternOrbs(Rr, vW);
  float F = fresnelSchlick(ndv, 0.04);

  vec3 col = mix(inside, refl, F);

  // 水面の線。
  //
  // ガラスと水と空気が出会う所。水の膜がガラスを這い上がるので、
  // ここだけ細く明るい筋になる。これが無いと、水が入っているのか
  // 空っぽなのか見分けがつかない
  float line = smoothstep(0.0030, 0.0, abs(vW.y - uWaterY));
  col += vec3(0.26, 0.30, 0.30) * line
       * (skyAmbient(vec3(0.0, 1.0, 0.0)) * 1.4 + uSunColor * 0.25 + lanternAmbient(vW));

  // 縁の照り。ガラスは縁がいちばん光る
  col += min(ggx(Nf, V, uSunDir, 0.035, vec3(0.05)) * uSunColor * PI, vec3(0.9));
  col += min(lanternSpec(vW, Nf, V, 0.035, vec3(0.05)) * 1.2, vec3(0.6));

  // ガラスは 1 枚で仕上げる。混ぜない。
  // 中身は uScene から読み直しているので、ここで下地を透かす必要がない
  frag = vec4(col, 1.0);
}`;
