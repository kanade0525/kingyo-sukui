// ポイ。沈める・持ち上げる・紙が弱る、の 3 つだけを持つ。
//
// 紙の弱り方は実物に合わせてある。水に浸かっている時間そのものより、
// 水中で速く動かしたときの方が一気に傷む。斜めに入れて静かに抜くのが
// 上手い人のやり方なので、ゲームとしてもそこに報いる。

import { TANK, POI } from './world.js?v=202610031206';
import { clamp, lerp } from './mat.js?v=202610031206';

export class Poi {
  constructor() {
    this.reset(true);
    this.x = 0;
    this.z = 0;
    this.tx = 0;
    this.tz = 0;
  }

  reset(full = false) {
    this.y = POI.restY;
    this.vy = 0;
    this.health = 1;
    this.wet = 0;
    this.seed = Math.random();
    this.tilt = 0;
    this.tiltAxis = [1, 0, 0];
    this.sag = 0;
    this.speed = 0;
    this.pressed = false;
    this.broke = false;
    this.splash = 0;
    this.splashAt = [0, 0];
    this.splashIn = true;
    this.splashV = 1;
    // 掬えた金魚を見せている間、ポイを上で固定する
    this.locked = false;
    if (full) {
      this.x = this.z = this.tx = this.tz = 0;
    }
  }

  get submerged() {
    return this.y < -0.004;
  }

  /** 画面から拾った水面上の狙い位置を入れる。 */
  aim(x, z) {
    const m = 0.012;
    this.tx = clamp(x, -TANK.halfX + POI.radius + m, TANK.halfX - POI.radius - m);
    this.tz = clamp(z, -TANK.halfZ + POI.radius + m, TANK.halfZ - POI.radius - m);
  }

  update(dt, ripple, load) {
    const px = this.x, pz = this.z;
    // 追従には遅れを入れる。指に直結していると、水の抵抗が無いように見える
    const k = Math.min(1, dt * (this.submerged ? 7 : 13));
    this.x = lerp(this.x, this.tx, k);
    this.z = lerp(this.z, this.tz, k);

    const moved = Math.hypot(this.x - px, this.z - pz);
    this.speed = lerp(this.speed, moved / Math.max(dt, 1e-3), 0.35);

    const wasUnder = this.submerged;
    // 見せている間は、押されていても沈めない。
    // ここで沈むと、せっかく掬った金魚がそのまま水へ戻ってしまう
    const goal = (this.pressed && !this.locked) ? POI.deepY : POI.restY;
    const prevY = this.y;
    this.y = lerp(this.y, goal, Math.min(1, dt * (this.pressed ? 7.5 : 9)));
    this.vy = (this.y - prevY) / Math.max(dt, 1e-3);

    // 傾き。進む向きに前のめりになる
    if (moved > 1e-5) {
      const inv = 1 / moved;
      this.tiltAxis = [-(this.z - pz) * inv, 0, (this.x - px) * inv];
    }
    const wantTilt = clamp(this.speed * 0.9, 0, 0.42);
    this.tilt = lerp(this.tilt, wantTilt, dt * 8);

    // 水の出入りで波が立つ
    // 水の出入り。着水と離水は、紙の面積ぶんの水を一気に押しのけるので
    // はっきり波が立つ。ここを弱くすると、ポイが水に触れた手応えが消える
    this.splash = Math.max(0, (this.splash || 0) - dt * 2.6);
    if (ripple) {
      if (this.submerged !== wasUnder) {
        ripple.drop(this.x, this.z, POI.radius * 1.9, this.submerged ? -0.0040 : 0.0046);
        // 飛沫の合図。入るときのほうが派手に散る
        this.splash = 1.0;
        this.splashAt = [this.x, this.z];
        this.splashIn = this.submerged;
        this.splashV = Math.min(1, Math.abs(this.vy) / 0.35 + 0.35);
        if (this.onSplash) this.onSplash(this.splashV, !this.submerged);
      } else if (this.submerged && moved > 1e-4) {
        ripple.drop(this.x, this.z, POI.radius * 1.4, -moved * 0.055);
      }
    }

    this.wet = this.submerged
      ? Math.min(1, this.wet + dt * 1.1)
      : Math.max(0, this.wet - dt * 0.12);
    this.sag = (0.0035 + 0.004 * load) * this.wet;

    // 紙の消耗。
    //
    // 実物は、水に浸かっている時間そのものより「水中で速く動かしたとき」に
    // 一気に傷む。斜めに静かに入れて、水の抵抗を受けないように抜くのが
    // 上手い人のやり方なので、ゲームとしてもそこに報いる。
    //
    // 丁寧に動かせば 40 秒近くもち、水中で振り回せば 8 秒ほどで破れる。
    // 実物の 5 号より優しいが、初見の人が数十秒で終わらない程度にはしてある。
    if (this.submerged && !this.broke) {
      const drag = Math.min(this.speed, 0.55);
      this.health -= dt * (0.012 + drag * 0.30 + load * 0.022);
      if (this.health <= 0) { this.health = 0; this.broke = true; }
    }
  }
}
