// «Салун мертвецов» — математика слота. Чистые функции от генератора rand() -> [0, 1).
//
// Поле 5×3, 243 пути: символ платит, если стоит на соседних барабанах слева направо в любом ряду.
// Выплаты — в двадцатых долях ставки за путь; скаттеры — в ставках. Итог спина — множитель ставки.
//
// Фишки:
//  • Кольт (вайлд, барабаны 2–4) раскрывается на весь барабан.
//  • «Шальная пуля»: иногда выстрелы пробивают 1–4 клетки, и они становятся дикими.
//  • 3, 4, 5 плакатов «Разыскивается» — «Дуэль на закате»: столько же жизней (шляп).
//    Перед каждым вращением дуэль: твоя пуля оставляет на поле липкий вайлд с множителем
//    (попал в уже простреленную клетку — множитель растёт), пуля шерифа может отнять жизнь.
//    Вращения идут, пока жизни есть. Множители вайлдов на пути перемножаются.

const REELS = 5;
const ROWS = 3;
const CELLS = REELS * ROWS;
const UNIT = 20;                   // выплата за путь — в двадцатых ставки

const SYMBOLS = {
  horseshoe: { name: 'Подкова', pays: [2, 6, 16] },
  whiskey: { name: 'Виски', pays: [2, 6, 16] },
  hat: { name: 'Шляпа', pays: [3, 7, 22] },
  boot: { name: 'Сапог со шпорой', pays: [3, 7, 22] },
  vulture: { name: 'Стервятник', pays: [5, 15, 50] },
  skull: { name: 'Бычий череп', pays: [6, 20, 70] },
  barman: { name: 'Бармен-мертвец', pays: [8, 30, 100] },
  sheriff: { name: 'Шериф-скелет', pays: [12, 50, 200] },
  colt: { name: 'Кольт', pays: null },
  wanted: { name: 'Разыскивается', pays: null },
};
const PAY_SYMBOLS = ['horseshoe', 'whiskey', 'hat', 'boot', 'vulture', 'skull', 'barman', 'sheriff'];
const LOW = ['horseshoe', 'whiskey', 'hat', 'boot'];

const SCATTER_PAY = { 3: 2, 4: 5, 5: 20 };
const LIVES = { 3: 3, 4: 4, 5: 5 };
const WILD_REELS = [1, 2, 3];          // где бывает Кольт
const BULLET_REELS = [1, 2, 3, 4];     // куда попадают пули (первый барабан — нет)
const BULLET_CHANCE = 1 / 30;
const DUEL = {
  hit: 0.5,                             // твоя пуля попадает в поле
  sheriff: 0.37,                        // шериф попадает в тебя
  mults: [[1, 100]],                    // новый вайлд — ×1, повторное попадание поднимает до ×3
  maxMult: 3,
  maxSpins: 50,
};
const BUY = { duel: 115, super: 500 };   // цены покупки (в ставках), подобраны симуляцией

