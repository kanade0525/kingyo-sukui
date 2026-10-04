// 光。時刻を動かしたときの明るさの並び。
//
// 21 時が 16 時より明るく、0 時から 4 時は輝度 13 で何も見えなかった件が
// 出どころ。明るさは数で押さえないと、直したつもりで戻る。

import { launch, open, measure, setHour, setWeather } from '../lib/page.mjs';
import { ok, between, descending } from '../lib/assert.mjs';

let browser, shared;
async function page() {
  browser ||= await launch();
  shared ||= await open(browser, { hour: 13 });
  return shared.page;
}
const bright = async (pg, h) => { await setHour(pg, h); return (await measure(pg)).mean; };

export default {
  '昼から深夜へ、明るさが単調に落ちる': async () => {
    const pg = await page();
    const list = [];
    for (const h of [13, 16, 17.5, 19, 21, 23, 2]) list.push([`${h}時`, await bright(pg, h)]);
    // 19 時と 21 時はどちらも完全な夜で、光の条件が同じ。
    // 金魚の居場所と波の形で数が揺れるぶんだけ許す
    descending(list, '画面の明るさ', 3);
    // 夜が夕方より明るい、という逆転は許さない
    ok(list[4][1] < list[1][1], `21 時（${list[4][1].toFixed(0)}）が 16 時（${list[1][1].toFixed(0)}）より明るい`);
  },

  '真昼はしっかり明るい': async () => {
    between(await bright(await page(), 13), 95, 190, '13 時の明るさ');
  },

  '夜は昼の半分より暗い': async () => {
    const pg = await page();
    const day = await bright(pg, 13);
    const night = await bright(pg, 21);
    ok(night < day * 0.6, `21 時が昼の ${(night / day * 100).toFixed(0)}% もある`);
  },

  '深夜でも舟の形が見える': async () => {
    // 灯りが無いことは演出だが、何も見えないのは描けていないのと同じ
    const pg = await page();
    await setHour(pg, 2);
    const m = await measure(pg);
    between(m.mean, 14, 50, '2 時の明るさ');
    ok(m.detail > 1.0, `2 時の画面が平ら（細かさ ${m.detail.toFixed(1)}）`);
  },

  '夜は提灯の下が明るく、隅が落ちる': async () => {
    // 提灯が二つあることが光で分かるか。横に 8 分割して、むらを見る
    const pg = await page();
    await setHour(pg, 20);
    const cols = await measure(pg, { x0: 0.12, x1: 0.88, y0: 0.30, y1: 0.80 }, 8);
    const mx = Math.max(...cols.map((c) => c.mean));
    const mn = Math.min(...cols.map((c) => c.mean));
    ok(mx / mn > 1.25, `夜の明るさが平ら（最大 / 最小 = ${(mx / mn).toFixed(2)}）。一灯に見える`);
  },

  '雨の昼は、晴れの昼より暗いが夕方よりは明るい': async () => {
    const pg = await page();
    await setWeather(pg, 0);
    const clear = await bright(pg, 13);
    await setWeather(pg, 2);
    await setHour(pg, 13);
    const rain = (await measure(pg)).mean;
    await setWeather(pg, 0);
    ok(rain < clear, `雨（${rain.toFixed(0)}）が晴れ（${clear.toFixed(0)}）より暗くない`);
    ok(rain > clear * 0.45, `雨が暗すぎる（晴れの ${(rain / clear * 100).toFixed(0)}%）。ただの夕方に見える`);
  },

  'おしまい': async () => {
    if (shared) await shared.ctx.close();
    if (browser) await browser.close();
    shared = null; browser = null;
  },
};
