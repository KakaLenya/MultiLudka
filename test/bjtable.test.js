const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const { createBjTable, SEATS, TIMINGS } = require('../server/bjtable');

function setup(opts = {}) {
  const store = createStore();
  const names = ['Аня', 'Боря', 'Вика', 'Гоша', 'Даша', 'Егор'];
  const [a, b, c, d, e, f] = names.map((n) => store.register(n).player);
  const clock = { t: 1_000_000 };
  const events = [];
  const feeds = [];
  const tb = createBjTable({ store, now: () => clock.t, onEvent: (x) => events.push(x), onFeed: (x) => feeds.push(x), ...opts });
  store.addReserver(tb.reserved);
  // Прокрутить время до конца текущей фазы и сделать тик.
  const step = (ms) => {
    const left = tb.view().timeLeft;
    clock.t += ms !== undefined ? ms : (left === null ? 0 : left);
    tb.tick();
    return tb.view();
  };
  return { store, tb, a, b, c, d, e, f, clock, events, feeds, step };
}

// Карты раздачи: по первой каждому месту со ставкой (по порядку мест), открытая дилеру, по второй, закрытая.
const seatOf = (v, player) => v.seats.find((s) => s && s.playerId === player.id);

test('места: сесть, пересесть без ставки, занятое место, встать', () => {
  const { tb, a, b } = setup();
  assert.ok(tb.sit(a, 0).ok);
  assert.match(tb.sit(b, 0).error, /занято/);
  assert.match(tb.sit(b, 7).error, /Нет такого/);
  assert.ok(tb.sit(a, 3).ok, 'пересел');
  assert.equal(tb.view().seats[0], null);
  assert.equal(tb.view().seats[3].name, 'Аня');
  assert.ok(tb.leave(a).ok);
  assert.equal(tb.view().seats[3], null);
  assert.match(tb.leave(a).error, /не за столом/);
  assert.match(tb.bet(a, 10).error, /сядь/);
});

test('ставки: таймер с первой ставки, ставка в игре, убрать ставку', () => {
  const { tb, a, b, store } = setup();
  tb.sit(a, 0);
  tb.sit(b, 1);
  assert.equal(tb.view().phase, 'idle');
  assert.ok(tb.bet(a, 100).ok);
  let v = tb.view();
  assert.equal(v.phase, 'betting');
  assert.equal(v.timeLeft, TIMINGS.betMs);
  assert.equal(a.balance, 900);
  assert.equal(store.capital(a), 1000);
  assert.match(tb.bet(a, 50).error, /уже/);
  for (const amt of [0, 1.5, '10', 5000]) assert.ok(tb.bet(b, amt).error, String(amt));
  assert.ok(tb.unbet(a).ok);
  assert.equal(a.balance, 1000);
  assert.equal(tb.view().phase, 'idle', 'ставок не осталось');
});

