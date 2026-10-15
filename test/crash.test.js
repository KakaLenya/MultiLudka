const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const {
  createCrashGame, crashPointCents, multiplierCents, payoutFor, BETTING_MS, PAUSE_MS,
} = require('../server/crash');

// r = 0.5 -> краш на x1.98 (через ~9.76 с после старта).
function setup({ r = 0.5 } = {}) {
  const clock = { t: 0 };
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  const states = [];
  const game = createCrashGame({ store, now: () => clock.t, random: () => r, onState: (s) => states.push(s) });
  store.addReserver(game.reserved);
  game._reset(0);
  const at = (ms) => { clock.t = ms; game.tick(); return states.at(-1); };
  return { clock, store, game, a, b, at };
}

const RUN = BETTING_MS; // момент старта фазы running

test('точка краха: формула и пределы', () => {
  assert.equal(crashPointCents(0), 100);
  assert.equal(crashPointCents(0.01), 100);
  assert.equal(crashPointCents(0.5), 198);
  assert.equal(crashPointCents(0.75), 396);
  assert.equal(crashPointCents(0.9999), 10000, 'потолок x100');
});

test('точка краха: распределение (P(>= x2) около 49.5%, мгновенный около 2%)', () => {
  const N = 100000;
  let atLeast2 = 0;
  let instant = 0;
  for (let i = 0; i < N; i++) {
    const c = crashPointCents(i / N);
    if (c >= 200) atLeast2++;
    if (c === 100) instant++;
  }
  assert.ok(Math.abs(atLeast2 / N - 0.495) < 0.001);
  assert.ok(Math.abs(instant / N - (1 - 99 / 101)) < 0.001);
});

test('множитель и выплата', () => {
  assert.equal(multiplierCents(0), 100);
  assert.equal(multiplierCents(10000), 201);
  assert.equal(payoutFor(55, 198), 108);
  assert.equal(payoutFor(100, 150), 150);
});

test('ставка: списание сразу, капитал не меняется, валидация', () => {
  const { store, game, a } = setup();
  assert.deepEqual(game.bet(a, 100), { ok: true });
  assert.equal(a.balance, 900);
  assert.equal(game.reserved(a), 100);
  assert.equal(store.capital(a), 1000);

  assert.ok(game.bet(a, 100).error, 'вторая ставка за раунд');
  assert.equal(a.balance, 900, 'повтор не списал');

  const { game: g2, b } = setup();
  for (const bad of [5, 0, -50, 10.5, NaN, '100', null, 5000]) {
    assert.ok(g2.bet(b, bad).error, `сумма ${bad}`);
  }
  for (const badAuto of [1, 0.5, 101, '2', NaN, Infinity]) {
    assert.ok(g2.bet(b, 50, badAuto).error, `автовывод ${badAuto}`);
  }
  assert.equal(b.balance, 1000);
});

test('забрать: выплата по текущему множителю', () => {
  const { game, a, at } = setup();
  game.bet(a, 100);
  assert.ok(game.cashout(a).error, 'до старта нельзя');
  at(RUN);
  const s = at(RUN + 9000);
  assert.equal(s.phase, 'running');
  assert.equal(s.multiplier, 1.87);
  assert.deepEqual(game.cashout(a), { ok: true, payout: 187 });
  assert.equal(a.balance, 1087);
  assert.equal(game.reserved(a), 0);
  assert.ok(game.cashout(a).error, 'второй раз нельзя');
  assert.equal(a.balance, 1087);
});

test('краш: не забравшие теряют ставку', () => {
  const { store, game, a, at } = setup();
  game.bet(a, 100);
  at(RUN);
  const s = at(RUN + 9800);
  assert.equal(s.phase, 'crashed');
  assert.equal(s.multiplier, 1.98);
  assert.deepEqual(s.history, [1.98]);
  assert.equal(a.balance, 900);
  assert.equal(store.capital(a), 900);
  assert.ok(game.cashout(a).error);
});

test('гонка: "забрать" в момент краха без тика между ними', () => {
  const { clock, game, a, at } = setup();
  game.bet(a, 100);
  at(RUN + 5000);
  clock.t = RUN + 9800; // множитель уже >= точки краха, но тика ещё не было
  assert.match(game.cashout(a).error, /Поздно/);
  assert.equal(a.balance, 900);
});

test('автовывод: ровно по своему множителю, даже если тик перескочил', () => {
  const { game, a, b, at } = setup();
  game.bet(a, 100, 1.5);
  game.bet(b, 100, 1.98); // равно точке краха: проигрывает
  at(RUN);
  at(RUN + 5000);         // x1.41
  const s = at(RUN + 9800); // сразу краш на x1.98
  assert.equal(s.phase, 'crashed');
  assert.equal(a.balance, 1050);
  assert.equal(b.balance, 900);
  assert.equal(s.players.find((p) => p.name === 'Аня').cashout, 1.5);
});

test('ставки закрыты во время полёта, новый раунд после паузы', () => {
  const { game, a, at } = setup();
  at(RUN);
  assert.match(game.bet(a, 50).error, /закрыты/);
  const crashed = at(RUN + 9800);
  assert.equal(crashed.phase, 'crashed');
  const next = at(RUN + 9800 + PAUSE_MS);
  assert.equal(next.phase, 'betting');
  assert.equal(next.roundId, 2);
  assert.deepEqual(next.players, []);
  assert.deepEqual(game.bet(a, 50), { ok: true });
});

test('мгновенный краш на x1.00', () => {
  const { game, a, at } = setup({ r: 0 });
  game.bet(a, 100, 1.01);
  const s = at(RUN);
  assert.equal(s.phase, 'crashed');
  assert.equal(s.multiplier, 1);
  assert.equal(a.balance, 900);
});

test('точка краха не утекает до краха', () => {
  const { game, a, at } = setup({ r: 0.7 }); // x3.30
  game.bet(a, 100);
  for (const ms of [0, RUN, RUN + 5000, RUN + 15000]) {
    const json = JSON.stringify(at(ms));
    assert.ok(!json.includes('3.3'), `t=${ms}: ${json}`);
  }
});

test('остановка сервера возвращает ставки раунда', () => {
  const { game, a, b, at } = setup();
  game.bet(a, 100);
  game.bet(b, 200, 1.2);
  at(RUN);
  at(RUN + 3000); // Боря забрал на x1.20
  game.refundActive();
  assert.equal(a.balance, 1000);
  assert.equal(b.balance, 800 + 240);
});
