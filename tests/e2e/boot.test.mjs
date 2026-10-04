// 立ち上がり。絵が出るところまで。

import { launch, open, measure, peek, until } from '../lib/page.mjs';
import { ok, between, eq } from '../lib/assert.mjs';

let browser;
const withPage = async (opt, fn) => {
  browser ||= await launch();
  const { ctx, page, errors } = await open(browser, opt);
  try { await fn(page, errors); } finally { await ctx.close(); }
};

export default {
  'エラーを出さずに絵が出る': () => withPage({}, async (page, errors) => {
    eq(errors.length, 0, `コンソールに出たもの: ${errors.slice(0, 3).join(' / ')}`);
    const m = await measure(page);
    // 真っ黒でも真っ白でもなく、模様がある
    between(m.mean, 25, 230, '舟のあたりの明るさ');
    ok(m.detail > 2, `画面が平ら（細かさ ${m.detail.toFixed(1)}）。描けていない`);
  }),

  'WebGL2 が使えないときの逃げ道が隠れている': () => withPage({}, async (page) => {
    const shown = await page.evaluate(() => !document.getElementById('fallback').hidden);
    eq(shown, false, 'WebGL2 が使えるのに逃げ道が出ている');
  }),

  '金魚が泳いでいる': () => withPage({}, async (page) => {
    const n = await peek(page, 'fish');
    between(n, 80, 120, '泳いでいる金魚の数');
  }),

  'ポイが出ている': () => withPage({}, async (page) => {
    await until(page, 'poi', (p) => p.visible, '遊べる時刻にしてもポイが出てこない');
    const poi = await peek(page, 'poi');
    eq(poi.visible, true, 'ポイが出ていない');
    eq(poi.broke, false, '始めから破れている');
    between(poi.health, 0.99, 1, 'ポイの紙の残り');
  }),

  '録音が 6 本とも読める': () => withPage({ settle: 2000 }, async (page) => {
    // 音は最初の操作まで鳴らさないので、こちらから起こす
    await page.evaluate(() => document.getElementById('scene')
      .dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1 })));
    await page.waitForFunction(() => window.__kingyo.clips.length >= 6, null, { timeout: 40000 })
      .catch(() => {});
    const clips = await peek(page, 'clips');
    eq(clips.length, 6, `読めた録音: ${clips.join(', ')}`);
  }),

  '時刻と天気を映していることが画面に出ている': () => withPage({
    geo: { latitude: 34.69, longitude: 135.50 }, settle: 9000, hour: null,
  }, async (page) => {
    const bar = await page.evaluate(() => ({
      shown: !document.getElementById('nowbar').hidden,
      what: document.getElementById('nowWhat').textContent,
      place: document.getElementById('nowPlace').textContent,
      sky: document.getElementById('nowSky').textContent,
      time: document.getElementById('nowTime').textContent,
    }));
    eq(bar.shown, true, '右上の札が出ていない');
    ok(bar.what.includes('いまの'), `何を映しているかが書かれていない（「${bar.what}」）`);
    ok(/あたり|現在地/.test(bar.place), `場所が出ていない（「${bar.place}」）`);
    ok(/晴れ|くもり|雨/.test(bar.sky), `天気が出ていない（「${bar.sky}」）`);
    ok(/^\d\d:\d\d$/.test(bar.time), `時刻の形がおかしい（「${bar.time}」）`);
  }),

  '時刻を手で動かすと、そう分かる': () => withPage({ hour: null }, async (page) => {
    await page.evaluate(() => {
      const el = document.getElementById('hour');
      el.value = '15'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(500);
    const what = await page.evaluate(() => document.getElementById('nowWhat').textContent);
    ok(what.includes('手動'), `手で動かしたのに「${what}」のまま`);
  }),

  'おしまい': async () => { if (browser) await browser.close(); browser = null; },
};
