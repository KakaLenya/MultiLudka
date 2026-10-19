const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const { createPlinko, MULTIPLIERS, durationMs } = require('../server/plinko');

function setup(opts = {}) {
  const store = createStore();
  const a = store.register('Аня').player;
  const later = [];
  const feeds = [];
  const events = [];
  const p = createPlinko({ store, schedule: (fn) => later.push(fn), onFeed: (f) => feeds.push(f), onEvent: (e) => events.push(e), ...opts });
  store.addReserver(p.reserved);
  const flush = () => { while (later.length) later.shift()(); };
  return { store, p, a, flush, feeds, events };
}
const C = (n, k) => {
  let r = 1;
  for (let i = 1; i <= k; i++) r = (r * (n - k + i)) / i;
  return r;
};

test('таблицы: симметричные, лунок на одну больше рядов, отдача около 99%', () => {
  for (const [rows, risks] of Object.entries(MULTIPLIERS)) {
    for (const [risk, m] of Object.entries(risks)) {
      assert.equal(m.length, Number(rows) + 1);
      assert.deepEqual(m, [...m].reverse(), `${rows}/${risk}: симметрия`);
      const rtp = m.reduce((s, x, k) => s + (C(Number(rows), k) / 2 ** Number(rows)) * x, 0);
      assert.ok(rtp > 0.985 && rtp < 0.995, `${rows}/${risk}: отдача ${(rtp * 100).toFixed(2)}%`);
    }
  }
});

test('бросок: путь из поворотов, лунка — число поворотов вправо, выплата после падения', () => {
  const { p, a, flush, store, events } = setup();
  const { ball } = p.drop(a, 100, 16, 'medium');
  assert.equal(ball.path.length, 16);
  assert.equal(ball.slot, ball.path.filter(Boolean).length);
  assert.equal(ball.multiplier, MULTIPLIERS[16].medium[ball.slot]);
  assert.equal(ball.durationMs, durationMs(16));
  assert.equal(a.balance, 900, 'ставка списана');
  assert.equal(store.capital(a), 1000, 'пока летит — в игре, рейтинг не выдаёт итог');
  assert.equal(events.length, 0);
  flush();
  assert.equal(a.balance, 900 + ball.payout);
  assert.equal(p.feed()[0].multiplier, ball.multiplier);
});

test('много шариков сразу, но не больше 40 в полёте; проверки', () => {
  const { p, a, flush } = setup();
  for (let i = 0; i < 40; i++) assert.ok(p.drop(a, 10, 8, 'low').ok);
  assert.match(p.drop(a, 10, 8, 'low').error, /Подожди/);
  flush();
  assert.ok(p.drop(a, 10, 8, 'low').ok);
  for (const [amt, rows, risk] of [[0, 8, 'low'], [1.5, 8, 'low'], [10, 9, 'low'], [10, 8, 'crazy'], [1e9, 8, 'low']]) {
    assert.ok(p.drop(a, amt, rows, risk).error, `${amt}/${rows}/${risk}`);
  }
});

test('честность: распределение лунок биномиальное, отдача на дистанции около 99%', () => {
  const { p, a, flush } = setup();
  a.balance = 1e12;
  const n = 40000;
  const counts = new Array(17).fill(0);
  let paid = 0;
  for (let i = 0; i < n; i++) {
    const { ball } = p.drop(a, 100, 16, 'low');
    counts[ball.slot] += 1;
    paid += ball.payout;
    flush();
  }
  const center = (counts[8] / n) / (C(16, 8) / 2 ** 16);
  assert.ok(center > 0.93 && center < 1.07, `центральная лунка: ${center.toFixed(2)} от теории`);
  const rtp = paid / (100 * n);
  assert.ok(rtp > 0.97 && rtp < 1.01, `отдача ${(rtp * 100).toFixed(1)}%`);
});

test('админ: следующий шарик в край; везение — лунка с выигрышем', () => {
  const { p, a, flush } = setup();
  p.rig('edge');
  const { ball } = p.drop(a, 10, 12, 'high');
  assert.ok(ball.slot === 0 || ball.slot === 12);
  assert.equal(ball.multiplier, 170);
  flush();
  const lucky = setup({ lucky: () => true });
  for (let i = 0; i < 50; i++) {
    const b = lucky.p.drop(lucky.a, 1, 16, 'high').ball;
    assert.ok(b.multiplier > 1, `везунчику ×${b.multiplier}`);
    lucky.flush();
  }
});
