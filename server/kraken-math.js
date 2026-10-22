// «Кракен: сундук глубин» — математика слота. Чистые функции от генератора rand() -> [0, 1):
// сервер даёт криптослучайность, тесты и подбор отдачи — быстрый генератор с зерном.
//
// Поле 5×4, 20 линий слева направо. Выплаты по линиям — в ставках на линию (ставка / 20),
// всё остальное (жемчуг, скаттеры, джекпоты) — в общих ставках. Итог спина — множитель ставки.
//
// Фишки:
//  • Кракен (вайлд, барабаны 2–5) заменяет обычные символы и забирает жемчуг со своего барабана.
//  • «Хватка Кракена»: иногда после остановки щупальца делают 1–3 барабана целиком дикими.
//  • 3+ карты сокровищ — фриспины «Пробуждение Кракена»: каждый Кракен двигает шкалу,
//    каждые 4 — Кракен просыпается сильнее: +5 вращений и множитель жемчуга ×2 → ×3 → ×5 → ×10.
//    В фриспинах Кракен уже забирает жемчуг со всего поля, а не только со своего барабана.
//  • 6+ жемчужин — «Сундук глубин» (hold & win): жемчуг липнет, 3 вращения, новая жемчужина
//    возвращает их к 3. Жемчужины-джекпоты, жемчужина Кракена забирает себе всё поле,
//    заполнил все 20 клеток — Гранд.

const REELS = 5;
const ROWS = 4;
const CELLS = REELS * ROWS;
const LINE_COUNT = 20;
const MAX_WIN = 5000;          // потолок выигрыша за спин, в ставках

// Линии: ряд (0 — верхний) на каждом барабане.
const LINES = [
  [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [3, 3, 3, 3, 3],
  [0, 1, 2, 1, 0], [3, 2, 1, 2, 3], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2],
  [0, 0, 1, 0, 0], [3, 3, 2, 3, 3], [1, 0, 0, 0, 1], [2, 3, 3, 3, 2],
  [1, 1, 0, 1, 1], [2, 2, 3, 2, 2], [0, 1, 1, 1, 0], [3, 2, 2, 2, 3],
  [1, 2, 2, 2, 1], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [3, 2, 3, 2, 3],
];

// Символы. pays: за 3, 4, 5 в линию, в ставках на линию.
const SYMBOLS = {
  anchor: { name: 'Якорь', pays: [7, 20, 60] },
  compass: { name: 'Компас', pays: [7, 20, 60] },
  helm: { name: 'Штурвал', pays: [9, 28, 80] },
  rum: { name: 'Ром', pays: [9, 28, 80] },
  jelly: { name: 'Медуза', pays: [18, 55, 170] },
  shark: { name: 'Акула', pays: [24, 80, 250] },
  angler: { name: 'Удильщик', pays: [35, 120, 400] },
  ship: { name: 'Галеон', pays: [60, 250, 1000] },
  wild: { name: 'Кракен', pays: null },
  map: { name: 'Карта сокровищ', pays: null },
  pearl: { name: 'Жемчужина', pays: null },
};
const LINE_SYMBOLS = ['anchor', 'compass', 'helm', 'rum', 'jelly', 'shark', 'angler', 'ship'];

// Скаттеры платят сами (в ставках) и дают фриспины.
const SCATTER_PAY = { 3: 2, 4: 5, 5: 20 };
const FREE_SPINS = { 3: 8, 4: 10, 5: 12 };
const FS_LEVELS = [1, 2, 3, 5, 10];   // множитель жемчуга по уровню пробуждения
const FS_PER_LEVEL = 4;               // Кракенов на уровень
const FS_EXTRA = 5;                   // вращений за уровень

const HW_TRIGGER = 6;
const HW_RESPINS = 3;
const JACKPOTS = { mini: 20, minor: 50, major: 200, grand: 1000 };

