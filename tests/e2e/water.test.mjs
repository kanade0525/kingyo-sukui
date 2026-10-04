// 水面。白い靄が戻らないこと、雨粒が散ること。
//
// 舟の底の照り返しが空気中の反射率（12 倍）で入っていて、太陽が低い時季に
// 水面の右半分が白く靄がかり、波の網目もコースティクスも消えていた。
// 画面を横に割って、どの帯でも模様が残っていることを見る。

import { launch, open, measure, setHour, setWeather, stillWater, peek } from '../lib/page.mjs';
import { ok, between } from '../lib/assert.mjs';

let browser, shared;
async function page() {
  browser ||= await launch();
  shared ||= await open(browser, { hour: 13 });
  return shared.page;
}
const BOX = { x0: 0.18, x1: 0.82, y0: 0.32, y1: 0.78 };

export default {
  '水面のどこにも白い靄が出ない': async () => {
    const pg = await page();
    for (const h of [10, 13, 16]) {
      await setHour(pg, h);
      const cols = await measure(pg, BOX, 8);
      const mean = cols.reduce((a, c) => a + c.mean, 0) / cols.length;
      for (const [i, c] of cols.entries()) {
        ok(c.mean < mean * 1.45,
           `${h} 時、左から ${i + 1} 番目の帯だけ明るい（${c.mean.toFixed(0)} / 全体 ${mean.toFixed(0)}）`);
      }
    }
  },

  '水面のどこにも模様が残っている': async () => {
    // 靄がかかると、明るさだけでなく細かさが消える。そちらで見るほうが確か
    const pg = await page();
    for (const h of [10, 13, 16]) {
      await setHour(pg, h);
      const cols = await measure(pg, BOX, 8);
      const det = cols.map((c) => c.detail);
      const worst = Math.min(...det), best = Math.max(...det);
      ok(worst > 2.0, `${h} 時、いちばん平らな帯の細かさが ${worst.toFixed(1)}`);
      ok(worst > best * 0.22,
         `${h} 時、帯ごとの細かさの差が大きい（${worst.toFixed(1)} 対 ${best.toFixed(1)}）`);
    }
  },

  '波を止めても底の網目が見える': async () => {
    const pg = await page();
    await setHour(pg, 13);
    await stillWater(pg);
    const m = await measure(pg, BOX);
    ok(m.detail > 2.5, `波を止めたら模様が消えた（細かさ ${m.detail.toFixed(1)}）`);
    // 戻す
    await pg.evaluate(() => {
      const el = document.getElementById('amp');
      el.value = '10'; el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await pg.waitForTimeout(900);
  },

  '雨粒が舟じゅうに散る': async () => {
    // 落ちる場所を番号から出していたので、同じ 26 か所に落ち続けていた
    const pg = await page();
    await setWeather(pg, 2);
    await setHour(pg, 13);
    const seen = new Set();
    for (let i = 0; i < 6; i++) {
      for (const d of await peek(pg, 'rainDrops')) {
        // 5cm 四方の升目に落として、何升に落ちたかを数える
        seen.add(`${Math.round(d.x / 0.05)},${Math.round(d.z / 0.05)}`);
      }
      await pg.waitForTimeout(400);
    }
    ok(seen.size > 60, `雨粒が ${seen.size} 通りの場所にしか落ちない`);
    await setWeather(pg, 0);
  },

  '空が閉じるほど、水底の網目は薄れる': async () => {
    // 方向の揃った光でないとコースティクスは出ない。手加減ではなく、
    // 曇りの日に水底の網目が出ないのと同じこと
    const pg = await page();
    await setHour(pg, 13);
    await stillWater(pg);
    const got = [];
    for (const w of [0, 1, 2]) {
      await setWeather(pg, w);
      await pg.waitForTimeout(2400);
      got.push((await measure(pg, BOX)).detail);
    }
    await setWeather(pg, 0);
    ok(got[0] > got[1] * 1.15,
       `くもりで網目が薄れない（晴れ ${got[0].toFixed(1)} / くもり ${got[1].toFixed(1)}）`);
    ok(got[1] > got[2],
       `雨で網目がさらに薄れない（くもり ${got[1].toFixed(1)} / 雨 ${got[2].toFixed(1)}）`);
  },

  'おしまい': async () => {
    if (shared) await shared.ctx.close();
    if (browser) await browser.close();
    shared = null; browser = null;
  },
};
