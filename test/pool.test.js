const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const Physics = require('../public/pool-physics');
const { createPool, judge, rackOrder, groupOf, SHOT_MS, MAX_TIMEOUTS } = require('../server/pool');

// ---------- Пирамида и судья ----------

test('пирамида: все 15 шаров, восьмёрка в центре, в углах разные группы', () => {
  for (let seed = 0; seed < 20; seed++) {
    let s = seed;
    const order = rackOrder((n) => { s = (s * 31 + 7) % 997; return s % n; });
    assert.deepEqual([...order].sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]);
    assert.equal(order[4], 8);
    assert.notEqual(groupOf(order[10]), groupOf(order[14]));
  }
});

const ballsWith = (onTable) => Array.from({ length: 16 }, (_, id) => ({ id, x: 0, y: 0, in: !onTable.includes(id) }));
const all = [...Array(16).keys()];
const sim = (firstHit, pocketed) => ({ events: { firstHit, pocketed } });

test('судья: открытый стол, забил свой первый шар — группа и ещё удар', () => {
  const v = judge({ balls: ballsWith(all), groups: [null, null], turn: 1, breakShot: false }, sim(3, [3]));
  assert.equal(v.foul, false);
  assert.equal(v.keepTurn, true);
  assert.deepEqual(v.groups, ['stripes', 'solids']);
  assert.equal(v.assigned, 'solids');
});

test('судья: фолы', () => {
  const st = { balls: ballsWith(all), groups: ['solids', 'stripes'], turn: 0, breakShot: false };
  assert.equal(judge(st, sim(null, [])).foulReason, 'ни во что не попал');
  assert.equal(judge(st, sim(10, [10])).foulReason, 'первым задет чужой шар');
  assert.equal(judge(st, sim(3, [3, 0])).foulReason, 'биток в лузе');
  assert.equal(judge(st, sim(3, [3, 0])).keepTurn, false, 'забил, но с фолом: ход переходит');
  assert.equal(judge(st, sim(8, [])).foulReason, 'первой задета восьмёрка');
  assert.equal(judge(st, sim(3, [])).keepTurn, false, 'попал, но не забил');
  assert.equal(judge(st, sim(3, [12])).keepTurn, false, 'забил чужой: ход переходит');
});

test('судья: восьмёрка', () => {
  const cleared = { balls: ballsWith([0, 8, 9, 10]), groups: ['solids', 'stripes'], turn: 0, breakShot: false };
  assert.deepEqual(judge(cleared, sim(8, [8])), { winner: 0, reason: 'забил восьмёрку' });
  assert.equal(judge(cleared, sim(8, [8, 0])).winner, 1, 'восьмёрка с битком в лузе — поражение');
  const early = { balls: ballsWith([0, 1, 8, 9]), groups: ['solids', 'stripes'], turn: 0, breakShot: false };
  assert.equal(judge(early, sim(1, [1, 8])).winner, 1, 'восьмёрка раньше своих — поражение');
  const brk = { balls: ballsWith(all), groups: [null, null], turn: 0, breakShot: true };
  const v = judge(brk, sim(1, [8, 2]));
  assert.equal(v.winner, null, 'на разбивке восьмёрка не решает партию');
  assert.equal(v.respotEight, true);
  assert.deepEqual(v.groups, [null, null], 'после разбивки стол открыт');
  assert.equal(v.keepTurn, true);
});

// ---------- Приглашения и матч ----------

function setup({ online = () => true } = {}) {
  const clock = { t: 0 };
  const store = createStore();
  const [a, b, c] = ['Аня', 'Боря', 'Вика'].map((n) => store.register(n).player);
  const events = [];
  let r = 0;
  const pool = createPool({ store, now: () => clock.t, isOnline: online, randInt: (n) => (r++ * 7) % n, onEvent: (e) => events.push(e) });
  store.addReserver(pool.reserved);
  const total = () => [a, b, c].reduce((s, p) => s + store.capital(p), 0);
  return { store, pool, a, b, c, clock, events, total };
}

