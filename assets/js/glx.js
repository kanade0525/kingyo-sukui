// WebGL2 の薄い被せ物。プログラム・テクスチャ・FBO・メッシュを作る所だけ。
//
// なぜ自前で書くか: 依存を増やさないため。ここで要るのは MRT 付きの FBO と
// 浮動小数点テクスチャのピンポンだけで、汎用ライブラリの持つ機能はほぼ使わない。
//
// uniform は名前→location を一度引いて持ち、set() で型を見て振り分ける。
// 毎フレーム getUniformLocation を呼ぶと、それだけで目に見えて遅くなる。

export class Program {
  constructor(gl, vsSrc, fsSrc, name) {
    this.gl = gl;
    this.name = name;
    const vs = compile(gl, gl.VERTEX_SHADER, vsSrc, name + ':vs');
    const fs = compile(gl, gl.FRAGMENT_SHADER, fsSrc, name + ':fs');
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fs);
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
      throw new Error(`[${name}] link 失敗: ${gl.getProgramInfoLog(p)}`);
    }
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    this.p = p;
    this.loc = new Map();
    this.unit = 0; // use() ごとに 0 に戻すテクスチャユニットの割り当て番号
  }

  use() {
    this.gl.useProgram(this.p);
    // ユニット 0 に戻す。makeTex の bindTexture は「その時アクティブな
    // ユニット」に効くので、進めたままだと別の結び付きを潰す
    this.gl.activeTexture(this.gl.TEXTURE0);
    this.unit = 0;
    return this;
  }

  at(name) {
    return this.gl.getAttribLocation(this.p, name);
  }

  #loc(name) {
    if (!this.loc.has(name)) this.loc.set(name, this.gl.getUniformLocation(this.p, name));
    return this.loc.get(name);
  }

  /**
   * 値の形から uniform の型を決める。
   *
   * 数値は必ず float として送る。int には setInt、mat4 には mat4 を使うこと。
   * 以前は「長さ 16 の配列は mat4」と推測していたが、vec4 をちょうど 4 つ
   * 送ったときに mat4 として撃ってしまい、GL_INVALID_OPERATION になっていた。
   * 長さで型を当てる限り同じ事故が起きるので、推測をやめた。
   */
  set(name, v) {
    const gl = this.gl;
    const l = this.#loc(name);
    if (l === null) return this; // 最適化で消えた uniform は黙って無視
    if (typeof v === 'number') gl.uniform1f(l, v);
    else if (typeof v === 'boolean') gl.uniform1i(l, v ? 1 : 0);
    else if (v.length === 2) gl.uniform2fv(l, v);
    else if (v.length === 3) gl.uniform3fv(l, v);
    else gl.uniform4fv(l, v);
    return this;
  }

  mat4(name, m) {
    const l = this.#loc(name);
    if (l !== null) this.gl.uniformMatrix4fv(l, false, m);
    return this;
  }

  /** vec4 の配列。名前は "uFoo[0]" の形で引く。 */
  vec4Array(name, arr, count) {
    const l = this.#loc(name);
    if (l === null) return this;
    this.gl.uniform4fv(l, count === undefined ? arr : arr.subarray(0, count * 4));
    return this;
  }

  setInt(name, v) {
    const l = this.#loc(name);
    if (l !== null) this.gl.uniform1i(l, v);
    return this;
  }

  setFloat(name, v) {
    const l = this.#loc(name);
    if (l !== null) this.gl.uniform1f(l, v);
    return this;
  }

  /** テクスチャを次の空きユニットに結び、sampler uniform に番号を入れる。 */
  tex(name, texture) {
    const gl = this.gl;
    const l = this.#loc(name);
    if (l === null) return this;
    const u = this.unit++;
    gl.activeTexture(gl.TEXTURE0 + u);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.uniform1i(l, u);
    return this;
  }

  /** 立方体テクスチャ（環境マップ）を束ねる。 */
  cube(name, texture) {
    const gl = this.gl;
    const l = this.#loc(name);
    if (l === null) return this;
    const u = this.unit++;
    gl.activeTexture(gl.TEXTURE0 + u);
    gl.bindTexture(gl.TEXTURE_CUBE_MAP, texture);
    gl.uniform1i(l, u);
    return this;
  }
}

function compile(gl, type, src, label) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(s);
    // 行番号つきで出さないと、文字列連結したシェーダはまず追えない
    const listing = src.split('\n').map((l, i) => `${String(i + 1).padStart(3)}| ${l}`).join('\n');
    console.error(`[${label}] compile 失敗\n${log}\n${listing}`);
    throw new Error(`[${label}] compile 失敗: ${log}`);
  }
  return s;
}

/**
 * テクスチャを作る。
 * fmt は 'rgba32f' | 'rgba16f' | 'rgba8'。filter と wrap は既定で NEAREST / CLAMP。
 */
