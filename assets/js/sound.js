// 音。音源ファイルは持たず、その場で作る。
//
// 聞こえるのは「その場にあるもの」だけにしてある。
//   いつでも  … エアポンプの泡がぽこぽこ上がる音、ポイが水に触れる音
//   日中      … 蝉と、ときどき風鈴
//   夕方から  … 祭囃子と、人のざわめき
//   夜        … 虫の声だけ
//
// 層ごとの音量は、絵と同じ `sunFor()` の値（daylight / lanternOn / closed）から
// 決める。時刻のつまみを動かすと、絵と一緒に音も移り変わる。
//
// 合成の勘どころ:
//   泡     … 泡のはじける音は、気泡の共振（Minnaert）が上向きに掃引する正弦。
//            半径 1.5mm なら約 2.2kHz。これを外すと「水」に聞こえない
//   蝉     … アブラゼミは 4〜6kHz の帯域雑音を 40Hz 前後で振幅変調したもの
//   風鈴   … 叩いた硝子。倍音が整数比にならない（1 : 2.76 : 5.40）のが鍵
//   虫     … スズムシは 4.5kHz 前後の短い帯域雑音を、一定の間隔で繰り返す
//   ざわめき… 遠くの人声は、話し声の帯（300〜1200Hz）を揺らした雑音でよい
//   祭囃子 … 篠笛・締太鼓・鉦。遠くから聞こえる想定なので、低域通過と
//            残響を強めに掛ける。近くで鳴らすと合成だと分かってしまう

const clamp01 = (x) => (x < 0 ? 0 : x > 1 ? 1 : x);

export class Sound {
  constructor() {
    this.ctx = null;
    this.on = true;
    this.master = null;
    this.layers = null;
    this.want = { pump: 1, cicada: 0, minmin: 0, furin: 0, festival: 0, crowd: 0, insect: 0, rain: 0 };
    // 画面から動かせる係数。1 が既定
    this.mix = { master: 1, pump: 1, cicada: 1, minmin: 1, furin: 1, festival: 1, crowd: 1, insect: 1, rain: 1 };
  }

  /** 最初の操作で呼ぶ。自動再生は塞がれているので、ここまで遅らせる。 */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const ctx = new AC();
    this.ctx = ctx;

    this.master = ctx.createGain();
    this.master.gain.value = this.on ? 0.9 * this.mix.master : 0;
    // 層が重なった時に割れないよう、最後に軽く頭を抑える
    const lim = ctx.createDynamicsCompressor();
    lim.threshold.value = -8;
    lim.knee.value = 6;
    lim.ratio.value = 8;
    lim.attack.value = 0.004;
    lim.release.value = 0.18;
    this.master.connect(lim).connect(ctx.destination);

    // 屋台の下。硬い物が少ないので残響は短い
    this.verb = ctx.createConvolver();
    this.verb.buffer = this.#impulse(1.5, 2.6);
    const verbGain = ctx.createGain();
    verbGain.gain.value = 0.34;
    this.verb.connect(verbGain).connect(this.master);

    // 2 秒ぶんの白色雑音を一度だけ作って使い回す
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.noise = buf;

    this.layers = {};
    for (const k of ['pump', 'cicada', 'minmin', 'furin', 'festival', 'crowd', 'insect', 'rain']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      this.layers[k] = g;
    }
    // 遠くから聞こえるものは、残響にも送る
    for (const k of ['festival', 'crowd', 'furin']) this.layers[k].connect(this.verb);

