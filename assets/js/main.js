// 起動とループ。
//
// 刻み幅は 1/12 秒で頭打ちにする。タブを切り替えて戻ってきた時に
// 数秒ぶんの dt が一度に来ると、金魚が壁を突き抜けるため。
// 短く切りすぎると、描画が重い機械でゲームだけ遅回しになる。

import { Renderer } from './renderer.js?v=202610031123';
import { Game } from './game.js?v=202610031123';
import { UI } from './ui.js?v=202610031123';
import { localHour, fetchWeather, WEATHER_NAME } from './sky.js?v=202610031123';
import { Sound } from './sound.js?v=202610031123';
import { POI } from './world.js?v=202610031123';

const canvas = document.getElementById('scene');
let renderer = null;

const game = new Game();
const sound = new Sound();
game.sound = sound;

const ui = new UI({
  hour(v) { renderer?.setHour(v); },
  weather(w) { renderer?.setWeather(w); game.rain = w === 2 ? 1 : 0; },
  audio(on) { sound.setEnabled(on); if (on) sound.unlock(); },
  mix(k, v) { sound.setMix(k, v); },
  soundSource(m) { sound.setSource(m); },
  now() { applyNow(true); },
  amp(v) { renderer?.setAmp(v); },
  wind(v) { renderer?.setWind(v); },
  fft(n) { renderer?.setFftSize(n); },
  pitch(d) { renderer?.setPitch(d); },
});

// シェーダを組むのは同期処理で、機械によっては数百ミリ秒かかる。
// その間ブラウザは何も描けないので、先に覆いを 1 枚描かせてから始める。
function boot() {
  try {
    renderer = new Renderer(canvas);
    renderer.resize();
    game.ripple = renderer.ripple;
  } catch (err) {
    console.error(err);
    ui.fatal(String(err.message || err));
    throw err;
  }
  game.start();
  applyNow(false);
  requestAnimationFrame(frame);
}

/**
 * いまの時刻と天気に合わせる。
 *
 * 時刻は端末の時計なので、どこへも問い合わせない。
 * 天気だけは位置が要るので、ブラウザに許可を聞いてから引く。
 * 断られたら晴れのまま。ask が false のときは、起動直後の 1 回。
 */
function applyNow(ask) {
  const h = localHour();
  renderer.setHour(h);
  ui.setHour(h);
  ui.setWeather(renderer.weather, '現在地を確認中…');
  fetchWeather().then((w) => {
    if (w === null) {
      ui.setWeather(renderer.weather, '現在地が取れず晴れ');
      return;
    }
    renderer.setWeather(w);
    game.rain = w === 2 ? 1 : 0;
    ui.setWeather(w, `現在地（${WEATHER_NAME[w]}）`);
  });
}
// 1 フレーム待ってから組み立てる。rAF だけだと、同じフレームの中で
// 走って覆いが画面に出ないことがある
requestAnimationFrame(() => setTimeout(boot, 0));

// ---- 入力。ポインタ 1 本だけを見る ----
function toNdc(e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
}

let pointerId = null;

/**
 * 狙いを入れる。
 *
 * 指で触るときは、触った所を「柄を握っている指」として扱い、紙の輪は
 * そこから画面の奥へ柄 1 本ぶん離れた所に出す。実物と同じ持ち方であると
 * 同時に、掬おうとしている金魚が自分の指で隠れない。
 * マウスは画面を遮らないので、輪をそのまま追わせる。
 */
function aimAt(e) {
  if (!renderer) return;
  const n = toNdc(e);
  const hit = renderer.pickWater(n[0], n[1]);
  if (!hit) return;
  // 店じまいのあとは水を手でかき回すだけなので、指の所をそのまま使う
  if (e.pointerType === 'touch' && !game.closed) {
    const t = renderer.toward;
    hit[0] -= t[0] * POI.grip;
    hit[1] -= t[2] * POI.grip;
  }
  game.aim(hit);
}

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (pointerId !== null) return;
  pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  aimAt(e);
  game.press(true);
});

canvas.addEventListener('pointermove', aimAt);

const release = (e) => {
  if (pointerId !== e.pointerId) return;
  pointerId = null;
  game.press(false);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// 指を離さずにタブを離れた時に押しっぱなしで固まらないように
window.addEventListener('blur', () => { pointerId = null; game.press(false); });

window.addEventListener('resize', () => renderer?.resize());

// キーボードでも遊べるように（スペースで沈める）
window.addEventListener('keydown', (e) => {
  sound.unlock();
  if (e.code === 'Space') { e.preventDefault(); game.press(true); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { e.preventDefault(); game.press(false); }
});

// ---- ループ ----
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsShown = null;
// 最初の 1 枚が出るまでは覆いを残す。シェーダの用意が済んでいても、
// 1 フレーム目は水面の場がまだ立ち上がっていない
let warmup = 3;

/**
 * 解像度の自動調整。
 *
 * つまみで選ばせていたが、実機では「軽い」しか快適に動かないので、
 * 選ぶ意味が無かった。代わりに、出ているフレームレートを見て
 * 機械ごとにちょうどの所へ寄せる。
 * 速い機械では上げて精細に、遅い機械では下げて滑らかに。
 */
const DPR = { min: 0.5, max: 1.4, step: 1.08 };
let fpsWin = [], lastTune = 0;

function tuneResolution(now, dt) {
  fpsWin.push(dt);
  if (fpsWin.length > 90) fpsWin.shift();
  if (now - lastTune < 2000 || fpsWin.length < 60) return;
  lastTune = now;
  const sorted = [...fpsWin].sort((a, b) => a - b);
  const med = sorted[sorted.length >> 1];
  const cur = renderer.dprScale;
  // 60fps なら 16.7ms。余裕を見て 19ms を上限、13ms を下限にする
  if (med > 0.019 && cur > DPR.min) renderer.setDpr(Math.max(DPR.min, cur / DPR.step));
  else if (med < 0.013 && cur < DPR.max) renderer.setDpr(Math.min(DPR.max, cur * DPR.step));
  else return;
  fpsWin = [];
}

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 12);
  last = now;

  renderer.resize();
  game.update(dt);
  // 店じまいのあとは、貸してくれるポイがもう無い。
  // 水面をなでることだけができる
  game.closed = renderer.sun.closed > 0.6;
  sound.setScene(renderer.sun);
  renderer.render({ time: game.time, school: game.school, poi: game.poi, bowl: game.bowl });

  if (warmup > 0 && --warmup === 0) ui.ready();
  if (warmup === 0) tuneResolution(now, dt);

  fpsAcc += dt; fpsN++;
  if (fpsAcc > 0.5) {
    fpsShown = Math.round(fpsN / fpsAcc);
    fpsAcc = 0; fpsN = 0;
  }
  ui.tick(game, fpsShown);
  game.events.length = 0;

  requestAnimationFrame(frame);
}

// 手元で確かめるための窓口。描画の中身を外から覗けるようにしておく。
window.__kingyo = { get renderer() { return renderer; }, game };
