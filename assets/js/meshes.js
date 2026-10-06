// 形のデータを組む所。水槽・金魚・ポイ。
//
// 金魚だけは位置を持たず、(u, v, 部位) だけを頂点に持たせて
// 形は頂点シェーダで作る。泳ぎのうねりを毎フレーム CPU で計算して
// 転送するのは無駄で、しかも法線を作り直す手間が増えるため。

import { Mesh } from './glx.js?v=202610060314';
import { TANK, POI, BOWL, AIR, JAR, BED, ANACHARIS, jarRadius } from './world.js?v=202610060314';

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

/**
 * 角の丸い長方形の輪郭。(x, z) と、外を向く水平の向き (nx, nz) を返す。
 * 角を seg 分割して一周する。
 */
function roundRect(hx, hz, r, seg) {
  const cx = Math.max(hx - r, 0), cz = Math.max(hz - r, 0);
  const out = [];
  const corner = [[cx, cz, 0], [-cx, cz, Math.PI / 2], [-cx, -cz, Math.PI], [cx, -cz, Math.PI * 1.5]];
  for (const [ox, oz, a0] of corner) {
    for (let i = 0; i <= seg; i++) {
      const a = a0 + (i / seg) * (Math.PI / 2);
      const nx = Math.cos(a), nz = Math.sin(a);
      out.push({ x: ox + nx * r, z: oz + nz * r, nx, nz });
    }
  }
  return out;
}

/**
 * 水槽（トロ舟）。領域 0=底、1=内壁、2=縁の上、3=外壁。
 *
 * 形は「角の丸い長方形を、上へ行くほど広げながら積む」で作る。
 * 樹脂の成形品なので、直角も鋭い稜線も無い。
 */
