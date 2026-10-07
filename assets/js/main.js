// 起動とループ。
//
// 刻み幅は 1/12 秒で頭打ちにする。タブを切り替えて戻ってきた時に
// 数秒ぶんの dt が一度に来ると、金魚が壁を突き抜けるため。
// 短く切りすぎると、描画が重い機械でゲームだけ遅回しになる。

import { Renderer } from './renderer.js?v=202610070355';
import { Game } from './game.js?v=202610070355';
import { UI } from './ui.js?v=202610070355';
import { localHour, fetchWeather, sunFor, CLOSE_START } from './sky.js?v=202610070355';
import { applyI18n, t, WEATHER_LABEL } from './i18n.js?v=202610070355';
import { Sound, layerWants } from './sound.js?v=202610070355';
import { POI } from './world.js?v=202610070355';
import { nearestCity } from './place.js?v=202610070355';
import { Home } from './home.js?v=202610070355';
import { HOME, MAX_BOWL, ZOOM } from './world.js?v=202610070355';

// 言葉をいちばん先に差し替える。覆いの題字も見えてしまうので
applyI18n();

const canvas = document.getElementById('scene');
let renderer = null;

const game = new Game();
// 家の鉢。持ち帰った金魚はこの端末に残る
const home = new Home();

/**
 * いま見ている画面。
 *
 * ルータは作らない。location.hash の二値で足りるし、こうしておくと
 * ブックマーク・再読み込み・ブラウザの戻るがただで効く。
 */
let view = location.hash === '#home' ? 'home' : 'stall';
const sound = new Sound();
game.sound = sound;

