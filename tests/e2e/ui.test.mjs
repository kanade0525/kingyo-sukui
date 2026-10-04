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

const PHONE = { viewport: { width: 390, height: 844 }, mobile: true };

export default {
  'スマホで設定のすべてのつまみに手が届く': () => withPage(PHONE, async (page) => {
    await page.click('#btnPanel');
    await page.waitForTimeout(500);
    const bad = await page.evaluate(() => {
      const panel = document.getElementById('panel');
      const out = [];
      for (const el of panel.querySelectorAll('input, button')) {
        // 隠してあるもの（鳴っている層の「鳴る時刻へ」など）は対象外
        if (el.hidden || el.offsetParent === null) continue;
        el.scrollIntoView({ block: 'center' });
        const r = el.getBoundingClientRect();
        if (r.top < 0 || r.bottom > innerHeight || r.width < 8 || r.height < 8) {
          out.push(`${el.id || el.textContent.trim().slice(0, 10)}`
                 + `（上 ${Math.round(r.top)} / 下 ${Math.round(r.bottom)} / 画面 ${innerHeight}）`);
        }
      }
      return out;
    });
    eq(bad.length, 0, `画面の外に出ている操作: ${bad.join(', ')}`);
  }),

  '設定を開くと右上の札が引っ込む': () => withPage(PHONE, async (page) => {
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
