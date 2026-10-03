// 音源を、そのままの形で置かないための変換。
//
// 効果音ラボは、ゲームへの組み込みも GitHub でのソース公開も
// 「問題ございません」としたうえで、こう添えている。
//
//   できる限りでよいので、音源ファイルを隠す措置を
//   取っていただきますよう、お願いいたします
//
// m4a をそのまま置くと、リポジトリを覗いた人がそのまま拾って
// 素材として使い回せてしまう。そこで鍵で XOR してから置く。
//
// 暗号ではない。本気で取り出す人は止められないし、止める必要もない。
// 「覗いて音だけ持っていく」のに一手間かかればよい、という程度のもの。
//
// 使い方（元の m4a は別の場所に置いてある。リポジトリには入れない）
//   node scripts/pack-sound.mjs ~/development/kingyo-sukui-sound-src

import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

// sound.js の KEY と同じ文字列。片方だけ変えると音が出なくなる
const KEY = 'kingyo-sukui';

/** 鍵の文字コードを順に XOR する。もう一度かけると元へ戻る */
export function scramble(bytes) {
  for (let i = 0; i < bytes.length; i++) bytes[i] ^= KEY.charCodeAt(i % KEY.length);
  return bytes;
}

const MAP = [
  ['semi-hiru.m4a', 's1.bin'],
  ['semi-yugata.m4a', 's2.bin'],
  ['furin.m4a', 's3.bin'],
  ['ame.m4a', 's4.bin'],
  ['mushi.m4a', 's5.bin'],
  ['hayashi.m4a', 's6.bin'],
];

const src = process.argv[2];
if (!src) {
  console.error('元の m4a が入った場所を指定してください');
  process.exit(1);
}
for (const [from, to] of MAP) {
  const p = join(src, from);
  if (!existsSync(p)) { console.error(`${from} が無い`); process.exit(1); }
  const b = scramble(new Uint8Array(readFileSync(p)));
  writeFileSync(join('assets/sound', to), b);
  console.log(`${from} → assets/sound/${to}  ${(b.length / 1024).toFixed(0)}KB`);
}
