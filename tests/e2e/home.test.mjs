// 掬った金魚を家に持ち帰る。
//
// 屋台から器へ、器から袋へ、袋から家の鉢へ。端末に残ること、
// 往復しても壊れないこと、壊れた保存を入れても落ちないこと。

import { launch, open, measure, setHour, setWeather, peek, until, __shot } from '../lib/page.mjs';
import { ok, eq, between, descending } from '../lib/assert.mjs';

let browser;
const withPage = async (opt, fn) => {
  browser ||= await launch();
  const { ctx, page, errors } = await open(browser, opt);
  try { await fn(page, errors, ctx); } finally { await ctx.close(); }
};

/** 掬うのを待つと SwiftShader で何十秒もかかる。器へ直に押し込む */
async function putInBowl(page, n, turtleAt = -1) {
  await page.evaluate(({ n, turtleAt }) => {
    const g = window.__kingyo.game;
    for (let i = 0; i < n; i++) {
      g.bowl.push({ turtle: i === turtleAt, kind: i % 4, len: 0.03 + i * 0.002, seed: i / n,
        a: i, r: 0.02, spin: 1, phase: i, beat: 10, p: [0, 0, 0], yaw: 0, bend: 0, leaveAt: null });
    }
  }, { n, turtleAt });
  // 画面に出るのは次のコマ。SwiftShader では 600ms ほどかかるので、
  // 決め打ちで待たずに、出るまで待つ
  await page.waitForFunction(() => !document.getElementById('btnTakeHome').hidden,
                             null, { timeout: 20000 });
}

const takeHome = async (page) => {
  await page.evaluate(() => document.getElementById('btnTakeHome').click());
  await page.waitForTimeout(2400);
};

/** 枠の中の、青みの強さ（青の平均 ÷ 赤の平均）。 */
function blueness(img, box) {
  const { width, height, data } = img;
  let r = 0, b = 0, n = 0;
  for (let y = Math.floor(height * box.y0); y < height * box.y1; y++) {
    for (let x = Math.floor(width * box.x0); x < width * box.x1; x++) {
      const i = (y * width + x) * 4;
      r += data[i]; b += data[i + 2]; n++;
    }
  }
  return (b / Math.max(n, 1)) / Math.max(r / Math.max(n, 1), 1);
}

