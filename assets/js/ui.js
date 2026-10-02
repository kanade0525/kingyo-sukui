// 画面の文字まわり。DOM を触るのはこのファイルだけにする。
//
// innerHTML は使わない。数字は textContent で差し替えるだけなので、
// そのほうが速いし、文字列の組み立てで事故らない。

const $ = (id) => document.getElementById(id);

export class UI {
  constructor(handlers) {
    this.el = {
      topbar: $('topbar'), count: $('countVal'), score: $('scoreVal'), fps: $('fps'),
      veil: $('veil'), start: $('cardStart'), end: $('cardEnd'),
      endCount: $('endCount'), endScore: $('endScore'), endPoi: $('endPoi'), grade: $('grade'),
      panel: $('panel'), btnPanel: $('btnPanel'),
      hint: $('hint'), fallback: $('fallback'), fallbackWhy: $('fallbackWhy'),
    };

    $('btnStart').addEventListener('click', () => handlers.start());
    $('btnAgain').addEventListener('click', () => handlers.start());

    this.el.btnPanel.addEventListener('click', () => {
      const open = this.el.panel.hidden;
      this.el.panel.hidden = !open;
      this.el.btnPanel.setAttribute('aria-expanded', String(open));
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
    this.#seg('segFFT', 'n', (v) => {
      handlers.fft(Number(v));
      $('fftOut').textContent = `${v}²`;
    });
    this.#seg('segDpr', 'd', (v) => {
      handlers.dpr(Number(v));
      $('dprOut').textContent = { '0.7': '軽い', '1': '標準', '2': '精細' }[v] ?? v;
    });
    this.#seg('segAudio', 'a', (v) => handlers.audio(v === '1'));
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
    this.el.veil.hidden = true;
    this.el.topbar.hidden = true;
    document.getElementById('botbar').hidden = true;
    if (message) this.el.fallbackWhy.textContent = message;
  }

  enterPlay() {
    this.el.veil.hidden = true;
    this.el.topbar.hidden = false;
    document.body.classList.add('playing');
  }

  enterOver(game) {
    this.el.veil.hidden = false;
    this.el.start.hidden = true;
    this.el.end.hidden = false;
    this.el.endCount.textContent = game.caught;
    this.el.endScore.textContent = game.score;
    this.el.endPoi.textContent = game.stock;
    this.el.grade.textContent = game.grade;
    document.body.classList.remove('playing');
  }

  /** 毎フレーム。文字が変わった時だけ DOM を書き換える。 */
  tick(game, fps) {
    if (this.lastCount !== game.caught) {
      this.el.count.textContent = game.caught;
      this.lastCount = game.caught;
    }
    if (this.lastScore !== game.score) {
      this.el.score.textContent = game.score;
      this.lastScore = game.score;
    }
    if (fps !== null && this.lastFps !== fps) {
      this.el.fps.textContent = `${fps} fps`;
      this.lastFps = fps;
    }
  }

  resetMeters() {
    this.lastCount = this.lastScore = null;
    this.el.count.textContent = '0';
    this.el.score.textContent = '0';
  }
}