test('все сидящие поставили — раздача сразу; ходы по очереди, расчёт каждого', () => {
  const { tb, a, b, step, events, feeds } = setup();
  tb.sit(a, 0);
  tb.sit(b, 2);
  // Аня: T, 9 = 19. Боря: 5, 6 = 11. Дилер: 7 открыто, T закрыто = 17.
  tb._stack(['Ts', '5h', '7c', '9d', '6s', 'Td']);
  tb.bet(a, 100);
  assert.equal(tb.view().phase, 'betting');
  tb.bet(b, 50);
  let v = tb.view();
  assert.equal(v.phase, 'dealing', 'не ждём таймер');
  assert.deepEqual(v.dealer.cards, ['7c', null]);
  assert.deepEqual(seatOf(v, a).hands[0].cards, ['Ts', '9d']);
  assert.ok(events.filter((e) => e.kind === 'bet').length === 2);
  assert.match(tb.act(a, 'stand').error, /не твой ход/, 'пока карты летят — не ходим');
  v = step();
  assert.equal(v.phase, 'playing');
  assert.equal(v.turn, 0);
  assert.ok(v.seats[0].actions.double);
  assert.match(tb.act(b, 'hit').error, /не твой/);
  tb.act(a, 'stand');
  v = tb.view();
  assert.equal(v.turn, 2);
  tb._stack(['Th']);                       // Боря удваивает: 11 + 10 = 21
  assert.ok(tb.act(b, 'double').ok);
  v = tb.view();
  assert.equal(v.phase, 'dealer');
  assert.deepEqual(v.dealer.cards, ['7c', 'Td']);
  assert.equal(b.balance, 900, 'удвоение списано');
  assert.equal(a.balance, 900, 'выплата ждёт, пока дилер откроется у всех');
  v = step();
  assert.equal(v.phase, 'results');
  assert.equal(seatOf(v, a).hands[0].result, 'win');      // 19 против 17
  assert.equal(seatOf(v, b).hands[0].result, 'win');      // 21 против 17
  assert.equal(a.balance, 1100);
  assert.equal(b.balance, 1100);
  assert.equal(feeds.at(-1).length, 2);
  assert.ok(events.some((e) => e.kind === 'win' && e.player === b && e.amount === 100));
  v = step();
  assert.equal(v.phase, 'idle');
  assert.deepEqual(v.dealer.cards, []);
  assert.equal(v.seats[0].bet, 0, 'новый раунд — новые ставки');
});

test('таймер хода: не успел — «Хватит»; ставки — раздача по таймеру без опоздавших', () => {
  const { tb, a, b, c, step } = setup();
  tb.sit(a, 0);
  tb.sit(b, 1);
  tb.sit(c, 4);
  tb._stack(['Ts', '9h', '5c', '8d', '8s', 'Td']);
  tb.bet(a, 10);
  tb.bet(b, 10);
  let v = step();                              // таймер ставок: Вика не успела
  assert.equal(v.phase, 'dealing');
  assert.equal(seatOf(v, c).hands.length, 0, 'без ставки — смотрит');
  v = step();
  assert.equal(v.turn, 0);
  v = step();                                  // Аня думает слишком долго
  assert.equal(v.turn, 1);
  assert.equal(seatOf(v, a).hands[0].done, true);
  assert.equal(seatOf(v, a).hands[0].cards.length, 2, 'просто стоит');
  v = step();
  assert.equal(v.phase, 'dealer');
});

test('отключился в свой ход — по таймеру стоят все руки; ушёл посреди раунда — ставка рассчитана честно', () => {
  const { tb, a, b, step, store } = setup();
  tb.sit(a, 0);
  tb.sit(b, 1);
  // Аня: 8, 8 (пара). Боря: T, 9. Дилер: 6 + T = 16, добор K — перебор.
  tb._stack(['8s', 'Ts', '6c', '8h', '9h', 'Td']);
  tb.bet(a, 100);
  tb.bet(b, 100);
  step();
  tb._stack(['3d', '2c']);
  assert.ok(tb.act(a, 'split').ok);
  assert.equal(a.balance, 800);
  assert.equal(store.capital(a), 1000);
  tb.setConnected(a, false);
  let v = step();                              // таймер: обе руки Ани стоят разом
  assert.equal(v.turn, 1);
  assert.ok(seatOf(v, a).hands.every((h) => h.done));
  // Боря уходит в свой ход: рука стоит, место освободится после итогов.
  assert.ok(tb.leave(b).ok);
  v = tb.view();
  assert.equal(v.phase, 'dealer');
  assert.equal(seatOf(v, b).leaving, true);
  tb._stack([]);
  v = step();
  assert.equal(v.phase, 'results');
  const dealerTotal = v.dealer.total;
  const exp = (t) => (dealerTotal > 21 || t > dealerTotal ? 'win' : t === dealerTotal ? 'push' : 'lose');
  assert.deepEqual(seatOf(v, a).hands.map((h) => h.result), seatOf(v, a).hands.map((h) => exp(h.total)));
  assert.equal(seatOf(v, b).hands[0].result, exp(19));
  assert.equal(store.capital(b), b.balance, 'ушедший рассчитан');
  v = step();
  assert.equal(v.seats[1], null, 'место Бори свободно');
  assert.ok(v.seats[0], 'отключённая Аня пока сидит');
  step(TIMINGS.disconnectGraceMs);
  assert.equal(tb.view().seats[0], null, 'через минуту без связи — место свободно');
});

