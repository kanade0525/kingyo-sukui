// 配置。浮いている物どうし、物と器、物と舟がぶつからないこと。
//
// 葉が器を貫通していた件が出どころ。置き場所の表を直しても、
// 見下ろす角度を変えると器が舟の中へ寄るので、また当たる。
// 角度と向きの全ての組み合わせで確かめる。

import { TANK, BOWL, PAD, WEED, LEAF, POI, LANTERN, AIR, ROOM,
         tankHalfAt, pushOutOfBowl, bowlPosFor, mapleLeaves } from '../../assets/js/world.js?v=202610041317';
import { ok, between, near } from '../lib/assert.mjs';

const PITCHES = [[55, '浅め'], [65, '標準'], [87, '真上']];
const VIEWS = [[false, '横画面'], [true, '縦画面']];

/** 浮き物を、置き場所・半径・押しのけたあとの余白つきで並べる */
function floaters() {
  const out = [];
  for (const c of PAD.leaves) out.push({ kind: '睡蓮', x: c.x, z: c.z, r: c.r, keep: c.r * 0.86, m: c.r });
  for (const c of LEAF.spots) out.push({ kind: '楓', x: c.x, z: c.z, r: c.r, keep: c.r * 0.9, m: c.r * 1.6 });
  // ウキクサは群れの中にばらまく。いちばん外側に出る点で見る
  for (const c of WEED.clumps) {
    for (const a of [0, 1.57, 3.14, 4.71]) {
      out.push({ kind: 'ウキクサ',
                 x: c.x + Math.cos(a) * c.r, z: c.z + Math.sin(a) * c.r,
                 r: WEED.lenMax, keep: WEED.lenMax, m: WEED.lenMax * 2.2 });
    }
  }
  return out;
}

