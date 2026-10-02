// 時刻から、太陽と空を決める。
//
// 光源を提灯の群れから太陽ひとつに変えた。方向の揃った強い光が無いと、
// 水底のコースティクスも水面のきらめきも芯が出ない。
//
// 時刻を引数に取る形にしてあるのは、後で夕方や実時刻へ差し替えるため。
// 値はどれも線形空間。最後のトーンマップで丸める前提で、太陽は 1 を超える。

const DEG = Math.PI / 180;
const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** 日の出と日の入り。夏の縁日なので長め。 */
const SUNRISE = 5.0;
const SUNSET = 18.8;
/**
 * 屋台の向き（度）。カメラの向きに対する太陽の方位差でハイライトの出方が決まる。
 *   0°  … 照り返しが水面の中央に座り、白い靄で底が見えなくなる
 *   14° … 必要な水面の傾きが約 1.5σ。きらめきが粒で散る（ここを採る）
 *   95° … 10σ。確率的に一度も起きず、水面から輝きが消える
 * カメラが回り込む縦画面では、renderer がこれにカメラの yaw を足す。
 */
const ORIENT = 14;

/** 南中高度。日本の夏の昼ごろ。 */
const NOON_ELEV = 70 * DEG;

/**
 * 時刻（0〜24 の実数）から光の条件を作る。
 *
 * 太陽の色は「大気を通る距離」の一本の量 ext で決めている。
 * 高いほど白く明るく、低いほど赤く弱い。物理的な散乱計算ではないが、
 * 昼と夕方で水の見え方がどう変わるかを見るには十分な形。
 */
export function sunFor(hour, yawDeg = 0) {
  const t = clamp01((hour - SUNRISE) / (SUNSET - SUNRISE));
  const elev = Math.sin(Math.PI * t) * NOON_ELEV;
  // 東から西へ。ORIENT は屋台の向き。
  // これを 0 にすると、ほぼ真上から覗く構図では太陽の照り返しが
  // そのまま水面の真ん中に座り、白い靄で底が見えなくなる
  const azim = (-75 + 150 * t + ORIENT + yawDeg) * DEG;

  const h = Math.max(Math.sin(elev), 0.015);
  const ext = Math.pow(h, 0.42);               // 大気の厚みによる減衰

  // 太陽。低いほど赤く、弱くなる。
  // 値は「アルベド 0.3 の面が真上から照らされて 0.7 くらいになる」目安で、
  // 空との比が 6:1 ほど。晴れた日の実際の比（5〜10:1）に近い
  const strength = 2.45 * ext;
  const sunColor = [
    1.00 * strength,
    (0.50 + 0.47 * ext) * strength,
    (0.18 + 0.78 * ext * ext) * strength,
  ];

  // 空。夕方は地平が橙に寄り、天頂は藍のまま残る
  const dim = 0.22 + 0.78 * ext;
  const zenith = [0.105 * dim, 0.205 * dim, 0.470 * (0.30 + 0.70 * ext)];
  const horizon = mix3([0.66, 0.34, 0.17], [0.560, 0.635, 0.745], ext);
  // 地平線より下。明るい地面からの跳ね返りなので、思ったより明るい
  const ground = [0.300 * dim, 0.285 * dim, 0.255 * dim];

  return {
    hour,
    elev,
    azim,
    dir: [Math.sin(azim) * Math.cos(elev), Math.sin(elev), -Math.cos(azim) * Math.cos(elev)],
    sunColor,
    zenith,
    horizon,
    ground,
    // 太陽が低いほど霞む
    haze: 0.55 + 1.4 * (1 - ext),
    // 低い太陽ほど、画面全体が暖色に転ぶ。
    // 線形だと夕方が「暗くした昼」にしかならないので、立ち上がりを早める
    warmth: Math.pow(1 - ext, 0.65),
    // 画面に出す明るさ。夕方は少し持ち上げないと沈む
    exposure: 0.62 + 0.45 * (1 - ext),
  };
}

// 午後も遅い時間。影が伸びて、光が暖色に転ぶ。
// 真昼の真上からの光は、きれいではあるが平板になる。
export const DEFAULT_HOUR = 14.6;
