// 時刻と天気から、光を決める。
//
// 昼は太陽ひとつ。日が傾くと屋台の提灯に灯が入り、夜はそちらが主役になる。
// 宵宮は 22 時過ぎにしまうので、そこから提灯が落ちて、舟だけが暗く残る。
//
// 値はどれも線形空間。最後のトーンマップで丸める前提で、太陽は 1 を超える。

const DEG = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix = (a, b, t) => a + (b - a) * t;
const mix3 = (a, b, t) => [mix(a[0], b[0], t), mix(a[1], b[1], t), mix(a[2], b[2], t)];
const scale3 = (a, k) => [a[0] * k, a[1] * k, a[2] * k];

/**
 * 場所。既定は東京。
 *
 * 位置の許可が取れれば fetchWeather() がここを書き換える。
 * 断られたら東京のまま。日本の中なら、太陽の高さの差は
 * 緯度 1 度につき 1 度ほどなので、札幌と那覇で 17 度違う。
 */
let site = { lat: 35.68, lon: 139.77 };

export function setSite(lat, lon) {
  site = { lat, lon };
}

/** いま使っている観測地。試験と表示のために読めるようにしてある */
export function getSite() {
  return { ...site };
}

/**
 * 屋台の向き（度）。カメラの向きに対する太陽の方位差でハイライトの出方が決まる。
 *   0°  … 照り返しが水面の中央に座り、白い靄で底が見えなくなる
 *   14° … 必要な水面の傾きが約 1.5σ。きらめきが粒で散る（ここを採る）
 *   95° … 10σ。確率的に一度も起きず、水面から輝きが消える
 * カメラが回り込む縦画面では、renderer がこれにカメラの yaw を足す。
 */
const ORIENT = 14;

/** 店が閉まっている朝の時間帯。ここより前は「まだ始まっていない」 */
const DAWN = 4.6;

/**
 * 太陽の位置を、日付と場所から求める。
 *
 * 前はこれを「日の出 5:00、日の入り 18:48、南中 70 度」の決め打ちで
 * 書いていた。真夏の値なので、10 月に遊ぶと約 2 時間ずれる。
 * 実際の東京の 10/3 は 18:00 で高度 -9°（もう暗い）だが、
 * 決め打ちの模型では +12.7° で、まだ真昼のままだった。
 *
 * 太陽の赤緯と均時差から出す。どちらも通日だけで決まる近似式で、
 * 誤差は高度にして 1 度に満たない。絵を描くには十分。
 *
 * 戻り値の方位は「画面の奥」を 0 とし、右回りを正にした角度。
 */
function solarPosition(hour, when = new Date()) {
  // 通日。1 月 1 日が 1
  const day = Math.floor((when - new Date(when.getFullYear(), 0, 0)) / 86400000);

  // 赤緯。地軸の傾き 23.44 度を、冬至からの角度で振る
  const decl = -23.44 * DEG * Math.cos((2 * Math.PI * (day + 10)) / 365.25);

  // 均時差（分）。地球の軌道が楕円で、軌道面と赤道面がずれているぶん、
  // 時計の正午と太陽の南中は年に最大 16 分ずれる
  const b = (2 * Math.PI * (day - 81)) / 364;
  const eot = 9.87 * Math.sin(2 * b) - 7.53 * Math.cos(b) - 1.5 * Math.sin(b);

  // 標準時の基準となる経線。端末の時差から出すので、海外でも合う
  const meridian = (-when.getTimezoneOffset() / 60) * 15;
  // 真太陽時。これの 12 時が南中
  const solar = hour + (site.lon - meridian) / 15 + eot / 60;
  const H = (solar - 12) * 15 * DEG;      // 時角

  const lat = site.lat * DEG;
  const sinElev = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(H);
  const elev = Math.asin(Math.max(-1, Math.min(1, sinElev)));
  // 方位。北から右回りに測った角度
  const north = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(lat) - Math.tan(decl) * Math.cos(lat)) + Math.PI;
  // 南中（北から 180 度）を画面の奥に置く
  return { elev, azimFromBack: north - Math.PI };
}

