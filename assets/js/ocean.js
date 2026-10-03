// FFT 水面の駆動。h0 の生成とバタフライ表の作成は CPU、変換は GPU。
//
// なぜ h0 を CPU で作るか: 波の「種」は風速と風向が変わった時にしか
// 作り直さないので、毎フレーム走る必要がない。乱数も JS のほうが素直に書ける。

import { Program, makeTex, makeFbo, bindFbo } from './glx.js?v=202610031045';
import { VS_FULL } from '../shaders/common.js?v=202610031045';
import { FS_SPECTRUM, FS_BUTTERFLY, FS_ASSEMBLE, FS_NORMAL } from '../shaders/ocean.js?v=202610031045';
import { PATCH, TANK } from './world.js?v=202610031045';

const G = 9.80665;

/**
 * 波の大きさは実効「傾き」で決める。
 * 水面の見え方（反射のちらつき、底の揺らぎ、コースティクス）を決めるのは
 * 波高そのものではなく傾きなので、こちらを揃えたほうが縮尺を変えても崩れない。
 */
const TARGET_SLOPE = 0.055;

/**
 * Phillips スペクトルから h0(k) と conj(h0(-k)) を作る。
 *
 *   P(k) = A · exp(-1/(kL)²) / k⁴ · |k̂·ŵ|² · exp(-k²l²)
 *   L = V²/g（風速 V が起こせる最大の波のスケール）
 *
 * 最後の exp(-k²l²) は、格子で表しきれない細かい波を落とすための抑制項。
 * これが無いと高周波がちらついて、水面が砂嵐のようになる。
 */
function phillipsH0(N, patch, wind, windDir) {
  const L = (wind * wind) / G;
  // 格子で表しきれない波を捨てる長さ。下限を置いてあるのは、N を上げても
  // 見た目が細かくなりすぎないようにするため（64 だけは表現力の分だけ滑らかになる）
  // 焦点距離は 1/(c·k·slope)。水深 16cm で結ばせるには λ が数 cm まで
  // 要るので、格子が許す限り短い波を残す。格子の 2 倍より細かい波は
  // ナイキストを割って砂嵐になるので、そこで切る
  const small = Math.max(patch / N * 2.0, 0.005);
  const A = 8e-6;
  const wx = Math.cos(windDir), wz = Math.sin(windDir);
  const data = new Float32Array(N * N * 4);

  // 箱＝ミュラー。同じ種から 2 つの正規乱数を取り出す
  let seed = 20260902;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed >>> 8) / 16777216;
  };
  const gauss = () => {
    const u = Math.max(rnd(), 1e-9), v = rnd();
    return [Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v),
            Math.sqrt(-2 * Math.log(u)) * Math.sin(2 * Math.PI * v)];
  };

  const spec = (kx, kz) => {
    const k2 = kx * kx + kz * kz;
    if (k2 < 1e-12) return 0;
    const k = Math.sqrt(k2);
    const dir = (kx / k) * wx + (kz / k) * wz;
    // 指向性。dir² のままだと波が強く一方向に揃い、斜めに櫛を引いたような
    // 縞になる。舟の中の凪いだ水なら、もっと緩いほうがそれらしい
    let p = A * Math.exp(-1 / (k2 * L * L)) / (k2 * k2) * (0.35 + 0.65 * dir * dir);
    p *= Math.exp(-k2 * small * small);
    // 風に逆らう向きの波は弱める（鏡像対称だと波が行ったり来たりして見える）
    if (dir < 0) p *= 0.3;
    return p;
  };

  let slopePower = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const nx = i - N / 2, nz = j - N / 2;
      const kx = (2 * Math.PI * nx) / patch, kz = (2 * Math.PI * nz) / patch;
      const [g1, g2] = gauss();
      const [g3, g4] = gauss();
      const s = Math.sqrt(spec(kx, kz) / 2);
      const sc = Math.sqrt(spec(-kx, -kz) / 2);
      const o = (j * N + i) * 4;
      data[o] = g1 * s;          // h0(k)
      data[o + 1] = g2 * s;
      data[o + 2] = g3 * sc;     // conj(h0(-k))
      data[o + 3] = -g4 * sc;
      // 傾きの分散は Σ k²·E|h̃|²。E|h̃|² は h0 と conj(h0(-k)) の二乗和
      const cell = data[o] ** 2 + data[o + 1] ** 2 + data[o + 2] ** 2 + data[o + 3] ** 2;
      slopePower += (kx * kx + kz * kz) * cell;
    }
  }

  // 目標の実効傾きに合わせる。
  // Phillips は 1/k⁴ を持つので、振幅係数 A の意味が波数の縮尺で何桁も変わる。
  // 海（波長 100m 級）向けの A をそのまま 60cm の舟に使うと波が消える。
  // A は形だけ決めさせ、大きさはここで一度に正規化する。
  // √2 を掛けるのは、h0 と conj(h0(-k)) を独立に引いていて
  // エルミート対称になっていないため。IFFT の実部を取ると対称成分だけが
  // 残り、そのパワーは slopePower が測った値のちょうど半分になる
  const rms = Math.sqrt(slopePower);
  const scale = rms > 1e-30 ? (TARGET_SLOPE * Math.SQRT2) / rms : 0;
  for (let i = 0; i < data.length; i++) data[i] *= scale;
  return data;
}

