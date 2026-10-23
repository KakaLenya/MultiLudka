// «Заброшенный цирк» — математика слота. Чистые функции от генератора rand() -> [0, 1).
//
// Поле 5×3, 25 линий: символ платит, если стоит на линии подряд с первого барабана. Выплаты — в
// ставках на линию (ставка / 25); итог спина — множитель всей ставки.
//
// Фишки:
//  • Огненный обруч — дикий (барабаны 2–4), заменяет всё, кроме мишени.
//  • Барабан распорядителя — шестой барабан над полем, крутится каждый ход и даёт модификатор:
//    антракт (ничего), «клоуны размножаются», «дрессировка» (один из старших символов — дикий),
//    множитель ×2/×3/×5, «вторая попытка» (пустой ход переигрывается), «огненные обручи»
//    (целые барабаны дикие), «ещё мишень».
//  • 3, 4, 5 мишеней — «Метатель ножей»: 3, 4 или 5 ножей и щит из 15 секторов (призы, удвоение,
//    +2 ножа и две ассистентки). Попал в ассистентку — бонус кончается. Исход щита считается здесь
//    заранее: игрок выбирает сектор, но это решает только, где покажется очередной приз.

const REELS = 5;
const ROWS = 3;
const CELLS = REELS * ROWS;

const LINES = [
  [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
  [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1],
  [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 1, 0, 1, 1], [1, 1, 2, 1, 1],
  [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [0, 0, 2, 0, 0],
  [2, 2, 0, 2, 2], [1, 0, 2, 0, 1], [1, 2, 0, 2, 1], [0, 2, 2, 2, 0], [2, 0, 0, 0, 2],
];

const SYMBOLS = {
  ticket: { name: 'Билет', pays: [4, 10, 30] },
  popcorn: { name: 'Попкорн', pays: [4, 10, 30] },
  pins: { name: 'Булавы', pays: [5, 12, 40] },
  tophat: { name: 'Цилиндр', pays: [5, 12, 40] },
  bear: { name: 'Медведь на шаре', pays: [8, 25, 80] },
  strongman: { name: 'Силач', pays: [10, 30, 100] },
  teller: { name: 'Гадалка', pays: [12, 40, 150] },
  acrobat: { name: 'Акробатка', pays: [15, 50, 200] },
  clown: { name: 'Клоун', pays: [25, 100, 500] },
  hoop: { name: 'Огненный обруч', pays: null },
  target: { name: 'Мишень', pays: null },
};
const PAY_SYMBOLS = ['ticket', 'popcorn', 'pins', 'tophat', 'bear', 'strongman', 'teller', 'acrobat', 'clown'];
const HIGH = ['bear', 'strongman', 'teller', 'acrobat'];
const LOW = ['ticket', 'popcorn', 'pins', 'tophat'];

const SCATTER_PAY = { 3: 2, 4: 10, 5: 50 };
const PAY_SCALE = 2.05;                    // общий множитель выплат линий (подбирается симуляцией)
const KNIVES = { 3: 3, 4: 4, 5: 5 };
const HOOP_REELS = [1, 2, 3];
const BUY = { knives: 82 };                // цена покупки метателя ножей (в ставках), подобрана симуляцией

const WEIGHTS = {
  ticket: 15, popcorn: 15, pins: 13, tophat: 13, bear: 8, strongman: 7, teller: 5.5, acrobat: 4.5, clown: 3, hoop: 1.2, target: 1.9,
};
function reelTable(r) {
  return Object.entries({ ...WEIGHTS, hoop: HOOP_REELS.includes(r) ? WEIGHTS.hoop : 0 }).filter(([, w]) => w > 0);
}
const TABLES = Array.from({ length: REELS }, (_, r) => reelTable(r));

// Барабан распорядителя: модификатор хода и его вес.
const MODS = [
  ['blank', 52], ['clowns', 10], ['trained', 8], ['x2', 9], ['x3', 5], ['x5', 2], ['again', 8], ['hoops', 3], ['target', 3],
];
const MOD_NAMES = {
  blank: 'Антракт',
  clowns: 'Клоуны размножаются',
  trained: 'Дрессировка',
  x2: 'Множитель ×2',
  x3: 'Множитель ×3',
  x5: 'Множитель ×5',
  again: 'Вторая попытка',
  hoops: 'Огненные обручи',
  target: 'Ещё мишень',
};

// Щит метателя: 15 секторов. Числа — призы в ставках.
const BOARD = [3, 4, 5, 7, 8, 12, 15, 20, 40, 75, 150, 'x2', 'knives', 'assistant', 'assistant'];
const BOARD_SCALE = 1;                    // общий множитель призов щита (подбирается симуляцией)
const EXTRA_KNIVES = 2;

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
const cellOf = (r, y) => r * ROWS + y;
function shuffle(rand, arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
const countSym = (grid, s) => grid.reduce((n, col) => n + col.filter((x) => x === s).length, 0);

// Поле: на барабане не больше одной мишени. force.target — подложить столько мишеней.
function rollGrid(rand, force = {}) {
  const grid = [];
  for (let r = 0; r < REELS; r++) {
    const col = [];
    let target = false;
    for (let y = 0; y < ROWS; y++) {
      let s = pickWeighted(rand, TABLES[r]);
      if (s === 'target' && target) s = LOW[Math.floor(rand() * LOW.length)];
      if (s === 'target') target = true;
      col.push(s);
    }
    grid.push(col);
  }
  if (force.target) {
    for (const r of shuffle(rand, [0, 1, 2, 3, 4])) {
      if (countSym(grid, 'target') >= force.target) break;
      if (grid[r].includes('target')) continue;
      grid[r][Math.floor(rand() * ROWS)] = 'target';
    }
  }
  return grid;
}

// Модификатор применяется к полю до подсчёта. Возвращает описание для показа.
function applyMod(rand, grid, type) {
  const mod = { type, name: MOD_NAMES[type] };
  if (type === 'clowns') {
    const free = [];
    for (let r = 0; r < REELS; r++) for (let y = 0; y < ROWS; y++) if (grid[r][y] !== 'target' && grid[r][y] !== 'hoop' && grid[r][y] !== 'clown') free.push([r, y]);
    mod.cells = shuffle(rand, free).slice(0, 2 + Math.floor(rand() * 3)).map(([r, y]) => {
      grid[r][y] = 'clown';
      return cellOf(r, y);
    });
  } else if (type === 'trained') {
    mod.symbol = HIGH[Math.floor(rand() * HIGH.length)];
  } else if (type === 'x2' || type === 'x3' || type === 'x5') {
    mod.mult = Number(type.slice(1));
  } else if (type === 'hoops') {
    mod.reels = shuffle(rand, [1, 2, 3]).slice(0, rand() < 0.75 ? 1 : 2).sort();
    for (const r of mod.reels) for (let y = 0; y < ROWS; y++) if (grid[r][y] !== 'target') grid[r][y] = 'hoop';
  } else if (type === 'target') {
    const free = [];
    for (let r = 0; r < REELS; r++) if (!grid[r].includes('target')) for (let y = 0; y < ROWS; y++) free.push([r, y]);
    if (free.length) {
      const [r, y] = free[Math.floor(rand() * free.length)];
      grid[r][y] = 'target';
      mod.cell = cellOf(r, y);
    }
  }
  return mod;
}

// Линии. wild — набор символов, которые сейчас дикие (обруч всегда, «дрессировка» добавляет свой).
function lineWins(grid, wild = new Set(['hoop'])) {
  const wins = [];
  LINES.forEach((rows, line) => {
    const syms = rows.map((y, r) => grid[r][y]);
    const isWild = (s) => wild.has(s);
    // Символ линии — первый не дикий; линия из одних диких платит как клоун.
    let sym = syms.find((s) => !isWild(s));
    if (sym === 'target') return;
    if (!sym) sym = 'clown';
    if (!SYMBOLS[sym].pays) return;
    let len = 0;
    while (len < REELS && (syms[len] === sym || isWild(syms[len]))) len++;
    // Дрессированный символ платит и сам за себя.
    if (len < 3) return;
    wins.push({ line, symbol: sym, len, cells: rows.slice(0, len).map((y, r) => cellOf(r, y)), pay: (SYMBOLS[sym].pays[len - 3] * PAY_SCALE) / LINES.length });
  });
  return wins;
}

// Один ход: поле, модификатор, подсчёт. modType — заранее известный модификатор (или крутим).
function rollStep(rand, { modType = null, force = {} } = {}) {
  const grid = rollGrid(rand, force);
  const type = modType || pickWeighted(rand, MODS);
  const mod = applyMod(rand, grid, type);
  const wild = new Set(['hoop']);
  if (mod.symbol) wild.add(mod.symbol);
  const wins = lineWins(grid, wild);
  const n = countSym(grid, 'target');
  const scatter = n >= 3 ? { count: n, pay: SCATTER_PAY[Math.min(5, n)] } : null;
  const mult = mod.mult || 1;
  const linePay = wins.reduce((s, w) => s + w.pay, 0) * mult;
  const pay = linePay + (scatter ? scatter.pay : 0);
  return { grid, mod, wins, scatter, mult, pay };
}

// Метатель ножей: ножи бросаются по очереди в случайные ещё целые секторы.
function knives(rand, count) {
  const board = shuffle(rand, BOARD.slice());
  const order = shuffle(rand, board.map((_, i) => i));
  let left = KNIVES[Math.min(5, count)];
  const start = left;
  const throws = [];
  let sum = 0;
  let doubled = 0;
  let hitAssistant = false;
  for (const i of order) {
    if (left <= 0) break;
    left -= 1;
    const s = board[i];
    throws.push(i);
    if (s === 'assistant') {
      hitAssistant = true;
      break;
    }
    if (s === 'x2') doubled += 1;
    else if (s === 'knives') left += EXTRA_KNIVES;
    else sum += s * BOARD_SCALE;
  }
  const pay = sum * 2 ** doubled;
  return { knives: start, board: board.map((s) => (typeof s === 'number' ? s * BOARD_SCALE : s)), throws, sum, doubled, assistant: hitAssistant, pay };
}

// Полный исход ставки. mode: 'spin' | 'buy-knives'. rig (админ): 'knives' | 'hoops' | 'lose'.
function play(rand, { mode = 'spin', rig = null } = {}) {
  const force = {};
  if (mode === 'buy-knives' || rig === 'knives') force.target = 3;
  const first = () => rollStep(rand, { modType: rig === 'hoops' ? 'hoops' : null, force });
  const steps = [];
  if (rig === 'lose') {
    let s;
    do s = rollStep(rand, { modType: 'blank' }); while (s.pay > 0 || s.scatter);
    steps.push(s);
  } else {
    steps.push(first());
    // «Вторая попытка»: пустой ход переигрывается один раз (без модификатора).
    if (steps[0].mod.type === 'again' && steps[0].pay === 0 && !steps[0].scatter) steps.push(rollStep(rand, { modType: 'blank' }));
  }
  let total = steps.reduce((t, s) => t + s.pay, 0);
  const trigger = steps.map((s) => s.scatter).find(Boolean);
  const out = { mode, steps, knives: null };
  if (trigger) {
    out.knives = knives(rand, trigger.count);
    total += out.knives.pay;
  }
  // Без потолка: сколько насчитали — столько и платим.
  out.mult = Math.round(total * 100) / 100;
  return out;
}

const costOf = (mode, bet) => (mode === 'buy-knives' ? bet * BUY.knives : bet);

module.exports = {
  REELS, ROWS, CELLS, LINES, SYMBOLS, PAY_SYMBOLS, HIGH, SCATTER_PAY, KNIVES, BOARD, EXTRA_KNIVES, MODS, MOD_NAMES, BUY, WEIGHTS,
  play, rollGrid, rollStep, applyMod, lineWins, knives, costOf,
};