export default {
  '器が空なら「持ち帰る」が出ない': () => withPage({ hour: 13 }, async (page) => {
    const hidden = await page.evaluate(() => document.getElementById('btnTakeHome').hidden);
    eq(hidden, true, '器が空なのに「持ち帰る」が出ている');
  }),

  '器に入れると「持ち帰る」が出て、匹数が文に出る': () => withPage({ hour: 13 }, async (page) => {
    await putInBowl(page, 3);
    const got = await page.evaluate(() => {
      const b = document.getElementById('btnTakeHome');
      return { hidden: b.hidden, text: b.textContent };
    });
    eq(got.hidden, false, '器に入れても「持ち帰る」が出ない');
    ok(got.text.includes('3'), `匹数が文に出ていない（「${got.text}」）`);
  }),

  '押すと器が空になり、家に移り、保存に残る': () => withPage({ hour: 13 }, async (page, errors) => {
    await putInBowl(page, 4, 3);
    await takeHome(page);
    eq((await peek(page, 'bowl')), 0, '器が空になっていない');
    eq(await peek(page, 'view'), 'home', '家へ移っていない');
    const fish = await peek(page, 'home');
    eq(fish.length, 4, '家にいる匹数');
    eq(fish.filter((f) => f.turtle).length, 1, '亀が家に居ない');
    const raw = await peek(page, 'stored');
    ok(raw && JSON.parse(raw).fish.length === 4, '保存に残っていない');
    eq(errors.length, 0, errors.slice(0, 3).join(' / '));
  }),

  '上から覗いても鉢の中が見える': () => withPage({ hour: 13 }, async (page) => {
    // 中身をガラスの段だけで描いていたら、上から見た鉢が三日月に欠けて、
    // 真ん中は縁側の板が透けて見えていた
    await putInBowl(page, 5);
    await takeHome(page);
    await page.evaluate(() => { window.__kingyo.renderer.orbit = { x: 0, y: 1 }; });
    await page.waitForTimeout(900);
    // 縁側の板は赤茶、鉢の水は青緑。欠けていれば真ん中が板の色で埋まる
    const img = await __shot(page);
    const mouth = blueness(img, { x0: 0.46, x1: 0.54, y0: 0.42, y1: 0.54 });
    const board = blueness(img, { x0: 0.12, x1: 0.26, y0: 0.60, y1: 0.80 });
    ok(mouth > board * 1.15,
       `上から覗いた鉢の真ん中が板の色のまま（青み ${mouth.toFixed(2)} / 板 ${board.toFixed(2)}）`);
  }),

  '雨の日は鉢の水面にも雨粒が落ちる': () => withPage({ hour: 13 }, async (page) => {
    await putInBowl(page, 1);
    await takeHome(page);
    await setWeather(page, 2);
    await until(page, 'jarRainHits', (n) => n > 0, '雨なのに鉢の水面に粒が落ちない');
  }),

  '家から屋台へ戻る道が画面にある': () => withPage({ hour: 13 }, async (page) => {
    // ブラウザの戻るしか無い、という状態にしない
    await putInBowl(page, 1);
    await takeHome(page);
    eq(await page.evaluate(() => document.getElementById('btnStall').hidden), false,
       '家に「屋台へ戻る」が出ていない');
    await page.click('#btnStall');
    await until(page, 'view', (v) => v === 'stall', 'ボタンを押しても屋台へ戻らない');
    eq(await page.evaluate(() => document.getElementById('btnStall').hidden), true,
       '屋台に「屋台へ戻る」が残ったまま');
  }),

  '持ち帰っても屋台は続けられる': () => withPage({ hour: 13 }, async (page) => {
    await page.evaluate(() => { window.__kingyo.game.score = 1234; });
    await putInBowl(page, 2);
    await takeHome(page);
    await page.evaluate(() => { location.hash = ''; });
    await until(page, 'view', (v) => v === 'stall', '屋台へ戻れない');
    await page.waitForTimeout(900);
    eq(await page.evaluate(() => window.__kingyo.game.score), 1234, '点が消えた');
    ok((await page.evaluate(() => window.__kingyo.game.school.list.length)) > 80, '舟の金魚が消えた');
  }),

  '屋台へ戻っても、手で合わせた時刻が残っている': () => withPage({ hour: 17 }, async (page) => {
    // 同じページで切り替えている証。別ページにすると、ここが落ちる
    await putInBowl(page, 1);
    await takeHome(page);
    await page.evaluate(() => { location.hash = ''; });
    await until(page, 'view', (v) => v === 'stall', '屋台へ戻れない');
    eq(await peek(page, 'hour'), 17, '時刻がまっさらに戻った');
  }),

  '閉じて開き直しても家に残っている': () => withPage({ hour: 13 }, async (page) => {
    await putInBowl(page, 3);
    await takeHome(page);
    await page.reload({ waitUntil: 'load' });
    await page.waitForFunction(() => window.__kingyo, null, { timeout: 60000 });
    await page.waitForTimeout(1500);
    eq((await peek(page, 'home')).length, 3, '開き直したら消えていた');
  }),

  '屋台と家を 3 往復しても落ちない': () => withPage({ hour: 13 }, async (page, errors) => {
    await putInBowl(page, 2);
    await takeHome(page);
    for (let i = 0; i < 3; i++) {
      await page.evaluate(() => { location.hash = ''; });
      await until(page, 'view', (v) => v === 'stall', '屋台へ戻れない');
      await page.waitForTimeout(600);
      await page.evaluate(() => { location.hash = '#home'; });
      await until(page, 'view', (v) => v === 'home', '家へ行けない');
      await page.waitForTimeout(600);
    }
    eq(errors.length, 0, errors.slice(0, 3).join(' / '));
    const m = await measure(page);
    ok(m.mean > 10 && m.detail > 1, `往復したら描けなくなった（${m.mean.toFixed(0)} / ${m.detail.toFixed(1)}）`);
  }),

  '空の鉢でも真っ黒にならない': () => withPage({ hour: 13 }, async (page, errors) => {
    await page.evaluate(() => { location.hash = '#home'; });
    await until(page, 'view', (v) => v === 'home', '家へ行けない');
    await page.waitForTimeout(1200);
    const m = await measure(page);
    ok(m.mean > 10, `家の画面が暗すぎる（${m.mean.toFixed(0)}）`);
    ok(m.detail > 1, `家の画面が平ら（${m.detail.toFixed(1)}）`);
    const label = await page.evaluate(() => document.getElementById('homeCount').textContent);
    ok(label.length > 0, '匹数の札が空');
    eq(errors.length, 0, errors.slice(0, 3).join(' / '));
  }),

  '壊れた保存を入れてから開いても落ちない': async () => {
    browser ||= await launch();
    const ctx = await browser.newContext({ viewport: { width: 960, height: 540 } });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await page.addInitScript(() => {
      try { localStorage.setItem('kingyo.home', '{壊れている'); } catch { /* 無視 */ }
    });
    await page.goto('http://localhost:8010/index.html?test=1#home', { waitUntil: 'load' });
    await page.waitForFunction(() => window.__kingyo, null, { timeout: 60000 });
    await page.waitForTimeout(2500);
    try {
      eq(await peek(page, 'view'), 'home', '家の画面にならない');
      eq((await peek(page, 'home')).length, 0, '壊れた保存から金魚が湧いた');
      const broken = await page.evaluate(() => localStorage.getItem('kingyo.home.broken'));
      eq(broken, '{壊れている', '壊れた保存が退避されていない');
      eq(errors.length, 0, errors.slice(0, 3).join(' / '));
    } finally { await ctx.close(); }
  },

  '明かりを消せば、家も時刻どおりに暗くなる': () => withPage({ hour: 13 }, async (page) => {
    // 明かりを点けたままだと、夜のほうが夕方より明るくなる。
    // それは部屋に灯りが点いているのだから当たり前で、逆転ではない。
    // 時刻の効きを見たいので、明かりは消して測る
    await putInBowl(page, 2);
    await takeHome(page);
    await setHour(page, 20);
    await page.evaluate(() => {
      const b = document.getElementById('btnLamp');
      if (b.getAttribute('aria-pressed') === 'true') b.click();
    });
    await page.waitForTimeout(900);
    const got = [];
    for (const h of [13, 17.5, 20]) {
      await setHour(page, h);
      got.push([`${h}時`, (await measure(page)).mean]);
    }
    descending(got, '家の明るさ', 4);
    // 深夜は、屋台の「店じまい」に合わせて月明かりが足される。
    // 20 時より明るくなるが、どちらも夜の暗さには収まっている
    await setHour(page, 2);
    between((await measure(page)).mean, 5, 45, '深夜の明るさ');
  }),

  '夜は明かりを点けたほうが明るい': () => withPage({ hour: 20 }, async (page) => {
    await putInBowl(page, 2);
    await takeHome(page);
    await setHour(page, 20);
    const on = (await measure(page)).mean;
    await page.evaluate(() => document.getElementById('btnLamp').click());
    await page.waitForTimeout(1100);
    const off = (await measure(page)).mean;
    ok(on > off * 1.15,
       `明かりの効きが弱い（点灯 ${on.toFixed(0)} / 消灯 ${off.toFixed(0)}）`);
  }),

  '明かりのボタンは暗くなってからだけ出る': () => withPage({ hour: 13 }, async (page) => {
    await putInBowl(page, 1);
    await takeHome(page);
    await setHour(page, 13);
    eq(await page.evaluate(() => document.getElementById('btnLamp').hidden), true,
       '真昼に明かりのボタンが出ている');
    await setHour(page, 20);
    // ボタンの出し入れは次のコマで決まる。
    // 試験を通しで走らせた混み合った状態だと、それが 0.6 秒では来ない
    await page.waitForFunction(() => !document.getElementById('btnLamp').hidden,
                               null, { timeout: 30000 })
      .catch(() => { throw new Error('夜なのに明かりのボタンが出ない'); });
  }),

  '器が満杯なら、それ以上は掬えない': () => withPage({ hour: 13 }, async (page) => {
    await putInBowl(page, 12);
    eq(await peek(page, 'bowlFull'), true, '12 匹で満杯になっていない');
    // 満杯のまま掬おうとしても、古い金魚は消えない
    const before = await peek(page, 'bowl');
    await page.evaluate(() => {
      const g = window.__kingyo.game;
      // 掬いの判定を通す位置へポイを置き、金魚を寄せる
      g.poi.y = 0.01; g.poi.vy = 0.02;
      for (const f of g.school.list.slice(0, 3)) { f.p[0] = g.poi.x; f.p[2] = g.poi.z; f.p[1] = 0.01; }
    });
    await page.waitForTimeout(900);
    eq(await peek(page, 'bowl'), before, '満杯なのに器の数が変わった');
  }),

  '縦画面でも鉢が収まる': () => withPage({
    viewport: { width: 390, height: 664 }, mobile: true, hour: 13,
  }, async (page, errors) => {
    await putInBowl(page, 2);
    await takeHome(page);
    const m = await measure(page);
    ok(m.mean > 10 && m.detail > 1, '縦画面で描けていない');
    eq(errors.length, 0, errors.slice(0, 3).join(' / '));
  }),

  'おしまい': async () => { if (browser) await browser.close(); browser = null; },
};
