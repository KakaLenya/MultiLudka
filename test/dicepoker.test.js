const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const {
  evaluate, compare, createTable, RANK, ANTE, START_DELAY_MS, TURN_MS, REROLL_MS, SHOWDOWN_MS,
} = require('../server/dicepoker');

// ---------- evaluate / compare ----------

const ev = (s) => evaluate([...s].map(Number));
const cmp = (a, b) => Math.sign(compare(ev(a), ev(b)));

test('evaluate: все комбинации', () => {
  assert.equal(ev('44444').rank, RANK.FIVE);
  assert.equal(ev('33363').rank, RANK.FOUR);
  assert.equal(ev('22555').rank, RANK.FULL_HOUSE);
  assert.equal(ev('12345').rank, RANK.STRAIGHT);
  assert.equal(ev('65432').rank, RANK.STRAIGHT);
  assert.equal(ev('41523').rank, RANK.STRAIGHT, 'порядок не важен');
  assert.equal(ev('11124').rank, RANK.THREE);
  assert.equal(ev('22441').rank, RANK.TWO_PAIR);
  assert.equal(ev('66123').rank, RANK.PAIR);
  assert.equal(ev('13456').rank, RANK.HIGH);
  assert.equal(ev('12456').rank, RANK.HIGH);
  assert.equal(ev('12356').rank, RANK.HIGH);
  assert.equal(ev('12346').rank, RANK.HIGH);
});

test('evaluate: имена и тай-брейки', () => {
  assert.deepEqual(ev('33363'), { rank: RANK.FOUR, name: 'Каре', tiebreakers: [3, 6] });
  assert.deepEqual(ev('22555').tiebreakers, [5, 2]);
  assert.deepEqual(ev('22441').tiebreakers, [4, 2, 1]);
  assert.deepEqual(ev('66123').tiebreakers, [6, 3, 2, 1]);
  assert.deepEqual(ev('13456').tiebreakers, [6, 5, 4, 3, 1]);
});

test('evaluate: отклоняет мусор', () => {
  for (const bad of [[1, 2, 3, 4], [1, 2, 3, 4, 7], [0, 1, 2, 3, 4], [1, 2, 3, 4, 5, 6], [1.5, 2, 3, 4, 5], null, '12345']) {
    assert.throws(() => evaluate(bad), TypeError);
  }
});

test('compare: порядок комбинаций', () => {
  const ladder = ['11111', '66665', '66655', '23456', '12345', '66654', '66553', '66543', '65431'];
  // 65431: старшая; каждый следующий слабее предыдущего (большой стрит > малого).
  for (let i = 0; i + 1 < ladder.length; i++) {
    assert.equal(cmp(ladder[i], ladder[i + 1]), 1, `${ladder[i]} > ${ladder[i + 1]}`);
  }
  assert.equal(cmp('11111', '66665'), 1, 'пять единиц сильнее каре шестёрок');
});

test('compare: тай-брейки внутри комбинации', () => {
  assert.equal(cmp('66666', '55555'), 1);
  assert.equal(cmp('66661', '55556'), 1, 'каре по значению, потом кикер');
  assert.equal(cmp('55556', '55551'), 1, 'кикер');
  assert.equal(cmp('33322', '22233'), 1, 'фулл: сначала тройка');
  assert.equal(cmp('22266', '22255'), 1, 'фулл: потом пара');
  assert.equal(cmp('44412', '33365'), 1, 'сет по значению');
  assert.equal(cmp('44463', '44452'), 1, 'сет: кикеры');
  assert.equal(cmp('55331', '44336'), 1, 'две пары: старшая пара');
  assert.equal(cmp('55441', '55331'), 1, 'две пары: младшая пара');
  assert.equal(cmp('55446', '55441'), 1, 'две пары: кикер');
  assert.equal(cmp('22156', '22134'), 1, 'пара: кикеры');
  assert.equal(cmp('13456', '12456'), 1, 'старшая: по значениям');
  assert.equal(cmp('12346', '12356'), -1);
});

