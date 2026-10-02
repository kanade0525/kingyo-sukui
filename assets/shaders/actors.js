// 金魚とポイのシェーダ。
//
// 金魚の形は頂点シェーダの中で作る。胴は u（頭→尾）と v（断面まわり）の
// 2 変数の関数で、ひれは同じ関数の別の枝。こうしておくと、法線も
// その場で差分を取るだけで出せるし、泳ぎのうねりを形と一緒にかけられる。
//
// ひれは不透明に描く。水中パスの α にはカメラからの距離を入れていて、
// ブレンドすると距離が壊れ、水面の屈折が狂うため。薄さは色で表す。

import { HEAD, NOISE, SKYLIB, AMBIENT, WATERLIB, CAUSTICS } from './common.js';

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
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vDist;
flat out int vPart;

/** 胴の半径。鼻先で丸まり、腹で膨らみ、尾柄で細る。 */
float prof(float u){
  float nose  = smoothstep(0.0, 0.13, u);
  float taper = 1.0 - smoothstep(0.50, 0.93, u);
  float belly = 0.60 + 0.40 * sin(3.14159265 * clamp(u / 0.72, 0.0, 1.0));
  return 0.255 * nose * (taper * 0.88 + 0.12) * belly;
}

vec3 shapeOf(float u, float v, int part){
  if(part == 0){
    float ang = v * 6.2831853;
    float ca = cos(ang), sa = sin(ang);
    float r = prof(u);
    float bulge = 1.0 + uBulge * exp(-pow((u - 0.105) / 0.075, 2.0)) * abs(sa);
    return vec3(0.5 - u, ca * r * (1.16 - 0.13 * ca) * bulge, sa * r * 0.74 * bulge);
  }
  if(part == 1){              // 尾びれ
    // 付け根は胴の尾柄の中から出す。胴より外から生やすと、
    // 隙間が開いて別の板が浮いているように見える
    float s = u, t = v * 2.0 - 1.0;
    float base0 = prof(0.88) * 1.05;                 // 尾柄の太さ
    float spread = base0 + 0.33 * pow(s, 0.78);
    return vec3(-0.36 - 0.50 * s, t * spread - 0.010 * s, 0.026 * s * s * sin(t * 2.2));
  }
  if(part == 2){              // 背びれ
    // 胴の背の高さは prof*(1.16-0.13)。ここを 1.16 にしていたため、
    // 背びれが胴から浮いて別の板に見えていた
    float uu = mix(0.26, 0.68, u);
    float back = prof(uu) * 1.03;
    return vec3(0.5 - uu, back + v * 0.105 * sin(3.14159 * u) * (0.45 + 0.55 * (1.0 - u)), 0.0);
  }
  if(part == 5){              // 尻びれ
    float uu = mix(0.62, 0.84, u);
    return vec3(0.5 - uu, -prof(uu) * 1.28 - v * 0.060 * sin(3.14159 * u), 0.0);
  }
  // 胸びれ。part 3 が右、4 が左
  // 胸びれ。胴の半径は y が r*1.16、z が r*0.74 なので、
  // その表面の上に根を置く
  float side = part == 3 ? 1.0 : -1.0;
  float r = prof(0.22);
  vec3 root = vec3(0.5 - 0.22, -r * 0.42, side * r * 0.64);
  vec3 dir  = vec3(-0.15, -0.050, side * 0.075);
  vec3 wid  = vec3(0.020, 0.048, 0.0);
  return root + dir * u + wid * (v - 0.5) * (0.22 + 0.78 * u);
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
uniform int uKind;        // 0 素赤 / 1 更紗 / 2 出目金
uniform float uSeed;
out vec4 frag;

/**
 * 鱗。行ごとに半分ずらした六角格子ふうの並び。
 * 戻り値は「鱗の中心ほど 1、継ぎ目で 0」。
 */
float scales(vec2 uv){
  vec2 g = vec2(uv.x * 23.0, uv.y * 17.0);
  g.x += 0.5 * floor(g.y);
  vec2 f = fract(g) - 0.5;
  float d = length(f * vec2(1.0, 1.25));
  return smoothstep(0.50, 0.26, d);
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
      // 素赤。背の濃い緋から、横腹の朱、腹の淡い金へ
      vec3 back  = vec3(0.330, 0.052, 0.008);
      vec3 flank = vec3(0.600, 0.135, 0.016);
      vec3 belly = vec3(0.660, 0.430, 0.200);
      base = mix(belly, flank, smoothstep(0.08, 0.52, up));
      base = mix(base, back, smoothstep(0.58, 0.95, up));
    } else if(uKind == 1){
      // 更紗。白地に緋の斑。境目は実物どおり硬い
      float n = fbm(vec2(u * 3.4 + uSeed * 13.0, v * 2.2 + uSeed * 7.0));
      float blotch = smoothstep(0.49, 0.53, n + up * 0.10);
      vec3 white = vec3(0.700, 0.665, 0.610);
      vec3 red   = vec3(0.565, 0.105, 0.016);
      base = mix(white, red, blotch);
      // 斑のふちだけ色が濃くなる
      base = mix(base, red * 0.72, smoothstep(0.46, 0.50, n) * (1.0 - blotch));
    } else {
      // 出目金。黒天鵞絨に、斜めから見ると青銅の照り
      base = vec3(0.030, 0.025, 0.034) + vec3(0.085, 0.045, 0.020) * pow(1.0 - ndv, 2.5);
    }

    // 鱗。中心が明るく、継ぎ目が暗い。頭と尾柄では小さくなる
    float sc = scales(vec2(u, v));
    float amount = smoothstep(0.05, 0.20, u) * (1.0 - smoothstep(0.72, 0.95, u));
    base *= 1.0 + (sc - 0.45) * 0.52 * amount;
    // 鱗の真珠光沢。横腹の、こちらを向いた面で強い
    float pearl = sc * amount * side * pow(1.0 - ndv, 1.5);

    // 目。白目のふちと黒い瞳、小さな写り込み
    vec2 e1 = vec2((u - 0.100) * 2.6, v - 0.195);
    vec2 e2 = vec2((u - 0.100) * 2.6, v - 0.805);
    float eye = min(length(e1), length(e2));
    float eyeR = uKind == 2 ? 0.062 : 0.038;
    base = mix(base, vec3(0.28, 0.24, 0.20), 1.0 - smoothstep(eyeR, eyeR * 1.22, eye));
    base = mix(base, vec3(0.012, 0.010, 0.013), 1.0 - smoothstep(eyeR * 0.74, eyeR * 0.88, eye));
    float glint = 1.0 - smoothstep(0.004, 0.011,
      min(length(e1 - vec2(0.012, -0.012)), length(e2 - vec2(0.012, -0.012))));
    base += vec3(0.55) * glint;

    base += vec3(0.55, 0.46, 0.40) * pearl * 0.16;
  } else {
    // ひれ。実物は薄くて向こうが透けるので、淡く、先ほど白くする。
    // 放射状の条（骨）を入れると、一枚の板に見えなくなる
    // ひれは胴と地続きに見える濃さにする。淡くすると、水の上で
    // 別の板が漂っているように見える
    // 付け根は胴と同じ色から始める。ここで色を落とすと、継ぎ目で値が飛んで
    // 「胴」と「別の黒い塊」が並んでいるように見える
    vec3 root = uKind == 2 ? vec3(0.030, 0.025, 0.034)
              : uKind == 1 ? vec3(0.600, 0.300, 0.230)
                           : vec3(0.600, 0.135, 0.016);
    vec3 tip  = uKind == 2 ? vec3(0.095, 0.078, 0.105)
              : uKind == 1 ? vec3(0.780, 0.480, 0.370)
                           : vec3(0.820, 0.340, 0.135);
    float across = vPart == 1 ? v : (vPart == 2 || vPart == 5 ? u : v);
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
    vec3 scattered = (underSun(up) * caus * 0.55 + underAmbient(up)) * 0.80;
    lit = mix(lit, scattered, 0.75 * smoothstep(0.0, 0.5, along) + 0.25);
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

    float fiber = 0.86 + 0.14 * fbm(vUv * vec2(26.0, 7.0) + 2.0);
    vec3 dry = vec3(0.78, 0.74, 0.70);
    vec3 wet = vec3(0.62, 0.58, 0.56);
    col = mix(dry, wet, uWet) * fiber;
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
  } else if(region == 1){
    // 枠。朱に塗った輪
    col = vec3(0.78, 0.17, 0.09);
    col *= 0.8 + 0.3 * fbm(vUv * 30.0);
    col = col * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N))
        + ggx(N, V, uSunDir, 0.20, vec3(0.05)) * uSunColor * PI;
    alpha = 1.0;
  } else {
    // 柄。竹
    float grain = fbm(vec2(vW.y * 70.0, 0.5)) * 0.5 + 0.5;
    col = mix(vec3(0.52, 0.42, 0.24), vec3(0.72, 0.62, 0.40), grain);
    col = col * (uSunColor * max(dot(N, uSunDir), 0.0) + skyAmbient(N))
        + ggx(N, V, uSunDir, 0.35, vec3(0.04)) * uSunColor * 0.6 * PI;
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
