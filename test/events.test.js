const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const { createEvents, normAnswer, RAIN_FALL_MS } = require('../server/events');

function setup() {
  const clock = { t: 1000 };
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  const sent = [];
  const chat = [];
  const notes = [];
  const later = [];
  const ev = createEvents({
    store,
    broadcast: (m) => sent.push(m),
    postChat: (id, name, text) => chat.push(text),
    notify: (p, m) => notes.push({ p, m }),
    now: () => clock.t,
    random: () => 0.5,
    schedule: (fn, ms) => later.push({ fn, at: clock.t + ms }),
  });
  const run = (to) => {
    clock.t = to;
    for (const x of later.splice(0)) {
      if (x.at <= to) x.fn();
      else later.push(x);
    }
  };
  return { store, a, b, ev, sent, chat, notes, clock, run };
}

test('дождь: монету ловит только первый, сумма монет равна банку', () => {
  const { a, b, ev, sent, clock, run } = setup();
  assert.ok(ev.startRain(0).error);
  const r = ev.startRain(1001, 20);
  assert.equal(r.coins, 50);
  assert.ok(ev.startRain(100).error, 'второй дождь поверх первого нельзя');
  const msg = sent.at(-1);
  assert.equal(msg.type, 'rain');
  assert.equal(msg.coins.reduce((s, c) => s + c.value, 0), 1001);
  const coin = msg.coins[0];
  clock.t = 1000 + msg.startIn + coin.at + 100;
  assert.ok(ev.catchCoin(a, r.id, coin.id).ok);
  assert.ok(!ev.catchCoin(b, r.id, coin.id).ok, 'вторая поимка ничего не даёт');
  assert.equal(a.balance, 1000 + coin.value);
  assert.equal(b.balance, 1000);
  assert.equal(sent.at(-1).type, 'rain_caught');
  // Слишком рано (монета ещё не появилась) — не считается.
  const other = msg.coins.find((c) => c.at > coin.at + 2000) || { id: 999 };
  assert.ok(!ev.catchCoin(b, r.id, other.id).ok);
  run(1000 + msg.startIn + 20_000 + RAIN_FALL_MS + 1000);
  assert.ok(!ev.catchCoin(b, r.id, msg.coins[1].id).ok, 'после дождя ловить нечего');
  assert.ok(ev.startRain(100).ok, 'можно лить снова');
});

test('викторина: первый верный ответ без регистра и ё забирает приз', () => {
  const { a, b, ev, sent, chat, run } = setup();
  assert.ok(ev.startQuiz('', 'x', 100).error);
  assert.ok(ev.startQuiz('Столица Франции?', '', 100).error);
  assert.ok(ev.startQuiz('Столица Франции?', 'Париж / Paris', 0).error);
  assert.ok(ev.startQuiz('Столица Франции?', 'Париж / Paris', 500, 30).ok);
  assert.ok(ev.startQuiz('Ещё?', 'да', 1).error, 'вторая поверх первой нельзя');
  assert.equal(ev.chatMessage(b, 'Лондон'), false);
  assert.equal(ev.chatMessage(a, '  PARIS!!! '), true);
  assert.equal(a.balance, 1500);
  assert.equal(ev.chatMessage(b, 'Париж'), false, 'приз уже забрали');
  assert.deepEqual(sent.at(-1), { type: 'quiz_end', id: 1, winner: 'Аня', answer: 'Париж', prize: 500 });
  assert.match(chat.at(-1), /Аня/);
  run(100_000);
  assert.equal(sent.filter((m) => m.type === 'quiz_end').length, 1, 'таймер не завершает викторину второй раз');
  assert.equal(normAnswer('Ёлка-палка'), 'елка палка');
});

test('викторина: по таймеру раскрывается ответ', () => {
  const { a, ev, sent, run } = setup();
  ev.startQuiz('2+2?', '4', 100, 15);
  run(1000 + 15_000);
  assert.equal(sent.at(-1).winner, null);
  assert.equal(sent.at(-1).answer, '4');
  assert.equal(ev.chatMessage(a, '4'), false);
  assert.equal(a.balance, 1000);
});

test('счастливый час: доплата к чистому выигрышу, проигрыш не трогается', () => {
  const { a, ev, notes, run } = setup();
  assert.ok(ev.startHappy(5, 10).error);
  assert.ok(ev.startHappy(2, 10).ok);
  ev.onActivity({ kind: 'win', player: a, amount: 300 });
  assert.equal(a.balance, 1300);
  assert.equal(notes.at(-1).m.bonus, 300);
  ev.onActivity({ kind: 'lose', player: a, amount: 200 });
  assert.equal(a.balance, 1300);
  ev.startHappy(1.5, 10);
  ev.onActivity({ kind: 'win', player: a, amount: 101 });
  assert.equal(a.balance, 1350);
  run(1000 + 10 * 60_000);
  ev.onActivity({ kind: 'win', player: a, amount: 100 });
  assert.equal(a.balance, 1350, 'после конца часа доплаты нет');
  assert.equal(ev.adminState().happy, null);
});

test('гонка: считает чистый плюс, призы только тем, кто в плюсе', () => {
  const { store, a, b, ev, sent, run } = setup();
  const c = store.register('Вова').player;
  assert.ok(ev.startRace(1000, 10).ok);
  ev.onActivity({ kind: 'win', player: a, amount: 500 });
  ev.onActivity({ kind: 'win', player: b, amount: 900 });
  ev.onActivity({ kind: 'lose', player: b, amount: 300 });
  ev.onActivity({ kind: 'lose', player: c, amount: 50 });
  ev.onActivity({ kind: 'bet', player: c, amount: 1_000_000 });
  run(1000 + 10 * 60_000);
  const end = sent.find((m) => m.type === 'race_end');
  assert.deepEqual(end.results.map((r) => [r.name, r.net, r.prize]), [['Боря', 600, 500], ['Аня', 500, 300]]);
  assert.equal(b.balance, 1500);
  assert.equal(a.balance, 1300);
  assert.equal(c.balance, 1000);
  assert.ok(ev.finishRace().error, 'гонка уже кончилась');
});

test('снимок для нового игрока: все идущие мероприятия', () => {
  const { ev } = setup();
  ev.startHappy(2, 5);
  ev.startRace(300, 5);
  ev.startQuiz('?', 'да', 10);
  ev.startRain(100, 10);
  assert.deepEqual(ev.snapshot().map((m) => m.type).sort(), ['happy', 'quiz', 'race', 'rain']);
});