test('compare: равные руки', () => {
  assert.equal(cmp('22441', '14242'), 0);
  assert.equal(cmp('12345', '54321'), 0);
  assert.equal(cmp('13456', '65431'), 0);
});

// ---------- Стол ----------

// rolls: строка кубиков, выдаются по порядку. Раздача идёт по местам 0, 1, 2...
function setup(names = ['Аня', 'Боря', 'Вика'], { buyIn = 200 } = {}) {
  const clock = { t: 0 };
  const queue = [];
  const store = createStore();
  const players = names.map((n) => store.register(n).player);
  const table = createTable({
    store,
    now: () => clock.t,
    rollDie: () => {
      if (!queue.length) throw new Error('кончились заготовленные кубики');
      return queue.shift();
    },
  });
  store.addReserver(table.reserved);
  const rolls = (s) => queue.push(...[...s.replace(/\s/g, '')].map(Number));
  const wait = (ms) => { clock.t += ms; table.tick(); };
  for (const p of players) assert.deepEqual(table.join(p, buyIn), { ok: true });
  const total = () => players.reduce((s, p) => s + store.capital(p), 0);
  return { store, table, players, rolls, wait, clock, total };
}

const ok = (r) => assert.ok(r.ok, r.error);
const err = (r, re) => assert.match(r.error || '', re);

test('посадка: бай-ин списывается, капитал не меняется, валидация', () => {
  const { store, table, players: [a] } = setup(['Аня']);
  assert.equal(a.balance, 800);
  assert.equal(store.capital(a), 1000);
  err(table.join(a, 100), /уже за столом/);

  const { table: t2, players: [b] } = setup(['Боря'], { buyIn: 50 });
  for (const bad of [10, 49, 50.5, '100', NaN]) err(t2.leave(b) && t2.join(b, bad), /Бай-ин|Не хватает/);
});

test('полная раздача на троих: анте, ставки, перебросок, вскрытие', () => {
  const { table, players: [a, b, c], rolls, wait, total } = setup();
  const start = total();

  rolls('66612 33445 12345'); // Аня сет, Боря две пары, Вика малый стрит
  wait(START_DELAY_MS);
  let v = table.view(a);
  assert.equal(v.phase, 'bet1');
  assert.equal(v.pot, 3 * ANTE);
  assert.equal(v.dealer, 0);
  assert.equal(v.turn, 1, 'первым ходит следующий после дилера');

  // Свои кубики видны, чужие нет.
  assert.deepEqual(v.you.dice, [6, 6, 6, 1, 2]);
  assert.ok(v.seats.every((s) => s === null || !('dice' in s)));
  assert.ok(!JSON.stringify(table.view(a)).includes('3,3,4,4,5'));
  assert.ok(!JSON.stringify(table.view(null)).includes('6,6,6'));

  err(table.act(a, 'check'), /не твой ход/);
  ok(table.act(b, 'check'));
  ok(table.act(c, 'bet', 20));
  err(table.act(a, 'check'), /уравнять 20/);
  ok(table.act(a, 'raise', 10));             // Аня: 30
  ok(table.act(b, 'call'));                  // Боря: 30
  ok(table.act(c, 'call'));                  // Вика: 30, круг закрыт
  v = table.view(a);
  assert.equal(v.phase, 'reroll');
  assert.equal(v.pot, 3 * ANTE + 90);

  rolls('66 5 6');                            // Аня 2 кубика, Боря 1, Вика 1
  ok(table.reroll(a, [true, true, true, false, false]));
  err(table.reroll(a, [true, true, true, true, true]), /уже сделан/);
  ok(table.reroll(b, [true, true, true, true, false]));
  err(table.reroll(c, [true, true]), /5 значений/);
  ok(table.reroll(c, [false, true, true, true, true]));
  v = table.view(a);
  assert.equal(v.phase, 'bet2');
  assert.deepEqual(v.you.dice, [6, 6, 6, 6, 6]);
  assert.deepEqual(v.seats.slice(0, 3).map((s) => s.rerolled), [2, 1, 1]);

  ok(table.act(b, 'check'));
  ok(table.act(c, 'check'));
  ok(table.act(a, 'bet', 50));
  ok(table.act(b, 'fold'));
  ok(table.act(c, 'call'));

  v = table.view(null);
  assert.equal(v.phase, 'showdown');
  assert.equal(v.result.revealed, true);
  assert.deepEqual(v.result.winners, [{ seat: 0, name: 'Аня', won: 30 + 90 + 100 }]);
  assert.deepEqual(v.result.hands.map((h) => h.hand), ['Покер', 'Стрит']);
  assert.ok(!v.result.hands.some((h) => h.name === 'Боря'), 'сбросивший не вскрывается');

  assert.equal(v.seats[0].stack, 200 - 90 + 220);
  assert.equal(v.seats[1].stack, 200 - 40);
  assert.equal(v.seats[2].stack, 200 - 90);
  assert.equal(total(), start, 'фишки не появились и не пропали');

  // Следующая раздача: кнопка сдвигается.
  rolls('11111 22222 33333');
  wait(SHOWDOWN_MS);
  wait(START_DELAY_MS);
  v = table.view(a);
  assert.equal(v.phase, 'bet1');
  assert.equal(v.dealer, 1);
  assert.equal(v.turn, 2);
});

