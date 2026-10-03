// 金魚とポイのシェーダ。
//
// 金魚の形は頂点シェーダの中で作る。胴は u（頭→尾）と v（断面まわり）の
// 2 変数の関数で、ひれは同じ関数の別の枝。こうしておくと、法線も
// その場で差分を取るだけで出せるし、泳ぎのうねりを形と一緒にかけられる。
//
// ひれは不透明に描く。水中パスの α にはカメラからの距離を入れていて、
// ブレンドすると距離が壊れ、水面の屈折が狂うため。薄さは色で表す。

import { HEAD, NOISE, MATERIAL, SKYLIB, AMBIENT, WATERLIB, CAUSTICS } from './common.js?v=202610031304';

// ---------------------------------------------------------------- 金魚

export const VS_FISH = `${HEAD}
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
uniform float uBulge;     // 出目金の目の張り出し
uniform float uBend;      // 旋回中の体の曲がり
uniform float uFancy;     // 0 = 和金型（細長い）, 1 = 琉金型（短く丸い）
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vDist;
flat out int vPart;

/**
 * 胴の半径。鼻先で丸まり、腹で膨らみ、尾柄で細る。
 *
 * 小赤（和金）はフナ型で細長い。出目金は琉金から出た品種なので、
 * 胴が短くて卵のように丸い。この二つを同じ形で描くと、
 * 色違いの同じ魚にしか見えない。
 */
float prof(float u){
  float nose = smoothstep(0.0, 0.13, u);
  // 和金。フナ型。
  //
  // 0.248 にしていたら、体高と体長の比が 1:1.74 になっていた。
  // 実際の和金はフナ型で、体高は体長のおよそ 1/3（1:3）。
  // 縁日の小赤は若い個体なのでなおさら細く、真上から見ると
  // 紡錘形の筋に見える。ぷっくりして見えたのはここ。
  float slim = 0.152 * (1.0 - smoothstep(0.50, 0.93, u) * 0.88)
             * (0.60 + 0.40 * sin(3.14159265 * clamp(u / 0.72, 0.0, 1.0)));
  // 琉金型。重心が前に寄った、短くて深い胴。
  // こちらは本当に丸いが、0.360 だと体高が体長を超えかけていた（1:1.2）。
  // 琉金・出目金でも 1:1.4 ほどなので、そこへ寄せる
  // 頭は小さい。ここを太くすると、張り出した目が胴に埋もれて見えなくなる
  float fat = 0.308 * (1.0 - smoothstep(0.38, 0.86, u) * 0.93)
            * (0.42 + 0.58 * sin(3.14159265 * clamp(u / 0.58, 0.0, 1.0)))
            * (0.56 + 0.44 * smoothstep(0.04, 0.34, u));
  return nose * mix(slim, fat, uFancy);
}

vec3 shapeOf(float u, float v, int part){
  if(part == 0){
    float ang = v * 6.2831853;
    float ca = cos(ang), sa = sin(ang);
    float r = prof(u);
    vec3 p = vec3(0.5 - u, ca * r * (1.16 - 0.13 * ca), sa * r * 0.74);

    // 出目金の目。
    //
    // 頭の両脇に、ほとんど体高の半分もある球が張り出している。
    // これが出目金を出目金たらしめているので、胴の半径を一様に膨らませる
    // のではなく、球そのものを足す。膨らませるだけだと真上から見たとき
    // 「頭が太い魚」にしかならず、目が見えない。
    //
    // 和の取り方は、体の軸から出た光線に沿って「遠いほう」を採る。
    // 球に入った頂点を単に球面へ押し出すと、手前側の面へ寄ってしまい、
    // かえって胴がへこむ。
    if(uBulge > 0.01){
      vec3 axis = vec3(0.5 - u, 0.0, 0.0);
      vec3 ray = p - axis;
      float tb = length(ray);
      if(tb > 1e-5){
        vec3 dir = ray / tb;
        float er = 0.098 * uBulge / 0.55;
        float tmax = tb;
        for(int k = 0; k < 2; k++){
          vec3 oc = vec3(0.5 - 0.112, -0.006, k == 0 ? 0.120 : -0.120) - axis;
          float b2 = dot(oc, dir);
          float disc = b2 * b2 - dot(oc, oc) + er * er;
          if(disc > 0.0) tmax = max(tmax, b2 + sqrt(disc));
        }
        p = axis + dir * tmax;
      }
    }
    return p;
  }
  if(part == 1){
    // 尾びれ。
    //
    // 魚の尾は縦に立った薄い一枚で、これは解剖学的に動かせない。
    // 尾柄から後ろへ開く「裾」として筒で作ってみたが、真上から見ると
    // 丸い瘤にしかならず、尾に見えなかった。
    //
    // 真上から尾が尾に見えるのは、上下の葉の先が左右へ反っているから。
    // 縁日の小赤は二叉のフナ尾、出目金は四つ尾で、どちらも先が開く。
    //
    // 寸法。「全長は体長の 2〜2.5 倍」と書いて尾を胴と同じ長さにして
    // いたが、これは誤り。和金の尾は体長のおよそ 1/3 で、全長は体長の
    // 1.35 倍ほどしかない。胴を細く直したら、小さな体に大きな扇が
    // 付いた形になって目立つようになった。
    // 尾の広がりも体高の 2.0 倍あった。和金は体高と同じくらい。
    float s = u, t = v * 2.0 - 1.0;                  // t: -1 下葉 .. +1 上葉
    float base0 = prof(0.88) * 1.05;                 // 尾柄の太さ
    float len = mix(0.42, 0.72, uFancy);
    float spread = base0 + mix(0.190, 0.400, uFancy) * pow(s, 0.60);
    // 後ろの縁の切れ込み。中央がえぐれて二叉になる
    float fork = 1.0 - mix(0.46, 0.26, uFancy)
               * exp(-pow(t / 0.32, 2.0)) * smoothstep(0.15, 1.0, s);
    // 葉の先が外へ反る。これが無いと、真上から見たとき尾が線になる
    float curl = mix(0.64, 0.84, uFancy) * s * s * smoothstep(0.20, 1.0, abs(t));
    // 泳ぐと裾が波打つ。
    //
    // t に 2.4 を掛けていたので、尾の上下方向にも波が 0.76 周ぶん入り、
    // 上葉と下葉が逆へ動いていた。おまけに uBeat に 0.6 を掛けていたので、
    // 胴とは違う周期でゆっくりずれ続ける。どちらも膜の動きではない。
    //
    // 実際の尾は、胴と同じ周期で振られ、膜が水に押されて少し遅れる。
    // 波は 0.3 周ぶんに収め、周期は胴に合わせて、遅れだけを位相で入れる。
    float wave = 0.017 * s * s * sin(t * 0.9 + uTime * uBeat + uPhase - 1.15);
    return vec3(-0.345 - len * s * fork,
                t * spread,
                spread * curl * sign(t) + wave);
  }
  if(part == 2){              // 背びれ
    // 胴の背の高さは prof*(1.16-0.13)。ここを 1.16 にしていたため、
    // 背びれが胴から浮いて別の板に見えていた
    float uu = mix(0.26, 0.68, u);
    float back = prof(uu) * 1.03;
    // 背びれは真上から見ると細い尾根。わずかに横へ倒して面を見せる
    float h = v * mix(0.115, 0.090, uFancy) * sin(3.14159 * u) * (0.45 + 0.55 * (1.0 - u));
    return vec3(0.5 - uu, back + h, h * 0.22);
  }
  if(part == 5){              // 尻びれ
    float uu = mix(0.62, 0.84, u);
    float h = v * 0.062 * sin(3.14159 * u);
    return vec3(0.5 - uu, -prof(uu) * 1.28 - h, h * 0.30);
  }
  // 胸びれ。part 3 が右、4 が左
  // 胸びれ。胴の半径は y が r*1.16、z が r*0.74 なので、
  // その表面の上に根を置く
  // 胸びれ。真上から見ると、胴の脇から後ろ斜めへ張り出す一対の面。
  // 細い棒にすると見えないので、扇に開いて水平に寝かせる
  float side = part == 3 ? 1.0 : -1.0;
  float r = prof(mix(0.24, 0.30, uFancy));
  vec3 root = vec3(0.5 - mix(0.24, 0.30, uFancy), -r * 0.30, side * r * 0.70);
  // 漕ぐ。左右で逆位相
  float row = sin(uTime * uBeat * 0.55 + uPhase + (side > 0.0 ? 0.0 : 3.14159)) * 0.22;
  vec3 dir = vec3(-0.17, -0.030 + row * 0.10, side * (0.115 + row * 0.05));
  vec3 wid = vec3(0.052, 0.012, side * 0.030);
  return root + dir * u + wid * (v - 0.5) * (0.26 + 0.74 * sin(3.14159 * clamp(u * 0.8 + 0.2, 0.0, 1.0)));
}

/**
 * 泳ぎのうねり。尾へ行くほど大きく、頭もわずかに振れる。
 *
 * 波数を 7.5 にしていた。胴（長さ 1.0）だけで 1.2 周、尾びれ（0.68）の
 * 中だけでも 0.8 周ぶん入る計算で、薄い一枚の尾が自分の中で S 字に
 * くねっていた。魚の尾は膜なので、そういう動き方はしない。
 *
 * 金魚は亜アジ型で、胴に入る波は 1 周に満たない。3.7 にすると
 * 胴で 0.59 周。尾柄より後ろは、膜が付け根に引かれて遅れるだけなので、
 * 位相の進みを 1/3 に落とす（尾の中では 0.13 周）。
 */
const float TAILX = -0.345;      // 尾柄の位置

vec3 swim(vec3 p){
  float s = clamp((0.5 - p.x) / 1.3, 0.0, 1.0);
  float xe = p.x > TAILX ? p.x : TAILX + (p.x - TAILX) * 0.33;
  p.z += 0.055 * s * s * sin(xe * 3.7 - uTime * uBeat + uPhase);
  p.z += 0.007 * sin(-uTime * uBeat + uPhase);
  p.z += uBend * s * s;                       // 旋回で内側へ曲がる
  return p;
}

vec3 toWorld(vec3 p){
  p *= uLen;
  float c = cos(uYaw), s = sin(uYaw);
  return vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c) + uPos;
}

void main(){
  int part = int(aPart + 0.5);
  float e = 0.012;
  vec3 p  = swim(shapeOf(aUv.x, aUv.y, part));
  vec3 pu = swim(shapeOf(min(aUv.x + e, 1.0), aUv.y, part));
  vec3 pv = swim(shapeOf(aUv.x, aUv.y + e, part));

  vec3 n = cross(pu - p, pv - p);
  float nl = length(n);
  n = nl > 1e-7 ? n / nl : vec3(0.0, 1.0, 0.0);

  vec3 w = toWorld(p);
  float c = cos(uYaw), s = sin(uYaw);
  vW = w;
  vN = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  vUv = aUv;
  vPart = part;
  vDist = distance(w, uCam);
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const FS_FISH = `${HEAD}
${NOISE}
${SKYLIB}
${MATERIAL}
${AMBIENT}
${WATERLIB}
${CAUSTICS}
in vec3 vW;
in vec3 vN;
in vec2 vUv;
in float vDist;
flat in int vPart;
uniform vec3 uCam;
uniform int uKind;        // 0 小赤 / 1 小黒 / 2 黒出目金 / 3 更紗出目金
uniform float uSeed;
out vec4 frag;

