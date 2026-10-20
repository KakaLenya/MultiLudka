const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const {
  createWheel, WHEEL, SEGMENTS, BET_MULTS, BETTING_MS, SPIN_MS, RESULT_MS,
} = require('../server/wheel');

const segOf = (mult) => WHEEL.indexOf(mult);

function setup(segment = segOf(10), opts = {}) {
  const clock = { t: 0 };
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  const events = [];
  const game = createWheel({ store, now: () => clock.t, random: () => segment, onEvent: (e) => events.push(e), ...opts });
  store.addReserver(game.reserved);
  game._reset(0);
  const at = (ms) => { clock.t = ms; game.tick(); return game.state(); };
  return { store, game, a, b, at, events };
}

test('колесо: 61 сектор, каждая ставка отдаёт 60/61', () => {
  assert.equal(SEGMENTS, 61);
  for (const m of BET_MULTS) {
    const count = WHEEL.filter((x) => x === m).length;
    assert.equal(count * m, 60, `×${m}`);
  }
  assert.equal(WHEEL.filter((x) => x === 0).length, 4, 'четыре черепа');
  // Редкие сектора не стоят рядом друг с другом.
  for (let i = 0; i < SEGMENTS; i++) {
    const [x, y] = [WHEEL[i], WHEEL[(i + 1) % SEGMENTS]];
    if (x !== 2) assert.notEqual(x, y, `сектора ${i} и ${i + 1}`);
  }
});

test('раунд: ставки на несколько цветов, вращение, выплата только по выпавшему', () => {
  const { store, game, a, b, at, events } = setup(segOf(10));
  assert.deepEqual(game.bet(a, 10, 50), { ok: true });
  assert.deepEqual(game.bet(a, 2, 100), { ok: true });
  assert.deepEqual(game.bet(a, 10, 50), { ok: true }, 'ставка на тот же цвет складывается');
  assert.deepEqual(game.bet(b, 3, 200), { ok: true });
  assert.equal(a.balance, 800);
  assert.equal(store.capital(a), 1000, 'пока крутится — ставки в игре');
  assert.deepEqual(game.state().pots, { 2: 100, 3: 200, 10: 100, 60: 0 });

  let s = at(BETTING_MS);
  assert.equal(s.phase, 'spinning');
  assert.equal(s.mult, 10);
  assert.equal(a.balance, 800, 'до остановки колеса выигрыш не виден');
  assert.equal(s.players.find((p) => p.id === a.id).won, null);
  assert.match(game.bet(a, 2, 10).error, /закрыты/);
  assert.equal(events.filter((e) => e.kind === 'bet').length, 2);

  s = at(BETTING_MS + SPIN_MS);
  assert.equal(s.phase, 'result');
  assert.equal(a.balance, 800 + 1000);
  assert.equal(b.balance, 800);
  assert.equal(s.players.find((p) => p.id === a.id).won, 1000);
  assert.deepEqual(s.history, [10]);
  const win = events.find((e) => e.kind === 'win');
  assert.equal(win.player, a);
  assert.equal(win.amount, 800);
  assert.equal(events.find((e) => e.kind === 'lose').amount, 200);

  s = at(BETTING_MS + SPIN_MS + RESULT_MS);
  assert.equal(s.phase, 'betting');
  assert.equal(s.players.length, 0);
});

test('череп: проигрывают все; достижения получают метки', () => {
  const { a, game, at, events } = setup(segOf(0));
  for (const m of BET_MULTS) game.bet(a, m, 10);
  at(BETTING_MS + SPIN_MS);
  assert.equal(a.balance, 960);
  const lose = events.find((e) => e.kind === 'lose');
  assert.equal(lose.meta.skull, true);
  assert.equal(lose.amount, 40);
});

test('проверки ставок, снять ставки, возврат при остановке', () => {
  const { a, game, at } = setup();
  assert.ok(game.bet(a, 5, 10).error);
  assert.ok(game.bet(a, 0, 10).error, 'на череп ставить нельзя');
  assert.ok(game.bet(a, 2, 0).error);
  assert.ok(game.bet(a, 2, 1.5).error);
  assert.ok(game.bet(a, 2, 5000).error);
  game.bet(a, 3, 300);
  assert.deepEqual(game.clear(a), { ok: true });
  assert.equal(a.balance, 1000);
  assert.ok(game.clear(a).error);
  game.bet(a, 60, 100);
  at(BETTING_MS);
  game.refundActive();
  assert.equal(a.balance, 1000);
});

test('админ подкручивает множитель; везунчик выигрывает', () => {
  const { a, game, at } = setup(segOf(2));
  assert.ok(game.rig(5).error);
  assert.deepEqual(game.rig(60), { ok: true, round: 'current' });
  game.bet(a, 60, 10);
  assert.equal(at(BETTING_MS).mult, 60);
  at(BETTING_MS + SPIN_MS);
  assert.equal(a.balance, 990 + 600);

  for (let i = 0; i < 30; i++) {
    const lucky = setup(segOf(0), { lucky: () => true });
    lucky.game.bet(lucky.a, 10, 100);
    lucky.game.bet(lucky.a, 3, 100);
    assert.ok([10, 3].includes(lucky.at(BETTING_MS).mult), 'везунчику выпадает его цвет');
  }
});

test('на дистанции отдача около 98.4%', () => {
  const clock = { t: 0 };
  const store = createStore();
  const a = store.register('Аня').player;
  a.balance = 1e12;
  const game = createWheel({ store, now: () => clock.t });
  game._reset(0);
  let staked = 0;
  for (let r = 0; r < 20000; r++) {
    for (const m of BET_MULTS) game.bet(a, m, 100);
    staked += 400;
    clock.t += BETTING_MS;
    game.tick();
    clock.t += SPIN_MS;
    game.tick();
    clock.t += RESULT_MS;
    game.tick();
  }
  const rtp = (a.balance - (1e12 - staked)) / staked;
  assert.ok(rtp > 0.93 && rtp < 1.04, `отдача ${(rtp * 100).toFixed(1)}%`);
});
