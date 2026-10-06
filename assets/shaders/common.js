// シェーダの共有部品。文字列として他のシェーダへ差し込む。
//
// fetch で .glsl を読む作りにしなかったのは、file:// で開いたときに黙って
// 動かなくなるのを避けるため。GLSL は JS の文字列のまま持つ。

export const HEAD = `#version 300 es
precision highp float;
precision highp int;
precision highp sampler2D;
precision highp samplerCube;
`;

/** 画面いっぱいの三角形。vUv は 0..1、vNdc は -1..1。 */
export const VS_FULL = `${HEAD}
layout(location=0) in vec2 aP;
out vec2 vUv;
out vec2 vNdc;
void main(){
  vUv = aP * 0.5 + 0.5;
  vNdc = aP;
  gl_Position = vec4(aP, 0.0, 1.0);
}`;

/** 値ノイズ。砂利、金魚の斑、紙の繊維に使う。 */
export const NOISE = `
float hash11(float p){ p = fract(p*0.1031); p *= p+33.33; p *= p+p; return fract(p); }
float hash12(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*0.1031);
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.x+p3.y)*p3.z);
}
vec2 hash22(vec2 p){
  vec3 p3 = fract(vec3(p.xyx)*vec3(0.1031,0.1030,0.0973));
  p3 += dot(p3, p3.yzx+33.33);
  return fract((p3.xx+p3.yz)*p3.zy);
}
float vnoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f*f*(3.0-2.0*f);
  return mix(mix(hash12(i), hash12(i+vec2(1,0)), f.x),
             mix(hash12(i+vec2(0,1)), hash12(i+vec2(1,1)), f.x), f.y);
}
float fbm(vec2 p){
  float s = 0.0, a = 0.5;
  for(int i=0;i<4;i++){ s += a*vnoise(p); p *= 2.03; a *= 0.5; }
  return s;
}
/** 砂利の粒。セルごとの距離場。 */
float worley(vec2 p){
  vec2 i = floor(p), f = fract(p);
  float d = 1e9;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = hash22(i+g);
    d = min(d, length(g + o - f));
  }
  return d;
}`;

/**
 * 素材の部品。
 *
 * 安っぽく見えるいちばんの原因は、どの素材にも同じ粒のノイズを一枚
 * かけているだけ、という作り。実物は「大きなむら・中くらいの構造・
 * 細かい粒」が重なっていて、しかも凹んだ所に汚れが溜まり、角が擦れて
 * 色が抜ける。そこまで入れて初めて物に見える。
 */