export default {
  '舟の寸法が実物と合う': () => {
    // トロ舟 80L。内寸 850 × 548 × 深さ 187mm
    near(TANK.halfX * 2, 0.838, 0.02, '内寸の長辺');
    near(TANK.halfZ * 2, 0.535, 0.02, '内寸の短辺');
    between(TANK.depth, 0.12, 0.19, '水深');
    // 垂直な箱ではなく、底から上へ開く台形
    ok(TANK.draftX > 0.05, '抜き勾配が無い。垂直な箱になっている');
    ok(tankHalfAt(TANK.rimTop) > tankHalfAt(-TANK.depth),
       '上のほうが狭い。勾配の向きが逆');
    ok(TANK.cornerR > 0.03, '角に丸みが無い');
  },

  'ポイが実物の規格と合う': () => {
    // 外径 83mm・内径 78mm・全長 150mm
    near(POI.radius * 2, 0.078, 0.002, '紙の直径（内径）');
    ok(POI.deepY < -0.05, 'いちばん沈めても浅い。金魚の下へ入れない');
    ok(POI.restY > 0, '待機時に水面より下にある');
    // 柄を握る位置。輪の外、かつ全長の内側
    ok(POI.grip > POI.radius, '握る位置が紙の上にある');
    ok(POI.grip < 0.150 - POI.radius, '握る位置が柄より外に出ている');
  },

  'ポイが舟のどこへでも届く': () => {
    // aim は舟の内側へ丸める。四隅まで紙が入ること
    const m = 0.012;
    ok(TANK.halfX - POI.radius - m > 0.3, 'ポイが長辺の端まで届かない');
    ok(TANK.halfZ - POI.radius - m > 0.19, 'ポイが短辺の端まで届かない');
  },

  'どの角度・向きでも浮き物が器を貫通しない': () => {
    for (const [pitch, pname] of PITCHES) {
      for (const [portrait, vname] of VIEWS) {
        const bowl = bowlPosFor(pitch, portrait);
        for (const f of floaters()) {
          const [px, pz] = pushOutOfBowl(f.x, f.z, BOWL.outerR + f.keep, bowl, f.m);
          const d = Math.hypot(px - bowl[0], pz - bowl[2]);
          ok(d >= BOWL.outerR + f.keep - 1e-6,
             `${pname}・${vname} で ${f.kind} が器に ${((BOWL.outerR + f.keep - d) * 1000).toFixed(0)}mm 食い込む`);
        }
      }
    }
  },

  'どの角度・向きでも浮き物が舟からはみ出さない': () => {
    for (const [pitch, pname] of PITCHES) {
      for (const [portrait, vname] of VIEWS) {
        const bowl = bowlPosFor(pitch, portrait);
        for (const f of floaters()) {
          const [px, pz] = pushOutOfBowl(f.x, f.z, BOWL.outerR + f.keep, bowl, f.m);
          ok(Math.abs(px) <= TANK.halfX && Math.abs(pz) <= TANK.halfZ,
             `${pname}・${vname} で ${f.kind} が舟の外に出る`);
        }
      }
    }
  },

  '器が舟の内側に収まる': () => {
    for (const [pitch, pname] of PITCHES) {
      for (const [portrait, vname] of VIEWS) {
        const b = bowlPosFor(pitch, portrait);
        ok(Math.abs(b[0]) + BOWL.outerR < TANK.halfX,
           `${pname}・${vname} で器が長辺からはみ出す`);
        ok(Math.abs(b[2]) + BOWL.outerR < TANK.halfZ,
           `${pname}・${vname} で器が短辺からはみ出す`);
      }
    }
  },

  '提灯が二つあることが光で分かる': () => {
    // 高さ 1.05m・左右 0.95m に吊っていたときは、舟の上の照度が
    // 中心 100% に対して端で 115% しか変わらず、二灯に見えなかった
    const pts = [[0, 0], [-0.42, 0], [0.42, 0], [-0.42, -0.27], [0.42, 0.27], [0, 0.27]];
    const lit = pts.map(([x, z]) => {
      let s = 0;
      for (const q of [[-LANTERN.across, LANTERN.y, LANTERN.toward],
                       [LANTERN.across, LANTERN.y, LANTERN.toward]]) {
        const dx = q[0] - x, dy = q[1], dz = q[2] - z;
        const d2 = dx * dx + dy * dy + dz * dz;
        s += (dy / Math.sqrt(d2)) / d2;      // 上向きの面が受ける量
      }
      return s;
    });
    const ratio = Math.max(...lit) / Math.min(...lit);
    ok(ratio > 1.4, `舟の上の照度が平すぎる（最大 / 最小 = ${ratio.toFixed(2)}）`);
    ok(LANTERN.y < 0.9, '提灯が高すぎる。遠いと二灯でも均一な照明になる');
  },

  'エアストーンが舟の中にある': () => {
    ok(Math.abs(AIR.stone[0]) < TANK.halfX, 'エアストーンが長辺の外');
    ok(Math.abs(AIR.stone[2]) < TANK.halfZ, 'エアストーンが短辺の外');
    between(AIR.bubbles, 8, 120, '泡の数');
  },

  'ウキクサと楓が実物の大きさ': () => {
    // ウキクサの葉状体は 3〜10mm
    between(WEED.lenMin * 1000, 2.5, 5, 'ウキクサの最小（mm）');
    between(WEED.lenMax * 1000, 7, 11, 'ウキクサの最大（mm）');
    // イロハモミジの葉は 3.5〜6cm
    for (const c of LEAF.spots) between(c.r * 2 * 100, 3.0, 6.5, `楓の葉の差し渡し（cm）`);
  },

  '庭の作りものが縁側と竹垣の間に収まる': () => {
    // 縁側の縁より手前に置くと縁側にめり込み、竹垣より奥に置くと垣の裏へ出る
    const things = [
      ['石灯籠', ROOM.lantern[0], ROOM.lantern[1]],
      ['蹲踞', ROOM.basin[0], ROOM.basin[1]],
      ['楓', ROOM.maple[0], ROOM.maple[1]],
      ...ROOM.shrubs.map((s, i) => [`刈り込み${i + 1}`, s[0], s[1]]),
    ];
    for (const [name, , z] of things) {
      ok(z < ROOM.edgeZ, `${name} が縁側（z=${ROOM.edgeZ}）より手前`);
      ok(z > ROOM.fenceZ, `${name} が竹垣（z=${ROOM.fenceZ}）より奥`);
    }
    // 借景は竹垣のさらに向こう
    ok(ROOM.skylineZ < ROOM.fenceZ - 10, '借景が竹垣に近すぎる');
  },

  '石灯籠が楓の葉叢に隠れない': () => {
    // 覆われると、昼は形が読めず、夜は火袋の灯が消える。
    // 灯籠は竿から宝珠まで縦に長いので、柱として扱って水平の隔たりで見る
    for (const [x, , z, r] of mapleLeaves()) {
      const gap = Math.hypot(ROOM.lantern[0] - x, ROOM.lantern[1] - z);
      ok(gap > r + 0.10, `灯籠が葉叢の中（隔たり ${gap.toFixed(2)}m / 半径 ${r.toFixed(2)}m）`);
    }
  },

  '楓の葉叢が地面にめり込まない': () => {
    for (const [, y, , r] of mapleLeaves()) {
      ok(y - r > ROOM.gardenY, `葉叢が地面（y=${ROOM.gardenY}）より下`);
    }
  },

  '浮き物が舟の真ん中を塞がない': () => {
    // ポイを振る所。中央 ±15cm × ±9cm は空けておく
    for (const f of floaters()) {
      ok(!(Math.abs(f.x) < 0.15 && Math.abs(f.z) < 0.09),
         `${f.kind} が真ん中（${f.x.toFixed(2)}, ${f.z.toFixed(2)}）にある`);
    }
  },
};