export function tankMesh(gl) {
  const b = new Builder();
  const T = TANK;
  const SEG = 9;                       // 角 1 つぶんの分割
  const ring = (hx, hz, r) => roundRect(hx, hz, r, SEG);
  const N = SEG * 4 + 4;               // 1 周の点数

  // 高さ y での内側の輪郭。壁が傾いているので高さごとに広がる
  const inner = (y) => ring(T.halfX + T.draftX * y, T.halfZ + T.draftZ * y,
                            T.cornerR + T.draftX * y);

  /** 2 つの輪をつないで帯を張る。n は各頂点の法線を返す関数。 */
  const band = (A, B, nf, region) => {
    const base = b.pos.length / 3;
    for (const [ring_, yi] of [[A, 0], [B, 1]]) {
      for (const p of ring_) {
        b.pos.push(p.x, ring_.y, p.z);
        const n = nf(p, yi);
        b.nrm.push(n[0], n[1], n[2]);
        b.reg.push(region);
      }
    }
    // 輪は閉じているので、最後の点から最初の点へも張る。
    // ここを忘れると、一周の継ぎ目にあたる一面だけが丸ごと抜ける
    for (let i = 0; i < N; i++) {
      const j = (i + 1) % N;
      b.idx.push(base + i, base + N + i, base + j);
      b.idx.push(base + j, base + N + i, base + N + j);
    }
  };

  // ---- 底。隅の丸み（フィレット）のぶん内へ寄せた平らな面 ----
  const fy = -T.depth;
  const flat = inner(fy + T.fillet);
  const fr = T.fillet;
  // 平らな部分の輪郭
  const bot = ring(T.halfX + T.draftX * fy - fr, T.halfZ + T.draftZ * fy - fr,
                   Math.max(T.cornerR + T.draftX * fy - fr, 0.004));
  bot.y = fy;
  {
    // 中心からの扇で埋める
    const c = b.pos.length / 3;
    b.pos.push(0, fy, 0); b.nrm.push(0, 1, 0); b.reg.push(0);
    const base = b.pos.length / 3;
    for (const p of bot) { b.pos.push(p.x, fy, p.z); b.nrm.push(0, 1, 0); b.reg.push(0); }
    for (let i = 0; i < N - 1; i++) b.idx.push(c, base + i, base + i + 1);
    b.idx.push(c, base + N - 1, base);
  }

  // ---- 底と壁をつなぐ丸み ----
  const FSEG = 5;
  let prev = bot, prevT = 0;
  for (let k = 1; k <= FSEG; k++) {
    const t = k / FSEG, th = t * Math.PI / 2;
    const y = fy + fr * (1 - Math.cos(th));
    const shrink = fr * (1 - Math.sin(th));   // 壁から内へ残っている量
    const cur = ring(T.halfX + T.draftX * y - shrink, T.halfZ + T.draftZ * y - shrink,
                     Math.max(T.cornerR + T.draftX * y - shrink, 0.004));
    cur.y = y;
    prev.y = prev.y === undefined ? fy : prev.y;
    const ta = prevT, tb = th;
    band(prev, cur, (p, yi) => {
      const a = yi ? tb : ta, s = Math.sin(a), co = Math.cos(a);
      return [-p.nx * s, co, -p.nz * s];
    }, 0);
    prev = cur; prevT = th;
  }

  // ---- 内壁。上へ行くほど外へ開く ----
  const wallBot = prev;
  const wallTop = inner(T.rimTop);
  wallTop.y = T.rimTop;
  // 傾いた壁を内から見た法線は、内へ向きつつ上を向く
  const dn = (T.draftX + T.draftZ) * 0.5;
  const nl = Math.hypot(1, dn);
  band(wallBot, wallTop, (p) => [-p.nx / nl, dn / nl, -p.nz / nl], 1);

  // ---- 縁の上面 ----
  const rimOut = ring(T.halfX + T.draftX * T.rimTop + T.rimW,
                      T.halfZ + T.draftZ * T.rimTop + T.rimW,
                      T.cornerR + T.draftX * T.rimTop + T.rimW);
  rimOut.y = T.rimTop;
  band(wallTop, rimOut, () => [0, 1, 0], 2);

  // ---- 縁の巻き返し。外へ張り出した唇が、外壁まで下りる ----
  const lipH = 0.016;
  const ly = T.rimTop - lipH;
  const lipBot = ring(T.halfX + T.draftX * ly + T.wallT,
                      T.halfZ + T.draftZ * ly + T.wallT,
                      T.cornerR + T.draftX * ly + T.wallT);
  lipBot.y = ly;
  const ln = Math.hypot(T.rimW - T.wallT, lipH);
  band(rimOut, lipBot, (p) => [p.nx * lipH / ln, (T.rimW - T.wallT) / ln, p.nz * lipH / ln], 3);

  // ---- 外壁。内壁と平行に、肉厚のぶん外側 ----
  const oy = T.outBottom;
  const outBot = ring(T.halfX + T.draftX * oy + T.wallT,
                      T.halfZ + T.draftZ * oy + T.wallT,
                      T.cornerR + T.draftX * oy + T.wallT);
  outBot.y = oy;
  band(lipBot, outBot, (p) => [p.nx / nl, -dn / nl, p.nz / nl], 3);

  return b.build(gl);
}

/**
 * ミドリガメ。甲羅は中心から縁への円板、四肢と頭は別の面。
 * 0=甲羅 1=腹側 2..5=四肢 6=頭と首 7=尾
 */
