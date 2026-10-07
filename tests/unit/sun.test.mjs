// 太陽の位置。
//
// もとは「日の出 5:00、日の入り 18:48、南中 70 度」の決め打ちだった。
// 真夏の値なので 10 月に遊ぶと約 2 時間ずれる。実際の天文と突き合わせる。

import { sunFor, setSite, getSite, WEATHER } from '../../assets/js/sky.js?v=202610041317';
import { ok, near, between, descending } from '../lib/assert.mjs';

const DEG = 180 / Math.PI;
const TOKYO = [35.68, 139.77];
const d = (y, m, day) => new Date(y, m - 1, day, 12, 0, 0);

/** 高度が 0 を上下に跨ぐ時刻を細かく探す */
function crossings(when) {
  const out = { rise: null, set: null, noon: { h: 0, e: -99 } };
  let prev = null;
  for (let h = 0; h < 24; h += 1 / 600) {
    const e = sunFor(h, 0, 0, when).elev;
    if (e > out.noon.e) out.noon = { h, e };
    if (prev !== null && prev < 0 && e >= 0) out.rise = h;
    if (prev !== null && prev >= 0 && e < 0) out.set = h;
    prev = e;
  }
  return out;
}

const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

export default {
  '東京 10/3 の南中が実際と合う': () => {
    setSite(...TOKYO);
    const c = crossings(d(2026, 10, 3));
    // 国立天文台の暦に照らす。南中 11:31、高度 49.5 度
    near(c.noon.h, 11.52, 0.12, `南中の時刻（出たのは ${hhmm(c.noon.h)}）`);
    near(c.noon.e * DEG, 49.5, 1.5, '南中高度');
  },

  '東京 10/3 の日の出と日の入りが実際と合う': () => {
    setSite(...TOKYO);
    const c = crossings(d(2026, 10, 3));
    // 公表値は大気の屈折と太陽の直径を見込んだ「縁が地平線にかかる時刻」で、
    // 中心が高度 0 を通る時刻より 4〜5 分外側に出る。そのぶん幅を取る
    near(c.rise, 5.60, 0.25, `日の出（出たのは ${hhmm(c.rise)}）`);
    near(c.set, 17.43, 0.25, `日の入り（出たのは ${hhmm(c.set)}）`);
  },

  '夏至と冬至で昼の長さが変わる': () => {
    setSite(...TOKYO);
    const s = crossings(d(2026, 6, 21));
    const w = crossings(d(2026, 12, 21));
    const sLen = s.set - s.rise, wLen = w.set - w.rise;
    between(sLen, 14.0, 15.2, '夏至の昼の長さ（時間）');
    between(wLen, 9.2, 10.4, '冬至の昼の長さ（時間）');
    ok(sLen - wLen > 4, `夏至と冬至の差が ${(sLen - wLen).toFixed(1)} 時間しかない`);
  },

  '場所で日の長さが変わる': () => {
    const when = d(2026, 6, 21);
    setSite(43.06, 141.35);            // 札幌
    const north = crossings(when);
    setSite(26.21, 127.68);            // 那覇
    const south = crossings(when);
    setSite(...TOKYO);
    const nLen = north.set - north.rise, sLen = south.set - south.rise;
    ok(nLen > sLen + 1.0,
       `夏至の昼は札幌のほうが長いはず（札幌 ${nLen.toFixed(1)}h / 那覇 ${sLen.toFixed(1)}h）`);
  },

  '明るさが昼から夜へ単調に落ちる': () => {
    setSite(...TOKYO);
    const when = d(2026, 10, 3);
    const list = [12, 15, 16.5, 17.5, 18.5, 20, 23]
      .map((h) => [`${h}時`, sunFor(h, 0, 0, when).daylight]);
    descending(list, '昼の度合い');
  },

  '提灯は暗くなってから点き、店じまいで落ちる': () => {
    setSite(...TOKYO);
    const when = d(2026, 10, 3);
    ok(sunFor(12, 0, 0, when).lanternOn < 0.01, '真昼に提灯が点いている');
    ok(sunFor(19, 0, 0, when).lanternOn > 0.8, '夜に提灯が点いていない');
    // 店じまいは 21 時から 22 時
    ok(sunFor(20.5, 0, 0, when).closed < 0.01, '20 時半で店じまいが始まっている');
    near(sunFor(21.5, 0, 0, when).closed, 0.5, 0.1, '21 時半の店じまいの進み');
    ok(sunFor(22.5, 0, 0, when).closed > 0.99, '22 時半で店じまいが終わっていない');
    ok(sunFor(22.5, 0, 0, when).lanternOn < 0.01, '店じまいのあとも提灯が点いている');
  },

  '深夜でも真っ暗にはしない': () => {
    setSite(...TOKYO);
    const when = d(2026, 10, 3);
    const deep = sunFor(2, 0, 0, when);
    ok(deep.closed > 0.99, '深夜が店じまい扱いになっていない');
    // 月と町明かりぶん。0 にすると舟の形も見えなくなる
    ok(deep.zenith[2] > 0.008, `深夜の空が暗すぎる（天頂の青 ${deep.zenith[2].toFixed(4)}）`);
    // 露出だけでは見えるかどうかは決まらない（空の明かりとの積で決まる）。
    // 実際に舟の形が見えることは通しの試験「深夜でも舟の形が見える」で見ている。
    // ここでは、昼より下げすぎていないことだけ確かめる
    const noon = sunFor(12, 0, 0, when);
    ok(deep.exposure > noon.exposure * 0.70,
       `深夜の露出が昼に比べて低すぎる（深夜 ${deep.exposure.toFixed(2)} / 昼 ${noon.exposure.toFixed(2)}）`);
  },

  '曇りと雨では直射が失われる': () => {
    setSite(...TOKYO);
    const when = d(2026, 10, 3);
    const clear = sunFor(12, 0, WEATHER.CLEAR, when);
    const rain = sunFor(12, 0, WEATHER.RAIN, when);
    ok(rain.direct < clear.direct * 0.2, '雨でも直射が残りすぎ');
    ok(rain.sunColor[0] < clear.sunColor[0] * 0.2, '雨なのに太陽が明るい');
    // 光量どおりに落とすと、昼の雨がただの夕方になる。露出で持ち上げる
    ok(rain.exposure > clear.exposure, '雨の露出が持ち上がっていない');
  },

  '観測地を変えれば読み戻せる': () => {
    setSite(43.06, 141.35);
    const s = getSite();
    near(s.lat, 43.06, 1e-6, '緯度');
    setSite(...TOKYO);
  },
};
