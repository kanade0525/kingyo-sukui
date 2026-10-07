// 家の縁側と、ガラスの金魚鉢。
//
// 屋台とは別に書いてある。FS_SKY は「参道の玉砂利と花崗岩の切石と
// 舟のきわの濡れ」に 130 行を割いた縁日専用のシェーダで、家には使えない。
// 代わりに、材質の道具（NOISE / MATERIAL / SKYLIB / AMBIENT）は全部使い回す。

import { HEAD, NOISE, SKYLIB, MATERIAL, AMBIENT } from './common.js?v=202610070209';

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
uniform vec4 uGrass[7];   // 下草の x, z, 横の半径, 高さ
uniform vec4 uRock[2];    // 景石の x, z, 半径, 地上に出る高さ
uniform float uPostX2;    // もう一本の柱
uniform vec2 uKayari;     // 蚊遣りの置き場所
uniform vec2 uUchiwa;     // 団扇の置き場所
uniform vec2 uKutsunugi;  // 沓脱石の置き場所
uniform float uBoardEdge; // 縁甲板の厚み
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

/**
 * 傾いた棒（カプセル）。a から b へ、太さ r。
 *
 * hitCyl は縦しか置けない。幹は曲がりが多く、枝は低く長く伸びるので、
 * 向きを選べるものが要る。
 */
