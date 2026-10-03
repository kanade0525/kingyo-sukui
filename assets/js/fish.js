// 金魚の群れ。形はシェーダ任せなので、ここは居場所と向きだけを持つ。
//
// 群れ行動（boids）は入れていない。狭い舟の中で 12 匹程度だと、
// 整列させるより、それぞれが勝手に漂って壁で向きを変えるほうが
// 実際の金魚に近い動きになる。

import { TANK, FISH_KINDS, FISH_LAYER, TURTLE, MAX_FISH, PAD } from './world.js?v=202610030454';
import { clamp, lerp, wrapAngle } from './mat.js?v=202610030454';

const rand = (a, b) => a + Math.random() * (b - a);

function pickKind() {
  let r = Math.random();
  for (let i = 0; i < FISH_KINDS.length; i++) {
    r -= FISH_KINDS[i].chance;
    if (r <= 0) return i;
  }
  return 0;
}

class Fish {
  constructor(turtle = false) {
    this.turtle = turtle;
    this.reset();
  }

  reset(fromEdge = false) {
    const mx = TANK.halfX - 0.07, mz = TANK.halfZ - 0.07;
    this.kind = this.turtle ? 0 : pickKind();
    // 小赤は全長 3cm ほど。出目金はひと回り大きい。
    // 亀は甲長 3cm の子ガメで、小赤と同じくらいしかない
    this.len = this.turtle
      ? rand(0.030, 0.038)
      : this.kind === 0 ? rand(0.026, 0.035) : rand(0.040, 0.050);
    const y = rand(FISH_LAYER.bottom, FISH_LAYER.top);
    this.p = fromEdge
      ? [rand(-1, 1) > 0 ? mx : -mx, y, rand(-mz, mz)]
      : [rand(-mx, mx), y, rand(-mz, mz)];
    this.yaw = rand(-Math.PI, Math.PI);
    // 亀はゆっくり漕ぐ。そのぶん逃げ足も鈍い
    // 小さい魚ほど忙しなく動く
    this.speed = this.turtle ? rand(0.010, 0.022)
               : this.kind === 0 ? rand(0.026, 0.055) : rand(0.018, 0.038);
    this.cruise = this.speed;
    this.beat = this.turtle ? rand(3.2, 4.6) : rand(9.0, 13.0);
    this.phase = rand(0, 10);
    this.seed = Math.random();
    this.bend = 0;
    this.wander = 0;
    this.target = this.p[1];
    this.depthTimer = rand(0.5, 3);
    this.dashTimer = rand(2, 7);
    this.held = false;
    this.holdOff = [0, 0];
    this.gone = false;
    this.flop = 0;
  }

  /** 1 匹ぶんの更新。poi は { x, z, y, submerged } だけ見る。 */
  update(dt, poi, ripple) {
    if (this.held) {
      this.flop += dt * 19;
      // 掬われた金魚は暴れる。ポイの上で滑りもする。
      // 水の外では体を強く折って跳ねるので、振りは水中よりずっと大きい
      this.yaw += Math.sin(this.flop) * dt * 5.5;
      this.beat = 24;
      this.bend = Math.sin(this.flop * 1.7) * 0.24;
      return;
    }

    const edgeX = TANK.halfX - 0.055, edgeZ = TANK.halfZ - 0.055;
    let dx = Math.cos(this.yaw), dz = Math.sin(this.yaw);

    // 壁から押し戻される
    if (this.p[0] > edgeX) dx -= (this.p[0] - edgeX) / 0.05;
    if (this.p[0] < -edgeX) dx += (-edgeX - this.p[0]) / 0.05;
    if (this.p[2] > edgeZ) dz -= (this.p[2] - edgeZ) / 0.05;
    if (this.p[2] < -edgeZ) dz += (-edgeZ - this.p[2]) / 0.05;

    // ポイが沈んでいたら逃げる。
    // 逃げ足を速くしすぎると人間の手では追いつけず、一匹も掬えなくなる。
    // 自分と同じくらいの深さに来たときだけ嫌がる、という程度にしてある
    let alarmed = false;
    // 沈んだポイには強く反応する。水の上にあるときも、影が差すぶん
    // 少しだけ嫌がる
    const near = poi.submerged ? 0.115 : 0.070;
    const force = poi.submerged ? 4.2 : 1.4;
    if (Math.abs(poi.y - this.p[1]) < 0.16) {
      const ax = this.p[0] - poi.x, az = this.p[2] - poi.z;
      const d = Math.hypot(ax, az);
      if (d < near) {
        const w = (1 - d / near) * force;
        dx += (ax / (d || 1e-4)) * w;
        dz += (az / (d || 1e-4)) * w;
        alarmed = true;
      }
    }

    // 浮き葉の下へ逃げる。日陰は金魚にとっての隠れ場所で、
    // 驚かされると真っ先にここへ入る。落ち着いている時も、
    // 近くにあればそちらに寄っていく
    let shaded = false;
    for (const L of PAD.leaves) {
      const bx = L.x - this.p[0], bz = L.z - this.p[2];
      const bd = Math.hypot(bx, bz);
      const reach = L.r * PAD.shelter;
      if (bd < reach) { shaded = true; continue; }     // もう下にいる
      // 驚いている時だけ、遠くの葉も目指す
      const lure = alarmed ? reach * 3.4 : reach * 1.5;
      if (bd < lure) {
        const w = (1 - bd / lure) * (alarmed ? 2.6 : 0.5);
        dx += (bx / bd) * w;
        dz += (bz / bd) * w;
      }
    }
    // 葉の下に入れたら落ち着く
    if (shaded) alarmed = false;

    // ふらつき
    this.wander += rand(-1, 1) * dt * 9;
    this.wander = clamp(this.wander, -1.4, 1.4);
    this.wander *= 1 - dt * 1.6;

    const want = Math.atan2(dz, dx) + this.wander * 0.22;
    const turn = wrapAngle(want - this.yaw);
    const rate = alarmed ? 9 : 3.2;
    const step = turn * Math.min(1, dt * rate);
    this.yaw += step;
    this.bend = lerp(this.bend, clamp(-step / Math.max(dt, 1e-3) * 0.012, -0.09, 0.09), dt * 10);

    // たまに一息に泳ぐ
    this.dashTimer -= dt;
    if (this.dashTimer < 0) {
      this.dashTimer = rand(2.5, 8);
      this.speed = this.cruise * rand(2.6, 4.2);
    }
    const goal = alarmed ? this.cruise * (this.turtle ? 3.0 : 5.0) : this.cruise;
    this.speed = lerp(this.speed, goal, dt * (alarmed ? 11 : 1.3));
    this.beat = this.turtle
      ? lerp(this.beat, 2.8 + this.speed * 60, dt * 4)
      : lerp(this.beat, 6 + this.speed * 125, dt * 6);

    this.p[0] += Math.cos(this.yaw) * this.speed * dt;
    this.p[2] += Math.sin(this.yaw) * this.speed * dt;

    // 泳ぐ深さ
    this.depthTimer -= dt;
    if (this.depthTimer < 0) {
      this.depthTimer = rand(2, 6);
      // 亀は時々、息をしに水面へ上がる
      this.target = this.turtle && Math.random() < 0.35
        ? FISH_LAYER.top
        : shaded
          // 葉の下は日陰なので、水面近くまで上がってきて止まる
          ? rand(FISH_LAYER.top - 0.016, FISH_LAYER.top)
          : rand(FISH_LAYER.bottom, FISH_LAYER.top);
    }
    // 深さはポイに関係なく自分のペースで変える。
    // 真下へ潜らせると紙の上に乗る機会が無くなり、永久に掬えなくなる
    this.p[1] = lerp(this.p[1], clamp(this.target, FISH_LAYER.bottom, FISH_LAYER.top), dt * 1.6);

    // 舟の外に出さない
    const mx = TANK.halfX - 0.035, mz = TANK.halfZ - 0.035;
    this.p[0] = clamp(this.p[0], -mx, mx);
    this.p[2] = clamp(this.p[2], -mz, mz);

    // 水面近くを速く泳ぐと波が立つ
    if (ripple && this.p[1] > -0.05 && this.speed > this.cruise * 1.8) {
      ripple.drop(this.p[0], this.p[2], 0.02, this.speed * 0.0016);
    }
  }
}

