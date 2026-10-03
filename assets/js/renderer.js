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

import { Program, FullScreen, makeTex, makeFbo, bindFbo, gridMesh } from './glx.js?v=202610031233';
import { VS_FULL } from '../shaders/common.js?v=202610031233';
import { FS_SKY, VS_TANK, FS_TANK, VS_WATER, FS_WATER, FS_FISHSHADOW } from '../shaders/scene.js?v=202610031233';
import { VS_FISH, FS_FISH, VS_POI, FS_POI } from '../shaders/actors.js?v=202610031233';
import { VS_TURTLE, FS_TURTLE } from '../shaders/turtle.js?v=202610031233';
import { FS_BRIGHT, FS_BLUR, FS_COMPOSITE, FS_FXAA } from '../shaders/post.js?v=202610031233';
import { VS_PAD, FS_PAD, VS_BUBBLE, FS_BUBBLE, VS_GEAR, FS_GEAR, VS_SPLASH, FS_SPLASH, VS_RAIN, FS_RAIN } from '../shaders/props.js?v=202610031233';
import { tankMesh, fishMesh, poiMesh, bowlMesh, turtleMesh, padMesh, bubbleMesh, gearMesh, splashMesh } from './meshes.js?v=202610031233';
import { Ocean } from './ocean.js?v=202610031233';
import { Ripple } from './ripple.js?v=202610031233';
import { TANK, PATCH, RIPPLE_SPAN, POI, BOWL, MAX_FISH, PAD, AIR, LANTERN, RAIN } from './world.js?v=202610031233';
import { sunFor, DEFAULT_HOUR, WEATHER } from './sky.js?v=202610031233';
import { mat4, perspective, lookAt, multiply, norm3, cross3, sub3 } from './mat.js?v=202610031233';

// 舟がいちばん張り出すのは縁の上端。地面の影と接地の陰りはここで取る
const TANK_OUTER = [
  TANK.halfX + TANK.draftX * TANK.rimTop + TANK.rimW,
  TANK.halfZ + TANK.draftZ * TANK.rimTop + TANK.rimW,
];
const TANK_OUTER_R = TANK.cornerR + TANK.draftX * TANK.rimTop + TANK.rimW;

/**
 * 屋台の天幕。高さ 2.2m、間口 4.8m・奥行 4m のパイプテント。
 * 舟は客が手を伸ばせるよう、天幕の前端より手前（z が大きい側）に置く。
 * だから日は直接当たり、水面が奥を向いて返す光だけが天幕に当たる。
 */