const ui = new UI({
  hour(v, fromCode) {
    // 人が掴んだら、そこからは時計に追従しない
    if (!fromCode) manualHour = true;
    renderer?.setHour(v);
    showNow();
  },
  weather(w) {
    manualWeather = true;
    renderer?.setWeather(w);
    game.rain = w === 2 ? 1 : 0;
    // 設定の帯と、下の並びの札の両方を合わせる
    ui.setWeather(w, t('manual'));
    // 空の色が変わるので、帯も引き直す
    drawDayStrip();
    showNow();
  },
  audio(on) { sound.setEnabled(on); if (on) sound.unlock(); },
  mix(k, v) { sound.setMix(k, v); },
  soundSource(m) { sound.setSource(m); },
  now() { manualHour = false; manualWeather = false; applyNow(true); },
  takeHome() { takeHome(); },
  lamp(on) { renderer?.setLamp(on); },
  zoom(dir) { renderer?.zoomBy(dir > 0 ? ZOOM.step : 1 / ZOOM.step); },
  viewReset() { if (renderer) { renderer.zoom = 1; renderer.orbit = { x: 0, y: 0 }; } },
  jumpTo(key) { jumpToLayer(key); },
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
  ui.setView(view);
  renderer.setView(view);
  applyNow(false);
  drawDayStrip();
  requestAnimationFrame(frame);
}

/**
 * 時刻の帯に、その日の空の色を敷く。
 *
 * つまみだけだと、どこが昼でどこが夜か動かすまで分からない。
 * 同じ sunFor から色を引いているので、帯の色と画面の色は必ず一致する。
 * 提灯が点く時刻は、空の明るさから決まるので毎日ずれる。走査して拾う。
 */
function drawDayStrip() {
  const stops = [];
  let lantern = 18;
  for (let i = 0; i <= 48; i++) {
    const h = (i / 48) * 24;
    const s = sunFor(h, 0, renderer.weather);
    // 帯は小さいので、空の地平の色をそのまま使うといちばん読みやすい
    const k = 255 / Math.max(...s.horizon, 0.28);
    stops.push(`rgb(${s.horizon.map((c) => Math.round(Math.min(c * k, 255))).join(',')})`);
    if (lantern === 18 && h > 12 && s.lanternOn > 0.5) lantern = h;
  }
  ui.setDayStrip(stops, { lantern, close: CLOSE_START });
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
  ui.setWeather(renderer.weather, t('locating'), true);
  showNow();
  fetchWeather().then((r) => {
    if (r === null) {
      ui.setWeather(renderer.weather, t('noLocation'), true);
      showNow();
      return;
    }
    here = { tempC: r.tempC, city: nearestCity(r.lat, r.lon) };
    if (!manualWeather) {
      renderer.setWeather(r.weather);
      game.rain = r.weather === 2 ? 1 : 0;
      ui.setWeather(r.weather, `${t('here')} · ${WEATHER_LABEL[r.weather]}`, !manualWeather);
    }
    showNow();
  });
}

// ---- 画面右上の札 ----
//
// 季節でも場所でも日の暮れ方は変わる。その計算がいまどの条件で
// 回っているのかを出しておかないと、絵が実際とつながっていることが
// 伝わらない。人が時刻や天気を掴んだときは、そう分かるようにする。
let manualHour = false;
let manualWeather = false;
let here = { tempC: null, city: null };

function showNow() {
  if (!renderer) return;
  const bar = document.getElementById('nowbar');
  const h = renderer.hour;
  const hh = Math.floor(h);
  const mm = Math.round((h - hh) * 60);
  document.getElementById('nowPlace').textContent =
    here.city ? t('nearby', { city: here.city }) : t('here');
  const deg = here.tempC === null ? '' : ` · ${Math.round(here.tempC)}℃`;
  document.getElementById('nowSky').textContent = WEATHER_LABEL[renderer.weather] + deg;
  const el = document.getElementById('nowTime');
  el.textContent = `${String(hh).padStart(2, '0')}:${String(mm).padStart(2, '0')}`;
  el.classList.toggle('manual', manualHour);

  // いまの時刻と天気を映していることを、札の先頭に明記する。
  // 場所も天気も気温も時刻も出してはいたが、それが「あなたのいる所の、
  // いまの様子」だとは書いていなかった。人が手で動かしたら言い換える
  const hand = manualHour || manualWeather;
  const what = document.getElementById('nowWhat');
  what.textContent = t(hand ? 'setByHand' : 'liveNow');
  what.classList.toggle('manual', hand);

  // want は毎コマ更新されるが、つまみを動かした直後はまだ古い。
  // ここで引き直してから反映する
  sound.setScene(renderer.sun);
  ui.setLayerState(sound.want);
  bar.hidden = false;
}

/**
 * その音がいちばん鳴る条件へ飛ぶ。
 *
 * 夕方の蝉は日が低いあいだの 76 分しか鳴らない。鳴る時刻が
 * 画面のどこにも出ていないと、探し当てるまで一度も聞けない。
 */
function jumpToLayer(key) {
  if (!renderer) return;
  if (key === 'rain') {
    manualWeather = true;
    renderer.setWeather(2);
    game.rain = 1;
    ui.setWeather(2, t('manual'));
    showNow();
    return;
  }
  // 天気はいまのまま 24 時間ぶん走査する。それで鳴らないなら、
  // 雨が邪魔をしているので晴れにして引き直す
  const scan = (w) => {
    let best = { h: 0, v: -1 };
    for (let h = 0; h < 24; h += 1 / 12) {
      const v = layerWants(sunFor(h, 0, w))[key] ?? 0;
      if (v > best.v) best = { h, v };
    }
    return best;
  };
  let best = scan(renderer.weather);
  if (best.v < 0.05 && renderer.weather === 2) {
    manualWeather = true;
    renderer.setWeather(0);
    game.rain = 0;
    ui.setWeather(0, t('manual'));
    best = scan(0);
  }
  if (best.v < 0.05) return;
  manualHour = true;
  // つまみの刻みに合わせる
  const h = Math.round(best.h * 4) / 4;
  renderer.setHour(h);
  ui.setHour(h);
  showNow();
}

/**
 * 器の金魚を持ち帰る。
 *
 * 先に保存して、そのあとで退場を見せる。「書けたから消えた」の順に
 * しないと、保存に失敗したときに金魚だけ消える。
 */
function takeHome() {
  if (!game.bowl.length) return;
  if (home.full) { ui.toast(t('homeFull'), 3200); return; }
  const caught = game.takeHome();          // 器から値を抜く（絵はまだ残る）
  const n = home.add(caught);              // ここで保存する
  ui.toast(t('tookHome', { n }));
  // 持ち帰ったら家へ移る。袋を提げて帰ったことになる
  setTimeout(() => { location.hash = '#home'; }, 900);
}

/** 画面を切り替える */
let viewHintShown = false;

function setView(next) {
  if (view === next) return;
  view = next;
  ui.setView(view);
  if (renderer) renderer.setView(view);
  sound.setPlace(view);
  // なぞる・つまむは画面に書いていないと気付かれない。最初の一度だけ出す
  if (view === 'home' && !viewHintShown) {
    viewHintShown = true;
    ui.toast(t('viewHint'), 4200);
  }
}

window.addEventListener('hashchange', () => {
  setView(location.hash === '#home' ? 'home' : 'stall');
});

// 時計に追従する。人が時刻を掴んでいるあいだは動かさない
setInterval(() => {
  if (renderer && !manualHour) {
    const h = localHour();
    renderer.setHour(h);
    ui.setHour(h);
  }
  showNow();
}, 30000);
/**
 * 試験から中を覗くための口。
 *
 * ?test=1 を付けたときだけ開く。絵の画素を読んで当てにいくと、
 * 波も金魚も動いているので判定が揺れる。中の値を直に見られるほうが、
 * 試験が何を確かめているのかもはっきりする。
 * 普段の読み込みでは何も生えない。
 */
if (new URLSearchParams(location.search).has('test')) {
  window.__kingyo = {
    get sun() { return renderer?.sun; },
    get want() { return { ...sound.want }; },
    get weather() { return renderer?.weather; },
    get hour() { return renderer?.hour; },
    get portrait() { return renderer?.portrait; },
    get poi() {
      const p = game.poi;
      return { x: p.x, y: p.y, z: p.z, health: p.health, broke: p.broke, visible: p.visible };
    },
    get fish() { return game.school.list.filter((f) => !f.gone).length; },
    get bowl() { return game.bowl.length; },
    get clips() { return Object.keys(sound.buffers); },
    /** 層ごとに、いま鳴らしたい量 */
    get layers() { return { ...sound.want }; },
    get closed() { return game.closed; },
    get rainDrops() { return game.rainDrops.map((d) => ({ x: d.x, z: d.z, t: d.t })); },
    get view() { return view; },
    get home() {
      return home.list.map((f) => ({ kind: f.kind, turtle: f.turtle, len: f.len }));
    },
    get stored() { try { return localStorage.getItem('kingyo.home'); } catch { return null; } },
    get bowlFull() { return game.bowlFull; },
    /** 家の鉢への寄り。1.0 がちょうど収まる位置 */
    get zoom() { return renderer?.zoom ?? 1; },
    /** 家の鉢の水面に落ちた雨粒の数 */
    get jarRainHits() { return renderer?.jarRainHits ?? 0; },
    /** 画面の座標を、水面の上のワールド座標へ直す */
    pick(nx, ny) { return renderer?.pickWater(nx, ny); },
    // 手元で確かめるとき、中身をそのまま触れるように
    get renderer() { return renderer; },
    get game() { return game; },
    get homeTank() { return home; },
  };
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

/**
 * 家の鉢を指で回す。
 *
 * 縁側に座って首を振るくらいの範囲（左右 ±60 度・上下 8〜70 度）に
 * 限ってある。後ろへ回り込めないので、背景は正面から側面までしか
 * 作らなくて済む。範囲を丸めるのは world.js の jarView。
 */
let drag = null;

/**
 * つまんでいる指。家でだけ二本まで数える。
 *
 * 一本なら回す、二本触れたら寄る。屋台は一本しか使わないので、
 * これまでどおり pointerId 一つで足りる
 */
const touches = new Map();
let pinch = null;

const spread = () => {
  const [a, b] = [...touches.values()];
  return Math.hypot(a.x - b.x, a.y - b.y);
};

canvas.addEventListener('pointerdown', (e) => {
  sound.unlock();
  if (view === 'home') {
    canvas.setPointerCapture(e.pointerId);
    touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (touches.size === 2) {
      // つまみ始め。この時の指の間隔と寄りを覚えておく
      pinch = { d0: spread(), z0: renderer.zoom };
      drag = null;
    } else if (touches.size === 1) {
      drag = { x: e.clientX, y: e.clientY, ox: renderer.orbit.x, oy: renderer.orbit.y };
    }
    return;
  }
  if (pointerId !== null) return;
  pointerId = e.pointerId;
  canvas.setPointerCapture(e.pointerId);
  aimAt(e);
  game.press(true);
});

canvas.addEventListener('pointermove', (e) => {
  if (view === 'home') {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && touches.size === 2) {
      // 指を広げるほど近づく。間隔の比をそのまま寄りの比にする
      const d = spread();
      if (d > 4) renderer.setZoom(pinch.z0 * (pinch.d0 / d));
      return;
    }
    if (!drag) return;
    const r = canvas.getBoundingClientRect();
    // 画面の 7 割をなぞると端まで回る。全幅にすると鈍く感じる
    renderer.orbit = {
      x: clamp1(drag.ox + (e.clientX - drag.x) / (r.width * 0.7)),
      y: clamp1(drag.oy + (e.clientY - drag.y) / (r.height * 0.7)),
    };
    return;
  }
  aimAt(e);
});

// 車輪でも寄れる。机の上ではこちらが普通
canvas.addEventListener('wheel', (e) => {
  if (view !== 'home') return;
  e.preventDefault();
  renderer.zoomBy(e.deltaY > 0 ? 1.12 : 1 / 1.12);
}, { passive: false });

const clamp1 = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);

