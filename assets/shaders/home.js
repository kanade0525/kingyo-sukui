// 家の縁側と、ガラスの金魚鉢。
//
// 屋台とは別に書いてある。FS_SKY は「参道の玉砂利と花崗岩の切石と
// 舟のきわの濡れ」に 130 行を割いた縁日専用のシェーダで、家には使えない。
// 代わりに、材質の道具（NOISE / MATERIAL / SKYLIB / AMBIENT）は全部使い回す。

import { HEAD, NOISE, SKYLIB, MATERIAL, AMBIENT } from './common.js?v=202610050644';

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
uniform vec4 uEave;       // 軒の高さ, 軒の先端 z, 縁側の端 z, 庭の高さ
uniform vec4 uPost;       // 柱の x, 幅, 竹垣の z, 竹垣の高さ
uniform vec4 uToro;       // 灯籠の x, z, 高さ, 未使用
uniform vec4 uBasin;      // 蹲踞の x, z, 半径, 高さ
uniform vec3 uShrub[3];   // 刈り込みの x, z, 半径
uniform vec4 uMaple;      // 楓の x, z, 幹の高さ, 葉叢の半径
uniform vec4 uLeaf[5];    // 葉叢ひと塊の x, y, z, 半径
uniform float uSkyline;   // 借景の木立までの z
uniform float uWet;       // 雨で濡れている度合い 0〜1
uniform float uTime;
out vec4 frag;

// ---- 当たり判定の道具。どれも「いちばん手前の t、無ければ -1」を返す ----

float hitSphere(vec3 ro, vec3 rd, vec3 c, float r){
  vec3 oc = ro - c;
  float b = dot(oc, rd);
  float h = b * b - dot(oc, oc) + r * r;
  if(h < 0.0) return -1.0;
  float t = -b - sqrt(h);
  return t > 0.0 ? t : -1.0;
}

/** 縦の円柱。中心 c（底の中心）、半径 r、高さ h */
float hitCyl(vec3 ro, vec3 rd, vec3 c, float r, float h, out vec3 n){
  n = vec3(0.0, 1.0, 0.0);
  vec2 o = ro.xz - c.xz, dd = rd.xz;
  float a = dot(dd, dd);
  float best = 1e9;
  if(a > 1e-9){
    float b = dot(o, dd), cc = dot(o, o) - r * r;
    float disc = b * b - a * cc;
    if(disc > 0.0){
      float t = (-b - sqrt(disc)) / a;
      float y = ro.y + rd.y * t;
      if(t > 0.0 && y > c.y && y < c.y + h){
        best = t;
        n = normalize(vec3(o.x + dd.x * t, 0.0, o.y + dd.y * t));
      }
    }
  }
  // 天板
  if(abs(rd.y) > 1e-6){
    float t = (c.y + h - ro.y) / rd.y;
    if(t > 0.0 && t < best && length(ro.xz + rd.xz * t - c.xz) < r){
      best = t; n = vec3(0.0, 1.0, 0.0);
    }
  }
  return best < 1e9 ? best : -1.0;
}

/** 軸に沿った箱。中心 c、半径 h（各軸の半分） */
float hitBox(vec3 ro, vec3 rd, vec3 c, vec3 h, out vec3 n){
  // 0 除算よけ。ベクトルの比較はできないので、成分ごとに下駄を履かせる
  vec3 safe = sign(rd) * max(abs(rd), vec3(1e-6));
  vec3 m = 1.0 / safe;
  vec3 o = ro - c;
  vec3 k = abs(m) * h;
  vec3 t1 = -m * o - k, t2 = -m * o + k;
  float tn = max(max(t1.x, t1.y), t1.z);
  float tf = min(min(t2.x, t2.y), t2.z);
  if(tn > tf || tf < 0.0) return -1.0;
  n = -sign(rd) * step(t1.yzx, t1.xyz) * step(t1.zxy, t1.xyz);
  return tn > 0.0 ? tn : -1.0;
}

/**
 * 夜の庭に残る明かり。月と、雲や街に返った光。
 *
 * 屋台の空は店じまいにならないと月を足さないが、家では夜はただの夜で、
 * これが無いと垣も刈り込みも真っ黒に沈んで庭が消える。
 */
vec3 nightGlow(){
  float dark = clamp(1.0 - uSunColor.r * 1.7, 0.0, 1.0);
  return vec3(0.0165, 0.0215, 0.0360) * dark;
}