export const MATERIAL = `
/**
 * ブルーシートの織り目。平たいテープを縦横に編んだもの。
 *
 * 1 画素がテープ何本ぶんを覆っているかを見て、細かすぎるときは
 * 平らに均す。均さないと、遠い所で干渉縞（モアレ）が出る。
 */
float tarpWeave(vec2 p, out vec2 bump){
  const float PITCH = 620.0;            // テープ幅 1.6mm
  vec2 g = p * PITCH;
  float px = max(length(fwidth(g)), 1e-4);
  float fade = 1.0 - smoothstep(0.55, 1.5, px);
  vec2 f = fract(g), i = floor(g);
  float flip = mod(i.x + i.y, 2.0);     // 市松に上下が入れ替わる
  float bx = sin(f.x * PI), by = sin(f.y * PI);
  float h = mix(bx, by, flip);
  bump = mix(vec2(cos(f.x * PI), 0.0), vec2(0.0, cos(f.y * PI)), flip) * 0.9 * fade;
  return mix(0.5, h, fade);
}

/** 板目。年輪を、板の長手方向へ強く伸ばした同心の縞として作る。 */
float woodRings(vec2 p, float seed){
  // 年輪の中心を板の外に置くと、板目らしい緩い弧になる
  float r = length(vec2(p.y + 0.9 + seed, p.x * 0.085));
  r += fbm(p * vec2(1.8, 11.0) + seed) * 0.10;
  float t = fract(r * 23.0);
  // 夏目（広くて淡い）と冬目（細くて濃い）
  return smoothstep(0.0, 0.34, t) * (1.0 - smoothstep(0.52, 0.92, t));
}

/** 砂利。粒の中心ほど明るく、継ぎ目に影が溜まる。 */
/**
 * 石畳。神社の参道。
 *
 * 花崗岩の切石を目地を取って敷いたもの。石畳に見える手掛かりは三つで、
 * 「石ごとに色が違う」「目地が凹んで土が溜まる」「踏まれて中央が磨ける」。
 * この三つが無いと、ただの格子模様になる。
 *
 * 胞体の種を中心へ寄せると、丸い粒ではなく切り石の四角さが残る。
 * 参道の石は進む向きを横切る形に敷くので、セルは横長に取る。
 *
 * 戻り値は石肌の明るさ。joint に目地（1 が芯）、id に石ごとの乱数、
 * dish に中心からの距離（踏まれ具合）。
 */
float flagstone(vec2 p, out float joint, out float id, out float dish){
  vec2 q = p * vec2(1.0, 1.52);
  vec2 i = floor(q), f = fract(q);
  float d1 = 1e9, d2 = 1e9;
  vec2 best = i;
  for(int y=-1;y<=1;y++) for(int x=-1;x<=1;x++){
    vec2 g = vec2(float(x), float(y));
    vec2 o = 0.5 + (hash22(i + g) - 0.5) * 0.52;
    float d = length(g + o - f);
    if(d < d1){ d2 = d1; d1 = d; best = i + g; }
    else if(d < d2) d2 = d;
  }
  joint = 1.0 - smoothstep(0.0, 0.05, d2 - d1);
  id = hash12(best);
  dish = smoothstep(0.0, 0.40, d1);
  // 花崗岩の斑。白い長石と黒い雲母。細かすぎると画素より小さくなって
  // ちらつくので、1 画素に収まりだしたら消す
  float sp = fbm(p * 240.0);
  float keep = 1.0 - smoothstep(0.004, 0.016, fwidth(p.x));
  return 0.80 + (sp - 0.5) * 0.52 * keep;
}

/**
 * 砂利の粒。セルごとの距離場。
 *
 * 山なりの丸い盛り上がりにすると、砂利ではなく梱包用の緩衝材に見える。
 * 実際の玉砂利は、踏まれて平たい面を上に向けて並び、粒と粒の間だけが
 * すとんと落ちている。立ち上がりを急にして、頂上を平らにする。
 */
float gravel(vec2 p, float scale, out float cavity){
  // worley は「いちばん近い種までの距離」なので、粒の中心ほど小さく、
  // 粒と粒の境でいちばん大きい。
  //
  // ここで cavity を smoothstep(0.44, 0.14, d) と書いていた。これは
  // 距離が小さいほど 1 になる式なので、谷ではなく粒の天面を指している。
  // 呼び出し側はこれを遮蔽として暗く落としていたので、粒の真ん中が
  // いちばん暗くなり、砂利が硬貨やドーナツの並びに見えていた。
  //
  // 粒の天面は、胞体の縄張りいっぱいまで広げる。狭く取ると粒どうしが
  // 離れて、地の面が粒の間から覗く。砂利は敷き詰められているので、
  // 隣の粒とは接していて、間に残るのは細い割れ目だけ。
  float d = worley(p * scale);
  cavity = smoothstep(0.38, 0.56, d);         // 粒と粒の間の落ち込み
  return smoothstep(0.50, 0.36, d);           // 頂上は平ら、縁で急に落ちる
}

/** 角の擦れ。縁に近いほど 1。色が抜けた所を作るのに使う。 */
/* ----------------------------------------------------------------
 * ウェザリング（汚しと傷）
 *
 * 新品そのままの面が並ぶと、どれだけ質感を作り込んでも「CG で置いた物」
 * に見える。実物が実物に見えるのは、汚れが物の形に沿って出るから。
 * 乱数のノイズを上から掛けても汚しにはならない。
 *
 * ここでは、縁日の道具に実際に出る 5 つを部品にしてある。
 *   垢   … 凹んだ所・隅・継ぎ目に溜まる
 *   摩耗 … 角と、手や物が当たる所の色が抜ける
 *   流痕 … 水が流れた跡が縦に残る
 *   水垢 … 乾いた水滴の輪が白く残る
 *   擦過 … 細かい傷が向きを揃えて走る
 *
 * 強さは uWear でまとめて動かす。0 で下ろしたて、1 で一夏使ったあと。
 * ---------------------------------------------------------------- */
uniform float uWear;

/** 垢。凹みの深さ（0〜1）に応じて、黒ずんだ色へ寄せる。 */
vec3 grime(vec3 col, float cavity, vec3 tint, float amount){
  return mix(col, tint, clamp(cavity, 0.0, 1.0) * amount * uWear);
}

/** 流痕。上から下へ、幅のまちまちな縦の筋。down は 0 が上、1 が下。 */
float runStain(vec2 p, float down){
  // 縦に強く引き伸ばした雑音。筋は下へ行くほど広がって薄れる
  float a = fbm(vec2(p.x * 34.0, p.y * 1.6));
  float b = fbm(vec2(p.x * 11.0 + 7.0, p.y * 0.9));
  float s = smoothstep(0.52, 0.74, a * 0.6 + b * 0.4);
  return s * smoothstep(0.0, 0.35, down) * (1.0 - 0.45 * down) * uWear;
}

/** 水垢。乾いた水滴の輪。白い粉が縁に残る。 */
float waterMark(vec2 p, float scale){
  float d = worley(p * scale);
  // 輪だけを残す。中は乾いていて何も無い
  return smoothstep(0.30, 0.20, abs(d - 0.34)) * uWear;
}

/** 擦過。向きの揃った細い傷。dirAngle は傷の走る向き。 */
float scratch(vec2 p, float dirAngle, float density){
  float c = cos(dirAngle), sn = sin(dirAngle);
  vec2 q = vec2(p.x * c - p.y * sn, p.x * sn + p.y * c);
  // 1 方向だけ強く引き伸ばす
  float n = fbm(vec2(q.x * 420.0, q.y * 3.0));
  return smoothstep(1.0 - density * 0.16, 1.0 - density * 0.06, n) * uWear;
}

/** 埃。上を向いた面ほど積もる。 */
float dust(vec3 n, vec2 p){
  return max(n.y, 0.0) * (0.55 + 0.45 * fbm(p * 26.0)) * uWear;
}

float wearEdge(float dist, float width){
  return 1.0 - smoothstep(0.0, width, dist);
}

/**
 * 視差。高さのぶんだけ、見ている向きへ座標をずらす。
 *
 * 平たい面に模様を貼っただけだと、斜めから見ても模様が動かないので
 * 「絵が貼ってある」と分かってしまう。1 段だけでも、砂利や織り目に
 * 厚みが出る。depth は模様の起伏の実寸（m）。
 */
vec2 parallax(vec2 p, float h, vec3 V, vec3 N, float depth){
  vec3 t = V - N * dot(V, N);          // 視線を面に落とした向き
  return p - t.xz * (h - 0.5) * depth / max(dot(V, N), 0.25);
}

/**
 * 三面投影の重み。
 *
 * 平面投影は、その面に対して斜めになるほど模様が引き伸びる。
 * 法線の向きで三方向の投影を混ぜると、どの向きの面でも伸びない。
 * sharp を上げるほど、どれか一面に寄る（境目は硬くなる）。
 */
vec3 triWeights(vec3 n, float sharp){
  vec3 w = pow(abs(n), vec3(sharp));
  return w / max(w.x + w.y + w.z, 1e-4);
}

/**
 * 異方性のハイライト。
 *
 * 木目や織り目は、繊維の向きに沿って光が伸びる。等方の GGX だと
 * どの素材も同じ丸いハイライトになり、プラスチックに見える。
 * T は面の上での繊維の向き。
 */
vec3 ggxAniso(vec3 N, vec3 V, vec3 L, vec3 T, float ax, float ay, vec3 F0){
  vec3 B = normalize(cross(N, T));
  vec3 Tn = normalize(cross(B, N));
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 1e-4);
  float ndh = max(dot(N, H), 0.0);
  float vdh = max(dot(V, H), 1e-4);
  float th = dot(Tn, H) / max(ax, 1e-4);
  float bh = dot(B, H) / max(ay, 1e-4);
  float d = th * th + bh * bh + ndh * ndh;
  float D = 1.0 / (PI * ax * ay * d * d);
  float Vis = 0.25 / max(ndl * ndv, 1e-3);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
  return min(D * Vis * F * ndl, vec3(24.0));
}

/**
 * 濡れた膜。下地の上に、薄い水の層をもう一枚重ねる。
 *
 * 濡れた物が濡れて見えるのは、色が暗くなるからではなく、
 * 表面に鏡の層が乗って、そこだけ空が映るから。
 */
vec3 clearcoat(vec3 N, vec3 V, vec3 L, float wet, vec3 sun, vec3 sky){
  if(wet <= 0.001) return vec3(0.0);
  float r = mix(0.26, 0.075, wet);
  float f = fresnelSchlick(max(dot(N, V), 0.0), 0.02);
  // 鏡の層なので尖りやすい。頭を抑えないと白い穴が開く
  return min((ggx(N, V, L, r, vec3(0.02)) * sun * PI + sky * f * 0.7) * wet, vec3(1.6));
}
`;

