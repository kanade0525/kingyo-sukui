// 表示する言葉。日本語と英語。
//
// ブラウザの言語で決める。日本語に設定している人は日本語を読む人なので、
// 国内にいるか国外にいるかではなく、そちらを見る。位置の許可を
// 断られても最初から正しく出せる、という利点もある。
//
// 画面の文字は HTML に data-t="鍵" を振っておき、起動時に差し替える。
// コードの中から使うものは t('鍵') で引く。

export const LANG = (navigator.language || 'en').toLowerCase().startsWith('ja') ? 'ja' : 'en';

const DICT = {
  ja: {
    title: '金魚掬い',
    settings: '設定',
    soundToggle: '音の入切',
    noWebgl: 'WebGL2 が使えません',
    noWebglWhy: '別のブラウザでお試しください。',

    hLight: '光',
    hSound: '音',
    hWater: '水面',
    hView: '表示',

    time: '時刻',
    weather: '天気',
    wxClear: '晴れ',
    wxCloudy: 'くもり',
    wxRain: '雨',
    backToNow: 'いまの時刻と天気に戻す',

    here: '現在地',
    locating: '現在地を確認中…',
    noLocation: '現在地が取れず晴れ',
    manual: '手動',
    nearby: '{city}あたり',

    recLayers: '昼の蝉・風鈴・雨',
    recorded: '録音',
    synth: '合成',

    vMaster: '全体',
    vPump: 'ポンプ',
    vCicada: 'あぶらぜみ',
    vMinmin: 'みんみんぜみ',
    vDusk: '夕方のせみ',
    vFurin: '風鈴',
    vFestival: '祭囃子',
    vCrowd: 'ざわめき',
    vInsect: '虫',
    vRain: '雨',

    amp: '波の高さ',
    wind: '風速',
    fft: 'FFT 格子',

    pitch: '見下ろす角度',
    pitchLow: '浅め',
    pitchMid: '標準',
    pitchTop: '真上',
    fps: '描画速度',
  },
  en: {
    title: 'Goldfish Scooping',
    settings: 'Settings',
    soundToggle: 'Sound on/off',
    noWebgl: 'WebGL2 is not available',
    noWebglWhy: 'Please try a different browser.',

    hLight: 'Light',
    hSound: 'Sound',
    hWater: 'Water',
    hView: 'View',

    time: 'Time',
    weather: 'Weather',
    wxClear: 'Clear',
    wxCloudy: 'Cloudy',
    wxRain: 'Rain',
    backToNow: 'Back to the time and weather here',

    here: 'Your location',
    locating: 'Finding your location…',
    noLocation: 'No location — showing clear',
    manual: 'set by hand',
    nearby: 'near {city}',

    recLayers: 'Cicada, chime, rain',
    recorded: 'Recorded',
    synth: 'Synthesized',

    vMaster: 'Overall',
    vPump: 'Air pump',
    vCicada: 'Cicada (day)',
    vMinmin: 'Minmin cicada',
    vDusk: 'Cicada (dusk)',
    vFurin: 'Wind chime',
    vFestival: 'Festival music',
    vCrowd: 'Crowd',
    vInsect: 'Crickets',
    vRain: 'Rain',

    amp: 'Wave height',
    wind: 'Wind speed',
    fft: 'FFT grid',

    pitch: 'Camera angle',
    pitchLow: 'Low',
    pitchMid: 'Normal',
    pitchTop: 'Overhead',
    fps: 'Frame rate',
  },
};

/** 言葉を引く。鍵が無ければ日本語に落ちる */
export function t(key, vars) {
  let s = DICT[LANG][key] ?? DICT.ja[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replace(`{${k}}`, v);
  return s;
}

export const WEATHER_LABEL = [t('wxClear'), t('wxCloudy'), t('wxRain')];

/** HTML に振った data-t を差し替える。起動時に 1 回だけ呼ぶ */
export function applyI18n(root = document) {
  for (const el of root.querySelectorAll('[data-t]')) el.textContent = t(el.dataset.t);
  for (const el of root.querySelectorAll('[data-t-aria]')) {
    el.setAttribute('aria-label', t(el.dataset.tAria));
    el.setAttribute('title', t(el.dataset.tAria));
  }
  document.documentElement.lang = LANG;
  document.title = t('title');
}
