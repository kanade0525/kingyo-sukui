// 起動とループ。
//
// 刻み幅は 1/12 秒で頭打ちにする。タブを切り替えて戻ってきた時に
// 数秒ぶんの dt が一度に来ると、金魚が壁を突き抜けるため。
// 短く切りすぎると、描画が重い機械でゲームだけ遅回しになる。

import { Renderer } from './renderer.js?v=202610020652';
import { Game, PHASE } from './game.js?v=202610020652';
import { UI } from './ui.js?v=202610020652';
import { Sound } from './sound.js?v=202610020652';

const canvas = document.getElementById('scene');
const sound = new Sound();
let renderer = null;

const game = new Game(sound);

const ui = new UI({
  start() {
    sound.unlock();
    game.start();
    ui.resetMeters();
    ui.enterPlay();
  },
  hour(v) { renderer?.setHour(v); },
  amp(v) { renderer?.setAmp(v); },
  wind(v) { renderer?.setWind(v); },
  fft(n) { renderer?.setFftSize(n); },
  dpr(d) { renderer?.setDpr(d); },
  msaa(on) { renderer?.setMsaa(on); },
  pitch(d) { renderer?.setPitch(d); },
  audio(on) { sound.setEnabled(on); },
});

try {
  renderer = new Renderer(canvas);
  renderer.resize();
  game.ripple = renderer.ripple;
} catch (err) {
  console.error(err);
  ui.fatal(String(err.message || err));
  throw err;
}

// ---- 入力。ポインタ 1 本だけを見る ----
function toNdc(e) {
  const r = canvas.getBoundingClientRect();
  return [((e.clientX - r.left) / r.width) * 2 - 1, 1 - ((e.clientY - r.top) / r.height) * 2];
}

let pointerId = null;

canvas.addEventListener('pointerdown', (e) => {
  if (pointerId !== null) return;
  pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  sound.unlock();
  const n = toNdc(e);
  game.aim(renderer.pickWater(n[0], n[1]));
  game.press(true);
});

canvas.addEventListener('pointermove', (e) => {
  const n = toNdc(e);
  game.aim(renderer.pickWater(n[0], n[1]));
});

const release = (e) => {
  if (pointerId !== e.pointerId) return;
  pointerId = null;
  game.press(false);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// 指を離さずにタブを離れた時に押しっぱなしで固まらないように
window.addEventListener('blur', () => { pointerId = null; game.press(false); });

window.addEventListener('resize', () => renderer.resize());

// キーボードでも遊べるように（スペースで沈める）
window.addEventListener('keydown', (e) => {
  if (e.code === 'Space') { e.preventDefault(); game.press(true); }
});
window.addEventListener('keyup', (e) => {
  if (e.code === 'Space') { e.preventDefault(); game.press(false); }
});

// ---- ループ ----
let last = performance.now();
let fpsAcc = 0, fpsN = 0, fpsShown = null;
let wasPhase = game.phase;

function frame(now) {
  const dt = Math.min((now - last) / 1000, 1 / 12);
  last = now;

  renderer.resize();
  game.update(dt);
  renderer.render({ time: game.time, school: game.school, poi: game.poi, bowl: game.bowl });

  if (game.phase !== wasPhase) {
    if (game.phase === PHASE.OVER) ui.enterOver(game);
    wasPhase = game.phase;
  }
  if (game.phase === PHASE.PLAY) {
    fpsAcc += dt; fpsN++;
    if (fpsAcc > 0.5) {
      fpsShown = Math.round(fpsN / fpsAcc);
      fpsAcc = 0; fpsN = 0;
    }
    ui.tick(game, fpsShown);
  }
  game.events.length = 0;

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);

// 手元で確かめるための窓口。描画の中身を外から覗けるようにしておく。
window.__kingyo = { renderer, game };
