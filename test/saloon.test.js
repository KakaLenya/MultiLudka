const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const S = require('../server/saloon-math');
const { createSaloon } = require('../server/saloon');

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

test('пути: соседние барабаны слева, любые ряды, вайлд заменяет, множители перемножаются', () => {
  const g = grid([
    'sheriff hat boot',
    'sheriff sheriff whiskey',
    'colt horseshoe boot',
    'hat whiskey boot',
    'horseshoe horseshoe horseshoe',
  ]);
  const wins = S.waysWins(g);
  const sh = wins.find((w) => w.symbol === 'sheriff');
  assert.deepEqual({ len: sh.len, ways: sh.ways }, { len: 3, ways: 2 });   // 1 × 2 × 1 (Кольт)
  assert.equal(sh.pay, (S.SYMBOLS.sheriff.pays[0] * 2) / S.UNIT);
  const boot = wins.find((w) => w.symbol === 'boot');
  assert.equal(boot, undefined, 'на втором барабане сапога нет — путь оборван');
  // Вайлд ×3 на третьем барабане: путей шерифа 1 × 2 × 3.
  const m = S.waysWins(g, { 6: 3 });
  assert.equal(m.find((w) => w.symbol === 'sheriff').ways, 6);
});

test('Кольт раскрывается на весь барабан, плакаты не трогает', () => {
  const g = grid(['hat hat hat', 'boot colt wanted', 'boot boot boot', 'hat hat hat', 'boot boot boot']);
  assert.deepEqual(S.expandColts(g), [1]);
  assert.deepEqual(g[1], ['colt', 'colt', 'wanted']);
});

test('дуэль: жизни кончаются только от пуль шерифа, вайлды липнут и растут до ×3', () => {
  for (let seed = 1; seed < 60; seed++) {
    const d = S.duel(rng(seed), { lives: 3 });
    let lives = 3;
    let prev = {};
    for (const r of d.rounds) {
      if (r.sheriff) lives -= 1;
      assert.equal(r.lives, lives);
      for (const [c, m] of Object.entries(prev)) assert.ok(r.sticky[c] >= m, 'вайлды не пропадают и не дешевеют');
      for (const m of Object.values(r.sticky)) assert.ok(m >= 1 && m <= S.DUEL.maxMult);
      for (const c of Object.keys(r.sticky)) assert.equal(r.grid[Math.floor(c / S.ROWS)][c % S.ROWS], 'colt');
      prev = r.sticky;
    }
    assert.equal(lives, 0);
    assert.ok(d.rounds.at(-1).sheriff, 'последняя пуля — шерифа');
  }
});

test('отдача на дистанции около 96%, дуэль выпадает, потолок соблюдается', () => {
  const rand = rng(2024);
  const N = 200_000;
  let total = 0;
  let duels = 0;
  for (let i = 0; i < N; i++) {
    const o = S.play(rand);
    total += o.mult;
    if (o.duel) duels += 1;
    assert.ok(o.mult <= S.MAX_WIN);
  }
  const rtp = total / N;
  assert.ok(rtp > 0.8 && rtp < 1.15, `отдача ${(rtp * 100).toFixed(1)}%`);
  assert.ok(duels > N / 500 && duels < N / 200, `дуэлей: ${duels}`);
});

test('покупка гарантирует дуэль; на рассвете — 4 жизни и два вайлда', () => {
  const rand = rng(9);
  for (let i = 0; i < 40; i++) {
    assert.ok(S.play(rand, { mode: 'buy-duel' }).duel);
    const sup = S.play(rand, { mode: 'buy-super' }).duel;
    assert.equal(sup.lives, 4);
    assert.equal(Object.keys(sup.start).length, 2);
  }
});

test('сервер: ставка в игре до конца показа, выигрыш после done, лента и события', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  const later = [];
  const events = [];
  const feeds = [];
  const k = createSaloon({ store, rand: rng(3), schedule: (fn) => later.push(fn), onEvent: (e) => events.push(e), onFeed: (f) => feeds.push(f) });
  store.addReserver(k.reserved);
  assert.ok(k.spin(a, 5).error);
  assert.ok(k.spin(a, 100, 'cheat').error);
  assert.match(k.spin(a, 20, 'buy-duel').error, /стоит 2/);
  const r = k.spin(a, 100).result;
  assert.equal(a.balance, 900);
  assert.equal(store.capital(a), 1000);
  assert.match(k.spin(a, 100).error, /крутятся/);
  k.done(a, r.id + 1);
  assert.equal(a.balance, 900);
  k.done(a, r.id);
  assert.equal(a.balance, 900 + Math.floor(100 * r.outcome.mult));
  assert.equal(feeds.at(-1)[0].payout, r.payout);
  later.forEach((fn) => fn());
  assert.equal(a.balance, 900 + r.payout, 'повторно не платит');
  if (r.payout !== 100) assert.equal(events.at(-1).game, 'saloon');
});

test('админ подкручивает дуэль и пули; везунчик окупает ставку', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  a.balance = 1_000_000;
  const k = createSaloon({ store, rand: rng(11), schedule: () => {} });
  assert.ok(k.rig('jackpot').error);
  k.rig('duel');
  let r = k.spin(a, 10).result;
  assert.ok(r.outcome.duel);
  k.done(a, r.id);
  k.rig('bullets');
  r = k.spin(a, 10).result;
  assert.ok(r.outcome.base.bullets.length >= 1);
  k.done(a, r.id);
  k.rig('lose');
  r = k.spin(a, 10).result;
  assert.equal(r.payout, 0);
  k.done(a, r.id);
  const lucky = createSaloon({ store, rand: rng(12), schedule: () => {}, lucky: () => true });
  let wins = 0;
  for (let i = 0; i < 30; i++) {
    r = lucky.spin(a, 10).result;
    if (r.payout > 10) wins += 1;
    lucky.done(a, r.id);
  }
  assert.ok(wins >= 27, `везунчик в плюсе ${wins} из 30`);
});
