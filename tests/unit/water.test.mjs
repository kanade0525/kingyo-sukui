// 水面に立つ波紋。雨粒・泡・指。
//
// 絵からでは、雨の波紋を金魚の動きと切り分けられない。
// Game は描画と切り離して動くので、波紋を受け取る偽物を挿して直に見る。

import { Game } from '../../assets/js/game.js?v=202610041324';
import { TANK, RAIN, AIR, RIPPLE } from '../../assets/js/world.js?v=202610041324';
import { ok, between } from '../lib/assert.mjs';

/** 波紋を受け取って記録するだけの偽物 */
function recorder() {
  const drops = [];
  return {
    drops,
    drop(x, z, r, amp) { drops.push({ x, z, r, amp }); },
  };
}

/** dt 秒ずつ進める */
function run(game, seconds, dt = 1 / 60) {
  for (let t = 0; t < seconds; t += dt) game.update(dt);
}

/** 落ちた場所が何通りあるか。5cm の升目で数える */
function spread(drops) {
  return new Set(drops.map((d) => `${Math.round(d.x / 0.05)},${Math.round(d.z / 0.05)}`)).size;
}

export default {
  '雨粒が着水するたびに波紋が立つ': () => {
    const g = new Game();
    const rip = recorder();
    g.ripple = rip;
    g.start();
    g.rain = 1;
    run(g, 4);
    // 26 粒が 0.3 秒ほどで 1 周するので、4 秒なら数百回
    const rainDrops = rip.drops.filter((d) => Math.abs(d.amp - RIPPLE.rain) < 1e-9);
    ok(rainDrops.length > 100, `4 秒で波紋が ${rainDrops.length} 回しか立たない`);
  },

  '雨粒が舟じゅうに散る': () => {
    const g = new Game();
    const rip = recorder();
    g.ripple = rip;
    g.start();
    g.rain = 1;
    run(g, 4);
    const rainDrops = rip.drops.filter((d) => Math.abs(d.amp - RIPPLE.rain) < 1e-9);
    ok(spread(rainDrops) > 80,
       `雨粒が ${spread(rainDrops)} 通りの場所にしか落ちない。同じ所に落ち続けている`);
    for (const d of rainDrops) {
      ok(Math.abs(d.x) <= TANK.halfX * 1.05 && Math.abs(d.z) <= TANK.halfZ * 1.05,
         '雨粒が舟の外に落ちている');
    }
  },

  '降っていなければ雨の波紋は立たない': () => {
    const g = new Game();
    const rip = recorder();
    g.ripple = rip;
    g.start();
    g.rain = 0;
    run(g, 3);
    const rainDrops = rip.drops.filter((d) => Math.abs(d.amp - RIPPLE.rain) < 1e-9);
    ok(rainDrops.length === 0, `晴れているのに雨の波紋が ${rainDrops.length} 回立った`);
  },

  '泡が弾けるたびに波紋が立つ': () => {
    const g = new Game();
    const rip = recorder();
    g.ripple = rip;
    g.start();
    run(g, 3);
    // 泡の波紋はエアストーンの近くにだけ落ちる
    const air = rip.drops.filter((d) => Math.abs(d.amp - RIPPLE.bubble) < 1e-9);
    ok(air.length > 50, `3 秒で泡の波紋が ${air.length} 回しか立たない`);
    for (const d of air) {
      ok(Math.hypot(d.x - AIR.stone[0], d.z - AIR.stone[2]) < 0.05,
         '泡の波紋がエアストーンから離れた所に立っている');
    }
  },

  '泡の波紋は雨粒より弱い': () => {
    // 強すぎると石の上に窪みが立ったまま残り、弱すぎると見えない
    const g = new Game();
    const rip = recorder();
    g.ripple = rip;
    g.start();
    g.rain = 1;
    run(g, 2);
    const air = rip.drops.filter((d) => Math.abs(d.amp - RIPPLE.bubble) < 1e-9)[0];
    const rain = rip.drops.filter((d) => Math.abs(d.amp - RIPPLE.rain) < 1e-9)[0];
    ok(air && rain, '泡か雨の波紋が立っていない');
    ok(air.amp < rain.amp, '泡の波紋が雨粒より強い');
    ok(air.amp > rain.amp * 0.4, '泡の波紋が雨粒に比べて弱すぎる。見えない');
  },

  'ポイを沈めると波紋が立つ': () => {
    const g = new Game();
    const rip = recorder();
    g.ripple = rip;
    g.start();
    run(g, 0.5);
    const before = rip.drops.length;
    g.press(true);
    run(g, 0.6);
    const after = rip.drops.filter((d) => Math.abs(d.amp) > 0.002);
    ok(after.length > 0, 'ポイを沈めても水面が動かない');
    ok(rip.drops.length > before, '波紋が増えていない');
  },

  '店じまいのあと、水面をなでると跡が残る': () => {
    const g = new Game();
    const rip = recorder();
    g.ripple = rip;
    g.start();
    g.closed = true;
    g.press(true);
    g.aim([0.1, 0.05]);
    run(g, 0.4);
    // 指の押しのけはポイと同じくらいの強さ
    const stroke = rip.drops.filter((d) => d.amp <= -0.004);
    ok(stroke.length > 0, 'なでても水面が動かない');
  },
};
