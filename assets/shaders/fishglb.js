// 立体の見本（GLB）で描く金魚。
//
// 形は見本の網をそのまま使い、うねりだけ手描きの金魚と同じ式でかける。
// 色は見本の絵から取り、光（水中の日差し・光の網・行灯・照り）は
// 手描きの金魚と同じ道具で当てる。並べたときに、形と色の違いだけが見えるように。
//
// 見本は胴とひれが 1 枚につながった網なので、手描きの金魚のように
// 尾の反りや胸びれの漕ぎを別々には動かせない。

import { HEAD, NOISE, MATERIAL, SKYLIB, AMBIENT, WATERLIB, CAUSTICS } from './common.js?v=202610260528';
import { SWIM } from './actors.js?v=202610260528';

export const VS_FISHGLB = `${HEAD}
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
uniform float uBend;
out vec3 vW;
out vec3 vN;
out vec2 vUv;
out float vDist;
${SWIM}

void main(){
  vec3 p = swim(aPos);
  // うねりは z を x の関数でずらすだけなので、法線はその傾きで倒せば足りる
  float e = 0.01;
  float slope = (swim(aPos + vec3(e, 0.0, 0.0)).z - p.z) / e;
  vec3 n = normalize(vec3(aNrm.x - slope * aNrm.z, aNrm.y, aNrm.z));

  vec3 w = toWorld(p);
  float c = cos(uYaw), s = sin(uYaw);
  vW = w;
  vN = vec3(n.x * c - n.z * s, n.y, n.x * s + n.z * c);
  vUv = aUv;
  vDist = distance(w, uCam);
  gl_Position = uVP * vec4(w, 1.0);
}`;

export const FS_FISHGLB = `${HEAD}
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
uniform vec3 uCam;
uniform sampler2D uTex;
uniform int uBlack;        // 1 = 小黒・黒出目金。見本の色を黒へ塗り替える
out vec4 frag;

void main(){
  vec3 N = normalize(vN);
  vec3 V = normalize(uCam - vW);
  float ndv = clamp(dot(N, V), 0.0, 1.0);
  vec3 base = texture(uTex, vUv).rgb;

  // 見本の絵は明るく撮った写真のような色で、そのままでは手描きの金魚
  // （朱の反射率 0.44 前後）より 1.5 倍ほど明るい。水の中で白く浮くので落とす
  base *= 0.62;

  // ひれ。見本の絵では、ひれは白っぽく色が抜けている。
  // 色の抜け具合をひれらしさとして使い、透かした光を足す
  float hi = max(base.r, max(base.g, base.b)), lo = min(base.r, min(base.g, base.b));
  float fin = smoothstep(0.55, 0.25, (hi - lo) / max(hi, 1e-4));

  // 黒い種類。見本は赤い金魚しか無いので、明るさの起伏だけ残して黒天鵞絨にする。
  // 手描きの黒（0.034 前後）に合わせ、ひれは少し透けて明るい
  if(uBlack == 1){
    float lum = dot(base, vec3(0.30, 0.59, 0.11));
    base = mix(vec3(0.030, 0.026, 0.034), vec3(0.080, 0.070, 0.090), smoothstep(0.08, 0.40, lum));
    base = mix(base, base * 1.6, fin);
  }

  vec3 caus = vec3(1.0);
  if(vW.y < -0.002){
    float below = -vW.y;
    vec2 entry = vW.xz + uSunHoriz * below * uRefrTan;
    caus = mix(vec3(1.0), caustics(vW.xz, below), edgeMask(entry));
  }
  vec3 lit = underSun(N) * caus + underAmbient(N) + underLantern(vW, N);
  vec3 up3 = vec3(0.0, 1.0, 0.0);
  vec3 scattered = (underSun(up3) * caus * 0.52 + underAmbient(up3)) * 0.82;
  lit = mix(lit, max(lit, scattered), 0.6 * fin);

  float up = N.y * 0.5 + 0.5;
  vec3 col = base * lit * (0.80 + 0.30 * up);
  // 照りは手描きと同じ。黒い体は照りが目立つので強め、金属の色は青みの銀
  float gloss = (uBlack == 1 ? 1.4 : 0.8) * (1.0 - fin);
  vec3 F0m = uBlack == 1 ? vec3(0.16, 0.15, 0.20) : vec3(0.50, 0.26, 0.07);
  col += ggx(N, V, underSunDir(), 0.24, vec3(0.035)) * uSunColor * gloss * PI;
  col += ggx(N, V, underSunDir(), 0.34, F0m) * uSunColor * PI * 0.22 * (1.0 - fin);
  col += base * pow(1.0 - ndv, 4.0) * 0.10 * lit;

  frag = vec4(col, vDist);
}`;
