// 立体の見本（GLB）を読む。
//
// 汎用の読み込み器は入れない。読むのは「形が 1 つ、色の絵が 1 枚」の
// 決まった中身だけで、それ以外の機能（節の木、骨、動き、拡張）は使わない。
// 中身が違えば、黙って崩れた絵を出さずに投げる。
//
// GLB は 12 バイトの頭書きのあとに、JSON の塊とバイナリの塊が並ぶ。
// JSON が「バイナリのどこからどこまでが何か」を指している。

import { Mesh } from './glx.js?v=202610260528';

const GLB_MAGIC = 0x46546c67;     // "glTF"
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

/** 部品の型ごとの要素数と、1 要素の配列型 */
const COMPONENTS = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ARRAYS = { 5121: Uint8Array, 5123: Uint16Array, 5125: Uint32Array, 5126: Float32Array };

/**
 * 頭書きと 2 つの塊を切り出す。
 * @returns {{ json: object, bin: ArrayBuffer, binOffset: number }}
 */
export function parseGlb(buf) {
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error('GLB ではない');
  if (dv.getUint32(4, true) !== 2) throw new Error('glTF 2.0 ではない');
  let p = 12, json = null, binOffset = -1;
  while (p < buf.byteLength) {
    const len = dv.getUint32(p, true);
    const type = dv.getUint32(p + 4, true);
    if (type === CHUNK_JSON) json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, p + 8, len)));
    else if (type === CHUNK_BIN) binOffset = p + 8;
    p += 8 + len;
  }
  if (!json || binOffset < 0) throw new Error('GLB の塊が足りない');
  return { json, bin: buf, binOffset };
}

/** accessor が指す値を、詰めた配列として取り出す（間隔のある並びもほどく） */
function read(glb, index) {
  const { json, bin, binOffset } = glb;
  const acc = json.accessors[index];
  const view = json.bufferViews[acc.bufferView];
  const Arr = ARRAYS[acc.componentType];
  const n = COMPONENTS[acc.type];
  if (!Arr || !n) throw new Error(`読めない accessor の型: ${acc.componentType}/${acc.type}`);
  const start = binOffset + (view.byteOffset || 0) + (acc.byteOffset || 0);
  const stride = view.byteStride || n * Arr.BYTES_PER_ELEMENT;
  const out = new Arr(acc.count * n);
  const dv = new DataView(bin);
  const get = { 5121: 'getUint8', 5123: 'getUint16', 5125: 'getUint32', 5126: 'getFloat32' }[acc.componentType];
  for (let i = 0; i < acc.count; i++) {
    for (let k = 0; k < n; k++) {
      out[i * n + k] = dv[get](start + i * stride + k * Arr.BYTES_PER_ELEMENT, true);
    }
  }
  return out;
}

/**
 * 形と色の絵を取り出す。GL には触らない（試験でも使えるように）。
 * @returns {{ pos: Float32Array, nrm: Float32Array, uv: Float32Array,
 *             idx: Uint32Array, image: Blob, min: number[], max: number[] }}
 */
export function extractGlb(buf) {
  const glb = parseGlb(buf);
  const { json, bin, binOffset } = glb;
  if (json.meshes?.length !== 1 || json.meshes[0].primitives.length !== 1) {
    throw new Error('形が 1 つではない');
  }
  const prim = json.meshes[0].primitives[0];
  const a = prim.attributes;
  if (a.POSITION === undefined || a.NORMAL === undefined || a.TEXCOORD_0 === undefined || prim.indices === undefined) {
    throw new Error('位置・法線・UV・添字のどれかが無い');
  }
  const mat = json.materials?.[prim.material ?? -1];
  const texIndex = mat?.pbrMetallicRoughness?.baseColorTexture?.index;
  if (texIndex === undefined) throw new Error('色の絵が無い');
  const img = json.images[json.textures[texIndex].source];
  const view = json.bufferViews[img.bufferView];
  const image = new Blob([new Uint8Array(bin, binOffset + (view.byteOffset || 0), view.byteLength)],
                         { type: img.mimeType });
  const acc = json.accessors[a.POSITION];
  return {
    pos: read(glb, a.POSITION),
    nrm: read(glb, a.NORMAL),
    uv: read(glb, a.TEXCOORD_0),
    idx: Uint32Array.from(read(glb, prim.indices)),
    image,
    min: acc.min, max: acc.max,
  };
}

/**
 * 読み込んで、GL の網と色のテクスチャにする。
 *
 * 色の絵は sRGB で描かれているので、SRGB8_ALPHA8 で受けて、
 * 読み出したときに線形の値になるようにする。ほかの色はすべて線形で
 * 計算しているので、ここで直さないと金魚だけ白っぽく浮く。
 */
export async function loadGlb(gl, url, fit = null) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} が読めない（${res.status}）`);
  const g = extractGlb(await res.arrayBuffer());
  // 見本ごとの向きと寸法の違いは、呼ぶ側が直す（位置と法線をその場で書き換える）
  if (fit) fit(g);
  const mesh = new Mesh(gl, [
    { loc: 0, size: 3, data: g.pos },
    { loc: 1, size: 3, data: g.nrm },
    { loc: 2, size: 2, data: g.uv },
  ], g.idx);

  const bmp = await createImageBitmap(g.image);
  const tex = gl.createTexture();
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  // glTF の UV は絵の左上が原点。ImageBitmap も上の行から並ぶので、反転しない
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.SRGB8_ALPHA8, gl.RGBA, gl.UNSIGNED_BYTE, bmp);
  gl.generateMipmap(gl.TEXTURE_2D);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  bmp.close();
  return { mesh, tex, tris: g.idx.length / 3 };
}
