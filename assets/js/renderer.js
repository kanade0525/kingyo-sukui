// 描画。パスの並びは下の render() を読めば分かるようにしてある。
//
//   1. FFT と波紋を進める
//   2. 水中パス … 底・内壁・沈んでいる金魚を FBO へ。α にカメラからの距離を入れる
//   3. 本パス   … 空と太陽・舟・水面・水上の金魚・器・ポイ
//   4. 仕上げ   … 明るい所を抜いてぼかし、足してトーンマップ
//
// 水面の屈折は 2 のテクスチャを screen space で読み直している。
// 板ポリで近似せず、屈折方向に進めた点を投影し直すので、
// 浅い角度でも金魚が水面の起伏に沿って歪む。

import { Program, FullScreen, makeTex, makeFbo, bindFbo, gridMesh } from './glx.js';
import { VS_FULL } from '../shaders/common.js';
import { FS_SKY, VS_TANK, FS_TANK, VS_WATER, FS_WATER } from '../shaders/scene.js';
import { VS_FISH, FS_FISH, VS_POI, FS_POI } from '../shaders/actors.js';
import { FS_BRIGHT, FS_BLUR, FS_COMPOSITE } from '../shaders/post.js';
import { tankMesh, fishMesh, poiMesh, bowlMesh } from './meshes.js';
import { Ocean } from './ocean.js';
import { Ripple } from './ripple.js';
import { TANK, PATCH, RIPPLE_SPAN, POI, BOWL, MAX_FISH } from './world.js';
import { sunFor, DEFAULT_HOUR } from './sky.js';
import { mat4, perspective, lookAt, multiply, norm3, cross3, sub3 } from './mat.js';

const DEG = Math.PI / 180;
const FOV_Y = 46 * DEG;

