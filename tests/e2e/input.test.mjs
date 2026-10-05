// 操作。ポイの持ち方と動き。
//
// スマホで紙の輪が指の下に来ていて、掬う相手が自分の指で隠れていた件、
// 縦画面でポイの柄が横を向いていた件が出どころ。

import { launch, open, peek, until } from '../lib/page.mjs';
import { ok, near, eq, between } from '../lib/assert.mjs';
import { POI } from '../../assets/js/world.js';

let browser;
const withPage = async (opt, fn) => {
  browser ||= await launch();
  const { ctx, page, errors } = await open(browser, opt);
  try { await fn(page, errors); } finally { await ctx.close(); }
};

export default {
  'マウスでは紙の輪が指す所に来る': () => withPage({}, async (page) => {
    await until(page, 'poi', (p) => p.visible, 'ポイが出てこない');
    const box = await page.evaluate(() => {
      const r = document.getElementById('scene').getBoundingClientRect();
      return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.55, w: r.width, h: r.height };
    });
    await page.mouse.move(box.x, box.y);
    await page.waitForTimeout(900);
    const hit = await page.evaluate(({ x, y, w, h }) => {
      const r = document.getElementById('scene').getBoundingClientRect();
      return window.__kingyo.pick(((x - r.left) / w) * 2 - 1, 1 - ((y - r.top) / h) * 2);
    }, box);
    const poi = await peek(page, 'poi');
    near(poi.x, hit[0], 0.02, '紙の輪の横位置');
    near(poi.z, hit[1], 0.02, '紙の輪の奥行き');
  }),

  '指では柄を握る。紙の輪は指より奥へ出る': () => withPage({
    viewport: { width: 430, height: 880 }, mobile: true,
  }, async (page) => {
    await until(page, 'poi', (p) => p.visible, 'ポイが出てこない');
    const box = await page.evaluate(() => {
      const r = document.getElementById('scene').getBoundingClientRect();
      return { x: r.left + r.width * 0.5, y: r.top + r.height * 0.55, w: r.width, h: r.height };
    });
    await page.touchscreen.tap(box.x, box.y);
    await page.waitForTimeout(900);
    const hit = await page.evaluate(({ x, y, w, h }) => {
      const r = document.getElementById('scene').getBoundingClientRect();
      return window.__kingyo.pick(((x - r.left) / w) * 2 - 1, 1 - ((y - r.top) / h) * 2);
    }, box);
    const poi = await peek(page, 'poi');
    const away = Math.hypot(poi.x - hit[0], poi.z - hit[1]);
    // 柄の長さぶん離れる。輪が指の下に来ていたら 0 になる
    near(away, POI.grip, 0.02, `指と紙の輪の距離（柄は ${(POI.grip * 1000).toFixed(0)}mm）`);
  }),

  '押している間だけポイが沈む': () => withPage({}, async (page) => {
    await until(page, 'poi', (p) => p.visible, 'ポイが出てこない');
    const top = (await peek(page, 'poi')).y;
    ok(top > 0, `待機しているのに水面より下にいる（y=${top.toFixed(3)}）`);
    await page.mouse.move(480, 300);
    await page.mouse.down();
    await until(page, 'poi', (p) => p.y < -0.05, '押しても沈まない');
    await page.mouse.up();
    await until(page, 'poi', (p) => p.y > 0, '離しても上がってこない');
  }),

  '沈めたまま振り回すとポイが破れる': () => withPage({}, async (page) => {
    await until(page, 'poi', (p) => p.visible, 'ポイが出てこない');
    await page.mouse.move(480, 300);
    await page.mouse.down();
    // 水中で速く動かすほど傷む
    for (let i = 0; i < 90; i++) {
      await page.mouse.move(360 + (i % 2) * 240, 250 + ((i >> 1) % 2) * 120);
      await page.waitForTimeout(16);
    }
    await page.waitForTimeout(500);
    const poi = await peek(page, 'poi');
    await page.mouse.up();
    ok(poi.health < 0.9, `振り回しても紙が傷まない（残り ${(poi.health * 100).toFixed(0)}%）`);
  }),

  '店じまいのあとはポイが片付けられている': () => withPage({ hour: 23 }, async (page) => {
    // 時刻を入れても、game.closed が追いつくのは次のコマ。
    //
    // SwiftShader は CPU でシェーダを組むので、試験を通しで走らせた
    // 混み合った状態だと、最初のコマが出るまでに 30 秒を超えることがある。
    // 既定の 20 秒だと、絵が出る前に待ち切れずに落ちていた
    await until(page, 'closed', (c) => c === true, '23 時にしても店じまいにならない', 60000);
    await until(page, 'poi', (p) => !p.visible, '店じまいなのにポイが出たまま');
  }),

  'おしまい': async () => { if (browser) await browser.close(); browser = null; },
};
