const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const { createDuel, winnerOf, upgradeScore, durationOf, GAMES } = require('../server/duel');

function setup({ online = () => true, lucky } = {}) {
  const clock = { t: 0 };
  const store = createStore();
  const [a, b, c] = ['Аня', 'Боря', 'Вика'].map((n) => store.register(n).player);
  const events = [];
  const duel = createDuel({ store, now: () => clock.t, isOnline: online, onEvent: (e) => events.push(e), lucky });
  store.addReserver(duel.reserved);
  const total = () => [a, b, c].reduce((s, p) => s + store.capital(p), 0);
  const finish = () => {
    const d = duel.view(a).duels[0];
    clock.t += d.duration;
    duel.tick();
    return duel.view(a).duels[0];
  };
  return { store, duel, a, b, c, clock, events, total, finish };
}
const ok = (x) => assert.ok(x.ok, x.error);
const err = (x, re) => assert.match(x.error || '', re);

test('вызов: проверки', () => {
  const { duel, a, b } = setup({ online: (id) => id !== '3' });
  err(duel.invite(a, b.id, 'poker', 10), /игру/);
  err(duel.invite(a, a.id, 'crash', 10), /самим собой/);
  err(duel.invite(a, '3', 'crash', 10), /не на сайте/);
  err(duel.invite(a, b.id, 'crash', 5000), /Не хватает/);
  err(duel.invite(a, b.id, 'crash', 1.5), /Ставка/);
  ok(duel.invite(a, b.id, 'crash', 100));
  err(duel.invite(a, b.id, 'verity', 100), /Один вызов/);
  assert.equal(duel.view(b).invitesIn.length, 1);
  assert.equal(duel.view(a).inviteOut.toName, 'Боря');
  ok(duel.cancel(a));
  assert.equal(duel.view(b).invitesIn.length, 0);
});

test('во всех играх: ставка у обоих «в игре», банк победителю после анимации, фишки сходятся', () => {
  for (const game of Object.keys(GAMES)) {
    const { duel, a, b, store, events, total, finish } = setup();
    const start = total();
    ok(duel.invite(a, b.id, game, 300));
    ok(duel.accept(b, duel.view(b).invitesIn[0].id));
    assert.equal(a.balance, 700);
    assert.equal(b.balance, 700);
    assert.equal(store.capital(a), 1000, 'ставка считается капиталом, пока идёт анимация');
    let d = duel.view(a).duels[0];
    assert.equal(d.phase, 'playing');
    assert.equal(d.winner, null, 'победитель не объявлен до конца анимации');
    assert.equal(events.length, 0);
    err(duel.invite(a, b.id, game, 10), /уже в дуэли/);
    d = finish();
    assert.equal(d.phase, 'over');
    const w = d.winner === 0 ? a : b;
    const l = d.winner === 0 ? b : a;
    assert.equal(d.winner, winnerOf(game, d.data));
    assert.equal(w.balance, 1300, game);
    assert.equal(l.balance, 700, game);
    assert.equal(total(), start);
    assert.deepEqual(events.map((e) => `${e.game}:${e.kind}:${e.player.name}:${e.amount}`).sort(),
      [`duel:lose:${l.name}:300`, `duel:win:${w.name}:300`].sort());
    assert.equal(duel.view(a).history[0].winner.name, w.name);
  }
});

test('ничьих не бывает, длительность разумная', () => {
  for (const game of Object.keys(GAMES)) {
    for (let i = 0; i < 300; i++) {
      const { duel, a, b } = setup();
      ok(duel.invite(a, b.id, game, 0));
      ok(duel.accept(b, duel.view(b).invitesIn[0].id));
      const d = duel.view(a).duels[0];
      const w = winnerOf(game, d.data);
      assert.ok(w === 0 || w === 1);
      if (game === 'crash') assert.notEqual(d.data.crash[0], d.data.crash[1]);
      if (game === 'roulette') assert.notEqual(d.data.numbers[0], d.data.numbers[1]);
      if (game === 'verity') {
        const last = d.data.rounds.at(-1);
        assert.notEqual(last[0], last[1], 'последний раунд решающий');
        d.data.rounds.slice(0, -1).forEach((r) => assert.equal(r[0], r[1], 'до него — ничьи'));
      }
      assert.ok(d.duration > 1000 && d.duration < 40_000, `${game}: ${d.duration} мс`);
    }
  }
});

test('апгрейд: глубже в зелёной зоне — выше счёт', () => {
  assert.ok(upgradeScore(15, 0, 30) > upgradeScore(2, 0, 30), 'середина зоны лучше края');
  assert.ok(upgradeScore(2, 0, 30) > upgradeScore(40, 0, 30), 'внутри лучше, чем снаружи');
  assert.ok(upgradeScore(95, 90, 30) > 0, 'зона через ноль');
  assert.equal(durationOf('crash', { crash: [100, 200] }) > durationOf('crash', { crash: [100, 120] }), true);
});

test('везение: везучий выигрывает дуэль в любой игре', () => {
  for (const game of Object.keys(GAMES)) {
    for (let i = 0; i < 20; i++) {
      const { duel, a, b, finish } = setup({ lucky: (p) => p.name === 'Боря' });
      ok(duel.invite(a, b.id, game, 10));
      ok(duel.accept(b, duel.view(b).invitesIn[0].id));
      assert.equal(finish().winner, 1, `${game}: выиграл Боря`);
    }
  }
});

test('вызов истекает; отказ; удалённый игрок — дуэль доигрывается сразу', () => {
  const { duel, a, b, c, clock, total } = setup();
  const start = total();
  ok(duel.invite(a, b.id, 'roulette', 50));
  clock.t += 61_000;
  duel.tick();
  assert.equal(duel.view(b).invitesIn.length, 0);
  ok(duel.invite(a, c.id, 'roulette', 50));
  ok(duel.decline(c, duel.view(c).invitesIn[0].id));
  ok(duel.invite(a, b.id, 'roulette', 50));
  ok(duel.accept(b, duel.view(b).invitesIn[0].id));
  duel.forget(b.id);
  assert.equal(duel.view(a).duels[0].phase, 'over');
  assert.equal(total(), start);
});
