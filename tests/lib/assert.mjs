// いちばん小さな検査の道具。
//
// 試験の枠組みは入れない。入れると依存が増えるし、この規模なら
// 「期待と違ったら投げる」だけで足りる。失敗したときに何がどう違ったかが
// 読めることのほうが大事なので、すべての関数が実測値を文に含める。

export function ok(cond, what) {
  if (!cond) throw new Error(what);
}

export function eq(got, want, what) {
  if (got !== want) throw new Error(`${what}: ${JSON.stringify(got)} だが ${JSON.stringify(want)} のはず`);
}

/** 数が範囲に入っているか。範囲は閉区間 */
export function between(got, lo, hi, what) {
  if (!(got >= lo && got <= hi)) {
    throw new Error(`${what}: ${fmt(got)} は ${fmt(lo)}〜${fmt(hi)} の外`);
  }
}

/** 数がだいたい合っているか */
export function near(got, want, tol, what) {
  if (!(Math.abs(got - want) <= tol)) {
    throw new Error(`${what}: ${fmt(got)} は ${fmt(want)} ± ${fmt(tol)} の外（差 ${fmt(Math.abs(got - want))}）`);
  }
}

/** 並びが大きい順になっているか。tol まではの逆転は許す */
export function descending(list, what, tol = 1e-9) {
  for (let i = 1; i < list.length; i++) {
    if (list[i][1] > list[i - 1][1] + tol) {
      throw new Error(`${what}: ${list[i - 1][0]} が ${fmt(list[i - 1][1])}、`
                    + `${list[i][0]} が ${fmt(list[i][1])} で逆転している`);
    }
  }
}

function fmt(x) {
  return typeof x === 'number' ? (Number.isInteger(x) ? String(x) : x.toFixed(3)) : String(x);
}
