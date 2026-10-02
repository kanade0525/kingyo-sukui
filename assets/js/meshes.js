// 形のデータを組む所。水槽・金魚・ポイ。
//
// 金魚だけは位置を持たず、(u, v, 部位) だけを頂点に持たせて
// 形は頂点シェーダで作る。泳ぎのうねりを毎フレーム CPU で計算して
// 転送するのは無駄で、しかも法線を作り直す手間が増えるため。

import { Mesh } from './glx.js?v=202610020652';
import { TANK, POI, BOWL } from './world.js?v=202610020652';

/** 位置・法線・領域の 3 属性を貯めて Mesh にする小さな入れ物。 */
class Builder {
  constructor() {
    this.pos = [];
    this.nrm = [];
    this.reg = [];
    this.idx = [];
  }
  quad(a, b, c, d, n, region) {
    const base = this.pos.length / 3;
    for (const v of [a, b, c, d]) {
      this.pos.push(v[0], v[1], v[2]);
      this.nrm.push(n[0], n[1], n[2]);
      this.reg.push(region);
    }
    this.idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  build(gl) {
    return new Mesh(gl, [
      { loc: 0, size: 3, data: new Float32Array(this.pos) },
      { loc: 1, size: 3, data: new Float32Array(this.nrm) },
      { loc: 2, size: 1, data: new Float32Array(this.reg) },
    ], new Uint32Array(this.idx));
  }
}

/** 水槽。領域 0=底、1=内壁、2=縁の上、3=外壁。 */
export function tankMesh(gl) {
  const b = new Builder();
  const { halfX: hx, halfZ: hz, depth, rimW: rw, rimTop: rt, outBottom: ob } = TANK;
  const ox = hx + rw, oz = hz + rw;

  // 底
  b.quad([-hx, -depth, -hz], [-hx, -depth, hz], [hx, -depth, hz], [hx, -depth, -hz], [0, 1, 0], 0);

  // 内壁（法線は内向き）
  b.quad([hx, -depth, -hz], [hx, -depth, hz], [hx, rt, hz], [hx, rt, -hz], [-1, 0, 0], 1);
  b.quad([-hx, -depth, hz], [-hx, -depth, -hz], [-hx, rt, -hz], [-hx, rt, hz], [1, 0, 0], 1);
  b.quad([-hx, -depth, hz], [hx, -depth, hz], [hx, rt, hz], [-hx, rt, hz], [0, 0, -1], 1);
  b.quad([hx, -depth, -hz], [-hx, -depth, -hz], [-hx, rt, -hz], [hx, rt, -hz], [0, 0, 1], 1);

  // 縁の上面（4 枚で額縁をつくる）
  b.quad([-ox, rt, -oz], [-ox, rt, oz], [-hx, rt, oz], [-hx, rt, -oz], [0, 1, 0], 2);
  b.quad([hx, rt, -oz], [hx, rt, oz], [ox, rt, oz], [ox, rt, -oz], [0, 1, 0], 2);
  b.quad([-hx, rt, hz], [-hx, rt, oz], [hx, rt, oz], [hx, rt, hz], [0, 1, 0], 2);
  b.quad([-hx, rt, -oz], [-hx, rt, -hz], [hx, rt, -hz], [hx, rt, -oz], [0, 1, 0], 2);

  // 外壁
  b.quad([ox, ob, -oz], [ox, ob, oz], [ox, rt, oz], [ox, rt, -oz], [1, 0, 0], 3);
  b.quad([-ox, ob, oz], [-ox, ob, -oz], [-ox, rt, -oz], [-ox, rt, oz], [-1, 0, 0], 3);
  b.quad([-ox, ob, oz], [ox, ob, oz], [ox, rt, oz], [-ox, rt, oz], [0, 0, 1], 3);
  b.quad([ox, ob, -oz], [-ox, ob, -oz], [-ox, rt, -oz], [ox, rt, -oz], [0, 0, -1], 3);

  return b.build(gl);
}

/**
 * 金魚。部位ごとに (u, v) の格子を並べるだけ。
 * 0=胴 1=尾びれ 2=背びれ 3=右胸びれ 4=左胸びれ 5=尻びれ
 */
export function fishMesh(gl) {
  const uv = [];
  const part = [];
  const idx = [];

  const sheet = (nu, nv, p) => {
    const base = uv.length / 2;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) {
        uv.push(i / nu, j / nv);
        part.push(p);
      }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i;
        idx.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
      }
    }
  };

  sheet(28, 18, 0);   // 胴
  sheet(10, 10, 1);   // 尾びれ
  sheet(12, 4, 2);    // 背びれ
  sheet(6, 3, 3);     // 右胸びれ
  sheet(6, 3, 4);     // 左胸びれ
  sheet(8, 3, 5);     // 尻びれ

  return new Mesh(gl, [
    { loc: 0, size: 2, data: new Float32Array(uv) },
    { loc: 1, size: 1, data: new Float32Array(part) },
  ], new Uint32Array(idx));
}

