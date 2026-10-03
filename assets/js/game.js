// ゲームの進行と掬いの判定。
//
// いまは時間制限も紙の消耗も入れていない。掬う手応えだけを見たいので、
// 「ポイを金魚の下に入れて持ち上げたら器に入る」ところまでに絞ってある。
// 制限時間とポイの枚数は、後で足せるよう形だけ残してある。
//
// 掬えたかどうかは 2 段階。
//   1. 上がっていくポイの上にいる金魚を「乗った」状態にする
//   2. ポイが水面より上に出きった時、まだ乗っていれば成功

import { School } from './fish.js?v=202610030133';
import { Poi } from './poi.js?v=202610030133';
import { TANK, POI, BOWL, FISH_KINDS, TURTLE, MAX_BOWL, AIR, RAIN } from './world.js?v=202610030133';

/** props.js の頂点シェーダと同じハッシュ。粒の位置と速さを一致させる。 */
const h11 = (x) => {
  const v = Math.sin(x * 127.1) * 43758.5453;
  return v - Math.floor(v);
};

export const PHASE = { READY: 'ready', PLAY: 'play', OVER: 'over' };

/** 掬えた金魚を、器へ移す前に手元で見せている時間 [秒]。 */
const SHOW_TIME = 1.1;

export class Game {
  constructor() {
    this.school = new School(52);
    this.poi = new Poi();
    this.poi.visible = false;
    this.phase = PHASE.READY;
    this.showUntil = 0;
    this.rain = 0;      // 0 = 降っていない, 1 = 本降り
    // 店じまい。ポイを貸してもらえないので、水面をなでることしかできない
    this.closed = false;
    this.touch = null;
    this.time = 0;          // シェーダへ渡す経過時間。止めない
    this.reset();
  }

  reset() {
    this.showUntil = 0;
    this.left = Infinity;    // 制限時間は今は無し（UI も出していない）
    this.stock = 1;
    this.score = 0;
    this.caught = 0;
    this.bowl = [];          // 器で泳いでいる金魚
    this.school.reset();
    this.poi.reset(true);
    this.poi.visible = false;
    this.held = [];
    this.lifting = false;
    this.events = [];       // UI に渡す出来事
    this.phase = PHASE.READY;
  }

