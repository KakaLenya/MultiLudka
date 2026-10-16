const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const {
  createHoldem, makeDeck, shuffle, evaluate5, bestHand, compareHands, HAND,
  START_DELAY_MS, TURN_MS, SHOWDOWN_MS,
} = require('../server/holdem');

const h = (s) => s.split(' ');
const ev = (s) => evaluate5(h(s));
const cmp = (a, b) => Math.sign(compareHands(ev(a), ev(b)));

// ---------- Комбинации ----------

test('колода: 52 разные карты, перемешивание их не теряет', () => {
  const d = makeDeck();
  assert.equal(new Set(d).size, 52);
  const s = shuffle([...d]);
  assert.deepEqual([...s].sort(), [...d].sort());
});

test('все комбинации распознаются', () => {
  assert.equal(ev('As Ks Qs Js Ts').rank, HAND.STRAIGHT_FLUSH);
  assert.equal(ev('9h 9d 9s 9c 2d').rank, HAND.QUADS);
  assert.equal(ev('Kh Kd Ks 4c 4d').rank, HAND.FULL_HOUSE);
  assert.equal(ev('2h 7h 9h Jh Ah').rank, HAND.FLUSH);
  assert.equal(ev('5d 6c 7h 8s 9d').rank, HAND.STRAIGHT);
  assert.equal(ev('Ah 2c 3d 4s 5h').rank, HAND.STRAIGHT, 'колесо A-5');
  assert.equal(ev('Qh Qd Qs 7c 2d').rank, HAND.TRIPS);
  assert.equal(ev('Jh Jd 4s 4c Ad').rank, HAND.TWO_PAIR);
  assert.equal(ev('Th Td 8s 4c 2d').rank, HAND.PAIR);
  assert.equal(ev('Ah Jd 8s 4c 2d').rank, HAND.HIGH);
  assert.equal(ev('Qh Kd As 2c 3d').rank, HAND.HIGH, 'стрит через туз не заворачивает');
});

test('сравнение и кикеры', () => {
  assert.equal(cmp('2h 3h 4h 5h 6h', 'Ah Ad Ac As Kd'), 1, 'стрит-флеш бьёт каре');
  assert.equal(cmp('6d 7c 8h 9s Td', 'Ah 2c 3d 4s 5h'), 1, 'колесо — самый младший стрит');
  assert.equal(cmp('Ah Kh 2h 3h 5h', 'Ad Kd 2d 3d 4d'), 1, 'флеш по кикеру');
  assert.equal(cmp('Kh Kd Ks 2c 2d', 'Qh Qd Qs Ac Ad'), 1, 'фулл-хаус по тройке');
  assert.equal(cmp('Jh Jd 4s 4c Ad', 'Jc Js 4h 4d Kd'), 1, 'две пары по кикеру');
  assert.equal(cmp('Th Td As 4c 2d', 'Tc Ts Kh Qc Jd'), 1, 'пара по кикеру');
  assert.equal(cmp('Ah Jd 8s 4c 2d', 'Ad Jc 8h 4s 2c'), 0, 'равные руки');
});

test('лучшие 5 из 7', () => {
  const r = bestHand(h('As Ks Qs Js 2d 3c Ts'));
  assert.equal(r.name, 'Роял-флеш');
  assert.equal(bestHand(h('2h 2d 2c 9s 9d 9c Ah')).name, 'Фулл-хаус');
  assert.deepEqual(bestHand(h('2h 2d 2c 9s 9d 9c Ah')).tiebreakers, [9, 2]);
  assert.equal(bestHand(h('Ah Kd 7h 6h 5h 4h 3h')).name, 'Стрит-флеш');
  assert.equal(bestHand(h('Ah Kd 7h 6h 5h 4h 3c')).name, 'Флеш', 'стрит есть, но тройка не червовая');
});

// ---------- Стол ----------

// Колода: сначала нужные карты по порядку раздачи, дальше всё остальное.
function deckOf(first) {
  const cards = h(first);
  return () => [...cards, ...makeDeck().filter((c) => !cards.includes(c))];
}

function setup(names, deckFirst, buyIns) {
  const clock = { t: 0 };
  const store = createStore();
  const players = names.map((n) => store.register(n).player);
  const events = [];
  const table = createHoldem({
    store, now: () => clock.t, deckFactory: deckFirst ? deckOf(deckFirst) : undefined, onEvent: (e) => events.push(e),
  });
  store.addReserver(table.reserved);
  players.forEach((p, i) => assert.ok(table.join(p, buyIns ? buyIns[i] : 1000).ok));
  const wait = (ms) => { clock.t += ms; table.tick(); return table.view(null); };
  const total = () => players.reduce((s, p) => s + store.capital(p), 0);
  return { store, table, players, wait, total, clock, events };
}

const ok = (r) => assert.ok(r.ok, r.error);
const err = (r, re) => assert.match(r.error || '', re);

