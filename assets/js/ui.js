// 画面の文字まわり。DOM を触るのはこのファイルだけにする。
//
// innerHTML は使わない。数字は textContent で差し替えるだけなので、
// そのほうが速いし、文字列の組み立てで事故らない。

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.el = {
      fps: $('fps'), hourOut: $('hourOut'), wxNote: $('wxNote'),
      loading: $('loading'),
      panel: $('panel'), btnPanel: $('btnPanel'),
      fallback: $('fallback'), fallbackWhy: $('fallbackWhy'),
    };


    this.el.btnPanel.addEventListener('click', () => {
      const open = this.el.panel.hidden;
      this.el.panel.hidden = !open;
      this.el.btnPanel.setAttribute('aria-expanded', String(open));
    });

    this.#range('hour', 'hourOut', (v) => {
      handlers.hour(v);
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
      this.el.wxNote.textContent = '手動';
      return null;
    });
    $('btnNow').addEventListener('click', () => handlers.now());

    this.#seg('segFFT', 'n', (v) => {
      handlers.fft(Number(v));
      $('fftOut').textContent = `${v}²`;
    });
    this.#seg('segDpr', 'd', (v) => {
      handlers.dpr(Number(v));
      $('dprOut').textContent = { '0.7': '軽い', '1': '標準', '2': '精細' }[v] ?? v;
    });
    this.#seg('segPitch', 'p', (v) => {
      handlers.pitch(Number(v));
      $('pitchOut').textContent = { 55: '浅め', 65: '標準', 87: '真上' }[v] ?? v;
    });
    this.#seg('segMsaa', 'm', (v) => {
      handlers.msaa(v === '1');
      $('msaaNote').textContent = v === '1' ? '入' : '切';
    });
  }

  #range(id, outId, fn) {
    const el = $(id), out = $(outId);
    const apply = () => { out.textContent = fn(Number(el.value)); };
    el.addEventListener('input', apply);
    apply();
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
    el.dispatchEvent(new Event('input'));
  }

  /** 天気の選択を外から切り替える。note は出どころ（現在地／手動）。 */
  setWeather(w, note) {
    for (const b of $('segWx').querySelectorAll('button')) {
      b.setAttribute('aria-pressed', String(Number(b.dataset.w) === w));
    }
    if (note) this.el.wxNote.textContent = note;
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