/**
 * 店じまい。この時刻から提灯が落ち、1 時間かけて真っ暗になる。
 * 夏祭り・縁日は 21 時か 22 時終いが多数派なので、そこへ合わせる。
 */
const CLOSE_START = 21.0;
const CLOSE_END = 22.0;

export const WEATHER = { CLEAR: 0, CLOUDY: 1, RAIN: 2 };
export const WEATHER_NAME = ['晴れ', 'くもり', '雨'];

/**
 * 時刻（0〜24 の実数）と天気から光の条件を作る。
 *
 * 太陽の色は「大気を通る距離」の一本の量 ext で決めている。
 * 高いほど白く明るく、低いほど赤く弱い。物理的な散乱計算ではないが、
 * 昼と夕方で水の見え方がどう変わるかを見るには十分な形。
 *
 * 曇りと雨では、直射が雲で散って方向を失う。コースティクスも水面の
 * きらめきも「方向の揃った強い光」が要るので、ここが落ちると同時に消える。
 * これは手加減ではなく、曇りの日に水底の網目が出ないのと同じこと。
 */
export function sunFor(hour, yawDeg = 0, weather = WEATHER.CLEAR, when = new Date()) {
  const sp = solarPosition(hour, when);
  // 日の出前・日の入り後は負になる。そのまま使って地平線の下へ沈める
  const elev = sp.elev;
  const azim = sp.azimFromBack + (ORIENT + yawDeg) * DEG;

  const sunUp = Math.sin(elev);
  // 薄明。
  //
  // 太陽の高さで取る。+4° で昼、-10° で夜。市民薄明の終わり（-6°）で
  // 0.28 ほど残るので、空が焼けているあいだに提灯へ灯が入る。
  // そこがいちばんきれいな時間なので、暗転を急がない。
  const daylight = clamp01((sunUp + 0.174) / 0.244);
  const ext = Math.pow(Math.max(sunUp, 0.015), 0.42) * daylight;
  const night = 1 - daylight;

  // 店じまい。夜中から明け方までは「終わったあと」
  let closed = 0;
  if (hour >= CLOSE_START) closed = clamp01((hour - CLOSE_START) / (CLOSE_END - CLOSE_START));
  else if (hour < DAWN) closed = 1;
  // 提灯。暗くなると灯り、しまうと落ちる。
  //
  // night * 1.3 だと、日の入り直後（night 0.5）で既に 65% 点いていた。
  // そのせいで 17 時半と 21 時の画面の明るさがほぼ同じ（50 対 49）に
  // なっていた。実際は、空がまだ明るいうちの提灯は効かない。
  // 暗くなってから効きはじめるように、立ち上がりを遅らせる
  const lanternOn = clamp01((night - 0.22) * 1.85) * (1 - closed);

  // 天気。曇りと雨は直射が雲で散る
  const direct = weather === WEATHER.CLEAR ? 1 : weather === WEATHER.CLOUDY ? 0.16 : 0.07;
  const dull = weather === WEATHER.CLEAR ? 1 : weather === WEATHER.CLOUDY ? 0.62 : 0.44;

  // 太陽。低いほど赤く、弱くなる。
  // 値は「アルベド 0.3 の面が真上から照らされて 0.7 くらいになる」目安で、
  // 空との比が 6:1 ほど。晴れた日の実際の比（5〜10:1）に近い
  const strength = 2.45 * ext * direct;
  const sunColor = [
    1.00 * strength,
    (0.50 + 0.47 * ext) * strength,
    (0.18 + 0.78 * ext * ext) * strength,
  ];

  // 空。夕方は地平が橙に寄り、天頂は藍のまま残る
  const dim = (0.22 + 0.78 * ext) * dull;
  let zenith = [0.105 * dim, 0.205 * dim, 0.470 * (0.30 + 0.70 * ext) * dull];
  let horizon = scale3(mix3([0.66, 0.34, 0.17], [0.560, 0.635, 0.745], ext),
                       dull * (0.10 + 0.90 * daylight) + 0.02);
  // 夜空。晴れた夜は藍、曇りや雨の夜は街明かりを雲が返すのでかえって明るい
  // 夜空。晴れた夜は藍、曇りや雨の夜は街明かりを雲が返すのでかえって明るい。
  // 店がしまって提灯が落ちると、残る光はこれだけになる。月と町の明かりで
  // 物の形くらいは分かるので、その分を足しておく
  const skyNight = weather === WEATHER.CLEAR
    ? [0.0030, 0.0042, 0.0085]
    : [0.0105, 0.0085, 0.0075];
  const moon = 0.072 * closed;
  skyNight[0] += moon * 0.82; skyNight[1] += moon * 0.90; skyNight[2] += moon;
  zenith = mix3(zenith, skyNight, night);
  horizon = mix3(horizon, scale3(skyNight, 2.4), night);
  // 薄明の空。
  //
  // 太陽が地平の下へ入っても、上空はまだ日に照らされていて、
  // 月の無い夜より二桁明るい。これが無いと、日の入り直後が
  // 夜と同じ暗さになる。高度 -2° を頂点に、+6° から -10° で消える。
  const deg = elev / DEG;
  const twi = clamp01(1 - Math.pow(Math.abs(deg + 2) / 8, 1.4));
  horizon = [horizon[0] + 0.115 * twi, horizon[1] + 0.072 * twi, horizon[2] + 0.055 * twi];
  zenith = [zenith[0] + 0.020 * twi, zenith[1] + 0.028 * twi, zenith[2] + 0.052 * twi];

  // 地平線より下。明るい地面からの跳ね返りなので、思ったより明るい
  const ground = scale3([0.300 * dim, 0.285 * dim, 0.255 * dim], 1 - night * 0.92);

  return {
    hour,
    weather,
    elev,
    azim,
    // 地平線より下へは向けない。各材質が max(dot(N, dir), 0) で受けるので、
    // 強さ 0 の太陽がどこを向いていても絵は変わらない
    dir: [Math.sin(azim) * Math.cos(elev), Math.max(sunUp, 0.02), -Math.cos(azim) * Math.cos(elev)],
    sunColor,
    zenith,
    horizon,
    ground,
    // 提灯。和紙を透かした橙。
    //
    // 提灯を舟に近づけた（高さ 1.05→0.52m、左右 0.95→0.46m）ので、
    // 舟が受ける光は 1/d² で 4.2 倍になった。強さをそのままにしたら
    // 21 時の画面が平均輝度 150 まで上がって、昼（141）より明るくなった。
    // 距離が稼いだぶんをここで戻す。
    lantern: scale3([1.00, 0.52, 0.215], 0.087 * lanternOn),
    lanternOn,
    closed,
    daylight,
    direct,
    // 太陽が低いほど霞む。雨は一面に霞む
    haze: (0.55 + 1.4 * (1 - ext)) * (weather === WEATHER.RAIN ? 1.5 : 1),
    /**
     * 雲。[覆う量, 明るさ（地平の空に対する比）, 流れた量 x, 同 z]。
     *
     * 明るさだけ落として曇りにしていたら、晴れも曇りも雨も同じ
     * のっぺりした空になって、天気が画面に出ていなかった。
     * 晴れの日にも積雲は浮いているし、曇りと雨は一面の蓋になる。
     */
    cloud: [
      weather === WEATHER.CLEAR ? 0.26 : weather === WEATHER.CLOUDY ? 0.88 : 0.97,
      // 晴れの雲は日を受けて白く、雨雲は底が暗い
      weather === WEATHER.CLEAR ? 1.45 : weather === WEATHER.CLOUDY ? 0.82 : 0.54,
      // 風で流れる。1 時間に 1 枚ぶんほど
      (hour % 24) * 0.42,
      (hour % 24) * 0.17,
    ],
    // 低い太陽ほど、画面全体が暖色に転ぶ。
    // 線形だと夕方が「暗くした昼」にしかならないので、立ち上がりを早める。
    // 夜は提灯の橙がそれを引き受けるので、ここは戻す
    warmth: Math.pow(1 - ext, 0.65) * (1 - night * 0.45),
    // 画面に出す明るさ。
    //
    // 暗い時間や曇り・雨は、目が慣れるぶん持ち上げる。昼の雨を
    // 光量どおりに落とすと、ただの夕方になってしまう。
    //
    // 夜の持ち上げを 0.72 取っていたら、21 時が 16 時より明るく出ていた
    // （画面の平均輝度で 96 対 93）。提灯が点いている場所なので、
    // そのうえ目の慣れまで足すと二重になる。0.14 に削る。
    //
    // 店じまいのあとも、真っ暗にはしない。0.60 落としていたら輝度 13 で、
    // 舟の形も水も見えなかった。灯りが無いことは演出だが、
    // 何も見えないのは演出ではなく、ただ描かれていないのと同じ。
    // 曇りと雨で落とした明るさを、ここで 1.64 倍まで持ち上げ直していた。
    // それでは絵が同じ明るさに揃ってしまい、天気が画面に出てこない。
    // 戻すのは 1.46 倍までに留める（遊べる明るさは残す）
    exposure: (0.62 + 0.45 * (1 - ext) + night * 0.14 * (1 - closed))
            * (1 + (1 - dull) * 0.82 * daylight) * (1 - closed * 0.20),
  };
}