export function makeTex(gl, w, h, fmt = 'rgba16f', { filter = 'nearest', wrap = 'clamp', data = null } = {}) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, t);
  const F = {
    rgba32f: [gl.RGBA32F, gl.RGBA, gl.FLOAT],
    rgba16f: [gl.RGBA16F, gl.RGBA, gl.HALF_FLOAT],
    rgba8: [gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE],
  }[fmt];
  // data を渡すときは FLOAT で読ませる（32f 前提）
  gl.texImage2D(gl.TEXTURE_2D, 0, F[0], w, h, 0, F[1], data ? gl.FLOAT : F[2], data);
  const f = filter === 'linear' ? gl.LINEAR : gl.NEAREST;
  const wm = wrap === 'repeat' ? gl.REPEAT : gl.CLAMP_TO_EDGE;
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, f);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wm);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wm);
  t._w = w; t._h = h;
  return t;
}

/** 色添付を n 枚持つ FBO。深度が要るものは depth:true を渡す。 */
export function makeFbo(gl, textures, { depth = false, w = 0, h = 0 } = {}) {
  const fb = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  const bufs = [];
  textures.forEach((t, i) => {
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0 + i, gl.TEXTURE_2D, t, 0);
    bufs.push(gl.COLOR_ATTACHMENT0 + i);
  });
  gl.drawBuffers(bufs);
  let rb = null;
  if (depth) {
    rb = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT24, w || textures[0]._w, h || textures[0]._h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, rb);
  }
  const st = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (st !== gl.FRAMEBUFFER_COMPLETE) throw new Error(`FBO が不完全: 0x${st.toString(16)}`);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  return { fb, tex: textures, rb, w: w || textures[0]._w, h: h || textures[0]._h, bufs };
}

export function bindFbo(gl, fbo) {
  if (!fbo) return;
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo.fb);
  gl.drawBuffers(fbo.bufs);
  gl.viewport(0, 0, fbo.w, fbo.h);
}

/** 画面いっぱいの三角形。クアッドより頂点が 1 つ少なく、対角線の継ぎ目も出ない。 */
export class FullScreen {
  constructor(gl) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    const b = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, b);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    gl.bindVertexArray(null);
  }
  draw() {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawArrays(this.gl.TRIANGLES, 0, 3);
  }
}

/**
 * 添字つきメッシュ。attrs は [{loc, size, data}] の配列で、
 * それぞれ別の VBO に入れる（更新するものとしないものを分けたいため）。
 */
export class Mesh {
  constructor(gl, attrs, indices) {
    this.gl = gl;
    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);
    for (const a of attrs) {
      const b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      gl.bufferData(gl.ARRAY_BUFFER, a.data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(a.loc);
      gl.vertexAttribPointer(a.loc, a.size, gl.FLOAT, false, 0, 0);
    }
    const ib = gl.createBuffer();
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ib);
    // 頂点が 65536 を超える水面格子があるので 32bit 添字で統一する
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    this.count = indices.length;
  }
  draw() {
    this.gl.bindVertexArray(this.vao);
    this.gl.drawElements(this.gl.TRIANGLES, this.count, this.gl.UNSIGNED_INT, 0);
  }
  dispose() {
    this.gl.deleteVertexArray(this.vao);
  }
}

/** x 方向 nx+1 点、z 方向 nz+1 点の格子。属性は正規化した (u,v) のみ。 */
export function gridMesh(gl, nx, nz, loc = 0) {
  const uv = new Float32Array((nx + 1) * (nz + 1) * 2);
  let p = 0;
  for (let j = 0; j <= nz; j++) {
    for (let i = 0; i <= nx; i++) {
      uv[p++] = i / nx;
      uv[p++] = j / nz;
    }
  }
  const idx = new Uint32Array(nx * nz * 6);
  let q = 0;
  for (let j = 0; j < nz; j++) {
    for (let i = 0; i < nx; i++) {
      const a = j * (nx + 1) + i, b = a + 1, c = a + nx + 1, d = c + 1;
      idx[q++] = a; idx[q++] = c; idx[q++] = b;
      idx[q++] = b; idx[q++] = c; idx[q++] = d;
    }
  }
  return new Mesh(gl, [{ loc, size: 2, data: uv }], idx);
}


/**
 * 環境マップ用の立方体テクスチャ。
 *
 * 段（ミップ）を自分で焼くので、texStorage2D で全段ぶん先に確保する。
 * 段が粗さに対応する（0 段目が鏡、最後の段がほぼ一様）。
 */
export function makeCube(gl, size, mips) {
  const t = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_CUBE_MAP, t);
  gl.texStorage2D(gl.TEXTURE_CUBE_MAP, mips, gl.RGBA16F, size, size);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_CUBE_MAP, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  t._size = size; t._mips = mips;
  return t;
}

/** 立方体テクスチャの 1 面 1 段に描き込む FBO を用意する。 */
export function bindCubeFace(gl, fb, cube, face, level) {
  const size = Math.max(1, cube._size >> level);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
                          gl.TEXTURE_CUBE_MAP_POSITIVE_X + face, cube, level);
  gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
  gl.viewport(0, 0, size, size);
}