test('все сбросили: банк без вскрытия', () => {
  const { table, players: [a, b, c], rolls, wait, total } = setup();
  const start = total();
  rolls('11111 22222 33333');
  wait(START_DELAY_MS);
  ok(table.act(b, 'bet', 10));
  ok(table.act(c, 'fold'));
  ok(table.act(a, 'fold'));
  const v = table.view(null);
  assert.equal(v.phase, 'showdown');
  assert.equal(v.result.revealed, false);
  assert.deepEqual(v.result.hands, []);
  assert.deepEqual(v.result.winners, [{ seat: 1, name: 'Боря', won: 40 }]);
  assert.equal(total(), start);
});

test('ничья: банк делится, остаток первому после дилера', () => {
  const { table, players: [a, b, c], rolls, wait, total } = setup();
  const start = total();
  rolls('22441 14242 66543');
  wait(START_DELAY_MS);
  ok(table.act(b, 'bet', 15));
  ok(table.act(c, 'call'));
  ok(table.act(a, 'call'));                  // банк 30 + 45 = 75
  for (const p of [a, b, c]) ok(table.reroll(p, [true, true, true, true, true]));
  ok(table.act(b, 'check'));
  ok(table.act(c, 'check'));
  ok(table.act(a, 'check'));
  const v = table.view(null);
  // Вика: старшая. Аня и Боря: две пары 4-2 с кикером 1. 75 / 2 = 37 + остаток 1 Боре (место 1 после дилера 0).
  assert.deepEqual(v.result.winners, [{ seat: 1, name: 'Боря', won: 38 }, { seat: 0, name: 'Аня', won: 37 }]);
  assert.equal(total(), start);
});

test('лимит ставки по наименьшему стеку и лимит повышений', () => {
  const { table, players: [a, b], rolls, wait, store } = setup(['Аня', 'Боря'], { buyIn: 1000 });
  table.leave(b);
  ok(table.join(b, 60));                      // у Бори всего 60
  rolls('11111 22222');
  wait(START_DELAY_MS);
  // дилер Аня (место 0), первым ходит Боря
  err(table.act(b, 'bet', 60), /Максимум 50/);
  ok(table.act(b, 'bet', 10));
  ok(table.act(a, 'raise', 10));
  ok(table.act(b, 'raise', 10));
  err(table.act(a, 'raise', 30), /Максимум 20/);
  ok(table.act(a, 'raise', 20));               // третье повышение, все 60 Бори в деле
  const v = table.view(b);
  assert.equal(v.you.canRaise, false);
  err(table.act(b, 'raise', 10), /Не больше 3|Повышать некуда/);
  ok(table.act(b, 'call'));
  assert.equal(table.view(b).seats[1].stack, 0);
  assert.equal(store.capital(b), 1000);
});