/** いまの端末の時刻。0〜24 の実数。 */
export function localHour() {
  const d = new Date();
  return d.getHours() + d.getMinutes() / 60;
}

/**
 * 現在地の天気を引く。
 *
 * 位置はブラウザの許可を取ってから取る。断られれば晴れのまま。
 * 返すのは { weather, tempC, lat, lon }。取れなければ null。
 * 外へ出ていくのは緯度経度を小数 2 桁（約 1km の粗さ）に丸めたものだけで、
 * 送り先は Open-Meteo（鍵の要らない公開 API）。遊ぶのに町より細かい
 * 精度は要らないので、丸めてから送る。
 */
export function fetchWeather() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) return resolve(null);
    let done = false;
    const finish = (v) => { if (!done) { done = true; resolve(v); } };
    setTimeout(() => finish(null), 9000);
    navigator.geolocation.getCurrentPosition(async (pos) => {
      try {
        const la = pos.coords.latitude.toFixed(2);
        const lo = pos.coords.longitude.toFixed(2);
        // 太陽の高さにも使う。日本の端から端で 17 度違う
        setSite(Number(la), Number(lo));
        const r = await fetch('https://api.open-meteo.com/v1/forecast'
          + `?latitude=${la}&longitude=${lo}`
          + '&current=weather_code,cloud_cover,temperature_2m');
        const j = await r.json();
        const w = wmoToWeather(j?.current?.weather_code, j?.current?.cloud_cover);
        if (w === null) return finish(null);
        finish({ weather: w, tempC: j?.current?.temperature_2m ?? null,
                 lat: Number(la), lon: Number(lo) });
      } catch {
        finish(null);
      }
    }, () => finish(null), { timeout: 8000, maximumAge: 1800000 });
  });
}

/** WMO の天気コードを、この絵で描き分けられる 3 つに畳む。 */
export function wmoToWeather(code, cloud) {
  if (code === undefined || code === null) return null;
  if (code >= 51) return WEATHER.RAIN;        // 霧雨・雨・雪・にわか雨・雷雨
  if (code >= 45) return WEATHER.CLOUDY;      // 霧
  if (code === 3) return WEATHER.CLOUDY;      // 曇り
  if (code >= 1) return (cloud ?? 0) > 60 ? WEATHER.CLOUDY : WEATHER.CLEAR;
  return WEATHER.CLEAR;
}

// 端末の時計に合わせる。合わなければ午後も遅い時間に落とす。
export const DEFAULT_HOUR = localHour();
