const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const {
  createUpgrader, multiplierFor, payoutFor, inZone, SPIN_MS,
} = require('../server/upgrader');

// Детерминированный генератор для повторяемых проверок.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

function setup({ random = seeded(1) } = {}) {
  const clock = { t: 0 };
  const store = createStore();
  const a = store.register('Аня').player;
  const later = [];
  const feeds = [];
  const up = createUpgrader({
    store,
    now: () => clock.t,
    random,
    schedule: (fn) => later.push(fn),
    onFeed: (f) => feeds.push(f),
  });
  const flush = () => { while (later.length) later.shift()(); };
  store.addReserver(up.reserved);
  return { store, up, a, clock, flush, feeds };
}

test('множитель: 99 / шанс, вниз до сотых', () => {
  assert.equal(multiplierFor(30), 3.3);
  assert.equal(multiplierFor(50), 1.98);
  assert.equal(multiplierFor(10), 9.9);
  assert.equal(multiplierFor(1), 99);
  assert.equal(multiplierFor(95), 1.04);
  assert.equal(multiplierFor(33), 3);
  assert.equal(payoutFor(100, 30), 330);
  assert.equal(payoutFor(55, 50), 108);
});

test('сектор с переходом через 100', () => {
  assert.ok(inZone(10, 0, 30));
  assert.ok(!inZone(30, 0, 30), 'граница не входит');
  assert.ok(inZone(95, 90, 30));
  assert.ok(inZone(15, 90, 30), 'сектор 90..20 через ноль');
  assert.ok(!inZone(25, 90, 30));
});

test('частота выигрыша равна выбранному шансу, возврат около 99%', () => {
  const { up, a, clock, flush } = setup({ random: seeded(42) });
  a.balance = 10_000_000;
  for (const chance of [10, 30, 50, 80]) {
    let wins = 0;
    const n = 20000;
    const before = a.balance;
    for (let i = 0; i < n; i++) {
      clock.t += SPIN_MS;
      if (up.spin(a, 100, chance).spin.win) wins++;
      flush();
    }
    const rate = wins / n;
    assert.ok(Math.abs(rate - chance / 100) < 0.012, `шанс ${chance}%: выпало ${(rate * 100).toFixed(1)}%`);
    const rtp = (a.balance - before + 100 * n) / (100 * n);
    assert.ok(rtp > 0.95 && rtp < 1.03, `шанс ${chance}%: возврат ${(rtp * 100).toFixed(1)}%`);
  }
});

test('баланс: выигрыш и проигрыш, результат совпадает с точкой на колесе', () => {
  const { up, a, clock, flush } = setup({ random: seeded(7) });
  a.balance = 100_000;  // хватит на серию проигрышей подряд
  let balance = a.balance;
  for (let i = 0; i < 50; i++) {
    clock.t += SPIN_MS;
    const { spin } = up.spin(a, 100, 30);
    assert.equal(a.balance, balance - 100, 'пока колесо крутится, ставка списана, выигрыша ещё нет');
    flush();
    assert.equal(spin.win, inZone(spin.landing, spin.start, 30));
    balance += spin.win ? 330 - 100 : -100;
    assert.equal(a.balance, balance);
    assert.equal(spin.payout, spin.win ? 330 : 0);
  }
});

test('валидация и одно колесо за раз', () => {
  const { up, a, clock, flush, store } = setup();
  for (const [amt, ch] of [[5, 30], [10.5, 30], ['100', 30], [100, 0], [100, 96], [100, 30.5], [100, '30'], [5000, 30]]) {
    assert.ok(up.spin(a, amt, ch).error, `${amt} / ${ch}`);
  }
  assert.equal(a.balance, 1000);
  assert.ok(up.spin(a, 100, 50).ok);
  assert.match(up.spin(a, 100, 50).error, /крутится/);
  assert.equal(store.capital(a), 1000, 'капитал (и рейтинг) не меняется, пока колесо крутится');
  clock.t += SPIN_MS;
  assert.match(up.spin(a, 100, 50).error, /крутится/, 'итог ещё не объявлен');
  flush();
  assert.ok(up.spin(a, 100, 50).ok);
});

test('лента: другие видят результат только после остановки колеса', () => {
  const { up, a, flush, feeds } = setup();
  const { spin } = up.spin(a, 100, 30);
  assert.deepEqual(up.feed(), [], 'пока колесо крутится, в ленте пусто');
  flush();
  assert.equal(feeds.length, 1);
  assert.equal(up.feed()[0].name, 'Аня');
  assert.equal(up.feed()[0].win, spin.win);
});

test('админ: следующий апгрейд выигрышный или проигрышный, потом снова честно', () => {
  const { up, a, clock, flush } = setup({ random: seeded(3) });
  assert.ok(up.rig('win').ok);
  clock.t += SPIN_MS;
  let r = up.spin(a, 100, 1).spin;
  flush();
  assert.equal(r.win, true, 'даже 1% выигрывает');
  assert.equal(a.balance, 1000 - 100 + 9900);
  assert.equal(up.adminState().rigged, null, 'подкрутка одноразовая');
  up.rig('lose');
  clock.t += SPIN_MS;
  r = up.spin(a, 100, 95).spin;
  flush();
  assert.equal(r.win, false, 'даже 95% проигрывает');
  assert.ok(up.rig('maybe').error);
});