/**
 * 空と太陽。
 *
 * 光源は太陽ひとつ。方向の揃った光でないと、水底のコースティクスも
 * 水面のきらめきも芯が出ない。空の色は時刻から JS 側（sky.js）で作って渡す。
 */
export const SKYLIB = `
uniform vec3 uSunDir;       // 太陽へ向かう単位ベクトル
uniform vec3 uSunColor;     // 直達光。1 を超える
uniform vec3 uSkyZenith;
uniform vec3 uSkyHorizon;
uniform vec3 uSkyGround;
uniform float uHaze;

const float PI = 3.14159265;

/**
 * 雲。[覆う量, 明るさ（地平の空に対する比）, 流れた量 x, 同 z]。
 *
 * 明るさだけ落として曇りにしていたら、晴れも曇りも雨も同じのっぺりした
 * 空になって、天気が画面に出ていなかった。
 */
uniform vec4 uCloud;

// 雲のための値雑音。NOISE を取り込んでいないプログラムからも
// 空を引くので、ここだけで閉じるように別に持つ
float cloudHash(vec2 p){
  vec3 q = fract(vec3(p.xyx) * 0.1031);
  q += dot(q, q.yzx + 33.33);
  return fract((q.x + q.y) * q.z);
}
float cloudNoise(vec2 p){
  vec2 i = floor(p), f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(mix(cloudHash(i), cloudHash(i + vec2(1, 0)), f.x),
             mix(cloudHash(i + vec2(0, 1)), cloudHash(i + vec2(1, 1)), f.x), f.y);
}
float cloudFbm(vec2 p){
  float a = 0.0, w = 0.5;
  for(int i = 0; i < 5; i++){ a += cloudNoise(p) * w; p *= 2.07; w *= 0.5; }
  return a;
}

/**
 * 見上げた先の雲。rgb と、覆っている度合い w を返す。
 *
 * 高さ 1200m の面に貼る。地平へ近づくほど面を斜めに見ることになるので、
 * 遠くの雲ほど詰まって見える。これが無いと、空に奥行きが出ない。
 */
vec4 cloudLook(vec3 d){
  if(uCloud.x < 0.001 || d.y < 0.010) return vec4(0.0);
  vec2 p = d.xz * (1.0 / max(d.y, 0.010)) * 0.90 + uCloud.zw;
  float n = cloudFbm(p * 0.34);
  // 覆う量。
  //
  // 閾値の取り方が緩く、晴れの日でも空の 8 割が雲になっていた。
  // 晴れた夏の空は、青地に積雲がぽつぽつ浮くだけ。
  // 雑音の平均は 0.5 前後なので、晴れはそれより高い所だけを雲にする
  float thr = mix(0.88, 0.24, uCloud.x);
  float cover = smoothstep(thr, thr + 0.13, n);
  // 地平の際は霞に溶ける
  cover *= smoothstep(0.010, 0.085, d.y);
  if(cover < 0.002) return vec4(0.0);
  // 塊の厚い所ほど底が暗く、縁は日を透かして明るい
  float thick = smoothstep(0.30, 0.95, n);
  vec3 col = uSkyHorizon * uCloud.y * (0.62 + 0.70 * (1.0 - thick))
           + uSunColor * 0.016 * uCloud.y * (1.0 - thick);
  return vec4(col, cover);
}

// 屋台の連提灯。
//
// 9 号長型ビニール提灯（直径 24cm × 高さ 53cm）を、屋台の梁に
// 間隔をあけて並べて吊るす。日が落ちるとこれが主な光源になる。
// 和紙（実際はビニル幌）を透かした橙で、水面には縦に伸びた筋として映る。
uniform samplerCube uEnv;    // 焼いた遠景。段が粗さに対応する
uniform float uEnvMips;
uniform vec3 uLanternCol;    // 1 個ぶんの強さ × 色。消えているときは 0
uniform vec4 uLanternP[2];   // 提灯の位置。画面の左右に 1 つずつ

vec3 lanternPos(int i){ return uLanternP[i].xyz; }

/** 連提灯から受ける明るさ。距離の二乗で落ちる点光源の和。 */
vec3 lanternLight(vec3 p, vec3 N){
  if(uLanternCol.r < 0.0005) return vec3(0.0);
  vec3 sum = vec3(0.0);
  for(int i = 0; i < 2; i++){
    vec3 L = lanternPos(i) - p;
    float d2 = max(dot(L, L), 0.04);
    sum += max(dot(N, L * inversesqrt(d2)), 0.0) / d2;
  }
  return uLanternCol * sum;
}

/** 提灯から回り込む分。向きを持たない、ぼんやりした底上げ。 */
vec3 lanternAmbient(vec3 p){
  if(uLanternCol.r < 0.0005) return vec3(0.0);
  float s = 0.0;
  for(int i = 0; i < 2; i++){
    vec3 L = lanternPos(i) - p;
    s += 1.0 / max(dot(L, L), 0.04);
  }
  return uLanternCol * s * 0.30;
}

/** 見上げた先に提灯があれば、その玉を返す。 */
vec3 lanternOrbs(vec3 d, vec3 from){
  if(uLanternCol.r < 0.0005 || d.y < 0.02) return vec3(0.0);
  vec3 sum = vec3(0.0);
  for(int i = 0; i < 2; i++){
    vec3 L = lanternPos(i) - from;
    float t = dot(L, d);
    if(t < 0.0) continue;
    // 提灯までの最短距離。直径 24cm の玉として当たり判定する
    float m = length(L - d * t);
    sum += uLanternCol * smoothstep(0.13, 0.03, m) * 85.0;
  }
  return sum;
}

// 屋台の天幕。
//
// 縁日の金魚すくいは、必ずテントで日陰を作って出す。天幕は白、
// または白と水色（赤・黄・桃もある）の縞のビニル幌布。
//
// 絵のうえでもこれが要る。天幕が無いと、水面はどこを向いても
// のっぺり明るい空しか映さない。照りが一面に広がって彩度が抜け、
// 水が灰色の靄になる。実際の水面が水に見えるのは、天幕や人影のような
// 構造のあるものを映しているから。測ってみると、白飛びではなく
// 「どこも 220 前後の無彩色」という形でそれが出ていた。
//
// 舟は客が手を伸ばせるよう天幕の前端より手前に置く。だから日は
// 直接当たる（コースティクスは残る）。変わるのは映り込みだけ。
uniform float uTentY;      // 天幕の高さ [m]
uniform vec4 uTentBox;     // 覆う範囲 xmin, xmax, zmin, zmax
uniform vec3 uTentTint;    // 幌布を透かしてくる光の色
uniform float uRainWet;    // 雨で濡れている度合い 0〜1

/**
 * 見上げた先の天幕。rgb と、覆っている度合い w を返す。
 *
 * w を 0 か 1 かの二値で返していた。水面に映ると、屋根の端が
 * 直線の境目になって現れ、その向こうの明るい空が帯になって
 * 水面の模様を消していた。実際の幌布の端は、生地が透けて光が
 * 回り込むので、こんなに硬い線にはならない。端を 0.35m ほどで
 * なめらかに抜く。
 */
vec4 tentLook(vec3 d){
  if(d.y < 0.02) return vec4(0.0);
  vec2 h = d.xz * (uTentY / d.y);
  float inx = min(smoothstep(0.0, 0.35, h.x - uTentBox.x),
                  smoothstep(0.0, 0.35, uTentBox.y - h.x));
  float inz = min(smoothstep(0.0, 0.35, h.y - uTentBox.z),
                  smoothstep(0.0, 0.35, uTentBox.w - h.y));
  float cover = inx * inz;
  if(cover < 0.002) return vec4(0.0);
  // 縞。幌布の定尺で幅 45cm。白地に水色
  float st = step(0.5, fract(h.x / 0.45 + 0.25));
  vec3 c = uTentTint * mix(1.0, 0.42, st);
  // 骨組み。1m ごとに単管が渡る
  float bar = 1.0 - smoothstep(0.0, 0.045, abs(fract(h.y + 0.5) - 0.5));
  c *= 1.0 - bar * 0.60;
  // 幌の継ぎ目のたるみ
  c *= 0.90 + 0.14 * sin(h.x * 7.0) * sin(h.y * 2.0);
  // 雨。幌は濡れて暗く沈み、たるんだ所に水が溜まって重く垂れる。
  // 明るい白のままだと、水面に映る天幕だけ晴れた日のまま残る
  if(uRainWet > 0.001){
    float pool = smoothstep(0.30, 0.85, 0.5 + 0.5 * sin(h.x * 7.0) * sin(h.y * 2.0));
    c *= mix(1.0, 0.56 - 0.18 * pool, uRainWet);
  }
  // 端ほど外の光が回り込んで明るい。
  // 1.1 倍まで持ち上げていたが、これも水面に映ると白い帯になる
  float edge = min(min(h.x - uTentBox.x, uTentBox.y - h.x),
                   min(h.y - uTentBox.z, uTentBox.w - h.y));
  c *= 1.0 + smoothstep(0.55, 0.0, edge) * 0.55;
  return vec4(c, cover);
}

/**
 * 空の色。from はその光線の出どころ。
 *
 * ここを原点で固定していた。提灯は 50cm しか離れていないので、
 * 水面のどこから見上げるかで方向が大きく変わる。原点から見た形を
 * 全画素へ配っていたせいで、水面に提灯の映り込みが出ず、二つ
 * 吊るしてあることが画面から分からなかった。背景の空も同じで、
 * カメラではなく原点から計算していた。
 */
vec3 skyColor(vec3 d, vec3 from){
  // 提灯は天幕より手前に吊るしてあるので、天幕より先に見える
  vec3 orb = lanternOrbs(d, from);
  float up = clamp(d.y, -1.0, 1.0);
  vec3 c = up > 0.0
    ? mix(uSkyHorizon, uSkyZenith, pow(up, 0.42))
    : mix(uSkyHorizon, uSkyGround, pow(-up, 0.55));
  // 太陽のまわりの暈け（前方散乱）
  float mu = max(dot(d, uSunDir), 0.0);
  c += uSunColor * (0.050 * pow(mu, 9.0) + 0.008 * pow(mu, 2.0)) * uHaze;
  // 雲は空の手前
  vec4 cl = cloudLook(d);
  c = mix(c, cl.rgb, cl.w);
  // 天幕は空の手前。提灯はさらに手前に吊るしてある
  vec4 tent = tentLook(d);
  return mix(c, tent.rgb, tent.w) + orb;
}

/** 太陽の本体まで描く版。背景のフルスクリーンパスだけで使う。 */
vec3 skyWithSun(vec3 d, vec3 from){
  vec3 c = skyColor(d, from);
  float mu = max(dot(d, uSunDir), 0.0);
  // 天幕の向こうの太陽は見えない
  c += uSunColor * smoothstep(0.999985, 0.999993, mu) * 320.0 * (1.0 - tentLook(d).w);
  return c;
}

/** 半球の空からの照り返し。法線の向きで上下を混ぜるだけ。 */
uniform float uWarmth;    // 0 = 真昼、1 = 日の出・日の入り

vec3 skyAmbient(vec3 n){
  float up = n.y * 0.5 + 0.5;
  vec3 c = mix(uSkyGround, mix(uSkyHorizon, uSkyZenith, 0.55), up) * 0.9;
  // 夕方は地面も壁も、西日の照り返しで暖色を帯びる
  return mix(c, c * vec3(1.35, 1.02, 0.74), uWarmth * 0.8);
}

/** GGX 1 本。F0 はフレネルの垂直入射値。 */
vec3 ggx(vec3 N, vec3 V, vec3 L, float rough, vec3 F0){
  vec3 H = normalize(L + V);
  float ndl = max(dot(N, L), 0.0);
  float ndv = max(dot(N, V), 1e-4);
  float ndh = max(dot(N, H), 0.0);
  float vdh = max(dot(V, H), 1e-4);
  float a = max(rough * rough, 1e-5);
  float a2 = a * a;
  float t = ndh * ndh * (a2 - 1.0) + 1.0;
  float D = a2 / (PI * t * t);
  // Smith の可視項（高さ相関なし）
  float gv = ndl * sqrt(ndv * ndv * (1.0 - a2) + a2);
  float gl = ndv * sqrt(ndl * ndl * (1.0 - a2) + a2);
  float Vis = 0.5 / max(gv + gl, 1e-5);
  vec3 F = F0 + (1.0 - F0) * pow(1.0 - vdh, 5.0);
  return D * Vis * F * ndl;
}

float fresnelSchlick(float ndv, float f0){
  return f0 + (1.0 - f0) * pow(1.0 - ndv, 5.0);
}

/**
 * 提灯の照り返し。
 *
 * 夜の水面が水に見えるのは、提灯の形が水面に伸びて映るから。
 * 拡散光だけ足しても、青いトレーに橙を掛けた鈍い緑にしかならない。
 */
/**
 * 焼いておいた遠景（空・天幕・地面）を、粗さに応じてぼかして引く。
 *
 * これまでは skyColor() を鏡として 1 点だけ拾っていた。粗い面でも
 * ハイライトが点のままなので、樹脂もお椀も硬く見えていた。
 * 段が粗さに対応していて、0 段目が鏡、最後の段がほぼ一様。
 *
 * 太陽と提灯は入っていない。どちらも別に解析で足している。
 * 太陽は入れると二重になり、提灯は近すぎて焼いた 1 点からの眺めが使えない。
 */
vec3 envSpec(vec3 R, float rough){
  return textureLod(uEnv, R, clamp(rough, 0.0, 1.0) * (uEnvMips - 1.0)).rgb;
}

vec3 lanternSpec(vec3 p, vec3 N, vec3 V, float rough, vec3 F0){
  if(uLanternCol.r < 0.0005) return vec3(0.0);
  vec3 sum = vec3(0.0);
  for(int i = 0; i < 2; i++){
    vec3 L = lanternPos(i) - p;
    float d2 = max(dot(L, L), 0.04);
    // 提灯は直径 24cm の面光源。粗さを広げて、面の大きさの代わりにする
    sum += ggx(N, V, L * inversesqrt(d2), rough + 0.16, F0) / d2;
  }
  // 点光源の GGX をそのまま足すと発散する。正しくは光源の立体角を掛ける。
  // 直径 24cm・距離 1.4m なら Ω ≈ π(0.12)²/1.4² ≈ 0.023 sr なので、
  // その程度まで落とす
  return uLanternCol * sum * 0.045;
}
`;

