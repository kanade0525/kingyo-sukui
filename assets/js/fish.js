// 金魚の群れ。形はシェーダ任せなので、ここは居場所と向きだけを持つ。
//
// 群れ行動（boids）は入れていない。狭い舟の中で 12 匹程度だと、
// 整列させるより、それぞれが勝手に漂って壁で向きを変えるほうが
// 実際の金魚に近い動きになる。

import { TANK, FISH_KINDS, FISH_LAYER, TURTLE, MAX_FISH, PAD, BOWL } from './world.js?v=202610052158';
import { clamp, lerp, wrapAngle } from './mat.js?v=202610052158';

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
    // 小赤と小黒は全長 3cm ほど。出目金はひと回り大きい
    this.len = this.turtle
      ? rand(0.030, 0.038)
      : this.kind <= 1 ? rand(0.026, 0.035) : rand(0.040, 0.050);
    const y = rand(FISH_LAYER.bottom, FISH_LAYER.top);
    this.p = fromEdge
      ? [rand(-1, 1) > 0 ? mx : -mx, y, rand(-mz, mz)]
      : [rand(-mx, mx), y, rand(-mz, mz)];
    this.yaw = rand(-Math.PI, Math.PI);
    // 亀はゆっくり漕ぐ。そのぶん逃げ足も鈍い
    // 小さい魚ほど忙しなく動く
    // 用心深さ。小黒はよく逃げる
    this.wary = this.turtle ? 0.6 : (FISH_KINDS[this.kind].wary ?? 1);
    this.speed = this.turtle ? rand(0.010, 0.022)
               : this.kind <= 1 ? rand(0.026, 0.055) * this.wary : rand(0.018, 0.038);
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
    //
    // 逃げ足は全体に底上げしてある。遅いと、ポイを置いておくだけで
    // 勝手に乗ってしまい、掬った手応えが無い。
    // 逃げ足を速くしすぎると人間の手では追いつけず、一匹も掬えなくなる。
    // 自分と同じくらいの深さに来たときだけ嫌がる、という程度にしてある
    let alarmed = false;
    // 沈んだポイには強く反応する。水の上にあるときも、影が差すぶん
    // 少しだけ嫌がる
    // 用心深い個体ほど、遠くから気づいて強く逃げる
    const near = (poi.submerged ? 0.150 : 0.094) * this.wary;
    const force = (poi.submerged ? 5.8 : 2.0) * this.wary;
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

    // 浮かべたお椀。中へは入れないし、突き抜けもしない。
    // お椀の底より深い所を泳いでいる魚は、下をくぐれる
    const underBowl = this.p[1] < BOWL.floorY - 0.014;
    if (!underBowl) {
      const bx = this.p[0] - BOWL.pos[0], bz = this.p[2] - BOWL.pos[2];
      const bd = Math.hypot(bx, bz);
      const keep = BOWL.outerR + this.len * 0.8;
      if (bd < keep) {
        const w = (1 - bd / keep) * 3.4;
        dx += (bx / (bd || 1e-4)) * w;
        dz += (bz / (bd || 1e-4)) * w;
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
    const rate = alarmed ? 12.5 * this.wary : 3.2;
    const step = turn * Math.min(1, dt * rate);
    this.yaw += step;
    this.bend = lerp(this.bend, clamp(-step / Math.max(dt, 1e-3) * 0.012, -0.09, 0.09), dt * 10);

    // たまに一息に泳ぐ
    this.dashTimer -= dt;
    if (this.dashTimer < 0) {
      this.dashTimer = rand(2.5, 8);
      this.speed = this.cruise * rand(2.6, 4.2);
    }
    const goal = alarmed ? this.cruise * (this.turtle ? 3.4 : 6.8 * this.wary) : this.cruise;
    this.speed = lerp(this.speed, goal, dt * (alarmed ? 15 : 1.3));
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

    // お椀の中にも入れない。
    // 向きを変えさせるだけだと、勢いがついているときに突き抜ける。
    // 入ってしまったら、いちばん近い外側へ押し出す
    if (this.p[1] >= BOWL.floorY - 0.014) {
      const bx = this.p[0] - BOWL.pos[0], bz = this.p[2] - BOWL.pos[2];
      const bd = Math.hypot(bx, bz);
      const keep = BOWL.outerR + this.len * 0.45;
      if (bd < keep) {
        const k = keep / (bd || 1e-4);
        this.p[0] = BOWL.pos[0] + bx * k;
        this.p[2] = BOWL.pos[2] + bz * k;
      }
    }

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
    this.shadowB = new Float32Array(MAX_FISH * 4);
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
   * 影は 256² の絵へ先に焼くので、匹数を絞る必要はもう無い。
   * 位置・体長・濃さに加えて、進む向きとぼけ具合も渡す。
   * 円ではなく魚の形にするため。
   */
  shadowData(sunHoriz = [0, 0], refrTan = 0) {
    const d = this.shadow, e = this.shadowB;
    let n = 0;
    for (const f of this.list) {
      if (f.gone || f.p[1] > 0 || n >= MAX_FISH) continue;
      const below = Math.max(-f.p[1], 0.001);
      // 水底までの残りの深さだけ、光の進む向きへ流れる
      const drop = (TANK.depth - below) * refrTan;
      const o = n * 4;
      d[o] = f.p[0] - sunHoriz[0] * drop;
      d[o + 1] = f.p[2] - sunHoriz[1] * drop;
      d[o + 2] = f.len * 1.9;                       // 影の長さ。尾まで入る
      d[o + 3] = 0.34 * Math.exp(-below * 2.0);     // 深いほど薄い
      e[o] = Math.cos(f.yaw);
      e[o + 1] = Math.sin(f.yaw);
      // 深いほどぼける。ただし掛けすぎると、せっかくの魚の形が
      // ただの大きな染みになる
      e[o + 2] = 0.05 + below * 1.2;
      e[o + 3] = f.turtle ? 1 : 0;
      n++;
    }
    this.shadowCount = n;
    return d;
  }
}

export { Fish };
