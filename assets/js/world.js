// 寸法と灯りの定数。JS 側とシェーダ側で食い違うと一番見つけにくいので、
// 数値はすべてここに集めて uniform で配る。単位はメートル。

/** 水槽。縁日の金魚すくいの舟はもっと大きいが、ポイ（直径 7cm）との
 *  比が画面の中で成り立つ大きさに寄せている。 */
export const TANK = {
  halfX: 0.45,      // 内寸の半分
  halfZ: 0.30,
  depth: 0.16,      // 水面から底まで
  rimW: 0.035,      // 縁の幅
  rimTop: 0.045,    // 水面から縁の上端まで
  outBottom: -0.21, // 外側の底（地面に接する高さ）
};

/** FFT のパッチ。舟より大きく取り、繰り返しが目に付かないようにする。
 *  長めに取るのは、コースティクスの網目を大きく出すため。
 *  短い波ばかりだと、底の模様が砂嵐のようになって水に見えない。 */
export const PATCH = 1.1;

/** 波紋の格子が覆う範囲（水槽の内寸より一回り大きく取る）。 */
export const RIPPLE_SPAN = 1.0;
export const RIPPLE_N = 256;

export const POI = {
  radius: 0.035,    // 紙の半径（直径 7cm）
  restY: 0.030,     // 待機時の高さ
  // 沈めきった高さ。金魚が泳ぐ層（下記 FISH_LAYER）より深く入れないと、
  // 紙の上に乗せようがない
  deepY: -0.112,
};

/** 金魚が泳ぐ深さの範囲。ポイの届く範囲に収めてある。 */
export const FISH_LAYER = { top: -0.026, bottom: -0.100 };

export const FISH_KINDS = [
  { name: '素赤', score: 100, weight: 1.00, chance: 0.50 },
  { name: '更紗', score: 150, weight: 1.05, chance: 0.33 },
  { name: '出目金', score: 300, weight: 1.17, chance: 0.17 },
];

/** ミドリガメ。縁日の定番。たまにしか居ない。 */
export const TURTLE = {
  name: 'ミドリガメ',
  score: 600,
  weight: 2.2,
  /** 舟に同時に居られる数 */
  max: 2,
  /** 1 匹が居なくなってから、次が入ってくるまでの目安（秒） */
  interval: 22,
};

/** 手元の器。掬った金魚はここへ入る。舟の左脇、地面の上に置く。
 *  置き場所は画面の向きから renderer が決める（uBowlPos）。 */
export const BOWL = {
  // 置き場所は画面基準で決める（renderer）。ここは画面の右方向・手前方向への量
  across: -0.628,
  toward: 0.170,
  acrossPortrait: -0.265,
  towardPortrait: 0.665,
  /** 実際のワールド座標。画面の向きが決まった時に renderer が書き込む。
   *  器の中で泳ぐ金魚はここを見る。 */
  pos: [-0.655, 0, 0.20],
  outerR: 0.100,
  innerR: 0.085,
  rimY: TANK.outBottom + 0.080,
  waterY: TANK.outBottom + 0.058,
  floorY: TANK.outBottom + 0.004,
};

/** 影の uniform 配列の長さ。金魚＋亀＋ポイが収まる数 */
export const MAX_FISH = 20;
/** 器に泳がせておく数の上限。これを超えたら古いものから引っ込める。 */
export const MAX_BOWL = 12;