export function turtleMesh(gl) {
  const uv = [];
  const part = [];
  const idx = [];
  const sheet = (nu, nv, p) => {
    const base = uv.length / 2;
    for (let j = 0; j <= nv; j++) {
      for (let i = 0; i <= nu; i++) { uv.push(i / nu, j / nv); part.push(p); }
    }
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const a = base + j * (nu + 1) + i;
        idx.push(a, a + nu + 1, a + 1, a + 1, a + nu + 1, a + nu + 2);
      }
    }
  };
  sheet(40, 12, 0);          // 甲羅
  sheet(40, 6, 1);           // 腹側
  for (let i = 0; i < 4; i++) sheet(6, 4, 2 + i);
  sheet(10, 12, 6);          // 頭と首
  sheet(5, 8, 7);            // 尾
  return new Mesh(gl, [
    { loc: 0, size: 2, data: new Float32Array(uv) },
    { loc: 1, size: 1, data: new Float32Array(part) },
  ], new Uint32Array(idx));
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
  sheet(12, 24, 1);   // 尾びれ。v が尾の軸まわりを一周するので細かく要る
  sheet(12, 4, 2);    // 背びれ
  sheet(8, 5, 3);     // 右胸びれ
  sheet(8, 5, 4);     // 左胸びれ
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

  // 枠。実物は外径 83mm・内径 78mm なので、輪は径方向にわずか 2.5mm しかない。
  // 断面は丸ではなく、縦長の小判。平たいぶん上から見ると細い線に見える。
  const MR = R + 0.0013, mrx = 0.0013, mry = 0.0018, SIDE = 8;
  const fb = b.pos.length / 3;
  for (let j = 0; j <= SEG; j++) {
    const a = (j / SEG) * Math.PI * 2;
    const ca = Math.cos(a), sa = Math.sin(a);
    for (let k = 0; k <= SIDE; k++) {
      const t = (k / SIDE) * Math.PI * 2;
      const ct = Math.cos(t), st = Math.sin(t);
      b.pos.push(ca * (MR + mrx * ct), mry * st, sa * (MR + mrx * ct));
      // 断面が楕円なので、法線は軸の比を逆に掛ける
      const nx = ct / mrx, ny = st / mry;
      const nl = Math.hypot(nx, ny);
      b.nrm.push(ca * nx / nl, ny / nl, sa * nx / nl);
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

  // 柄。実物は全長 150mm・枠 85mm なので、柄は 65mm しかない。
  // 幅 10mm・厚さ 2mm ほどの平たい細板で、輪と同じ平面にまっすぐ伸びる。
  // ここを太く・厚く・斜め上にすると、一気に虫取り網に見える。
  // 根元だけわずかに広いのは、輪との継ぎ目の補強。
  const HSEG = [
    { z: MR - 0.002, w: 0.0062, h: 0.0011 },   // 輪との継ぎ目
    { z: MR + 0.008, w: 0.0050, h: 0.0010 },
    { z: MR + 0.040, w: 0.0045, h: 0.0010 },
    { z: MR + 0.064, w: 0.0038, h: 0.0009 },   // 先端。わずかに細る
  ];
  const hb = b.pos.length / 3;
  // 断面は角を落とした長方形。6 点で一周する
  const SECT = [[-1, 0], [-1, 1], [1, 1], [1, 0], [1, -1], [-1, -1]];
  for (const g of HSEG) {
    for (const [sx, sy] of SECT) {
      b.pos.push(sx * g.w, sy * g.h, g.z);
      const nl = Math.hypot(sx, sy) || 1;
      b.nrm.push(sx / nl, sy / nl, 0);
      b.reg.push(2);
    }
  }
  for (let i = 0; i < HSEG.length - 1; i++) {
    for (let k = 0; k < SECT.length; k++) {
      const k2 = (k + 1) % SECT.length;
      const a = hb + i * SECT.length;
      b.idx.push(a + k, a + SECT.length + k, a + k2);
      b.idx.push(a + k2, a + SECT.length + k, a + SECT.length + k2);
    }
  }
  // 先端のふた
  const tipB = hb + (HSEG.length - 1) * SECT.length;
  for (let k = 1; k < SECT.length - 1; k++) b.idx.push(tipB, tipB + k, tipB + k + 1);

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
  // 浮いているので、外側は底で丸く閉じる。地面までは伸ばさない
  const ground = floorY - 0.009;

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
  ring(outerR * 0.52, ground, outerR * 0.88, floorY + 0.012, 4, 1);
  ring(outerR * 0.88, floorY + 0.012, outerR, rimY, 4, 1);
  // 外底のふた
  {
    const c = body.pos.length / 3;
    body.pos.push(x, ground, z); body.nrm.push(0, -1, 0); body.reg.push(4);
    const b0 = body.pos.length / 3;
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      body.pos.push(x + Math.cos(a) * outerR * 0.52, ground, z + Math.sin(a) * outerR * 0.52);
      body.nrm.push(0, -1, 0); body.reg.push(4);
    }
    for (let j = 0; j < SEG; j++) body.idx.push(c, b0 + j, b0 + j + 1);
  }
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

/**
 * 浮き葉。中心から縁への円板を、表と裏の 2 枚で作る。
 * 属性は (中心からの距離, 角度, 表=1/裏=0)。形は頂点シェーダが水面に合わせる。
 */
export function padMesh(gl) {
  const RINGS = 10, SEG = 56;
  const pos = [];
  const idx = [];
  for (const face of [1, 0]) {
    const base = pos.length / 3;
    for (let i = 0; i <= RINGS; i++) {
      for (let j = 0; j <= SEG; j++) pos.push(i / RINGS, j / SEG, face);
    }
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEG; j++) {
        const a = base + i * (SEG + 1) + j, c = a + SEG + 1;
        if (face) idx.push(a, c, a + 1, a + 1, c, c + 1);
        else idx.push(a, a + 1, c, a + 1, c + 1, c);
      }
    }
  }
  return new Mesh(gl, [{ loc: 0, size: 3, data: new Float32Array(pos) }], new Uint32Array(idx));
}