/**
 * 鱗。行ごとに半分ずらした六角格子ふうの並び。
 * 戻り値は「鱗の中心ほど 1、継ぎ目で 0」。
 *
 * 実物を真上から見ると、鱗はほとんど目立たない。濡れた体の照りのほうが
 * ずっと強く出る。粒を細かく・濃く描くと松ぼっくりや甲虫に見えるので、
 * 粒は大きく、濃さはごく薄くしてある。
 */
float scales(vec2 uv){
  vec2 g = vec2(uv.x * 14.0, uv.y * 10.0);
  g.x += 0.5 * floor(g.y);
  vec2 f = fract(g) - 0.5;
  float d = length(f * vec2(1.0, 1.25));
  return smoothstep(0.54, 0.30, d);
}

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  // 胴は閉じた面なので、頂点側で作った外向き法線をそのまま信じる。
  // gl_FrontFacing で裏返すと、三角形の巻き方向しだいで体の半分が影になる。
  // ひれは薄い一枚なので、見ている側へ向け直す
  if(vPart != 0 && dot(N, V) < 0.0) N = -N;
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  float u = vUv.x, v = vUv.y;
  vec3 base;
  // ひれの「付け根からの距離」。色の繋がりと、膜の薄さの両方に使う
  float along = vPart == 1 ? u : (vPart == 2 || vPart == 5 ? v : u);

  if(vPart == 0){
    float ang = v * 6.2831853;
    float up = cos(ang) * 0.5 + 0.5;               // 背が 1、腹が 0
    float side = abs(sin(ang));                    // 横腹ほど 1

    if(uKind == 0){
      // 小赤。背の濃い緋から、横腹の朱、腹の淡い金へ
      vec3 back  = vec3(0.330, 0.052, 0.008);
      vec3 flank = vec3(0.600, 0.135, 0.016);
      vec3 belly = vec3(0.660, 0.430, 0.200);
      base = mix(belly, flank, smoothstep(0.08, 0.52, up));
      base = mix(base, back, smoothstep(0.58, 0.95, up));
    } else if(uKind == 1){
      // 小黒。和金型の黒い金魚。出目金の黒天鵞絨より、やや鉄っぽい。
      // 真上から形が読める程度には明るさを残す
      base = vec3(0.048, 0.046, 0.052)
           + vec3(0.070, 0.058, 0.040) * pow(1.0 - ndv, 2.0)
           + vec3(0.035, 0.034, 0.033) * up;
    } else if(uKind == 2){
      // 黒出目金。黒天鵞絨に、斜めから見ると青銅の照り。
      // 真っ黒にすると真上から形がまるで読めず、黒い塊になる。
      // 実物も、光が当たる面はうっすら茶を帯びて明るい
      base = vec3(0.058, 0.048, 0.062)
           + vec3(0.115, 0.062, 0.028) * pow(1.0 - ndv, 2.2)
           + vec3(0.040, 0.034, 0.030) * up;
    } else {
      // 更紗出目金。白地に緋の斑。境目は実物どおり硬い。
      // 白が勝ちすぎると、真上から見たとき白い影がよぎるようにしか
      // 見えないので、緋のほうを多めに取る（実物も背中側は緋が多い）
      float n = fbm(vec2(u * 3.4 + uSeed * 13.0, v * 2.2 + uSeed * 7.0));
      float blotch = smoothstep(0.52, 0.44, n - up * 0.16);
      vec3 white = vec3(0.560, 0.520, 0.470);
      vec3 red   = vec3(0.565, 0.105, 0.016);
      base = mix(white, red, blotch);
      // 斑のふちだけ色が濃くなる
      base = mix(base, red * 0.72, smoothstep(0.46, 0.50, n) * (1.0 - blotch));
    }

    // 鱗。中心がわずかに明るい程度にとどめる
    float sc = scales(vec2(u, v));
    float amount = smoothstep(0.08, 0.26, u) * (1.0 - smoothstep(0.66, 0.92, u));
    base *= 1.0 + (sc - 0.5) * 0.13 * amount;
    // 体の照り。濡れた魚はここがいちばん目を引く
    float sheen = side * pow(1.0 - ndv, 1.6) * smoothstep(0.05, 0.30, u);
    float pearl = sheen * (0.75 + 0.25 * sc);

    // 目。白目のふちと黒い瞳、小さな写り込み
    // 目。出目金は横へ張り出した球の頂点に来るので、v が真横（0.25 / 0.75）
    float ev = uKind <= 1 ? 0.195 : 0.250;
    float eu = uKind <= 1 ? 0.100 : 0.118;
    vec2 e1 = vec2((u - eu) * 2.6, v - ev);
    vec2 e2 = vec2((u - eu) * 2.6, v - (1.0 - ev));
    float eye = min(length(e1), length(e2));
    float eyeR = uKind <= 1 ? 0.029 : 0.062;   // 出目金は目が張り出す
    base = mix(base, vec3(0.30, 0.25, 0.20), 1.0 - smoothstep(eyeR, eyeR * 1.14, eye));
    base = mix(base, vec3(0.012, 0.010, 0.013), 1.0 - smoothstep(eyeR * 0.74, eyeR * 0.88, eye));
    float glint = 1.0 - smoothstep(0.003, 0.008,
      min(length(e1 - vec2(0.009, -0.009)), length(e2 - vec2(0.009, -0.009))));
    base += vec3(0.42) * glint;

    base += vec3(0.62, 0.52, 0.45) * pearl * 0.20;
  } else {
    // ひれ。実物は薄くて向こうが透けるので、淡く、先ほど白くする。
    // 放射状の条（骨）を入れると、一枚の板に見えなくなる
    // ひれは胴と地続きに見える濃さにする。淡くすると、水の上で
    // 別の板が漂っているように見える
    // 付け根は胴と同じ色から始める。ここで色を落とすと、継ぎ目で値が飛んで
    // 「胴」と「別の黒い塊」が並んでいるように見える
    // ひれの色は、真上から見える「背」の色に揃える。
    //
    // 胴の背は暗い緋（小赤で 0.330, 0.052, 0.008）なのに、ひれの先を
    // その倍の明るさにしていた。真上から見るとこの二つが並ぶので、
    // 胴に白っぽい扇が別に付いているようにしか見えなかった。
    // 実物のひれは胴よりわずかに淡くて透けるが、倍も明るくはない。
    vec3 root = uKind == 1 ? vec3(0.034, 0.028, 0.038)
              : uKind == 2 ? vec3(0.430, 0.150, 0.090)
                           : vec3(0.440, 0.092, 0.018);
    vec3 tip  = uKind == 1 ? vec3(0.072, 0.060, 0.080)
              : uKind == 2 ? vec3(0.500, 0.250, 0.180)
                           : vec3(0.600, 0.175, 0.055);
    float across = vPart == 1 ? v : (vPart == 2 || vPart == 5 ? u : v);
    // 更紗は、ひれにも緋と白が斑に出る
    if(uKind == 3){
      float fn = fbm(vec2(along * 5.0 + uSeed * 17.0, across * 4.0));
      root = mix(root, vec3(0.390, 0.360, 0.325), smoothstep(0.46, 0.56, fn));
      tip = mix(tip, vec3(0.450, 0.420, 0.385), smoothstep(0.46, 0.56, fn));
    }
    base = mix(root, tip, smoothstep(0.0, 0.85, along));
    float ray = 0.84 + 0.16 * cos(across * 6.2831853 * (vPart == 1 ? 9.0 : 6.0));
    base *= ray * (0.94 + 0.10 * fbm(vec2(along * 12.0, across * 4.0)));
    // 付け根は胴と同じ濃さ、先だけわずかに透ける
    base *= 0.86 + 0.18 * pow(1.0 - ndv, 1.5);
  }

  // 水中にいる間は、水面で結んだ光の網が体にも落ちる。
  // これが無いと、水の上に貼ったシールに見える
  vec3 caus = vec3(1.0);
  if(vW.y < -0.002){
    float below = -vW.y;
    vec2 entry = vW.xz + uSunHoriz * below * uRefrTan;
    caus = mix(vec3(1.0), caustics(vW.xz, below), edgeMask(entry));
  }

  vec3 lit = underSun(N) * caus + underAmbient(N) + underLantern(vW, N);

  // ひれは薄い膜で、光を透かして散らす。向きで受け止める量が決まる
  // 不透明な面として扱うと、垂直に立った尾びれに真上からの光が
  // 一切当たらず、胴だけ明るい「別の黒い塊」が並んで見える。
  // 向きによらず周りの明るさを拾う形へ寄せ、付け根だけ胴と同じにする
  if(vPart != 0){
    vec3 up = vec3(0.0, 1.0, 0.0);
    // ひれは薄い膜で、光を透かして散らす。
    //
    // 縦に立った尾を不透明な面として扱うと、真上からは面が横を向いて
    // いるので光が一切当たらず、胴の後ろに黒い板が付いて見える。
    // 実物の尾が真上から見えるのは、透かした光で明るんでいるから。
    // 向きによらず上からの光を拾う形に寄せる。
    // ただし寄せすぎると今度は白く浮くので、胴の受けている光より
    // ほんの少し明るい、くらいで止める
    vec3 scattered = (underSun(up) * caus * 0.52 + underAmbient(up)) * 0.82;
    lit = mix(lit, max(lit, scattered), 0.62 * smoothstep(0.0, 0.5, along) + 0.34);
  }
  float up = N.y * 0.5 + 0.5;                      // 背のほうが明るい
  vec3 col = base * lit * (0.80 + 0.30 * up);
  // ひれは薄くて照りが乗らない。胴だけ光らせる。
  // ここを胴と同じにすると、ひれ一面に鏡面が乗ってセロファンに見える
  float gloss = vPart == 0 ? (uKind >= 1 && uKind <= 2 ? 1.4 : 0.8) : 0.03;
  float grough = vPart == 0 ? 0.24 : 0.55;
  col += ggx(N, V, underSunDir(), grough, vec3(0.035)) * uSunColor * gloss * PI;
  col += base * pow(1.0 - ndv, 4.0) * 0.10 * lit;  // 縁の照り返し

  frag = vec4(col, vDist);
}`;

// ---------------------------------------------------------------- ポイ

export const VS_POI = `${HEAD}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in float aRegion;
uniform mat4 uVP;
uniform vec3 uCam;
uniform vec3 uPos;
uniform vec3 uTiltAxis;
uniform float uTilt;
uniform float uSag;        // 紙のたわみ
uniform float uRadius;
uniform float uYaw;        // カメラの向き。柄がいつも画面の手前を向くように回す
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vRegion;
out float vDist;