/**
 * 雨に濡れた面。
 *
 * 濡れると色は暗く沈み、照りだけが強くなる。水の膜が細かい凹凸を
 * 埋めてしまうので、粗い面ほど効きが大きい。
 * 乾いた色を明るくするのではなく、暗く落として艶を足すのが要。
 */
vec3 wetten(vec3 col, vec3 n, vec3 d, float rough){
  if(uWet < 0.001) return col;
  vec3 wet = col * mix(1.0, 0.70, uWet);
  // 水の膜が凹凸を埋める。ただし苔のように元が粗い面は粗いまま。
  // 一律に鏡へ寄せたら、庭ぜんぶが空の色に浸かって白茶けた
  float r = mix(rough, rough * 0.35 + 0.04, uWet);
  float F = fresnelSchlick(clamp(dot(n, -d), 0.0, 1.0), 0.028) * (1.0 - rough * 0.6);
  wet += ggx(n, -d, uSunDir, r, vec3(0.03)) * uSunColor * PI * uWet * 0.5;
  wet += envSpec(reflect(d, n), r) * F * uWet * 0.45;
  return wet;
}

/** 雨粒が水面に立てる輪。粒ごとに場所と時刻をずらす */
float rainRings(vec2 p, float t){
  if(uWet < 0.001) return 0.0;
  float a = 0.0;
  for(int k = 0; k < 5; k++){
    float f = float(k);
    // 1 粒の一生。落ちた所から輪が広がって薄れる
    float cyc = floor(t * 1.35 + f * 0.37);
    vec2 c = (hash22(vec2(cyc, f * 3.0 + 1.0)) - 0.5) * 0.9;
    float age = fract(t * 1.35 + f * 0.37);
    float r = age * 0.30;
    float ring = smoothstep(0.016, 0.0, abs(length(p - c) - r));
    a += ring * (1.0 - age) * (1.0 - age);
  }
  return a * uWet;
}

/** 石の肌。御影石。白い長石と黒い雲母の斑 */
vec3 stoneCol(vec3 p, float tone){
  float sp = fbm(p.xz * 160.0 + p.y * 90.0);
  float stain = smoothstep(0.42, 0.78, fbm(p.xz * 6.0 + p.y * 3.0));
  vec3 c = vec3(0.148, 0.146, 0.140) * tone * (0.80 + 0.42 * sp);
  // 苔と水垢。古い石ほど north 側が緑に寄る
  return mix(c, c * 0.62 + vec3(0.028, 0.048, 0.022), stain * 0.55);
}

/** 石の陰影。まとめてここで掛ける */
vec3 litStone(vec3 p, vec3 n, vec3 d, float tone){
  vec3 c = stoneCol(p, tone);
  vec3 lit = c * (uSunColor * max(dot(n, uSunDir), 0.0) * 0.75 + skyAmbient(n) * 1.25
                + lanternLight(p, n) * 0.8 + lanternAmbient(p) * 0.7)
           + ggx(n, -d, uSunDir, 0.55, vec3(0.03)) * uSunColor * PI * 0.18
           + c * nightGlow();
  return wetten(lit, n, d, 0.55);
}

/**
 * 楓の葉叢。玉を三つ重ね、雑音で縁を刻んで葉の切れ目を作る。
 *
 * 刈り込みと同じ球で済ませると、丸く刈った玉にしか見えない。
 * 楓は輪郭が破れているのが要なので、当たった所の雑音が薄ければ素通りさせる。
 */
float hitLeaves(vec3 ro, vec3 rd, vec3 c, float r, out vec3 nn, out float dens){
  float t = hitSphere(ro, rd, c, r);
  if(t <= 0.0) return -1.0;
  vec3 v = (ro + rd * t - c) / r;
  float f = fbm(v.xy * 4.2 + v.z * 2.4) * 0.60 + fbm(v.xz * 10.5 + v.y * 4.6) * 0.40;
  // 縁ほど薄く。玉に刈り込んだ輪郭を崩して、枝先の透けを作る
  f -= smoothstep(0.42, 1.0, length(v)) * 0.36;
  if(f < 0.16) return -1.0;                    // 葉の無い所。向こうが透ける
  nn = normalize(v + vec3(fbm(v.xy * 13.0) - 0.5,
                          fbm(v.yz * 13.0) - 0.5,
                          fbm(v.xz * 13.0) - 0.5) * 0.9);
  dens = f;
  return t;
}

/** 鉢の落とす影 */
float jarShadow(vec2 p){
  return 1.0 - smoothstep(0.055, 0.155, length(p)) * 0.62;
}