/**
 * 水の中にあるものが受ける光。
 * 水面で屈折した太陽光は、空気中より立って降ってくる。
 */
export const AMBIENT = `
vec3 underSunDir(){
  // スネルの法則で、水中での太陽の向きを立てる
  vec3 d = -uSunDir;                       // 進行方向
  float ci = max(-d.y, 0.02);
  float si = sqrt(max(1.0 - ci * ci, 0.0));
  float st = si / 1.333;
  float ct = sqrt(max(1.0 - st * st, 0.0));
  vec2 h = normalize(d.xz + vec2(1e-6));
  return -vec3(h.x * st, -ct, h.y * st);   // 水中で太陽へ向かう向き
}
vec3 underSun(vec3 N){
  float t = 1.0 - fresnelSchlick(max(uSunDir.y, 0.02), 0.02);
  return uSunColor * t * max(dot(N, underSunDir()), 0.0);
}
vec3 underAmbient(vec3 N){
  return skyAmbient(N) * 0.7;
}
/** 水の中から見た提灯。水面で屈折して立って降ってくるぶん、少し弱める。 */
vec3 underLantern(vec3 p, vec3 N){
  return lanternLight(p, N) * 0.78 + lanternAmbient(p) * 0.55;
}`;

/** 水面の読み出しと、壁ぎわの減衰。水底のコースティクスでも使う。 */
export const WATERLIB = `
uniform sampler2D uDisp;    // FFT の変位 (Dx, Dy, Dz)
uniform sampler2D uNormF;   // FFT の (∂h/∂x, ∂h/∂z, 泡, ∇²h)
uniform sampler2D uRipN;    // 波紋の (∂h/∂x, ∂h/∂z, h, ∇²h)
uniform float uPatch;
uniform float uRipSpan;
uniform vec2 uTankHalf;

uniform float uTankR;       // 角の丸み
uniform vec2 uTankDraft;    // 抜き勾配。高さ 1m あたり外へ開く量

/** 角の丸い長方形の内側からの距離。正なら内側、負なら外側。 */
float tankIn(vec2 p){
  vec2 q = abs(p) - uTankHalf + uTankR;
  return uTankR - (min(max(q.x, q.y), 0.0) + length(max(q, 0.0)));
}

/** はみ出した点を、丸みの上へ寄せる。水面の格子を舟の形に合わせる。 */
vec2 tankClamp(vec2 p){
  vec2 q = abs(p) - uTankHalf + uTankR;
  if(q.x > 0.0 && q.y > 0.0){
    float l = length(q);
    if(l > uTankR) return sign(p) * (uTankHalf - uTankR + q * (uTankR / l));
  }
  return p;
}

uniform float uFftN;
// テクセルの中心に合わせる。合わせないと場が半テクセルずれ、
// uv=0 で端どうしが混ざってわずかに鈍る
vec2 patchUv(vec2 p){ return p / uPatch + 0.5 / uFftN; }
vec2 ripUv(vec2 p){ return p / uRipSpan + 0.5; }

/** 水面の傾き。FFT と波紋を足したもの。 */
vec2 slopeAt(vec2 p){
  return texture(uNormF, patchUv(p)).xy + texture(uRipN, ripUv(p)).xy;
}

/** 壁に近いほど 0。たらいの水は縁で動けないので、変位をここで殺す。 */
float edgeMask(vec2 p){
  const float fade = 0.012;
  return smoothstep(0.0, fade, tankIn(p));
}`;