test('таймер хода: чек, если можно, иначе фолд; перебросок по таймеру', () => {
  const { table, players: [a, b, c], rolls, wait } = setup();
  rolls('11111 22222 33333');
  wait(START_DELAY_MS);
  wait(TURN_MS);                               // Боря молчит: авто-чек
  assert.equal(table.view(null).turn, 2);
  ok(table.act(c, 'bet', 10));
  wait(TURN_MS);                               // Аня молчит при ставке: авто-фолд
  assert.equal(table.view(null).seats[0].folded, true);
  ok(table.act(b, 'call'));
  assert.equal(table.view(null).phase, 'reroll');
  rolls('');
  wait(REROLL_MS);                             // никто не выбрал: ничего не перебрасывается
  const v = table.view(b);
  assert.equal(v.phase, 'bet2');
  assert.deepEqual(v.you.dice, [2, 2, 2, 2, 2]);
});

test('уход посреди раздачи: фолд, стек возвращается после раздачи', () => {
  const { table, players: [a, b, c], rolls, wait, store, total } = setup();
  const start = total();
  rolls('11111 22222 33333');
  wait(START_DELAY_MS);
  ok(table.act(b, 'bet', 20));
  const r = table.leave(c);                   // не её ход, но уходит
  assert.equal(r.pending, true);
  assert.equal(table.view(null).seats[2].folded, true);
  assert.equal(c.balance, 800, 'стек пока за столом');
  ok(table.act(a, 'fold'));                   // остался один Боря
  assert.equal(table.view(null).phase, 'showdown');
  wait(SHOWDOWN_MS);
  assert.equal(table.view(null).seats[2], null);
  assert.equal(c.balance, 1000 - ANTE);
  assert.equal(store.capital(c), 990);
  assert.equal(total(), start);
});

test('отключение: не фолдит сразу, после раздачи встаёт', () => {
  const { table, players: [a, b, c], rolls, wait } = setup();
  rolls('11111 22222 33333');
  wait(START_DELAY_MS);
  table.setConnected(b, false);
  assert.equal(table.view(null).seats[1].folded, false);
  wait(TURN_MS);                              // ход Бори истёк: чек
  ok(table.act(c, 'check'));
  ok(table.act(a, 'check'));
  for (const p of [a, c]) ok(table.reroll(p, [true, true, true, true, true]));
  wait(REROLL_MS);
  wait(TURN_MS);
  ok(table.act(c, 'check'));
  ok(table.act(a, 'check'));
  assert.equal(table.view(null).phase, 'showdown');
  wait(SHOWDOWN_MS);
  assert.equal(table.view(null).seats[1], null);
  assert.ok(b.balance > 800);
});

test('остановка сервера возвращает всё', () => {
  const { table, players, rolls, wait, total } = setup();
  const start = total();
  rolls('11111 22222 33333');
  wait(START_DELAY_MS);
  ok(table.act(players[1], 'bet', 30));
  table.refundAll();
  assert.deepEqual(players.map((p) => p.balance), [1000, 1000, 1000]);
  assert.equal(total(), start);
});

test('мало игроков: раздача не стартует, отсчёт отменяется', () => {
  const { table, players: [a, b], wait } = setup(['Аня', 'Боря']);
  assert.equal(table.view(null).phase, 'starting');
  ok(table.leave(b));
  assert.equal(table.view(null).phase, 'waiting');
  wait(START_DELAY_MS);
  assert.equal(table.view(null).phase, 'waiting');
  assert.equal(a.balance, 800);
});
