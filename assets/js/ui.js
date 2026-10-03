// 画面の文字まわり。DOM を触るのはこのファイルだけにする。

import { t } from './i18n.js?v=202610031304';
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
    };


    this.el.btnPanel.addEventListener('click', () => {
      const open = this.el.panel.hidden;
      this.el.panel.hidden = !open;
      this.el.btnPanel.setAttribute('aria-expanded', String(open));
      // 右上の札はパネルの上に重なる。開いているあいだは引っ込める
      document.documentElement.classList.toggle('panel-open', open);
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
      const mark = document.createElement('i');
      mark.className = 'mute';
      mark.hidden = true;
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
      if (off && !mark.textContent) mark.textContent = t('silentNow');
    }
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
