// 4x4 行列と、カメラの基底ベクトル。
//
// 逆行列は持たない。画面のピクセルからワールドのレイを作るのに、
// 普通は逆ビュー射影行列を使うが、ここではカメラの right / up / forward と
// tan(fov/2) から直接レイを組み立てる。そのほうが行列反転のコードが要らず、
// 空シェーダ側でもマウスのレイでも同じ式を使い回せる。

export function mat4() {
  return new Float32Array([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
}

/** 列優先（WebGL の既定）の透視投影。 */
export function perspective(out, fovY, aspect, near, far) {
  const f = 1 / Math.tan(fovY / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

export function lookAt(out, eye, center, up) {
  const fz = norm3(sub3(center, eye)); // 視線方向
  const fx = norm3(cross3(fz, up));
  const fy = cross3(fx, fz);
  out[0] = fx[0]; out[1] = fy[0]; out[2] = -fz[0]; out[3] = 0;
  out[4] = fx[1]; out[5] = fy[1]; out[6] = -fz[1]; out[7] = 0;
  out[8] = fx[2]; out[9] = fy[2]; out[10] = -fz[2]; out[11] = 0;
  out[12] = -dot3(fx, eye); out[13] = -dot3(fy, eye); out[14] = dot3(fz, eye); out[15] = 1;
  return out;
}

export function multiply(out, a, b) {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    out[c * 4 + 0] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    out[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    out[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    out[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  return out;
}

export const sub3 = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const dot3 = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
export const cross3 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
export function norm3(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}

export const clamp = (x, a, b) => (x < a ? a : x > b ? b : x);
export const lerp = (a, b, t) => a + (b - a) * t;

/** 角度の差を -π..π に畳む。金魚の旋回で使う。 */
export function wrapAngle(a) {
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}