test('один на один: дилер на малом блайнде ходит первым префлоп, после флопа второй', () => {
  // раздача начинается с игрока после дилера: дилер 0 (Аня), значит первые карты Боре
  const { table, players: [a, b], wait } = setup(['Аня', 'Боря'], 'Kd Kc Ah Ad 2c 7d 9h Js 3s');
  let v = wait(START_DELAY_MS);
  assert.equal(v.phase, 'preflop');
  assert.equal(v.dealer, 0);
  assert.equal(v.sb, 0);
  assert.equal(v.bb, 1);
  assert.equal(v.pot, 15);
  assert.equal(v.turn, 0, 'префлоп первым ходит дилер (малый блайнд)');
  assert.deepEqual(table.view(a).you.hole, ['Ah', 'Ad']);
  assert.deepEqual(table.view(b).you.hole, ['Kd', 'Kc']);
  ok(table.act(a, 'call'));
  assert.equal(table.view(null).turn, 1, 'у большого блайнда право хода (опция)');
  ok(table.act(b, 'check'));
  v = table.view(null);
  assert.equal(v.phase, 'flop');
  assert.deepEqual(v.board, ['2c', '7d', '9h']);
  assert.equal(v.turn, 1, 'после флопа первым ходит не-дилер');
});

test('полная раздача на троих: порядок, рейзы, вскрытие, фишки сходятся', () => {
  // дилер 0, SB 1 (Боря), BB 2 (Вика). Карты: Боря, Вика, Аня. Борд 2c 7d 9h Js 3s.
  const { table, players: [a, b, c], total, wait, events } = setup(
    ['Аня', 'Боря', 'Вика'], 'Qh Qd 9c 9s Ah Kh 2c 7d 9h Js 3s',
  );
  const start = total();
  let v = wait(START_DELAY_MS);
  assert.equal(v.sb, 1);
  assert.equal(v.bb, 2);
  assert.equal(v.turn, 0, 'три игрока: первым ходит дилер (после большого блайнда)');
  err(table.act(b, 'call'), /не твой ход/);
  err(table.act(a, 'raise', 15), /Минимальное повышение: до 20/);
  ok(table.act(a, 'raise', 30));
  ok(table.act(b, 'call'));
  ok(table.act(c, 'raise', 80));          // повышение на 50
  err(table.act(a, 'raise', 100), /до 130/);
  ok(table.act(a, 'call'));
  ok(table.act(b, 'fold'));
  v = table.view(null);
  assert.equal(v.phase, 'flop');
  assert.equal(v.pot, 30 + 80 + 80);
  assert.equal(v.turn, 2, 'после флопа первым ходит первый живой после дилера');
  ok(table.act(c, 'check'));
  ok(table.act(a, 'raise', 100));         // бет
  ok(table.act(c, 'call'));
  ok(table.act(c, 'check'));              // тёрн
  ok(table.act(a, 'check'));
  ok(table.act(c, 'check'));              // ривер
  ok(table.act(a, 'check'));
  v = table.view(null);
  assert.equal(v.phase, 'showdown');
  // Вика: сет девяток (9c 9s + 9h) бьёт туза Ани
  assert.deepEqual(v.result.winners.map((w) => [w.name, w.won, w.hand]), [['Вика', 390, 'Сет']]);
  assert.deepEqual(v.result.hands.map((x) => x.name).sort(), ['Аня', 'Вика']);
  assert.equal(total(), start, 'фишки не появились и не пропали');
  assert.deepEqual(events.map((e) => `${e.kind}:${e.player.name}:${e.amount}`).sort(), ['lose:Аня:180', 'win:Вика:210']);
  // кнопка переходит
  v = wait(SHOWDOWN_MS);
  v = wait(START_DELAY_MS);
  assert.equal(v.dealer, 1);
});

test('олл-ин и побочный банк: короткий стек выигрывает только основной банк', () => {
  // дилер 0 Аня (100), SB 1 Боря (1000), BB 2 Вика (1000). Карты: Боря, Вика, Аня.
  const { table, players: [a, b, c], total, wait } = setup(
    ['Аня', 'Боря', 'Вика'], 'Kh Kd Qh Qd Ah Ad 2c 7d 9h Js 3s', [100, 1000, 1000],
  );
  const start = total();
  wait(START_DELAY_MS);
  ok(table.act(a, 'allin'));              // Аня 100
  ok(table.act(b, 'raise', 300));
  ok(table.act(c, 'call'));
  ok(table.act(b, 'raise', 100));         // флоп: бет
  ok(table.act(c, 'call'));
  ok(table.act(b, 'check'));
  ok(table.act(c, 'check'));
  ok(table.act(b, 'check'));
  ok(table.act(c, 'check'));
  const v = table.view(null);
  assert.equal(v.phase, 'showdown');
  const won = Object.fromEntries(v.result.winners.map((w) => [w.name, w.won]));
  // основной банк 300 (по 100 с троих) — Аня с тузами; побочный 600 (по 300 сверху с Бори и Вики) — Боря с королями
  assert.equal(won['Аня'], 300);
  assert.equal(won['Боря'], 600);
  assert.equal(table.view(a).seats[0].stack, 300, 'у Ани в стеке ровно основной банк');
  assert.equal(total(), start);
});

