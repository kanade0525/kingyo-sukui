// 金魚とポイのシェーダ。
//
// 金魚の形は頂点シェーダの中で作る。胴は u（頭→尾）と v（断面まわり）の
// 2 変数の関数で、ひれは同じ関数の別の枝。こうしておくと、法線も
// その場で差分を取るだけで出せるし、泳ぎのうねりを形と一緒にかけられる。
//
// ひれは不透明に描く。水中パスの α にはカメラからの距離を入れていて、
// ブレンドすると距離が壊れ、水面の屈折が狂うため。薄さは色で表す。

import { HEAD, NOISE, SKYLIB, AMBIENT, WATERLIB, CAUSTICS } from './common.js?v=202610030002';

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
  // 和金。フナ型
  float slim = 0.248 * (1.0 - smoothstep(0.50, 0.93, u) * 0.88)
             * (0.60 + 0.40 * sin(3.14159265 * clamp(u / 0.72, 0.0, 1.0)));
  // 琉金型。重心が前に寄った、短くて深い胴
  float fat = 0.360 * (1.0 - smoothstep(0.38, 0.86, u) * 0.93)
            * (0.42 + 0.58 * sin(3.14159265 * clamp(u / 0.58, 0.0, 1.0)));
  return nose * mix(slim, fat, uFancy);
}

