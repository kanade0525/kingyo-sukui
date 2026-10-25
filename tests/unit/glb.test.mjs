// 立体の見本（GLB）の読み込み。
//
// 読み込み器は「形が 1 つ、色の絵が 1 枚」だけを読む自前のもの。
// 置いてある見本を縮め直したときに、中身の形が変わって読めなくなって
// いないか、重くなりすぎていないかを確かめる。

import { readFileSync } from 'node:fs';
import { extractGlb } from '../../assets/js/glb.js?v=202610080114';
import { ok, eq, between } from '../lib/assert.mjs';

const MODELS = [['和金', 'wakin.glb'], ['出目金', 'demekin.glb']];
const fileOf = (name) => new URL(`../../assets/models/${name}`, import.meta.url);
const load = (name) => {
  const b = readFileSync(fileOf(name));
  return extractGlb(b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength));
};

export default {
  '見本が読める': () => {
    for (const [label, name] of MODELS) {
      const g = load(name);
      const verts = g.pos.length / 3;
      eq(g.nrm.length, g.pos.length, `${label}: 法線の数が位置と合わない`);
      eq(g.uv.length / 2, verts, `${label}: UV の数が位置と合わない`);
      ok(g.idx.every((i) => i < verts), `${label}: 添字が頂点の外を指している`);
      eq(g.image.type, 'image/jpeg', `${label}: 色の絵の形式`);
    }
  },

  '見本は屋台で何十匹も泳がせられる軽さ': () => {
    for (const [label, name] of MODELS) {
      between(load(name).idx.length / 3, 1000, 8000, `${label}: 三角形の数`);
      between(readFileSync(fileOf(name)).length / 1024, 20, 400, `${label}: ファイルの大きさ（KB）`);
    }
  },

  '見本の向きと寸法が、置き直しの前提どおり': () => {
    // renderer.js の fitTo は「長さ 1、頭が -x、腹の下が y = 0」を前提にしている
    for (const [label, name] of MODELS) {
      const g = load(name);
      between(g.max[0] - g.min[0], 0.98, 1.02, `${label}: 鼻先から尾の先までの長さ`);
      between(g.min[1], -0.01, 0.01, `${label}: 腹の下の高さ`);
    }
  },

  'GLB でないものは投げる': () => {
    let threw = false;
    try { extractGlb(new ArrayBuffer(32)); } catch { threw = true; }
    ok(threw, 'GLB でないのに読めてしまった');
  },
};