export class School {
  constructor(count) {
    this.list = [];
    // 匹数は影の枠（MAX_FISH）とは別物。影は床で 1 画素ごとに舐めるので
    // 数を絞るが、泳いでいる魚はいくら居ても床のシェーダには効かない
    this.count = count;
    for (let i = 0; i < this.count; i++) this.list.push(new Fish());
    // 亀は別枠。たまにしか居ないので、居ないときは gone にしておく
    for (let i = 0; i < TURTLE.max; i++) {
      const t = new Fish(true);
      t.gone = true;
      t.respawnAt = 4 + i * TURTLE.interval * 0.5;
      this.list.push(t);
    }
    // 水底の影を落とすための uniform 配列（xz, 半径, 濃さ）
    this.shadow = new Float32Array(MAX_FISH * 4);
  }

  reset() {
    for (const f of this.list) {
      f.reset();
      if (f.turtle) { f.gone = true; f.respawnAt = 4 + Math.random() * TURTLE.interval; }
    }
  }

  update(dt, poi, ripple) {
    for (const f of this.list) if (!f.gone) f.update(dt, poi, ripple);
  }

  /**
   * 水底の影。深いほど大きく薄くなる。
   * 太陽の向きへずらすのは、真下に置くと見下ろす角度のぶん本体から
   * 離れて並び、金魚が二匹いるように見えるため。
   */
  /**
   * 底に落とす影。
   *
   * 底のシェーダはこの配列を 1 画素ごとに舐めるので、匹数を増やすと
   * そのまま重くなる。枠は MAX_FISH で止めて、溢れたら「いちばん薄い影」と
   * 入れ替える。浅い所にいる魚ほど影が濃いので、見えているものから残る。
   */
  shadowData(sunHoriz = [0, 0], refrTan = 0) {
    const d = this.shadow;
    let n = 0;
    let weakest = 0, weakAlpha = Infinity;
    for (const f of this.list) {
      if (f.gone || f.p[1] > 0) continue;
      const below = Math.max(-f.p[1], 0.001);
      // 深いほど薄く、ぼける。水面が揺れているので輪郭も残らない
      const alpha = 0.17 * Math.exp(-below * 3.2);
      let slot;
      if (n < MAX_FISH) {
        slot = n++;
      } else {
        if (alpha <= weakAlpha) continue;
        slot = weakest;
      }
      // 水底までの残りの深さだけ、光の進む向きへ流れる
      const drop = (TANK.depth - below) * refrTan;
      const o = slot * 4;
      d[o] = f.p[0] - sunHoriz[0] * drop;
      d[o + 1] = f.p[2] - sunHoriz[1] * drop;
      d[o + 2] = f.len * (0.52 + below * 3.4);   // 深いほど大きく広がる
      d[o + 3] = alpha;
      // いちばん薄いものを探し直す
      weakAlpha = Infinity;
      for (let i = 0; i < n; i++) {
        if (d[i * 4 + 3] < weakAlpha) { weakAlpha = d[i * 4 + 3]; weakest = i; }
      }
    }
    this.shadowCount = n;
    return d;
  }
}

export { Fish };
