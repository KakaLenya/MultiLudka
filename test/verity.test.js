const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const { createVerity, SPIN_MS } = require('../server/verity');

function setup(coin) {
  const clock = { t: 0 };
  const store = createStore();
  const a = store.register('Аня').player;
  const later = [];
  const feeds = [];
  const events = [];
  const v = createVerity({
    store, now: () => clock.t, coin, schedule: (fn) => later.push(fn), onFeed: (f) => feeds.push(f), onEvent: (e) => events.push(e),
  });
  const flush = () => { while (later.length) later.shift()(); };
  store.addReserver(v.reserved);
  return { store, v, a, clock, flush, feeds, events };
}

test('добрый удваивает, злой забирает', () => {
  const coins = [true, false];
  const { v, a, clock, flush, store } = setup(() => coins.shift());
  assert.deepEqual(v.play(a, 100).result.good, true);
  assert.equal(a.balance, 900, 'ставка списана, Верити ещё решает');
  assert.equal(store.capital(a), 1000, 'рейтинг ничего не выдаёт');
  flush();
  assert.equal(a.balance, 1100);
  clock.t += SPIN_MS;
  assert.equal(v.play(a, 300).result.good, false);
  flush();
  assert.equal(a.balance, 800);
});

test('честная монетка: около 50 на 50 и баланс в среднем не меняется', () => {
  const { v, a, clock, flush } = setup(undefined);   // настоящий crypto
  a.balance = 1_000_000;
  let good = 0;
  const n = 20000;
  for (let i = 0; i < n; i++) {
    clock.t += SPIN_MS;
    if (v.play(a, 10).result.good) good++;
    flush();
  }
  assert.ok(Math.abs(good / n - 0.5) < 0.015, `добрых ${(good / n * 100).toFixed(1)}%`);
  assert.equal(a.balance, 1_000_000 + 10 * good - 10 * (n - good));
});

test('валидация и «Верити ещё думает»', () => {
  const { v, a, clock, flush } = setup(() => true);
  for (const bad of [0, -5, 1.5, '10', NaN, 5000]) assert.ok(v.play(a, bad).error, String(bad));
  assert.equal(a.balance, 1000);
  assert.ok(v.play(a, 1).ok, 'любая сумма от 1');
  assert.match(v.play(a, 1).error, /думает/);
  clock.t += SPIN_MS;
  flush();
  assert.ok(v.play(a, 1).ok);
});

test('лента и общая лента — только после объявления решения', () => {
  const { v, a, flush, feeds, events } = setup(() => false);
  v.play(a, 50);
  assert.equal(v.feed().length, 0);
  assert.equal(events.length, 0);
  flush();
  assert.equal(feeds.length, 1);
  assert.equal(v.feed()[0].good, false);
  assert.deepEqual(events.map((e) => `${e.kind}:${e.amount}`), ['lose:50']);
});

test('админ: следующее решение добрым или злым, потом снова честно', () => {
  const { v, a, clock, flush } = setup(() => false);
  v.rig('good');
  assert.equal(v.play(a, 100).result.good, true);
  assert.equal(v.adminState().rigged, null);
  clock.t += SPIN_MS;
  flush();
  assert.equal(v.play(a, 100).result.good, false, 'монетка в тесте злая');
  assert.ok(v.rig('maybe').error);
});
