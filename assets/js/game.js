// ゲームの進行と掬いの判定。
//
// いまは時間制限も紙の消耗も入れていない。掬う手応えだけを見たいので、
// 「ポイを金魚の下に入れて持ち上げたら器に入る」ところまでに絞ってある。
// 制限時間とポイの枚数は、後で足せるよう形だけ残してある。
//
// 掬えたかどうかは 2 段階。
//   1. 上がっていくポイの上にいる金魚を「乗った」状態にする
//   2. ポイが水面より上に出きった時、まだ乗っていれば成功

import { School } from './fish.js?v=202610050644';
import { Poi } from './poi.js?v=202610050644';
import { TANK, POI, BOWL, FISH_KINDS, TURTLE, MAX_BOWL, AIR, RAIN } from './world.js?v=202610050644';

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
    this.sound = null;
    this.school = new School(104);
    this.poi = new Poi();
    // 水に触れた瞬間に鳴らす。音は Game が持っている
    this.poi.onSplash = (power, out) => this.sound?.splash(power, out);
    this.poi.visible = false;
    this.phase = PHASE.READY;
    this.showUntil = 0;
    this.rain = 0;      // 0 = 降っていない, 1 = 本降り
    // 店じまい。ポイを貸してもらえないので、水面をなでることしかできない
    this.closed = false;
    this.touch = null;
    // 持ち帰って抜けていく途中の金魚。器の中身としてはもう無い
    this.leaving = [];

    // 雨粒。降っていなくても配列は作っておく。
    // 進み具合をばらしておかないと、降り始めに全部が同時に着水する
    this.rainDrops = [];
    for (let i = 0; i < RAIN.count; i++) {
      const d = { t: Math.random(), x: 0, z: 0, w: 0, period: 1 };
      this.#reseedDrop(d);
      d.t = Math.random();
      this.rainDrops.push(d);
    }
    this.renewAt = undefined;
    this.holding = false;
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
    // 持ち帰った金魚の退場。
    //
    // 袋は描かない。一式作ると家の画面と同じ作業量になる。
    // 代わりに、水を汲み上げられて上へ抜けていくところだけ見せる。
    // 新しい絵を 1 つも作らずに済む（uLen を縮めるだけ）
    const LEAVE = 0.5;
    for (let i = this.leaving.length - 1; i >= 0; i--) {
      const f = this.leaving[i];
      if ((this.time - f.leaveAt) / LEAVE >= 1) { this.leaving.splice(i, 1); continue; }
      f.p[1] += dt * 0.09;
      f.len *= 1 - dt * 1.9;
    }

    for (const f of this.bowl) {
      f.a += f.spin * dt;
      f.r += Math.sin(this.time * 0.7 + f.phase) * 0.004 * dt;
      f.p[0] = BOWL.pos[0] + Math.cos(f.a) * f.r;
      f.p[2] = BOWL.pos[2] + Math.sin(f.a) * f.r;
      // お椀の水面のすぐ下。お椀ごと波で上下するので、その分も足す。
      // 舟の水面（y = 0）より上に居ないと、水面に深度で落とされて見えなくなる
      f.p[1] = BOWL.pos[1] + BOWL.waterY - 0.009 + Math.sin(this.time * 1.3 + f.phase) * 0.003;
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
    // 押している状態は Game 側でも覚えておく。
    // 破れて新しいポイに替わるとき poi.reset() が押下を落とすので、
    // 指を離していないのに沈まなくなってしまう
    this.holding = down;
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
        // 指が水を押しのける量。
        //
        // 0.0004 にしていた。ポイが着水するときの 1/10 で、
        // なでても水面に何も起きていないように見えていた。
        // 指は紙より小さいが、水を押しのける深さはむしろ深い。
        // ポイと同じくらいまで上げる
        this.ripple.drop(x, z, 0.034, -0.0048 - Math.min(d, 0.05) * 0.20);
        this.lastTouch = [x, z];
      } else {
        this.lastTouch = null;
      }
      this.school.update(dt, { submerged: false, x: 0, z: 0, y: 1 }, this.ripple);
      return;
    }
    poi.visible = !poi.broke;

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

    // 破れた。乗っていた金魚は水へ戻り、少し置いて新しいポイが渡される
    if (poi.broke && this.renewAt === undefined) {
      for (const f of this.held) { f.held = false; f.holdOff[0] = f.holdOff[1] = 0; }
      this.held.length = 0;
      this.showUntil = 0;
      poi.locked = false;
      this.renewAt = this.time + 1.3;
      this.ripple.drop(poi.x, poi.z, POI.radius * 1.6, -0.0030);
    }
    if (this.renewAt !== undefined && this.time >= this.renewAt) {
      this.renewAt = undefined;
      const x = poi.x, z = poi.z;
      poi.reset();
      poi.x = poi.tx = x; poi.z = poi.tz = z;
      poi.visible = true;
      poi.pressed = !!this.holding;   // 指を離していなければ、そのまま沈む
    }
    this.school.update(dt, poi, this.ripple);

    // 乗せる判定。
    //
    // 紙が破れていたら、当然すくえない。
    // 破れかけでも、残っているのは外周だけなので、乗る範囲が狭くなる。
    // 紙の破れはシェーダ側で「中心から外へ」広がるので、それに合わせて
    // 有効な半径を health で縮める。
    //
    // 器が一杯なら乗せない。
    //
    // もとは 13 匹目を掬うと `this.bowl.shift()` で古い金魚が黙って
    // 消えていた。器の飾りだったうちはそれでよかったが、持ち帰れるように
    // なった以上、これは利用者の持ち物が消えることになる。
    // 掬わせない代わりに「器がいっぱい」と知らせる
    if (poi.vy > 0.001 && poi.y < 0.015 && !poi.broke && poi.health > 0.02
        && this.bowl.length < MAX_BOWL) {
      const reach = POI.radius * 1.35 * Math.sqrt(poi.health);
      for (const f of this.school.list) {
        if (f.held || f.gone) continue;
        const d = Math.hypot(f.p[0] - poi.x, f.p[2] - poi.z);
        const above = f.p[1] - poi.y;
        if (d < reach && above > -0.030 && above < 0.095) {
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
  /** 雨粒 1 粒の落ちる場所・速さ・太さを引き直す。 */
  #reseedDrop(d) {
    d.x = (Math.random() * 2 - 1) * TANK.halfX * 1.02;
    d.z = (Math.random() * 2 - 1) * TANK.halfZ * 1.02;
    d.w = Math.random();
    d.period = RAIN.fall / (RAIN.speed * (0.85 + d.w * 0.30));
  }

  #surfaceHits(dt) {
    if (!this.ripple || dt <= 0) return;
    const prev = this.time - dt;

    if (this.rain > 0) {
      // 雨粒。1 粒ずつ場所を引き直す。
      //
      // もとは番号から乱数で出していたので、同じ 26 か所に落ち続けていた。
      // 穴が開いているようにしか見えない。ここで状態を持ち、着水したら
      // 波紋を落として次の場所を引く。描画側へは、この配列をそのまま渡す。
      // 乱数をシェーダと JS で別々に引くと、32bit 浮動小数と倍精度で
      // 答えが変わって場所がずれるので、引くのは片側だけにする
      for (const d of this.rainDrops) {
        d.t += dt / d.period;
        if (d.t < 1) continue;
        d.t -= Math.floor(d.t);
        // 波紋は格子（4mm 刻み）より十分大きく取る。小さいと波が
        // 格子の縦横にしか進めず、輪ではなく菱形に広がる
        this.ripple.drop(d.x, d.z, 0.013 + d.w * 0.007, 0.0011);
        this.sound?.raindrop();
        this.#reseedDrop(d);
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
      // 出口は石の長さ（30mm）ぶんに散らす。1 点を叩き続けると、
      // 波が干渉して花のような定在模様が立ったまま残る。
      //
      // 1 粒ぶんを 0.00022 にしていた。雨粒の 1/5、ポイの 1/20 で、
      // 泡が弾けても水面に何も起きていないように見えていた。
      // 0.00090 にすると、石の上から輪が広がるのが分かる。
      // 22 秒まわして、定在模様が立たないことは確かめた
      this.ripple.drop(
        AIR.stone[0] + (r1 - 0.5) * 0.044,
        AIR.stone[2] + (r3 - 0.5) * 0.030,
        0.013 + r3 * 0.007,
        0.00090,
      );
    }
  }

  /** 掬った金魚を器へ入れる。 */
  #toBowl(f) {
    this.bowl.push({
      turtle: f.turtle,
      kind: f.kind,
      len: f.len,
      seed: f.seed,
      a: Math.random() * Math.PI * 2,
      r: BOWL.innerR * (0.30 + Math.random() * 0.34),
      spin: (Math.random() > 0.5 ? 1 : -1) * (0.8 + Math.random() * 0.9),
      phase: Math.random() * 10,
      beat: 9 + Math.random() * 4,
      p: [BOWL.pos[0], BOWL.waterY - 0.009, BOWL.pos[2]],
      yaw: 0,
      bend: 0,
      // 持ち帰るときの退場。null なら居る。
      // 0 を「居る」の印にすると、遊び始めて 0 秒ちょうどに
      // 持ち帰ったときだけ退場しない
      leaveAt: null,
    });
  }

  /** 描くぶん。器の中身に、抜けていく途中のものを足す */
  get bowlView() {
    return this.leaving.length ? this.bowl.concat(this.leaving) : this.bowl;
  }

  /** 器が一杯か。画面に「いっぱいです」を出すのに使う */
  get bowlFull() {
    return this.bowl.length >= MAX_BOWL;
  }

  /**
   * 器の金魚を持ち帰る。
   *
   * 返すのは「家で要る値」だけ。泳ぎの値（角度・半径・位相）は
   * お椀を基準に作ってあるので、鉢へ持っていっても使えない。
   *
   * 呼んだ側が先に保存し、そのあとで退場を見せる。
   * 「書けたから消えた」の順にしないと、書けなかったときに
   * 金魚だけ消える。
   */
  takeHome() {
    const out = this.bowl.map((f) => ({
      turtle: f.turtle, kind: f.kind, len: f.len, seed: f.seed, beat: f.beat,
    }));
    // 器は即座に空にする。
    //
    // 絵として 0.5 秒かけて抜けていくが、器の中身としてはもう無い。
    // 器に残したまま退場させていたら、持ち帰ってすぐ家へ移ったときに
    // game.update() が止まり、金魚が器に居座ったままになっていた。
    for (const f of this.bowl) f.leaveAt = this.time;
    this.leaving.push(...this.bowl);
    this.bowl.length = 0;
    if (this.ripple) this.ripple.drop(BOWL.pos[0], BOWL.pos[2], BOWL.innerR * 1.2, -0.0036);
    this.poi.splash = 1.0;
    this.poi.splashAt = [BOWL.pos[0], BOWL.pos[2]];
    this.poi.splashIn = false;
    this.poi.splashV = 0.9;
    this.sound?.splash(0.9, true);
    return out;
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