/** 縁側の板の間。杉の縁甲板。幅 10.5cm */
vec3 engawa(vec3 p, vec3 d){
  float board = floor(p.x / 0.105);
  float across = fract(p.x / 0.105);
  float seam = 1.0 - smoothstep(0.0, 0.035, min(across, 1.0 - across));
  float id = hash12(vec2(board, 3.0));
  float grain = fbm(vec2(p.x * 26.0, p.z * 2.2) + id * 40.0);
  float ring = fbm(vec2(p.x * 95.0, p.z * 5.0) + id * 11.0);
  vec3 col = mix(vec3(0.172, 0.118, 0.068), vec3(0.098, 0.062, 0.034),
                 grain * 0.75 + ring * 0.25);
  col *= 0.86 + 0.28 * id;
  col *= 1.0 - seam * 0.55;
  float knot = smoothstep(0.80, 0.95, fbm(vec2(p.x * 7.0, p.z * 1.4) + id * 70.0));
  col = mix(col, col * 0.42, knot * 0.7);
  float worn = smoothstep(0.62, 0.20, abs(p.z + 0.18));
  col = grime(col, (1.0 - worn) * 0.5, vec3(0.040, 0.028, 0.016), 0.35);
  vec3 n = vec3(0.0, 1.0, 0.0);
  float sh = jarShadow(p.xz);
  // 木漏れ日。左手の楓の影が板に落ちる。奥ほど濃い
  float dapple = smoothstep(0.30, 0.66, fbm(p.xz * 2.9 + 7.0) * 0.7
                                      + fbm(p.xz * 8.5 + 2.0) * 0.3);
  sh *= 1.0 - (1.0 - dapple) * 0.42 * smoothstep(0.55, -0.30, p.z);
  vec3 lit = col * (uSunColor * 0.46 * sh + skyAmbient(n) * 1.7 * sh
                  + lanternLight(p, n) + lanternAmbient(p) * 1.2);
  lit += ggx(n, -d, uSunDir, mix(0.42, 0.18, worn), vec3(0.035)) * uSunColor * PI * 0.32 * sh;
  lit += lanternSpec(p, n, -d, mix(0.42, 0.18, worn), vec3(0.035)) * 0.8;
  // 濡れ縁。軒の外なので雨は吹き込む。板は黒く沈んで照り返す
  return wetten(lit, n, d, 0.30);
}

/**
 * 庭の地面。苔と飛び石。
 *
 * 芝生ではない。露地の地面は杉苔で、飛び石はそこへ沈めて据える。
 * 石を点々と散らすと芝生に白い斑が浮いたようにしか見えないので、
 * 縁側から奥へ向かう「筋」として並べる。
 */
vec3 gardenFloor(vec3 p, vec3 d){
  // 杉苔。細かい毛の寄り集まり
  float mossN = fbm(p.xz * 34.0) * 0.55 + fbm(p.xz * 110.0) * 0.45;
  float spread = fbm(p.xz * 2.4 + 5.0);
  vec3 moss = mix(vec3(0.030, 0.058, 0.020), vec3(0.056, 0.098, 0.034), mossN);
  moss *= 0.80 + 0.40 * spread;
  // 土が覗く所
  vec3 soil = mix(vec3(0.052, 0.040, 0.028), vec3(0.082, 0.066, 0.046), fbm(p.xz * 9.0));
  vec3 col = mix(soil, moss, smoothstep(0.24, 0.52, spread));

  // 飛び石。蹲踞の前から灯籠の足元へ、手前を横切って渡る。
  //
  // 目の高さが 23cm しかないので、縁側の縁に遮られて地面が見え始めるのは
  // 1.8m 先から。奥へ真っ直ぐ伸ばすと鉢の真後ろに隠れてしまうため、
  // 見える帯（1.8〜4.3m）を斜めに横切らせる。
  vec2 a0 = vec2( 1.46, -1.95);
  vec2 a1 = vec2(-1.72, -3.80);
  for(int k = 0; k < 8; k++){
    float h1 = hash12(vec2(float(k), 1.0));
    float h2 = hash12(vec2(float(k), 5.0));
    vec2 c = mix(a0, a1, float(k) / 7.0) + vec2(h1 - 0.5, h2 - 0.5) * 0.19;
    vec2 q = p.xz - c;
    float ang = atan(q.y, q.x);
    // 丸い石は無い。方向で半径を振って、角の取れた多角形にする
    float rad = 0.168 * (0.84 + 0.18 * sin(ang * 3.0 + h2 * 6.3) + 0.08 * sin(ang * 5.0));
    float L = length(q);
    float inside = smoothstep(rad, rad - 0.010, L);
    vec3 stone = stoneCol(p, 0.94 + h1 * 0.22) * (1.05 + 0.25 * fbm(q * 120.0));
    // 石の縁は苔が這い上がる
    stone = mix(stone, stone * 0.7 + moss * 0.5,
                smoothstep(rad - 0.038, rad - 0.004, L) * 0.6);
    // まわりは少し窪んで影が溜まる
    col *= 1.0 - smoothstep(rad + 0.032, rad, L) * 0.22 * (1.0 - inside);
    col = mix(col, stone, inside);
  }

  vec3 n = vec3(0.0, 1.0, 0.0);
  vec3 lit = col * (uSunColor * max(dot(n, uSunDir), 0.0) * 0.85 + skyAmbient(n) * 1.55
                  + lanternAmbient(p) * 0.5 + nightGlow());
  return wetten(lit, n, d, 0.70);
}

