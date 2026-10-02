// ポイ。沈める・持ち上げる・紙が弱る、の 3 つだけを持つ。
//
// 紙の弱り方は実物に合わせてある。水に浸かっている時間そのものより、
// 水中で速く動かしたときの方が一気に傷む。斜めに入れて静かに抜くのが
// 上手い人のやり方なので、ゲームとしてもそこに報いる。

import { TANK, POI } from './world.js?v=202610020915';
import { clamp, lerp } from './mat.js?v=202610020915';

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
    const goal = this.pressed ? POI.deepY : POI.restY;
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
    if (ripple) {
      if (this.submerged !== wasUnder) {
        ripple.drop(this.x, this.z, POI.radius * 1.8, this.submerged ? -0.0018 : 0.0024);
      } else if (this.submerged && moved > 1e-4) {
        ripple.drop(this.x, this.z, POI.radius * 1.4, -moved * 0.055);
      }
    }

    // 紙は濡れるだけで破れない（いまは掬う手応えだけを見たいので）。
    // 消耗の式は後で戻せるよう、計算はせず health は 1 のまま置く。
    this.wet = this.submerged
      ? Math.min(1, this.wet + dt * 1.1)
      : Math.max(0, this.wet - dt * 0.12);
    this.sag = (0.0035 + 0.004 * load) * this.wet;
  }
}
