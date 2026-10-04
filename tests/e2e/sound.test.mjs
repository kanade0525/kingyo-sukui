// 音。実際に出ている音量を測る。
//
// 耳で判断できないので数で見る。深夜だけ 11dB 沈んでいた件、
// 合成と録音が二重に鳴っていた件が出どころ。

import { launch } from '../lib/page.mjs';
import { ok, between, eq } from '../lib/assert.mjs';

const BASE = process.env.KINGYO_URL || 'http://localhost:8010';

/**
 * 音を鳴らして、出てくる音量を測る。
 *
 * 絵まで描くと遅いので、音だけを直に組み立てる。
 * 聞くことはできないので、最後の段に解析器を挿して実効値を読む。
 */
async function withSound(fn) {
  const browser = await launch();
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/sound.html`, { waitUntil: 'load' });
  const v = await page.evaluate(() =>
    document.querySelector('script[type=module]').textContent.match(/\?v=(\d+)/)[1]);
  await page.evaluate(async (ver) => {
    const { Sound } = await import(`/assets/js/sound.js?v=${ver}`);
    const { sunFor, setSite } = await import(`/assets/js/sky.js?v=${ver}`);
    setSite(35.68, 139.77);
    const s = new Sound();
    s.unlock();
    await s.ctx.resume();
    const an = s.ctx.createAnalyser();
    an.fftSize = 2048;
    s.master.connect(an);
    window.__snd = { s, an, sunFor, buf: new Float32Array(an.fftSize) };
  }, v);
  // 録音が届くまで待つ
  await page.waitForFunction(() => Object.keys(window.__snd.s.buffers).length >= 6,
                             null, { timeout: 60000 }).catch(() => {});
  try { await fn(page, errors); } finally { await browser.close(); }
}

/** その場面で何 dB 出ているか */
async function level(page, hour, weather = 0) {
  return page.evaluate(async ({ hour, weather }) => {
    const { s, an, sunFor, buf } = window.__snd;
    s.setScene(sunFor(hour, 0, weather, new Date(2026, 7, 10)));
    await new Promise((r) => setTimeout(r, 4200));     // 立ち上がりが 1.2 秒
    let acc = 0, n = 0, peak = 0;
    const end = performance.now() + 2500;
    while (performance.now() < end) {
      an.getFloatTimeDomainData(buf);
      for (const x of buf) { acc += x * x; if (Math.abs(x) > peak) peak = Math.abs(x); }
      n += buf.length;
      await new Promise((r) => setTimeout(r, 25));
    }
    return { rms: 20 * Math.log10(Math.sqrt(acc / n) + 1e-9),
             peak: 20 * Math.log10(peak + 1e-9) };
  }, { hour, weather });
}

export default {
  '録音が 6 本とも読め、どの場面も近い音量で鳴る': () => withSound(async (page, errors) => {
    const clips = await page.evaluate(() => Object.keys(window.__snd.s.buffers));
    eq(clips.length, 6, `読めた録音: ${clips.join(', ')}`);

    const got = [];
    for (const [h, w, name] of [[12, 0, '昼'], [17, 0, '夕方'], [20, 0, '宵'],
                                [23.5, 0, '深夜'], [12, 2, '昼の雨']]) {
      const m = await level(page, h, w);
      got.push([name, m]);
      // 小さすぎれば聞こえず、大きすぎれば割れる
      between(m.rms, -34, -17, `${name}の音量（dB）`);
      ok(m.peak < -2, `${name}の頂点が高すぎる（${m.peak.toFixed(1)}dB）`);
    }
    // 場面ごとの差が開きすぎない。深夜だけ 11dB 沈んでいた
    const rms = got.map(([, m]) => m.rms);
    const span = Math.max(...rms) - Math.min(...rms);
    ok(span < 9, `場面ごとの音量差が ${span.toFixed(1)}dB もある`
                 + `（${got.map(([n, m]) => `${n} ${m.rms.toFixed(0)}`).join(' / ')}）`);
    eq(errors.length, 0, errors.slice(0, 2).join(' / '));
  }),

  '合成へ切り替えても音量が変わらない': () => withSound(async (page) => {
    // 録音に合わせて層の音量を決め直したので、合成側は比で戻してある
    const both = await page.evaluate(async () => {
      const { s, an, sunFor, buf } = window.__snd;
      const read = async () => {
        await new Promise((r) => setTimeout(r, 4200));
        let acc = 0, n = 0;
        const end = performance.now() + 2200;
        while (performance.now() < end) {
          an.getFloatTimeDomainData(buf);
          for (const x of buf) acc += x * x;
          n += buf.length;
          await new Promise((r) => setTimeout(r, 25));
        }
        return 20 * Math.log10(Math.sqrt(acc / n) + 1e-9);
      };
      s.setScene(sunFor(12, 0, 0, new Date(2026, 7, 10)));
      s.setSource('rec');
      const rec = await read();
      s.setSource('synth');
      const syn = await read();
      return { rec, syn };
    });
    ok(Math.abs(both.rec - both.syn) < 7,
       `録音 ${both.rec.toFixed(1)}dB と合成 ${both.syn.toFixed(1)}dB で差がありすぎる`);
  }),

  '鳴り始めはそろってフェードインする': async () => {
    // 録音を 1 本ずつ順に読んでいたので、読めた順に鳴り出していた。
    // 回線しだいで蝉だけ先に出たり、祭囃子が数秒遅れたりする。
    const browser = await launch();
    const page = await (await browser.newContext()).newPage();
    try {
      await page.goto(`${BASE}/sound.html`, { waitUntil: 'load' });
      const v = await page.evaluate(() =>
        document.querySelector('script[type=module]').textContent.match(/\?v=(\d+)/)[1]);
      const got = await page.evaluate(async (ver) => {
        const { Sound } = await import(`/assets/js/sound.js?v=${ver}`);
        const { sunFor, setSite } = await import(`/assets/js/sky.js?v=${ver}`);
        setSite(35.68, 139.77);
        const s = new Sound();
        s.unlock();
        await s.ctx.resume();
        const an = s.ctx.createAnalyser();
        an.fftSize = 1024;
        s.master.connect(an);
        s.setScene(sunFor(20, 0, 0, new Date(2026, 7, 10)));
        const buf = new Float32Array(an.fftSize);
        const t0 = s.ctx.currentTime;
        const out = [];
        // 1 点ごとに 200ms ぶん平均する。一度きりの音（ポンプの泡）が
        // 入るだけで短い窓は跳ねるので、ならしてから見る。
        // 刻みは揃わないので、実際の経過時刻も控える
        for (let i = 0; i < 30; i++) {
          const at = s.ctx.currentTime - t0;
          let acc = 0, n = 0;
          const end = performance.now() + 200;
          while (performance.now() < end) {
            an.getFloatTimeDomainData(buf);
            for (const x of buf) acc += x * x;
            n += buf.length;
            await new Promise((r) => setTimeout(r, 15));
          }
          out.push({ t: at, rms: Math.sqrt(acc / n),
                     master: s.master.gain.value, clips: Object.keys(s.buffers).length });
        }
        return out;
      }, v);

      eq(got[got.length - 1].clips, 6, `読めた録音が ${got[got.length - 1].clips} 本`);
      // 読めた本数が途中の数で見つかることはない。まとめて読んで一度に入れている
      ok(got.every((g) => g.clips === 0 || g.clips === 6),
         `録音が小出しに入っている（${[...new Set(got.map((g) => g.clips))].join(', ')} 本）`);

      // 親の音量が開ききるまでの時間。これが立ち上がりのフェードそのもの
      const shut = got.find((g) => g.master < 0.1);
      const open = got.find((g) => g.master > 0.8);
      ok(shut && open, '親の音量が開く様子を捕まえられなかった');
      ok(open.t - shut.t > 0.8,
         `親の音量が ${(open.t - shut.t).toFixed(2)} 秒で開ききる。急すぎる`);

      ok(got[0].rms < 0.01, `鳴らし始めの瞬間から音が出ている（${got[0].rms.toFixed(4)}）`);
      const peak = Math.max(...got.map((g) => g.rms));
      ok(peak > 0.01, `しばらく待っても鳴らない（頂点 ${peak.toFixed(4)}）`);

      // 出てくる音そのものの立ち上がりは、録音の中身しだいで形が変わるし、
      // 測る刻みも揃わない。フェードが効いているかは、親の音量の動きで見る。
      // それが立ち上がりの唯一の担い手になるようにしてある
    } finally {
      await browser.close();
    }
  },

  '音を切ると静かになる': () => withSound(async (page) => {
    const off = await page.evaluate(async () => {
      const { s, an, sunFor, buf } = window.__snd;
      s.setScene(sunFor(20, 0, 0, new Date(2026, 7, 10)));
      await new Promise((r) => setTimeout(r, 3000));
      s.setEnabled(false);
      await new Promise((r) => setTimeout(r, 1500));
      let acc = 0, n = 0;
      const end = performance.now() + 1200;
      while (performance.now() < end) {
        an.getFloatTimeDomainData(buf);
        for (const x of buf) acc += x * x;
        n += buf.length;
        await new Promise((r) => setTimeout(r, 25));
      }
      return 20 * Math.log10(Math.sqrt(acc / n) + 1e-9);
    });
    ok(off < -60, `切ったのに ${off.toFixed(1)}dB 出ている`);
  }),
};
