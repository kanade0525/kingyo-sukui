// 試験を走らせる。
//
// 枠組みは入れていない。test/describe の類は要らず、
// 「名前と関数の並び」を順に呼んで、投げたら落ちた、で足りる。
//
//   npm test            全部
//   npm test unit       単体だけ（ブラウザを使わない。速い）
//   npm test e2e        通しだけ
//   npm test -- 太陽     名前に「太陽」を含むものだけ
//
// 通しの試験はローカルの配信を使う。立っていなければ自分で立てる。

import { readdirSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2).filter((a) => a !== '--');
const want = args.filter((a) => a !== 'unit' && a !== 'e2e');
const kinds = args.includes('unit') ? ['unit']
            : args.includes('e2e') ? ['e2e']
            : ['unit', 'e2e'];

const PORT = 8010;
const URL = `http://localhost:${PORT}`;

/** 配信が立っているか */
async function alive() {
  try {
    const r = await fetch(`${URL}/index.html`, { signal: AbortSignal.timeout(900) });
    return r.ok;
  } catch { return false; }
}

let server = null;
if (kinds.includes('e2e') && !(await alive())) {
  server = spawn('node', [join(here, '..', 'scripts', 'dev-server.mjs')],
                 { stdio: 'ignore', detached: false });
  for (let i = 0; i < 40 && !(await alive()); i++) await new Promise((r) => setTimeout(r, 150));
  if (!(await alive())) {
    console.error('配信を立てられなかった。npm run dev を別で動かしてから試す');
    process.exit(1);
  }
}

let pass = 0, fail = 0;
const failures = [];
const t0 = Date.now();

for (const kind of kinds) {
  const dir = join(here, kind);
  const files = readdirSync(dir).filter((f) => f.endsWith('.test.mjs')).sort();
  for (const f of files) {
    const mod = await import(join(dir, f));
    const cases = mod.default;
    const title = f.replace('.test.mjs', '');
    let shown = false;
    for (const [name, fn] of Object.entries(cases)) {
      if (want.length && !want.some((w) => name.includes(w) || title.includes(w))) continue;
      if (!shown) { console.log(`\n  ${kind}/${title}`); shown = true; }
      const s = Date.now();
      try {
        await fn();
        pass++;
        console.log(`    ✓ ${name}  ${Date.now() - s}ms`);
      } catch (e) {
        fail++;
        failures.push([`${kind}/${title}`, name, e]);
        console.log(`    ✗ ${name}  ${Date.now() - s}ms`);
        console.log(`        ${e.message.split('\n')[0]}`);
      }
    }
  }
}

if (server) server.kill();

console.log(`\n  ${pass} 件通過 / ${fail} 件失敗  （${((Date.now() - t0) / 1000).toFixed(1)} 秒）`);
if (fail) {
  console.log('\n  失敗したもの');
  for (const [where, name, e] of failures) console.log(`    ${where} › ${name}\n      ${e.message}`);
}
process.exit(fail ? 1 : 0);