/** ポイ。領域 0=紙、1=枠、2=柄。原点は紙の中心。 */
export function poiMesh(gl) {
  const b = new Builder();
  const R = POI.radius;
  const SEG = 44;

  // 紙。たわみを頂点シェーダでかけるので、半径方向にも分けておく
  const RINGS = 7;
  const base = b.pos.length / 3;
  for (let i = 0; i <= RINGS; i++) {
    const r = (R * i) / RINGS;
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      b.pos.push(Math.cos(a) * r, 0, Math.sin(a) * r);
      b.nrm.push(0, 1, 0);
      b.reg.push(0);
    }
  }
  for (let i = 0; i < RINGS; i++) {
    for (let j = 0; j < SEG; j++) {
      const a = base + i * (SEG + 1) + j;
      const c = a + SEG + 1;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }

  // 枠。輪を断面 8 角で押し出す
  const MR = R + 0.0036, mr = 0.0040, SIDE = 8;
  const fb = b.pos.length / 3;
  for (let j = 0; j <= SEG; j++) {
    const a = (j / SEG) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let k = 0; k <= SIDE; k++) {
      const t = (k / SIDE) * Math.PI * 2;
      const ct = Math.cos(t), st = Math.sin(t);
      b.pos.push(ca * (MR + mr * ct), mr * st, sa * (MR + mr * ct));
      b.nrm.push(ca * ct, st, sa * ct);
      b.reg.push(1);
    }
  }
  for (let j = 0; j < SEG; j++) {
    for (let k = 0; k < SIDE; k++) {
      const a = fb + j * (SIDE + 1) + k;
      const c = a + SIDE + 1;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }

  // 柄。輪の手前から斜め上に伸びる竹の平板
  const z0 = MR, z1 = MR + 0.085;
  const w0 = 0.0062, w1 = 0.0078, h = 0.0030;
  const y1 = 0.011;
  const corners = (z, w, y, dy) => [
    [-w, y - dy, z], [w, y - dy, z], [w, y + dy, z], [-w, y + dy, z],
  ];
  const A = corners(z0, w0, 0, h), B = corners(z1, w1, y1, h);
  b.quad(A[3], A[2], B[2], B[3], [0, 1, 0], 2);     // 上
  b.quad(A[0], B[0], B[1], A[1], [0, -1, 0], 2);    // 下
  b.quad(A[1], B[1], B[2], A[2], [1, 0, 0.2], 2);   // 右
  b.quad(A[0], A[3], B[3], B[0], [-1, 0, 0.2], 2);  // 左
  b.quad(B[0], B[3], B[2], B[1], [0, 0, 1], 2);     // 端

  return b.build(gl);
}

/**
 * 手元の器。領域 4=外側と縁、5=内側と底、6=水面。
 * 水面だけ別のメッシュにして返すのは、本体を不透明で描いたあとに
 * 金魚を入れ、最後に水面を重ねたいため。
 */
export function bowlMesh(gl) {
  const { outerR, innerR, rimY, waterY, floorY } = BOWL;
  const x = 0, z = 0;   // 置き場所は uBowlPos で動かす
  const SEG = 40;
  const body = new Builder();
  const ground = TANK.outBottom;

  const ring = (r0, y0, r1, y1, region, nOut) => {
    const base = body.pos.length / 3;
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      const ca = Math.cos(a), sa = Math.sin(a);
      const n = [ca * nOut, nOut === 0 ? 1 : 0.25, sa * nOut];
      body.pos.push(x + ca * r0, y0, z + sa * r0);
      body.nrm.push(n[0], n[1], n[2]);
      body.reg.push(region);
      body.pos.push(x + ca * r1, y1, z + sa * r1);
      body.nrm.push(n[0], n[1], n[2]);
      body.reg.push(region);
    }
    for (let j = 0; j < SEG; j++) {
      const a = base + j * 2;
      body.idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2);
    }
  };

  // 外側（下すぼまり）、縁の上面、内側、底
  ring(outerR * 0.72, ground, outerR, rimY, 4, 1);
  ring(outerR, rimY, innerR, rimY, 4, 0);
  ring(innerR, rimY, innerR * 0.78, floorY, 5, -1);

  const base = body.pos.length / 3;
  body.pos.push(x, floorY, z); body.nrm.push(0, 1, 0); body.reg.push(5);
  for (let j = 0; j <= SEG; j++) {
    const a = (j / SEG) * Math.PI * 2;
    body.pos.push(x + Math.cos(a) * innerR * 0.78, floorY, z + Math.sin(a) * innerR * 0.78);
    body.nrm.push(0, 1, 0); body.reg.push(5);
  }
  for (let j = 0; j < SEG; j++) body.idx.push(base, base + 1 + j + 1, base + 1 + j);

  // 水面
  const water = new Builder();
  const wr = innerR * 0.965;
  water.pos.push(x, waterY, z); water.nrm.push(0, 1, 0); water.reg.push(6);
  for (let j = 0; j <= SEG; j++) {
    const a = (j / SEG) * Math.PI * 2;
    water.pos.push(x + Math.cos(a) * wr, waterY, z + Math.sin(a) * wr);
    water.nrm.push(0, 1, 0); water.reg.push(6);
  }
  for (let j = 0; j < SEG; j++) water.idx.push(0, 1 + j + 1, 1 + j);

  return { body: body.build(gl), water: water.build(gl) };
}
