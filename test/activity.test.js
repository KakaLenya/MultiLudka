const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const { createCrashGame, BETTING_MS } = require('../server/crash');
const { createRoulette, BETTING_MS: R_BET, SPIN_MS: R_SPIN } = require('../server/roulette');
const { createBomb, LOBBY_MS } = require('../server/bomb');
const { createUpgrader } = require('../server/upgrader');

const brief = (events) => events.map((e) => `${e.game}:${e.kind}:${e.player.name}:${e.amount}`);

test('лента: Краш — ставка, вывод в плюс, сгоревшая ставка', () => {
  const clock = { t: 0 };
  const store = createStore();
  const [a, b] = ['Аня', 'Боря'].map((n) => store.register(n).player);
  const events = [];
  const game = createCrashGame({ store, now: () => clock.t, random: () => 0.5, onEvent: (e) => events.push(e) });
  game._reset(0);
  game.bet(a, 100);
  game.bet(b, 50);
  clock.t = BETTING_MS;
  game.tick();
  clock.t = BETTING_MS + 9000;
  game.cashout(a);            // x1.87
  clock.t = BETTING_MS + 9800;
  game.tick();                // краш x1.98
  assert.deepEqual(brief(events), ['crash:bet:Аня:100', 'crash:bet:Боря:50', 'crash:win:Аня:87', 'crash:lose:Боря:50']);
  assert.match(events[2].note, /1\.87/);
});

test('лента: рулетка — ставки при закрытии, итог по чистому результату', () => {
  const clock = { t: 0 };
  const store = createStore();
  const [a, b] = ['Аня', 'Боря'].map((n) => store.register(n).player);
  const events = [];
  const game = createRoulette({ store, now: () => clock.t, random: () => 17, onEvent: (e) => events.push(e) });
  game._reset(0);
  game.bet(a, 'straight', 17, 10);
  game.bet(a, 'red', null, 50);
  game.bet(b, 'red', null, 100);
  clock.t = R_BET;
  game.tick();
  assert.deepEqual(brief(events), ['roulette:bet:Аня:60', 'roulette:bet:Боря:100']);
  assert.equal(events[0].note, '№17, красное');
  clock.t = R_BET + R_SPIN;
  game.tick();
  assert.deepEqual(brief(events.slice(2)), ['roulette:win:Аня:300', 'roulette:lose:Боря:100']);
});

test('лента: бомба — выжившие в плюс, бомбист и беглец в минус', () => {
  const clock = { t: 0 };
  const store = createStore();
  const [a, b, c] = ['Аня', 'Боря', 'Вика'].map((n) => store.register(n).player);
  const events = [];
  const randoms = [0.99, 0.99, 0.5];
  const game = createBomb({ store, now: () => clock.t, random: () => randoms.shift() ?? 0, onEvent: (e) => events.push(e) });
  [a, b, c].forEach((p) => game.join(p));
  clock.t = LOBBY_MS;
  game.tick();
  game.deposit(a, 100);
  game.flee(b);               // Боря терял 10 из 20
  game.deposit(c, 40);
  game.deposit(a, 100);       // банк 290 за фитилём 255: Аня взрывается, Вика (вложила 60) забирает всё
  assert.deepEqual(brief(events), ['bomb:lose:Боря:10', 'bomb:win:Вика:230', 'bomb:lose:Аня:220']);
});

test('лента: апгрейд появляется только после остановки колеса', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  const events = [];
  const later = [];
  const up = createUpgrader({ store, random: () => 0.1, schedule: (fn) => later.push(fn), onEvent: (e) => events.push(e) });
  up.rig('win');
  up.spin(a, 100, 30);
  assert.equal(events.length, 0);
  later.shift()();
  assert.deepEqual(brief(events), ['upgrade:win:Аня:230']);
});