/**
 * ウキクサ 1 株。
 *
 * 葉状体 4 枚と根の束を 1 枚のメッシュにまとめる。株ごとに描き分けると
 * 描画の回数が株数 × 葉数になるので、ここで 1 回にしておく。
 * 属性は (中心からの距離, 角度, 表裏, 部位)。部位 0〜3 が葉状体、4 が根。
 */
export function weedMesh(gl) {
  const RINGS = 5, SEG = 18;
  const pos = [];
  const idx = [];
  for (let part = 0; part <= 4; part++) {
    // 根は裏表を分ける意味がないので 1 枚だけ
    for (const face of part === 4 ? [1] : [1, 0]) {
      const base = pos.length / 4;
      for (let i = 0; i <= RINGS; i++) {
        for (let j = 0; j <= SEG; j++) pos.push(i / RINGS, j / SEG, face, part);
      }
      for (let i = 0; i < RINGS; i++) {
        for (let j = 0; j < SEG; j++) {
          const a = base + i * (SEG + 1) + j, c = a + SEG + 1;
          if (face) idx.push(a, c, a + 1, a + 1, c, c + 1);
          else idx.push(a, a + 1, c, a + 1, c + 1, c);
        }
      }
    }
  }
  return new Mesh(gl, [{ loc: 0, size: 4, data: new Float32Array(pos) }], new Uint32Array(idx));
}

/**
 * 泡。1 粒 1 枚の板。位置は頂点シェーダが時刻から出すので、
 * ここは板と通し番号を並べるだけ。
 */
export function bubbleMesh(gl, count) {
  const pos = [];
  const idx = [];
  for (let i = 0; i < count; i++) {
    const b = pos.length / 3;
    pos.push(-1, -1, i, 1, -1, i, 1, 1, i, -1, 1, i);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  }
  return new Mesh(gl, [{ loc: 0, size: 3, data: new Float32Array(pos) }], new Uint32Array(idx));
}

/** 飛沫の粒。泡と同じで、位置は頂点シェーダが出す。 */
export function splashMesh(gl, count) {
  return bubbleMesh(gl, count);
}

/**
 * エアストーンとチューブ、それに外に立てた酸素ボンベ。
 * 領域 0=石、1=チューブ、2=ボンベの胴、3=金具。
 */
