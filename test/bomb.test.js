const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const {
  createBomb, fuseFor, ENTRY, LOBBY_MS, TURN_MS, RESULT_MS,
} = require('../server/bomb');

// random() по очереди из списка (для перемешивания порядка и фитиля), дальше 0.
function setup(names = ['Аня', 'Боря', 'Вика'], randoms = []) {
  const clock = { t: 0 };
  const store = createStore();
  const players = names.map((n) => store.register(n).player);
  const queue = [...randoms];
  const game = createBomb({ store, now: () => clock.t, random: () => (queue.length ? queue.shift() : 0) });
  store.addReserver(game.reserved);
  const wait = (ms) => { clock.t += ms; game.tick(); return game.state(); };
  const total = () => players.reduce((s, p) => s + store.capital(p), 0);
  return { store, game, players, wait, total, clock };
}

const ok = (r) => assert.ok(r.ok, r.error);
const err = (r, re) => assert.match(r.error || '', re);

// С random() = 0 перемешивание оставляет порядок входа, фитиль = банк + 10 на игрока.
test('фитиль: от 10 до 120 фишек на игрока сверху банка', () => {
  assert.equal(fuseFor(60, 3, 0), 90);
  assert.equal(fuseFor(60, 3, 0.999), 60 + Math.round(3 * (10 + 0.999 * 110)));
});

test('лобби: взнос, выход с возвратом, старт только от двух', () => {
  const { game, players: [a, b], wait } = setup(['Аня', 'Боря']);
  ok(game.join(a));
  assert.equal(a.balance, 1000 - ENTRY);
  err(game.join(a), /уже/);
  ok(game.leave(a));
  assert.equal(a.balance, 1000);
  ok(game.join(a));
  let s = wait(LOBBY_MS);
  assert.equal(s.phase, 'lobby', 'один игрок: ждём второго');
  ok(game.join(b));
  s = wait(LOBBY_MS);
  assert.equal(s.phase, 'playing');
  assert.equal(s.bank, 2 * ENTRY);
  assert.equal(s.result, null);
  assert.ok(!('fuse' in s), 'фитиль не виден игрокам');
  err(game.join(a), /уже идёт/);
});

test('взрыв: бомбист теряет всё, банк делят пропорционально вкладам, фишки сходятся', () => {
  // перемешивание (2 вызова для 3 игроков) оставляет порядок, фитиль: 60 + 3*(10+0.5*110) = 255
  const { game, players: [a, b, c], wait, total } = setup(['Аня', 'Боря', 'Вика'], [0.99, 0.99, 0.5]);
  const start = total();
  [a, b, c].forEach((p) => ok(game.join(p)));
  let s = wait(LOBBY_MS);
  assert.deepEqual(s.players.map((p) => p.name), ['Аня', 'Боря', 'Вика']);
  assert.equal(s.turn, a.id);
  err(game.deposit(b, 50), /не твой ход/);
  for (const bad of [5, 201, 10.5, '50', -10]) err(game.deposit(a, bad), /Взнос/);
  ok(game.deposit(a, 100));     // банк 160
  ok(game.deposit(b, 50));      // 210
  ok(game.deposit(c, 40));      // 250
  ok(game.deposit(a, 10));      // 260 >= 255: Аня взрывается
  s = game.state();
  assert.equal(s.phase, 'result');
  assert.equal(s.result.type, 'boom');
  assert.equal(s.result.bomberName, 'Аня');
  assert.equal(s.result.fuse, 255);
  assert.equal(s.result.bank, 260);
  // выжившие вложили: Боря 70, Вика 60 → 260*70/130 = 140, 260*60/130 = 120
  assert.deepEqual(s.result.payouts.map((p) => [p.name, p.amount]), [['Боря', 140], ['Вика', 120]]);
  assert.equal(a.balance, 1000 - 130);
  assert.equal(b.balance, 1000 - 70 + 140);
  assert.equal(c.balance, 1000 - 60 + 120);
  assert.equal(total(), start, 'фишки не появились и не пропали');
  s = wait(RESULT_MS);
  assert.equal(s.phase, 'lobby');
  assert.deepEqual(s.players, []);
  assert.equal(s.history[0].fuse, 255);
});

