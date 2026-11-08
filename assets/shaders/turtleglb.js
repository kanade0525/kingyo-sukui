// 立体の見本（GLB）で描くミドリガメ。
//
// 形は見本の網をそのまま使い、四肢の漕ぎだけ手描きのカメと同じ拍子で
// 付ける。見本は甲羅も四肢も 1 枚につながった網なので、部位の番号は無い。
// どの頂点が脚かは、読み込むときに甲羅の輪郭と比べて決め（renderer.js の
// fitTurtle）、「脚の番号 + 脚らしさ」として頂点に持たせてある。
// 脚は付け根のまわりに回す。頭と尾は位置で見分け、頭はわずかに上下し、尾は左右に振る。
//
// 色は見本の絵から取り、光（水中の日差し・光の網・行灯・照り）は
// 手描きのカメと同じ道具で当てる。

import { HEAD, NOISE, SKYLIB, AMBIENT, WATERLIB, CAUSTICS } from './common.js?v=202611082306';

export const VS_TURTLEGLB = `${HEAD}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
layout(location=3) in float aLimb;   // 脚の番号（整数部）+ 脚らしさ（小数部）
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

/**
 * 体の座標は甲長 1、甲羅の中心が原点、頭が +x、甲羅の中ほどの高さが y = 0。
 * 前脚の付け根は甲羅の前の縁のわき x = +0.45、後脚は x = -0.32、どちらも z = ±0.37。
 */
vec3 limbRoot(int li){
  float x = li < 2 ? 0.45 : -0.32;
  float z = (li == 0 || li == 2) ? 0.37 : -0.37;
  return vec3(x, -0.09, z);
}

void main(){
  vec3 p = aPos;
  vec3 n = aNrm;

  // 四肢を漕ぐ。前脚と後脚で位相をずらし、付け根のまわりに水平に回す
  // 整数部が番号、小数部が脚らしさ（0.99 まで）。floor(aLimb + 0.001) と
  // 書いていたら 0.999 の頂点で番号が 1 つずれ、反対側の付け根を中心に
  // 回って脚が棒のように伸びた
  int li = int(aLimb);
  float w = min((aLimb - float(li)) / 0.99, 1.0);
  if(w > 0.0){
    vec3 root = limbRoot(li);
    float ph = uTime * uBeat + uPhase + float(li) * 1.7;
    // 前後に払う。振り幅 0.38 では甲長 3cm のカメで 2 画素も動かず、
    // 止まって見えた。この見本の脚は短い（甲長の 1/6 ほどしか出ていない）ので、
    // 屋台の引きの画でも分かるよう ±50° 近くまで振る
    float swing = sin(ph) * 0.85 * w;
    // 右と左で回す向きを揃える（どちらも前後へ払う）
    float a = p.z > 0.0 ? swing : -swing;
    float c = cos(a), s = sin(a);
    vec3 d = p - root;
    d = vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
    n = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
    // 押すときに下へ掻き、戻すときに持ち上げる。真上から見ても
    // 脚の長さが変わって見えるので、漕いでいるのが分かる
    float dip = cos(ph) * 0.45 * w;
    float b = p.z > 0.0 ? dip : -dip;
    float cb = cos(b), sb = sin(b);
    d = vec3(d.x, d.y * cb - d.z * sb, d.y * sb + d.z * cb);
    n = vec3(n.x, n.y * cb - n.z * sb, n.y * sb + n.z * cb);
    p = root + d;
  }
  // 頭はゆっくり上下する
  float head = smoothstep(0.50, 0.70, p.x);
  p.y += 0.015 * head * sin(uTime * uBeat * 0.5 + uPhase);
  // 尾は左右に振る
  float tail = max(-p.x - 0.50, 0.0);
  p.z += 0.30 * tail * sin(uTime * uBeat * 0.7 + uPhase + 1.3);

  p *= uLen;
  float c = cos(uYaw), s = sin(uYaw);
  vec3 wpos = vec3(p.x * c - p.z * s, p.y, p.x * s + p.z * c) + uPos;
  vW = wpos;
  vN = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  vUv = aUv;
  vDist = distance(wpos, uCam);
  gl_Position = uVP * vec4(wpos, 1.0);
}`;

export const FS_TURTLEGLB = `${HEAD}
${NOISE}
${SKYLIB}
${AMBIENT}
${WATERLIB}
${CAUSTICS}
in vec3 vW;
in vec3 vN;
in vec2 vUv;
in float vDist;
uniform vec3 uCam;
uniform sampler2D uTex;
out vec4 frag;

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float ndv = clamp(dot(N, V), 0.0, 1.0);

  // 見本の絵は明るく撮った写真のような色。手描きのカメ（甲羅の反射率 0.06〜0.13）に
  // 寄せて落とす。そのままでは水の中で白く浮く
  vec3 base = texture(uTex, vUv).rgb * 0.80;

  // 水中にいる間は、水面で結んだ光の網が甲羅にも落ちる
  vec3 caus = vec3(1.0);
  if(vW.y < -0.002){
    float below = -vW.y;
    vec2 entry = vW.xz + uSunHoriz * below * uRefrTan;
    caus = mix(vec3(1.0), caustics(vW.xz, below), edgeMask(entry));
  }

  vec3 lit = underSun(N) * caus + underAmbient(N) + underLantern(vW, N);
  float up = N.y * 0.5 + 0.5;
  vec3 col = base * lit * (0.62 + 0.52 * up);
  // 濡れた甲羅はよく照る
  col += ggx(N, V, underSunDir(), 0.42, vec3(0.040)) * uSunColor * PI * 0.35;
  col += base * pow(1.0 - ndv, 4.0) * 0.10 * lit;

  frag = vec4(col, vDist);
}`;