export class Renderer {
  constructor(canvas) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,        // FBO 経由なのでここの MSAA は効かない
      depth: false,
      powerPreference: 'high-performance',
    });
    if (!gl) throw new Error('WebGL2 が取れません');
    if (!gl.getExtension('EXT_color_buffer_float')) {
      throw new Error('EXT_color_buffer_float がありません（浮動小数点の FBO が作れず、FFT を解けません）');
    }
    this.gl = gl;
    this.canvas = canvas;
    this.full = new FullScreen(gl);

    this.ocean = new Ocean(gl, this.full);
    this.ocean.resize(256);
    this.ripple = new Ripple(gl, this.full);

    this.pSky = new Program(gl, VS_FULL, FS_SKY, 'sky');
    this.pTank = new Program(gl, VS_TANK, FS_TANK, 'tank');
    this.pWater = new Program(gl, VS_WATER, FS_WATER, 'water');
    this.pFish = new Program(gl, VS_FISH, FS_FISH, 'fish');
    this.pPoi = new Program(gl, VS_POI, FS_POI, 'poi');
    this.pBright = new Program(gl, VS_FULL, FS_BRIGHT, 'bright');
    this.pBlur = new Program(gl, VS_FULL, FS_BLUR, 'blur');
    this.pComp = new Program(gl, VS_FULL, FS_COMPOSITE, 'composite');

    this.mTank = tankMesh(gl);
    this.mFish = fishMesh(gl);
    this.mPoi = poiMesh(gl);
    this.mBowl = bowlMesh(gl);
    this.mWater = gridMesh(gl, 220, 150);

    this.setHour(DEFAULT_HOUR);

    // 既定では切る。上の #makeMsaa のコメントを参照
    this.wantMsaa = false;
    this.pitchDeg = 65;

    this.proj = mat4();
    this.view = mat4();
    this.vp = mat4();
    this.cam = [0, 0.6, 0.9];
    this.basis = { right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1] };

    this.w = 0; this.h = 0;
    this.dprScale = 1;
    this.fbos = null;
  }

  setFftSize(n) { this.ocean.resize(n); }
  setWind(v) { this.ocean.setWind(v); }
  setAmp(v) { this.ocean.amp = v; }

  setPitch(deg) {
    if (this.pitchDeg === deg) return;
    this.pitchDeg = deg;
    this.updateCamera();
  }

  setMsaa(on) {
    if (this.wantMsaa === on) return;
    this.wantMsaa = on;
    this.resize(true);
  }

  setDpr(scale) {
    this.dprScale = scale;
    this.resize(true);
  }

  resize(force = false) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, 2) * this.dprScale;
    const w = Math.max(2, Math.round(this.canvas.clientWidth * dpr));
    const h = Math.max(2, Math.round(this.canvas.clientHeight * dpr));
    if (!force && w === this.w && h === this.h) return;
    this.w = w; this.h = h;
    this.canvas.width = w;
    this.canvas.height = h;

    if (this.fbos) {
      for (const f of Object.values(this.fbos)) {
        gl.deleteFramebuffer(f.fb);
        for (const t of f.tex) gl.deleteTexture(t);
        if (f.rb) gl.deleteRenderbuffer(f.rb);
      }
    }
    const bw = Math.max(2, w >> 2), bh = Math.max(2, h >> 2);
    this.fbos = {
      scene: makeFbo(gl, [makeTex(gl, w, h, 'rgba16f', { filter: 'linear' })], { depth: true }),
      hdr: makeFbo(gl, [makeTex(gl, w, h, 'rgba16f', { filter: 'linear' })], { depth: true }),
      bright: makeFbo(gl, [makeTex(gl, bw, bh, 'rgba16f', { filter: 'linear' })]),
      blur: makeFbo(gl, [makeTex(gl, bw, bh, 'rgba16f', { filter: 'linear' })]),
      dofA: makeFbo(gl, [makeTex(gl, bw, bh, 'rgba16f', { filter: 'linear' })]),
      dofB: makeFbo(gl, [makeTex(gl, bw, bh, 'rgba16f', { filter: 'linear' })]),
    };
    this.#makeMsaa(w, h);
    this.updateCamera();
  }

  /**
   * 本パスだけ多重標本化する。
   *
   * FBO 越しに描いているので、キャンバスの MSAA は効かない。
   * 金魚のひれや舟の角のような細い輪郭が 1 画素ずつギザつくと、
   * どれだけ水を作り込んでも「CG の絵」に見える。
   * 多重標本のレンダーバッファへ描いて、解決してからテクスチャへ blit する。
   *
   * ただし既定では切ってある。タイル単位で描く GPU（Apple Silicon など）で、
   * RGBA16F の多重標本を blit で解決すると、タイルがそのまま黒く抜けることが
   * あるため。設定から入れられるようにして、効く環境でだけ使う。
   */
  #makeMsaa(w, h) {
    const gl = this.gl;
    this.#dropMsaa();
    if (!this.wantMsaa) { this.msaa = null; return; }
    const max = gl.getParameter(gl.MAX_SAMPLES) || 0;
    const samples = Math.min(4, max);
    if (samples < 2) { this.msaa = null; return; }
    try {
      const col = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, col);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.RGBA16F, w, h);
      const dep = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, dep);
      gl.renderbufferStorageMultisample(gl.RENDERBUFFER, samples, gl.DEPTH_COMPONENT24, w, h);
      const fb = gl.createFramebuffer();
      gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, col);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, dep);
      const ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (!ok) throw new Error('多重標本の FBO が不完全');
      this.msaa = { fb, col, dep, w, h, bufs: [gl.COLOR_ATTACHMENT0], tex: [], samples };
    } catch (e) {
      console.warn('MSAA を使えないので、そのまま描きます:', e.message);
      this.msaa = null;
    }
  }

  #dropMsaa() {
    const gl = this.gl;
    if (!this.msaa) return;
    gl.deleteFramebuffer(this.msaa.fb);
    gl.deleteRenderbuffer(this.msaa.col);
    gl.deleteRenderbuffer(this.msaa.dep);
    this.msaa = null;
  }

  /**
   * 舟が画面に収まる位置へカメラを置く。
   * 縦長の画面では 90° 回り込み、舟の長辺を画面の縦に取る。
   *
   * 真上寄りから覗き込む構図。水面の向こうに金魚がはっきり見える。
   */
  updateCamera() {
    const aspect = this.w / this.h;
    const portrait = aspect < 0.95;
    this.portrait = portrait;
    const yaw = portrait ? Math.PI / 2 : 0;
    // 見下ろす角度。倒すほど手前の壁の厚みが見え、立てるほど
     // 水面が素直に見える。90 度ちょうどは lookAt が縮退するので 87 度止まり
    const pitch = this.pitchDeg * DEG;
    const tanH = Math.tan(FOV_Y / 2);

    const rim = TANK.rimW;
    const acrossScreen = (portrait ? TANK.halfZ : TANK.halfX) + rim;
    const intoScreen = (portrait ? TANK.halfX : TANK.halfZ) + rim;
    const needW = (acrossScreen + 0.035) / (tanH * aspect);
    const needH = (intoScreen * Math.sin(pitch) + 0.085) / tanH;
    // 縦画面は横の制約が厳しく、素直に合わせると上下が大きく余る。
    // 画面の短辺に寄せて詰める
    const dist = portrait
      ? Math.max(needW * 1.02, needH * 1.06)
      : Math.max(needW * 1.10, needH * 1.12);

    const base = [0, -0.01, 0];
    const eye = [
      base[0] + Math.sin(yaw) * Math.cos(pitch) * dist,
      base[1] + Math.sin(pitch) * dist,
      base[2] + Math.cos(yaw) * Math.cos(pitch) * dist,
    ];
    // ほぼ真下を向くので、狙う点は舟の中心のすぐ奥
    const target = [-Math.sin(yaw) * 0.02, 0.0, -Math.cos(yaw) * 0.02];
    this.cam = eye;
    perspective(this.proj, FOV_Y, aspect, 0.02, 12);
    lookAt(this.view, eye, target, [0, 1, 0]);
    multiply(this.vp, this.proj, this.view);

    // 太陽もカメラと一緒に回す。回さないと、縦画面でだけ
    // きらめきの出方が変わってしまう
    this.setHour(this.hour, (yaw * 180) / Math.PI);

    // 器は画面基準で置く。カメラの右方向と手前方向へずらすだけ
    const across = portrait ? BOWL.acrossPortrait : BOWL.across;
    // 真上に近づくほど「手前」は画面でほとんど動かないので、横へ寄せる
    const lean = Math.cos(pitch) / Math.cos(65 * DEG);
    const toward = (portrait ? BOWL.towardPortrait : BOWL.toward) * lean;
    const rightV = [Math.cos(yaw), 0, -Math.sin(yaw)];     // 画面の右
    const towardV = [Math.sin(yaw), 0, Math.cos(yaw)];     // 画面の手前
    this.bowlPos = [
      rightV[0] * across + towardV[0] * toward,
      0,
      rightV[2] * across + towardV[2] * toward,
    ];
    BOWL.pos[0] = this.bowlPos[0];
    BOWL.pos[2] = this.bowlPos[2];


    const fwd = norm3(sub3(target, eye));
    const right = norm3(cross3(fwd, [0, 1, 0]));
    this.basis = { fwd, right, up: cross3(right, fwd) };
    this.tanH = tanH;
    this.aspect = aspect;
  }

  /** 画面の正規化座標 (-1..1) から、水面 y=0 の上の点を求める。 */
  pickWater(ndcX, ndcY) {
    const { fwd, right, up } = this.basis;
    const d = norm3([
      fwd[0] + right[0] * ndcX * this.tanH * this.aspect + up[0] * ndcY * this.tanH,
      fwd[1] + right[1] * ndcX * this.tanH * this.aspect + up[1] * ndcY * this.tanH,
      fwd[2] + right[2] * ndcX * this.tanH * this.aspect + up[2] * ndcY * this.tanH,
    ]);
    if (Math.abs(d[1]) < 1e-5) return null;
    const t = -this.cam[1] / d[1];
    if (t < 0) return null;
    return [this.cam[0] + d[0] * t, this.cam[2] + d[2] * t];
  }

  /** 時刻から太陽と空を決める。後で夕方や実時刻へ差し替えられるよう、
   *  光の条件はすべてこの一箇所から配る。 */
  setHour(hour, yawDeg = this.sunYaw || 0) {
    this.hour = hour;
    this.sunYaw = yawDeg;
    const s = sunFor(hour, yawDeg);
    this.sun = s;
    // 水中での屈折角。コースティクスの横ずれに使う
    const sinA = Math.max(Math.cos(s.elev), 0);        // 天頂からの角の sin
    const sinT = Math.min(sinA / 1.333, 0.9995);
    this.refrTan = sinT / Math.sqrt(Math.max(1 - sinT * sinT, 1e-6));
    const hx = Math.hypot(s.dir[0], s.dir[2]) || 1;
    this.sunHoriz = [s.dir[0] / hx, s.dir[2] / hx];
  }

  #lights(p) {
    const s = this.sun;
    p.set('uSunDir', s.dir)
      .set('uSunColor', s.sunColor)
      .set('uSkyZenith', s.zenith)
      .set('uSkyHorizon', s.horizon)
      .set('uSkyGround', s.ground)
      .setFloat('uHaze', s.haze)
      .setFloat('uWarmth', s.warmth)
      // 分散コースティクス。(1 − 1/n) を 3 波長ぶん。
      // 実際の水の分散では 16cm の水深で見えないので、広がりは誇張してある
      .set('uCausC', [0.2425, 0.2502, 0.2578])
      .set('uSunHoriz', this.sunHoriz)
      .setFloat('uRefrTan', this.refrTan)
            // 水深 16cm の舟では、屈折のずれが小さすぎてコースティクスがほとんど
      // 出ない（clearwater は水深 1.6m）。見える強さまで誇張している
      .setFloat('uCausGain', 6.0);
    return p;
  }

  /** 水面のテクスチャ 3 枚と、それを読むための寸法。 */
  #water(p) {
    p.tex('uDisp', this.ocean.dispTex)
     .tex('uNormF', this.ocean.normTex)
     .tex('uRipN', this.ripple.normTex)
     .setFloat('uPatch', PATCH)
     .setFloat('uFftN', this.ocean.N)
     .setFloat('uRipSpan', RIPPLE_SPAN)
     .set('uTankHalf', [TANK.halfX, TANK.halfZ]);
    return p;
  }

  #drawPoi(poi, underwater) {
    const p = this.pPoi.use();
    this.#lights(p);
    p.mat4('uVP', this.vp).set('uCam', this.cam)
      .set('uPos', [poi.x, poi.y, poi.z])
      .set('uTiltAxis', poi.tiltAxis)
      .setFloat('uTilt', poi.tilt)
      .setFloat('uSag', poi.sag)
      .setFloat('uRadius', POI.radius)
      .setFloat('uHealth', poi.health)
      .setFloat('uWet', poi.wet)
      .setFloat('uSeed', poi.seed)
      .setInt('uUnderwater', underwater ? 1 : 0);
    this.mPoi.draw();
  }

  #oneFish(p, f) {
    p.set('uPos', f.p)
      .setFloat('uYaw', f.yaw)
      .setFloat('uLen', f.len)
      .setFloat('uPhase', f.phase)
      .setFloat('uBeat', f.beat)
      .setFloat('uBend', f.bend || 0)
      .setFloat('uBulge', f.kind === 2 ? 0.55 : 0.0)
      .setFloat('uSeed', f.seed)
      .setInt('uKind', f.kind);
    this.mFish.draw();
  }

  #fishProgram(time) {
    const p = this.pFish.use();
    this.#lights(p);
    this.#water(p);          // 体に落ちるコースティクスのため
    p.mat4('uVP', this.vp).set('uCam', this.cam).setFloat('uTime', time);
    return p;
  }

  #drawFish(school, wantAbove, time) {
    const p = this.#fishProgram(time);
    for (const f of school.list) {
      if (f.gone) continue;
      if ((f.p[1] > -0.004) !== wantAbove) continue;
      this.#oneFish(p, f);
    }
  }

  render(state) {
    const gl = this.gl;
    const { time, school, poi } = state;

    this.ocean.update(time);
    this.ripple.update();

    gl.disable(gl.CULL_FACE);   // 薄いひれや内壁を両面で見せたいので切っておく

    // ---- 水中パス ----
    bindFbo(gl, this.fbos.scene);
    // depthMask は clear より先に戻すこと。false のまま clear すると
    // 深度の消去がマスクされ、前フレームの深度が残る。すると金魚の形に
    // 底がくり抜かれ、水面がそこを「何も無い」と読んで黒く塗る
    gl.depthMask(true);
    gl.enable(gl.DEPTH_TEST);
    gl.depthFunc(gl.LEQUAL);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 0);
    gl.clearDepth(1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    {
      const p = this.pTank.use();
      this.#lights(p); this.#water(p);
      p.mat4('uVP', this.vp).set('uCam', this.cam)
        .setInt('uUnderwater', 1)
        .setFloat('uDepth', TANK.depth)
        .setFloat('uBowlRim', BOWL.rimY)
        .setFloat('uGroundY', TANK.outBottom)
        .setFloat('uRimTop2', TANK.rimTop)
        .set('uBowlPos', this.bowlPos)
        .vec4Array('uFish[0]', school.shadowData(this.sunHoriz, this.refrTan), MAX_FISH)
        .setInt('uFishCount', school.shadowCount);
      this.mTank.draw();
    }
    this.#drawFish(school, false, time);
    // 沈めたポイは水面に隠れてしまうので、水中パスにも描く
    if (poi.visible && poi.y < 0.02) this.#drawPoi(poi, true);

    // ---- 本パス ----
    const main = this.msaa || this.fbos.hdr;
    bindFbo(gl, main);
    gl.depthMask(true);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);
    {
      const p = this.pSky.use();
      this.#lights(p);
      p.set('uCam', this.cam)
        .set('uRight', this.basis.right)
        .set('uUp', this.basis.up)
        .set('uFwd', this.basis.fwd)
        .setFloat('uTanHalf', this.tanH)
        .setFloat('uAspect', this.aspect)
        .setFloat('uGroundY', TANK.outBottom)
        .setFloat('uRimTop2', TANK.rimTop)
        .set('uTankOuter', [TANK.halfX + TANK.rimW, TANK.halfZ + TANK.rimW])
        .setFloat('uRimTop', TANK.rimTop)
        .set('uBowlPos', this.bowlPos)
        .setFloat('uBowlR', BOWL.outerR)
        .setFloat('uBowlRimY', BOWL.rimY)
        .setFloat('uTime', time);
      this.full.draw();
    }
    gl.enable(gl.DEPTH_TEST);
    gl.depthMask(true);

    {
      const p = this.pTank.use();
      this.#lights(p); this.#water(p);
      p.mat4('uVP', this.vp).set('uCam', this.cam)
        .setInt('uUnderwater', 0)
        .setFloat('uDepth', TANK.depth)
        .setFloat('uBowlRim', BOWL.rimY)
        .setFloat('uGroundY', TANK.outBottom)
        .setFloat('uRimTop2', TANK.rimTop)
        .set('uBowlPos', this.bowlPos)
        .setInt('uFishCount', 0);
      this.mTank.draw();
    }

    {
      const p = this.pWater.use();
      this.#lights(p); this.#water(p);
      p.mat4('uVP', this.vp).set('uCam', this.cam)
        .tex('uScene', this.fbos.scene.tex[0])
        .set('uRes', [this.w, this.h])
        .setFloat('uDepth', TANK.depth)
        .setFloat('uTime', time);
      this.mWater.draw();
    }

    this.#drawFish(school, true, time);

    // 手元の器。本体 → 中の金魚 → 水面、の順に重ねる
    {
      const p = this.pTank.use();
      this.#lights(p); this.#water(p);
      p.mat4('uVP', this.vp).set('uCam', this.cam)
        .setInt('uUnderwater', 0)
        .setFloat('uDepth', TANK.depth)
        .setFloat('uBowlRim', BOWL.rimY)
        .setFloat('uGroundY', TANK.outBottom)
        .setFloat('uRimTop2', TANK.rimTop)
        .set('uBowlPos', this.bowlPos)
        .setInt('uFishCount', 0);
      this.mBowl.body.draw();
    }
    if (state.bowl && state.bowl.length) {
      const p = this.#fishProgram(time);
      for (const f of state.bowl) this.#oneFish(p, f);
    }
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.depthMask(false);
    {
      const p = this.pTank.use();
      this.#lights(p); this.#water(p);
      p.mat4('uVP', this.vp).set('uCam', this.cam)
        .setInt('uUnderwater', 0)
        .setFloat('uDepth', TANK.depth)
        .setFloat('uBowlRim', BOWL.rimY)
        .setFloat('uGroundY', TANK.outBottom)
        .setFloat('uRimTop2', TANK.rimTop)
        .set('uBowlPos', this.bowlPos)
        .setInt('uFishCount', 0);
      this.mBowl.water.draw();
    }
    gl.depthMask(true);
    gl.disable(gl.BLEND);

    if (poi.visible) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);      // 半透明の紙が深度を書くと、紙の裏の枠が落ちる
      this.#drawPoi(poi, false);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
    }

    // 多重標本を解決して、普通のテクスチャに戻す
    if (this.msaa) {
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.msaa.fb);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.fbos.hdr.fb);
      gl.blitFramebuffer(0, 0, this.w, this.h, 0, 0, this.w, this.h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }

    // ---- 仕上げ ----
    gl.disable(gl.DEPTH_TEST);
    gl.depthMask(false);

    bindFbo(gl, this.fbos.bright);
    this.pBright.use().tex('uSrc', this.fbos.hdr.tex[0]).setFloat('uThreshold', 1.25);
    this.full.draw();

    const bw = this.fbos.bright.w, bh = this.fbos.bright.h;
    bindFbo(gl, this.fbos.blur);
    this.pBlur.use().tex('uSrc', this.fbos.bright.tex[0]).set('uDir', [1 / bw, 0]);
    this.full.draw();
    bindFbo(gl, this.fbos.bright);
    this.pBlur.use().tex('uSrc', this.fbos.blur.tex[0]).set('uDir', [0, 1 / bh]);
    this.full.draw();

    // 被写界深度用のぼかし。1/4 に落として 2 回ぼかすだけ。
    // 焦点距離 1m・画角 46° の実物のカメラなら、この距離の被写界深度は
    // かなり浅い。手前と奥がわずかに溶けるだけで、写真らしさが出る
    bindFbo(gl, this.fbos.dofA);
    this.pBlur.use().tex('uSrc', this.fbos.hdr.tex[0]).set('uDir', [1 / bw, 0]);
    this.full.draw();
    bindFbo(gl, this.fbos.dofB);
    this.pBlur.use().tex('uSrc', this.fbos.dofA.tex[0]).set('uDir', [0, 1 / bh]);
    this.full.draw();

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.w, this.h);
    this.pComp.use()
      .tex('uSrc', this.fbos.hdr.tex[0])
      .tex('uBloom', this.fbos.bright.tex[0])
      .tex('uDof', this.fbos.dofB.tex[0])
      .setFloat('uFocus', Math.hypot(this.cam[0], this.cam[1], this.cam[2]))
      .setFloat('uDofScale', 0.62)
      .setFloat('uBloomAmt', 0.22)
      .setFloat('uExposure', this.sun.exposure)
      .setFloat('uTime', time);
    this.full.draw();
  }
}