const ok = (x) => assert.ok(x.ok, x.error);
const err = (x, re) => assert.match(x.error || '', re);

test('приглашение: проверки, отказ, отмена, истечение', () => {
  const { pool, a, b, c, clock } = setup({ online: (id) => id !== '3' });
  err(pool.invite(a, a.id, 0), /Сам с собой/);
  err(pool.invite(a, c.id, 0), /не на сайте/);
  err(pool.invite(a, b.id, 5000), /Не хватает/);
  err(pool.invite(a, b.id, -1), /Ставка/);
  ok(pool.invite(a, b.id, 100));
  err(pool.invite(a, b.id, 100), /Одно приглашение/);
  assert.equal(pool.view(b).invitesIn.length, 1);
  assert.equal(pool.view(a).inviteOut.toName, 'Боря');
  ok(pool.decline(b, pool.view(b).invitesIn[0].id));
  ok(pool.invite(a, b.id, 100));
  ok(pool.cancel(a));
  ok(pool.invite(a, b.id, 100));
  clock.t += 60_000;
  pool.tick();
  assert.equal(pool.view(b).invitesIn.length, 0, 'истекло');
});

test('матч: ставка с обоих, победитель забирает обе, фишки сходятся', () => {
  const { pool, a, b, total, events } = setup();
  const start = total();
  ok(pool.invite(a, b.id, 100));
  ok(pool.accept(b, pool.view(b).invitesIn[0].id));
  assert.equal(a.balance, 900);
  assert.equal(b.balance, 900);
  assert.equal(total(), start, 'ставки в матче считаются капиталом');
  const m = pool.view(a).matches[0];
  assert.equal(m.balls.length, 16);
  assert.equal(m.ballInHand, 'kitchen');
  err(pool.invite(a, b.id, 0), /уже в матче/);
  // кто разбивает, тот и сдаётся
  const breaker = m.players[0].id === a.id ? a : b;
  const other = breaker === a ? b : a;
  ok(pool.concede(breaker));
  assert.equal(other.balance, 1100);
  assert.equal(breaker.balance, 900);
  assert.equal(total(), start);
  assert.deepEqual(events.map((e) => `${e.kind}:${e.player.name}:${e.amount}`).sort(),
    [`lose:${breaker.name}:100`, `win:${other.name}:100`].sort());
});

test('удар: разбивка из дома, ход и шар с руки по правилам, повтор удара пока шары катятся нельзя', () => {
  const { pool, a, b, clock } = setup();
  ok(pool.invite(a, b.id, 0));
  ok(pool.accept(b, pool.view(b).invitesIn[0].id));
  let m = pool.view(a).matches[0];
  const breaker = m.players[0].id === a.id ? a : b;
  const other = breaker === a ? b : a;
  err(pool.shoot(other, { dir: { x: 1, y: 0 }, power: 1 }), /соперника/);
  err(pool.shoot(breaker, { dir: { x: 1, y: 0 }, power: 1, cue: { x: 600, y: 250 } }), /в дом/);
  err(pool.shoot(breaker, { dir: { x: 0, y: 0 }, power: 1, cue: { x: 190, y: 250 } }), /направления/);
  err(pool.shoot(breaker, { dir: { x: 1, y: 0 }, power: 5, cue: { x: 190, y: 250 } }), /Сила/);
  err(pool.shoot(breaker, { dir: { x: 1, y: 0 }, power: 1, spin: 2, cue: { x: 190, y: 250 } }), /Винт/);
  err(pool.shoot(breaker, { dir: { x: 1, y: 0 }, power: 1, spin: 'top', cue: { x: 190, y: 250 } }), /Винт/);
  ok(pool.shoot(breaker, { dir: { x: 1, y: 0.003 }, power: 1, cue: { x: 190, y: 250 } }));
  m = pool.view(a).matches[0];
  assert.equal(m.shotNo, 1);
  assert.equal(m.breakShot, false);
  assert.ok(m.busyLeft > 0, 'шары катятся');
  assert.ok(m.lastShot && m.lastShot.start.length === 16, 'клиентам есть что анимировать');
  // клиент получает тот же результат тем же кодом
  const replay = Physics.simulate(m.lastShot.start, m.lastShot.vel, { spin: m.lastShot.spin });
  assert.deepEqual(replay.balls, m.balls.map((x) => (x.id === 8 && m.balls.find((y) => y.id === 8).in === false ? replay.balls.find((y) => y.id === 8) : x)));
  const next = m.players[m.turn].id === a.id ? a : b;
  err(pool.shoot(next, { dir: { x: -1, y: 0 }, power: 0.5 }), /катятся/);
  clock.t += m.busyLeft;
  const res = pool.shoot(next, { dir: { x: -1, y: 0 }, power: 0.3, cue: { x: 300, y: 100 } });
  assert.ok(res.ok || /Поставь биток/.test(res.error), res.error);
});