// Веса символов на каждом барабане. wild не бывает на первом.
function weights(base) {
  return Array.from({ length: REELS }, (_, r) => ({ ...base, wild: r === 0 ? 0 : base.wild }));
}
const BASE_WEIGHTS = weights({
  anchor: 15, compass: 15, helm: 13, rum: 13, jelly: 9, shark: 8, angler: 6, ship: 4.5, wild: 1.8, map: 1.6, pearl: 8.1,
});
const FS_WEIGHTS = weights({
  anchor: 15, compass: 15, helm: 13, rum: 13, jelly: 9, shark: 8, angler: 6, ship: 4.5, wild: 3.4, map: 0, pearl: 7,
});

// Стоимость жемчужины (в ставках): [значение, вес]. В основной игре жемчуг мельче — его там много.
const PEARL_VALUES = [[0.5, 30], [1, 26], [2, 18], [3, 10], [5, 8], [10, 4.5], [15, 2], [25, 1], [50, 0.4]];
const BASE_PEARL_VALUES = [[0.2, 30], [0.5, 30], [1, 20], [2, 10], [3, 5], [5, 3], [10, 1.5], [25, 0.4], [50, 0.1]];
// В сундуке: обычный жемчуг, джекпоты и жемчужина Кракена.
const HW_PEARLS = [...PEARL_VALUES, ['mini', 1.6], ['minor', 0.45], ['major', 0.08], ['kraken', 1.2]];
const HW_LAND = 0.072;     // шанс, что пустая клетка поймает жемчужину за вращение сундука

const TENTACLE_CHANCE = 1 / 45;   // «Хватка Кракена» в основной игре

// Цены покупки бонуса (в ставках): подобраны симуляцией так, чтобы отдача была как у игры.
const BUY = { fs: 100, hw: 45 };

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

const cell = (reel, row) => reel * ROWS + row;

// Поле: grid[reel][row] — id символа; pearls: { клетка: значение }.
// На одном барабане не больше одной карты сокровищ.
function rollGrid(rand, table, force = {}, values = PEARL_VALUES) {
  const grid = [];
  const pearls = {};
  for (let r = 0; r < REELS; r++) {
    const col = [];
    let hasMap = false;
    for (let y = 0; y < ROWS; y++) {
      let s = pickWeighted(rand, reelEntries(table[r]));
      if (s === 'map') {
        if (hasMap) s = LINE_SYMBOLS[Math.floor(rand() * 4)];
        hasMap = true;
      }
      col.push(s);
    }
    grid.push(col);
  }
  // Покупка бонуса: подложить карты или жемчуг.
  if (force.maps) {
    const reels = shuffle(rand, [0, 1, 2, 3, 4]).slice(0, force.maps);
    for (const r of reels) {
      if (!grid[r].includes('map')) grid[r][Math.floor(rand() * ROWS)] = 'map';
    }
  }
  if (force.pearls) {
    const cells = shuffle(rand, Array.from({ length: CELLS }, (_, i) => i));
    let have = grid.flat().filter((s) => s === 'pearl').length;
    for (const c of cells) {
      if (have >= force.pearls) break;
      const r = Math.floor(c / ROWS);
      const y = c % ROWS;
      if (grid[r][y] === 'pearl' || grid[r][y] === 'map') continue;
      grid[r][y] = 'pearl';
      have += 1;
    }
  }
  for (let r = 0; r < REELS; r++) {
    for (let y = 0; y < ROWS; y++) if (grid[r][y] === 'pearl') pearls[cell(r, y)] = pickWeighted(rand, values);
  }
  return { grid, pearls };
}

