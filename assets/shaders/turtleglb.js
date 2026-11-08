// 立体の見本（GLB）で描くミドリガメ。
//
// 形は見本の網をそのまま使い、四肢の漕ぎだけ手描きのカメと同じ拍子で
// 付ける。見本は甲羅も四肢も 1 枚につながった網なので、部位の番号は無い。
// 四肢は「甲羅の外へ張り出していて、縁より低い所」として位置から見分け、
// 付け根のまわりに回す。頭と尾も位置で見分け、頭はわずかに上下し、尾は左右に振る。
//
// 色は見本の絵から取り、光（水中の日差し・光の網・行灯・照り）は
// 手描きのカメと同じ道具で当てる。

import { HEAD, NOISE, SKYLIB, AMBIENT, WATERLIB, CAUSTICS } from './common.js?v=202611081426';

export const VS_TURTLEGLB = `${HEAD}
layout(location=0) in vec3 aPos;
layout(location=1) in vec3 aNrm;
layout(location=2) in vec2 aUv;
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
 * 体の座標は甲長 1、甲羅の中心が原点、頭が +x、縁の高さが y = 0。
 * 前脚の付け根は x = +0.36、後脚は x = -0.35、どちらも z = ±0.30。
 */
vec3 limbRoot(int li){
  float x = li < 2 ? 0.36 : -0.35;
  float z = (li == 0 || li == 2) ? 0.30 : -0.30;
  return vec3(x, -0.08, z);
}

/** 四肢らしさ。甲羅の外（|z| が大きい）で、縁より低い所 */
float limbWeight(vec3 p){
  float out_ = smoothstep(0.24, 0.36, abs(p.z));
  float low = smoothstep(0.00, -0.10, p.y);
  float body = 1.0 - smoothstep(0.48, 0.62, abs(p.x));   // 頭と尾は除く
  return out_ * low * body;
}

void main(){
  vec3 p = aPos;
  vec3 n = aNrm;

  // 四肢を漕ぐ。前脚と後脚で位相をずらし、付け根のまわりに水平に回す
  float w = limbWeight(p);
  if(w > 0.0){
    int li = (p.x > 0.0 ? 0 : 2) + (p.z > 0.0 ? 0 : 1);
    vec3 root = limbRoot(li);
    float swing = sin(uTime * uBeat + uPhase + float(li) * 1.7) * 0.38 * w;
    // 右と左で回す向きを揃える（どちらも前後へ払う）
    float a = p.z > 0.0 ? swing : -swing;
    float c = cos(a), s = sin(a);
    vec3 d = p - root;
    p = root + vec3(d.x * c - d.z * s, d.y, d.x * s + d.z * c);
    n = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
    // 払うときにわずかに持ち上がる
    p.y += swing * 0.07 * smoothstep(0.30, 0.60, abs(p.z));
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