export function gearMesh(gl, floorY) {
  const b = new Builder();
  const SIDE = 10;

  /** 中心線に沿って円筒を張る。pts は [x,y,z,半径] の列。 */
  const tube = (pts, region, capA = false, capB = false) => {
    const base = b.pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      const [x, y, z, r] = pts[i];
      // 進む向き
      const n = pts[Math.min(i + 1, pts.length - 1)], p = pts[Math.max(i - 1, 0)];
      let t = [n[0] - p[0], n[1] - p[1], n[2] - p[2]];
      const tl = Math.hypot(...t) || 1;
      t = t.map((v) => v / tl);
      // 直交する 2 本
      const up = Math.abs(t[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
      let e1 = [t[1] * up[2] - t[2] * up[1], t[2] * up[0] - t[0] * up[2], t[0] * up[1] - t[1] * up[0]];
      const e1l = Math.hypot(...e1) || 1;
      e1 = e1.map((v) => v / e1l);
      const e2 = [t[1] * e1[2] - t[2] * e1[1], t[2] * e1[0] - t[0] * e1[2], t[0] * e1[1] - t[1] * e1[0]];
      for (let k = 0; k <= SIDE; k++) {
        const a = (k / SIDE) * Math.PI * 2;
        const c = Math.cos(a), s = Math.sin(a);
        const nx = e1[0] * c + e2[0] * s, ny = e1[1] * c + e2[1] * s, nz = e1[2] * c + e2[2] * s;
        b.pos.push(x + nx * r, y + ny * r, z + nz * r);
        b.nrm.push(nx, ny, nz);
        b.reg.push(region);
      }
    }
    const N = SIDE + 1;
    for (let i = 0; i < pts.length - 1; i++) {
      for (let k = 0; k < SIDE; k++) {
        const a = base + i * N + k, c = a + N;
        b.idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    // ふた
    for (const [on, end] of [[capA, 0], [capB, pts.length - 1]]) {
      if (!on) continue;
      const [x, y, z] = pts[end];
      const ci = b.pos.length / 3;
      const t = end === 0 ? [-1, 0, 0] : [1, 0, 0];
      b.pos.push(x, y, z); b.nrm.push(...t); b.reg.push(region);
      const r0 = base + end * N;
      for (let k = 0; k < SIDE; k++) b.idx.push(ci, r0 + k, r0 + k + 1);
    }
  };

  // エアストーン。直径 15mm・長さ 30mm の円筒を底に寝かせる
  const sx = AIR.stone[0], sz = AIR.stone[2], sy = floorY + 0.0085;
  tube([[sx - 0.015, sy, sz, 0.0075], [sx + 0.015, sy, sz, 0.0075]], 0, true, true);

  // チューブ。石から立ち上がり、内壁を這って縁を越え、外のボンベへ下りる
  const wallZ = TANK.halfZ + TANK.draftZ * 0.0;
  const rimZ = TANK.halfZ + TANK.draftZ * TANK.rimTop + TANK.rimW;
  const TR = 0.0030;
  tube([
    [sx + 0.014, sy + 0.001, sz, TR],
    [sx + 0.030, sy + 0.004, sz - 0.030, TR],
    [sx + 0.045, sy + 0.012, -wallZ + 0.020, TR],
    [sx + 0.050, -TANK.depth * 0.45, -wallZ - 0.004, TR],
    [sx + 0.052, TANK.rimTop - 0.004, -rimZ + 0.012, TR],
    [sx + 0.054, TANK.rimTop + 0.009, -rimZ - 0.012, TR],
    [sx + 0.090, TANK.rimTop - 0.030, -rimZ - 0.060, TR],
    [AIR.bottle[0] - 0.010, TANK.outBottom + AIR.bottleH * 0.80, AIR.bottle[2] + 0.030, TR],
    [AIR.bottle[0], TANK.outBottom + AIR.bottleH * 0.88, AIR.bottle[2] + 0.008, TR],
  ], 1);

  // 酸素ボンベ。外に立てておく
  const bx = AIR.bottle[0], bz = AIR.bottle[2], by = TANK.outBottom;
  const bottle = [];
  const H = AIR.bottleH, R = AIR.bottleR;
  for (let i = 0; i <= 10; i++) {
    const t = i / 10;
    // 肩で丸めて細くなる
    const r = t < 0.86 ? R : R * Math.sqrt(Math.max(1 - ((t - 0.86) / 0.14) ** 2, 0.04));
    bottle.push([bx, by + H * t, bz, Math.max(r, 0.004)]);
  }
  tubeY(b, bottle, 2, SIDE, true);
  // 首とバルブ
  tubeY(b, [[bx, by + H, bz, 0.011], [bx, by + H + 0.030, bz, 0.011]], 3, SIDE, true);
  tubeY(b, [[bx, by + H + 0.018, bz, 0.009], [bx + 0.028, by + H + 0.018, bz, 0.009]], 3, SIDE, true, true);

  return b.build(gl);
}

/** 縦に積む円筒。tube() と同じだが、軸が y 固定なので向きを作らなくてよい。 */
function tubeY(b, pts, region, SIDE, capTop = false, sideways = false) {
  const base = b.pos.length / 3;
  for (const [x, y, z, r] of pts) {
    for (let k = 0; k <= SIDE; k++) {
      const a = (k / SIDE) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      if (sideways) {
        b.pos.push(x, y + c * r, z + s * r);
        b.nrm.push(0, c, s);
      } else {
        b.pos.push(x + c * r, y, z + s * r);
        b.nrm.push(c, 0, s);
      }
      b.reg.push(region);
    }
  }
  const N = SIDE + 1;
  for (let i = 0; i < pts.length - 1; i++) {
    for (let k = 0; k < SIDE; k++) {
      const a = base + i * N + k, c = a + N;
      b.idx.push(a, c, a + 1, a + 1, c, c + 1);
    }
  }
  if (capTop) {
    const last = pts[pts.length - 1];
    const ci = b.pos.length / 3;
    b.pos.push(last[0], last[1], last[2]);
    b.nrm.push(sideways ? 1 : 0, sideways ? 0 : 1, 0);
    b.reg.push(region);
    const r0 = base + (pts.length - 1) * N;
    for (let k = 0; k < SIDE; k++) b.idx.push(ci, r0 + k, r0 + k + 1);
  }
}


/**
 * 家のガラスの金魚鉢。太鼓鉢の回転体。
 *
 * 領域は 7（ガラスの外側）・8（砂利）・9（鉢の中の水面）・10（ガラスの内側）。
 * 屋台のお椀（4/5/6）と番号がぶつからないようにしてある。
 *
 * ガラスは内と外の二枚。薄いので両面を描いて、シェーダ側で
 * どちら向きかを法線で見分ける。
 */
export function jarMesh(gl) {
  const b = new Builder();
  const SEG = 56, RINGS = 28;

  // --- ガラス。外側と内側を二枚 ---
  for (const inside of [false, true]) {
    const base = b.pos.length / 3;
    for (let i = 0; i <= RINGS; i++) {
      const t = i / RINGS;
      const r = jarRadius(t) - (inside ? JAR.wall : 0);
      const y = t * JAR.height;
      // 法線は輪郭の傾きから。少し先の半径との差で出す
      const dt = 0.01;
      const r2 = jarRadius(Math.min(t + dt, 1)) - (inside ? JAR.wall : 0);
      const slope = (r2 - r) / (dt * JAR.height);
      for (let j = 0; j <= SEG; j++) {
        const a = (j / SEG) * Math.PI * 2;
        const ca = Math.cos(a), sa = Math.sin(a);
        b.pos.push(ca * r, y, sa * r);
        const nl = Math.hypot(1, slope) || 1;
        const sgn = inside ? -1 : 1;
        b.nrm.push(ca * sgn / nl, -slope * sgn / nl, sa * sgn / nl);
        b.reg.push(inside ? 10 : 7);
      }
    }
    for (let i = 0; i < RINGS; i++) {
      for (let j = 0; j < SEG; j++) {
        const a = base + i * (SEG + 1) + j;
        const c = a + SEG + 1;
        if (inside) b.idx.push(a, a + 1, c, a + 1, c + 1, c);
        else b.idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
  }

  // --- 口のふち。外側と内側の輪をつなぐ ---
  //
  // ここが開いたままだと、ガラスに厚みが一度も見えない。
  // 見上げる角度では縁の照りが silhouette を作るので、
  // 無いと鉢が消えて水の塊が宙に浮いて見える。
  {
    const rOut = jarRadius(1), rIn = rOut - JAR.wall;
    const base = b.pos.length / 3;
    for (let j = 0; j <= SEG; j++) {
      const a2 = (j / SEG) * Math.PI * 2;
      const ca = Math.cos(a2), sa = Math.sin(a2);
      // ふちは少し丸めてある（火造りの口巻き）。法線は上と外の中ほど
      b.pos.push(ca * rOut, JAR.height, sa * rOut);
      b.nrm.push(ca * 0.70, 0.71, sa * 0.70); b.reg.push(7);
      b.pos.push(ca * rIn, JAR.height, sa * rIn);
      b.nrm.push(-ca * 0.70, 0.71, -sa * 0.70); b.reg.push(7);
    }
    for (let j = 0; j < SEG; j++) {
      const o = base + j * 2;
      b.idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
    }
  }

  // --- 底。外側の輪を塞ぐ。ここも開いていると下から覗けてしまう ---
  {
    const r = jarRadius(0);
    const base = b.pos.length / 3;
    b.pos.push(0, 0, 0); b.nrm.push(0, -1, 0); b.reg.push(7);
    for (let j = 0; j <= SEG; j++) {
      const a2 = (j / SEG) * Math.PI * 2;
      b.pos.push(Math.cos(a2) * r, 0, Math.sin(a2) * r);
      b.nrm.push(0, -1, 0); b.reg.push(7);
    }
    for (let j = 0; j < SEG; j++) b.idx.push(base, base + j + 2, base + j + 1);
  }

  // --- 底砂。大磯砂。水草を植えるので 4cm ほど敷く ---
  //
  // 平らな板 1 枚だと、鉢の底に紙を貼ったようにしか見えない。
  // 手で入れた砂は真ん中が高く縁が低い山になるので、そう盛る。
  // （厚さは水草を植えないなら 1〜3cm、植えるなら 4cm が目安）
  {
    const EDGE = JAR.wall + BED.depth;    // 縁の高さ
    const CROWN = BED.crown;              // 真ん中の盛り上がり
    const rEdge = jarRadius(EDGE / JAR.height) - JAR.wall;
    const RINGS_S = 8;
    const base = b.pos.length / 3;
    const hAt = (u) => EDGE + CROWN * (1 - u * u);
    b.pos.push(0, hAt(0), 0); b.nrm.push(0, 1, 0); b.reg.push(8);
    for (let i = 1; i <= RINGS_S; i++) {
      const u = i / RINGS_S;
      const rr = rEdge * u, y = hAt(u);
      // 傾きから法線を出す。dy/dr = -2·CROWN·u / rEdge
      const slope = -2 * CROWN * u / rEdge;
      const nl = Math.hypot(1, slope);
      for (let j = 0; j <= SEG; j++) {
        const a = (j / SEG) * Math.PI * 2;
        b.pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
        b.nrm.push(-Math.cos(a) * slope / nl, 1 / nl, -Math.sin(a) * slope / nl);
        b.reg.push(8);
      }
    }
    for (let j = 0; j < SEG; j++) b.idx.push(base, base + j + 1, base + j + 2);
    for (let i = 0; i < RINGS_S - 1; i++) {
      for (let j = 0; j < SEG; j++) {
        const a = base + 1 + i * (SEG + 1) + j;
        const c = a + SEG + 1;
        b.idx.push(a, c, a + 1, a + 1, c, c + 1);
      }
    }
    // 砂の層の断面。ガラス越しに横から見ると、面だけでは
    // 砂の下が素通しになって縁側の板が覗く
    {
      const SKIRT = 3;
      const sb = b.pos.length / 3;
      for (let i = 0; i <= SKIRT; i++) {
        const y = EDGE - (EDGE - JAR.wall) * (i / SKIRT);
        const rr = jarRadius(y / JAR.height) - JAR.wall;
        for (let j = 0; j <= SEG; j++) {
          const a = (j / SEG) * Math.PI * 2;
          b.pos.push(Math.cos(a) * rr, y, Math.sin(a) * rr);
          b.nrm.push(Math.cos(a), 0.25, Math.sin(a));
          b.reg.push(8);
        }
      }
      for (let i = 0; i < SKIRT; i++) {
        for (let j = 0; j < SEG; j++) {
          const a = sb + i * (SEG + 1) + j;
          const c = a + SEG + 1;
          b.idx.push(a, c, a + 1, a + 1, c, c + 1);
        }
      }
    }
  }

  // --- 水草。アナカリス（オオカナダモ）---
  //
  // 葉は長さ 1.5〜3.5cm・幅 2〜4.5mm の線形で、茎の同じ節から
  // 3〜6 枚（ふつう 4 枚）が輪生する。鉢に入れるぶんは 10cm 前後に切る。
  // 葉 1 枚を、根元を幅ぶん・先を尖らせた板で表す
  {
    const bedTop = JAR.wall + BED.depth;
    const { node: NODE, whorl: WHORL, leafLen: LEAF_L, leafW: LEAF_W, rise: RISE } = ANACHARIS;
    for (const st of ANACHARIS.strands) {
      for (let k = 0; k < NODE; k++) {
        const u = (k + 0.5) / NODE;
        const cy = bedTop + u * st.h;
        const cx = st.x + st.lean * u * u, cz = st.z + st.lean * 0.6 * u * u;
        for (let w = 0; w < WHORL; w++) {
          const a = st.phase + k * 1.15 + (w / WHORL) * Math.PI * 2;
          const dx = Math.cos(a), dz = Math.sin(a);
          // 先ほど上を向く。水の中なので葉は立ち気味になる。
          // 一枚の板で張ると、どの葉も同じ平面で同じ明るさになり、
          // 緑の矢印が刺さっているようにしか見えない。
          // 二節に分けて先を垂らし、幅の端で法線を振って丸みを出す
          const rise = RISE * (0.82 + ((k * 7 + w * 3) % 5) * 0.09);
          const seg = [
            [cx + dx * LEAF_L * 0.55, cy + LEAF_L * rise * 0.60, cz + dz * LEAF_L * 0.55],
            [cx + dx * LEAF_L, cy + LEAF_L * rise * 0.95, cz + dz * LEAF_L],
          ];
          const ax = -dz * LEAF_W * 0.5, az = dx * LEAF_W * 0.5;
          const base = b.pos.length / 3;
          const ring = [[cx, cy, cz, 1.0], [seg[0][0], seg[0][1], seg[0][2], 0.72],
                        [seg[1][0], seg[1][1], seg[1][2], 0.10]];
          for (const [px, py, pz, wd] of ring) {
            // 葉の向き
            const lx = px - cx, ly = py - cy, lz = pz - cz;
            const nl = Math.hypot(lx, ly, lz) || 1;
            // 法線は葉の向き × 幅の向き。端は外へ 25% 寝かせて丸みにする
            const nx = (ly / nl) * az, ny = (lz / nl) * ax - (lx / nl) * az, nz = -(ly / nl) * ax;
            const nn = Math.hypot(nx, ny, nz) || 1;
            for (const side of [1, -1]) {
              b.pos.push(px + ax * wd * side, py, pz + az * wd * side);
              b.nrm.push((nx / nn) * side + ax * 9.0 * side,
                         ny / nn,
                         (nz / nn) * side + az * 9.0 * side);
              b.reg.push(11);
            }
          }
          for (let q = 0; q < 2; q++) {
            const o = base + q * 2;
            b.idx.push(o, o + 1, o + 2, o + 1, o + 3, o + 2);
          }
        }
      }
    }
  }

  // --- 鉢の中の水面 ---
  {
    const t = JAR.waterY / JAR.height;
    const r = jarRadius(t) - JAR.wall;
    const base = b.pos.length / 3;
    b.pos.push(0, JAR.waterY, 0); b.nrm.push(0, 1, 0); b.reg.push(9);
    for (let j = 0; j <= SEG; j++) {
      const a = (j / SEG) * Math.PI * 2;
      b.pos.push(Math.cos(a) * r, JAR.waterY, Math.sin(a) * r);
      b.nrm.push(0, 1, 0); b.reg.push(9);
    }
    for (let j = 0; j < SEG; j++) b.idx.push(base, base + j + 1, base + j + 2);
  }

  return b.build(gl);
}