function shuffle(rand, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Выигрыши по линиям: [{ line, symbol, count, pay }] (pay — в общих ставках).
function lineWins(grid) {
  const wins = [];
  LINES.forEach((rows, li) => {
    const syms = rows.map((y, r) => grid[r][y]);
    // Символ линии — первый не-вайлд слева; линия из одних вайлдов невозможна (на 1-м барабане их нет).
    const first = syms.find((s) => s !== 'wild');
    if (!SYMBOLS[first] || !SYMBOLS[first].pays) return;
    let count = 0;
    while (count < REELS && (syms[count] === first || syms[count] === 'wild')) count += 1;
    if (count < 3) return;
    wins.push({ line: li, symbol: first, count, pay: SYMBOLS[first].pays[count - 3] / LINE_COUNT });
  });
  return wins;
}

const countSym = (grid, s) => grid.reduce((n, col) => n + col.filter((x) => x === s).length, 0);
// Барабаны, где есть Кракен: каждый такой барабан — один сборщик жемчуга.
const collectorReels = (grid) => grid.map((col, r) => (col.includes('wild') ? r : -1)).filter((r) => r >= 0);
const pearlSum = (pearls) => Object.values(pearls).reduce((s, v) => s + v, 0);

// Один спин на поле: линии, сбор жемчуга Кракеном, скаттеры.
// mult — множитель сбора; wide — Кракен собирает со всего поля (фриспины), иначе со своего барабана.
function evaluate(grid, pearls, mult = 1, wide = false) {
  const wins = lineWins(grid);
  const collectors = collectorReels(grid);
  let collect = null;
  if (collectors.length) {
    // Какие жемчужины забирает каждый Кракен: [клетка].
    const take = collectors.map((r) => Object.keys(pearls).map(Number).filter((c) => wide || Math.floor(c / ROWS) === r));
    const sum = take.reduce((s, cells) => s + cells.reduce((x, c) => x + pearls[c], 0), 0);
    if (sum > 0) collect = { reels: collectors, cells: take, sum, mult, pay: sum * mult };
  }
  const maps = countSym(grid, 'map');
  const scatter = maps >= 3 ? { count: maps, pay: SCATTER_PAY[Math.min(5, maps)] } : null;
  const pay = wins.reduce((s, w) => s + w.pay, 0) + (collect ? collect.pay : 0) + (scatter ? scatter.pay : 0);
  return { wins, collect, scatter, pay };
}

// «Хватка Кракена»: 1–3 барабана из 2–5 целиком становятся Кракенами.
function tentacleGrab(rand, grid) {
  const n = pickWeighted(rand, [[1, 60], [2, 30], [3, 10]]);
  const reels = shuffle(rand, [1, 2, 3, 4]).slice(0, n).sort();
  for (const r of reels) {
    for (let y = 0; y < ROWS; y++) {
      // Жемчуг и карты щупальца не трогают.
      if (grid[r][y] !== 'pearl' && grid[r][y] !== 'map') grid[r][y] = 'wild';
    }
  }
  return reels;
}

// Сундук глубин. start: { клетка: значение } — жемчужины, что запустили бонус.
function holdAndWin(rand, start) {
  const board = { ...start };
  const rounds = [];
  let left = HW_RESPINS;
  while (left > 0 && Object.keys(board).length < CELLS) {
    const landed = [];
    for (let c = 0; c < CELLS; c++) {
      if (board[c] !== undefined || rand() >= HW_LAND) continue;
      const v = pickWeighted(rand, HW_PEARLS);
      landed.push({ cell: c, value: v });
    }
    // Сначала обычные и джекпоты, потом Кракены: Кракен забирает всё, что на поле к этому моменту.
    landed.sort((a, b) => (a.value === 'kraken') - (b.value === 'kraken'));
    for (const l of landed) {
      if (l.value === 'kraken') {
        l.collected = Object.values(board).reduce((s, v) => s + valueOf(v), 0);
        board[l.cell] = l.collected;
      } else {
        board[l.cell] = l.value;
      }
    }
    left = landed.length ? HW_RESPINS : left - 1;
    rounds.push({ landed, left });
  }
  const full = Object.keys(board).length === CELLS;
  const pay = Object.values(board).reduce((s, v) => s + valueOf(v), 0) + (full ? JACKPOTS.grand : 0);
  return { start, rounds, board, full, pay };
}
const valueOf = (v) => (typeof v === 'number' ? v : JACKPOTS[v]);

// Фриспины.
function freeSpins(rand, count) {
  const spins = [];
  let left = count;
  let meter = 0;
  let level = 0;
  let pay = 0;
  while (left > 0) {
    left -= 1;
    const { grid, pearls } = rollGrid(rand, FS_WEIGHTS);
    const ev = evaluate(grid, pearls, FS_LEVELS[level], true);
    const krakens = collectorReels(grid).length;
    meter += krakens;
    let levelUp = false;
    // Новый уровень действует со следующего вращения.
    while (level < FS_LEVELS.length - 1 && meter >= (level + 1) * FS_PER_LEVEL) {
      level += 1;
      left += FS_EXTRA;
      levelUp = true;
    }
    pay += ev.pay;
    spins.push({ grid, pearls, ...ev, meter, level, levelUp, left });
  }
  return { count, spins, pay };
}

// Полный исход ставки. mode: 'spin' | 'buy-fs' | 'buy-hw'. rig (админ): 'fs' | 'hw' | 'tentacle' | 'lose' | 'ships'.
function play(rand, { mode = 'spin', rig = null } = {}) {
  const force = mode === 'buy-fs' || rig === 'fs' ? { maps: 3 } : mode === 'buy-hw' || rig === 'hw' ? { pearls: HW_TRIGGER } : {};
  let { grid, pearls } = rollGrid(rand, BASE_WEIGHTS, force, BASE_PEARL_VALUES);
  if (rig === 'lose') ({ grid, pearls } = losingGrid(rand));
  if (rig === 'ships') ({ grid, pearls } = { grid: Array.from({ length: REELS }, () => Array(ROWS).fill('ship')), pearls: {} });
  let tentacle = null;
  if (rig === 'tentacle' || (rig !== 'lose' && rig !== 'ships' && mode === 'spin' && rand() < TENTACLE_CHANCE)) tentacle = tentacleGrab(rand, grid);
  const base = { grid, pearls, tentacle, ...evaluate(grid, pearls) };
  let total = base.pay;
  const out = { mode, base, hw: null, fs: null };
  if (Object.keys(pearls).length >= HW_TRIGGER) {
    out.hw = holdAndWin(rand, pearls);
    total += out.hw.pay;
  }
  if (base.scatter) {
    out.fs = freeSpins(rand, FREE_SPINS[Math.min(5, base.scatter.count)]);
    total += out.fs.pay;
  }
  out.capped = total > MAX_WIN;
  out.mult = Math.min(MAX_WIN, Math.round(total * 100) / 100);
  return out;
}

// Поле без единого выигрыша (админ: «следующий спин проиграет»).
function losingGrid(rand) {
  for (;;) {
    const g = rollGrid(rand, BASE_WEIGHTS, {}, BASE_PEARL_VALUES);
    const ev = evaluate(g.grid, g.pearls);
    if (ev.pay === 0 && Object.keys(g.pearls).length < HW_TRIGGER) return g;
  }
}

// Цена ставки: обычный спин — bet, покупка — bet × цена.
const costOf = (mode, bet) => (mode === 'buy-fs' ? bet * BUY.fs : mode === 'buy-hw' ? bet * BUY.hw : bet);

module.exports = {
  REELS, ROWS, CELLS, LINES, LINE_COUNT, SYMBOLS, LINE_SYMBOLS, SCATTER_PAY, FREE_SPINS, FS_LEVELS, FS_PER_LEVEL, FS_EXTRA,
  HW_TRIGGER, HW_RESPINS, JACKPOTS, PEARL_VALUES, BUY, MAX_WIN, TENTACLE_CHANCE,
  play, evaluate, lineWins, holdAndWin, freeSpins, rollGrid, costOf, valueOf, BASE_WEIGHTS, FS_WEIGHTS,
};
