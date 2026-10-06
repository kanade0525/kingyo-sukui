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

/**
 * 録音を使う層。
 *
 * 日本の夏に録られたものを使っている。種類の合わない CC0 の録音
 * （ニュージーランドのセミ、西洋の音階付き風鈴）は置き換えた。
 * 出どころは assets/sound/CREDITS.md。
 *
 * 祭囃子だけは音楽なので扱いが違う。48 小節（88.6 秒）でぴたりと
 * 繰り返す素材なので、そのまま輪にしてある。ほかの環境音のように
 * 末尾を先頭へ重ねると、拍がずれて別物になる。
 *
 * 中身は m4a（AAC）。ogg vorbis は iOS の Safari が読めず、
 * 読み込みに失敗して黙って合成へ落ちていた。
 * どの層も 2 秒の重ね合わせで輪にしてあるので、繋ぎ目で跳ねない。
 *
 * 拡張子が .bin なのは、素のままの音源ファイルとして置かないため。
 * 配布元が「できる限りでよいので、音源ファイルを隠す措置を」と
 * 添えているので、鍵で XOR してから置いている（scripts/pack-sound.mjs）。
 * 暗号ではなく、覗いて持っていくのに一手間かかる、という程度のもの。
 */
const CLIPS = {
  cicada:   'assets/sound/s1.bin',
  dusk:     'assets/sound/s2.bin',
  furin:    'assets/sound/s3.bin',
  rain:     'assets/sound/s4.bin',
  insect:   'assets/sound/s5.bin',
  festival: 'assets/sound/s6.bin',
};

/** scripts/pack-sound.mjs の KEY と同じ。片方だけ変えると音が出ない */
const KEY = 'kingyo-sukui';

/** 置いてある形から元の m4a へ戻す。XOR なので同じ操作で往復する */
function unscramble(bytes) {
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= KEY.charCodeAt(i % KEY.length);
  return bytes;
}

/**
 * 合成版も持っている層。ここに無い層は、切り替えに関わらず録音を鳴らす。
 *
 * 値は合成側に掛ける補正。層の音量は録音に合わせて決め直したので、
 * 合成側はその比で戻さないと、切り替えた途端に音量が変わってしまう。
 */
const SYNTH_TRIM = { cicada: 0.26 / 1.05, furin: 1.10 / 0.95, rain: 0.30 / 1.10,
                     insect: 0.38 / 2.00, festival: 0.34 / 0.312 };

/**
 * 光の条件から、層ごとの音量を決める。
 *
 * クラスの外に出してあるのは、画面側が「この音はいつ鳴るのか」を
 * 一日ぶん走査して調べられるようにするため。設定の「いまは鳴らない」を
 * 押すと、ここを 24 時間ぶん回して、いちばん鳴る時刻へ飛ぶ。
 */
/**
 * 季節は見ていない。年中夏として鳴らす。
 *
 * 太陽の位置だけは実際の日付と緯度から出しているので、12 月に開くと
 * 日が短く低いのに蝉が鳴く、という食い違いが残る。承知のうえでそうしている。
 * 金魚すくいも、蝉も、祭囃子も夏のものなので、季節で絞ると冬は
 * 水の音しかしない画面になってしまう。見ているのは「いつ開いても夏の縁日」。
 * 日付で変わるのは、日の長さと日の暮れ方だけ。
 */
export function layerWants({ daylight, lanternOn, closed, weather, elev = 0 }) {
  const day = clamp01(daylight);
  const lit = clamp01(lanternOn);
  const shut = clamp01(closed);
  const dry = weather === 2 ? 0 : 1;
  // 夕方の蝉だけは、明るさではなく太陽の高さ（度）で決める。
  //
  // 明るさで決めると、日の入り前後の 25 分しか窓が開かず、
  // 時刻を動かしてもまず当たらない。実際にこの蝉が鳴くのは
  // 日が低いあいだで、高度 +13° から -9° までのおよそ 1 時間半。
  // 朝の同じ高さでも鳴くので、左右対称でよい。
  const sunDeg = (elev * 180) / Math.PI;
  const dusk = dry * clamp01(1 - Math.pow(Math.abs(sunDeg - 2) / 11, 2));
  return {
    pump: 1,
    // 雨。降っていれば、昼夜を問わず鳴る
    rain: weather === 2 ? 1 : 0,
    // 蝉は昼だけ。日が傾くと鳴き止む
    // 蝉。雨の日は鳴かない
    // 夕方の蝉が鳴き出すと、昼の蝉は引く。指示どおり日中限定にする
    cicada: day * day * dry * (1 - 0.75 * dusk),
    dusk,
    // 風鈴も昼。夕方まで少し残る
    furin: Math.pow(day, 0.6),
    // 祭囃子と人声は、提灯が点いているあいだ。店じまいで引く
    festival: lit * (1 - shut),
    crowd: lit * (1 - shut) * 0.9,
    // 虫は暗くなってから。祭りが終わると、これだけが残る
    insect: (1 - day) * (0.45 + 0.55 * shut),
  };
}


