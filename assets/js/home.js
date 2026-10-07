// 家の金魚鉢。
//
// 屋台で掬って持ち帰った金魚を、この端末に残して鉢の中で泳がせる。
// **localStorage を触るのはこのファイルだけ。** ほかから直に読み書きすると、
// 保存の形を変えるときに触る場所が散らばる。
//
// 保存するのは「見た目を決める値」と「身元」だけで、泳ぎの状態は入れない。
// 泳ぎの値（角度・半径・位相）は屋台のお椀を基準に作られていて、鉢へ
// 持っていくと鉢の外を泳ぐ。毎回ここで引き直すほうが小さく、壊れにくい。

import { FISH_KINDS, JAR, HOME, bedTopAt, jarInnerAt } from './world.js?v=202610070209';

/**
 * 保存の版。
 *
 * 上げるのは「既にある鍵の意味が変わるとき」だけ。
 * のちに餌（fish[i].fed）や水換え（tank.changedAt）を足すのは
 * **新しい鍵が増えるだけ**なので、版は上げない。読む側が
 * 「無ければ既定値」で受ければ、古い保存はそのまま読める。
 */
export const HOME_VERSION = 1;

const KEY = 'kingyo.home';
const BROKEN = 'kingyo.home.broken';

/** 金魚 1 匹として通る値か。1 匹ずつ見て、悪いものだけ落とす */
function okFish(f) {
  if (!f || typeof f !== 'object') return false;
  const turtle = f.turtle === true;
  if (!turtle) {
    if (!Number.isInteger(f.kind) || f.kind < 0 || f.kind >= FISH_KINDS.length) return false;
  }
  // 全長。小赤 2.6cm から出目金 5cm まで。幅を持たせて 1〜8cm
  if (!(typeof f.len === 'number' && f.len >= 0.01 && f.len <= 0.08)) return false;
  if (!(typeof f.seed === 'number' && f.seed >= 0 && f.seed <= 1)) return false;
  return true;
}

/**
 * 読んだものを検品する。純粋な関数。
 *
 * どんな入力でも投げない。読めた分だけ返し、落とした数を添える。
 * ブラウザが要らないので、ここが単体試験のいちばんの的になる。
 */
export function sanitize(raw) {
  const empty = { fish: [], dropped: 0, savedAt: 0, tank: {}, broken: false };
  if (raw === null || raw === undefined || raw === '') return empty;

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { ...empty, broken: true };       // 解けない。退避して捨てる
  }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return empty;
  // 知らない未来の版は読まない。読んで誤解するより、空のほうがまし
  if (typeof data.v !== 'number' || data.v > HOME_VERSION) return empty;
  if (!Array.isArray(data.fish)) return empty;

  const fish = [];
  let dropped = 0;
  for (const f of data.fish) {
    if (!okFish(f)) { dropped++; continue; }
    fish.push({
      id: typeof f.id === 'string' ? f.id : newId(fish.length),
      turtle: f.turtle === true,
      kind: f.turtle === true ? 0 : f.kind,
      len: f.len,
      seed: f.seed,
      // 尾びれの速さ。無ければ引き直す
      beat: typeof f.beat === 'number' && f.beat > 0 ? f.beat : 9 + Math.random() * 4,
      at: typeof f.at === 'number' && f.at > 0 ? f.at : 0,
    });
    if (fish.length >= HOME.max) break;
  }
  return {
    fish,
    dropped,
    savedAt: typeof data.savedAt === 'number' ? data.savedAt : 0,
    tank: data.tank && typeof data.tank === 'object' ? data.tank : {},
    broken: false,
  };
}

let idSeq = 0;
function newId(i) {
  return `${Date.now().toString(36)}-${(idSeq++ + i).toString(36)}`;
}

/**
 * 鉢の中身。保存の読み書きと、泳ぎの更新を持つ。
 *
 * store を差し替えられるようにしてあるのは、Node から試験するため。
 * 既定は localStorage。使えない所（プライベートな窓など）では、
 * 読めない・書けないだけで落ちないようにしてある。
 */
export class Home {
  constructor(store) {
    this.store = store ?? safeStore();
    this.list = [];
    this.tank = {};
    this.savedAt = 0;
    this.dropped = 0;
    this.load();
  }

  load() {
    let raw = null;
    try { raw = this.store?.getItem(KEY) ?? null; } catch { raw = null; }
    const got = sanitize(raw);
    if (got.broken) {
      // 黙って消さない。あとで取り戻せるように退避する
      try {
        this.store?.setItem(BROKEN, raw);
        this.store?.removeItem(KEY);
      } catch { /* 書けないなら、読まないだけで済ませる */ }
    }
    this.tank = got.tank;
    this.savedAt = got.savedAt;
    this.dropped = got.dropped;
    this.list = got.fish.map((f) => swimState(f));
    return this;
  }