const release = (e) => {
  if (touches.delete(e.pointerId)) {
    // つまみを解いたあと、残った指で回し始めないように持ち直す
    pinch = null;
    const left = [...touches.entries()][0];
    drag = left
      ? { x: left[1].x, y: left[1].y, ox: renderer.orbit.x, oy: renderer.orbit.y }
      : null;
  }
  if (pointerId !== e.pointerId) return;
  pointerId = null;
  drag = null;
  game.press(false);
};
canvas.addEventListener('pointerup', release);
canvas.addEventListener('pointercancel', release);

// 指を離さずにタブを離れた時に押しっぱなしで固まらないように
window.addEventListener('blur', () => {
  pointerId = null; game.press(false);
  touches.clear(); pinch = null; drag = null;
});

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
let layerTick = 0;
let homeTime = 0;

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
  // 店じまいのあとは、貸してくれるポイがもう無い。
  // 水面をなでることだけができる
  game.closed = renderer.sun.closed > 0.6;
  sound.setScene(renderer.sun);
  // 鳴っている層の表示を 1 秒に 4 回ほど更新する。
  // コマ数で間引くと、描画の遅い機械でそのぶん遅れるので、時間で間引く
  layerTick += dt;
  if (layerTick >= 0.25) { layerTick = 0; ui.setLayerState(sound.want); }

  if (view === 'home') {
    // 家では FFT も舟の波紋も回さない。眺めるだけの画面に、
    // いちばん重い計算を置く理由がない
    homeTime += dt;
    home.update(dt, homeTime);
    renderer.renderHome({ time: homeTime, fish: home.list });
    ui.setHome(home.list.length, HOME.fit, home.full);
    ui.setLampVisible(renderer.sun.daylight < 0.55);
  } else {
    game.update(dt);
    renderer.render({ time: game.time, school: game.school, poi: game.poi,
                      bowl: game.bowlView, rainDrops: game.rainDrops });
    ui.setBowl(game.closed ? 0 : game.bowl.length, game.bowlFull);
  }

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

