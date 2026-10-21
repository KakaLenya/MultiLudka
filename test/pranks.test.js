const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const { createPranks } = require('../server/pranks');

function setup() {
  const clock = { t: 1000 };
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  const sent = [];
  const chat = [];
  const later = [];
  const pr = createPranks({
    store,
    broadcast: (m) => sent.push(m),
    postChat: (id, name, text) => chat.push(text),
    onlineIds: () => new Set([a.id, b.id]),
    now: () => clock.t,
    random: () => 0.99,
    schedule: (fn, ms) => later.push({ fn, at: clock.t + ms }),
  });
  const run = (to) => {
    clock.t = to;
    for (const x of later.splice(0)) {
      if (x.at <= to) x.fn();
      else later.push(x);
    }
  };
  return { store, a, b, pr, sent, chat, clock, run };
}

test('сундук: забирает только первый, второй получает отказ', () => {
  const { a, b, pr, sent, chat } = setup();
  assert.ok(pr.dropChest(0).error);
  const { id } = pr.dropChest(5000, 30);
  assert.ok(pr.dropChest(100).error, 'пока лежит прошлый, новый не бросить');
  assert.equal(sent.at(-1).type, 'chest');
  assert.ok(pr.claimChest(a, id).ok);
  assert.equal(a.balance, 1000 + 5000);
  assert.ok(pr.claimChest(b, id).error);
  assert.equal(b.balance, 1000);
  assert.equal(sent.at(-1).type, 'chest_claimed');
  assert.match(chat.at(-1), /Аня первым схватил сундук/);
  assert.equal(pr.chest(), null);
});

test('сундук исчезает, если никто не успел', () => {
  const { a, pr, sent, run, clock } = setup();
  const { id } = pr.dropChest(500, 10);
  run(clock.t + 10_000);
  assert.equal(sent.at(-1).type, 'chest_gone');
  assert.ok(pr.claimChest(a, id).error);
  assert.equal(a.balance, 1000);
});

test('лотерея: победитель среди онлайн получает приз после прокрутки', () => {
  const { b, pr, sent, run, clock } = setup();
  const r = pr.runLottery(2000);
  assert.equal(r.winner, 'Боря');
  assert.equal(sent.at(-1).type, 'lottery');
  assert.deepEqual(sent.at(-1).names, ['Аня', 'Боря']);
  assert.ok(pr.runLottery(2000).error, 'вторая лотерея не во время первой');
  assert.equal(b.balance, 1000, 'приз — только когда колесо остановится');
  run(clock.t + 10_000);
  assert.equal(b.balance, 3000);
});

test('титул дня: виден всем, истекает, снимается', () => {
  const { a, pr, sent, clock } = setup();
  assert.ok(pr.setTitle(a.id, '').error);
  assert.ok(pr.setTitle('нет', 'x').error);
  assert.ok(pr.setTitle(a.id, '👑 Король зала', 2).ok);
  assert.deepEqual(sent.at(-1), { type: 'titles', titles: { [a.id]: '👑 Король зала' } });
  clock.t += 3 * 3600_000;
  assert.deepEqual(pr.titles(), {}, 'через 2 часа титул пропал');
  pr.setTitle(a.id, '🤡 Клоун дня');
  assert.ok(pr.clearTitle(a.id).ok);
  assert.deepEqual(pr.titles(), {});
  assert.ok(pr.clearTitle(a.id).error);
});