/** 竹垣。建仁寺垣。割った竹を立てて並べ、胴縁で押さえる */
vec3 bambooFence(vec3 p, vec3 d){
  float w = 0.042;                              // 竹 1 本の幅
  float i = floor(p.x / w);
  float u = fract(p.x / w);
  float id = hash12(vec2(i, 2.0));
  // 竹の丸み
  float round_ = sin(u * 3.14159);
  vec3 bam = mix(vec3(0.118, 0.098, 0.052), vec3(0.168, 0.148, 0.080), id);
  bam *= 0.55 + 0.55 * round_;
  // 節。1 本ごとに高さが違う
  float node = 0.0;
  for(int k = 0; k < 3; k++){
    float ny = 0.28 + float(k) * 0.42 + id * 0.18;
    node = max(node, smoothstep(0.020, 0.004, abs(p.y - ny)));
  }
  bam = mix(bam, bam * 1.25 + vec3(0.02), node * 0.6);
  // 胴縁。横に渡して黒い棕櫚縄で縛る
  float rail = smoothstep(0.030, 0.018, abs(p.y - 0.52)) + smoothstep(0.030, 0.018, abs(p.y - 1.30));
  bam = mix(bam, vec3(0.088, 0.070, 0.040), min(rail, 1.0) * 0.8);
  float knot = min(rail, 1.0) * smoothstep(0.55, 0.85, fract(p.x / (w * 4.0)));
  bam = mix(bam, vec3(0.030, 0.026, 0.022), knot * 0.7);
  // 古びて灰色に褪せる。下ほど苔が付く
  bam = mix(bam, bam * 0.70 + vec3(0.030, 0.034, 0.026),
            smoothstep(0.55, 0.0, p.y - uEave.w) * 0.5);
  vec3 n = vec3(0.0, 0.0, 1.0);
  return wetten(bam * (uSunColor * 0.42 + skyAmbient(n) * 1.6
                     + lanternAmbient(p) * 0.4 + nightGlow()), n, d, 0.45);
}

