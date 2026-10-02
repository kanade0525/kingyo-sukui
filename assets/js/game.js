// ゲームの進行と掬いの判定。
//
// いまは時間制限も紙の消耗も入れていない。掬う手応えだけを見たいので、
// 「ポイを金魚の下に入れて持ち上げたら器に入る」ところまでに絞ってある。
// 制限時間とポイの枚数は、後で足せるよう形だけ残してある。
//
// 掬えたかどうかは 2 段階。
//   1. 上がっていくポイの上にいる金魚を「乗った」状態にする
//   2. ポイが水面より上に出きった時、まだ乗っていれば成功

import { School } from './fish.js?v=202610020554';
import { Poi } from './poi.js?v=202610020554';
import { TANK, POI, BOWL, FISH_KINDS, MAX_BOWL } from './world.js?v=202610020554';

export const PHASE = { READY: 'ready', PLAY: 'play', OVER: 'over' };

export class Game {
  constructor(sound) {
    this.sound = sound;
    this.school = new School(11);
    this.poi = new Poi();
    this.poi.visible = false;
    this.phase = PHASE.READY;
    this.time = 0;          // シェーダへ渡す経過時間。止めない
    this.reset();
  }

  reset() {
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
    if (hit) this.poi.aim(hit[0], hit[1]);
  }

  press(down) {
    if (this.phase !== PHASE.PLAY) return;
    const was = this.poi.pressed;
    this.poi.pressed = down;
    if (down && !was) this.sound.dip();
    if (!down && was && this.poi.submerged) this.sound.lift();
  }

  update(dt) {
    this.time += dt;
    const poi = this.poi;

    this.#updateBowl(dt);

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

    const load = this.held.reduce((s, f) => s + FISH_KINDS[f.kind].weight, 0);
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
    }

    // 水面を割った瞬間の音
    if (poi.y > 0.004 && !this.lifting) {
      this.lifting = true;
      if (this.held.length) this.sound.splash();
    } else if (poi.y <= 0.004) {
      this.lifting = false;
    }

    // 完全に水から出たら成功。器へ移す
    if (poi.y > POI.restY * 0.72 && this.held.length) {
      for (const f of this.held) {
        const k = FISH_KINDS[f.kind];
        const size = Math.max(0, Math.round((f.len - 0.036) * 1400));
        this.score += k.score + size;
        this.caught++;
        this.events.push({ type: 'catch', name: k.name, score: k.score + size });
        this.sound.chime(1180 + f.kind * 220);
        this.#toBowl(f);
        f.gone = true;
        f.held = false;
        // 掬われたぶん、舟の外から足される体で新しい金魚が入ってくる。
        // setTimeout にすると、やり直しと競合して 1 匹だけ再抽選が走る
        f.respawnAt = this.time + 0.9;
      }
      this.held.length = 0;
    }
  }

  /** 掬った金魚を器へ入れる。 */
  #toBowl(f) {
    this.bowl.push({
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
