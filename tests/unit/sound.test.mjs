// どの音がいつ鳴るか。
//
// 夕方の蝉が「明るさ」で決まっていたせいで、鳴る窓が 25 分しか
// 開いていなかった件が出どころ。窓の広さと場所を数で押さえる。

import { layerWants } from '../../assets/js/sound.js?v=202610041321';
import { sunFor, setSite, WEATHER } from '../../assets/js/sky.js?v=202610041321';
import { ok, between, eq } from '../lib/assert.mjs';

const when = new Date(2026, 7, 10, 12, 0, 0);     // 8/10。夏の縁日
const KEYS = ['pump', 'cicada', 'dusk', 'furin', 'festival', 'crowd', 'insect', 'rain'];
const at = (h, w = 0) => layerWants(sunFor(h, 0, w, when));

/** その層が 0.05 を超えて鳴る時間帯を、幅の広い順に返す */
function windows(key, w = 0) {
  const out = [];
  let start = null;
  for (let h = 0; h <= 24; h += 1 / 120) {
    const v = at(Math.min(h, 23.999), w)[key] ?? 0;
    if (v > 0.05 && start === null) start = h;
    if ((v <= 0.05 || h >= 24) && start !== null) { out.push([start, h]); start = null; }
  }
  return out.sort((a, b) => (b[1] - b[0]) - (a[1] - a[0]));
}

export default {
  '音量はすべて 0 から 1 に収まる': () => {
    setSite(35.68, 139.77);
    for (let h = 0; h < 24; h += 0.25) {
      for (const w of [0, 1, 2]) {
        const want = at(h, w);
        for (const k of KEYS) {
          between(want[k] ?? 0, 0, 1, `${k}（${h} 時・天気 ${w}）`);
        }
      }
    }
  },

  'ポンプはいつでも鳴る': () => {
    setSite(35.68, 139.77);
    for (let h = 0; h < 24; h += 1) eq(at(h).pump, 1, `${h} 時のポンプ`);
  },

  '昼の蝉は昼だけ': () => {
    setSite(35.68, 139.77);
    ok(at(12).cicada > 0.8, '真昼に蝉が鳴いていない');
    ok(at(22).cicada < 0.02, '夜に蝉が鳴いている');
    ok(at(3).cicada < 0.02, '深夜に蝉が鳴いている');
  },

  '夕方の蝉は 1 時間以上の窓で鳴く': () => {
    setSite(35.68, 139.77);
    const w = windows('dusk');
    ok(w.length >= 1, '夕方の蝉が一度も鳴かない');
    const len = (w[0][1] - w[0][0]) * 60;
    ok(len >= 60, `鳴く窓が ${len.toFixed(0)} 分しかない。探し当てられない`);
    // 朝と夕の二度。太陽の高さで決めているので左右対称になる
    ok(w.length >= 2, '夕方の蝉が一度しか鳴かない。朝の同じ高さでも鳴くはず');
  },

  '夕方の蝉が鳴き出すと昼の蝉は引く': () => {
    setSite(35.68, 139.77);
    const w = windows('dusk');
    const peak = (w[0][0] + w[0][1]) / 2;
    const s = at(peak);
    ok(s.dusk > 0.6, '夕方の蝉が窓の真ん中で鳴いていない');
    ok(s.cicada < at(12).cicada * 0.5, '夕方になっても昼の蝉が引いていない');
  },

  '虫は暗くなってから': () => {
    setSite(35.68, 139.77);
    ok(at(12).insect < 0.02, '真昼に虫が鳴いている');
    ok(at(22).insect > 0.3, '夜に虫が鳴いていない');
    ok(at(3).insect > 0.8, '店じまいのあと虫だけが残っていない');
  },

  '祭囃子は提灯が点いているあいだだけ': () => {
    setSite(35.68, 139.77);
    ok(at(12).festival < 0.02, '真昼に祭囃子が鳴っている');
    ok(at(20).festival > 0.5, '宵に祭囃子が鳴っていない');
    ok(at(23).festival < 0.05, '店じまいのあとも祭囃子が鳴っている');
    ok(at(3).festival < 0.02, '深夜に祭囃子が鳴っている');
  },

  '雨の日だけ雨が鳴り、蝉は鳴かない': () => {
    setSite(35.68, 139.77);
    eq(at(12, WEATHER.CLEAR).rain, 0, '晴れの日の雨');
    eq(at(12, WEATHER.RAIN).rain, 1, '雨の日の雨');
    eq(at(12, WEATHER.RAIN).cicada, 0, '雨なのに蝉が鳴いている');
    eq(at(17, WEATHER.RAIN).dusk, 0, '雨なのに夕方の蝉が鳴いている');
  },

  '鳴る時刻を探せば必ず見つかる': () => {
    // 設定の「鳴る時刻へ」が当てにしている走査。
    // どの層も、どこかの時刻で 0.05 を超えないと、押しても何も起きない
    setSite(35.68, 139.77);
    for (const k of ['cicada', 'dusk', 'furin', 'festival', 'crowd', 'insect']) {
      let best = 0;
      for (let h = 0; h < 24; h += 1 / 12) best = Math.max(best, at(h)[k] ?? 0);
      ok(best > 0.05, `${k} はどの時刻でも鳴らない`);
    }
  },
};