void main(){
  vec3 d = normalize(uFwd + uRight * (vNdc.x * uTanHalf * uAspect) + uUp * (vNdc.y * uTanHalf));
  float edgeZ = uEave.z, gy = uEave.w;

  vec3 col;
  float depth = 1e9;
  vec3 n;

  // ---- 地面 ----
  if(d.y < -0.0015){
    float t = (uFloorY - uCam.y) / d.y;
    vec3 p = uCam + d * t;
    if(p.z > edgeZ){ col = engawa(p, d); depth = t; }
    else {
      float tg = (gy - uCam.y) / d.y;
      col = gardenFloor(uCam + d * tg, d); depth = tg;
    }
  } else {
    float up = clamp(d.y, 0.0, 1.0);
    col = mix(uSkyHorizon, uSkyZenith, pow(up, 0.5));
    depth = 1e5;
    // 雲。天気が画面に出るのはここがいちばん大きい
    vec4 cl = cloudLook(d);
    col = mix(col, cl.rgb, cl.w);
    // 借景。垣の向こうに雑木林が霞んで並ぶ。
    // 垣で閉じきると庭が箱になるので、奥行きはここで作る。
    if(d.z < -1e-4){
      float tz = (uSkyline - uCam.z) / d.z;
      vec3 q = uCam + d * tz;
      float crown = 4.9 + 2.6 * fbm(vec2(q.x * 0.052, 0.0))
                        + 1.5 * fbm(vec2(q.x * 0.155, 3.0));
      if(q.y < crown){
        // 遠景の木立は、空を暗く落として緑を差したものになる。
        // 葉の色から組むと、周囲光の明るい時刻に空と同じ明るさへ並んで消える。
        float shade = 0.34 + 0.16 * fbm(q.xy * 0.30);
        vec3 tc = col * shade + vec3(0.004, 0.009, 0.005) * (uSunColor.g + 0.5);
        // 梢に近いほど空に溶ける
        col = mix(col, tc, 1.0 - 0.55 * smoothstep(crown - 2.2, crown, q.y));
      }
    }
  }

  // ---- 竹垣。庭の奥を閉じる ----
  if(abs(d.z) > 1e-5){
    float t = (uPost.z - uCam.z) / d.z;
    vec3 p = uCam + d * t;
    if(t > 0.0 && t < depth && p.y > gy && p.y < gy + uPost.w){
      col = bambooFence(p, d); depth = t;
    }
  }

  // ---- 楓。庭の左手から枝を差し掛ける ----
  {
    vec3 base = vec3(uMaple.x, gy, uMaple.y);
    float TH = uMaple.z, CR = uMaple.w;
    // 幹。根元から立ち上がって、画面の方へ傾ぐ
    float t = hitCyl(uCam, d, base, 0.062, TH, n);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      float bark = fbm(vec2(p.y * 22.0, atan(p.z - base.z, p.x - base.x) * 2.2));
      vec3 bc = mix(vec3(0.062, 0.050, 0.040), vec3(0.108, 0.094, 0.082), bark);
      col = bc * (uSunColor * max(dot(n, uSunDir), 0.0) * 0.6 + skyAmbient(n) * 1.35
                + lanternAmbient(p) * 0.4);
      depth = t;
    }
    // 葉叢。並びは world.js の mapleLeaves() が決めている
    for(int k = 0; k < 5; k++){
      vec3 c = uLeaf[k].xyz;
      float r = uLeaf[k].w;
      vec3 nn; float dens;
      float tl = hitLeaves(uCam, d, c, r, nn, dens);
      if(tl > 0.0 && tl < depth){
        vec3 p = uCam + d * tl;
        // 青楓。日に透ける葉は黄緑に抜ける
        vec3 leaf = mix(vec3(0.062, 0.115, 0.038), vec3(0.135, 0.195, 0.058), dens);
        // 葉は薄いので日を透かす。裏から射すと黄緑に抜ける
        float through = pow(clamp(dot(d, uSunDir), 0.0, 1.0), 2.2);
        leaf = mix(leaf, vec3(0.205, 0.255, 0.075), through * 0.60);
        col = leaf * (uSunColor * (max(dot(nn, uSunDir), 0.0) * 0.85 + 0.30)
                    + skyAmbient(nn) * 1.9 + lanternAmbient(p) * 0.4 + nightGlow());
        depth = tl;
      }
    }
  }

  // ---- 刈り込み。ツツジの玉。竹垣の手前に並ぶ ----
  for(int i = 0; i < 3; i++){
    vec3 c = vec3(uShrub[i].x, gy + uShrub[i].z * 0.55, uShrub[i].y);
    float t = hitSphere(uCam, d, c, uShrub[i].z);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      vec3 nn = normalize(p - c);
      // 刈り込んだ面。葉が細かく詰まっている
      // fbm は vec2 しか取らない。球の上の位置を角度へ畳んで渡す
      vec2 sph = vec2(atan(nn.z, nn.x) * 1.6, nn.y * 2.2);
      float leaf = fbm(sph * 7.0 + uShrub[i].x) * 0.6 + fbm(sph * 22.0) * 0.4;
      vec3 g = mix(vec3(0.022, 0.044, 0.016), vec3(0.052, 0.092, 0.030), leaf);
      // 上面ほど日に焼けて明るい
      g *= 0.72 + 0.46 * smoothstep(-0.2, 1.0, nn.y);
      col = g * (uSunColor * max(dot(nn, uSunDir), 0.0) * 1.1 + skyAmbient(nn) * 1.2
               + lanternAmbient(p) * 0.4 + nightGlow());
      depth = t;
    }
  }

  // ---- 石灯籠。春日型。竿・中台・火袋・笠・宝珠 ----
  {
    vec3 c = vec3(uToro.x, gy, uToro.y);
    float H = uToro.z;
    float t;
    // 竿
    t = hitCyl(uCam, d, c, 0.052, H * 0.52, n);
    if(t > 0.0 && t < depth){ col = litStone(uCam + d * t, n, d, 1.0); depth = t; }
    // 中台
    t = hitBox(uCam, d, c + vec3(0.0, H * 0.56, 0.0), vec3(0.085, 0.040, 0.085), n);
    if(t > 0.0 && t < depth){ col = litStone(uCam + d * t, n, d, 1.05); depth = t; }
    // 火袋。夜はここに灯が入る
    t = hitBox(uCam, d, c + vec3(0.0, H * 0.70, 0.0), vec3(0.070, 0.082, 0.070), n);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      vec3 b = litStone(p, n, d, 1.1);
      // 火口。四面それぞれの真ん中に開く
      vec3 lp = p - (c + vec3(0.0, H * 0.70, 0.0));
      float across = abs(n.x) > 0.5 ? lp.z : lp.x;
      float win = step(abs(lp.y), 0.046) * step(abs(across), 0.038) * (1.0 - abs(n.y));
      // 日が沈んでから灯る。明るさで測ると、雨や曇りの昼間にも点いてしまう
      float lit = smoothstep(0.055, -0.055, uSunDir.y);
      // 灯は窓の面積が小さいので、明るさで立たせる。滲みは後段の bloom が作る
      // 灯が入っていなければ、ただの暗い窪み。
      // 一定の橙を混ぜていたら、雨の昼に露出が上がって灯って見えた
      vec3 glow = vec3(0.98, 0.62, 0.27) * 3.6 * lit;
      b = mix(b, b * 0.28 + glow, win * 0.92);
      // 火口のまわりの石も灯を受けて温かく滲む
      b += vec3(0.42, 0.24, 0.10) * lit * (1.0 - win)
         * smoothstep(0.105, 0.040, length(lp.xz) + abs(lp.y) * 0.6);
      col = b; depth = t;
    }
    // 笠。六角の勾配屋根。箱を三段に積んで、軒の出と傾きを出す。
    // 平たい箱 1 枚だと、笠が薄すぎて道標の板にしか見えない。
    for(int k = 0; k < 3; k++){
      float f = float(k);
      t = hitBox(uCam, d, c + vec3(0.0, H * (0.790 + f * 0.030), 0.0),
                 vec3(0.158 - f * 0.036, 0.019, 0.158 - f * 0.036), n);
      if(t > 0.0 && t < depth){ col = litStone(uCam + d * t, n, d, 0.98 + f * 0.04); depth = t; }
    }
    // 宝珠
    t = hitSphere(uCam, d, c + vec3(0.0, H * 0.905, 0.0), 0.040);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      col = litStone(p, normalize(p - (c + vec3(0.0, H * 0.905, 0.0))), d, 1.08); depth = t;
    }
  }

  // ---- 蹲踞。手水鉢と、水を落とす掛樋 ----
  {
    vec3 c = vec3(uBasin.x, gy, uBasin.y);
    float t = hitCyl(uCam, d, c, uBasin.z, uBasin.w, n);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      // 天面は水が溜まっている。縁から 3cm 内側
      float r = length(p.xz - c.xz);
      if(n.y > 0.5 && r < uBasin.z - 0.030){
        // 溜まった水。空を映し、底の石が透ける
        vec3 refl = envSpec(reflect(d, vec3(0.0, 1.0, 0.0)), 0.05);
        float F = fresnelSchlick(clamp(-d.y, 0.0, 1.0), 0.02);
        vec3 bottom = stoneCol(p, 0.55) * (skyAmbient(n) * 0.9 + uSunColor * 0.18);
        col = mix(bottom, refl, clamp(F * 1.4 + 0.10, 0.0, 0.92));
        // 掛樋から落ちる雫が立てる輪
        float ring = sin(length(p.xz - (c.xz + vec2(0.0, 0.06))) * 90.0 - uTime * 5.0);
        col += vec3(0.05, 0.06, 0.06) * max(ring, 0.0) * 0.25;
        // 雨粒。溜まり水はここがいちばん雨の見える所になる
        col += vec3(0.07, 0.08, 0.08) * rainRings((p.xz - c.xz) / uBasin.z, uTime);
      } else {
        col = litStone(p, n, d, 0.92);
      }
      depth = t;
    }
    // 役石。手水鉢の手前に踏む前石、両脇に手燭石と湯桶石。
    // 鉢だけ置くと、庭に土管が転がっているようにしか見えない。
    for(int k = 0; k < 3; k++){
      vec3 rc = c + vec3(k == 0 ? 0.0 : (k == 1 ? -0.44 : 0.40), 0.0,
                         k == 0 ? 0.42 : 0.06);
      float rr = k == 0 ? 0.20 : 0.13;
      float rh = k == 0 ? 0.055 : (k == 1 ? 0.085 : 0.110);
      float t2 = hitCyl(uCam, d, rc, rr, rh, n);
      if(t2 > 0.0 && t2 < depth){
        col = litStone(uCam + d * t2, n, d, 0.86 + float(k) * 0.08); depth = t2;
      }
    }
    // 掛樋。竹を斜めに渡して水を落とす
    {
      vec3 bc = c + vec3(-0.31, 0.0, -0.02);
      float tb = hitCyl(uCam, d, bc, 0.025, 0.66, n);
      if(tb > 0.0 && tb < depth){
        vec3 p = uCam + d * tb;
        vec3 bam = mix(vec3(0.130, 0.112, 0.058), vec3(0.176, 0.160, 0.086),
                       fbm(vec2(p.y * 40.0, 0.0)));
        bam *= 0.80 + 0.30 * smoothstep(0.016, 0.0, abs(fract(p.y * 4.0) - 0.5) * 0.25);
        col = bam * (uSunColor * 0.45 + skyAmbient(n) * 1.2 + lanternAmbient(p) * 0.4);
        depth = tb;
      }
    }
  }

  // ---- 柱。縁側の端に立って軒を支える ----
  {
    float w = uPost.y;
    float tz = (edgeZ - uCam.z) / (abs(d.z) < 1e-5 ? 1e-5 : d.z);
    vec3 p = uCam + d * tz;
    if(tz > 0.0 && tz < depth && abs(p.x - uPost.x) < w && p.y > gy && p.y < uEave.x){
      float gr = fbm(vec2(p.y * 18.0, p.x * 40.0));
      vec3 w2 = mix(vec3(0.118, 0.082, 0.048), vec3(0.070, 0.046, 0.026), gr);
      w2 *= 0.88 + 0.26 * smoothstep(w * 0.55, w, abs(p.x - uPost.x));
      vec3 nn = vec3(0.0, 0.0, 1.0);
      col = w2 * (uSunColor * 0.22 + skyAmbient(nn) * 1.5
                + lanternLight(p, nn) + lanternAmbient(p));
      col += ggx(nn, -d, uSunDir, 0.30, vec3(0.035)) * uSunColor * PI * 0.3;
      depth = tz;
    }
  }

  // 遠くほど霞む。庭は 1〜4m しかないので、ごく薄く
  if(depth < 40.0) col = mix(col, uSkyHorizon * 0.55, smoothstep(5.0, 22.0, depth) * 0.6);
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
 * どの段か。
 *   0 = 水の中（砂利）を別の板へ描く。金魚もここへ重ねる
 *   1 = ガラス。水の中を屈折して読み直し、1 枚で仕上げる
 *   2 = 鉢の中の水面。同じく水の中を読み直す
 *
 * 屋台の水面と同じ作り。中身を本パスにも描くと、素の像とガラス越しの
 * 像が二重に重なって、曇りガラスのように見える。
 *
 * 水面を 1 と分けているのは、口から覗き込む所にガラスが無いため。
 * 中身をガラスの段だけで描いていたら、上から見たとき鉢が三日月に欠けて、
 * 真ん中は縁側の板が透けて見えていた。
 */