test('уход до раздачи — ставка назад; все оставшиеся поставили — раздача', () => {
  const { tb, a, b } = setup();
  tb.sit(a, 0);
  tb.sit(b, 1);
  tb.bet(a, 100);
  tb.bet(b, 0);
  assert.equal(tb.view().phase, 'betting');
  tb.leave(b);
  assert.equal(tb.view().phase, 'dealing', 'Боря ушёл, Аня поставила — раздаём');
  assert.equal(a.balance, 900);
  const { tb: tb2, a: a2, b: b2 } = setup();
  tb2.sit(a2, 2);
  tb2.sit(b2, 3);
  tb2.bet(a2, 300);
  tb2.setConnected(a2, false);
  assert.equal(tb2.view().phase, 'betting', 'Боря ещё может поставить');
  tb2.leave(a2);
  assert.equal(a2.balance, 1000);
  assert.equal(tb2.view().phase, 'idle');
  // Один за столом: поставил — раздача сразу.
  tb2.bet(b2, 10);
  assert.equal(tb2.view().phase, 'dealing');
});

test('блэкджек 3:2, блэкджек у дилера, перебор; сплит тузов', () => {
  const { tb, a, b, c, step } = setup();
  tb.sit(a, 0);
  tb.sit(b, 1);
  tb.sit(c, 2);
  // Аня: A, K — блэкджек. Боря: T, 6 → ещё T, перебор. Вика: A, A → сплит. Дилер: 9 + 8 = 17.
  tb._stack(['As', 'Ts', 'Ac', '9c', 'Kd', '6h', 'Ah', '8d']);
  tb.bet(a, 100);
  tb.bet(b, 100);
  tb.bet(c, 100);
  let v = step();
  assert.equal(v.turn, 1, 'с блэкджеком не ходят');
  tb._stack(['Tc']);
  tb.act(b, 'hit');
  v = tb.view();
  assert.equal(v.turn, 2);
  tb._stack(['Kh', '5s']);
  tb.act(c, 'split');
  v = tb.view();
  assert.equal(v.phase, 'dealer', 'тузы после сплита — по карте и всё');
  v = step();
  assert.equal(seatOf(v, a).hands[0].result, 'blackjack');
  assert.equal(a.balance, 1150);
  assert.equal(seatOf(v, b).hands[0].result, 'bust');
  assert.equal(b.balance, 900);
  assert.deepEqual(seatOf(v, c).hands.map((h) => h.result), ['win', 'lose']);   // 21 и 16 против 17
  assert.equal(c.balance, 1000);

  const s2 = setup();
  s2.tb.sit(s2.a, 0);
  s2.tb.sit(s2.b, 1);
  s2.tb._stack(['As', 'Ts', 'Ac', 'Kd', '9h', 'Kc']);   // дилер A + K — блэкджек
  s2.tb.bet(s2.a, 100);
  s2.tb.bet(s2.b, 100);
  v = s2.step();
  assert.equal(v.phase, 'dealer', 'дилер проверил блэкджек — никто не ходит');
  v = s2.step();
  assert.equal(seatOf(v, s2.a).hands[0].result, 'push');
  assert.equal(seatOf(v, s2.b).hands[0].result, 'lose');
  assert.equal(s2.a.balance, 1000);
  assert.equal(s2.b.balance, 900);
});