// 屋台の天幕。
//
// 手前の端を z = -0.55 に置いていたので、舟（z は ±0.27）の手前半分が
// 屋根の外に出ていた。左右も ±2.4m しかなく、水面の右側では反射光線が
// 端から外れて明るい空を映し、そこだけ白い帯になって波の模様が消えていた。
// 実際の屋台は、舟も店主も客の立つ所も屋根の下に入る。3.6×5.4m の
// 大きさに取り直し、舟の手前まで庇を出す。
const TENT = { y: 2.2, box: [-2.7, 2.7, -4.2, 1.05] };

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
    this.pTurtle = new Program(gl, VS_TURTLE, FS_TURTLE, 'turtle');
    this.pPad = new Program(gl, VS_PAD, FS_PAD, 'pad');
    this.pBubble = new Program(gl, VS_BUBBLE, FS_BUBBLE, 'bubble');
    this.pSplash = new Program(gl, VS_SPLASH, FS_SPLASH, 'splash');
    this.pRain = new Program(gl, VS_RAIN, FS_RAIN, 'rain');
    this.pGear = new Program(gl, VS_GEAR, FS_GEAR, 'gear');
    this.pBright = new Program(gl, VS_FULL, FS_BRIGHT, 'bright');
    this.pBlur = new Program(gl, VS_FULL, FS_BLUR, 'blur');
    this.pComp = new Program(gl, VS_FULL, FS_COMPOSITE, 'composite');
    this.pFxaa = new Program(gl, VS_FULL, FS_FXAA, 'fxaa');
    this.pFishShadow = new Program(gl, VS_FULL, FS_FISHSHADOW, 'fishShadow');

    this.mTank = tankMesh(gl);
    this.mFish = fishMesh(gl);
    this.mPoi = poiMesh(gl);
    this.mBowl = bowlMesh(gl);
    this.mTurtle = turtleMesh(gl);
    this.mPad = padMesh(gl);
    this.mBubble = bubbleMesh(gl, AIR.bubbles);
    this.mSplash = splashMesh(gl, 36);
    this.mRain = splashMesh(gl, RAIN.count);
    this.mGear = gearMesh(gl, -TANK.depth);
    this.stonePos = [AIR.stone[0], -TANK.depth + 0.014, AIR.stone[2]];
    // 金魚の影を焼く絵。画面の大きさとは関係ないので、ここで一度だけ作る。
    // 舟より一回り広く取るのは、影が屈折のぶん外へずれるため
    this.shadowArea = [TANK.halfX * 1.22, TANK.halfZ * 1.22];
    this.fboShadow = makeFbo(gl, [makeTex(gl, 256, 256, 'rgba8', { filter: 'linear' })]);
    this.mWater = gridMesh(gl, 220, 150);

    this.weather = WEATHER.CLEAR;
    this.wear = 1.0;
    this.setHour(DEFAULT_HOUR);

    // 縁の滑らか化。既定で入れる。FXAA なので経路が軽く、
    // 解像度を落として使うときほど効く
    this.wantAA = true;
    this.pitchDeg = 65;

    // 切り分け用。?plain で後処理を全部外し、?nodof で被写界深度だけ外す。
    // 「手元では出ないが実機で出る」類を、往復一回で切り分けるため
    const q = new URLSearchParams(location.search);
    this.plain = q.has('plain');
    this.noDof = this.plain || q.has('nodof');
    this.noBloom = this.plain || q.has('nobloom');

    this.proj = mat4();
    this.view = mat4();
    this.vp = mat4();
    this.cam = [0, 0.6, 0.9];
    this.basis = { right: [1, 0, 0], up: [0, 1, 0], fwd: [0, 0, -1] };

    this.w = 0; this.h = 0;
    this.dprScale = 0.7;   // 既定は軽い。これ以上だと実機で引っかかる
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
    this.wantAA = on;
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
      // 仕上げた 1 枚。FXAA はこれを読み直してならす
      ldr: makeFbo(gl, [makeTex(gl, w, h, 'rgba8', { filter: 'linear' })]),
    };
    this.updateCamera();
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

    // 舟の外寸はいちばん張り出す縁の上端で取る
    const acrossScreen = portrait ? TANK_OUTER[1] : TANK_OUTER[0];
    const intoScreen = portrait ? TANK_OUTER[0] : TANK_OUTER[1];
    // 余白はほとんど取らない。舟で画面を埋める
    const needW = (acrossScreen + 0.004) / (tanH * aspect);
    const needH = (intoScreen * Math.sin(pitch) + 0.030) / tanH;
    // 縦画面は、舟の比（0.67）と画面の比（0.46）が違うので、
    // 横を合わせると上下に 3 割の余白が出る。長辺の端を少しだけ切って詰める。
    // 切りすぎると側面の縁が消えて、舟が何だか分からなくなる
    const dist = Math.max(needW * (portrait ? 0.90 : 1.0), needH) * 1.005;

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
    this.yaw = yaw;
    this.toward = towardV;
    this.bowlPos = [
      rightV[0] * across + towardV[0] * toward,
      0,
      rightV[2] * across + towardV[2] * toward,
    ];
    BOWL.pos[0] = this.bowlPos[0];
    BOWL.pos[2] = this.bowlPos[2];

    // 提灯は画面の左右に 1 つずつ。縦画面でも横画面でも、
    // 遊んでいる人から見て「両脇から照らされている」形にする
    for (let i = 0; i < 2; i++) {
      const sx = i === 0 ? -LANTERN.across : LANTERN.across;
      LANTERN.pos[i] = [
        rightV[0] * sx + towardV[0] * LANTERN.toward,
        LANTERN.y,
        rightV[2] * sx + towardV[2] * LANTERN.toward,
      ];
    }


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
  setWeather(w) {
    this.weather = w;
    this.setHour(this.hour);
  }

  setHour(hour, yawDeg = this.sunYaw || 0) {
    this.hour = hour;
    this.sunYaw = yawDeg;
    const s = sunFor(hour, yawDeg, this.weather);
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
      // コースティクスの強さ。
      //
      // 明るさは水面の曲率に比例するので、波を低くすると素直に消える。
      // 物理としては正しいが、「波の高さ」のつまみを下げただけで
      // 水底の網目まで無くなってしまうのは意図と違う。
      // 波の高さで割り戻して、見え方をある程度そろえる。
      // 完全には割り戻さない（0.75 乗）ので、波を上げれば網目も強くなる
      .setFloat('uCausGain', 6.0 * s.direct * Math.pow(0.55 / Math.max(this.ocean.amp, 0.05), 0.75))
      // 汚しの強さ。0 で下ろしたて、1 で一夏使ったあと
      .setFloat('uWear', this.wear)
      // 屋台の天幕。舟より奥と真上を覆い、手前は開けておく。
      // 水面がこちらへ返す光は上と奥を向くので、そこを塞ぐと
      // 映り込みに構造が入り、灰色の靄が消える
      .setFloat('uTentY', TENT.y)
      .set('uTentBox', TENT.box)
      // 連提灯
      .set('uLanternCol', s.lantern)
      .vec4Array('uLanternP[0]', new Float32Array([
        LANTERN.pos[0][0], LANTERN.pos[0][1], LANTERN.pos[0][2], 0,
        LANTERN.pos[1][0], LANTERN.pos[1][1], LANTERN.pos[1][2], 0,
      ]), 2)
      // 幌布を透かしてくる光。白い布なので日向の空よりずっと暗く、
      // わずかに暖かい
      .set('uTentTint', [
        this.sun.sunColor[0] * 0.105 + this.sun.zenith[0] * 0.5,
        this.sun.sunColor[1] * 0.100 + this.sun.zenith[1] * 0.5,
        this.sun.sunColor[2] * 0.092 + this.sun.zenith[2] * 0.5,
      ]);
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
     .set('uTankHalf', [TANK.halfX, TANK.halfZ])
     .setFloat('uTankR', TANK.cornerR)
     .set('uTankDraft', [TANK.draftX, TANK.draftZ]);
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
      .setFloat('uYaw', this.yaw)
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
      .setFloat('uBulge', f.kind <= 1 ? 0.0 : 0.55)
      // 小赤は和金型（細長くフナ尾）、出目金は琉金型（短く丸く四つ尾）
      .setFloat('uFancy', f.kind <= 1 ? 0.0 : 1.0)
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

  /** 浮き葉。葉ごとに大きさと向きを変えて、同じ円板を描き直す。 */
  #drawPads(time) {
    const p = this.pPad.use();
    this.#lights(p); this.#water(p);
    p.mat4('uVP', this.vp).set('uCam', this.cam).setFloat('uTime', time);
    PAD.leaves.forEach((c, i) => {
      // 浮いた葉は水の動きでゆっくり流れて回る。
      // 貼り付いたまま動かないと、波を立てても葉だけ止まって見える
      const ph = i * 2.1;
      const dx = Math.sin(time * 0.11 + ph) * PAD.drift
               + Math.sin(time * 0.047 + ph * 1.7) * PAD.drift * 1.6;
      const dz = Math.cos(time * 0.093 + ph * 1.3) * PAD.drift
               + Math.cos(time * 0.039 + ph) * PAD.drift * 1.4;

      // お椀を避ける。
      //
      // 葉の置き場所は、お椀と重ならないように選んである。ただし
      // お椀は見下ろす角度で舟の中へ寄るので（真上にすると手前への
      // ずらしがほとんど効かなくなる）、表の値だけでは足りない。
      // 真上から見ると、葉が 6〜8cm お椀に食い込んでいた。
      // 置き場所を直してもまた角度で動くので、ここで押しのける。
      let px = c.x + dx, pz = c.z + dz;
      const bx = px - BOWL.pos[0], bz = pz - BOWL.pos[2];
      const keep = BOWL.outerR + c.r * 0.86;   // 葉は縁が波打つので少し食い込ませる
      const d = Math.hypot(bx, bz);
      if (d < keep) {
        const k = d > 1e-4 ? keep / d : 1;
        px = BOWL.pos[0] + bx * k;
        pz = BOWL.pos[2] + bz * k;
        // 押し出した先が舟の外に出ないように戻す
        px = Math.min(Math.max(px, -TANK.halfX + c.r), TANK.halfX - c.r);
        pz = Math.min(Math.max(pz, -TANK.halfZ + c.r), TANK.halfZ - c.r);
      }
      p.set('uPadPos', [px, pz])
       .setFloat('uPadR', c.r)
       .setFloat('uYaw', c.yaw + Math.sin(time * 0.055 + ph) * 0.22)
       .setFloat('uSeed', 0.137 + i * 0.311);
      this.mPad.draw();
    });
  }

  #drawFish(school, wantAbove, time) {
    const p = this.#fishProgram(time);
    for (const f of school.list) {
      if (f.gone || f.turtle) continue;
      if ((f.p[1] > -0.004) !== wantAbove) continue;
      this.#oneFish(p, f);
    }
    // 亀は別のプログラム
    let tp = null;
    for (const f of school.list) {
      if (f.gone || !f.turtle) continue;
      if ((f.p[1] > -0.004) !== wantAbove) continue;
      if (!tp) {
        tp = this.pTurtle.use();
        this.#lights(tp); this.#water(tp);
        tp.mat4('uVP', this.vp).set('uCam', this.cam).setFloat('uTime', time);
      }
      tp.set('uPos', f.p)
        .setFloat('uYaw', f.yaw)
        .setFloat('uLen', f.len)
        .setFloat('uPhase', f.phase)
        .setFloat('uBeat', f.beat)
        .setFloat('uSeed', f.seed);
      this.mTurtle.draw();
    }
  }

  render(state) {
    const gl = this.gl;
    const { time, school, poi } = state;

    // お椀は水面に浮かべてあるので、波に合わせて上下に揺れる。
    // 水面の高さを GPU から読み戻すのは高くつくので、
    // 波が穏やかな前提で、ゆるい二つの正弦で代える
    this.bowlPos[1] = Math.sin(time * 0.9) * 0.0024 + Math.sin(time * 1.37 + 1.1) * 0.0015;
    BOWL.pos[1] = this.bowlPos[1];

    this.ocean.update(time);
    this.ripple.update();

    gl.disable(gl.CULL_FACE);   // 薄いひれや内壁を両面で見せたいので切っておく

    // ---- 金魚の影を 1 枚に焼く ----
    bindFbo(gl, this.fboShadow);
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    {
      const p = this.pFishShadow.use();
      p.vec4Array('uFish[0]', school.shadowData(this.sunHoriz, this.refrTan), MAX_FISH)
       .vec4Array('uFishB[0]', school.shadowB, MAX_FISH)
       .setInt('uFishCount', school.shadowCount)
       .set('uArea', this.shadowArea);
      this.full.draw();
    }

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
        .set('uTankOuter2', TANK_OUTER)
        .set('uBowlPos', this.bowlPos)
        .tex('uFishShadow', this.fboShadow.tex[0])
        .set('uShadowArea', this.shadowArea);
      this.mTank.draw();
    }

    {
      const p = this.pGear.use();
      this.#lights(p); this.#water(p);
      p.mat4('uVP', this.vp).set('uCam', this.cam).setInt('uUnderwater', 1);
      this.mGear.draw();
    }
    // お椀の沈んでいる側は、水面を通して見える
    {
      const p = this.pTank.use();
      this.#lights(p); this.#water(p);
      p.mat4('uVP', this.vp).set('uCam', this.cam)
        .setInt('uUnderwater', 0)
        .setFloat('uDepth', TANK.depth)
        .setFloat('uBowlRim', BOWL.rimY)
        .setFloat('uGroundY', TANK.outBottom)
        .setFloat('uRimTop2', TANK.rimTop)
        .set('uTankOuter2', TANK_OUTER)
        .set('uBowlPos', this.bowlPos)
        .tex('uFishShadow', this.fboShadow.tex[0])
        .set('uShadowArea', this.shadowArea);
      this.mBowl.body.draw();
    }
    this.#drawFish(school, false, time);
    // ポイは水中パスにも必ず描く。
    //
    // 本パスでは水面より奥になった時点で深度に落とされる。閾値を
    // 「水面のすぐ上」に置いていたら、持ち上げる途中で波紋がポイより
    // 高く盛り上がった一瞬だけ、どちらにも描かれず消えていた。
    // 水の上にあるときに重ねて描いても、同じ絵が重なるだけで害はない
    if (poi.visible) this.#drawPoi(poi, true);

    // ---- 本パス ----
    bindFbo(gl, this.fbos.hdr);
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
        .set('uTankOuter2', TANK_OUTER)
        .set('uTankOuter', TANK_OUTER)
        .setFloat('uTankOuterR', TANK_OUTER_R)
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
        .set('uTankOuter2', TANK_OUTER)
        .set('uBowlPos', this.bowlPos)
        .tex('uFishShadow', this.fboShadow.tex[0])
        .set('uShadowArea', this.shadowArea);
      this.mTank.draw();
    }

    {
      const p = this.pGear.use();
      this.#lights(p); this.#water(p);
      p.mat4('uVP', this.vp).set('uCam', this.cam).setInt('uUnderwater', 0);
      this.mGear.draw();
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

    this.#drawPads(time);

    // 泡。水面より手前に重ねる。小さいので屈折までは追わない
    {
      // 水面より奥にあるので、素直に深度を見ると水面に落とされる。
      // 泡は小さいので、手前に重ねてしまって差し支えない
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
      gl.disable(gl.DEPTH_TEST);
      gl.depthMask(false);
      const p = this.pBubble.use();
      this.#lights(p);
      p.mat4('uVP', this.vp).set('uCam', this.cam)
        .set('uRight', this.basis.right)
        .set('uUp', this.basis.up)
        .set('uStone', this.stonePos)
        .setFloat('uCount', AIR.bubbles)
        .setFloat('uTime', time);
      this.mBubble.draw();

      // ポイの着水・離水の飛沫
      if (poi.splash > 0.001) {
        const sp = this.pSplash.use();
        this.#lights(sp);
        sp.mat4('uVP', this.vp).set('uCam', this.cam)
          .set('uRight', this.basis.right)
          .set('uUp', this.basis.up)
          .set('uAt', poi.splashAt)
          .setFloat('uAge', 1 - poi.splash)
          .setFloat('uRadius', POI.radius)
          .setFloat('uPower', poi.splashV)
          .setFloat('uOut', poi.splashIn ? 0 : 1);
        this.mSplash.draw();
      }

      // 雨。落ちてくる粒。着水の波紋は game.js が同じ式で落としている
      if (this.weather === 2) {
        const rp = this.pRain.use();
        this.#lights(rp);
        rp.mat4('uVP', this.vp).set('uCam', this.cam)
          .set('uRight', this.basis.right)
          .set('uArea', [TANK.halfX * 1.02, TANK.halfZ * 1.02])
          .set('uFall', [RAIN.fall, RAIN.speed, RAIN.tilt, RAIN.dir])
          .setFloat('uStreak', RAIN.streak)
          .setFloat('uCount', RAIN.count)
          .setFloat('uTime', time);
        this.mRain.draw();
      }

      gl.enable(gl.DEPTH_TEST);
      gl.depthMask(true);
      gl.disable(gl.BLEND);
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
        .set('uTankOuter2', TANK_OUTER)
        .set('uBowlPos', this.bowlPos)
        .tex('uFishShadow', this.fboShadow.tex[0])
        .set('uShadowArea', this.shadowArea);
      this.mBowl.body.draw();
    }
    if (state.bowl && state.bowl.length) {
      const p = this.#fishProgram(time);
      for (const f of state.bowl) if (!f.turtle) this.#oneFish(p, f);
      let tp = null;
      for (const f of state.bowl) {
        if (!f.turtle) continue;
        if (!tp) {
          tp = this.pTurtle.use();
          this.#lights(tp); this.#water(tp);
          tp.mat4('uVP', this.vp).set('uCam', this.cam).setFloat('uTime', time);
        }
        tp.set('uPos', f.p).setFloat('uYaw', f.yaw).setFloat('uLen', f.len)
          .setFloat('uPhase', f.phase).setFloat('uBeat', f.beat).setFloat('uSeed', f.seed);
        this.mTurtle.draw();
      }
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
        .set('uTankOuter2', TANK_OUTER)
        .set('uBowlPos', this.bowlPos)
        .tex('uFishShadow', this.fboShadow.tex[0])
        .set('uShadowArea', this.shadowArea);
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
    // 切り分けで外されていれば飛ばす
    // 焦点距離 1m・画角 46° の実物のカメラなら、この距離の被写界深度は
    // かなり浅い。手前と奥がわずかに溶けるだけで、写真らしさが出る
    bindFbo(gl, this.fbos.dofA);
    this.pBlur.use().tex('uSrc', this.fbos.hdr.tex[0]).set('uDir', [1 / bw, 0]);
    this.full.draw();
    bindFbo(gl, this.fbos.dofB);
    this.pBlur.use().tex('uSrc', this.fbos.dofA.tex[0]).set('uDir', [0, 1 / bh]);
    this.full.draw();

    // 縁の滑らか化を入れるときは、いったんテクスチャへ描いてから読み直す
    if (this.wantAA) bindFbo(gl, this.fbos.ldr);
    else { gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.w, this.h); }
    this.pComp.use()
      .tex('uSrc', this.fbos.hdr.tex[0])
      .tex('uBloom', this.fbos.bright.tex[0])
      .tex('uDof', this.fbos.dofB.tex[0])
      .setFloat('uFocus', Math.hypot(this.cam[0], this.cam[1], this.cam[2]))
      .setFloat('uDofScale', this.noDof ? 0.0 : 0.62)
      .setFloat('uBloomOff', this.noBloom ? 0.0 : 1.0)
      .setFloat('uPlain', this.plain ? 1.0 : 0.0)
      .setFloat('uBloomAmt', 0.22)
      .setFloat('uExposure', this.sun.exposure)
      .setFloat('uTime', time);
    this.full.draw();

    if (this.wantAA) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.w, this.h);
      this.pFxaa.use()
        .tex('uSrc', this.fbos.ldr.tex[0])
        .set('uTexel', [1 / this.w, 1 / this.h]);
      this.full.draw();
    }
  }
}