test('все в олл-ине: стол докладывается сам до ривера', () => {
  const { table, players: [a, b], wait } = setup(['Аня', 'Боря'], 'Kd Kc Ah Ad 2c 7d 9h Js 3s', [200, 200]);
  wait(START_DELAY_MS);
  ok(table.act(a, 'allin'));
  ok(table.act(b, 'call'));
  const v = table.view(null);
  assert.equal(v.phase, 'showdown');
  assert.deepEqual(v.result.board, ['2c', '7d', '9h', 'Js', '3s']);
  assert.equal(v.result.winners[0].name, 'Аня');
});

test('неуравненная ставка возвращается', () => {
  const { table, players: [a, b], total, wait } = setup(['Аня', 'Боря'], null, [1000, 100]);
  const start = total();
  wait(START_DELAY_MS);
  ok(table.act(a, 'raise', 500));
  ok(table.act(b, 'allin'));              // Боря может только 100
  const v = table.view(null);
  assert.equal(v.phase, 'showdown');
  assert.equal(v.result.pot, 200, 'в банке только уравненное');
  assert.equal(total(), start);
});

test('все сбросили: банк без вскрытия, карты не показываются', () => {
  const { table, players: [a, b, c], total, wait } = setup(['Аня', 'Боря', 'Вика']);
  const start = total();
  wait(START_DELAY_MS);
  ok(table.act(a, 'raise', 40));
  ok(table.act(b, 'fold'));
  ok(table.act(c, 'fold'));
  const v = table.view(null);
  assert.equal(v.result.revealed, false);
  assert.deepEqual(v.result.hands, []);
  // неуравненные 30 из рейза вернулись Ане, банк из уравненного: 5 + 10 + 10
  assert.deepEqual(v.result.winners.map((w) => [w.name, w.won]), [['Аня', 25]]);
  assert.equal(v.seats[0].stack, 1015);
  assert.equal(total(), start);
});

test('таймер: чек, если можно, иначе фолд', () => {
  const { table, players: [a, b, c], wait } = setup(['Аня', 'Боря', 'Вика']);
  wait(START_DELAY_MS);
  wait(TURN_MS);                          // Аня молчит при ставке BB: фолд
  assert.equal(table.view(null).seats[0].folded, true);
  ok(table.act(b, 'call'));
  wait(TURN_MS);                          // Вика (BB) может чекнуть
  assert.equal(table.view(null).phase, 'flop');
  assert.equal(table.view(null).seats[2].lastAction, 'чек (время)');
});

test('чужие карты не видны до вскрытия, свои видны', () => {
  const t = setup(['Аня', 'Боря'], 'Kd Kc Ah Ad');
  t.wait(START_DELAY_MS);
  const asB = JSON.stringify(t.table.view(t.players[1]));
  assert.ok(asB.includes('"Kd"'), 'свои видны');
  assert.ok(!asB.includes('"Ah"'), 'чужие нет');
  assert.ok(!JSON.stringify(t.table.view(null)).includes('"Ah"'), 'зрителю тоже нет');
  assert.ok(JSON.stringify(t.table.adminView()).includes('"Ah"'), 'админ видит');
});

test('уход посреди раздачи: фолд, стек возвращается после раздачи', () => {
  const { table, players: [a, b, c], total, wait } = setup(['Аня', 'Боря', 'Вика']);
  const start = total();
  wait(START_DELAY_MS);
  const r = table.leave(b);               // малый блайнд уходит не в свой ход
  assert.equal(r.pending, true);
  assert.equal(table.view(null).seats[1].folded, true);
  ok(table.act(a, 'fold'));
  wait(SHOWDOWN_MS);
  assert.equal(table.view(null).seats[1], null);
  assert.equal(b.balance, 1000 - 5);
  assert.equal(total(), start);
});

test('админ: подкрутка карманных карт на следующую раздачу', () => {
  const { table, players: [a, b], wait } = setup(['Аня', 'Боря']);
  assert.ok(table.rigHole(b, ['As', 'Ah']).ok);
  assert.ok(table.rigHole(a, ['As']).error);
  assert.ok(table.rigHole(a, ['Xx', 'Ah']).error);
  wait(START_DELAY_MS);
  assert.deepEqual(table.view(b).you.hole, ['As', 'Ah']);
  assert.ok(!table.view(a).you.hole.includes('As'), 'подкрученные карты убраны из колоды');
});

test('остановка сервера возвращает всё', () => {
  const { table, players, total, wait } = setup(['Аня', 'Боря', 'Вика']);
  const start = total();
  wait(START_DELAY_MS);
  ok(table.act(players[0], 'raise', 200));
  table.refundAll();
  assert.deepEqual(players.map((p) => p.balance), [1000, 1000, 1000]);
  assert.equal(total(), start);
});
