const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const { createMines, multiplierFor, TILES } = require('../server/mines');

function setup(opts = {}) {
  const store = createStore();
  const a = store.register('Аня').player;
  const events = [];
  const m = createMines({ store, onEvent: (e) => events.push(e), ...opts });
  store.addReserver(m.reserved);
  return { store, m, a, events };
}

test('множитель: честная вероятность минус 1%', () => {
  assert.equal(multiplierFor(1, 0), 1);
  assert.equal(multiplierFor(1, 1), 1.03);       // 0.99 * 25/24
  assert.equal(multiplierFor(3, 1), 1.12);       // 0.99 * 25/22
  assert.equal(multiplierFor(24, 1), 24.75);     // 0.99 * 25/1
  assert.equal(multiplierFor(5, 5), 3.39);       // 0.99 * 25/20 * 24/19 * 23/18 * 22/17 * 21/16
  // Растёт с каждой клеткой.
  for (let k = 1; k < 20; k++) assert.ok(multiplierFor(5, k + 1) > multiplierFor(5, k));
});

test('игра: ставка в игре, безопасные клетки поднимают множитель, забрать — выплата', () => {
  // Везунчик не подрывается — так открытые клетки гарантированно безопасные.
  const { m, a, store, events } = setup({ lucky: () => true });
  const st = m.start(a, 100, 3).state;
  assert.equal(st.active, true);
  assert.equal(st.minesAt, null, 'клиент не видит мины');
  assert.equal(a.balance, 900);
  assert.equal(store.capital(a), 1000, 'пока играет — ставка в игре');
  assert.match(m.cashout(a).error, /хотя бы одну/);
  assert.match(m.start(a, 100, 3).error, /доиграй/);
  m.pick(a, 0);
  m.pick(a, 1);
  const before = m.view(a);
  assert.equal(before.multiplier, multiplierFor(3, 2));
  const won = m.cashout(a).state;
  assert.equal(won.status, 'won');
  assert.equal(won.payout, Math.floor(100 * multiplierFor(3, 2)));
  assert.equal(a.balance, 900 + won.payout);
  assert.ok(won.minesAt.length === 3, 'после игры мины показаны');
  assert.equal(events.at(-1).kind, 'win');
});

test('мина — ставка сгорела, показано где мины', () => {
  const { m, a, events } = setup();
  m.start(a, 50, 24);
  let s;
  for (let t = 0; t < TILES; t++) {
    s = m.pick(a, t).state;
    if (s.status !== 'playing') break;
  }
  // С 24 минами почти наверняка подорвались; если открыли единственную безопасную — это победа.
  if (s.status === 'lost') {
    assert.equal(a.balance, 950);
    assert.ok(s.minesAt.includes(s.boom));
    assert.equal(events.at(-1).kind, 'lose');
    assert.equal(events.at(-1).amount, 50);
  } else {
    assert.equal(s.status, 'won');
  }
});

test('открыл все безопасные — забирается само', () => {
  const { m, a } = setup();
  m.start(a, 10, 24);
  // Ищем единственную безопасную клетку перебором через новые игры (детерминированно не выйдет), поэтому
  // проверяем через везение: везунчик не подрывается.
  const lucky = setup({ lucky: () => true });
  lucky.m.start(lucky.a, 10, 20);
  let s;
  for (let t = 0; t < TILES; t++) {
    s = lucky.m.pick(lucky.a, t).state;
    if (s.status !== 'playing') break;
  }
  assert.equal(s.status, 'won', 'везунчик открыл все 5 безопасных');
  assert.equal(s.revealed.length, 5);
  assert.equal(s.payout, Math.floor(10 * multiplierFor(20, 5)));
});

test('проверки ввода; админ: следующий клик — мина', () => {
  const { m, a } = setup();
  for (const [amt, mines] of [[0, 3], [1.5, 3], [10, 0], [10, 25], [10, 2.5], [5000, 3]]) assert.ok(m.start(a, amt, mines).error, `${amt}/${mines}`);
  assert.match(m.pick(a, 0).error, /не начата/);
  m.start(a, 10, 1);
  assert.ok(m.pick(a, 99).error);
  m.rig('boom');
  const s = m.pick(a, 7).state;
  assert.equal(s.status, 'lost');
  assert.equal(s.boom, 7);
  assert.ok(m.rig('maybe').error);
});

test('отдача на дистанции около 99% при любой стратегии', () => {
  const { m, a } = setup();
  a.balance = 1e12;
  let staked = 0;
  let paid = 0;
  for (let i = 0; i < 20000; i++) {
    const mines = 1 + (i % 10);
    const want = 1 + (i % 6);   // сколько клеток хотим открыть
    m.start(a, 100, mines);
    staked += 100;
    let s = m.view(a);
    for (let t = 0; t < TILES && s.status === 'playing' && s.revealed.length < want; t++) s = m.pick(a, t).state;
    if (s.status === 'playing') s = m.cashout(a).state;
    paid += s.payout;
  }
  const rtp = paid / staked;
  assert.ok(rtp > 0.95 && rtp < 1.03, `отдача (в среднем 99%, разброс от прогона к прогону ±1.5%) ${(rtp * 100).toFixed(1)}%`);
});

test('остановка сервера: открыл клетки — забирает, не открыл — ставка назад', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  const m = createMines({ store, lucky: () => true });
  m.start(a, 100, 3);
  m.pick(a, 0);
  m.start(b, 100, 3);
  m.settleAll();
  assert.equal(a.balance, 900 + Math.floor(100 * multiplierFor(3, 1)));
  assert.equal(b.balance, 1000);
});