test('просрочки: три подряд — поражение', () => {
  const { pool, a, b, clock } = setup();
  ok(pool.invite(a, b.id, 50));
  ok(pool.accept(b, pool.view(b).invitesIn[0].id));
  const m0 = pool.view(a).matches[0];
  const lazy = m0.players[0].id;
  // Оба молчат: просрочки по очереди, первый набравший три проигрывает.
  for (let i = 0; i < MAX_TIMEOUTS * 2 && pool.view(a).matches[0].phase === 'playing'; i++) {
    clock.t += SHOT_MS;
    pool.tick();
  }
  const m = pool.view(a).matches[0];
  assert.equal(m.phase, 'over');
  assert.equal(m.players[m.winner].id === lazy, false, 'проспавший первым проиграл');
});

test('остановка сервера возвращает ставки, удаление игрока — победа сопернику', () => {
  const { pool, a, b, c, total } = setup();
  const start = total();
  ok(pool.invite(a, b.id, 300));
  ok(pool.accept(b, pool.view(b).invitesIn[0].id));
  pool.refundAll();
  assert.equal(a.balance, 1000);
  assert.equal(b.balance, 1000);
  assert.equal(total(), start);

  const t2 = setup();
  ok(t2.pool.invite(t2.a, t2.c.id, 100));
  ok(t2.pool.accept(t2.c, t2.pool.view(t2.c).invitesIn[0].id));
  t2.pool.forget(t2.a.id);
  assert.equal(t2.c.balance, 1100);
  void c;
});

test('победный удар засчитывается, когда шары остановились, а не в момент удара', () => {
  const { pool, a, b, clock, events, total } = setup();
  const start = total();
  ok(pool.invite(a, b.id, 100));
  ok(pool.accept(b, pool.view(b).invitesIn[0].id));
  const id = pool.view(a).matches[0].id;
  const m = pool._match(id);
  // Не разбивка, групп ещё нет: восьмёрка, забитая раньше времени, проигрывает партию.
  m.breakShot = false;
  m.ballInHand = null;
  m.balls = [{ id: 0, x: 120, y: 120, in: false }, { id: 8, x: 45, y: 45, in: false }, { id: 1, x: 600, y: 300, in: false }];
  const shooter = m.players[m.turn].id === a.id ? a : b;
  const winner = shooter === a ? b : a;
  ok(pool.shoot(shooter, { dir: { x: -1, y: -1 }, power: 0.4 }));
  let v = pool.view(a).matches[0];
  assert.equal(v.phase, 'playing', 'пока шары катятся, итога нет');
  assert.equal(winner.balance, 900, 'выигрыш ещё не выплачен');
  assert.equal(events.filter((e) => e.kind === 'win').length, 0, 'и в ленте пусто');
  err(pool.concede(shooter), /решена/);
  clock.t += 60_000;
  pool.tick();
  v = pool.view(a).matches[0];
  assert.equal(v.phase, 'over');
  assert.equal(winner.balance, 1100);
  assert.equal(total(), start);
});