  /** 器の中の金魚を回す。ただ円を描かせるだけ。 */
  #updateBowl(dt) {
    for (const f of this.bowl) {
      f.a += f.spin * dt;
      f.r += Math.sin(this.time * 0.7 + f.phase) * 0.004 * dt;
      f.p[0] = BOWL.pos[0] + Math.cos(f.a) * f.r;
      f.p[2] = BOWL.pos[2] + Math.sin(f.a) * f.r;
      f.p[1] = BOWL.waterY - 0.012 + Math.sin(this.time * 1.3 + f.phase) * 0.004;
      f.yaw = f.a + (f.spin > 0 ? Math.PI / 2 : -Math.PI / 2);
    }
  }

  start() {
    this.reset();
    this.phase = PHASE.PLAY;
    this.poi.visible = true;
  }

  /** 画面から拾った水面上の位置。null なら動かさない。 */
  aim(hit) {
    if (!hit) return;
    if (this.closed) { this.touch = [hit[0], hit[1]]; return; }
    this.poi.aim(hit[0], hit[1]);
  }

  press(down) {
    if (this.phase !== PHASE.PLAY) return;
    if (this.closed) { this.stroking = down; return; }
    this.poi.pressed = down;
  }

  update(dt) {
    this.time += dt;
    const poi = this.poi;

    this.#updateBowl(dt);

    // 雨粒も泡も、描いている粒と同じ式で位相を見て、
    // ちょうど水面に届いた瞬間に波紋を落とす
    this.#surfaceHits(dt);

    // 店じまいのあと。ポイは片付けられていて、水面をなでるだけ。
    // 指の跡に沿って、浅い波が立つ
    if (this.closed) {
      poi.visible = false;
      poi.pressed = false;
      if (this.stroking && this.touch && this.ripple) {
        const [x, z] = this.touch;
        const d = this.lastTouch ? Math.hypot(x - this.lastTouch[0], z - this.lastTouch[1]) : 0;
        this.ripple.drop(x, z, 0.030, -0.0004 - Math.min(d, 0.05) * 0.030);
        this.lastTouch = [x, z];
      } else {
        this.lastTouch = null;
      }
      this.school.update(dt, { submerged: false, x: 0, z: 0, y: 1 }, this.ripple);
      return;
    }
    poi.visible = true;

    if (this.phase !== PHASE.PLAY) {
      // 遊んでいない間も水面は動かす。開始前の画面がただの静止画にならない
      this.school.update(dt, { submerged: false, x: 0, z: 0, y: 1 }, this.ripple);
      return;
    }

    // 掬われた金魚の復帰
    for (const f of this.school.list) {
      if (f.gone && f.respawnAt !== undefined && this.time >= f.respawnAt) {
        f.reset(true);
        f.respawnAt = undefined;
      }
    }

    const load = this.held.reduce((s, f) => s + (f.turtle ? TURTLE.weight : FISH_KINDS[f.kind].weight), 0);
    poi.update(dt, this.ripple, load);
    this.school.update(dt, poi, this.ripple);

    // 乗せる判定。
    // いまは「ポイの上にいる金魚は乗る」だけの素直な形にしてある。
    // 窓を狭めると、まず一匹も掬えない。難度の調整は後回し。
    if (poi.vy > 0.001 && poi.y < 0.015) {
      for (const f of this.school.list) {
        if (f.held || f.gone) continue;
        const d = Math.hypot(f.p[0] - poi.x, f.p[2] - poi.z);
        const above = f.p[1] - poi.y;
        if (d < POI.radius * 1.35 && above > -0.030 && above < 0.095) {
          f.held = true;
          this.held.push(f);
        }
      }
    }

    // 乗っている金魚をポイに貼り付ける
    for (const f of this.held) {
      const ang = f.yaw;
      // 紙の上で少し滑る
      f.holdOff[0] += Math.cos(ang) * 0.012 * dt * 6;
      f.holdOff[1] += Math.sin(ang) * 0.012 * dt * 6;
      const r = Math.hypot(f.holdOff[0], f.holdOff[1]);
      const lim = POI.radius * 0.62;
      if (r > lim) {
        f.holdOff[0] *= lim / r;
        f.holdOff[1] *= lim / r;
      }
      f.p[0] = poi.x + f.holdOff[0];
      f.p[2] = poi.z + f.holdOff[1];
      f.p[1] = poi.y + f.len * 0.16 + poi.sag * -0.5;
      // 見せている間は、紙の上でぴちぴち跳ねる。
      // 跳ねは片側だけ（sin の正の側を二乗）にすると、紙を蹴って
      // 飛び上がって落ちる、という動きになる
      if (this.showUntil > 0) {
        const hop = Math.max(0, Math.sin(f.flop * 1.15));
        f.p[1] += hop * hop * f.len * 0.60;
      }
    }

    // 水面を割った瞬間の音
    if (poi.y > 0.004 && !this.lifting) {
      this.lifting = true;
    } else if (poi.y <= 0.004) {
      this.lifting = false;
    }

    // 完全に水から出たら成功。
    //
    // ここですぐ器へ飛ばすと、掬えたのかどうかが分からない。
    // ポイを上で止めて、紙の上で跳ねているところを一拍見せてから移す
    if (poi.y > POI.restY * 0.72 && this.held.length && this.showUntil === 0) {
      this.showUntil = this.time + SHOW_TIME;
      poi.locked = true;
    }
    if (this.showUntil > 0 && this.time >= this.showUntil) {
      this.showUntil = 0;
      poi.locked = false;
      for (const f of this.held) {
        const k = f.turtle ? TURTLE : FISH_KINDS[f.kind];
        const size = Math.max(0, Math.round((f.len - 0.036) * 1400));
        this.score += k.score + size;
        this.caught++;
        this.events.push({ type: 'catch', name: k.name, score: k.score + size });
        this.#toBowl(f);
        f.gone = true;
        f.held = false;
        f.flop = 0;
        // 掬われたぶん、舟の外から足される体で新しいのが入ってくる。
        // setTimeout にすると、やり直しと競合して 1 匹だけ再抽選が走る。
        // 亀はたまにしか居ないので、間を長く空ける
        f.respawnAt = this.time + (f.turtle ? TURTLE.interval * (0.6 + Math.random()) : 0.9);
      }
      this.held.length = 0;
    }
  }

  /**
   * 水面に届いたものから波紋を落とす。
   *
   * 雨粒も泡も、描画側（props.js の頂点シェーダ）が通し番号と時刻から
   * 位置を引いている。ここでも同じ式を使い、位相が切り替わった粒だけを拾う。
   * 別々に乱数で出すと、落ちている所と輪の立つ所が合わず、
   * 「雨が降っている」ではなく「水面がざわついている」にしか見えない。
   */
  #surfaceHits(dt) {
    if (!this.ripple || dt <= 0) return;
    const prev = this.time - dt;

    if (this.rain > 0) {
      for (let i = 0; i < RAIN.count; i++) {
        const r1 = h11(i * 1.7), r2 = h11(i * 3.1 + 5.0), r3 = h11(i * 7.3 + 11.0);
        const period = 0.70 + r1 * 0.55;
        // 位相が 1 周したら、その粒が水面に着いたということ
        if (Math.floor(this.time / period + r2) === Math.floor(prev / period + r2)) continue;
        this.ripple.drop(
          (r1 * 2 - 1) * TANK.halfX * 1.05,
          (r3 * 2 - 1) * TANK.halfZ * 1.05,
          0.006 + r2 * 0.004,
          0.0016,
        );
      }
    }

    // 泡。上がりきった瞬間にはじけて、小さな輪が立つ。
    // 0.86 は props.js の RISE と同じ値
    for (let i = 0; i < AIR.bubbles; i++) {
      const r1 = h11(i * 1.7), r2 = h11(i * 3.1 + 5.0), r3 = h11(i * 7.3 + 11.0);
      const k = (0.14 + r1 * 0.07) / 0.16;
      const was = (prev * k + r2) % 1;
      const now = (this.time * k + r2) % 1;
      const crossed = now < was ? was < 0.86 : (was < 0.86 && now >= 0.86);
      if (!crossed) continue;
      // 1 粒ずつは弱く。54 粒が毎秒 60 回も同じ所を叩くので、
      // 1 回ぶんを強くすると、石の上に窪みが立ったまま残る
      this.ripple.drop(
        AIR.stone[0] + (r1 - 0.5) * 0.020,
        AIR.stone[2] + (r3 - 0.5) * 0.012,
        0.007 + r3 * 0.004,
        0.00028,
      );
    }
  }

  /** 掬った金魚を器へ入れる。 */
  #toBowl(f) {
    this.bowl.push({
      turtle: f.turtle,
      kind: f.kind,
      len: f.len * 0.92,
      seed: f.seed,
      a: Math.random() * Math.PI * 2,
      r: BOWL.innerR * (0.30 + Math.random() * 0.34),
      spin: (Math.random() > 0.5 ? 1 : -1) * (0.8 + Math.random() * 0.9),
      phase: Math.random() * 10,
      beat: 9 + Math.random() * 4,
      p: [BOWL.pos[0], BOWL.waterY - 0.012, BOWL.pos[2]],
      yaw: 0,
      bend: 0,
    });
    if (this.bowl.length > MAX_BOWL) this.bowl.shift();
  }

  /** 制限時間もポイの消耗も止めているので、いまは誰も呼ばない。
   *  戻すときのために形だけ残してある。 */
  #finish() {
    this.phase = PHASE.OVER;
    this.poi.visible = false;
    for (const f of this.held) f.held = false;
    this.held.length = 0;
  }

  get grade() {   // 今は使っていない。制限時間を戻したときのため
    const n = this.caught;
    if (n >= 12) return '金魚すくい名人。屋台が傾く';
    if (n >= 8) return 'みごとな手つき。持ち帰り袋が重い';
    if (n >= 5) return '上出来。袋に三匹は立派';
    if (n >= 2) return 'まずまず。ポイは斜めに入れると長持ちする';
    if (n >= 1) return '一匹は一匹。次は焦らず';
    return '全滅。水に入れたまま動かすと、紙はすぐ負ける';
  }
}

export { TANK };
