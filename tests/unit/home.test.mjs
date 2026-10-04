// 家の鉢の保存。
//
// 一度人の端末へ書き込んだら後戻りできないので、ここをいちばん厚く見る。
// どんな壊れ方をしていても落ちないこと、悪い 1 匹だけを落とすこと、
// のちに世話を足したときに古い保存が読めなくならないこと。

import { Home, sanitize, HOME_VERSION } from '../../assets/js/home.js?v=202610041543';
import { HOME, JAR, FISH_KINDS, TURTLE } from '../../assets/js/world.js?v=202610041543';
import { ok, eq, between, near } from '../lib/assert.mjs';

/** localStorage の代わり。Node には無い */
function fakeStore(init = {}) {
  const m = new Map(Object.entries(init));
  return {
    getItem: (k) => (m.has(k) ? m.get(k) : null),
    setItem: (k, v) => m.set(k, String(v)),
    removeItem: (k) => m.delete(k),
    _map: m,
  };
}

const fish = (over = {}) => ({ kind: 0, turtle: false, len: 0.031, seed: 0.42, ...over });

export default {
  '書いて読むと中身が一致する': () => {
    const store = fakeStore();
    const a = new Home(store);
    a.add([fish({ len: 0.028, seed: 0.1 }),
           fish({ kind: 2, len: 0.046, seed: 0.9 }),
           fish({ turtle: true, len: 0.034, seed: 0.5 })]);
    const b = new Home(store);
    eq(b.list.length, 3, '読み戻した匹数');
    near(b.list[0].len, 0.028, 1e-9, '1 匹目の全長');
    eq(b.list[1].kind, 2, '2 匹目の種類');
    eq(b.list[2].turtle, true, '3 匹目が亀か');
  },

  'どんな壊れ方でも落ちない': () => {
    const bad = [null, '', '{', '[]', 'null', '0', '"文字"', '{"v":1}',
                 '{"v":1,"fish":"配列ではない"}', '{"fish":[]}',
                 '{"v":99,"fish":[{"kind":0,"len":0.03,"seed":0.5}]}',
                 '{"v":1,"fish":[null,1,"あ",{}]}'];
    for (const raw of bad) {
      const got = sanitize(raw);
      ok(Array.isArray(got.fish), `${raw} を読んで配列が返らない`);
      // 壊れた入力から金魚が湧いてはいけない
      eq(got.fish.length, 0, `${raw} から金魚が出てきた`);
    }
  },

  '壊れた保存は捨てる前に退避される': () => {
    const store = fakeStore({ 'kingyo.home': '{壊れている' });
    const h = new Home(store);
    eq(h.list.length, 0, '壊れた保存から読めてしまった');
    eq(store.getItem('kingyo.home.broken'), '{壊れている', '退避されていない');
    eq(store.getItem('kingyo.home'), null, '壊れた保存が残っている');
  },

  '悪い 1 匹だけ落ちて、残りは通る': () => {
    const raw = JSON.stringify({ v: 1, fish: [
      fish({ seed: 0.1 }),
      fish({ len: '太い' }),            // 文字列
      fish({ seed: 0.2 }),
      fish({ kind: 7 }),                // 知らない種類
      fish({ kind: -1 }),
      fish({ len: 0.9 }),               // 90cm の金魚
      fish({ seed: 1.4 }),
      fish({ seed: 0.3 }),
    ] });
    const got = sanitize(raw);
    eq(got.fish.length, 3, '通った匹数');
    eq(got.dropped, 5, '落とした匹数');
  },

  '知らない鍵が入っていても読める': () => {
    // のちに餌（fed）や水換えを足したあと、古い版で開いた場合。
    // 版を上げずに鍵だけ増やす方針なので、ここが通らないと成り立たない
    const raw = JSON.stringify({ v: 1, tank: { changedAt: 123 }, fish: [
      { ...fish(), fed: { at: 1, level: 0.5 }, nickname: 'きんちゃん' },
    ] });
    const got = sanitize(raw);
    eq(got.fish.length, 1, '知らない鍵があると読めない');
    eq(got.tank.changedAt, 123, '器の値が落ちている');
  },

  '未来の版は読まない': () => {
    const raw = JSON.stringify({ v: HOME_VERSION + 1, fish: [fish(), fish()] });
    eq(sanitize(raw).fish.length, 0, '知らない版を読んでしまった');
  },

  'savedAt を必ず書く': () => {
    // 餌も水換えも「前に見てから何時間経ったか」で決まる。
    // あとから足すと、経過の分からない金魚が生まれる
    const store = fakeStore();
    const before = Date.now();
    const h = new Home(store);
    h.add([fish()]);
    const saved = JSON.parse(store.getItem('kingyo.home'));
    ok(saved.savedAt >= before, 'savedAt が書かれていない');
    ok(saved.fish[0].at >= before, '1 匹ごとの at が書かれていない');
    ok(typeof saved.fish[0].id === 'string' && saved.fish[0].id.length > 0, 'id が無い');
  },

  '端末の時計が未来でも落ちない': () => {
    const raw = JSON.stringify({ v: 1, savedAt: Date.now() + 86400000 * 365, fish: [fish()] });
    const got = sanitize(raw);
    eq(got.fish.length, 1, '未来の時刻で読めなくなった');
  },

  '泳ぎの状態は保存しない': () => {
    const store = fakeStore();
    const h = new Home(store);
    h.add([fish()]);
    const saved = JSON.parse(store.getItem('kingyo.home'));
    for (const k of ['a', 'r', 'spin', 'phase', 'p', 'yaw', 'bend', 'y0', 'sway']) {
      ok(!(k in saved.fish[0]), `泳ぎの値 ${k} が保存に入っている`);
    }
  },

  '上限を超えて入らない。古いものは消さない': () => {
    const store = fakeStore();
    const h = new Home(store);
    const many = Array.from({ length: HOME.max + 10 }, (_, i) => fish({ seed: i / 100 }));
    const n = h.add(many);
    eq(n, HOME.max, '入った数');
    eq(h.list.length, HOME.max, '鉢の中の数');
    eq(h.full, true, 'いっぱいだと分かっていない');
    // もう 1 匹足しても増えない。古いものも消えない
    const first = h.list[0].id;
    eq(h.add([fish()]), 0, '満杯なのに入った');
    eq(h.list[0].id, first, '古い金魚が消えた');
  },

  '容量が現実的に収まる': () => {
    const store = fakeStore();
    const h = new Home(store);
    h.add(Array.from({ length: HOME.max }, (_, i) => fish({ seed: i / 100 })));
    const bytes = store.getItem('kingyo.home').length;
    between(bytes, 1000, 16000, `上限いっぱいの保存の大きさ（バイト）`);
  },

  '保管庫が使えなくても落ちない': () => {
    const dead = {
      getItem() { throw new Error('使えない'); },
      setItem() { throw new Error('使えない'); },
      removeItem() { throw new Error('使えない'); },
    };
    const h = new Home(dead);
    eq(h.list.length, 0, '読めないのに金魚がいる');
    eq(h.add([fish()]), 1, '書けなくても鉢には入るべき');
    eq(h.save(), false, '書けないのに書けたと言っている');
  },

  '鉢の寸法が実物と合う': () => {
    // ガラスの太鼓鉢 直径 20cm × 高さ 19.5cm・4.8L
    near(JAR.outerR * 2 * 100, 20, 0.5, '直径（cm）');
    near(JAR.height * 100, 19.5, 0.5, '高さ（cm）');
    ok(JAR.mouthR < JAR.outerR, '口が胴より広い。太鼓鉢になっていない');
    ok(JAR.footR < JAR.outerR, '底が胴より広い');
    ok(JAR.waterY < JAR.height, '水が口から溢れている');
    // 入る水のかさ。胴がふくらむので、円柱で見積もると多めに出る。
    // 実物の 4.8L に対して 3〜6L なら形として妥当
    const liters = Math.PI * (JAR.outerR - JAR.wall) ** 2 * JAR.waterY * 1000;
    between(liters, 3.0, 6.0, '水のかさ（L）');
  },

  'どの金魚もガラスの内側で泳ぐ': () => {
    const store = fakeStore();
    const h = new Home(store);
    const lens = [0.026, 0.035, 0.040, 0.050, 0.038];   // 小赤〜出目金、亀
    h.add(lens.map((len, i) => fish({ kind: i % FISH_KINDS.length, len, seed: i / 10 })));
    const inner = JAR.outerR - JAR.wall;
    for (let t = 0; t < 40; t += 0.1) {
      h.update(0.1, t);
      for (const f of h.list) {
        const d = Math.hypot(f.p[0] - JAR.pos[0], f.p[2] - JAR.pos[2]);
        ok(d + f.len * 0.5 <= inner + 1e-6,
           `全長 ${(f.len * 100).toFixed(1)}cm の魚がガラスを ${((d + f.len * 0.5 - inner) * 1000).toFixed(1)}mm 抜ける`);
        between(f.p[1], 0, JAR.waterY, '泳ぐ深さ');
      }
    }
  },

  '適正な数と入る数を分けて持っている': () => {
    // のちに「過密だと水が濁る」を足すときの土台
    ok(HOME.fit < HOME.max, '適正な数が上限と同じ');
    between(HOME.fit, 2, 4, '4.8L で 3cm の金魚の適正な数');
    const store = fakeStore();
    const h = new Home(store);
    h.add([fish(), fish()]);
    eq(h.crowded, false, '2 匹で密だと言っている');
    h.add([fish(), fish()]);
    eq(h.crowded, true, '4 匹で密だと言っていない');
  },
};
