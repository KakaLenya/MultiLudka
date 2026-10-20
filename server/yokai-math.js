// «Ночной парад ста демонов» — математика слота. Чистые функции от генератора rand() -> [0, 1).
//
// Поле 5×4, 1024 пути: символ платит, если стоит на соседних барабанах слева направо в любом ряду.
// Выплаты — в UNIT-ных долях ставки за путь; скаттеры — в ставках. Итог спина — множитель ставки.
//
// Фишки:
//  • Кицунэ (вайлд, барабаны 2–5) приходит с 1, 2, 3, 5 или 9 хвостами — это её множитель.
//    Лиса идёт парадом: после каждого вращения все лисы делают шаг на барабан левее, и пока на поле
//    есть хоть одна лиса, следующее вращение бесплатное. С первого барабана лиса уходит.
//  • 3, 4, 5 ворот тории — «Ночь ста демонов»: 8, 12 или 20 бесплатных вращений. В ночи лисы не
//    уходят между вращениями, а шагают по одному барабану за вращение, и на каждом шаге у лисы
//    вырастает ещё один хвост. Ещё три тории — +5 вращений. Когда вращения кончились, парад
//    доигрывается: вращаем, пока последняя лиса не уйдёт.
//  • Множители лис на одном барабане складываются, на пути — перемножаются.
//  • Старший символ — цутигумо, паук-великан с лицом демона.

const REELS = 5;
const ROWS = 4;
const CELLS = REELS * ROWS;
const MAX_WIN = 5000;
const UNIT = 44;                   // выплата за путь — в 1/44 ставки

const SYMBOLS = {
  sake: { name: 'Чаша сакэ', pays: [2, 5, 15] },
  geta: { name: 'Гэта', pays: [2, 5, 15] },
  fan: { name: 'Веер', pays: [3, 6, 20] },
  ofuda: { name: 'Офуда', pays: [3, 6, 20] },
  umbrella: { name: 'Каса-обакэ', pays: [5, 15, 50] },
  lantern: { name: 'Тётин-обакэ', pays: [6, 20, 70] },
  skeleton: { name: 'Гасадокуро', pays: [8, 30, 100] },
  oni: { name: 'Маска они', pays: [12, 50, 200] },
  spider: { name: 'Цутигумо', pays: [15, 60, 250] },
  fox: { name: 'Кицунэ', pays: null },
  torii: { name: 'Тории', pays: null },
};
const PAY_SYMBOLS = ['sake', 'geta', 'fan', 'ofuda', 'umbrella', 'lantern', 'skeleton', 'oni', 'spider'];
const LOW = ['sake', 'geta', 'fan', 'ofuda'];

const SCATTER_PAY = { 3: 2, 4: 5, 5: 20 };
const FREE_SPINS = { 3: 8, 4: 12, 5: 20 };
const RETRIGGER = 5;
const FOX_REELS = [1, 2, 3, 4];          // где появляется лиса (не на первом барабане)
const TAILS = [[1, 60], [2, 24], [3, 10], [5, 5], [9, 1]];
const FS_TAILS = [[1, 55], [2, 25], [3, 12], [5, 6], [9, 2]];
const MAX_TAILS = 12;
const MAX_STEPS = 60;                    // предохранитель: столько вращений в одной серии самое большее
const BUY = { bonus: 100 };              // цена покупки ночи (в ставках), подобрана симуляцией

function weights(base) {
  return Array.from({ length: REELS }, (_, r) => ({ ...base, fox: FOX_REELS.includes(r) ? base.fox : 0 }));
}
const BASE_WEIGHTS = weights({
  sake: 16, geta: 16, fan: 15, ofuda: 15, umbrella: 9, lantern: 7, skeleton: 5.5, oni: 4, spider: 3, fox: 0.32, torii: 1.66,
});
const FS_WEIGHTS = weights({
  sake: 16, geta: 16, fan: 15, ofuda: 15, umbrella: 9, lantern: 7, skeleton: 5.5, oni: 4, spider: 3, fox: 1.66, torii: 1.3,
});