/** 段ごとのツイドル因子と読み出し添字を並べた表。幅 log2N・高さ N。 */
function butterflyTable(N) {
  const bits = Math.log2(N) | 0;
  const rev = new Int32Array(N);
  for (let i = 0; i < N; i++) {
    let r = 0;
    for (let b = 0; b < bits; b++) r = (r << 1) | ((i >> b) & 1);
    rev[i] = r;
  }
  const data = new Float32Array(bits * N * 4);
  for (let stage = 0; stage < bits; stage++) {
    const span = 1 << stage;
    for (let y = 0; y < N; y++) {
      const k = ((y * N) / (span * 2)) % N;
      const ang = (2 * Math.PI * k) / N;      // 逆変換なので符号は +
      const wing = (y % (span * 2)) < span;
      let a, b;
      if (stage === 0) {
        if (wing) { a = rev[y]; b = rev[y + 1]; }
        else { a = rev[y - 1]; b = rev[y]; }
      } else {
        if (wing) { a = y; b = y + span; }
        else { a = y - span; b = y; }
      }
      const o = (y * bits + stage) * 4;
      data[o] = Math.cos(ang);
      data[o + 1] = Math.sin(ang);
      data[o + 2] = a;
      data[o + 3] = b;
    }
  }
  return { data, bits };
}

export class Ocean {
  constructor(gl, full) {
    this.gl = gl;
    this.full = full;
    this.wind = 0.34;   // 初期値。たらいの水はほとんど凪いでいる
    this.windDir = 0.6;
    this.amp = 0.10;   // たらいの水はほとんど凪いでいる
    this.N = 0;

    this.pSpectrum = new Program(gl, VS_FULL, FS_SPECTRUM, 'spectrum');
    this.pButterfly = new Program(gl, VS_FULL, FS_BUTTERFLY, 'butterfly');
    this.pAssemble = new Program(gl, VS_FULL, FS_ASSEMBLE, 'assemble');
    this.pNormal = new Program(gl, VS_FULL, FS_NORMAL, 'oceanNormal');
  }

  /** N を変えると格子に紐づく全テクスチャを作り直す。 */
  resize(N) {
    if (N === this.N) return;
    const gl = this.gl;
    this.dispose();
    this.N = N;
    this.bits = Math.log2(N) | 0;

    const t32 = () => makeTex(gl, N, N, 'rgba32f');
    this.ping = [[t32(), t32()], [t32(), t32()]];
    this.fboPing = [makeFbo(gl, this.ping[0]), makeFbo(gl, this.ping[1])];

    this.dispTex = makeTex(gl, N, N, 'rgba16f', { filter: 'linear', wrap: 'repeat' });
    this.normTex = makeTex(gl, N, N, 'rgba16f', { filter: 'linear', wrap: 'repeat' });
    this.fboDisp = makeFbo(gl, [this.dispTex]);
    this.fboNorm = makeFbo(gl, [this.normTex]);

    const bt = butterflyTable(N);
    this.bfTex = makeTex(gl, bt.bits, N, 'rgba32f', { data: bt.data });

    this.rebuildSpectrum();
  }

  rebuildSpectrum() {
    if (!this.N) return;
    const gl = this.gl;
    if (this.h0Tex) gl.deleteTexture(this.h0Tex);
    this.h0Tex = makeTex(gl, this.N, this.N, 'rgba32f', {
      data: phillipsH0(this.N, PATCH, this.wind, this.windDir),
    });
  }

  setWind(speed) {
    if (Math.abs(speed - this.wind) < 1e-4) return;
    this.wind = speed;
    this.rebuildSpectrum();
  }

  /** 1 フレーム分。変位マップと法線マップが更新される。 */
  update(time) {
    const gl = this.gl, N = this.N;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    // 1) スペクトル → ping[0]
    bindFbo(gl, this.fboPing[0]);
    this.pSpectrum.use()
      .tex('uH0', this.h0Tex)
      .setFloat('uTime', time)
      .setFloat('uPatch', PATCH)
      .setFloat('uDepth', TANK.depth)
      .setInt('uN', N);
    this.full.draw();

    // 2) バタフライ。横 bits 回 → 縦 bits 回
    let src = 0;
    const bf = this.pButterfly.use();
    bf.setInt('uStage', 0);
    for (let dir = 0; dir < 2; dir++) {
      for (let stage = 0; stage < this.bits; stage++) {
        const dst = 1 - src;
        bindFbo(gl, this.fboPing[dst]);
        this.pButterfly.use()
          .tex('uBf', this.bfTex)
          .tex('uSrc0', this.ping[src][0])
          .tex('uSrc1', this.ping[src][1])
          .setInt('uStage', stage)
          .setInt('uVertical', dir);
        this.full.draw();
        src = dst;
      }
    }

    // 3) 仕上げ
    bindFbo(gl, this.fboDisp);
    this.pAssemble.use()
      .tex('uSrc0', this.ping[src][0])
      .tex('uSrc1', this.ping[src][1])
      .setFloat('uAmp', this.amp)
      .setFloat('uChoppy', -1.0);
    this.full.draw();

    // 4) 勾配・泡・ラプラシアン
    bindFbo(gl, this.fboNorm);
    this.pNormal.use()
      .tex('uDisp', this.dispTex)
      .setInt('uN', N)
      .setFloat('uPatch', PATCH);
    this.full.draw();
  }

  dispose() {
    const gl = this.gl;
    if (!this.N) return;
    for (const pair of this.ping) for (const t of pair) gl.deleteTexture(t);
    for (const f of this.fboPing) gl.deleteFramebuffer(f.fb);
    gl.deleteTexture(this.dispTex);
    gl.deleteTexture(this.normTex);
    gl.deleteTexture(this.bfTex);
    gl.deleteFramebuffer(this.fboDisp.fb);
    gl.deleteFramebuffer(this.fboNorm.fb);
    this.N = 0;
  }
}