test('побег: половина взносов назад, последний смельчак забирает банк', () => {
  const { game, players: [a, b, c], wait, total } = setup(['Аня', 'Боря', 'Вика'], [0.99, 0.99, 0.99]);
  const start = total();
  [a, b, c].forEach((p) => ok(game.join(p)));
  wait(LOBBY_MS);
  ok(game.deposit(a, 60));      // Аня вложила 80
  ok(game.flee(c));             // Вика не в свой ход: забирает 10 из 20
  assert.equal(c.balance, 1000 - 20 + 10);
  err(game.flee(c), /не в игре/);
  assert.equal(game.state().turn, b.id);
  ok(game.flee(b));             // остаётся одна Аня
  const s = game.state();
  assert.equal(s.result.type, 'last');
  assert.equal(s.result.winnerName, 'Аня');
  // банк: 60 взносов + 60 Ани − 10 Вике − 10 Боре = 100
  assert.equal(s.result.bank, 100);
  assert.equal(a.balance, 1000 - 80 + 100);
  assert.equal(total(), start);
});

test('проспал ход: автоматически минимальный взнос', () => {
  const { game, players: [a, b], wait } = setup(['Аня', 'Боря'], [0.99, 0.99]);
  ok(game.join(a));
  ok(game.join(b));
  wait(LOBBY_MS);
  const s = wait(TURN_MS);
  assert.equal(s.bank, 2 * ENTRY + 10);
  assert.equal(s.turn, b.id);
  assert.equal(s.players[0].lastMove, '+10 (время)');
});

test('гонка: ход истёк ровно в момент взноса, без тика', () => {
  const { game, players: [a, b], wait, clock } = setup(['Аня', 'Боря'], [0.99, 0.99]);
  ok(game.join(a));
  ok(game.join(b));
  wait(LOBBY_MS);
  clock.t += TURN_MS;           // таймер Ани истёк, тика не было
  err(game.deposit(a, 100), /не твой ход/);
  assert.equal(a.balance, 1000 - ENTRY - 10, 'списан только автоматический минимум');
});

test('капитал: вложенное считается своим, пока в игре', () => {
  const { store, game, players: [a, b], wait } = setup(['Аня', 'Боря'], [0.99, 0.99]);
  ok(game.join(a));
  ok(game.join(b));
  wait(LOBBY_MS);
  ok(game.deposit(a, 100));
  assert.equal(store.capital(a), 1000);
  ok(game.flee(a));
  assert.equal(store.capital(a), 1000 - 60, 'после побега половина потеряна');
});

test('админ: подкрутка фитиля, возврат всего при остановке', () => {
  const { game, players: [a, b], wait, total } = setup(['Аня', 'Боря'], [0.99, 0.99, 0.99]);
  const start = total();
  assert.deepEqual(game.rig(45), { ok: true, round: 'next' });
  ok(game.join(a));
  ok(game.join(b));
  wait(LOBBY_MS);
  assert.equal(game.adminState().fuse, 45);
  assert.ok(game.rig(40).error, 'меньше банка нельзя');
  assert.deepEqual(game.rig(500), { ok: true, round: 'current' });
  ok(game.deposit(a, 100));
  ok(game.flee(b));             // Боря забрал 10, Аня одна → забирает банк
  game.refundAll();             // после результата ничего не трогает
  assert.equal(total(), start);

  const g2 = setup(['Вика', 'Гоша'], [0.99, 0.99, 0.99]);
  ok(g2.game.join(g2.players[0]));
  ok(g2.game.join(g2.players[1]));
  g2.wait(LOBBY_MS);
  ok(g2.game.deposit(g2.players[0], 50));
  g2.game.refundAll();
  assert.deepEqual(g2.players.map((p) => p.balance), [1000, 1000]);
});