vec3 shapeOf(float u, float v, int part){
  if(part == 0){
    float ang = v * 6.2831853;
    float ca = cos(ang), sa = sin(ang);
    float r = prof(u);
    float bulge = 1.0 + uBulge * exp(-pow((u - 0.105) / 0.075, 2.0)) * abs(sa);
    return vec3(0.5 - u, ca * r * (1.16 - 0.13 * ca) * bulge, sa * r * 0.74 * bulge);
  }
  if(part == 1){
    // 尾びれ。
    //
    // 縦一枚の板にしていたが、真上から見る絵ではそれは線にしか写らない。
    // 実物の尾は尾柄から後ろへ開く「裾」で、三つ尾・四つ尾なら
    // 何枚かの葉に割れて横にも大きく広がる。真上から金魚だと分かるのは、
    // だいたいこの広がりのおかげ。
    //
    // 全長は体長の 2〜2.5 倍になるので、尾は胴と同じくらい長い。
    // v を尾の軸まわりの角 として一周させ、裾を張る。
    float s = u;
    float th = v * 6.2831853;
    float base0 = prof(0.88) * 1.05;                 // 尾柄の太さ
    // 葉の切れ込み。縁日の小赤は三つ尾が多く、出目金は四つ尾。
    // 切れ込みを浅くすると、扇ではなく袋のような塊になる
    float lobes = mix(3.0, 4.0, uFancy);
    float cut = 1.0 - mix(0.52, 0.42, uFancy) * pow(abs(sin(th * lobes * 0.5)), 0.85);
    float R = (base0 + mix(0.185, 0.275, uFancy) * pow(s, 0.62)) * cut;
    // 縦に長く、横はやや狭い。それでも真上から面として見えるだけの幅は要る
    float wz = mix(0.66, 0.92, uFancy);
    // 泳ぐと裾が波打つ
    float wave = 0.026 * s * s * sin(th * 2.0 + uTime * uBeat * 0.6 + uPhase);
    return vec3(-0.345 - mix(0.33, 0.52, uFancy) * s + wave,
                cos(th) * R * 1.28,
                sin(th) * R * wz);
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

/** 泳ぎのうねり。尾へ行くほど大きく、頭もわずかに振れる。 */
vec3 swim(vec3 p){
  float s = clamp((0.5 - p.x) / 1.3, 0.0, 1.0);
  p.z += 0.055 * s * s * sin(p.x * 7.5 - uTime * uBeat + uPhase);
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
${AMBIENT}
${WATERLIB}
${CAUSTICS}
in vec3 vW;
in vec3 vN;
in vec2 vUv;
in float vDist;
flat in int vPart;
uniform vec3 uCam;
uniform int uKind;        // 0 小赤 / 1 黒出目金 / 2 更紗出目金
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
      // 黒出目金。黒天鵞絨に、斜めから見ると青銅の照り
      base = vec3(0.030, 0.025, 0.034) + vec3(0.085, 0.045, 0.020) * pow(1.0 - ndv, 2.5);
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
    vec2 e1 = vec2((u - 0.100) * 2.6, v - 0.195);
    vec2 e2 = vec2((u - 0.100) * 2.6, v - 0.805);
    float eye = min(length(e1), length(e2));
    float eyeR = uKind == 0 ? 0.029 : 0.050;   // 出目金は目が張り出す
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
    vec3 root = uKind == 1 ? vec3(0.030, 0.025, 0.034)
              : uKind == 2 ? vec3(0.520, 0.170, 0.095)
                           : vec3(0.600, 0.135, 0.016);
    // 先を明るくしすぎると、真上を向いた尾の面だけが白茶けて、
    // 胴とは別の白い扇が付いているように見える。胴の色から離さない
    vec3 tip  = uKind == 1 ? vec3(0.062, 0.052, 0.070)
              : uKind == 2 ? vec3(0.560, 0.290, 0.210)
                           : vec3(0.690, 0.215, 0.062);
    float across = vPart == 1 ? v : (vPart == 2 || vPart == 5 ? u : v);
    // 更紗は、ひれにも緋と白が斑に出る
    if(uKind == 2){
      float fn = fbm(vec2(along * 5.0 + uSeed * 17.0, across * 4.0));
      root = mix(root, vec3(0.520, 0.480, 0.430), smoothstep(0.46, 0.56, fn));
      tip = mix(tip, vec3(0.620, 0.580, 0.530), smoothstep(0.46, 0.56, fn));
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

  vec3 lit = underSun(N) * caus + underAmbient(N);

  // ひれは薄い膜で、光を透かして散らす。向きで受け止める量が決まる
  // 不透明な面として扱うと、垂直に立った尾びれに真上からの光が
  // 一切当たらず、胴だけ明るい「別の黒い塊」が並んで見える。
  // 向きによらず周りの明るさを拾う形へ寄せ、付け根だけ胴と同じにする
  if(vPart != 0){
    vec3 up = vec3(0.0, 1.0, 0.0);
    // 散らした光に寄せすぎると、真上を向いた面だけが強く光って
    // 色が抜け、胴とは別の白っぽい扇に見える。胴が受けている光を
    // 下敷きにして、散乱ぶんを足す形にする
    vec3 scattered = (underSun(up) * caus * 0.42 + underAmbient(up)) * 0.70;
    lit = mix(lit, max(lit, scattered), 0.30 * smoothstep(0.0, 0.6, along) + 0.22);
  }
  float up = N.y * 0.5 + 0.5;                      // 背のほうが明るい
  vec3 col = base * lit * (0.80 + 0.30 * up);
  // ひれは薄くて照りが乗らない。胴だけ光らせる。
  // ここを胴と同じにすると、ひれ一面に鏡面が乗ってセロファンに見える
  float gloss = vPart == 0 ? 0.8 : 0.03;
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
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vRegion;
out float vDist;

vec3 rotAxis(vec3 p, vec3 a, float ang){
  float c = cos(ang), s = sin(ang);
  return p * c + cross(a, p) * s + a * dot(a, p) * (1.0 - c);
}

void main(){
  vec3 p = aPos;
  vUv = aPos.xz / uRadius;
  if(aRegion < 0.5){
    // 水と金魚の重みで中央が落ちる
    float r = clamp(length(vUv), 0.0, 1.0);
    p.y -= uSag * (1.0 - r * r);
  }
  p = rotAxis(p, uTiltAxis, uTilt) + uPos;
  vW = p;
  vN = rotAxis(aNrm, uTiltAxis, uTilt);
  vRegion = aRegion;
  vDist = distance(p, uCam);
  gl_Position = uVP * vec4(p, 1.0);
}`;

export const FS_POI = `${HEAD}
${NOISE}
${SKYLIB}
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
    // 紙は光を透かす
    // 和紙は光を透かす。裏から回った分を足す
    // 和紙は光を透かす。表から当たる分と、裏へ回って透けてくる分を足す。
    // 反射率 0.75 の紙なので、両方を足しても 1 を大きく超えないようにする
    vec3 lit = uSunColor * max(dot(N, uSunDir), 0.0) * 0.45
             + uSunColor * max(dot(-N, uSunDir), 0.0) * 0.30
             + skyAmbient(N) * 0.6;
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
    col = mix(col, col * 0.55 + vec3(0.26, 0.17, 0.16), wear * 0.30);

    col = col * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N));
    // つるりとした樹脂。芯のある白いハイライトが 1 点だけ乗る。
    // 反射色は白のまま。赤を混ぜると金属に見える
    col += ggx(N, V, uSunDir, 0.085, vec3(0.045)) * uSunColor * PI * 1.15;
    // 縁の照り返し
    col += vec3(0.30, 0.10, 0.09) * pow(1.0 - ndv, 4.0) * 0.5 * skyAmbient(N);
    alpha = 1.0;
  }

  // 水中パスでは α にカメラからの距離を入れる（水面の屈折がこれを読む）。
  // 混ぜられないので、薄い所はディザで抜く
  if(uUnderwater == 1){
    if(alpha < 0.985 && fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453) > alpha) discard;
    frag = vec4(col, vDist);
    return;
  }
  frag = vec4(col, alpha);
}`;
