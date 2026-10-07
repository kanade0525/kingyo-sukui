// ミドリガメ（ミシシッピアカミミガメ）。
//
// 金魚と同じで、形は頂点シェーダの中で作る。(u, v, 部位) だけを頂点に持たせ、
// 甲羅・手足・頭を同じ関数の別の枝として書く。
//
// 真上から見たときの手がかりは、甲羅の鱗板の割れ方と、四肢の漕ぐ動き、
// それに目の後ろの赤い斑。この三つが揃うと一目でミドリガメになる。

import { HEAD, NOISE, SKYLIB, AMBIENT, WATERLIB, CAUSTICS } from './common.js?v=202610070209';

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
  // 前の縁は切れ上がっている。首の出る所
  return r * (1.0 - 0.055 * c) * (1.0 - 0.10 * max(c, 0.0));
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
    // 背甲と腹甲。中心 v=0、縁 v=1。
    //
    // 背甲の縁を y=+0.029、腹甲の縁を y=0 に置いていたので、
    // 甲羅のまわりに 3mm ほどの隙間が一周していた。カメの甲羅は
    // 背甲と腹甲が橋でつながった閉じた箱で、開いているのは
    // 頭と四肢と尾の出る所だけ。縁の高さを揃えて閉じる。
    //
    // 高さも足りていなかった。甲長に対する甲高は 0.19 しかなく、
    // 皿を伏せたような形になっていた。子ガメで 0.38 前後ある
    float th = u * TAU;
    float rr = v;
    float R = shellR(th);
    float dome = 0.325 * pow(max(1.0 - rr * rr, 0.0), 0.72);
    float belly = -0.070 * (1.0 - rr * rr);
    float y = part == 0 ? dome : belly;
    return vec3(cos(th) * R * rr, y, sin(th) * R * rr);
  }

  if(part == 6){
    // 頭と首。
    //
    // 太さの変わらない筒を前へ伸ばし、先を塞いでいなかったので、
    // 横から見ると切り口の空いた管が甲羅から突き出していた。
    // 首は細く、頭でふくらみ、鼻先ですぼまって閉じる。
    // 甲羅から出るので、付け根は甲羅の中に埋める
    float s = u, ang = v * TAU;
    float swell = smoothstep(0.30, 0.66, s);          // 頭のふくらみ
    float snout = 1.0 - smoothstep(0.78, 1.0, s) * 0.92;  // 鼻先ですぼまる
    float rr = mix(0.058, 0.096, swell) * snout;
    float reach = 0.30 + 0.46 * s;
    // 低く前へ出す。持ち上げると背甲を突き抜ける
    float lift = 0.012 + 0.052 * smoothstep(0.0, 0.75, s);
    // 顎のほうが平たい。真円の棒は蛇に見える
    return vec3(reach, lift + cos(ang) * rr * 0.78, sin(ang) * rr * 1.04);
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
  vec3 root = vec3(cos(th) * R, -0.028, sin(th) * R);
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
  if(part == 0 && n.y < 0.0) n = -n;          // 背甲は常に上向き
  if(part == 1 && n.y > 0.0) n = -n;          // 腹甲は常に下向き
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
    // 背甲。
    //
    // 「ミドリガメ」と呼ばれるのは、幼体の背甲が明るい緑だから。
    // 大人になるとくすんだ暗い色に変わる。ここに居るのは甲長 3cm の
    // 子ガメなので、暗い苔色ではなく、はっきりした緑に黄色の模様が入る
    float th = u * 6.2831853, rr = v;
    vec3 dark  = vec3(0.058, 0.118, 0.042);
    vec3 olive = vec3(0.135, 0.225, 0.070);
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
    // 筋は黄緑。真っ黄色で入れると、横から見たとき鉢の下半分が
    // 淡く抜けて、甲羅ではなく笠を伏せたように見える
    base = mix(base, vec3(0.185, 0.230, 0.078), swirl * 0.34 * (1.0 - seam));
    // 板の中の成長輪。縁ほど詰む
    base *= 0.94 + 0.10 * sin(rr * 46.0 + plate * 2.0);
    // 継ぎ目は溝なので暗い
    base *= 1.0 - seam * 0.62;
    // 縁甲板。
    //
    // 外周の 24% を明るい黄色で広く塗っていたので、横から見ると
    // ドームの下に黄色い皿が付いているようにしか見えず、
    // カメではなく空飛ぶ円盤になっていた。実物の黄色は縁の細い
    // 一周ぶんで、そこに黒い筋が割って入る
    // 半径で細く切っても直らない。甲羅は縁で急に落ちるので、
    // 半径のたった 5% が、横から見た高さの 29% を占めるため。
    // 色のほうを甲羅に寄せて、模様は黒い割りの筋で出す
    base = mix(base, vec3(0.148, 0.192, 0.060), smoothstep(0.88, 1.0, rr) * 0.60);
    base = mix(base, vec3(0.026, 0.032, 0.016),
               smoothstep(0.86, 1.0, rr)
             * smoothstep(0.50, 0.82, abs(fract(th / 6.2831853 * 12.0) - 0.5) * 2.0) * 0.70);
    gloss = 0.46;
  } else if(vPart == 1){
    // 腹甲。黄色の地に、板ごとに黒い斑が一つずつ乗る
    float th = u * 6.2831853, rr = v;
    base = vec3(0.420, 0.370, 0.125) * (0.90 + 0.18 * fbm(vUv * 9.0));
    float px = cos(th) * rr, pz = sin(th) * rr;
    float cell = abs(fract(px * 2.4) - 0.5) + abs(fract(pz * 2.2) - 0.5);
    base = mix(base, vec3(0.045, 0.040, 0.024), smoothstep(0.52, 0.22, cell) * 0.72);
    gloss = 0.22;
  } else if(vPart == 6){
    // 頭と首。暗い緑に細い黄色の縞が何本も走り、目の後ろに赤いライン。
    // この赤が「アカミミガメ」の名の由来で、いちばんの目印になる
    float ang = v * 6.2831853;
    base = vec3(0.060, 0.098, 0.048);
    // 縞は首から頭へ前後に走る。輪切りではない
    float stripe = 0.5 + 0.5 * sin(ang * 9.0 + sin(u * 2.4) * 0.8);
    base = mix(base, vec3(0.330, 0.320, 0.100), smoothstep(0.62, 0.95, stripe) * 0.85);
    // 鼻先と顎は黄色が勝つ
    base = mix(base, vec3(0.270, 0.255, 0.105), smoothstep(0.84, 1.0, u) * 0.5);
    // 目。頭のふくらみの上のほう、左右に一つずつ
    float eye = min(length(vec2((u - 0.78) * 1.8, v - 0.17)),
                    length(vec2((u - 0.78) * 1.8, v - 0.83)));
    base = mix(base, vec3(0.230, 0.200, 0.070), 1.0 - smoothstep(0.040, 0.052, eye));
    base = mix(base, vec3(0.014, 0.013, 0.010), 1.0 - smoothstep(0.022, 0.030, eye));
    // 耳のうしろの赤いライン。斑ではなく、後ろへ長く伸びる
    float red = min(length(vec2((u - 0.58) * 0.85, (v - 0.15) * 2.6)),
                    length(vec2((u - 0.58) * 0.85, (v - 0.85) * 2.6)));
    base = mix(base, vec3(0.430, 0.085, 0.040), (1.0 - smoothstep(0.045, 0.080, red)) * 0.92);
    gloss = 0.35;
  } else if(vPart == 7){
    // 尾。頭と同じ暗緑に黄色の縞
    base = vec3(0.062, 0.100, 0.050);
    base = mix(base, vec3(0.280, 0.265, 0.090),
               smoothstep(0.62, 0.95, 0.5 + 0.5 * sin(v * 6.2831853 * 6.0)) * 0.7);
  } else {
    // 四肢。甲羅より明るい緑に、細かい鱗
    float sc = 0.5 + 0.5 * sin(u * 34.0) * sin(v * 22.0);
    base = mix(vec3(0.062, 0.102, 0.050), vec3(0.105, 0.155, 0.062), sc);
    base *= 0.85 + 0.25 * fbm(vec2(u * 10.0, v * 6.0));
    // 四肢にも細い黄色の縞が前後に走る
    base = mix(base, vec3(0.300, 0.285, 0.095),
               smoothstep(0.66, 0.94, 0.5 + 0.5 * sin(v * 6.2831853 * 3.0 + u * 2.0)) * 0.6);
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
  // 上下の差。甲羅は背が日を受け、腹側は影になる。
  // 差が 1.4 倍しか無いと、丸みのある甲羅ではなく平たい板に見える
  vec3 col = base * lit * (0.62 + 0.52 * up);
  // 濡れた甲羅はよく照る
  col += ggx(N, V, underSunDir(), gloss, vec3(0.040)) * uSunColor * PI * 0.35;
  col += base * pow(1.0 - ndv, 4.0) * 0.10 * lit;

  frag = vec4(col, vDist);
}`;