vec3 rotAxis(vec3 p, vec3 a, float ang){
  float c = cos(ang), s = sin(ang);
  return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}

vec3 rotY(vec3 p, float a){
  float c = cos(a), s = sin(a);
  return vec3(p.x * c + p.z * s, p.y, -p.x * s + p.z * c);
}

void main(){
  vec3 p = aPos;
  vUv = aPos.xz / uRadius;
  if(aRegion < 0.5){
    // 水と金魚の重みで中央が落ちる
    float r = clamp(length(vUv), 0.0, 1.0);
    p.y -= uSag * (1.0 - r * r);
  }
  p = rotAxis(rotY(p, uYaw), uTiltAxis, uTilt) + uPos;
  vW = p;
  vN = rotAxis(rotY(aNrm, uYaw), uTiltAxis, uTilt);
  vRegion = aRegion;
  vDist = distance(p, uCam);
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const FS_POI = `${HEAD}
${NOISE}
${SKYLIB}
${MATERIAL}
${AMBIENT}
in vec3 vW;
in vec3 vN;
in vec2 vUv;
in float vRegion;
in float vDist;
uniform vec3 uCam;
uniform int uUnderwater;   // 1 = 水中パス。α には距離を入れる
uniform float uHealth;     // 1 = 新品, 0 = 破れきり
uniform float uWet;        // 0 = 乾き, 1 = ずぶ濡れ
uniform float uSeed;
out vec4 frag;

void main(){
  int region = int(vRegion + 0.5);
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  if(dot(N, V) < 0.0) N = -N;     // 紙も枠も薄いので、見ている側へ向け直す
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  vec3 col;
  float alpha;

  if(region == 0){
    // 和紙。破れは中心から広がる
    float r = clamp(length(vUv), 0.0, 1.0);
    float n = fbm(vUv * 5.2 + uSeed * 9.0);
    float thr = (1.0 - uHealth) * 1.06;
    if(n * 0.60 + r * 0.40 < thr) discard;
    // 破れ口のまわりは毛羽立って濃くなる
    float lip = smoothstep(thr, thr + 0.09, n * 0.60 + r * 0.40);

    // 和紙。漉いたときの繊維が、長い節になって残る
    float fiber = 0.90 + 0.10 * fbm(vUv * vec2(34.0, 9.0) + 2.0);
    float knot = smoothstep(0.62, 0.80, fbm(vUv * vec2(60.0, 14.0) + 7.0));
    vec3 dry = vec3(0.78, 0.745, 0.705);
    vec3 wet = vec3(0.60, 0.565, 0.545);
    col = mix(dry, wet, uWet) * fiber;
    col = mix(col, col * 1.12 + 0.02, knot * 0.5);     // 節は少し白い
    // 濡れた所は斑に透ける
    col *= 1.0 - uWet * 0.18 * smoothstep(0.45, 0.72, fbm(vUv * 7.0 + 3.0));
    col = mix(vec3(0.72, 0.56, 0.48), col, lip);
    // 前の客が使った紙。手の脂で曇った所と、毛羽立ちが残る
    col = grime(col, smoothstep(0.48, 0.80, fbm(vUv * 3.1 + 11.0)), vec3(0.50, 0.45, 0.40), 0.38);
    // 紙は光を透かす
    // 和紙は光を透かす。裏から回った分を足す
    // 和紙は光を透かす。表から当たる分と、裏へ回って透けてくる分を足す。
    // 反射率 0.75 の紙なので、両方を足しても 1 を大きく超えないようにする
    vec3 lit = uSunColor * max(dot(N, uSunDir), 0.0) * 0.45
             + uSunColor * max(dot(-N, uSunDir), 0.0) * 0.30
             + skyAmbient(N) * 0.6
             + (lanternLight(vW, N) + lanternLight(vW, -N) * 0.6) * 0.75
             + lanternAmbient(vW) * 0.8;
    col *= lit;
    col += ggx(N, V, uSunDir, 0.30, vec3(0.03)) * uSunColor * uWet * PI;
    alpha = mix(0.72, 0.42, uWet) * (0.55 + 0.45 * lip);
    alpha = mix(alpha, 1.0, pow(1.0 - ndv, 3.0) * 0.4);
  } else {
    // 枠と柄。縁日のポイは、輪と持ち手がひと続きの赤い成形品。
    //
    // 竹や木ではない。ポリスチレンを赤く着色して一発で抜いたもので、
    // 見分けの手掛かりは、彩度の高い赤・つるりとした艶・型の合わせ目・
    // それに柄の真ん中を通る補強のリブ。
    // 赤に緑や青を混ぜると銅に見えてしまうので、彩度は落とさない。
    vec3 red = vec3(0.520, 0.030, 0.026);
    col = red;
    // 成形品の肌。むらはごく薄い
    col *= 0.96 + 0.07 * fbm(vUv * 48.0);

    if(region == 1){
      // 輪。外周を一周する金型の合わせ目
      float ring = length(vUv);
      float parting = 1.0 - smoothstep(0.0, 0.030, abs(ring - 1.03));
      col *= 1.0 - parting * 0.26;
    } else {
      // 柄。中央に補強のリブが 1 本通る
      float rib = 1.0 - smoothstep(0.0, 0.16, abs(vUv.y - 0.5));
      col *= 1.0 + rib * 0.20;
      // 握った所は手垢で艶が落ちる
      col *= 0.93 + 0.12 * smoothstep(0.35, 0.72, fbm(vUv * 5.0 + 9.0));
    }

    // 使い込んで擦れた所は、樹脂が白化して色が抜ける
    float wear = smoothstep(0.62, 0.88, fbm(vUv * 13.0 + 4.0));
    col = mix(col, col * 0.55 + vec3(0.26, 0.17, 0.16), wear * 0.30 + scratch(vUv * 0.4, 0.6, 1.4) * 0.26);
    // 何度も水に浸かった枠には、乾いた水垢が白く残る
    col = mix(col, col * 0.62 + vec3(0.21, 0.17, 0.16), waterMark(vUv * 0.5, 7.0) * 0.26);

    col = col * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N)
               + lanternLight(vW, N) + lanternAmbient(vW));
    // つるりとした樹脂。芯のある白いハイライトが 1 点だけ乗る。
    // 反射色は白のまま。赤を混ぜると金属に見える
    col += ggx(N, V, uSunDir, 0.085, vec3(0.045)) * uSunColor * PI * 1.15;
    // 縁の照り返し
    col += vec3(0.30, 0.10, 0.09) * pow(1.0 - ndv, 4.0) * 0.5 * skyAmbient(N);
    alpha = 1.0;
  }

  // 水中パスでは α にカメラからの距離を入れる（水面の屈折がこれを読む）。
  //
  // 混ぜられないので、以前は薄い所を画素ごとの乱数で抜いていた。
  // それが紙と枠の上に点々のノイズとして出ていた。縁の滑らか化を
  // 入れると多重標本がその点を拾って、点線状の筋にまで育っていた。
  //
  // 水に沈んだ和紙は水を吸って、ほとんど向こうが見えない。
  // 抜かずに塗ってしまってよい。
  if(uUnderwater == 1){
    frag = vec4(col, vDist);
    return;
  }
  frag = vec4(col, alpha);
}`;