float hitSeg(vec3 ro, vec3 rd, vec3 a, vec3 b, float r, out vec3 n){
  n = vec3(0.0, 1.0, 0.0);
  vec3 ba = b - a, oa = ro - a;
  float bb = dot(ba, ba);
  float bd = dot(ba, rd), bo = dot(ba, oa);
  float a2 = bb - bd * bd;
  float b2 = bb * dot(oa, rd) - bo * bd;
  float c2 = bb * dot(oa, oa) - bo * bo - r * r * bb;
  float h = b2 * b2 - a2 * c2;
  if(h < 0.0) return -1.0;
  h = sqrt(h);
  float t = (-b2 - h) / a2;
  // 胴
  float y = bo + t * bd;
  if(y > 0.0 && y < bb && t > 0.0){
    n = normalize((oa + t * rd - ba * y / bb) / r);
    return t;
  }
  // 端の球
  vec3 oc = (y <= 0.0) ? oa : ro - b;
  float bq = dot(rd, oc);
  float cq = dot(oc, oc) - r * r;
  h = bq * bq - cq;
  if(h < 0.0) return -1.0;
  t = -bq - sqrt(h);
  if(t <= 0.0) return -1.0;
  n = normalize((oc + t * rd) / r);
  return t;
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
/**
 * 石の肌。御影石。
 *
 * 露地の石は据えてから何十年も経っている。斑を振っただけの灰色では、
 * 据えたばかりの新しい石にしか見えない。古い石をそれらしくするのは
 * 次の四つで、どれも場所の決まり方が違う。
 *
 *   地衣  … 白緑の輪が点々と張り付く。向きに関係なく散る
 *   苔    … 雨の当たる上面と、日の回らない北側に乗る
 *   流痕  … 笠や中台の下へ、水の落ちた跡が縦に黒く落ちる
 *   磨き  … 人の踏む所・触る所だけは苔が付かず、擦れて明るい
 *
 * age は据えてからの古さ。飛び石は踏まれるので低く、
 * 灯籠と蹲踞は高く取る。
 */
vec3 stoneCol(vec3 p, vec3 n, float tone, float age){
  float sp = fbm(p.xz * 160.0 + p.y * 90.0);
  vec3 c = vec3(0.148, 0.146, 0.140) * tone * (0.80 + 0.42 * sp);

  // 地衣。乾いた白緑の輪。
  // 石とほとんど同じ灰で混ぜていたので、付いていても見えていなかった
  float lich = smoothstep(0.56, 0.72, fbm(p.xz * 46.0 + p.y * 30.0));
  c = mix(c, vec3(0.215, 0.222, 0.168), lich * 0.55 * age * uWear);

  // 苔。
  //
  // 「北側」を -z に取っていたが、カメラが見るのは +z 側の面なので、
  // 見える所には一切付いていなかった。苔が乗るのは次の三つで、
  // どれも見る向きに関係なく出る。
  //   ・雨の溜まる上向きの面（笠や中台の天）
  //   ・地面から湿りの上がる足元
  //   ・日の回らない側
  float up = clamp(n.y, 0.0, 1.0);
  float damp = smoothstep(0.52, 0.0, p.y - uEave.w);
  float shade = clamp(-dot(n, normalize(vec3(0.45, 0.60, 0.66))) * 0.5 + 0.5, 0.0, 1.0);
  float blotch = smoothstep(0.34, 0.70, fbm(p.xz * 13.0 + p.y * 8.0));
  float moss = clamp(blotch * (up * 0.85 + damp * 0.75 + shade * 0.35) * age * uWear,
                     0.0, 0.80);
  c = mix(c, vec3(0.032, 0.066, 0.024) * (0.70 + 0.60 * fbm(p.xz * 95.0)), moss);

  // 流痕。横を向いた面の、上から下へ
  float run = runStain(vec2(atan(p.z, p.x) * 0.18, -p.y * 2.4), clamp(0.6 - n.y, 0.0, 1.0));
  c = mix(c, c * 0.60, run * 0.55 * age);
  return c;
}

/** 石の陰影。まとめてここで掛ける */
vec3 litStone(vec3 p, vec3 n, vec3 d, float tone, float age){
  vec3 c = stoneCol(p, n, tone, age);
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
  // 縁ほど薄く。玉に刈り込んだ輪郭を崩して、枝先の透けを作る。
  //
  // 削りすぎて葉叢がスカスカになっていた。楓は枝が込み合っていて、
  // 中ほどは向こうが見えない。透けるのは枝先だけ
  f -= smoothstep(0.62, 1.0, length(v)) * 0.44;
  if(f < 0.02) return -1.0;                    // 葉の無い所。向こうが透ける
  nn = normalize(v + vec3(fbm(v.xy * 13.0) - 0.5,
                          fbm(v.yz * 13.0) - 0.5,
                          fbm(v.xz * 13.0) - 0.5) * 0.9);
  dens = f;
  return t;
}

/** 楕円体。半径を軸ごとに指定できる球 */
float hitEllip(vec3 ro, vec3 rd, vec3 c, vec3 rad, out vec3 nn){
  vec3 o = (ro - c) / rad, dd = rd / rad;
  float a = dot(dd, dd), b = dot(o, dd), cc = dot(o, o) - 1.0;
  float h = b * b - a * cc;
  if(h < 0.0) return -1.0;
  float t = (-b - sqrt(h)) / a;
  if(t <= 0.0) return -1.0;
  nn = normalize((o + dd * t) / rad);
  return t;
}

/**
 * 下草の株。平たい楕円体を、葉の筋で刻む。
 *
 * ヤブランもシダも、根元から細い葉が放射状に立つ。
 * 玉のまま置くと刈り込みと見分けが付かないので、
 * 縦に強く引き伸ばした雑音で縁を刻んで、葉の筋を作る。
 */
float hitClump(vec3 ro, vec3 rd, vec3 c, vec3 rad, out vec3 nn, out float up){
  vec3 o = (ro - c) / rad, dd = rd / rad;
  float a = dot(dd, dd), b = dot(o, dd), cc = dot(o, o) - 1.0;
  float h = b * b - a * cc;
  if(h < 0.0) return -1.0;
  float t = (-b - sqrt(h)) / a;
  if(t <= 0.0) return -1.0;
  vec3 v = o + dd * t;
  float ang = atan(v.z, v.x);
  // 葉は細長い。横方向に細かく、縦には伸ばして刻む。
  // 等方の雑音で削ると、刈り込みの玉と見分けが付かない
  float f = fbm(vec2(ang * 11.0, v.y * 0.7)) * 0.50
          + fbm(vec2(ang * 34.0, v.y * 1.6)) * 0.50;
  // 葉先ほど疎らで、株の肩から上が透ける
  f -= smoothstep(0.05, 1.0, v.y) * 0.42;
  if(f < 0.44) return -1.0;
  nn = normalize(v / rad);
  up = clamp(v.y * 0.5 + 0.5, 0.0, 1.0);
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
  // 杉の縁甲板。日に焼けて飴色になった古い板。
  // 反射率を暗く取りすぎていたので、真上から日が当たっても沈んでいた
  vec3 col = mix(vec3(0.248, 0.168, 0.092), vec3(0.142, 0.090, 0.048),
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
  // 直射を 0.46 の決め打ちで入れていた。軒を外した濡れ縁なので、
  // 日は真上から板に当たる。向きどおりに受けさせる
  vec3 lit = col * (uSunColor * max(dot(n, uSunDir), 0.0) * 1.05 * sh
                  + skyAmbient(n) * 1.25 * sh
                  + lanternLight(p, n) + lanternAmbient(p) * 1.2);
  lit += ggx(n, -d, uSunDir, mix(0.42, 0.18, worn), vec3(0.035)) * uSunColor * PI * 0.32 * sh;
  lit += lanternSpec(p, n, -d, mix(0.42, 0.18, worn), vec3(0.035)) * 0.8;
  // 濡れ縁。軒の外なので雨は吹き込む。板は黒く沈んで照り返す
  return wetten(lit, n, d, 0.30);
}

/**
 * 庭に落ちる日影。
 *
 * 接地影（足元の暗がり）しか無かったので、どれだけ明るくしても
 * 「曇りの日を明るく撮った絵」にしかならなかった。
 * カンカン照りが分かるのは明るさではなく、落ちる影の濃さと輪郭のほう。
 * 太陽へ向けて撃ち返して、庭の物に当たるかを見る。
 */
float gardenShade(vec3 p){
  vec3 ro = p + vec3(0.0, 0.004, 0.0);
  float s = 1.0;
  vec3 nn;
  float gy = uEave.w;
  for(int i = 0; i < 3; i++){
    vec3 c = vec3(uShrub[i].x, gy + uShrub[i].z * 0.55, uShrub[i].y);
    if(hitSphere(ro, uSunDir, c, uShrub[i].z) > 0.0) s = 0.0;
  }
  for(int i = 0; i < 2; i++){
    vec3 rc = vec3(uRock[i].x, gy + uRock[i].w - uRock[i].z, uRock[i].y);
    if(hitSphere(ro, uSunDir, rc, uRock[i].z) > 0.0) s = 0.0;
  }
  for(int i = 0; i < 7; i++){
    vec3 gc = vec3(uGrass[i].x, gy + uGrass[i].w * 0.55, uGrass[i].y);
    if(hitSphere(ro, uSunDir, gc, uGrass[i].z * 0.8) > 0.0) s = min(s, 0.35);
  }
  // 葉叢は隙間から光が漏れるので、落ちるのは薄い影
  for(int i = 0; i < 5; i++){
    if(hitSphere(ro, uSunDir, uLeaf[i].xyz, uLeaf[i].w) > 0.0) s = min(s, 0.30);
  }
  // 灯籠と蹲踞は太い塊。円柱で代える
  if(hitCyl(ro, uSunDir, vec3(uToro.x, gy, uToro.y), 0.10, uToro.z, nn) > 0.0) s = 0.0;
  if(hitCyl(ro, uSunDir, vec3(uBasin.x, gy, uBasin.y), uBasin.z, uBasin.w * 1.6, nn) > 0.0) s = 0.0;
  if(hitCyl(ro, uSunDir, vec3(uMaple.x, gy, uMaple.y), 0.075, uMaple.z, nn) > 0.0) s = 0.0;
  return s;
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
  // 反射率 0.03〜0.056 は、ほとんど黒に近い。日向の杉苔はもっと明るい。
  // 直射が真上から当たる面なので、ここが暗いと庭ぜんぶが沈む
  vec3 moss = mix(vec3(0.072, 0.128, 0.046), vec3(0.125, 0.205, 0.072), mossN);
  moss *= 0.80 + 0.40 * spread;
  // 土が覗く所
  vec3 soil = mix(vec3(0.098, 0.076, 0.052), vec3(0.155, 0.125, 0.086), fbm(p.xz * 9.0));
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
    vec3 stone = stoneCol(p, vec3(0.0, 1.0, 0.0), 0.94 + h1 * 0.22, 0.30)
               * (1.05 + 0.25 * fbm(q * 120.0));
    // 石の縁は苔が這い上がる
    stone = mix(stone, stone * 0.7 + moss * 0.5,
                smoothstep(rad - 0.038, rad - 0.004, L) * 0.6);
    // まわりは少し窪んで影が溜まる
    col *= 1.0 - smoothstep(rad + 0.032, rad, L) * 0.22 * (1.0 - inside);
    col = mix(col, stone, inside);
  }

  vec3 n = vec3(0.0, 1.0, 0.0);
  // 木漏れ日。楓の下は、葉の隙間から落ちた光がまだらに散る
  float under = 1.0 - smoothstep(0.55, 1.45, length(p.xz - (uMaple.xy + vec2(0.55, 0.35))));
  float dap = smoothstep(0.34, 0.70, fbm(p.xz * 3.6 + 21.0) * 0.65
                                   + fbm(p.xz * 11.0 + 5.0) * 0.35);
  float sunMask = 1.0 - under * (1.0 - dap) * 0.62;

  // 落ち葉。楓の下に溜まる。掃いても次の日には落ちている
  {
    vec2 lq = p.xz - uMaple.xy;
    float near = 1.0 - smoothstep(0.5, 1.9, length(lq - vec2(0.55, 0.35)));
    vec2 cell = floor(lq * 7.0);
    vec2 inCell = fract(lq * 7.0) - 0.5 - (hash22(cell) - 0.5) * 0.55;
    float ang2 = hash12(cell + 3.0) * 6.2831853;
    // 葉は掌状で平たい。向きを振った小さな板として置く
    vec2 r2 = vec2(inCell.x * cos(ang2) - inCell.y * sin(ang2),
                   inCell.x * sin(ang2) + inCell.y * cos(ang2));
    float leaf = smoothstep(0.30, 0.16, length(r2 * vec2(1.0, 1.9)));
    leaf *= step(0.42, hash12(cell + 11.0)) * near;
    vec3 fallen = mix(vec3(0.088, 0.062, 0.028), vec3(0.135, 0.070, 0.030),
                      hash12(cell + 7.0));
    col = mix(col, fallen, leaf * 0.85);
  }

  // 接地影。
  //
  // 物の足元が地面と同じ明るさだと、どれだけ正しい高さに置いても
  // 宙に浮いて見える。置いてある物の真下は空が隠れて暗い
  float occ = 0.0;
  occ += 1.0 - smoothstep(0.06, 0.20, length(p.xz - uToro.xy));
  occ += (1.0 - smoothstep(0.16, 0.38, length(p.xz - uBasin.xy))) * 0.85;
  occ += (1.0 - smoothstep(0.08, 0.26, length(p.xz - (uBasin.xy + vec2(-0.31, -0.02))))) * 0.7;
  for(int i = 0; i < 3; i++){
    occ += (1.0 - smoothstep(uShrub[i].z * 0.55, uShrub[i].z * 1.25,
                             length(p.xz - uShrub[i].xy))) * 0.9;
  }
  occ += (1.0 - smoothstep(0.10, 0.30, length(p.xz - uMaple.xy))) * 0.8;
  col *= 1.0 - clamp(occ, 0.0, 1.0) * 0.55;

  // 直射を 0.85 に絞って環境光を 1.55 も入れていたので、
  // 日向と日陰の差が付かず、平らに沈んだ曇りの絵になっていた。
  // 真夏の庭は「明るい」のではなく「差が大きい」
  float sh = gardenShade(p);
  vec3 lit = col * (uSunColor * max(dot(n, uSunDir), 0.0) * 1.35 * sunMask * sh
                  + skyAmbient(n) * 1.05 + lanternAmbient(p) * 0.5 + nightGlow());
  return wetten(lit, n, d, 0.70);
}

/**
 * 竹垣。建仁寺垣。割った竹を立てて並べ、胴縁で押さえる。
 *
 * along は垣の走る向きの座標。奥の垣は x、脇の垣は z を渡す。
 */
vec3 bambooFence(vec3 p, vec3 d, float along, vec3 n){
  float w = 0.042;                              // 竹 1 本の幅
  float i = floor(along / w);
  float u = fract(along / w);
  float id = hash12(vec2(i, 2.0));
  // 竹の丸み
  float round_ = sin(u * 3.14159);
  // 日に晒されて枯れた竹は、新しい青竹よりずっと明るい。
  // 暗く取っていたので、真夏の日向でも灰色のままだった
  vec3 bam = mix(vec3(0.255, 0.218, 0.118), vec3(0.360, 0.312, 0.170), id);
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
  float knot = min(rail, 1.0) * smoothstep(0.55, 0.85, fract(along / (w * 4.0)));
  bam = mix(bam, vec3(0.030, 0.026, 0.022), knot * 0.7);
  // 古びて灰色に褪せる。下ほど苔が付く
  bam = mix(bam, bam * 0.70 + vec3(0.030, 0.034, 0.026),
            smoothstep(0.55, 0.0, p.y - uEave.w) * 0.5);
  // 庭は逆光なので、こちらを向いた垣の面に直射は当たらない。
  // それでも明るいのは、開けた空から回り込む光と、
  // 焼けた地面が返す照り返しのため
  vec3 bounce = vec3(0.145, 0.165, 0.090) * uSunColor * 0.26;
  return wetten(bam * (uSunColor * max(dot(n, uSunDir), 0.0) * 1.15
                     + skyAmbient(n) * 1.55 + bounce
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
    // 縁側から見えるのは地平に近い空だけ（仰角で 17° ほど）なので、
    // 0.5 乗だと天頂の青がほとんど混ざらず、白っぽい空にしかならない
    float up = clamp(d.y, 0.0, 1.0);
    col = mix(uSkyHorizon, uSkyZenith, pow(up, 0.32));
    depth = 1e5;
    // 雲。天気が画面に出るのはここがいちばん大きい
    vec4 cl = cloudLook(d);
    col = mix(col, cl.rgb, cl.w);
    // 入道雲。快晴の夏空に立ち上がる
    vec4 cb = cumulus(d);
    col = mix(col, cb.rgb, cb.w);
    // 借景。垣の向こうに雑木林が霞んで並ぶ。
    // 垣で閉じきると庭が箱になるので、奥行きはここで作る。
    if(d.z < -1e-4){
      float tz = (uSkyline - uCam.z) / d.z;
      vec3 q = uCam + d * tz;
      // 山の高さ。
      //
      // 頂が仰角 18.6° まで届いていて、画面の上端（16°）を越えていた。
      // 空の帯が一筋も残らず、快晴でも入道雲でも出しようがない。
      // 頂を 13° までに抑えて、上に空を通す
      float crown = 3.5 + 1.8 * fbm(vec2(q.x * 0.052, 0.0))
                        + 1.0 * fbm(vec2(q.x * 0.155, 3.0));
      // 霞み方は天気で決まる。
      //
      // 晴れの日も曇りと同じだけ白く霞ませていたので、
      // いい天気なのに山がぼやけた眺めになっていた。
      // 乾いた晴れの日は遠くまで見通せて、尾根は青く濃く沈む。
      // 曇りと雨は水気が多いので、その日こそ白く霞む
      float mist = smoothstep(0.30, 0.95, uCloud.x);

      // 奥の尾根。ひと重ねだと切り紙を立てたようにしか見えないので、
      // 遠い尾根を先に敷いて、その手前に近い木立を重ねる
      float far = 5.2 + 2.3 * fbm(vec2(q.x * 0.028 + 40.0, 0.0));
      if(q.y < far){
        float fs = mix(0.44, 0.66, mist) + 0.10 * fbm(q.xy * 0.14);
        vec3 fc = col * fs + vec3(0.004, 0.006, 0.011) * (uSunColor.g + 0.5) * (1.0 - mist);
        col = mix(col, fc, 1.0 - mix(0.18, 0.55, mist) * smoothstep(far - 2.6, far, q.y));
      }
      if(q.y < crown){
        // 手前の山は青々としている。
        //
        // 空を暗く落としただけの灰色にしていたので、晴れていても
        // 山が灰色の壁になっていた。夏の低い山は近いうちは緑が勝つ。
        // 空に溶けて青く沈むのは、もっと遠いか、水気の多い日
        float shade = mix(0.19, 0.38, mist) + 0.14 * fbm(q.xy * 0.30);
        float tops = smoothstep(0.42, 0.72, fbm(vec2(q.x * 0.52, q.y * 0.30)));
        vec3 green = vec3(0.052, 0.098, 0.034) * (0.75 + 0.55 * tops)
                   * (uSunColor * 0.42 + skyAmbient(vec3(0.0, 1.0, 0.0)) * 0.9);
        vec3 hazy = col * (shade + 0.10 * tops);
        // 晴れた日は緑のまま、霞む日は空の色へ寄る
        vec3 tc = mix(green, hazy, mist * 0.85 + 0.15);
        col = mix(col, tc, 1.0 - mix(0.10, 0.55, mist) * smoothstep(crown - 2.2, crown, q.y));
      }
    }
  }

  // ---- 竹垣。庭を三方から閉じる ----
  //
  // 奥の一枚だけだと、横へ回したとき垣がどこまでも伸びて、
  // 庭ではなく果てしない廊下に見える。露地は囲われているもの
  {
    float W = 4.2;                                  // 庭の幅の半分
    if(abs(d.z) > 1e-5){
      float t = (uPost.z - uCam.z) / d.z;
      vec3 p = uCam + d * t;
      if(t > 0.0 && t < depth && p.y > gy && p.y < gy + uPost.w && abs(p.x) < W){
        col = bambooFence(p, d, p.x, vec3(0.0, 0.0, 1.0)); depth = t;
      }
    }
    if(abs(d.x) > 1e-5){
      for(int k = 0; k < 2; k++){
        float wx = k == 0 ? -W : W;
        float t = (wx - uCam.x) / d.x;
        vec3 p = uCam + d * t;
        if(t > 0.0 && t < depth && p.y > gy && p.y < gy + uPost.w
           && p.z < edgeZ && p.z > uPost.z){
          col = bambooFence(p, d, p.z, vec3(k == 0 ? 1.0 : -1.0, 0.0, 0.0)); depth = t;
        }
      }
    }
  }

  // ---- 景石。庭に据えた石 ----
  for(int i = 0; i < 2; i++){
    vec3 rc = vec3(uRock[i].x, gy + uRock[i].w - uRock[i].z, uRock[i].y);
    float t = hitSphere(uCam, d, rc, uRock[i].z);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      vec3 nn = normalize(p - rc);
      // 丸い玉では川原の石になる。割れ肌の平らな面を混ぜて、山石に寄せる
      float facet = fbm(vec2(atan(nn.z, nn.x) * 2.6, nn.y * 2.2));
      nn = normalize(nn + vec3(facet - 0.5, 0.0, fbm(nn.xz * 3.4) - 0.5) * 0.45);
      col = litStone(p, nn, d, 0.88 + facet * 0.24, 1.0);
      depth = t;
    }
  }

  // ---- 下草。垣の足元と石の際に残る株 ----
  for(int i = 0; i < 7; i++){
    vec3 gc = vec3(uGrass[i].x, gy + uGrass[i].w * 0.55, uGrass[i].y);
    vec3 nn; float up;
    float t = hitClump(uCam, d, gc, vec3(uGrass[i].z, uGrass[i].w, uGrass[i].z * 0.82),
                       nn, up);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      // 葉は細長いので、一枚の中でも明暗が走る
      float blade = fbm(vec2(atan(p.z - gc.z, p.x - gc.x) * 26.0, p.y * 40.0));
      vec3 g = mix(vec3(0.058, 0.108, 0.042), vec3(0.125, 0.195, 0.070), blade);
      // 根元は日が届かず暗い。先は黄ばむ
      g *= 0.55 + 0.65 * up;
      g = mix(g, vec3(0.072, 0.072, 0.034), smoothstep(0.78, 1.0, up) * 0.35 * uWear);
      // 細い葉は、裏から日が射すといちばんよく透ける
      float thru = pow(clamp(dot(-d, uSunDir), 0.0, 1.0), 2.0)
                 * clamp(-dot(nn, uSunDir) * 0.5 + 0.6, 0.0, 1.0);
      col = wetten(g * (uSunColor * max(dot(nn, uSunDir), 0.0) * 1.0 + skyAmbient(nn) * 1.25
                      + lanternAmbient(p) * 0.4 + nightGlow())
                 + vec3(0.110, 0.165, 0.048) * uSunColor * thru * 0.75, nn, d, 0.75);
      depth = t;
    }
  }

  // ---- 楓。庭の左手から枝を差し掛ける ----
  {
    vec3 base = vec3(uMaple.x, gy, uMaple.y);
    float TH = uMaple.z, CR = uMaple.w;
    // 幹。
    //
    // 真っ直ぐな円柱を 1 本立てていたので、柱がもう 1 本あるようにしか
    // 見えなかった。イロハモミジは根元から細い幹が何本かに分かれて
    // 外へ広がる株立ちになり、幹は曲がりが多く、枝は低く長く伸びる。
    // 枝先は冬芽が 2 つ並ぶので、伸びると必ず二叉に分かれる。
    //
    // 樹皮は若木が緑がかって滑らか、年を取ると淡い灰褐色になって
    // 縦に浅い割れ目が入る。
    for(int k = 0; k < 3; k++){
      float f = float(k);
      float lean = (f - 1.0) * 0.30;             // 外へ広がる
      vec3 a0 = base + vec3(f * 0.035 - 0.035, 0.0, (f - 1.0) * 0.030);
      // 幹は途中で曲がる。二節に分ける
      vec3 a1 = a0 + vec3(lean * 0.35 + 0.05, TH * 0.55, lean * 0.22);
      vec3 a2 = a1 + vec3(lean * 0.55 + 0.11, TH * 0.52, lean * 0.30);
      float rr = 0.040 - f * 0.008;
      for(int q = 0; q < 2; q++){
        vec3 pa = q == 0 ? a0 : a1, pb = q == 0 ? a1 : a2;
        float rq = q == 0 ? rr : rr * 0.72;
        vec3 bn;
        float t = hitSeg(uCam, d, pa, pb, rq, bn);
        if(t > 0.0 && t < depth){
          vec3 p = uCam + d * t;
          // 縦に浅い割れ目。年を取った幹の灰褐色
          float split = smoothstep(0.55, 0.80, fbm(vec2(atan(bn.z, bn.x) * 5.5, p.y * 3.2)));
          float grain = fbm(vec2(p.y * 26.0, atan(bn.z, bn.x) * 2.4));
          vec3 bc = mix(vec3(0.118, 0.106, 0.092), vec3(0.072, 0.064, 0.056), grain);
          bc = mix(bc, bc * 0.52, split * 0.75);
          // 地際と北側は苔が上がる
          bc = mix(bc, vec3(0.034, 0.062, 0.026),
                   smoothstep(0.35, 0.0, p.y - gy) * 0.55 * uWear);
          col = bc * (uSunColor * max(dot(bn, uSunDir), 0.0) * 0.6 + skyAmbient(bn) * 1.35
                    + lanternAmbient(p) * 0.4 + nightGlow());
          depth = t;
        }
      }
      // 枝。幹の上から葉叢へ、二叉に分かれながら低く長く伸びる
      for(int q = 0; q < 2; q++){
        vec3 tip = uLeaf[k + q].xyz;
        vec3 mid = mix(a2, tip, 0.55) + vec3(0.0, -0.045, 0.0);
        vec3 bn;
        float t = hitSeg(uCam, d, a2, mid, 0.017 - f * 0.002, bn);
        if(t > 0.0 && t < depth){
          vec3 p = uCam + d * t;
          col = vec3(0.092, 0.082, 0.072)
              * (uSunColor * max(dot(bn, uSunDir), 0.0) * 0.6 + skyAmbient(bn) * 1.3
               + nightGlow());
          depth = t;
        }
        t = hitSeg(uCam, d, mid, tip, 0.010, bn);
        if(t > 0.0 && t < depth){
          vec3 p = uCam + d * t;
          col = vec3(0.100, 0.090, 0.078)
              * (uSunColor * max(dot(bn, uSunDir), 0.0) * 0.6 + skyAmbient(bn) * 1.3
               + nightGlow());
          depth = t;
        }
      }
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
        // 逆光で透ける分。符号が逆で、カメラが太陽を背にしたときに
        // 光っていた。透けるのは太陽を見込んだときのほう
        float through = pow(clamp(dot(-d, uSunDir), 0.0, 1.0), 2.0);
        leaf = mix(leaf, vec3(0.265, 0.300, 0.090), through * 0.70);
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
      // 反射率が苔と同じくらい暗く、日向でも黒い塊だった。
      // ツツジの葉は厚くて照りがあり、夏は中くらいの緑に見える
      vec3 g = mix(vec3(0.055, 0.105, 0.038), vec3(0.118, 0.195, 0.068), leaf);

      // 刈り跡。
      //
      // 刈り込みばさみで切った葉は、切り口が褐色に枯れて残る。
      // 玉の表面にこれが点々と散っているのが、刈ってある木の目印。
      // 緑の球のままだと、刈り込みではなく苔玉に見える
      float cut = smoothstep(0.62, 0.86, fbm(sph * 54.0 + 3.0));
      g = mix(g, vec3(0.072, 0.055, 0.028), cut * 0.45 * uWear);

      // 枯れ枝と枯れ上がり。
      //
      // 古い玉は内側に枯れ枝が溜まり、日の当たらない下枝から枯れ上がる。
      // 下半分ほど葉が薄く、地際は土と枝が透ける
      float bare = smoothstep(0.10, -0.55, nn.y)
                 * smoothstep(0.42, 0.68, fbm(sph * 11.0 + 9.0));
      g = mix(g, vec3(0.048, 0.038, 0.026), clamp(bare, 0.0, 0.70) * uWear);
      // 内側の枯れ枝が隙間から覗く
      float twig = smoothstep(0.80, 0.93, fbm(sph * vec2(3.0, 34.0) + 17.0));
      g = mix(g, vec3(0.032, 0.026, 0.020), twig * 0.55 * uWear);

      // 上面ほど日に焼けて明るい
      g *= 0.72 + 0.46 * smoothstep(-0.2, 1.0, nn.y);
      // 透過光。
      //
      // 縁側は南を向くので、庭はいつも逆光になる。こちらを向いた面は
      // 日が当たらないが、葉は薄いので裏から透けて黄緑に光る。
      // これが真夏の庭の見え方を決めている
      float thru = pow(clamp(dot(-d, uSunDir), 0.0, 1.0), 2.4)
                 * clamp(-dot(nn, uSunDir) * 0.5 + 0.6, 0.0, 1.0);
      col = g * (uSunColor * max(dot(nn, uSunDir), 0.0) * 1.1 + skyAmbient(nn) * 1.2
               + lanternAmbient(p) * 0.4 + nightGlow())
          + vec3(0.085, 0.145, 0.040) * uSunColor * thru * 0.55;
      depth = t;
    }
  }

  // ---- 石灯籠。春日型。基礎・竿・中台・火袋・笠・宝珠 ----
  //
  // 部材をそれぞれの高さに置いていたので、竿と中台の間に 1.1cm、
  // 中台と火袋の間に 5.7cm の隙間が開いて、全部が宙に浮いていた。
  // 石灯籠は積んである物なので、上の面と下の面が必ず接している。
  // 下から順に高さを積み上げて決める。
  {
    vec3 c = vec3(uToro.x, gy, uToro.y);
    float H = uToro.z;
    float t;
    float yBase = 0.0,            hBase = H * 0.095;   // 基礎
    float ySao  = yBase + hBase,  hSao  = H * 0.420;   // 竿
    float yMid  = ySao + hSao,    hMid  = H * 0.075;   // 中台
    float yHi   = yMid + hMid,    hHi   = H * 0.180;   // 火袋
    float yKasa = yHi + hHi,      hKasa = H * 0.115;   // 笠
    // 基礎。据わりを出すために太く低く
    t = hitCyl(uCam, d, c + vec3(0.0, yBase, 0.0), 0.098, hBase, n);
    if(t > 0.0 && t < depth){ col = litStone(uCam + d * t, n, d, 0.96, 1.0); depth = t; }
    // 竿
    t = hitCyl(uCam, d, c + vec3(0.0, ySao, 0.0), 0.052, hSao, n);
    if(t > 0.0 && t < depth){ col = litStone(uCam + d * t, n, d, 1.0, 1.0); depth = t; }
    // 中台
    t = hitBox(uCam, d, c + vec3(0.0, yMid + hMid * 0.5, 0.0),
               vec3(0.085, hMid * 0.5, 0.085), n);
    if(t > 0.0 && t < depth){ col = litStone(uCam + d * t, n, d, 1.05, 1.0); depth = t; }
    // 火袋。夜はここに灯が入る
    vec3 hiC = c + vec3(0.0, yHi + hHi * 0.5, 0.0);
    t = hitBox(uCam, d, hiC, vec3(0.070, hHi * 0.5, 0.070), n);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      vec3 b = litStone(p, n, d, 1.1, 0.85);
      // 火口。四面それぞれの真ん中に開く
      vec3 lp = p - hiC;
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
      float hs = hKasa / 3.0;
      t = hitBox(uCam, d, c + vec3(0.0, yKasa + hs * (f + 0.5), 0.0),
                 vec3(0.158 - f * 0.036, hs * 0.5, 0.158 - f * 0.036), n);
      if(t > 0.0 && t < depth){ col = litStone(uCam + d * t, n, d, 0.98 + f * 0.04, 1.0); depth = t; }
    }
    // 宝珠。笠の天に載る
    vec3 hoC = c + vec3(0.0, yKasa + hKasa + 0.028, 0.0);
    t = hitSphere(uCam, d, hoC, 0.038);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      col = litStone(p, normalize(p - hoC), d, 1.08, 1.0); depth = t;
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
        vec3 bottom = stoneCol(p, n, 0.55, 1.0) * (skyAmbient(n) * 0.9 + uSunColor * 0.18);
        col = mix(bottom, refl, clamp(F * 1.4 + 0.10, 0.0, 0.92));
        // 掛樋から落ちる雫が立てる輪
        float ring = sin(length(p.xz - (c.xz + vec2(0.0, 0.06))) * 90.0 - uTime * 5.0);
        col += vec3(0.05, 0.06, 0.06) * max(ring, 0.0) * 0.25;
        // 雨粒。溜まり水はここがいちばん雨の見える所になる
        col += vec3(0.07, 0.08, 0.08) * rainRings((p.xz - c.xz) / uBasin.z, uTime);
      } else {
        col = litStone(p, n, d, 0.92, n.y > 0.5 ? 0.35 : 1.0);
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
        col = litStone(uCam + d * t2, n, d, 0.86 + float(k) * 0.08, 0.55); depth = t2;
      }
    }
    // 柄杓。手水鉢の縁に、竹の柄を渡して掛けてある。
    // 蹲踞は手を清める所なので、これが無いとただの水盤になる
    {
      vec3 bn;
      vec3 ha = c + vec3(-0.055, uBasin.w + 0.022, 0.175);
      vec3 hb = c + vec3(0.070, uBasin.w + 0.040, -0.120);
      float t2 = hitSeg(uCam, d, ha, hb, 0.0075, bn);
      if(t2 > 0.0 && t2 < depth){
        vec3 p = uCam + d * t2;
        vec3 bam = mix(vec3(0.150, 0.132, 0.072), vec3(0.200, 0.182, 0.100),
                       fbm(vec2(p.y * 70.0, 0.0)));
        col = bam * (uSunColor * max(dot(bn, uSunDir), 0.0) * 0.7 + skyAmbient(bn) * 1.3
                   + lanternAmbient(p) * 0.4 + nightGlow());
        depth = t2;
      }
      // 合。伏せて掛けてあるので、椀が下を向く
      vec3 cup = c + vec3(-0.095, uBasin.w + 0.012, 0.248);
      float t3 = hitSphere(uCam, d, cup, 0.040);
      if(t3 > 0.0 && t3 < depth){
        vec3 p = uCam + d * t3;
        vec3 nn2 = normalize(p - cup);
        vec3 bam = vec3(0.170, 0.150, 0.082) * (0.85 + 0.30 * fbm(p.xz * 90.0));
        col = bam * (uSunColor * max(dot(nn2, uSunDir), 0.0) * 0.7 + skyAmbient(nn2) * 1.3
                   + lanternAmbient(p) * 0.4 + nightGlow());
        depth = t3;
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

  // ---- 蚊遣り。線香皿に渦巻を一本。
  //
  // はじめは板に貼った絵で出したが、平らな丸にしか見えなかった。
  // 次に陶器の豚で作ったが、軸に沿った楕円体と棒だけでは
  // どう組んでも豚に見えず、煙の穴は目玉に見えた。
  // 作れない形を無理に置くより、作れる形をきちんと置く。
  // 線香皿なら浅い丸皿で、見間違えようがない ----
  {
    vec3 base = vec3(uKayari.x, uFloorY, uKayari.y);
    float R = 0.085;          // 直径 17cm の皿
    float H = 0.016;
    vec3 nn;
    float t = hitCyl(uCam, d, base, R, H, nn);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      vec2 q = p.xz - base.xz;
      float dish = length(q);
      // 焼き締めの陶器。土の肌が残る
      vec3 clay = mix(vec3(0.112, 0.092, 0.076), vec3(0.168, 0.142, 0.118),
                      fbm(q * 120.0 + p.y * 40.0));
      if(nn.y > 0.5){
        // 天面。縁が立ち上がって、中が窪んでいる
        float rim = smoothstep(0.070, 0.082, dish);
        clay *= 1.0 - (1.0 - rim) * 0.30;
        // 渦巻。直径 12cm に 10 巻き前後。幅 3mm で同じだけ間を空ける
        float ang = atan(q.y, q.x);
        float spiral = fract(dish * 160.0 - ang / 6.2831853);
        float coil = smoothstep(0.62, 0.40, abs(spiral - 0.5) * 2.0)
                   * smoothstep(0.061, 0.057, dish) * smoothstep(0.008, 0.012, dish);
        // 先だけ燃えて、そこまでは白い灰が残る
        float burn = smoothstep(0.058, 0.052, dish);
        vec3 incense = mix(vec3(0.235, 0.228, 0.218), vec3(0.102, 0.072, 0.046), burn);
        clay = mix(clay, incense, coil);
      }
      col = clay * (uSunColor * max(dot(nn, uSunDir), 0.0) * 1.0 + skyAmbient(nn) * 1.2
                  + lanternAmbient(p) * 0.5 + nightGlow())
          + ggx(nn, -d, uSunDir, 0.34, vec3(0.035)) * uSunColor * PI * 0.3;
      depth = t;
      // 火。渦の外端で赤く熾る
      vec2 tip = base.xz + vec2(0.0585, 0.0);
      if(nn.y > 0.5){
        col += vec3(0.95, 0.30, 0.06) * smoothstep(0.006, 0.0, length(q - vec2(0.0585, 0.0))) * 1.8;
      }
    }
  }

  // ---- 団扇。平柄。面を伏せて置いてある ----
  {
    vec3 uc = vec3(uUchiwa.x, uFloorY + 0.0022, uUchiwa.y);
    vec3 nn;
    // 面。直径 24cm、厚み 2mm ほどの薄い板
    float t = hitEllip(uCam, d, uc, vec3(0.120, 0.0022, 0.107), nn);
    if(t > 0.0 && t < depth){
      vec3 p = uCam + d * t;
      vec2 q = (p.xz - uc.xz);
      float ca = 0.82, sa = 0.57;
      vec2 r = vec2(q.x * ca - q.y * sa, q.x * sa + q.y * ca);
      // 骨が放射に通る。地は生成りの紙
      float rib = 0.5 + 0.5 * sin(atan(r.y, r.x) * 24.0);
      vec3 paper = mix(vec3(0.425, 0.398, 0.348), vec3(0.472, 0.448, 0.398), rib);
      // 中ほどに藍の判。縁は竹を細く回してある
      float rr = length(r * vec2(1.0, 1.12));
      paper = mix(paper, vec3(0.118, 0.142, 0.212), smoothstep(0.060, 0.050, rr) * 0.60);
      paper = mix(paper, vec3(0.168, 0.145, 0.082), smoothstep(0.1095, 0.1135, rr));
      col = paper * (uSunColor * max(dot(nn, uSunDir), 0.0) * 1.0 + skyAmbient(nn) * 1.15
                   + lanternAmbient(p) * 0.6 + nightGlow())
          + ggx(nn, -d, uSunDir, 0.55, vec3(0.030)) * uSunColor * PI * 0.2;
      depth = t;
    }
    // 柄。面から 12cm 出る平らな竹
    {
      float ca = 0.82, sa = 0.57;
      vec3 dir = vec3(ca, 0.0, -sa);
      vec3 a0 = uc - dir * 0.100, a1 = uc - dir * 0.222;
      // 平柄は竹の薄板。直径 17mm の丸棒だと丸太に見える
      float t2 = hitSeg(uCam, d, a0, a1, 0.0032, nn);
      if(t2 > 0.0 && t2 < depth){
        vec3 p = uCam + d * t2;
        vec3 bam = mix(vec3(0.185, 0.162, 0.092), vec3(0.242, 0.215, 0.126),
                       fbm(vec2(dot(p.xz, dir.xz) * 60.0, 0.0)));
        col = bam * (uSunColor * max(dot(nn, uSunDir), 0.0) * 1.0 + skyAmbient(nn) * 1.1
                   + lanternAmbient(p) * 0.6 + nightGlow());
        depth = t2;
      }
    }
  }

  // ---- 縁甲板の木口。
  //
  // 床を面 1 枚で終わらせていたので、縁側が「厚みの無い板きれ」
  // だった。濡れ縁の板は 30mm ある。端から下へ、その厚みを見せる ----
  if(abs(d.z) > 1e-5){
    float t = (edgeZ - uCam.z) / d.z;
    vec3 p = uCam + d * t;
    if(t > 0.0 && t < depth && p.y < uFloorY && p.y > uFloorY - uBoardEdge){
      // 木口は繊維の切り口なので、面より荒くて暗い
      float grain = fbm(vec2(p.x * 120.0, (uFloorY - p.y) * 60.0));
      vec3 w = mix(vec3(0.138, 0.090, 0.050), vec3(0.082, 0.050, 0.028), grain);
      // 板と板の継ぎ目が、ここでも縦に走る
      float seam = 1.0 - smoothstep(0.0, 0.004,
                     min(fract(p.x / 0.105), 1.0 - fract(p.x / 0.105)) * 0.105);
      w *= 1.0 - seam * 0.5;
      vec3 nn = vec3(0.0, 0.0, 1.0);
      col = wetten(w * (uSunColor * max(dot(nn, uSunDir), 0.0) * 0.55
                      + skyAmbient(nn) * 0.95 + lanternAmbient(p) * 0.8 + nightGlow()),
                   nn, d, 0.35);
      depth = t;
    }
  }

  // ---- 沓脱石と下駄。縁側から庭へ下りる所 ----
  {
    vec3 kc = vec3(uKutsunugi.x, gy, uKutsunugi.y);
    float hK = 0.090;                     // 天端は床から 15cm 下
    float t = hitBox(uCam, d, kc + vec3(0.0, hK * 0.5, 0.0), vec3(0.30, hK * 0.5, 0.165), n);
    if(t > 0.0 && t < depth){
      col = litStone(uCam + d * t, n, d, 0.92, 0.45);
      depth = t;
    }
    // 下駄。長さ 24cm・幅 10cm。歯が二枚
    for(int k = 0; k < 2; k++){
      float sx = k == 0 ? -0.075 : 0.075;
      vec3 gc = kc + vec3(sx, hK, 0.015);
      float t2 = hitBox(uCam, d, gc + vec3(0.0, 0.052, 0.0),
                        vec3(0.050, 0.009, 0.118), n);
      if(t2 > 0.0 && t2 < depth){
        vec3 p = uCam + d * t2;
        float grain = fbm(vec2(p.z * 90.0, p.x * 30.0));
        vec3 w = mix(vec3(0.225, 0.182, 0.120), vec3(0.150, 0.115, 0.072), grain);
        // 鼻緒。黒い布が二本
        float strap = smoothstep(0.016, 0.009, abs(abs(p.z - gc.z) - 0.040))
                    * step(abs(p.x - gc.x), 0.042) * step(0.055, n.y);
        w = mix(w, vec3(0.038, 0.032, 0.034), strap);
        col = wetten(w * (uSunColor * max(dot(n, uSunDir), 0.0) * 0.9
                        + skyAmbient(n) * 1.1 + nightGlow()), n, d, 0.40);
        depth = t2;
      }
      // 歯
      for(int e = 0; e < 2; e++){
        float sz = e == 0 ? -0.052 : 0.052;
        float t3 = hitBox(uCam, d, gc + vec3(0.0, 0.021, sz),
                          vec3(0.046, 0.021, 0.010), n);
        if(t3 > 0.0 && t3 < depth){
          col = vec3(0.132, 0.100, 0.062)
              * (uSunColor * max(dot(n, uSunDir), 0.0) * 0.7 + skyAmbient(n) * 1.0
               + nightGlow());
          depth = t3;
        }
      }
    }
  }

  // ---- 柱。縁側の端に立って軒を支える ----
  {
    float w = uPost.y;
    float tz = (edgeZ - uCam.z) / (abs(d.z) < 1e-5 ? 1e-5 : d.z);
    vec3 p = uCam + d * tz;
    // 二本のうち近いほうを見る
    float px = abs(p.x - uPost.x) < abs(p.x - uPostX2) ? uPost.x : uPostX2;
    if(tz > 0.0 && tz < depth && abs(p.x - px) < w && p.y > gy && p.y < uEave.x){
      float gr = fbm(vec2(p.y * 18.0, p.x * 40.0));
      vec3 w2 = mix(vec3(0.118, 0.082, 0.048), vec3(0.070, 0.046, 0.026), gr);
      w2 *= 0.88 + 0.26 * smoothstep(w * 0.55, w, abs(p.x - px));
      vec3 nn = vec3(0.0, 0.0, 1.0);
      col = w2 * (uSunColor * 0.22 + skyAmbient(nn) * 1.5
                + lanternLight(p, nn) + lanternAmbient(p));
      col += ggx(nn, -d, uSunDir, 0.30, vec3(0.035)) * uSunColor * PI * 0.3;
      depth = tz;
    }
  }

  // 遠くほど霞む。庭は 1〜4m しかないので、ごく薄く
  if(depth < 40.0) col = mix(col, uSkyHorizon * 0.55, smoothstep(5.0, 22.0, depth) * 0.6);

  // 線香の煙。
  //
  // 真っ直ぐ立つのは最初の 10cm ほどで、そこから先はよれて散る。
  // 蚊遣りを置いても煙が出ていなければ、ただの皿が置いてあるだけになる
  {
    float add = 0.0;
    for(int k = 0; k < 16; k++){
      float f = float(k) / 15.0;
      // 上へ行くほど大きく振れ、太く薄くなる
      float yaw2 = uTime * 0.55 + f * 6.0;
      vec2 sway = vec2(sin(yaw2), cos(yaw2 * 0.83)) * f * f * 0.085;
      // 煙は豚の横腹の穴から出る
      // 煙は、渦の燃えている先から立つ
      vec3 c = vec3(uKayari.x + 0.0585 + sway.x, uFloorY + 0.020 + f * 0.38,
                    uKayari.y + sway.y);
      float t = dot(c - uCam, d);
      if(t < 0.02 || t > depth) continue;
      float m = length(uCam + d * t - c);
      // 玉を 11 個しか置いていないのに半径 4mm では、
      // 光線がどの玉にもかすらず、煙が一度も出ていなかった
      float r = 0.013 + f * 0.055;
      add += smoothstep(r, 0.0, m) * (1.0 - f * 0.72) * 0.22;
    }
    if(add > 0.002){
      vec3 smoke = vec3(0.60, 0.585, 0.565)
                 * (skyAmbient(vec3(0.0, 1.0, 0.0)) * 1.25 + uSunColor * 0.16);
      col = mix(col, smoke, clamp(add, 0.0, 0.50));
    }
  }

  // 逆光のかぶり。
  //
  // 縁側は南を向くので、昼はいつも日を見込むことになる。
  // 空気そのものが光って、太陽の近くほど白くかぶり、影の黒も浮く。
  // これが無いと、どれだけ明るくしても「よく晴れた涼しい日」にしか見えない
  float toSun = max(dot(d, uSunDir), 0.0);
  float glare = (0.055 * pow(toSun, 5.0) + 0.016 * pow(toSun, 1.6))
              * uHaze * (1.0 - smoothstep(0.25, 0.80, uCloud.x));
  col += uSunColor * glare;
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
    // 粒の間に溜まる沈殿。餌の食べ残しと糞が茶色く沈む。
    // 洗いたての砂利しか無い水槽は、作った直後にしか無い
    col = mix(col, vec3(0.042, 0.032, 0.020),
              cav * smoothstep(0.30, 0.75, fbm(vW.xz * 40.0)) * 0.55 * uWear);
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
    // 下葉は日が届かず枯れ込んで茶色くなる。先の新しい葉ほど青い
    vec3 leaf = mix(vec3(0.050, 0.042, 0.022), vec3(0.058, 0.108, 0.034),
                    smoothstep(0.08, 0.55, up));
    // 古い葉には糸状の藻が絡む
    leaf = mix(leaf, vec3(0.052, 0.062, 0.028),
               smoothstep(0.55, 0.85, fbm(vW.xz * 180.0 + vW.y * 90.0))
             * (1.0 - up) * 0.60 * uWear);
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

  // 輪郭。面を真横から見ている所ほど光路が長く、縁が明るく縁取られる。
  //
  // これが無いと、見上げる角度でガラスがただの素通しになって、
  // 水の塊が宙に浮いているように見えていた。実物のガラスが
  // 「そこにある」と分かるのは、この縁取りと口の厚みのおかげ
  float grazing = pow(1.0 - ndv, 4.0);
  col += (envSpec(Rr, 0.02) * 0.55 + skyAmbient(Nf) * 0.30) * grazing;

  // ---- 使われた鉢の汚れ ----
  //
  // 下ろしたてのガラスは、作り物にしか見えない。鉢を「使っている物」に
  // するのは、拭き残しではなく水そのものが残した跡のほう。
  //
  //   水垢   … 蒸発して水位が下がるたび、その高さに白い輪が残る
  //   水滴跡 … 外側に跳ねた水が乾いて、硬水の白い斑点になる
  //   緑膜   … 内側の水面際、光の当たる所に藻が薄く張る
  //   埃     … 外側の上を向いた面にうっすら積もる
  {
    // 水垢の輪。いまの水位のすぐ上に、何本か重なって残る
    float scale = 0.0;
    for(int k = 0; k < 3; k++){
      float h = uWaterY + 0.0035 + float(k) * 0.0052;
      scale += smoothstep(0.0022, 0.0, abs(vW.y - h)) * (1.0 - float(k) * 0.26);
    }
    scale *= 0.55 + 0.45 * fbm(vec2(atan(vW.z, vW.x) * 3.4, vW.y * 60.0));
    // 乾いた水滴の跡。外側だけ
    float spot = smoothstep(0.66, 0.84, fbm(vec2(atan(vW.z, vW.x) * 7.0, vW.y * 42.0)))
               * float(outer);
    col = mix(col, col * 0.86 + vec3(0.085, 0.088, 0.086),
              clamp(scale * 0.80 + spot * 0.22, 0.0, 0.75) * uWear);

    // 内側の緑膜。水面から少し下まで、日の当たる側に出る
    float algae = smoothstep(0.052, 0.004, uWaterY - vW.y) * under
                * smoothstep(0.35, 0.80, fbm(vec2(atan(vW.z, vW.x) * 5.0, vW.y * 26.0)))
                * clamp(dot(Nf, uSunDir) * 0.5 + 0.5, 0.0, 1.0);
    col = mix(col, col * 0.72 + vec3(0.016, 0.040, 0.012), algae * 0.50 * uWear);

    // 埃。外側の上を向いた面
    col = mix(col, col * 0.90 + vec3(0.030, 0.029, 0.027),
              dust(Nf, vW.xz * 7.0) * 0.16 * float(outer));
  }

  // ガラスは 1 枚で仕上げる。混ぜない。
  // 中身は uScene から読み直しているので、ここで下地を透かす必要がない
  frag = vec4(col, 1.0);
}`;