test('подкрутка дилера: переберёт, обыграет всех, блэкджек — и сбрасывается', () => {
  for (let i = 0; i < 25; i++) {
    const { tb, a, b, step } = setup();
    a.balance = b.balance = 1e9;
    tb.sit(a, 0);
    tb.sit(b, 1);
    tb.rig('bust');
    tb.bet(a, 10);
    tb.bet(b, 10);
    let v = step();
    while (v.phase === 'playing') v = (tb.act(v.turn === 0 ? a : b, 'stand'), tb.view());
    v = step();
    if (!v.dealer.natural) assert.ok(v.seats.every((s) => !s || s.hands.every((h) => ['win', 'blackjack'].includes(h.result))), JSON.stringify(v.dealer));
    step();
    tb.rig('strong');
    tb.bet(a, 10);
    tb.bet(b, 10);
    v = step();
    while (v.phase === 'playing') v = (tb.act(v.turn === 0 ? a : b, 'stand'), tb.view());
    v = step();
    for (const s of v.seats.filter(Boolean)) {
      for (const h of s.hands) assert.ok(['lose', 'bust', 'blackjack'].includes(h.result) || (h.result === 'push' && h.total >= v.dealer.total), `${JSON.stringify(h)} vs ${JSON.stringify(v.dealer)}`);
    }
    step();
    tb.rig('blackjack');
    tb.bet(a, 10);
    tb.bet(b, 10);
    v = step();
    assert.equal(v.phase, 'dealer');
    assert.equal(v.dealer.natural, true);
    step();
    step();
    tb.bet(a, 10);
    tb.bet(b, 10);
    assert.equal(tb.adminState().rigged, null);
  }
  const { tb } = setup();
  assert.ok(tb.rig('maybe').error);
});

test('полный стол: пять мест, шестой не садится; ачивочные данные в событии', () => {
  const { tb, a, b, c, d, e, f, step, events } = setup();
  [a, b, c, d, e].forEach((p, i) => tb.sit(p, i));
  for (let i = 0; i < SEATS; i++) assert.match(tb.sit(f, i).error, /занято/);
  tb._stack(['As', '9s', '9c', '9d', '9h', '7c', 'Kd', '8s', '8c', '8d', '8h', 'Tc']);
  [a, b, c, d, e].forEach((p) => tb.bet(p, 10));
  let v = step();
  while (v.phase === 'playing') v = (tb.act([a, b, c, d, e][v.turn], 'stand'), tb.view());
  step();
  const bj = events.find((x) => x.kind === 'win' && x.player === a);
  assert.equal(bj.meta.natural, true);
  assert.equal(bj.meta.fullTable, true);
});

test('кто сидит и не ставит пять раундов — встаёт', () => {
  const { tb, a, b, step } = setup();
  tb.sit(a, 0);
  tb.sit(b, 1);
  for (let i = 0; i < 5; i++) {
    tb.bet(a, 1);
    let v = step();
    while (v.phase !== 'idle') {
      if (v.phase === 'playing') tb.act(a, 'stand');
      v = step();
    }
  }
  assert.equal(tb.view().seats[1], null);
  assert.ok(tb.view().seats[0]);
});

test('остановка сервера: ставки до расчёта возвращаются; удаление игрока', () => {
  const { tb, a, b, step, store } = setup();
  tb.sit(a, 0);
  tb.sit(b, 1);
  tb.bet(a, 100);
  tb.bet(b, 200);
  step();
  tb.refundAll();
  assert.equal(a.balance, 1000);
  assert.equal(b.balance, 1000);
  assert.equal(store.capital(a), 1000);
  assert.equal(tb.view().seats.filter(Boolean).length, 0);

  tb.sit(a, 0);
  tb.sit(b, 1);
  tb._stack(['Ts', 'Th', '7c', '9d', '9h', 'Td']);
  tb.bet(a, 100);
  tb.bet(b, 100);
  step();
  tb.forget(a.id);
  let v = tb.view();
  assert.equal(v.seats[0], null);
  assert.equal(v.turn, 1, 'ход ушёл дальше');
  tb.act(b, 'stand');
  v = step();
  assert.equal(seatOf(v, b).hands[0].result, 'win');
});
