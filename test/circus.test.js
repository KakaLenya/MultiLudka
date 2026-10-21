const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const C = require('../server/circus-math');
const { createCircus } = require('../server/circus');

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const grid = (cols) => cols.map((c) => c.split(' '));

test('линии: подряд с первого барабана, обруч заменяет символ линии', () => {
  const g = grid([
    'clown ticket bear',
    'clown hoop bear',
    'clown pins bear',
    'ticket pins tophat',
    'popcorn pins tophat',
  ]);
  const wins = C.lineWins(g);
  const top = wins.find((w) => w.line === 1);              // верхний ряд: клоун × 3
  assert.deepEqual([top.symbol, top.len], ['clown', 3]);
  assert.ok(Math.abs(top.pay - (C.SYMBOLS.clown.pays[0] * 2.05) / C.LINES.length) < 1e-9);
  const mid = wins.find((w) => w.line === 0);              // средний ряд: билет, обруч, булавы — не линия
  assert.equal(mid, undefined);
  const allWild = grid(['hoop hoop hoop', 'hoop hoop hoop', 'hoop hoop hoop', 'ticket ticket ticket', 'ticket ticket ticket']);
  const five = C.lineWins(allWild).find((w) => w.line === 0);
  assert.deepEqual([five.symbol, five.len], ['ticket', 5]);
  // Мишень не платит линией.
  const targets = grid(['target ticket pins', 'target ticket pins', 'target ticket pins', 'bear popcorn tophat', 'bear popcorn tophat']);
  assert.equal(C.lineWins(targets).filter((w) => w.symbol === 'target').length, 0);
});

test('модификаторы: дрессировка делает символ диким, обручи заливают барабан, клоуны добавляются', () => {
  const g = grid(['bear ticket pins', 'popcorn teller pins', 'bear tophat ticket', 'ticket pins bear', 'popcorn pins bear']);
  const wild = new Set(['hoop', 'teller']);
  const w = C.lineWins(g, wild).find((x) => x.line === 3);   // 0-1-2-1-0: медведь, гадалка(дикая), билет — нет
  assert.equal(w, undefined);
  const w2 = C.lineWins(g, wild).find((x) => x.line === 1);  // верх: медведь, popcorn — нет
  assert.equal(w2, undefined);
  for (let seed = 1; seed < 200; seed++) {
    const rand = rng(seed);
    const s = C.rollStep(rand, { modType: 'hoops' });
    for (const r of s.mod.reels) for (let y = 0; y < C.ROWS; y++) assert.ok(['hoop', 'target'].includes(s.grid[r][y]));
    const c = C.rollStep(rand, { modType: 'clowns' });
    assert.ok(c.mod.cells.length >= 2 && c.mod.cells.length <= 4);
    for (const cell of c.mod.cells) assert.equal(c.grid[Math.floor(cell / 3)][cell % 3], 'clown');
    const m = C.rollStep(rand, { modType: 'x3' });
    assert.equal(m.mult, 3);
  }
});

test('метатель: ножи по числу мишеней, ассистентка обрывает, +2 ножа и удвоение работают', () => {
  for (let seed = 1; seed < 300; seed++) {
    const k = C.knives(rng(seed), 3 + (seed % 3));
    assert.equal(k.knives, C.KNIVES[3 + (seed % 3)]);
    assert.equal(k.board.length, C.BOARD.length);
    assert.equal(new Set(k.throws).size, k.throws.length, 'в один сектор дважды не попадают');
    const hits = k.throws.map((i) => k.board[i]);
    const extra = hits.filter((h) => h === 'knives').length * C.EXTRA_KNIVES;
    if (k.assistant) assert.equal(hits.at(-1), 'assistant');
    else assert.equal(k.throws.length, Math.min(k.knives + extra, k.board.length - 2 + hits.filter((h) => h === 'assistant').length));
    const sum = hits.filter((h) => typeof h === 'number').reduce((a, b) => a + b, 0);
    assert.equal(k.pay, sum * 2 ** hits.filter((h) => h === 'x2').length);
  }
});

test('отдача на дистанции около 96%, метатель выпадает, потолок соблюдается', () => {
  const rand = rng(2024);
  const N = 150_000;
  let total = 0;
  let bonuses = 0;
  for (let i = 0; i < N; i++) {
    const o = C.play(rand);
    total += o.mult;
    if (o.knives) bonuses += 1;
    assert.ok(o.mult <= C.MAX_WIN);
    assert.ok(o.steps.length === 1 || (o.steps[0].mod.type === 'again' && o.steps[0].pay === 0));
  }
  const rtp = total / N;
  assert.ok(rtp > 0.85 && rtp < 1.1, `отдача ${(rtp * 100).toFixed(1)}%`);
  assert.ok(bonuses > N / 500 && bonuses < N / 150, `метателей: ${bonuses}`);
});

test('покупка гарантирует метателя', () => {
  const rand = rng(9);
  for (let i = 0; i < 40; i++) assert.ok(C.play(rand, { mode: 'buy-knives' }).knives);
});

test('сервер: ставка в игре до конца показа, выигрыш после done, лента и события', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  const later = [];
  const events = [];
  const feeds = [];
  const k = createCircus({ store, rand: rng(3), schedule: (fn) => later.push(fn), onEvent: (e) => events.push(e), onFeed: (f) => feeds.push(f) });
  store.addReserver(k.reserved);
  assert.ok(k.spin(a, 5).error);
  assert.ok(k.spin(a, 100, 'cheat').error);
  assert.match(k.spin(a, 20, 'buy-knives').error, /стоит 1/);
  const r = k.spin(a, 100).result;
  assert.equal(a.balance, 900);
  assert.equal(store.capital(a), 1000);
  assert.match(k.spin(a, 100).error, /идёт/);
  k.done(a, r.id + 1);
  assert.equal(a.balance, 900);
  k.done(a, r.id);
  assert.equal(a.balance, 900 + Math.floor(100 * r.outcome.mult));
  assert.equal(feeds.at(-1)[0].payout, r.payout);
  later.forEach((fn) => fn());
  assert.equal(a.balance, 900 + r.payout, 'повторно не платит');
  if (r.payout !== 100) assert.equal(events.at(-1).game, 'circus');
});

test('админ подкручивает метателя, обручи и проигрыш; везунчик окупает ставку', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  a.balance = 1_000_000;
  const k = createCircus({ store, rand: rng(11), schedule: () => {} });
  assert.ok(k.rig('jackpot').error);
  k.rig('knives');
  let r = k.spin(a, 10).result;
  assert.ok(r.outcome.knives);
  k.done(a, r.id);
  k.rig('hoops');
  r = k.spin(a, 10).result;
  assert.equal(r.outcome.steps[0].mod.type, 'hoops');
  k.done(a, r.id);
  k.rig('lose');
  r = k.spin(a, 10).result;
  assert.equal(r.payout, 0);
  k.done(a, r.id);
  const lucky = createCircus({ store, rand: rng(12), schedule: () => {}, lucky: () => true });
  let wins = 0;
  for (let i = 0; i < 30; i++) {
    r = lucky.spin(a, 10).result;
    if (r.payout > 10) wins += 1;
    lucky.done(a, r.id);
  }
  assert.ok(wins >= 27, `везунчик в плюсе ${wins} из 30`);
});
