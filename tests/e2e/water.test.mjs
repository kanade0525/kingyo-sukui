// 水面。白い靄が戻らないこと、雨粒が散ること。
//
// 舟の底の照り返しが空気中の反射率（12 倍）で入っていて、太陽が低い時季に
// 水面の右半分が白く靄がかり、波の網目もコースティクスも消えていた。
// 画面を横に割って、どの帯でも模様が残っていることを見る。

import { launch, open, measure, setHour, setWeather, stillWater, peek } from '../lib/page.mjs';
import { ok, eq, between } from '../lib/assert.mjs';

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

  '雨粒は落ちるたびに場所を引き直す': async () => {
    // 落ちる場所を粒の通し番号から出していたので、同じ 26 か所に
    // 落ち続けていた。瞬間の散らばりを数えると、混み合ったときに
    // 標本が足りなくなって揺れる。「同じ粒が別の場所へ落ち直したか」で見る
    const pg = await page();
    await setWeather(pg, 2);
    await setHour(pg, 13);
    const seen = new Map();          // 粒の番号 → 見た場所の集合
    const deadline = Date.now() + 20000;
    let moved = 0;
    while (Date.now() < deadline && moved < 18) {
      const drops = await peek(pg, 'rainDrops');
      drops.forEach((d, i) => {
        const key = `${Math.round(d.x / 0.01)},${Math.round(d.z / 0.01)}`;
        if (!seen.has(i)) seen.set(i, new Set());
        seen.get(i).add(key);
      });
      moved = [...seen.values()].filter((set) => set.size > 1).length;
      await pg.waitForTimeout(250);
    }
    ok(moved >= 18,
       `落ち直して場所が変わった粒が ${moved} 個しかない。番号で固定されている`);
    await setWeather(pg, 0);
  },

  '空が閉じるほど、水底の網目は薄れる': async () => {
    // 方向の揃った光でないとコースティクスは出ない。手加減ではなく、
    // 曇りの日に水底の網目が出ないのと同じこと。
    //
    // ここだけ共有のページを使わない。測るのは画素の細かさなので、
    // 前の試験が残した波紋や設定が乗ると、三つの天気で同じものを
    // 測ることになって網目の差がその下に埋もれる
    browser ||= await launch();
    const own = await open(browser, { hour: 13 });
    const pg = own.page;
    await setHour(pg, 13);
    await stillWater(pg);
    // 金魚を退ける。
    //
    // 測っているのは横に並んだ画素の差で、枠に何匹居たかで 1 割動く。
    // 網目の差はそれより小さいことがあるので、
    // 魚が居ると「網目が薄れたか」を測れない
    //
    // 消すだけでは、群れが足りないぶんを湧かせ直すので戻ってくる。
    // 群れの更新ごと止めてから空にする
    await pg.evaluate(() => {
      const sc = window.__kingyo.game.school;
      sc.update = () => {};
      sc.list.length = 0;
    });
    // 雨を止めて、前の試験が立てた波紋が消えるまで待つ。
    //
    // 残っていると、三つの天気で同じ輪を測ることになって
    // 網目の差がその下に埋もれる。雨粒を強くしたぶん、残りも長い
    await pg.evaluate(() => { window.__kingyo.game.rain = 0; });
    await pg.waitForTimeout(5000);
    eq(await peek(pg, 'fish'), 0, '金魚が残っている。網目ではなく魚を測ってしまう');
    const got = [];
    for (const w of [0, 1, 2]) {
      await setWeather(pg, w);
      // 雨の粒を止める。
      //
      // 雨の水面は輪だらけになるので、そのまま測ると
      // 「網目が薄れたか」ではなく「波紋が増えたか」を測ることになる。
      // ここで見たいのは、方向の揃った光が失われて網目が消えることのほう
      await pg.evaluate(() => { window.__kingyo.game.rain = 0; });
      await pg.waitForTimeout(3200);
      got.push((await measure(pg, BOX)).detail);
    }
    await setWeather(pg, 0);
    await own.ctx.close();
    ok(got[0] > got[1] * 1.15,
       `くもりで網目が薄れない（晴れ ${got[0].toFixed(1)} / くもり ${got[1].toFixed(1)}）`);
    ok(got[0] > got[2] * 1.15,
       `雨で網目が薄れない（晴れ ${got[0].toFixed(1)} / 雨 ${got[2].toFixed(1)}）`);
    // くもりと雨は比べない。
    //
    // 直射はどちらもほとんど無い（晴れの 0.16 と 0.07）ので、
    // 網目はもう両方とも消えている。残っている差は映り込みと
    // 露出の持ち上げ方の違いで、網目の強さではない
  },

  'おしまい': async () => {
    if (shared) await shared.ctx.close();
    if (browser) await browser.close();
    shared = null; browser = null;
  },
};
