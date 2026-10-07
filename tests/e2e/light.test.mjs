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
/**
 * その時刻の画面の明るさ。
 *
 * 1 回だけ撮ると、たまたま枠に何匹金魚が居たかで 1 割以上動く。
 * 明るさの差はそれより小さいことがあるので、三度撮って真ん中を取る。
 */
const bright = async (pg, h) => {
  await setHour(pg, h);
  const three = [];
  for (let i = 0; i < 3; i++) {
    three.push((await measure(pg)).mean);
    await pg.waitForTimeout(500);
  }
  three.sort((a, b) => a - b);
  return three[1];
};

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
    // 下限は「夕方に見えない」こと。割合を決め打ちにすると、
    // 露出の取り方を変えるたびにその数字のほうを動かすことになる。
    // 実際の夕暮れを測って、それより明るいことを見る
    const dusk = await bright(pg, 18);
    await setWeather(pg, 2);
    await setHour(pg, 13);
    const rain = (await measure(pg)).mean;
    await setWeather(pg, 0);
    ok(rain < clear, `雨（${rain.toFixed(0)}）が晴れ（${clear.toFixed(0)}）より暗くない`);
    ok(rain > dusk * 1.15,
       `雨の昼（${rain.toFixed(0)}）が夕暮れ（${dusk.toFixed(0)}）と変わらない`);
  },

  '天気が変われば空の様子も変わる': async () => {
    // 明るさを落とすだけでは、晴れも曇りも雨も同じのっぺりした空になる。
    // 雲が掛かっていれば、空の帯に濃淡が出る
    const pg = await page();
    await setHour(pg, 13);
    const sky = { x0: 0.30, x1: 0.70, y0: 0.0, y1: 0.08 };
    await setWeather(pg, 0);
    const clear = await measure(pg, sky);
    await setWeather(pg, 2);
    const rain = await measure(pg, sky);
    await setWeather(pg, 0);
    ok(rain.mean < clear.mean * 0.92,
       `雨の空（${rain.mean.toFixed(0)}）が晴れの空（${clear.mean.toFixed(0)}）と変わらない`);
  },

  'おしまい': async () => {
    if (shared) await shared.ctx.close();
    if (browser) await browser.close();
    shared = null; browser = null;
  },
};