    this.#startCicada();
    this.#startMinmin();
    this.#startRain();
    this.#startCrowd();
    this.#startFestival();
    this.#loop('furin', () => 4 + Math.random() * 9, () => this.#furin());
    this.#loop('insect', () => 0.42 + Math.random() * 0.22, () => this.#suzumushi());
    this.#loop('pump', () => 0.055 + Math.random() * 0.075, () => this.#bubble());
    this.apply();
  }

  setEnabled(v) {
    this.on = v;
    if (this.master) this.master.gain.setTargetAtTime(v ? 0.9 * this.mix.master : 0, this.ctx.currentTime, 0.08);
  }

  /** 画面のつまみから、層ごとの音量を動かす。 */
  setMix(key, v) {
    this.mix[key] = v;
    if (!this.ctx) return;
    if (key === 'master') this.setEnabled(this.on);
    else this.apply();
  }

  /**
   * 絵と同じ光の状態から、層ごとの音量を決める。
   * daylight 1 = 昼、lanternOn 1 = 提灯が点いている、closed 1 = 店じまい。
   */
  setScene({ daylight, lanternOn, closed, weather }) {
    const day = clamp01(daylight);
    const lit = clamp01(lanternOn);
    const shut = clamp01(closed);
    this.want = {
      pump: 1,
      // 雨。降っていれば、昼夜を問わず鳴る
      rain: weather === 2 ? 1 : 0,
      // 蝉は昼だけ。日が傾くと鳴き止む
      // 蝉。雨の日は鳴かない
      cicada: day * day * (weather === 2 ? 0 : 1),
      minmin: day * day * (weather === 2 ? 0 : 1),
      // 風鈴も昼。夕方まで少し残る
      furin: Math.pow(day, 0.6),
      // 祭囃子と人声は、提灯が点いているあいだ。店じまいで引く
      festival: lit * (1 - shut),
      crowd: lit * (1 - shut) * 0.9,
      // 虫は暗くなってから。祭りが終わると、これだけが残る
      insect: (1 - day) * (0.45 + 0.55 * shut),
    };
    this.apply();
  }

  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    // 層ごとの音量。実測して決めた。
    // 最初に置いた値は全部で頂点 0.069（ほぼ聞こえない）だったので、
    // 合わせて 6 倍ほどまで上げてある
    const vol = { pump: 0.085, cicada: 0.26, minmin: 0.80, furin: 1.10,
                  festival: 0.34, crowd: 0.26, insect: 0.38, rain: 0.30 };
    for (const k of Object.keys(this.layers)) {
      // 層が増えたときに want の鍵が欠けても落ちないようにする
      const w = this.want[k] ?? 0;
      this.layers[k].gain.setTargetAtTime(w * vol[k] * (this.mix[k] ?? 1), t, 1.2);
    }
  }

  // ------------------------------------------------------------ 一度きりの音

  /** ポイが水に触れる / 抜ける。 */
  splash(power = 1, out = false) {
    if (!this.ctx || !this.on) return;
    const ctx = this.ctx, t = ctx.currentTime;
    const p = Math.min(Math.max(power, 0.2), 1.4);

    // 水面を割る音。帯域雑音の短い立ち上がり
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(out ? 1100 : 780, t);
    bp.frequency.exponentialRampToValueAtTime(out ? 2600 : 420, t + 0.16);
    bp.Q.value = 0.9;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.62 * p, t + 0.008);
    g.gain.exponentialRampToValueAtTime(0.0005, t + (out ? 0.26 : 0.19));
    src.connect(bp).connect(g).connect(this.master);
    g.connect(this.verb);
    src.start(t);
    src.stop(t + 0.35);

    // 跳ねた水が落ちる粒
    const n = out ? 8 : 4;
    for (let i = 0; i < n; i++) this.#bubble(t + 0.02 + Math.random() * 0.22, 0.8 + Math.random() * 1.3);
  }

  /** 雨粒が水面を打つ音。game.js が着水の瞬間に呼ぶ。 */
  raindrop() {
    if (!this.ctx || !this.on || this.want.rain < 0.1) return;
    // 一粒ずつ鳴らすと数が多すぎるので、間引く
    if (Math.random() > 0.35) return;
    this.#bubble(this.ctx.currentTime, 1.6 + Math.random() * 1.2);
  }

  // ------------------------------------------------------------ 合成の部品

  /** 残響用のインパルス応答。雑音を指数で減衰させただけのもの。 */
  #impulse(sec, decay) {
    const ctx = this.ctx;
    const n = Math.floor(ctx.sampleRate * sec);
    const buf = ctx.createBuffer(2, n, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < n; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / n, decay);
      }
    }
    return buf;
  }

  /** 決まった層が鳴っている間だけ、間隔を空けて鳴らし続ける。 */
  #loop(layer, gapFn, fire) {
    const step = () => {
      if (!this.ctx) return;
      if (this.on && this.want[layer] > 0.02) fire();
      setTimeout(step, gapFn() * 1000);
    };
    setTimeout(step, Math.random() * 400);
  }

  /**
   * 泡がはじける音。
   * 気泡の共振は上へ掃引する。半径 1.5mm で 2.2kHz 前後。
   * 掃引を外すと「水」ではなく「電子音」になる。
   */
  #bubble(at = 0, scale = 1) {
    const ctx = this.ctx;
    const t = at || ctx.currentTime;
    const f0 = (1500 + Math.random() * 1700) / scale;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f0 * 1.9, t + 0.055);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.5, t + 0.002);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.055);
    o.connect(g).connect(this.layers.pump);
    o.start(t);
    o.stop(t + 0.08);
  }

  /**
   * 雨。たくさんの粒が当たる音は、帯域の広い雑音にしか聞こえない。
   * 高いほうを少し落として、強さをゆっくり揺らす。
   */
  #startRain() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 5200;
    lp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 420;
    const g = ctx.createGain();
    g.gain.value = 0.75;
    // 降りが強くなったり弱くなったりする
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 0.085;
    const lg = ctx.createGain();
    lg.gain.value = 0.22;
    lfo.connect(lg).connect(g.gain);
    src.connect(lp).connect(hp).connect(g).connect(this.layers.rain);
    src.start(); lfo.start();
  }

  /**
   * ミンミンゼミ。
   *
   * アブラゼミの乾いた地鳴りと違って、はっきり音程がある。
   * 「ミーン」で立ち上がり、「ミンミンミン」を 4〜5Hz で繰り返し、
   * 「ミー」と下がって終わる。この三段が無いと、ただの唸りになる。
   * 基本波は 2.7kHz あたりで、倍音がよく出る。
   */
  #startMinmin() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.layers.minmin);
    this.minminGate = out;

    // 倍音を重ねた音源
    const carrier = ctx.createOscillator();
    carrier.type = 'sawtooth';
    carrier.frequency.value = 2700;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 3400;
    bp.Q.value = 1.6;
    // 「ミンミン」の刻み
    const pulse = ctx.createGain();
    pulse.gain.value = 0.5;
    const lfo = ctx.createOscillator();
    lfo.type = 'triangle';
    lfo.frequency.value = 4.6;
    const lg = ctx.createGain();
    lg.gain.value = 0.46;
    lfo.connect(lg).connect(pulse.gain);
    carrier.connect(bp).connect(pulse).connect(out);
    carrier.start(); lfo.start();
    this.minminPitch = carrier.frequency;

    // ひと鳴きの形。立ち上がり → 刻み → 尻下がり → 休み
    const phrase = () => {
      if (!this.ctx) return;
      let wait = 2.4 + Math.random() * 3.0;
      if (this.on && this.want.minmin > 0.02) {
        const t = ctx.currentTime + 0.05;
        const body = 2.6 + Math.random() * 2.2;
        const f0 = 2500 + Math.random() * 420;
        this.minminPitch.cancelScheduledValues(t);
        this.minminPitch.setValueAtTime(f0 * 0.86, t);
        this.minminPitch.linearRampToValueAtTime(f0, t + 0.55);          // ミーン
        this.minminPitch.setValueAtTime(f0, t + 0.55 + body);
        this.minminPitch.linearRampToValueAtTime(f0 * 0.72, t + 1.05 + body);  // ミー
        const g = out.gain;
        g.cancelScheduledValues(t);
        g.setValueAtTime(0, t);
        g.linearRampToValueAtTime(0.34, t + 0.55);
        g.setValueAtTime(0.34, t + 0.55 + body);
        g.linearRampToValueAtTime(0, t + 1.15 + body);
        wait = 1.3 + body + 1.6 + Math.random() * 2.6;
      }
      setTimeout(phrase, wait * 1000);
    };
    setTimeout(phrase, 500 + Math.random() * 1500);
  }

  /** 風鈴。叩いた硝子は、倍音が整数比にならない。 */
  #furin() {
    const ctx = this.ctx, t = ctx.currentTime;
    const base = 1750 + Math.random() * 500;
    // 短冊が揺れて、2〜4 回続けて鳴る
    const hits = 2 + Math.floor(Math.random() * 3);
    for (let h = 0; h < hits; h++) {
      const ht = t + h * (0.19 + Math.random() * 0.28);
      const amp = h === 0 ? 1 : 0.45 + Math.random() * 0.4;
      for (const [mul, lv, dec] of [[1, 1, 2.6], [2.76, 0.42, 1.5], [5.40, 0.18, 0.8]]) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.frequency.value = base * mul * (0.998 + Math.random() * 0.004);
        const g = ctx.createGain();
        g.gain.setValueAtTime(0, ht);
        g.gain.linearRampToValueAtTime(0.22 * lv * amp, ht + 0.004);
        g.gain.exponentialRampToValueAtTime(0.0004, ht + dec);
        o.connect(g).connect(this.layers.furin);
        o.start(ht);
        o.stop(ht + dec + 0.05);
      }
    }
  }

  /** スズムシ。4.5kHz 前後の短い帯域雑音。 */
  #suzumushi() {
    const ctx = this.ctx, t = ctx.currentTime;
    const n = 2 + Math.floor(Math.random() * 2);
    for (let i = 0; i < n; i++) {
      const st = t + i * (0.17 + Math.random() * 0.06);
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 4100 + Math.random() * 1100;
      bp.Q.value = 18;
      // Q=18 の帯域通過を抜けると白色雑音は 1/5 ほどまで落ちる。
      // 実測して、聞こえる所まで足し戻してある
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(3.8, st + 0.012);
      g.gain.setValueAtTime(3.8, st + 0.065);
      g.gain.exponentialRampToValueAtTime(0.004, st + 0.14);
      src.connect(bp).connect(g).connect(this.layers.insect);
      src.start(st);
      src.stop(st + 0.2);
    }
  }

  /** 蝉。帯域雑音を 40Hz 前後で振幅変調する。3 匹ぶん重ねる。 */
  #startCicada() {
    const ctx = this.ctx;
    for (let i = 0; i < 3; i++) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 4200 + i * 900;
      bp.Q.value = 2.2;
      const am = ctx.createGain();
      am.gain.value = 0.5;
      // 羽の震え
      const lfo = ctx.createOscillator();
      lfo.type = 'sawtooth';
      lfo.frequency.value = 38 + i * 6;
      const lg = ctx.createGain();
      lg.gain.value = 0.5;
      lfo.connect(lg).connect(am.gain);
      // 1 匹ずつ、鳴いたり止んだりする
      const sw = ctx.createGain();
      sw.gain.value = 0.34;
      const slow = ctx.createOscillator();
      slow.type = 'sine';
      slow.frequency.value = 0.045 + i * 0.021;
      const sg = ctx.createGain();
      sg.gain.value = 0.3;
      slow.connect(sg).connect(sw.gain);
      src.connect(bp).connect(am).connect(sw).connect(this.layers.cicada);
      src.start(); lfo.start(); slow.start();
    }
  }

  /** 人のざわめき。話し声の帯を、ゆっくり揺らした雑音。 */
  #startCrowd() {
    const ctx = this.ctx;
    for (const [f, q, lv, rate] of [[320, 1.1, 1.0, 0.13], [700, 1.4, 0.8, 0.19], [1250, 1.8, 0.45, 0.27]]) {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      src.loop = true;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = f;
      bp.Q.value = q;
      // ざわめきも帯域通過ぶんを足し戻す
      const g = ctx.createGain();
      g.gain.value = lv * 1.35;
      const lfo = ctx.createOscillator();
      lfo.type = 'sine';
      lfo.frequency.value = rate;
      const lg = ctx.createGain();
      lg.gain.value = lv * 1.00;
      lfo.connect(lg).connect(g.gain);
      src.connect(bp).connect(g).connect(this.layers.crowd);
      src.start(); lfo.start();
    }
  }

  /**
   * 祭囃子。篠笛・締太鼓・鉦。
   *
   * 遠くの屋台から流れてくる想定なので、低域通過と残響を強めに掛ける。
   * 近くで鳴らすと合成だと分かるが、遠ければ輪郭だけで通る。
   */
  #startFestival() {
    const ctx = this.ctx;
    const out = ctx.createBiquadFilter();
    out.type = 'lowpass';
    out.frequency.value = 1500;
    out.Q.value = 0.6;
    out.connect(this.layers.festival);
    this.fes = out;

    const BPM = 116;
    const beat = 60 / BPM;
    // 篠笛。都節に近い音階を上下する
    const SCALE = [587.3, 622.3, 784.0, 880.0, 1046.5, 1174.7];
    const MELODY = [0, 2, 3, 2, 4, 3, 2, 0, 1, 2, 3, 2, 0, -1, 0, -1];
    let step = 0;
    const tick = () => {
      if (!this.ctx) return;
      if (this.on && this.want.festival > 0.02) {
        const t = ctx.currentTime + 0.05;
        const s = step % 16;
        // 締太鼓。ドン・ドン・ドドン
        if ([0, 4, 8, 10, 12].includes(s)) this.#taiko(t, s === 0 ? 1 : 0.7);
        // 鉦。裏で刻む
        if (s % 2 === 1) this.#kane(t, s % 4 === 1 ? 0.8 : 0.45);
        // 笛
        if (s % 2 === 0) {
          const i = MELODY[(step >> 1) % MELODY.length];
          if (i >= 0) this.#fue(t, SCALE[i % SCALE.length], beat * 1.7);
        }
        step++;
      } else {
        step = 0;
      }
      setTimeout(tick, beat * 500);
    };
    setTimeout(tick, 300);
  }

  /** 締太鼓。張った膜なので、低い胴鳴りと皮の当たる音。 */
  #taiko(t, amp) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(190, t);
    o.frequency.exponentialRampToValueAtTime(96, t + 0.14);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.75 * amp, t + 0.004);
    g.gain.exponentialRampToValueAtTime(0.0008, t + 0.28);
    o.connect(g).connect(this.fes);
    o.start(t); o.stop(t + 0.32);

    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 900;
    bp.Q.value = 0.8;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.28 * amp, t);
    ng.gain.exponentialRampToValueAtTime(0.0008, t + 0.05);
    src.connect(bp).connect(ng).connect(this.fes);
    src.start(t); src.stop(t + 0.08);
  }

  /** 鉦（かね）。叩いた金属なので、倍音が整数比から外れる。 */
  #kane(t, amp) {
    const ctx = this.ctx;
    for (const [f, lv] of [[2300, 1], [3480, 0.5], [5120, 0.22]]) {
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.value = f * (0.995 + Math.random() * 0.01);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0, t);
      g.gain.linearRampToValueAtTime(0.16 * lv * amp, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0005, t + 0.20);
      o.connect(g).connect(this.fes);
      o.start(t); o.stop(t + 0.24);
    }
  }

  /** 篠笛。竹の笛なので、息の音が混じり、音の頭が揺れる。 */
  #fue(t, freq, dur) {
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(freq * 0.985, t);
    o.frequency.linearRampToValueAtTime(freq, t + 0.07);
    // 揺り（ビブラート）
    const vib = ctx.createOscillator();
    vib.type = 'sine';
    vib.frequency.value = 5.2;
    const vg = ctx.createGain();
    vg.gain.value = freq * 0.011;
    vib.connect(vg).connect(o.frequency);

    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.16, t + 0.05);
    g.gain.setTargetAtTime(0.11, t + 0.08, 0.2);
    g.gain.setTargetAtTime(0, t + dur * 0.7, 0.09);
    o.connect(g).connect(this.fes);
    o.start(t); o.stop(t + dur + 0.2);
    vib.start(t); vib.stop(t + dur + 0.2);

    // 息の音
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.value = freq * 2.1;
    hp.Q.value = 1.4;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0, t);
    ng.gain.linearRampToValueAtTime(0.030, t + 0.04);
    ng.gain.setTargetAtTime(0, t + dur * 0.7, 0.09);
    src.connect(hp).connect(ng).connect(this.fes);
    src.start(t); src.stop(t + dur + 0.2);
  }
}