function pickWeighted(rand, entries) {
  let total = 0;
  for (const [, w] of entries) total += w;
  let x = rand() * total;
  for (const [v, w] of entries) {
    x -= w;
    if (x < 0) return v;
  }
  return entries[entries.length - 1][0];
}
const entriesCache = new WeakMap();
function reelEntries(w) {
  if (!entriesCache.has(w)) entriesCache.set(w, Object.entries(w).filter(([, x]) => x > 0));
  return entriesCache.get(w);
}
const cellOf = (r, y) => r * ROWS + y;

function shuffle(rand, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Новое поле. На барабане не больше одной новой лисы и одних ворот. Клетки, где уже стоят лисы
// парада, заняты ими. force: { torii: n } — подложить ворота, { fox: tails } — лису на последний барабан.
function rollGrid(rand, table, foxes, force = {}) {
  const taken = new Set(foxes.map((f) => cellOf(f.reel, f.row)));
  const grid = [];
  for (let r = 0; r < REELS; r++) {
    const col = [];
    let fox = false;
    let torii = false;
    for (let y = 0; y < ROWS; y++) {
      let s = pickWeighted(rand, reelEntries(table[r]));
      if ((s === 'fox' && (fox || foxes.some((f) => f.reel === r))) || (s === 'torii' && torii)) s = LOW[Math.floor(rand() * LOW.length)];
      if (s === 'fox') fox = true;
      if (s === 'torii') torii = true;
      col.push(s);
    }
    grid.push(col);
  }
  if (force.torii) {
    for (const r of shuffle(rand, [0, 1, 2, 3, 4])) {
      if (countSym(grid, 'torii') >= force.torii) break;
      if (grid[r].includes('torii')) continue;
      const free = [0, 1, 2, 3].filter((y) => grid[r][y] !== 'fox' && !taken.has(cellOf(r, y)));
      if (free.length) grid[r][free[Math.floor(rand() * free.length)]] = 'torii';
    }
  }
  if (force.fox && !grid[4].includes('fox') && !foxes.some((f) => f.reel === 4)) grid[4][Math.floor(rand() * ROWS)] = 'fox';
  return grid;
}

// Выигрыши по путям. mult: { клетка: множитель } для лис.
// Сумма по всем путям = выплата × Π по барабанам (Σ множителей подходящих клеток).
function waysWins(grid, mult = {}) {
  const wins = [];
  for (const s of PAY_SYMBOLS) {
    let product = 1;
    let len = 0;
    let real = false;
    const cells = [];
    for (let r = 0; r < REELS; r++) {
      let sum = 0;
      const here = [];
      for (let y = 0; y < ROWS; y++) {
        const x = grid[r][y];
        if (x === s || x === 'fox') {
          sum += x === 'fox' ? (mult[cellOf(r, y)] || 1) : 1;
          if (x === s) real = true;
          here.push(cellOf(r, y));
        }
      }
      if (!sum) break;
      product *= sum;
      len += 1;
      cells.push(...here);
    }
    // Путь из одних лис не платит: нужен хоть один настоящий символ.
    if (len < 3 || !real) continue;
    wins.push({ symbol: s, len, ways: product, cells, pay: (SYMBOLS[s].pays[len - 3] * product) / UNIT });
  }
  return wins;
}

const countSym = (grid, s) => grid.reduce((n, col) => n + col.filter((x) => x === s).length, 0);

function evaluate(grid, mult) {
  const wins = waysWins(grid, mult);
  const n = countSym(grid, 'torii');
  const scatter = n >= 3 ? { count: n, pay: SCATTER_PAY[Math.min(5, n)] } : null;
  const pay = wins.reduce((s, w) => s + w.pay, 0) + (scatter ? scatter.pay : 0);
  return { wins, scatter, pay };
}

// Одно вращение парада: поле, новые лисы встают в строй, считаем выигрыш.
// foxes — лисы, уже стоящие на поле (после шага). Возвращает шаг и обновлённый список лис.
function rollStep(rand, table, tails, foxes, ids, force) {
  const grid = rollGrid(rand, table, foxes, force);
  const arrived = [];
  for (let r = 0; r < REELS; r++) {
    for (let y = 0; y < ROWS; y++) {
      if (grid[r][y] !== 'fox') continue;
      const f = { id: ++ids.n, reel: r, row: y, tails: r === 4 && force.fox ? force.fox : pickWeighted(rand, tails) };
      arrived.push(f);
    }
  }
  const all = [...foxes, ...arrived];
  const mult = {};
  for (const f of all) {
    grid[f.reel][f.row] = 'fox';
    mult[cellOf(f.reel, f.row)] = f.tails;
  }
  const ev = evaluate(grid, mult);
  return { step: { grid, foxes: all.map((f) => ({ ...f })), arrived: arrived.map((f) => f.id), ...ev }, foxes: all };
}

// Шаг парада: все лисы на барабан левее; с первого барабана уходят. grow — хвостов прибавить.
function walk(foxes, grow) {
  return foxes
    .map((f) => ({ ...f, reel: f.reel - 1, tails: Math.min(MAX_TAILS, f.tails + grow) }))
    .filter((f) => f.reel >= 0);
}

// Основная игра: вращение и бесплатные шаги парада, пока на поле есть лисы.
function baseRound(rand, force = {}) {
  const ids = { n: 0 };
  const steps = [];
  let foxes = [];
  let trigger = 0;
  let pay = 0;
  for (;;) {
    const { step, foxes: now } = rollStep(rand, BASE_WEIGHTS, TAILS, foxes, ids, steps.length ? {} : force);
    steps.push(step);
    pay += step.pay;
    if (step.scatter && !trigger) trigger = step.scatter.count;
    foxes = walk(now, 0);
    if (!foxes.length || steps.length >= MAX_STEPS) break;
  }
  return { steps, pay, trigger };
}

// «Ночь ста демонов»: spins бесплатных вращений; лисы шагают по барабану за вращение и растут.
function night(rand, count) {
  const ids = { n: 100 };
  const steps = [];
  let foxes = [];
  let left = FREE_SPINS[Math.min(5, count)];
  const total0 = left;
  let pay = 0;
  let retriggers = 0;
  while ((left > 0 || foxes.length) && steps.length < MAX_STEPS) {
    const extra = left <= 0;            // вращения кончились — парад доигрывается
    if (!extra) left -= 1;
    const { step, foxes: now } = rollStep(rand, FS_WEIGHTS, FS_TAILS, foxes, ids, {});
    if (step.scatter) {
      left += RETRIGGER;
      retriggers += 1;
    }
    step.left = left;
    step.extra = extra;
    steps.push(step);
    pay += step.pay;
    foxes = walk(now, 1);
  }
  return { spins: total0, retriggers, steps, pay };
}

// Полный исход ставки. mode: 'spin' | 'buy-bonus'. rig (админ): 'bonus' | 'fox' | 'lose'.
function play(rand, { mode = 'spin', rig = null } = {}) {
  const force = {};
  if (mode === 'buy-bonus' || rig === 'bonus') force.torii = 3;
  if (rig === 'fox') force.fox = 9;
  let base;
  if (rig === 'lose') {
    do base = baseRound(rand); while (base.pay > 0 || base.trigger);
  } else {
    base = baseRound(rand, force);
  }
  let total = base.pay;
  const out = { mode, base, night: null };
  if (base.trigger) {
    out.night = night(rand, base.trigger);
    total += out.night.pay;
  }
  out.capped = total > MAX_WIN;
  out.mult = Math.min(MAX_WIN, Math.round(total * 100) / 100);
  return out;
}

const costOf = (mode, bet) => (mode === 'buy-bonus' ? bet * BUY.bonus : bet);

module.exports = {
  REELS, ROWS, CELLS, UNIT, SYMBOLS, PAY_SYMBOLS, SCATTER_PAY, FREE_SPINS, RETRIGGER, FOX_REELS, TAILS, FS_TAILS, MAX_TAILS, BUY, MAX_WIN,
  play, evaluate, waysWins, rollGrid, baseRound, night, walk, costOf, BASE_WEIGHTS, FS_WEIGHTS,
};
