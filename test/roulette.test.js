const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const {
  createRoulette, payoutFor, colorOf, WHEEL, BETTING_MS, SPIN_MS, RESULT_MS,
} = require('../server/roulette');

function setup(number = 17) {
  const clock = { t: 0 };
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  const game = createRoulette({ store, now: () => clock.t, random: () => number });
  store.addReserver(game.reserved);
  game._reset(0);
  const at = (ms) => { clock.t = ms; game.tick(); return game.state(); };
  return { store, game, a, b, at, clock };
}

test('колесо: 37 номеров, цвета', () => {
  assert.equal(new Set(WHEEL).size, 37);
  assert.equal(colorOf(0), 'green');
  assert.equal(colorOf(1), 'red');
  assert.equal(colorOf(2), 'black');
  assert.equal(colorOf(36), 'red');
  // соседние на колесе (кроме зеро) чередуют цвет
  for (let i = 1; i + 1 < WHEEL.length; i++) assert.notEqual(colorOf(WHEEL[i]), colorOf(WHEEL[i + 1]));
});

test('выплаты по всем типам ставок', () => {
  const p = (type, n, number = null) => payoutFor({ type, number, amount: 10 }, n);
  assert.equal(p('straight', 17, 17), 360);
  assert.equal(p('straight', 18, 17), 0);
  assert.equal(p('red', 1), 20);
  assert.equal(p('red', 0), 0);
  assert.equal(p('black', 2), 20);
  assert.equal(p('black', 0), 0);
  assert.equal(p('even', 0), 0, 'зеро не чёт');
  assert.equal(p('even', 2), 20);
  assert.equal(p('odd', 3), 20);
  assert.equal(p('low', 18), 20);
  assert.equal(p('high', 19), 20);
  assert.equal(p('low', 0), 0);
  assert.equal(p('dozen1', 12), 30);
  assert.equal(p('dozen2', 13), 30);
  assert.equal(p('dozen3', 36), 30);
  assert.equal(p('column1', 34), 30);
  assert.equal(p('column2', 35), 30);
  assert.equal(p('column3', 36), 30);
  assert.equal(p('column3', 0), 0);
});

test('раунд: ставки, вращение, выплата, фишки сходятся', () => {
  const { store, game, a, b, at } = setup(17); // 17: чёрное, нечёт, 1-18, вторая дюжина, вторая колонка
  assert.deepEqual(game.bet(a, 'straight', 17, 10), { ok: true });
  assert.deepEqual(game.bet(a, 'red', null, 50), { ok: true });
  assert.deepEqual(game.bet(a, 'straight', 17, 10), { ok: true }, 'та же ставка складывается');
  assert.deepEqual(game.bet(b, 'black', null, 100), { ok: true });
  assert.equal(a.balance, 930);
  assert.equal(store.capital(a), 1000);
  assert.equal(game.state().players.find((p) => p.name === 'Аня').bets.length, 2);
  assert.equal(game.state().result, null, 'номер скрыт во время ставок');

  let s = at(BETTING_MS);
  assert.equal(s.phase, 'spinning');
  assert.equal(s.result, 17);
  assert.ok(game.bet(a, 'red', null, 10).error, 'во время вращения нельзя');
  assert.equal(a.balance, 930, 'выплата только когда шарик остановился');

  s = at(BETTING_MS + SPIN_MS);
  assert.equal(s.phase, 'result');
  assert.equal(a.balance, 930 + 20 * 36);
  assert.equal(b.balance, 900 + 200);
  assert.equal(s.players.find((p) => p.name === 'Аня').won, 720);
  assert.deepEqual(s.history, [{ n: 17, color: 'black' }]);
  assert.equal(store.capital(a), a.balance);

  s = at(BETTING_MS + SPIN_MS + RESULT_MS);
  assert.equal(s.phase, 'betting');
  assert.equal(s.roundId, 2);
  assert.deepEqual(s.players, []);
});

test('валидация ставок', () => {
  const { game, a } = setup();
  for (const [type, number, amount] of [
    ['straight', 37, 10], ['straight', -1, 10], ['straight', 1.5, 10], ['straight', '5', 10],
    ['red', null, 5], ['red', null, 10.5], ['red', null, 2000], ['purple', null, 10], ['__proto__', null, 10], [null, null, 10],
  ]) {
    assert.ok(game.bet(a, type, number, amount).error, `${type} ${number} ${amount}`);
  }
  assert.equal(a.balance, 1000);
});

test('снять ставки во время приёма', () => {
  const { game, a, at } = setup();
  game.bet(a, 'red', null, 100);
  game.bet(a, 'straight', 5, 20);
  assert.deepEqual(game.clear(a), { ok: true });
  assert.equal(a.balance, 1000);
  assert.ok(game.clear(a).error);
  game.bet(a, 'red', null, 100);
  at(BETTING_MS);
  assert.ok(game.clear(a).error, 'после закрытия нельзя');
  assert.equal(a.balance, 900);
});

test('гонка: ставка ровно в момент закрытия без тика', () => {
  const { game, a, clock } = setup();
  clock.t = BETTING_MS;
  assert.match(game.bet(a, 'red', null, 10).error, /закрыты/);
  assert.equal(a.balance, 1000);
});

test('подкрутка и возврат при остановке', () => {
  const { game, a, at } = setup(5);
  assert.deepEqual(game.rig(0), { ok: true, round: 'current' });
  assert.ok(game.rig(37).error);
  game.bet(a, 'red', null, 100);
  const s = at(BETTING_MS);
  assert.equal(s.result, 0);
  assert.equal(game.adminState().rigged, null, 'подкрутка одноразовая');
  game.refundActive();
  assert.equal(a.balance, 1000);
});
