const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../server/players');
const { createLuck } = require('../server/luck');
const { createVerity, SPIN_MS } = require('../server/verity');
const { createUpgrader } = require('../server/upgrader');
const { createRoulette, BETTING_MS } = require('../server/roulette');
const { createCrashGame, BETTING_MS: CRASH_BETTING_MS } = require('../server/crash');
const { createHoldem, makeDeck, bestHand, compareHands, START_DELAY_MS } = require('../server/holdem');

function players() {
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  return { store, a, b };
}
const always = (lucky) => (p) => p === lucky;

test('модуль: включить, выключить, бросок по проценту, сохранение', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'luck-'));
  const file = path.join(dir, 'luck.json');
  let r = 0.5;
  const luck = createLuck({ file, random: () => r });
  const a = { id: '1' };
  assert.equal(luck.roll(a), false, 'по умолчанию везения нет');
  assert.ok(luck.set('1', 90).ok);
  assert.ok(luck.set('1', 150).error);
  assert.ok(luck.set('1', 1.5).error);
  assert.equal(luck.roll(a), true, '50 < 90');
  r = 0.95;
  assert.equal(luck.roll(a), false, '95 > 90: в этот раз честно');
  assert.equal(createLuck({ file }).percentOf('1'), 90, 'пережил перезапуск');
  luck.set('1', 0);
  assert.equal(luck.percentOf('1'), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('Верити: везунчику всегда добрый, остальным как выпадет', () => {
  const { store, a, b } = players();
  const clock = { t: 0 };
  const v = createVerity({ store, now: () => clock.t, coin: () => false, schedule: () => {}, lucky: always(a) });
  for (let i = 0; i < 5; i++) {
    clock.t += SPIN_MS;
    assert.equal(v.play(a, 10).result.good, true);
    assert.equal(v.play(b, 10).result.good, false);
  }
});

test('апгрейдер: у везунчика стрелка в зелёной зоне даже на 1%', () => {
  const { store, a } = players();
  const clock = { t: 0 };
  const u = createUpgrader({ store, now: () => clock.t, schedule: () => {}, lucky: always(a) });
  for (let i = 0; i < 30; i++) {
    clock.t += 10_000;
    assert.equal(u.spin(a, 10, 1).spin.win, true);
  }
});

test('рулетка: выпадает число, на котором везунчик в плюсе', () => {
  const { store, a, b } = players();
  const clock = { t: 0 };
  const game = createRoulette({ store, now: () => clock.t, random: () => 0, lucky: always(a) });
  game._reset(0);
  for (let round = 0; round < 20; round++) {
    assert.ok(game.bet(a, 'straight', 17, 10).ok);
    assert.ok(game.bet(b, 'black', null, 10).ok);
    clock.t += BETTING_MS;
    game.tick();
    assert.equal(game.state().result, 17, 'везунчик угадал число');
    clock.t += 60_000;
    game.tick();
    game._reset(clock.t);
  }
});

test('краш: не крашит раньше автовывода везунчика, а без автовывода — не ниже ×4', () => {
  const { store, a, b } = players();
  const clock = { t: 0 };
  const game = createCrashGame({ store, now: () => clock.t, random: () => 0, lucky: always(a) });
  store.addReserver(game.reserved);
  game._reset(0);
  assert.ok(game.bet(a, 100, 25).ok);
  assert.ok(game.bet(b, 100).ok);
  clock.t = CRASH_BETTING_MS;
  game.tick();
  assert.ok(game.adminState().crashPoint > 25, `краш на ${game.adminState().crashPoint}`);

  game._reset(clock.t);
  assert.ok(game.bet(a, 100).ok);
  clock.t += CRASH_BETTING_MS;
  game.tick();
  assert.ok(game.adminState().crashPoint >= 4);
});

test('покер: везунчик получает карманные карты руки, которая выиграет с этим бордом', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  const clock = { t: 0 };
  // Первые карты — Боре (после дилера), потом Ане: у Бори тузы, у Ани мусор, борд без помощи Ане.
  const first = ['Ah', 'Ad', '7c', '2d', 'Kc', '9s', '5h', 'Jd', '3c'];
  const table = createHoldem({
    store, now: () => clock.t, lucky: always(a),
    deckFactory: () => [...first, ...makeDeck().filter((c) => !first.includes(c))],
  });
  assert.ok(table.join(a, 1000).ok);
  assert.ok(table.join(b, 1000).ok);
  clock.t += START_DELAY_MS;
  table.tick();
  const board = ['Kc', '9s', '5h', 'Jd', '3c'];
  const mine = bestHand([...table.view(a).you.hole, ...board]);
  const his = bestHand([...table.view(b).you.hole, ...board]);
  assert.ok(compareHands(mine, his) > 0, `у везунчика ${table.view(a).you.hole}`);
});

test('бомба: у везунчика не рвёт — фитиль удлиняется, рванёт у другого', () => {
  const { createBomb, LOBBY_MS } = require('../server/bomb');
  const store = createStore();
  const [a, b] = ['Аня', 'Боря'].map((n) => store.register(n).player);
  const clock = { t: 0 };
  const queue = [0.99, 0.5];   // порядок входа, фитиль 40 + 2*(10+0.5*110) = 170
  const game = createBomb({ store, now: () => clock.t, random: () => (queue.length ? queue.shift() : 0), lucky: always(a) });
  store.addReserver(game.reserved);
  const total = () => store.capital(a) + store.capital(b);
  const start = total();
  assert.ok(game.join(a).ok);
  assert.ok(game.join(b).ok);
  clock.t += LOBBY_MS;
  game.tick();
  assert.ok(game.deposit(a, 150).ok, 'банк 190 ≥ 170, но Аня везучая');
  assert.equal(game.state().phase, 'playing');
  assert.ok(game.deposit(b, 10).ok);   // фитиль стал 191: рвануло у Бори
  const s = game.state();
  assert.equal(s.result.type, 'boom');
  assert.equal(s.result.bomberName, 'Боря');
  assert.equal(total(), start, 'фишки сходятся');
});
