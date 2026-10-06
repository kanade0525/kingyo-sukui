// 波紋の駆動。2D 波動方程式をピンポンで 1 フレーム 2 回進める。
//
// 2 回に分けているのは伝播速度の都合。格子は 1 ステップで 1 マスしか
// 進めないので、1 フレーム 1 回だと 256 格子 1m では波が遅すぎて、
// 水を叩いた輪が広がる前に減衰してしまう。

import { Program, makeTex, makeFbo, bindFbo } from './glx.js?v=202610060015';
import { VS_FULL } from '../shaders/common.js?v=202610060015';
import { FS_STEP, FS_NORMAL } from '../shaders/ripple.js?v=202610060015';
import { RIPPLE_N, RIPPLE_SPAN, TANK } from './world.js?v=202610060015';

const MAX_DROPS = 12;

export class Ripple {
  /**
   * 格子の数と、覆う広さを渡せる。
   *
   * 既定は舟（256 格子で 1m。1 升 3.9mm）。家の鉢はずっと小さいので、
   * 同じ升目の大きさのまま 64 格子・0.22m で立てる。画素数は 1/16。
   * 升の物理サイズが揃うので、波の速さ（1 ステップ 1 升）も自然に揃う。
   */
  constructor(gl, full, { n = RIPPLE_N, span = RIPPLE_SPAN, half = null } = {}) {
    this.gl = gl;
    this.full = full;
    const N = n;
    this.N = N;
    this.span = span;
    // 波の壁。渡さなければ舟の内寸
    this.half = half ?? [TANK.halfX, TANK.halfZ];

    this.h = [makeTex(gl, N, N, 'rgba32f'), makeTex(gl, N, N, 'rgba32f')];
    this.fbo = [makeFbo(gl, [this.h[0]]), makeFbo(gl, [this.h[1]])];
    this.cur = 0;

    this.normTex = makeTex(gl, N, N, 'rgba16f', { filter: 'linear' });
    this.fboNorm = makeFbo(gl, [this.normTex]);

    this.pStep = new Program(gl, VS_FULL, FS_STEP, 'rippleStep');
    this.pNorm = new Program(gl, VS_FULL, FS_NORMAL, 'rippleNormal');

    this.drops = new Float32Array(MAX_DROPS * 4);
    this.dropCount = 0;

    // 初期化（両面を 0 に）
    for (let i = 0; i < 2; i++) {
      bindFbo(gl, this.fbo[i]);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
    }
  }

  /**
   * 波源を積む。x, z はワールド座標、radius はメートル、amp は高さ。
   * 1 フレームに積めるのは MAX_DROPS まで。溢れた分は捨てる。
   */
  drop(x, z, radius, amp) {
    if (this.dropCount >= MAX_DROPS) return;
    const o = this.dropCount * 4;
    this.drops[o] = x / this.span + 0.5;
    this.drops[o + 1] = z / this.span + 0.5;
    this.drops[o + 2] = radius / this.span;
    this.drops[o + 3] = amp;
    this.dropCount++;
  }

  update() {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.BLEND);

    for (let step = 0; step < 2; step++) {
      const dst = 1 - this.cur;
      bindFbo(gl, this.fbo[dst]);
      const p = this.pStep.use()
        .tex('uPrev', this.h[this.cur])
        .setInt('uN', this.N)
        .setFloat('uK', 0.42)
        .setFloat('uDamp', 0.9955)
        .set('uTankHalf', this.half)
        .setFloat('uSpan', this.span)
        // 波源は 1 回目のステップにだけ入れる。2 回入れると倍の力で叩くことになる
        .setInt('uDropCount', step === 0 ? this.dropCount : 0);
      if (step === 0 && this.dropCount > 0) {
        p.vec4Array('uDrops[0]', this.drops, this.dropCount);
      }
      this.full.draw();
      this.cur = dst;
    }
    this.dropCount = 0;

    bindFbo(gl, this.fboNorm);
    this.pNorm.use()
      .tex('uH', this.h[this.cur])
      .setInt('uN', this.N)
      .setFloat('uSpan', this.span);
    this.full.draw();
  }
}