/**
 * 音の出入りにかける時間（秒）。
 *
 * すべての変化をこの一つの値で揃える。もとは層ごとに 1.2 や 0.5 の
 * 時定数を使っていて、指数で近づくので「いつ鳴り終わったか」が層ごとに
 * 違っていた。直線で同じ長さをかければ、どれも同じ呼吸で出入りする。
 */
const FADE = 1.4;

/**
 * 親の音量。つまみの 100 がこの値にあたる。
 *
 * 0.9 では大きかった。縁日の音を部屋で流すものなので、
 * 控えめなところから始めて、欲しい人がつまみで上げる形にする。
 * 以前の 40%。
 */
const MASTER = 0.36;

/** 音量をなめらかに動かす。途中でも割り込める。dur が 0 なら即座に */
function ramp(param, to, t, dur = FADE) {
  param.cancelScheduledValues(t);
  if (dur <= 0) { param.setValueAtTime(to, t); return; }
  param.setValueAtTime(param.value, t);
  param.linearRampToValueAtTime(to, t + dur);
}

export class Sound {
  constructor() {
    this.ctx = null;
    // 'synth' = 合成, 'rec' = 録音
    this.source = 'rec';
    this.buffers = {};
    this.recNodes = {};
    this.on = true;
    // 親のフェードが開けきったか。開けきるまでは層を直に置く
    this.opened = false;
    this.master = null;
    this.layers = null;
    this.place = 'stall';
    this.lastSun = null;
    this.want = { pump: 1, cicada: 0, dusk: 0, furin: 0,
                  festival: 0, crowd: 0, insect: 0, rain: 0 };
    // 画面から動かせる係数。1 が既定
    this.mix = { master: 1, pump: 1, cicada: 1, dusk: 1, furin: 1,
                 festival: 1, crowd: 1, insect: 1, rain: 1 };
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
    // 無音から立ち上げる。いきなり最大から始めると、
    // 最初の 1 音だけが飛び出して聞こえる
    this.master.gain.value = 0;
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
    // 合成側の元栓。録音に切り替えたときに閉じる
    this.synthGate = {};
    for (const k of ['pump', 'cicada', 'dusk', 'furin',
                     'festival', 'crowd', 'insect', 'rain']) {
      const g = ctx.createGain();
      g.gain.value = 0;
      g.connect(this.master);
      this.layers[k] = g;
      if (SYNTH_TRIM[k]) {
        const sg = ctx.createGain();
        sg.gain.value = SYNTH_TRIM[k];
        sg.connect(g);
        this.synthGate[k] = sg;
      }
    }
    // 遠くから聞こえるものは、残響にも送る
    // 遠くから聞こえるものは、残響にも送る。
    // 祭囃子だけは録音にもともと空間が入っているので、送りを絞る
    for (const k of ['crowd', 'furin']) this.layers[k].connect(this.verb);
    const fsend = ctx.createGain();
    fsend.gain.value = 0.35;
    this.layers.festival.connect(fsend).connect(this.verb);

    this.#startCicada();
    this.#startRain();
    this.#loadClips();
    this.#startCrowd();
    this.#startFestival();
    this.#loop('furin', () => 4 + Math.random() * 9, () => this.#furin());
    this.#loop('insect', () => 0.42 + Math.random() * 0.22, () => this.#suzumushi());
    this.#loop('pump', () => 0.055 + Math.random() * 0.075, () => this.#bubble());
    this.apply();
    // ここまで組み上げてから、親をゆっくり開ける。
    //
    // 立ち上がりのフェードは、親の 1 本だけに任せる。層も元栓も同時に
    // 上げると、直線の掛け合わせで t³ の形になって、終わり際に
    // 一気に飛び出す。開けきるまでは、ほかは目標値へ直に置く。
    ramp(this.master.gain, this.on ? MASTER * this.mix.master : 0, ctx.currentTime);
    setTimeout(() => { this.opened = true; }, FADE * 1000);
  }

  setEnabled(v) {
    this.on = v;
    if (this.master) ramp(this.master.gain, v ? MASTER * this.mix.master : 0, this.ctx.currentTime);
  }

  /** 合成と録音の切り替え。 */
  setSource(mode) {
    this.source = mode;
    this.apply();
  }