uniform int uPass;
uniform sampler2D uRip;     // 鉢の波紋の (∂h/∂x, ∂h/∂z, h, ∇²h)
uniform float uRipSpan;
out vec4 frag;

void main(){
  int region = int(vRegion + 0.5);
  // 段ごとに、担当しない面は捨てる。
  // 水面は中身の板に入れない。入れると、ガラス越しに横から見たときに
  // 水の中と水面が重なって写る
  if(uPass == 0 && (region == 7 || region == 9)) discard;
  if(uPass == 1 && region != 7) discard;
  if(uPass == 2 && region != 9) discard;
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec2 uv = gl_FragCoord.xy / uRes;

  if(region == 8){
    // ---- 底の砂利。鉢の中なので、水の色を帯びる ----
    // 大磯砂。粒は 2〜5mm なので、1 粒が 4mm ほどになる刻みで取る
    vec2 g = vW.xz * 260.0;
    float cav;
    float peb = gravel(g, 1.0, cav);
    float pid = hash12(floor(g));
    // 大磯は黒っぽい砂利。明るい御影石の色で置くと、鉢の底で白く泡立つ
    vec3 stone = pid < 0.34 ? vec3(0.098, 0.092, 0.082)
               : pid < 0.68 ? vec3(0.058, 0.052, 0.044)
                            : vec3(0.034, 0.031, 0.027);
    vec3 col = mix(vec3(0.028, 0.025, 0.021), stone, peb);
    col *= 1.0 - cav * 0.55;
    // 鉢は四方から光が入る。舟の底のように上からだけではない
    col *= underSun(N) * 0.9 + underAmbient(N) * 1.3 + underLantern(vW, N) * 1.0;
    frag = vec4(col, vDist);
    return;
  }

  if(region == 11){
    // ---- 水草。アナカリス ----
    //
    // 葉は薄いので、裏から光が当たると透けて明るい黄緑に抜ける。
    // 向きで表裏が入れ替わるので、法線はカメラ側へ向け直す
    vec3 nf = dot(N, V) < 0.0 ? -N : N;
    float up = clamp(vW.y / (uWaterY + 0.001), 0.0, 1.0);
    // 新しい葉ほど先が明るい。根元は茶色く枯れ込む
    vec3 leaf = mix(vec3(0.038, 0.058, 0.026), vec3(0.058, 0.108, 0.034), up);
    float back = pow(clamp(dot(-V, uSunDir), 0.0, 1.0), 2.0);
    leaf = mix(leaf, vec3(0.095, 0.155, 0.052), back * 0.5);
    vec3 col = leaf * (underSun(nf) * 0.85 + underAmbient(nf) * 1.35
                     + underLantern(vW, nf) * 1.0);
    // 葉の表はつるりとしている
    col += ggx(nf, V, uSunDir, 0.28, vec3(0.025)) * uSunColor * PI * 0.35;
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
    // ---- 鉢の中の水面。口から覗き込むと見える ----
    //
    // ゆるい正弦 2 本に、金魚が立てた波紋を重ねる。
    // 小さい鉢なので大きくは揺れないが、魚が通ると輪が広がる
    float w = sin(vW.x * 120.0 + uTime * 1.3) * 0.5 + sin(vW.z * 97.0 - uTime * 1.1) * 0.5;
    vec2 rip = texture(uRip, vW.xz / uRipSpan + 0.5).xy;
    vec3 n = normalize(vec3(-w * 0.03 - rip.x * 1.6, 1.0, -w * 0.024 - rip.y * 1.6));
    float ndn = clamp(dot(n, V), 0.0, 1.0);

    // 水の中を読み直す。空気（1.0）から水（1.333）へ入る分だけ曲げる
    vec3 R = refract(-V, n, 1.0 / 1.333);
    // 上から覗くと水深 15cm ぶんしかずれない。実寸どおりだと 1 画素の
    // 揺れにしかならないので、見える程度まで持ち上げる
    vec2 off = R.xy * 0.125 * (1.0 - ndn * 0.5);
    vec3 below = texture(uScene, clamp(uv + off, vec2(0.002), vec2(0.998))).rgb;
    // 水を通る距離。真上から覗けば水深ぶん、浅い角度ほど長くなる
    float path = uWaterY / max(ndn, 0.22);
    below *= exp(-vec3(1.05, 0.20, 0.09) * path);
    below += vec3(0.012, 0.040, 0.048) * (1.0 - exp(-path * 6.0))
           * (skyAmbient(vec3(0.0, 1.0, 0.0)) * 1.1 + lanternAmbient(vW) * 1.4);

    // 映り込み。水面は浅い角度ほど鏡になる
    float F = fresnelSchlick(ndn, 0.02);
    vec3 refl = envSpec(reflect(-V, n), 0.06) + lanternOrbs(reflect(-V, n), vW);
    vec3 col = mix(below, refl, F);
    // 輪の斜面が空を拾う照り。上から見た水面で雨粒がいちばん見えるのはこれ
    col += min(ggx(n, V, uSunDir, 0.07, vec3(0.02)) * uSunColor * PI, vec3(0.30));
    // 輪の照りは、強く振ると水面が白い膜になって中が見えなくなる。
    // 覗き込んで中が見えることのほうが先で、照りは輪の在りかを示す程度に留める
    col += min(envSpec(reflect(-V, n), 0.10) * length(rip) * 4.0, vec3(0.22));
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
