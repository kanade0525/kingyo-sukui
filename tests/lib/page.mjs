// 絵を出すところまでの手順と、画面を測る道具。
//
// どの試験も「立ち上げ → 条件を決める → 測る」の形になるので、
// そこだけまとめてある。

import { chromium } from 'playwright';
import { inflateSync } from 'node:zlib';

export const BASE = process.env.KINGYO_URL || 'http://localhost:8010';

/**
 * SwiftShader で動かす。
 *
 * 実機の GPU は使わない。使うと機械ごとに結果が変わって、
 * 試験が通ったり通らなかったりする。ソフトウェアで描けば遅いかわりに
 * どこで走らせても同じ絵になる。
 */
export async function launch() {
  return chromium.launch({
    args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader',
           '--autoplay-policy=no-user-gesture-required'],
  });
}

/** 絵が出るまで待つ。覆いが消えた時点で 1 枚目が描けている */
export async function open(browser, opt = {}) {
  const ctx = await browser.newContext({
    viewport: opt.viewport || { width: 960, height: 540 },
    deviceScaleFactor: opt.dpr || 1,
    isMobile: !!opt.mobile,
    hasTouch: !!opt.mobile,
    locale: opt.locale || 'ja-JP',
    ...(opt.geo ? { geolocation: opt.geo, permissions: ['geolocation'] } : {}),
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(`${BASE}/index.html?test=1`, { waitUntil: 'load' });
  await page.waitForFunction(() => {
    const el = document.getElementById('loading');
    return !el || getComputedStyle(el).opacity === '0' || !el.offsetParent;
  }, null, { timeout: 90000 });
  await page.waitForTimeout(opt.settle ?? 1200);
  // 時刻を決めてから返す。
  //
  // 決めないと端末の時計に従うので、夜に走らせると水面が暗く、
  // 21 時を回っていればポイも片付けられている。試験が時間帯で
  // 通ったり通らなかったりするのは、試験の落ち度。
  // 実際の時計を見たい試験だけ hour: null を渡す。
  if (opt.hour !== null) await setHour(page, opt.hour ?? 13);
  return { ctx, page, errors };
}

/** 時刻のつまみを動かす */
export async function setHour(page, h) {
  await page.evaluate((v) => {
    const el = document.getElementById('hour');
    el.value = String(v);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  }, h);
  // つまみを動かしただけでは、まだ絵も中の状態も追いついていない。
  // 時刻が入ったことを確かめてから、数コマぶん待つ。
  // SwiftShader は 1 秒に 10 コマほどしか出ないので、待ちは長めに取る
  await page.waitForFunction((v) => Math.abs(window.__kingyo.hour - v) < 1e-6, h, { timeout: 15000 });
  await page.waitForTimeout(900);
}

/** 中の値がそうなるまで待つ。絵の更新を待つより確かで、速い */
export async function until(page, what, pred, msg, timeout = 20000) {
  await page.waitForFunction(
    ({ what, src }) => (new Function('v', `return (${src})(v)`))(window.__kingyo[what]),
    { what, src: pred.toString() }, { timeout },
  ).catch(async () => {
    const got = await peek(page, what);
    throw new Error(`${msg}（いまは ${JSON.stringify(got)}）`);
  });
}

/** 天気を選ぶ。0 晴れ / 1 くもり / 2 雨 */
export async function setWeather(page, w) {
  await page.evaluate((v) => {
    for (const b of document.querySelectorAll('#segWx button')) {
      if (Number(b.dataset.w) === v) b.click();
    }
  }, w);
  await page.waitForTimeout(700);
}

/** 見下ろす角度を選ぶ。55 浅め / 65 標準 / 87 真上 */
export async function setPitch(page, p) {
  await page.evaluate((v) => {
    for (const b of document.querySelectorAll('#segPitch button')) {
      if (Number(b.dataset.p) === v) b.click();
    }
  }, p);
  await page.waitForTimeout(700);
}

/** 波を止める。水面に出る細工だけを見たいとき */
export async function stillWater(page) {
  await page.evaluate(() => {
    const el = document.getElementById('amp');
    el.value = '0';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForTimeout(900);
}

/**
 * 画面の一部を測る。
 *
 * 画素を 1 点ずつ当てにいくと、波も金魚も動いているので揺れる。
 * 範囲の平均と、隣り合う画素の差（細かさ）で見る。
 * 範囲は画面に対する割合で渡す。
 */
export async function measure(page, box = { x0: 0.2, x1: 0.8, y0: 0.35, y1: 0.75 }, cols = 1) {
  const { width, height, data } = await shot(page);
  const lum = (i) => 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
  const out = [];
  for (let k = 0; k < cols; k++) {
    const xa = Math.floor(width * (box.x0 + (box.x1 - box.x0) * k / cols));
    const xb = Math.floor(width * (box.x0 + (box.x1 - box.x0) * (k + 1) / cols));
    let sum = 0, n = 0, det = 0, dn = 0;
    for (let y = Math.floor(height * box.y0); y < height * box.y1; y += 2) {
      for (let x = xa; x < xb - 2; x += 2) {
        const i = (y * width + x) * 4;
        sum += lum(i); n++;
        const e = lum(i + 8) - lum(i);
        det += e * e; dn++;
      }
    }
    out.push({ mean: sum / Math.max(n, 1), detail: Math.sqrt(det / Math.max(dn, 1)) });
  }
  return cols === 1 ? out[0] : out;
}

/**
 * PNG を生の画素へ戻す。
 *
 * 画像の取り込みに外の道具を足したくないので、必要なところだけ自分で解く。
 * Playwright が返すのは 8bit RGBA の PNG で、圧縮は zlib。
 * Node が持っている zlib でほどいて、行ごとの予測を戻せばよい。
 */
export function __shot(page) { return shot(page); }

function decodePng(buf) {
  let p = 8;                                    // 先頭の合図を飛ばす
  let width = 0, height = 0, bpp = 4;
  const chunks = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('ascii', p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (type === 'IHDR') {
      width = body.readUInt32BE(0);
      height = body.readUInt32BE(4);
      const depth = body[8], color = body[9];
      if (depth !== 8) throw new Error(`8bit 以外の PNG は解けない（${depth}bit）`);
      bpp = color === 6 ? 4 : color === 2 ? 3 : 0;
      if (!bpp) throw new Error(`RGB か RGBA 以外の PNG は解けない（色の型 ${color}）`);
    } else if (type === 'IDAT') {
      chunks.push(body);
    } else if (type === 'IEND') break;
    p += 12 + len;
  }
  const raw = inflateSync(Buffer.concat(chunks));
  const stride = width * bpp;
  const out = new Uint8Array(width * height * 4);
  let prev = new Uint8Array(stride);
  for (let y = 0; y < height; y++) {
    const f = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    const cur = new Uint8Array(stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? cur[x - bpp] : 0;    // 左
      const b = prev[x];                        // 上
      const c = x >= bpp ? prev[x - bpp] : 0;   // 左上
      let v = line[x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const q = a + b - c;
        const pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c);
        v += (pa <= pb && pa <= pc) ? a : (pb <= pc ? b : c);
      }
      cur[x] = v & 0xff;
    }
    for (let x = 0; x < width; x++) {
      out[(y * width + x) * 4] = cur[x * bpp];
      out[(y * width + x) * 4 + 1] = cur[x * bpp + 1];
      out[(y * width + x) * 4 + 2] = cur[x * bpp + 2];
      out[(y * width + x) * 4 + 3] = bpp === 4 ? cur[x * bpp + 3] : 255;
    }
    prev = cur;
  }
  return { width, height, data: out };
}

/**
 * 少し時間を置いて、画面がどれだけ変わったかを測る。
 *
 * 明るさや細かさだけでは、雨の波紋のように「動いているが細かくない」
 * ものを捕まえられない。2 枚の差を取れば、動いた量そのものが出る。
 */
export async function changeOver(page, ms = 500, box = { x0: 0.18, x1: 0.82, y0: 0.32, y1: 0.78 }) {
  const a = await shot(page);
  await page.waitForTimeout(ms);
  const b = await shot(page);
  let sum = 0, n = 0;
  for (let y = Math.floor(a.height * box.y0); y < a.height * box.y1; y += 2) {
    for (let x = Math.floor(a.width * box.x0); x < a.width * box.x1; x += 2) {
      const i = (y * a.width + x) * 4;
      sum += Math.abs(a.data[i] - b.data[i])
           + Math.abs(a.data[i + 1] - b.data[i + 1])
           + Math.abs(a.data[i + 2] - b.data[i + 2]);
      n++;
    }
  }
  return sum / Math.max(n, 1);
}

/**
 * 画面を撮る。
 *
 * 真っ黒で返ってくることがある。描画と画面の合成が間に合わないときで、
 * 絵そのものは出ている。そのまま測ると「夜より深夜が明るい」のような
 * あり得ない結果になるので、黒い板が来たら少し待って撮り直す。
 */
async function shot(page, tries = 4) {
  for (let i = 0; i < tries; i++) {
    const img = decodePng(await page.screenshot());
    let sum = 0;
    const step = Math.max(1, Math.floor(img.data.length / 4 / 4000)) * 4;
    for (let j = 0; j < img.data.length; j += step) sum += img.data[j] + img.data[j + 1] + img.data[j + 2];
    if (sum > 0) return img;
    await page.waitForTimeout(500);
  }
  throw new Error('画面が真っ黒のまま返ってくる');
}

/** 中を覗く口。?test=1 のときだけ生えている */
export async function peek(page, what) {
  return page.evaluate((w) => {
    const k = window.__kingyo;
    if (!k) throw new Error('__kingyo が無い。?test=1 を付けて開いているか');
    return k[w];
  }, what);
}
