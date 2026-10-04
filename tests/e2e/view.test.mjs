// 構図。縦横それぞれで舟が画面に収まり、余白が偏らないこと。

import { launch, open, setPitch, peek, __shot } from '../lib/page.mjs';
import { ok, between, eq } from '../lib/assert.mjs';

let browser;
const withPage = async (opt, fn) => {
  browser ||= await launch();
  const { ctx, page, errors } = await open(browser, opt);
  try { await fn(page, errors); } finally { await ctx.close(); }
};

/**
 * 撮った絵から、舟の上端と下端を割り出す。
 * 舟は水色なので、画面の真ん中の縦 1 列で「緑が赤より強い」所を探す
 */
async function traySpan(page) {
  const { width, height, data } = await __shot(page);
  const col = Math.floor(width / 2);
  let top = null, bot = null;
  for (let y = 0; y < height; y++) {
    const i = (y * width + col) * 4;
    if (data[i + 1] > data[i] + 14) { if (top === null) top = y; bot = y; }
  }
  return { top: top / height, bot: bot / height, height };
}

export default {
  '横画面で舟が収まる': () => withPage({ viewport: { width: 1280, height: 720 } }, async (page, errors) => {
    eq(errors.length, 0, errors.slice(0, 2).join(' / '));
    const s = await traySpan(page);
    ok(s.top !== null, '舟が見つからない');
    between(s.bot - s.top, 0.55, 0.98, '舟が画面の縦に占める割合');
  }),

  '縦画面で舟が収まり、余白が偏らない': () => withPage({
    viewport: { width: 430, height: 880 }, mobile: true,
  }, async (page, errors) => {
    eq(errors.length, 0, errors.slice(0, 2).join(' / '));
    const s = await traySpan(page);
    between(s.bot - s.top, 0.70, 0.92, '舟が画面の縦に占める割合');
    const up = s.top, down = 1 - s.bot;
    ok(Math.abs(up - down) < 0.09,
       `上下の余白が偏っている（上 ${(up * 100).toFixed(0)}% / 下 ${(down * 100).toFixed(0)}%）`);
  }),

  '縦画面だと分かる': () => withPage({
    viewport: { width: 430, height: 880 }, mobile: true,
  }, async (page) => {
    eq(await peek(page, 'portrait'), true, '縦長なのに横画面の構図になっている');
  }),

  'どの見下ろす角度でも落ちない': () => withPage({}, async (page, errors) => {
    for (const p of [55, 65, 87]) {
      await setPitch(page, p);
      const s = await traySpan(page);
      ok(s.top !== null, `角度 ${p} 度で舟が見えない`);
    }
    eq(errors.length, 0, errors.slice(0, 2).join(' / '));
  }),

  'おしまい': async () => { if (browser) await browser.close(); browser = null; },
};
