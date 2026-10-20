const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const Y = require('../server/yokai-math');
const { createYokai } = require('../server/yokai');

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

test('пути: соседние барабаны слева, любые ряды; лиса заменяет, хвосты умножают', () => {
  const g = grid([
    'oni sake geta fan',
    'oni oni sake geta',
    'fox geta geta fan',
    'sake fan fan fan',
    'geta geta geta geta',
  ]);
  const wins = Y.waysWins(g);
  const oni = wins.find((w) => w.symbol === 'oni');
  assert.deepEqual({ len: 3, ways: 2 }, { len: oni.len, ways: oni.ways });   // 1 × 2 × 1 (лиса)
  assert.equal(oni.pay, (Y.SYMBOLS.oni.pays[0] * 2) / Y.UNIT);
  // Лиса с 5 хвостами на третьем барабане: путей 1 × 2 × 5.
  assert.equal(Y.waysWins(g, { 8: 5 }).find((w) => w.symbol === 'oni').ways, 10);
  // Путь из одних лис не платит.
  const only = grid(['fox sake sake sake', 'fox geta geta geta', 'fox fan fan fan', 'sake sake sake sake', 'sake sake sake sake']);
  assert.equal(Y.waysWins(only).filter((w) => w.symbol === 'oni').length, 0);
});

test('парад: лисы шагают влево по барабану, уходят с первого, пока на поле есть лиса — вращаем', () => {
  for (let seed = 1; seed < 400; seed++) {
    const b = Y.baseRound(rng(seed));
    for (let i = 1; i < b.steps.length; i++) {
      const prev = b.steps[i - 1].foxes;
      assert.ok(prev.length > 0, 'бесплатный шаг только когда на поле были лисы');
      for (const f of prev) {
        const next = b.steps[i].foxes.find((x) => x.id === f.id);
        if (f.reel === 0) assert.equal(next, undefined, 'с первого барабана лиса уходит');
        else assert.deepEqual([next.reel, next.row, next.tails], [f.reel - 1, f.row, f.tails]);
      }
    }
    for (const s of b.steps) {
      for (const f of s.foxes) assert.equal(s.grid[f.reel][f.row], 'fox');
      for (const id of s.arrived) assert.ok(s.foxes.find((f) => f.id === id).reel >= 1, 'новые лисы — не на первом барабане');
    }
    const last = b.steps.at(-1).foxes;
    assert.ok(last.every((f) => f.reel === 0), 'серия кончается, когда все лисы ушли');
  }
});

test('ночь: вращений 8/12/20, лисы растут на шаг, парад доигрывается до конца', () => {
  for (let seed = 1; seed < 80; seed++) {
    const n = Y.night(rng(seed), 3);
    assert.equal(n.spins, 8);
    for (let i = 1; i < n.steps.length; i++) {
      for (const f of n.steps[i - 1].foxes) {
        const next = n.steps[i].foxes.find((x) => x.id === f.id);
        if (f.reel === 0) assert.equal(next, undefined);
        else assert.equal(next.tails, Math.min(Y.MAX_TAILS, f.tails + 1));
      }
    }
    const extra = n.steps.filter((s) => s.extra);
    assert.equal(n.steps.length - extra.length, 8 + n.retriggers * Y.RETRIGGER);
    assert.ok(n.steps.at(-1).foxes.every((f) => f.reel === 0));
  }
  assert.equal(Y.night(rng(5), 5).spins, 20);
});

test('отдача на дистанции около 96%, ночь выпадает, потолок соблюдается', () => {
  const rand = rng(2024);
  const N = 150_000;
  let total = 0;
  let nights = 0;
  for (let i = 0; i < N; i++) {
    const o = Y.play(rand);
    total += o.mult;
    if (o.night) nights += 1;
    assert.ok(o.mult <= Y.MAX_WIN);
  }
  const rtp = total / N;
  assert.ok(rtp > 0.8 && rtp < 1.15, `отдача ${(rtp * 100).toFixed(1)}%`);
  assert.ok(nights > N / 600 && nights < N / 150, `ночей: ${nights}`);
});

test('покупка гарантирует ночь', () => {
  const rand = rng(9);
  for (let i = 0; i < 40; i++) assert.ok(Y.play(rand, { mode: 'buy-bonus' }).night);
});

test('сервер: ставка в игре до конца показа, выигрыш после done, лента и события', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  const later = [];
  const events = [];
  const feeds = [];
  const k = createYokai({ store, rand: rng(3), schedule: (fn) => later.push(fn), onEvent: (e) => events.push(e), onFeed: (f) => feeds.push(f) });
  store.addReserver(k.reserved);
  assert.ok(k.spin(a, 5).error);
  assert.ok(k.spin(a, 100, 'cheat').error);
  assert.match(k.spin(a, 20, 'buy-bonus').error, /стоит 2/);
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
  if (r.payout !== 100) assert.equal(events.at(-1).game, 'yokai');
});

test('админ подкручивает ночь, лису и проигрыш; везунчик окупает ставку', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  a.balance = 1_000_000;
  const k = createYokai({ store, rand: rng(11), schedule: () => {} });
  assert.ok(k.rig('jackpot').error);
  k.rig('bonus');
  let r = k.spin(a, 10).result;
  assert.ok(r.outcome.night);
  k.done(a, r.id);
  k.rig('fox');
  r = k.spin(a, 10).result;
  assert.ok(r.outcome.base.steps[0].foxes.some((f) => f.reel === 4 && f.tails === 9));
  assert.ok(r.outcome.base.steps.length >= 5, 'лиса с последнего барабана идёт четыре шага');
  k.done(a, r.id);
  k.rig('lose');
  r = k.spin(a, 10).result;
  assert.equal(r.payout, 0);
  k.done(a, r.id);
  const lucky = createYokai({ store, rand: rng(12), schedule: () => {}, lucky: () => true });
  let wins = 0;
  for (let i = 0; i < 30; i++) {
    r = lucky.spin(a, 10).result;
    if (r.payout > 10) wins += 1;
    lucky.done(a, r.id);
  }
  assert.ok(wins >= 27, `везунчик в плюсе ${wins} из 30`);
});