  save() {
    const data = {
      v: HOME_VERSION,
      // 「前に見たときから何時間経ったか」は、のちの餌と水換えに要る。
      // あとから足すと、既にある保存に無くて経過が分からない金魚が生まれる
      savedAt: Date.now(),
      fish: this.list.map((f) => ({
        id: f.id, turtle: f.turtle, kind: f.kind,
        len: f.len, seed: f.seed, beat: f.beat, at: f.at,
      })),
      tank: this.tank,
    };
    try {
      this.store?.setItem(KEY, JSON.stringify(data));
      this.savedAt = data.savedAt;
      return true;
    } catch {
      return false;      // 容量いっぱい、書けない設定。落とさない
    }
  }

  /**
   * 持ち帰った金魚を入れる。入った数を返す。
   * 上限を超える分は受け取らない（古いものを消さない）。
   */
  add(caught) {
    const now = Date.now();
    let n = 0;
    for (const c of caught) {
      if (this.list.length >= HOME.max) break;
      this.list.push(swimState({
        id: newId(n),
        turtle: c.turtle === true,
        kind: c.turtle === true ? 0 : c.kind,
        len: c.len,
        seed: c.seed,
        beat: c.beat ?? 9 + Math.random() * 4,
        at: now,
      }));
      n++;
    }
    this.save();
    return n;
  }

  /** 鉢を空にする。設定から呼ぶ（逃がす） */
  clear() {
    this.list.length = 0;
    this.save();
  }

  get full() { return this.list.length >= HOME.max; }
  get crowded() { return this.list.length > HOME.fit; }

  /**
   * 鉢の中を泳ぐ。
   *
   * 屋台のお椀と同じく、ゆるい円を描かせる。ただし鉢は深さがあるので、
   * 上下にもゆっくり動く。ポイから逃げる必要がないので、School は使わない。
   */
  update(dt, time) {
    const inner = JAR.outerR - JAR.wall;
    for (const f of this.list) {
      f.a += f.spin * dt;
      // 深さと半径がゆっくり揺れる。全部が同じ輪を回ると水車に見える
      const r = f.r * (0.86 + 0.14 * Math.sin(time * 0.31 + f.phase));
      const y = f.y0 + Math.sin(time * 0.23 + f.phase * 1.7) * f.sway;
      const px = JAR.pos[0] + Math.cos(f.a) * r;
      const pz = JAR.pos[2] + Math.sin(f.a) * r;
      f.yaw = f.a + (f.spin > 0 ? Math.PI / 2 : -Math.PI / 2);
      f.bend = Math.sin(time * f.beat * 0.25 + f.phase) * 0.10;
      f.p[0] = px;
      // 下限は砂の面。砂を盛ったあとも 1.2cm のままにしていたので、
      // 金魚が砂に半分埋まって泳いでいた
      const half = f.len * 0.42;
      const floor = bedTopAt(r) + half + 0.003;
      const ceil = Math.max(JAR.waterY - half - 0.003, floor);
      f.p[1] = JAR.pos[1] + Math.min(Math.max(y, floor), ceil);
      f.p[2] = pz;
      // ガラスの内側へ丸める。鉢は上も下もすぼまっているので、
      // いちばん太い所の半径で測ると、底の近くで壁を抜ける
      const d = Math.hypot(f.p[0] - JAR.pos[0], f.p[2] - JAR.pos[2]);
      const lim = Math.max(jarInnerAt(f.p[1] - JAR.pos[1]) - f.len * 0.6, 0.004);
      if (d > lim) {
        const k = lim / d;
        f.p[0] = JAR.pos[0] + (f.p[0] - JAR.pos[0]) * k;
        f.p[2] = JAR.pos[2] + (f.p[2] - JAR.pos[2]) * k;
      }
    }
  }
}

/** 保存した値に、泳ぎの状態を付け足す */
function swimState(f) {
  const inner = JAR.outerR - JAR.wall;
  return {
    ...f,
    a: Math.random() * Math.PI * 2,
    r: inner * (0.25 + Math.random() * 0.45),
    spin: (Math.random() > 0.5 ? 1 : -1) * (0.35 + Math.random() * 0.55),
    phase: Math.random() * 10,
    y0: bedTopAt(0) + 0.014 + Math.random() * Math.max(JAR.waterY - bedTopAt(0) - 0.034, 0.01),
    sway: 0.012 + Math.random() * 0.020,
    p: [JAR.pos[0], JAR.pos[1] + bedTopAt(0) + 0.03, JAR.pos[2]],
    yaw: 0,
    bend: 0,
  };
}

/** localStorage が使えないときに落ちないようにする */
function safeStore() {
  try {
    const s = globalThis.localStorage;
    s.setItem('kingyo.probe', '1');
    s.removeItem('kingyo.probe');
    return s;
  } catch {
    return null;
  }
}
