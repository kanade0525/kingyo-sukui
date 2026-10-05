// 画面の文字まわり。DOM を触るのはこのファイルだけにする。

import { t } from './i18n.js?v=202610052307';
//
// innerHTML は使わない。数字は textContent で差し替えるだけなので、
// そのほうが速いし、文字列の組み立てで事故らない。

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.el = {
      fps: $('fps'), hourOut: $('hourOut'), wxNote: $('wxNote'), srcNote: $('srcNote'),
      loading: $('loading'),
      panel: $('panel'), btnPanel: $('btnPanel'),
      fallback: $('fallback'), fallbackWhy: $('fallbackWhy'),
      btnTakeHome: $('btnTakeHome'), btnHome: $('btnHome'), btnStall: $('btnStall'), btnLamp: $('btnLamp'),
      homebar: $('homebar'), homeCount: $('homeCount'), toast: $('toast'),
      viewpad: $('viewpad'),
      btnZoomIn: $('btnZoomIn'), btnZoomOut: $('btnZoomOut'), btnViewReset: $('btnViewReset'),
    };


    // URL バーの出入りや回転で、見えている高さが変わる
    const refit = () => { if (!this.el.panel.hidden) this.fitPanel(); };
    window.visualViewport?.addEventListener('resize', refit);
    window.visualViewport?.addEventListener('scroll', refit);
    window.addEventListener('orientationchange', () => setTimeout(refit, 250));

    this.el.btnTakeHome.addEventListener('click', () => handlers.takeHome());

    // 寄りと向き。押すたび一段ずつ動かす。
    // なぞる・つまむだけだと、触れると分かる手掛かりが画面に無い
    this.el.btnZoomIn.addEventListener('click', () => handlers.zoom(-1));
    this.el.btnZoomOut.addEventListener('click', () => handlers.zoom(1));
    this.el.btnViewReset.addEventListener('click', () => handlers.viewReset());

    this.el.btnLamp.addEventListener('click', () => {
      const on = this.el.btnLamp.getAttribute('aria-pressed') !== 'true';
      this.el.btnLamp.setAttribute('aria-pressed', String(on));
      handlers.lamp(on);
    });

    this.el.btnPanel.addEventListener('click', () => {
      const open = this.el.panel.hidden;
      this.el.panel.hidden = !open;
      this.el.btnPanel.setAttribute('aria-expanded', String(open));
      // 右上の札はパネルの上に重なる。開いているあいだは引っ込める
      document.documentElement.classList.toggle('panel-open', open);
      if (open) this.fitPanel();
    });

    this.#range('hour', 'hourOut', (v, fromCode) => {
      handlers.hour(v, fromCode);
      const h = Math.floor(v);
      return `${String(h).padStart(2, '0')}:${String(Math.round((v - h) * 60)).padStart(2, '0')}`;
    });
    this.#range('amp', 'ampOut', (v) => {
      const a = v / 100;
      handlers.amp(a);
      return a.toFixed(2);
    });
    this.#range('wind', 'windOut', (v) => {
      const w = v / 100;
      handlers.wind(w);
      return `${w.toFixed(2)} m/s`;
    });
    this.#seg('segWx', 'w', (v) => {
      handlers.weather(Number(v));
      this.el.wxNote.textContent = t('manual');
      return null;
    });
    // 音の入切。画面に出しておく
    $('btnSound').addEventListener('click', () => {
      const b = $('btnSound');
      const on = b.getAttribute('aria-pressed') !== 'true';
      b.setAttribute('aria-pressed', String(on));
      handlers.audio(on);
    });
    this.#seg('segSrc', 's', (v) => {
      handlers.soundSource(v);
      this.el.srcNote.textContent = t(v === 'rec' ? 'recorded' : 'synth');
    });
    // 音の調整つまみ。層ごとに動かせる
    for (const k of ['master','pump','cicada','dusk','furin',
                     'festival','crowd','insect','rain']) {
      this.#range('v_' + k, 'o_' + k, (v) => { handlers.mix(k, v / 100); return String(Math.round(v)); });
    }

    // いまの時刻と天気では鳴らない層に印を付ける。
    //
    // 雨のつまみは、晴れている間はいくら動かしても何も変わらない。
    // それが画面から分からないと、動かしても効かないつまみに見える。
    // 全体とポンプはいつでも鳴るので、印の対象から外す。
    this.mutes = {};
    for (const k of ['cicada','dusk','furin','festival','crowd','insect','rain']) {
      const row = $('v_' + k).closest('.row');
      // 押すと、その音が鳴る条件へ飛ぶ。
      // 「いつ鳴るのか」が分からないと、つまみを動かしても手応えが無い
      const mark = document.createElement('button');
      mark.type = 'button';
      mark.className = 'mute';
      mark.hidden = true;
      mark.addEventListener('click', () => handlers.jumpTo(k));
      row.querySelector('.rl').insertBefore(mark, row.querySelector('.rl').lastElementChild);
      this.mutes[k] = { row, mark };
    }
    $('btnNow').addEventListener('click', () => handlers.now());

    this.#seg('segFFT', 'n', (v) => {
      handlers.fft(Number(v));
      $('fftOut').textContent = `${v}²`;
    });
    this.#seg('segPitch', 'p', (v) => {
      handlers.pitch(Number(v));
      $('pitchOut').textContent =
        t({ 55: 'pitchLow', 65: 'pitchMid', 87: 'pitchTop' }[v] ?? String(v));
    });
  }

  #range(id, outId, fn) {
    const el = $(id), out = $(outId);
    // fromCode は「画面の外から動かした」印。人が掴んだのか、
    // 時計に追従して動いたのかを、受け取る側で区別できるようにする
    const apply = (e) => { out.textContent = fn(Number(el.value), e?.fromCode === true); };
    el.addEventListener('input', apply);
    apply({ fromCode: true });
  }

  #seg(id, attr, fn) {
    const box = $(id);
    box.addEventListener('click', (e) => {
      const b = e.target.closest('button');
      if (!b) return;
      for (const other of box.querySelectorAll('button')) {
        other.setAttribute('aria-pressed', String(other === b));
      }
      fn(b.dataset[attr]);
    });
  }

  fatal(message) {
    this.el.fallback.hidden = false;
    this.el.loading.hidden = true;
    document.getElementById('botbar').hidden = true;
    if (message) this.el.fallbackWhy.textContent = message;
  }

  /** 時刻のつまみを外から動かす。 */
  setHour(h) {
    const el = $('hour');
    el.value = String(h);
    const ev = new Event('input');
    ev.fromCode = true;
    el.dispatchEvent(ev);
  }

  /** 天気の選択を外から切り替える。note は出どころ（現在地／手動）。 */
  setWeather(w, note) {
    for (const b of $('segWx').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.w) === w));
    }
    if (note) this.el.wxNote.textContent = note;
  }

  /**
   * いま鳴っている層を画面に反映する。want は Sound.want。
   * 0 に近い層は薄く落として「いまは鳴らない」と添える。
   */
  setLayerState(want) {
    if (!this.mutes) return;
    for (const [k, { row, mark }] of Object.entries(this.mutes)) {
      const off = (want[k] ?? 0) < 0.02;
      row.classList.toggle('off', off);
      mark.hidden = !off;
      if (off && !mark.textContent) {
        mark.textContent = `${t('silentNow')} · ${t(k === 'rain' ? 'makeRain' : 'jumpTime')}`;
      }
    }
  }

  /**
   * 設定の高さを、いま見えている範囲に合わせる。
   *
   * CSS の dvh でだいたい合うが、iOS の Safari は URL バーの出入りで
   * 見える高さが変わるうえ、position:fixed はレイアウト側の座標に貼り付く。
   * visualViewport は「いま目に入っている範囲」そのものなので、
   * そこから直に入れるのがいちばん確か。
   *
   * 開いているあいだ、バーが出入りするたびに呼ぶ。
   */
  fitPanel() {
    const vv = window.visualViewport;
    if (!vv) return;                      // 知らないブラウザは CSS に任せる
    const pad = 96;                       // 下の操作列と上下の余白ぶん
    this.el.panel.style.maxHeight = `${Math.max(Math.round(vv.height) - pad, 160)}px`;
  }

  /**
   * 画面を切り替える。
   *
   * 屋台と家で、出す操作が違う。DOM を触るのはこのファイルだけ、という
   * 決まりがあるので、出し入れは全部ここに集める。
   */
  setView(view) {
    const home = view === 'home';
    this.el.homebar.hidden = !home;
    this.el.btnHome.hidden = home;
    // 家からの戻り道。これが無いと、ブラウザの戻るしか手が無い
    this.el.btnStall.hidden = !home;
    // 寄りと向きの操作。屋台では使わない
    this.el.viewpad.hidden = !home;
    if (home) this.el.btnTakeHome.hidden = true;
    if (!home) { this.el.btnLamp.hidden = true; this.lampShown = false; }
    // 水面の設定は家では効かない。「いまは鳴らない」の印と同じ考えで、
    // 動かしても何も起きないつまみを出しておかない
    for (const sec of this.#waterRows()) sec.hidden = home;
  }

  /** 設定の「水面」の節（見出しと、その下の行） */
  #waterRows() {
    if (this.waterRows) return this.waterRows;
    const out = [];
    let on = false;
    for (const el of $('panel').children) {
      if (el.tagName === 'H3') on = el.dataset.t === 'hWater';
      if (on) out.push(el);
    }
    this.waterRows = out;
    return out;
  }

  /** 「持ち帰る」の出し入れ。匹数が変わったときだけ書き換える */
  setBowl(n, full) {
    if (this.bowlShown === n) return;
    this.bowlShown = n;
    this.el.btnTakeHome.hidden = n === 0;
    if (n > 0) this.el.btnTakeHome.textContent = t('takeHome', { n });
    if (full) this.toast(t('bowlFull'), 3200);
  }

  /** 家の鉢の匹数。目安を超えていたらそう書く */
  /** 明かりのボタン。暗くなってからだけ出す。昼は押しても変わらない */
  setLampVisible(show) {
    if (this.lampShown === show) return;
    this.lampShown = show;
    this.el.btnLamp.hidden = !show;
  }

  setHome(n, fit, full) {
    const text = n === 0 ? t('homeEmpty')
               : full ? `${t('homeCount', { n })}・${t('homeFull')}`
               : n > fit ? t('homeCrowded', { n, fit })
               : t('homeCount', { n });
    if (this.el.homeCount.textContent !== text) this.el.homeCount.textContent = text;
  }

  /** 短い知らせ。数秒で消える */
  toast(text, ms = 2400) {
    const el = this.el.toast;
    el.textContent = text;
    el.hidden = false;
    // いったん描かせてから透かす。でないと最初の 1 回が出ない
    requestAnimationFrame(() => el.classList.add('show'));
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => {
      el.classList.remove('show');
      setTimeout(() => { el.hidden = true; }, 400);
    }, ms);
  }

  /** 最初の絵が出たら覆いを外す。 */
  ready() {
    this.el.loading.classList.add('done');
    setTimeout(() => { this.el.loading.hidden = true; }, 600);
  }

  /** 毎フレーム。文字が変わった時だけ DOM を書き換える。 */
  tick(game, fps) {
    if (fps !== null && this.lastFps !== fps) {
      this.el.fps.textContent = `${fps} fps`;
      this.lastFps = fps;
    }
  }

  resetMeters() {
    this.lastFps = null;
  }
}