  /**
   * 録音を読み込んで、その層に重ねて流す。
   * 合成側と録音側は別の枝にしておき、apply() でどちらかを 0 にする。
   */
  async #loadClips() {
    // まとめて読む。
    //
    // 1 本ずつ順に読んでいたので、読み終わった順に鳴り始めていた。
    // 回線の速さしだいで蝉だけ先に出たり、祭囃子が数秒遅れたりする。
    // 全部そろえてから、同じ瞬間に始める。
    const loaded = await Promise.all(Object.entries(CLIPS).map(async ([key, url]) => {
      try {
        const res = await fetch(url);
        const raw = unscramble(new Uint8Array(await res.arrayBuffer()));
        return [key, await this.ctx.decodeAudioData(raw.buffer)];
      } catch {
        return null;        // 読めなければ合成のまま。鳴らないよりはよい
      }
    }));

    const t0 = this.ctx.currentTime + 0.05;
    for (const e of loaded) {
      if (!e) continue;
      const [key, buf] = e;
      this.buffers[key] = buf;
      const g = this.ctx.createGain();
      g.gain.value = 0;
      g.connect(this.layers[key]);
      const src = this.ctx.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.connect(g);
      // 始める「時刻」ではなく、輪の中の「どこから入るか」を散らす。
      // 遅らせると鳴り出しがばらつくが、入る位置を変えるだけなら
      // 同時に始まったまま、重なりの癖だけがほぐれる
      src.start(t0, Math.random() * buf.duration);
      this.recNodes[key] = g;
    }
    this.apply();
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
  setScene(sun) {
    this.lastSun = sun;
    const w = layerWants(sun);
    // 家では屋台の音は鳴らない。
    //
    // エアポンプは舟に沈めてある物なので、家まで聞こえる道理がない。
    // 人のざわめきも同じ。祭囃子だけは、縁側まで遠く流れてくる。
    // 蝉も風鈴も虫も雨も、家にも同じように鳴っている
    if (this.place === 'home') {
      w.pump = 0;
      w.crowd = 0;
      w.festival = (w.festival ?? 0) * 0.30;
    }
    this.want = w;
    this.apply();
  }

  /** いま居る場所。屋台と家で、鳴ってよい音が違う */
  setPlace(place) {
    if (this.place === place) return;
    this.place = place;
    if (this.lastSun) this.setScene(this.lastSun);
  }

  apply() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const dur = this.opened ? FADE : 0;
    // 層ごとの音量。実測して決めた。
    // 最初に置いた値は全部で頂点 0.069（ほぼ聞こえない）だったので、
    // 合わせて 6 倍ほどまで上げてある
    // 録音のある層は、どれも -20 LUFS に揃えてあるので近い値になる。
    // 合成だけの層は、以前に実測して決めた値をそのまま使う。
    //
    // 祭囃子は 0.78 では大きすぎた。BGM なので、環境音より下へ置く。
    // つまみの 100 が、前の 40 に当たる。
    //
    // 虫だけ 2.0 と大きいのは、鳴き声が 4〜5kHz に偏っているため。
    // LUFS は人の耳に合わせてその辺りを重く数えるので、同じ -20 LUFS でも
    // 実際に出てくる音は小さい。耳で判断できないので、画面の出力を
    // 実測して合わせた（揃える前は深夜だけ 11dB 低かった）
    const vol = { pump: 0.085, cicada: 1.05, dusk: 1.10, furin: 0.95,
                  festival: 0.312, crowd: 0.26, insect: 2.00, rain: 1.10 };
    for (const k of Object.keys(this.layers)) {
      // 層が増えたときに want の鍵が欠けても落ちないようにする
      const w = this.want[k] ?? 0;
      ramp(this.layers[k].gain, w * vol[k] * (this.mix[k] ?? 1), t, dur);
    }
    // 録音がある層は、合成と録音のどちらかだけを鳴らす。
    // 合成版を持たない層は、切り替えに関わらず録音を鳴らす
    for (const k of Object.keys(CLIPS)) {
      const rec = this.source === 'rec' || !SYNTH_TRIM[k];
      const g = this.recNodes[k];
      if (g) ramp(g.gain, rec ? 1 : 0, t, dur);
      if (this.synthGate[k]) ramp(this.synthGate[k].gain, rec ? 0 : SYNTH_TRIM[k], t, dur);
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
    src.connect(lp).connect(hp).connect(g).connect(this.synthGate.rain ?? this.layers.rain);
    src.start(); lfo.start();
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
        o.connect(g).connect(this.synthGate.furin ?? this.layers.furin);
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
      src.connect(bp).connect(g).connect(this.synthGate.insect ?? this.layers.insect);
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
      src.connect(bp).connect(am).connect(sw).connect(this.synthGate.cicada ?? this.layers.cicada);
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
    out.connect(this.synthGate.festival ?? this.layers.festival);
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
