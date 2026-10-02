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
/** 屋台の向き（度）。太陽の照り返しを画面の中央から外すために回してある。 */
const ORIENT = 95;

/** 南中高度。日本の夏の昼ごろ。 */
const NOON_ELEV = 70 * DEG;

/**
 * 時刻（0〜24 の実数）から光の条件を作る。
 *
 * 太陽の色は「大気を通る距離」の一本の量 ext で決めている。
 * 高いほど白く明るく、低いほど赤く弱い。物理的な散乱計算ではないが、
 * 昼と夕方で水の見え方がどう変わるかを見るには十分な形。
 */
export function sunFor(hour) {
  const t = clamp01((hour - SUNRISE) / (SUNSET - SUNRISE));
  const elev = Math.sin(Math.PI * t) * NOON_ELEV;
  // 東から西へ。ORIENT は屋台の向き。
  // これを 0 にすると、ほぼ真上から覗く構図では太陽の照り返しが
  // そのまま水面の真ん中に座り、白い靄で底が見えなくなる
  const azim = (-75 + 150 * t + ORIENT) * DEG;

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

  // 空。夕方は地平が橙に寄る
  const dim = 0.22 + 0.78 * ext;
  const zenith = [0.105 * dim, 0.205 * dim, 0.470 * (0.30 + 0.70 * ext)];
  const horizon = mix3([0.66, 0.34, 0.17], [0.560, 0.635, 0.745], ext);
  const ground = [0.205 * dim, 0.190 * dim, 0.160 * dim];

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
    haze: 0.55 + 0.9 * (1 - ext),
    // 画面に出す明るさ。夕方は少し持ち上げないと沈む
    exposure: 0.62 + 0.45 * (1 - ext),
  };
}

export const DEFAULT_HOUR = 13.0;
