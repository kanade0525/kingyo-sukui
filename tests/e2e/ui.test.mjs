// 画面の操作まわり。設定が届くこと、英語になること、鳴らない音が分かること。
//
// 設定の音のつまみが画面の外に出ていて触れなかった件、雨のつまみを
// 動かしても何も起きないことが分からなかった件が出どころ。

import { launch, open, peek, until } from '../lib/page.mjs';
import { ok, eq, between } from '../lib/assert.mjs';

let browser;
const withPage = async (opt, fn) => {
  browser ||= await launch();
  const { ctx, page, errors } = await open(browser, opt);
  try { await fn(page, errors); } finally { await ctx.close(); }
};

/**
 * iPhone の実際の表示領域。
 *
 * 390 × 844 は画面全体の大きさで、Safari の上下のバーを引いた
 * 見えている範囲はもっと狭い。844 で測っていたので、
 * 「設定を開くと時刻が画面の外に出る」のを見逃していた。
 */
const PHONES = [
  ['iPhone 13', { width: 390, height: 664 }],
  ['iPhone SE', { width: 375, height: 553 }],
  ['さらに狭い', { width: 360, height: 460 }],
];

export default {
  'スマホで設定が画面に収まる': async () => {
    for (const [name, viewport] of PHONES) {
      await withPage({ viewport, mobile: true }, async (page) => {
        await page.click('#btnPanel');
        await page.waitForTimeout(600);
        const r = await page.evaluate(() => {
          const p = document.getElementById('panel');
          const b = p.getBoundingClientRect();
          return { top: b.top, bottom: b.bottom, vh: innerHeight,
                   vv: visualViewport ? Math.round(visualViewport.height) : null,
                   set: p.style.maxHeight };
        });
        ok(r.top >= -0.5, `${name}: 設定の上が画面から ${(-r.top).toFixed(0)}px はみ出している`);
        ok(r.bottom <= r.vh + 0.5, `${name}: 設定の下が画面から ${(r.bottom - r.vh).toFixed(0)}px はみ出している`);
        // 見えている高さから入れていること。CSS の vh だけに任せると、
        // iOS では URL バーのぶん大きく出てしまう
        ok(r.set !== '', `${name}: 高さが見えている範囲から入っていない`);
        ok(parseFloat(r.set) <= r.vv, `${name}: 入れた高さ ${r.set} が見えている範囲 ${r.vv}px より大きい`);
      });
    }
  },

  'スマホで設定の端から端まで送れる': async () => {
    for (const [name, viewport] of PHONES) {
      await withPage({ viewport, mobile: true }, async (page) => {
        await page.click('#btnPanel');
        await page.waitForTimeout(600);
        const r = await page.evaluate(() => {
          const p = document.getElementById('panel');
          const look = (el) => {
            const b = el.getBoundingClientRect();
            return b.top >= 0 && b.bottom <= innerHeight && b.height > 8;
          };
          const rows = [...p.querySelectorAll('.row')];
          p.scrollTop = 0;
          const first = look(document.getElementById('hour'));
          p.scrollTop = p.scrollHeight;
          const last = look(rows[rows.length - 1]);
          return { first, last, scroll: p.scrollHeight > p.clientHeight };
        });
        ok(r.first, `${name}: いちばん上まで送っても時刻のつまみに届かない`);
        ok(r.last, `${name}: いちばん下まで送っても最後の行に届かない`);
      });
    }
  },

  '設定を開くと右上の札が引っ込む': () => withPage({ viewport: PHONES[0][1], mobile: true }, async (page) => {
    await page.click('#btnPanel');
    await page.waitForTimeout(400);
    const over = await page.evaluate(() => {
      const bar = document.getElementById('nowbar');
      return getComputedStyle(bar).display !== 'none';
    });
    eq(over, false, '札が設定に重なったまま');
  }),

  '鳴らない音には印が付く': () => withPage({ hour: 13 }, async (page) => {
    await page.click('#btnPanel');
    await page.waitForTimeout(1200);
    const st = await page.evaluate(() => {
      const o = {};
      for (const k of ['cicada', 'dusk', 'furin', 'festival', 'crowd', 'insect', 'rain']) {
        const row = document.getElementById('v_' + k).closest('.row');
        o[k] = row.classList.contains('off');
      }
      return o;
    });
    // 真昼。蝉と風鈴は鳴り、祭囃子・虫・雨は鳴らない
    eq(st.cicada, false, '真昼なのに蝉に「鳴らない」印が付いている');
    eq(st.furin, false, '真昼なのに風鈴に印が付いている');
    eq(st.festival, true, '真昼なのに祭囃子に印が付いていない');
    eq(st.insect, true, '真昼なのに虫に印が付いていない');
    eq(st.rain, true, '晴れなのに雨に印が付いていない');
  }),

  '印を押すと、その音が鳴る時刻へ飛ぶ': () => withPage({ hour: 13 }, async (page) => {
    await page.click('#btnPanel');
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      document.getElementById('v_dusk').closest('.row').querySelector('.mute').click();
    });
    await page.waitForTimeout(1200);
    const want = await peek(page, 'want');
    const hour = await peek(page, 'hour');
    ok(want.dusk > 0.5, `飛んだ先（${hour} 時）で夕方の蝉が鳴っていない（${want.dusk.toFixed(2)}）`);
  }),

  '雨の印を押すと雨になる': () => withPage({ hour: 13 }, async (page) => {
    await page.click('#btnPanel');
    await page.waitForTimeout(1200);
    await page.evaluate(() => {
      document.getElementById('v_rain').closest('.row').querySelector('.mute').click();
    });
    await page.waitForTimeout(1200);
    eq(await peek(page, 'weather'), 2, '雨にならない');
    ok((await peek(page, 'want')).rain > 0.9, '雨なのに雨の音が鳴らない');
  }),

  '日本語以外のブラウザでは英語になる': () => withPage({ locale: 'en-US' }, async (page) => {
    const got = await page.evaluate(() => {
      const bad = [];
      const walk = (el) => {
        for (const n of el.childNodes) {
          if (n.nodeType === 3 && /[ぁ-んァ-ヶ一-龠]/.test(n.textContent)) {
            bad.push(n.textContent.trim().slice(0, 14));
          } else if (n.nodeType === 1) walk(n);
        }
      };
      document.getElementById('btnPanel').click();
      walk(document.body);
      return { lang: document.documentElement.lang, title: document.title, bad };
    });
    eq(got.lang, 'en', '<html lang> が英語になっていない');
    ok(!/[ぁ-んァ-ヶ一-龠]/.test(got.title), `題が日本語のまま（${got.title}）`);
    eq(got.bad.length, 0, `日本語が残っている: ${got.bad.join(' / ')}`);
  }),

  '日本語のブラウザでは日本語のまま': () => withPage({ locale: 'ja-JP' }, async (page) => {
    const lang = await page.evaluate(() => document.documentElement.lang);
    eq(lang, 'ja', '日本語にならない');
  }),

  '音の入切が効く': () => withPage({}, async (page) => {
    const pressed = () => page.evaluate(() =>
      document.getElementById('btnSound').getAttribute('aria-pressed'));
    eq(await pressed(), 'true', '始めから音が切れている');
    await page.click('#btnSound');
    await page.waitForTimeout(300);
    eq(await pressed(), 'false', '切れない');
  }),

  'おしまい': async () => { if (browser) await browser.close(); browser = null; },
};