/**
 * コースティクス。
 *
 * 太陽光が水面で屈折して底へ落ちる写像のヤコビアンから、面積の伸縮を出す。
 * 水面の傾き ∇h が小さいとき、底での横ずれは
 *     offset(x) ≈ +depth · c · ∇h      c = 1 − 1/n
 * なので、面積比は det(I + depth·c·H)。H は ∇h のヤコビアン（ヘッセ行列）。
 * 明るさはその逆数。cusp で発散するので下限で止める。
 *
 * 符号は refract() で確かめた。∂h/∂x = s のとき屈折方向は (+c·s, −1) に向く。
 * 逆にすると、尖った波頭の下に細い筋が出るかわりに、広い谷の下に
 * 太いぼやけた斑が出る。波紋のリングでは明暗がそっくり裏返る。
 *
 * ∇²h だけで近似する手もあるが、それだと行列式の非対角項が落ちて
 * 「丸い斑」にしかならない。網目と尖点が出るのは det を取るから。
 *
 * 3 波長ぶん別々に計算して、虹の縁を出す。実際の水の分散（n が 0.4% 違う）
 * では 16cm の水深で見えないので、広がりは誇張してある。
 */
export const CAUSTICS = `
uniform vec3 uCausC;        // 波長ごとの (1 − 1/n) 相当
uniform vec2 uSunHoriz;     // 太陽の水平方向（単位）
uniform float uRefrTan;     // 水中での屈折角の tan
uniform float uCausGain;

/** 舟の壁が底に落とす影。光が水面に入るはずの位置が舟の外なら、そこは日陰。 */
float wallShade(vec2 entry){
  // 太陽が低いほど影は長く伸びる。縁をぼかすのは、水面が揺れていて
  // 影の境目そのものが揺らぐため
  float s = smoothstep(-0.030, 0.004, tankIn(entry));
  return 0.42 + 0.58 * s;     // 影の中にも空からの光がよく回り込む
}

vec3 caustics(vec2 bottomP, float below){
  // 光が水面に入った位置は、底の点から太陽の方へずれている
  vec2 entry = bottomP + uSunHoriz * below * uRefrTan;
  const float e = 0.010;
  vec2 sx = (slopeAt(entry + vec2(e, 0.0)) - slopeAt(entry - vec2(e, 0.0))) / (2.0 * e);
  vec2 sz = (slopeAt(entry + vec2(0.0, e)) - slopeAt(entry - vec2(0.0, e))) / (2.0 * e);
  float hxx = sx.x, hzx = sx.y, hxz = sz.x, hzz = sz.y;

  float k = below * uCausGain;
  vec3 g;
  float c0 = uCausC.x * k;
  float c1 = uCausC.y * k;
  float c2 = uCausC.z * k;
  // 下限で頭打ちにする。舟の底が水色のトレーになって反射率が上がったので、
  // 以前の 0.26（最大 2.8 倍）だと青が振り切れて、水面が一面の白い靄になる
  const float LIM = 0.36, NRM = 0.70;
  g.r = NRM / max(abs((1.0 + c0*hxx) * (1.0 + c0*hzz) - (c0*hxz) * (c0*hzx)), LIM);
  g.g = NRM / max(abs((1.0 + c1*hxx) * (1.0 + c1*hzz) - (c1*hxz) * (c1*hzx)), LIM);
  g.b = NRM / max(abs((1.0 + c2*hxx) * (1.0 + c2*hzz) - (c2*hxz) * (c2*hzx)), LIM);
  return g;
}`;

/** ACES のフィルミックな近似。 */
export const TONEMAP = `
vec3 aces(vec3 x){
  const float a=2.51, b=0.03, c=2.43, d=0.59, e=0.14;
  return clamp((x*(a*x+b))/(x*(c*x+d)+e), 0.0, 1.0);
}
vec3 toSRGB(vec3 c){ return pow(max(c, 0.0), vec3(1.0/2.2)); }`;
