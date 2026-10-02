// 水の音。音源ファイルは持たず、その場で作る。
//
// 水音はノイズをバンドパスに通して包絡をかければだいたい似る。
// 沈める時は低め、抜く時は高めにして、同じ素材で鳴らし分けている。

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.noise = null;
  }

  /** 最初の操作で呼ぶ。自動再生は塞がれているので、ここまで遅らせる。 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.5;
    this.master.connect(this.ctx.destination);

    // 2 秒ぶんのホワイトノイズを一度だけ作って使い回す
    const len = this.ctx.sampleRate * 2;
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;
  }

  setEnabled(v) {
    this.on = v;
    if (this.master) this.master.gain.value = v ? 0.5 : 0;
  }

  #burst({ freq = 900, q = 1.2, dur = 0.25, gain = 0.3, sweep = 0, type = 'bandpass' }) {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    src.playbackRate.value = 0.8 + Math.random() * 0.5;

    const f = this.ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweep) f.frequency.exponentialRampToValueAtTime(Math.max(80, freq * sweep), t + dur);
    f.Q.value = q;

    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);

    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  }

  dip() { this.#burst({ freq: 620, q: 0.9, dur: 0.22, gain: 0.22, sweep: 0.45 }); }
  lift() { this.#burst({ freq: 1700, q: 1.6, dur: 0.30, gain: 0.26, sweep: 0.3 }); }
  splash() { this.#burst({ freq: 2600, q: 0.7, dur: 0.18, gain: 0.18, sweep: 0.35 }); }

  tear() {
    this.#burst({ freq: 3200, q: 0.5, dur: 0.42, gain: 0.30, sweep: 0.18, type: 'highpass' });
    this.tone(180, 0.5, 0.18, 'sawtooth');
  }

  /** 掬えた時の鈴。倍音を 2 本重ねるだけ。 */
  chime(hz = 1320) {
    this.tone(hz, 0.55, 0.11, 'sine');
    this.tone(hz * 2.01, 0.42, 0.05, 'sine');
  }

  tone(hz, dur, gain, type = 'sine') {
    if (!this.ctx || !this.on) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(hz, t);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0005, t + dur);
    o.connect(g); g.connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }
}
