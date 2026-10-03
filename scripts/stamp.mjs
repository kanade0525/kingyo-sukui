// 配信時のキャッシュ合わせ。
//
// GitHub Pages は全ファイルに max-age=600 を付ける。素の ES モジュールは
// ファイルごとに別のリクエストなので、更新直後は「新しい index.html と
// 古い ui.js」のような取り合わせが起き、ボタンを押しても何も起きない、
// といった形で壊れる。
//
// そこで相対 import すべてに同じ版番号を付け、版が変われば全部まとめて
// 取り直させる。ビルドではなく、コミット前に一度走らせる判子。
//
//   npm run stamp

import { readFile, writeFile, readdir } from 'node:fs/promises';
import { join, resolve, extname } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..');
const VERSION = new Date().toISOString().replace(/\D/g, '').slice(0, 12);

async function* walk(dir) {
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) yield* walk(p);
    else if (extname(p) === '.js') yield p;
  }
}

// from './x.js' / from '../y/z.js'（既にある ?v= は付け替える）
const IMPORT = /(from\s+['"])(\.{1,2}\/[^'"?]+\.js)(\?v=\d+)?(['"])/g;
let n = 0;

for await (const file of walk(join(ROOT, 'assets'))) {
  const src = await readFile(file, 'utf8');
  const out = src.replace(IMPORT, (_, a, path, __, q) => `${a}${path}?v=${VERSION}${q}`);
  if (out !== src) { await writeFile(file, out); n++; }
}

// HTML 側。モジュールと CSS の読み込みに同じ版を押す。
// perf.html は renderer と game を直接読むので、そこも忘れずに
let pages = 0;
for (const name of ['index.html', 'perf.html']) {
  const file = join(ROOT, name);
  const h = await readFile(file, 'utf8');
  const h2 = h
    .replace(/(assets\/js\/[\w.]+\.js)(\?v=\d+)?/g, `$1?v=${VERSION}`)
    .replace(/(href="assets\/css\/app\.css)(\?v=\d+)?(")/, `$1?v=${VERSION}$3`);
  if (h2 !== h) { await writeFile(file, h2); pages++; }
}

console.log(`版 ${VERSION} を押した（js ${n} 本 + HTML ${pages} 枚）`);