function weights(base) {
  return Array.from({ length: REELS }, (_, r) => ({ ...base, colt: WILD_REELS.includes(r) ? base.colt : 0 }));
}
const BASE_WEIGHTS = weights({
  horseshoe: 16, whiskey: 16, hat: 15, boot: 15, vulture: 9, skull: 7, barman: 5.5, sheriff: 4, colt: 1.6, wanted: 2.2,
});
const FS_WEIGHTS = weights({
  horseshoe: 16, whiskey: 16, hat: 15, boot: 15, vulture: 9, skull: 7, barman: 5.5, sheriff: 4, colt: 1.0, wanted: 0,
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

// Поле: grid[reel][row]. Плакатов — не больше одного на барабане. force.wanted — подложить плакаты.
function rollGrid(rand, table, force = {}) {
  const grid = [];
  for (let r = 0; r < REELS; r++) {
    const col = [];
    let has = false;
    for (let y = 0; y < ROWS; y++) {
      let s = pickWeighted(rand, reelEntries(table[r]));
      if (s === 'wanted') {
        if (has) s = LOW[Math.floor(rand() * LOW.length)];
        has = true;
      }
      col.push(s);
    }
    grid.push(col);
  }
  if (force.wanted) {
    for (const r of shuffle(rand, [0, 1, 2, 3, 4]).slice(0, force.wanted)) {
      if (!grid[r].includes('wanted')) grid[r][Math.floor(rand() * ROWS)] = 'wanted';
    }
  }
  return grid;
}

// Кольт раскрывается: весь барабан дикий. -> список раскрытых барабанов.
function expandColts(grid) {
  const reels = [];
  grid.forEach((col, r) => {
    if (!col.includes('colt')) return;
    reels.push(r);
    for (let y = 0; y < ROWS; y++) if (col[y] !== 'wanted') col[y] = 'colt';
  });
  return reels;
}

// Выигрыши по путям. mult: { клетка: множитель } для вайлдов (по умолчанию ×1).
// Сумма по всем путям = выплата × Π по барабанам (Σ множителей подходящих клеток).
function waysWins(grid, mult = {}) {
  const wins = [];
  for (const s of PAY_SYMBOLS) {
    let product = 1;
    let len = 0;
    const cells = [];
    for (let r = 0; r < REELS; r++) {
      let sum = 0;
      const here = [];
      for (let y = 0; y < ROWS; y++) {
        const x = grid[r][y];
        if (x === s || x === 'colt') {
          sum += x === 'colt' ? (mult[cellOf(r, y)] || 1) : 1;
          here.push(cellOf(r, y));
        }
      }
      if (!sum) break;
      product *= sum;
      len += 1;
      cells.push(...here);
    }
    if (len < 3) continue;
    // На первом барабане вайлдов нет, так что путь всегда начинается с настоящего символа.
    wins.push({ symbol: s, len, ways: product, cells, pay: (SYMBOLS[s].pays[len - 3] * product) / UNIT });
  }
  return wins;
}

const countSym = (grid, s) => grid.reduce((n, col) => n + col.filter((x) => x === s).length, 0);

function evaluate(grid, mult) {
  const wins = waysWins(grid, mult);
  const n = countSym(grid, 'wanted');
  const scatter = n >= 3 ? { count: n, pay: SCATTER_PAY[Math.min(5, n)] } : null;
  const pay = wins.reduce((s, w) => s + w.pay, 0) + (scatter ? scatter.pay : 0);
  return { wins, scatter, pay };
}

// «Шальная пуля»: 1–4 клетки на барабанах 2–5 становятся дикими.
function strayBullets(rand, grid) {
  const n = pickWeighted(rand, [[1, 45], [2, 35], [3, 15], [4, 5]]);
  const free = [];
  for (const r of BULLET_REELS) for (let y = 0; y < ROWS; y++) if (grid[r][y] !== 'wanted' && grid[r][y] !== 'colt') free.push(cellOf(r, y));
  const cells = shuffle(rand, free).slice(0, n).sort((a, b) => a - b);
  for (const c of cells) grid[Math.floor(c / ROWS)][c % ROWS] = 'colt';
  return cells;
}

// Дуэль на закате. start: { lives, sticky: { клетка: множитель } }.
function duel(rand, start) {
  let lives = start.lives;
  const sticky = { ...(start.sticky || {}) };
  const rounds = [];
  let pay = 0;
  const targets = [];
  for (const r of BULLET_REELS) for (let y = 0; y < ROWS; y++) targets.push(cellOf(r, y));
  while (lives > 0 && rounds.length < DUEL.maxSpins) {
    // Выстрелы.
    const shot = { hit: rand() < DUEL.hit, cell: null, mult: 0, upgraded: false };
    if (shot.hit) {
      shot.cell = targets[Math.floor(rand() * targets.length)];
      if (sticky[shot.cell]) {
        sticky[shot.cell] = Math.min(DUEL.maxMult, sticky[shot.cell] + 1);
        shot.upgraded = true;
      } else {
        sticky[shot.cell] = pickWeighted(rand, DUEL.mults);
      }
      shot.mult = sticky[shot.cell];
    }
    const sheriff = rand() < DUEL.sheriff;
    if (sheriff) lives -= 1;
    // Вращение: раскрытые Кольты и липкие вайлды.
    const grid = rollGrid(rand, FS_WEIGHTS);
    const expanded = expandColts(grid);
    const mult = {};
    for (const [c, m] of Object.entries(sticky)) {
      grid[Math.floor(c / ROWS)][c % ROWS] = 'colt';
      mult[c] = m;
    }
    const ev = evaluate(grid, mult);
    pay += ev.pay;
    rounds.push({ shot, sheriff, lives, grid, expanded, sticky: { ...sticky }, ...ev });
  }
  return { lives: start.lives, start: start.sticky || {}, rounds, pay };
}

// Полный исход ставки. mode: 'spin' | 'buy-duel' | 'buy-super'. rig (админ): 'duel' | 'bullets' | 'lose'.
function play(rand, { mode = 'spin', rig = null } = {}) {
  const forceDuel = mode !== 'spin' || rig === 'duel';
  let grid = rollGrid(rand, BASE_WEIGHTS, forceDuel ? { wanted: 3 } : {});
  if (rig === 'lose') grid = losingGrid(rand);
  const expanded = expandColts(grid);
  let bullets = null;
  if (rig === 'bullets' || (mode === 'spin' && !rig && rand() < BULLET_CHANCE)) bullets = strayBullets(rand, grid);
  const base = { grid, expanded, bullets, ...evaluate(grid) };
  let total = base.pay;
  const out = { mode, base, duel: null };
  if (base.scatter) {
    const start = mode === 'buy-super' ? { lives: 4, sticky: superStart(rand) } : { lives: LIVES[Math.min(5, base.scatter.count)] };
    out.duel = duel(rand, start);
    total += out.duel.pay;
  }
  // Без потолка: сколько насчитали — столько и платим.
  out.mult = Math.round(total * 100) / 100;
  return out;
}

// «Дуэль на рассвете» (покупка): 4 жизни и два липких вайлда с самого начала.
function superStart(rand) {
  const targets = [];
  for (const r of BULLET_REELS) for (let y = 0; y < ROWS; y++) targets.push(cellOf(r, y));
  const [a, b] = shuffle(rand, targets);
  return { [a]: 1, [b]: 1 };
}

function losingGrid(rand) {
  for (;;) {
    const g = rollGrid(rand, BASE_WEIGHTS);
    const copy = g.map((c) => c.slice());
    expandColts(copy);
    if (evaluate(copy).pay === 0) return g;
  }
}

const costOf = (mode, bet) => (mode === 'buy-duel' ? bet * BUY.duel : mode === 'buy-super' ? bet * BUY.super : bet);

module.exports = {
  REELS, ROWS, CELLS, UNIT, SYMBOLS, PAY_SYMBOLS, SCATTER_PAY, LIVES, DUEL, BUY, BULLET_CHANCE, WILD_REELS, BULLET_REELS,
  play, evaluate, waysWins, expandColts, duel, rollGrid, costOf, BASE_WEIGHTS, FS_WEIGHTS,
};
