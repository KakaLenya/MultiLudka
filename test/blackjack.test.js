const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const { createBlackjack, handValue, isNatural, naturalPayout, SHOE_SIZE, RESHUFFLE_AT } = require('../server/blackjack');

function setup(opts = {}) {
  const store = createStore();
  const a = store.register('Аня').player;
  const events = [];
  const feeds = [];
  const bj = createBlackjack({ store, onEvent: (e) => events.push(e), onFeed: (f) => feeds.push(f), schedule: (fn) => fn(), ...opts });
  store.addReserver(bj.reserved);
  return { store, bj, a, events, feeds };
}

// Карты кладутся на верх шуза в порядке раздачи: игрок, дилер (открытая), игрок, дилер (закрытая), дальше добор.
function deal(bj, a, bet, cards) {
  bj._stack(cards);
  return bj.start(a, bet);
}

test('очки: тузы считаются за 11, пока нет перебора', () => {
  assert.deepEqual(handValue(['As', 'Kd']), { total: 21, soft: true });
  assert.deepEqual(handValue(['As', '6d']), { total: 17, soft: true });
  assert.deepEqual(handValue(['As', '6d', 'Kc']), { total: 17, soft: false });
  assert.deepEqual(handValue(['As', 'Ah']), { total: 12, soft: true });
  assert.deepEqual(handValue(['As', 'Ah', 'Ad', 'Ac']), { total: 14, soft: true });
  assert.deepEqual(handValue(['As', 'Ah', 'Kd', 'Qc']), { total: 22, soft: false });
  assert.deepEqual(handValue(['9s', '7h', '5d']), { total: 21, soft: false });
  assert.ok(isNatural(['Ts', 'Ah']));
  assert.ok(!isNatural(['7s', '7h', '7d']));
  assert.equal(naturalPayout(100), 250);
  assert.equal(naturalPayout(5), 12);   // 3:2 вниз до целого
});

test('блэкджек платит 3:2 сразу; ставка в игре до конца раздачи', () => {
  const { bj, a, store, events } = setup();
  const s = deal(bj, a, 100, ['As', '9d', 'Kh', '7c']).state;
  assert.equal(s.status, 'done');
  assert.equal(s.hands[0].result, 'blackjack');
  assert.equal(s.payout, 250);
  assert.equal(a.balance, 1150);
  assert.equal(store.capital(a), 1150);
  assert.deepEqual(s.dealer.cards, ['9d', '7c'], 'после раздачи закрытая карта открыта');
  assert.equal(events.at(-1).kind, 'win');
  assert.equal(events.at(-1).amount, 150);
  assert.equal(events.at(-1).meta.natural, true);
});

test('выигрыш 1:1, проигрыш, ничья; закрытая карта скрыта до конца', () => {
  const { bj, a, store } = setup();
  let s = deal(bj, a, 100, ['Ts', '9d', 'Qh', '7c']).state;    // 20 против 16 → дилер берёт
  assert.equal(s.active, true);
  assert.deepEqual(s.dealer.cards, ['9d', null]);
  assert.equal(s.dealer.total, 9);
  assert.equal(a.balance, 900);
  assert.equal(store.capital(a), 1000, 'ставка в игре, капитал тот же');
  bj._stack(['8s']);                                              // дилер 16 + 8 = 24, перебор
  s = bj.stand(a).state;
  assert.equal(s.hands[0].result, 'win');
  assert.equal(a.balance, 1100);

  s = deal(bj, a, 100, ['Ts', 'Td', '7h', '9c']).state;           // 17 против 19
  s = bj.stand(a).state;
  assert.equal(s.hands[0].result, 'lose');
  assert.equal(a.balance, 1000);

  s = deal(bj, a, 100, ['Ts', 'Td', '8h', '8c']).state;           // 18 против 18
  s = bj.stand(a).state;
  assert.equal(s.hands[0].result, 'push');
  assert.equal(s.net, 0);
  assert.equal(a.balance, 1000);
});

test('дилер добирает до 17 и стоит на мягких 17', () => {
  const { bj, a } = setup();
  deal(bj, a, 10, ['Ts', '2d', 'Qh', '3c']);
  bj._stack(['4s', '5h', '3d']);                     // 2+3+4+5 = 14 → ещё 3 = 17
  let s = bj.stand(a).state;
  assert.deepEqual(s.dealer.cards, ['2d', '3c', '4s', '5h', '3d']);
  assert.equal(s.dealer.total, 17);
  assert.equal(s.hands[0].result, 'win');

  deal(bj, a, 10, ['Ts', '6d', '9h', 'Ac']);         // мягкие 17 у дилера — стоит
  s = bj.stand(a).state;
  assert.deepEqual(s.dealer.cards, ['6d', 'Ac']);
  assert.equal(s.hands[0].result, 'win');            // 19 против 17
});

test('блэкджек у дилера: проверка сразу, у игрока тоже — ничья', () => {
  const { bj, a } = setup();
  let s = deal(bj, a, 100, ['Ts', 'Ad', '9h', 'Kc']).state;
  assert.equal(s.status, 'done');
  assert.equal(s.hands[0].result, 'lose');
  assert.equal(a.balance, 900);
  s = deal(bj, a, 100, ['As', 'Kd', 'Th', 'Ac']).state;
  assert.equal(s.hands[0].result, 'push');
  assert.equal(a.balance, 900);
});

test('ещё: перебор сжигает ставку, дилер не добирает; 21 — рука закрывается сама', () => {
  const { bj, a } = setup();
  deal(bj, a, 100, ['Ts', '9d', '5h', '7c']);
  bj._stack(['Kd']);
  let s = bj.hit(a).state;
  assert.equal(s.hands[0].result, 'bust');
  assert.deepEqual(s.dealer.cards, ['9d', '7c'], 'все руки перебрали — дилер не берёт');
  assert.equal(a.balance, 900);

  deal(bj, a, 100, ['5s', '9d', '6h', '9c']);
  bj._stack(['Kd']);                                  // 5+6+10 = 21 → дилер ходит сразу
  bj._stack([]);
  s = bj.hit(a).state;
  assert.equal(s.status, 'done');
  assert.equal(s.hands[0].total, 21);
  assert.equal(s.hands[0].result, 'win');
});

test('удвоение: вторая ставка, одна карта, только на первых двух картах', () => {
  const { bj, a, store, events } = setup();
  deal(bj, a, 100, ['6s', '9d', '5h', '7c']);
  assert.equal(bj.view(a).actions.double, true);
  bj._stack(['Td', 'Ks']);                            // игроку 21, дилер 16 + 10 = перебор
  const s = bj.double(a).state;
  assert.equal(s.hands[0].bet, 200);
  assert.equal(s.hands[0].doubled, true);
  assert.equal(s.hands[0].cards.length, 3);
  assert.equal(s.hands[0].result, 'win');
  assert.equal(a.balance, 1200);
  assert.equal(store.capital(a), 1200);
  assert.equal(events.at(-1).meta.doubledWin, true);

  deal(bj, a, 100, ['2s', '9d', '3h', '7c']);
  bj._stack(['4d']);
  bj.hit(a);
  assert.match(bj.double(a).error, /первых двух/);
  assert.equal(bj.view(a).actions.double, false);
});

test('сплит: две руки по ставке, без пересплита; тузы получают по одной карте', () => {
  const { bj, a, store, events } = setup();
  deal(bj, a, 100, ['8s', '6d', '8h', 'Tc']);
  assert.equal(bj.view(a).actions.split, true);
  bj._stack(['3d', '8c']);                            // первой руке 8+3, второй 8+8 — снова пара
  let s = bj.split(a).state;
  assert.equal(s.hands.length, 2);
  assert.equal(a.balance, 800);
  assert.equal(store.capital(a), 1000);
  assert.deepEqual(s.hands.map((h) => h.cards), [['8s', '3d'], ['8h', '8c']]);
  assert.equal(s.cur, 0);
  assert.equal(s.actions.split, false, 'второй раз не делится');
  assert.match(bj.split(a).error, /один раз/);
  bj._stack(['Kd']);                                  // 8+3+10 = 21: первая рука закрылась сама
  s = bj.hit(a).state;
  assert.equal(s.cur, 1);
  assert.equal(s.actions.double, true, 'удвоение после сплита можно');
  bj._stack(['9s']);                                  // дилер 16 + 9 — перебор
  s = bj.stand(a).state;
  assert.deepEqual(s.hands.map((h) => h.result), ['win', 'win']);
  assert.equal(a.balance, 1200);
  assert.equal(events.at(-1).meta.splitWin, true);

  deal(bj, a, 100, ['As', '6d', 'Ah', 'Tc']);
  bj._stack(['Kd', '5c', '3s']);                      // тузы: по карте и всё, 21 после сплита — не блэкджек
  s = bj.split(a).state;
  assert.equal(s.status, 'done');
  assert.deepEqual(s.hands.map((h) => h.total), [21, 16]);
  assert.equal(s.dealer.total, 19);
  assert.deepEqual(s.hands.map((h) => h.result), ['win', 'lose']);
  assert.equal(s.payout, 200, '21 после сплита платит 1:1');
});

test('проверки ввода и денег', () => {
  const { bj, a } = setup();
  for (const amt of [0, -5, 1.5, '100', 5000]) assert.ok(bj.start(a, amt).error, String(amt));
  assert.match(bj.hit(a).error, /не начата/);
  deal(bj, a, 600, ['8s', '6d', '8h', 'Tc']);
  assert.match(bj.start(a, 10).error, /доиграй/);
  assert.equal(bj.view(a).actions.split, false, 'на сплит не хватает');
  assert.match(bj.split(a).error, /Не хватает/);
  assert.match(bj.double(a).error, /Не хватает/);
});

test('подкрутка: blackjack, win, lose — и сбрасывается после раздачи', () => {
  const { bj, a } = setup();
  a.balance = 1e9;
  assert.ok(bj.rig('maybe').error);
  for (let i = 0; i < 30; i++) {
    bj.rig('blackjack');
    const s = bj.start(a, 100).state;
    assert.equal(s.hands[0].result, 'blackjack');
    assert.equal(s.payout, 250);
  }
  for (let i = 0; i < 60; i++) {
    bj.rig('win');
    let s = bj.start(a, 100).state;
    // Игрок берёт до 15 — и всё равно не перебирает и выигрывает.
    while (s.active && s.hands[0].total < 15) s = bj.hit(a).state;
    if (s.active) s = bj.stand(a).state;
    assert.ok(['win', 'blackjack'].includes(s.hands[0].result), `win: ${JSON.stringify(s.hands[0])} vs ${JSON.stringify(s.dealer)}`);
    assert.ok(s.dealer.cards.length === 2 || s.dealer.total >= 17);
  }
  for (let i = 0; i < 60; i++) {
    bj.rig('lose');
    let s = bj.start(a, 100).state;
    if (s.active) s = bj.stand(a).state;
    assert.ok(['lose', 'bust'].includes(s.hands[0].result) || (s.hands[0].result === 'push' && s.hands[0].total === 21), `lose: ${JSON.stringify(s.hands[0])} vs ${JSON.stringify(s.dealer)}`);
    assert.notEqual(s.hands[0].result, 'blackjack');
  }
  assert.equal(bj.adminState().rigged, null);
});

test('везение: раздача в пользу игрока', () => {
  const { bj, a } = setup({ lucky: () => true });
  a.balance = 1e9;
  for (let i = 0; i < 40; i++) {
    let s = bj.start(a, 10).state;
    if (s.active) s = bj.stand(a).state;
    assert.ok(['win', 'blackjack'].includes(s.hands[0].result), JSON.stringify(s));
  }
});

test('шуз: 6 колод, перемешивается, когда меньше четверти', () => {
  const { bj, a } = setup();
  a.balance = 1e9;
  assert.equal(SHOE_SIZE, 312);
  assert.equal(bj._shoeSize(), 312);
  let min = Infinity;
  let reshuffled = false;
  for (let i = 0; i < 200; i++) {
    let s = bj.start(a, 1).state;
    if (s.active) s = bj.stand(a).state;
    if (s.shoe.left > min) reshuffled = true;
    min = Math.min(min, s.shoe.left);
    assert.ok(s.shoe.left >= RESHUFFLE_AT - 20 || s.shoe.left === SHOE_SIZE);
  }
  assert.ok(reshuffled, 'шуз перемешался');
});

test('отдача честной игры по простой стратегии — около 99%', () => {
  const { bj, a } = setup();
  a.balance = 1e12;
  let staked = 0;
  let paid = 0;
  for (let i = 0; i < 20000; i++) {
    let s = bj.start(a, 100).state;
    while (s.active) {
      const h = s.hands[s.cur];
      const up = s.dealer.total;
      if (s.actions.split && ['A', '8'].includes(h.cards[0][0])) s = bj.split(a).state;
      else if (s.actions.double && h.total === 11) s = bj.double(a).state;
      else if (h.total < 12 || (h.total < 17 && up >= 7) || (h.soft && h.total < 18)) s = bj.hit(a).state;
      else s = bj.stand(a).state;
    }
    staked += s.hands.reduce((x, h) => x + h.bet, 0);
    paid += s.payout;
  }
  const rtp = paid / staked;
  assert.ok(rtp > 0.95 && rtp < 1.03, `отдача ${(rtp * 100).toFixed(1)}%`);
});

test('лента, остановка сервера и удаление игрока', () => {
  const { bj, a, store, feeds } = setup();
  const b = store.register('Боря').player;
  deal(bj, a, 100, ['Ts', '9d', 'Qh', '7c']);
  deal(bj, b, 50, ['5s', '9d', '6h', '7c']);
  assert.equal(store.capital(a), 1000);
  bj._stack(['Kd']);                                  // дилер у Ани: 16 + 10 — перебор
  bj.settleAll();
  assert.equal(bj.view(a).status, 'done');
  assert.equal(bj.view(b).status, 'done');
  assert.equal(a.balance, 1100);
  assert.equal(feeds.at(-1).length, 2);
  assert.equal(feeds.at(-1)[1].name, 'Аня');
  bj.forget(a.id);
  assert.equal(bj.view(a).active, false);
  assert.equal(bj.view(a).status, undefined);
});

test('итог объявляется после анимации: до того ставка в игре, новая раздача объявляет сразу', () => {
  const timers = [];
  const { bj, a, store, events, feeds } = setup({ schedule: (fn, ms) => timers.push({ fn, ms }) });
  const s = deal(bj, a, 100, ['As', '9d', 'Kh', '7c']).state;
  assert.equal(s.hands[0].result, 'blackjack', 'игрок свой итог видит сразу');
  assert.equal(a.balance, 900, 'выплата ждёт конца анимации');
  assert.equal(store.capital(a), 1000);
  assert.equal(events.length, 0);
  assert.equal(feeds.length, 0);
  assert.ok(timers[0].ms >= 2000, 'раздача + переворот');
  timers[0].fn();
  assert.equal(a.balance, 1150);
  assert.equal(store.capital(a), 1150);
  assert.equal(events.length, 1);
  timers[0].fn();
  assert.equal(a.balance, 1150, 'дважды не платим');

  deal(bj, a, 100, ['Ts', '9d', 'Qh', '7c']);
  bj._stack(['8s']);
  bj.stand(a);
  assert.equal(a.balance, 1050);
  deal(bj, a, 100, ['Ts', '9d', 'Qh', '7c']);
  assert.equal(a.balance, 1150 + 100 - 100, 'прошлый выигрыш выплачен до новой ставки');
  assert.equal(events.length, 2);
  bj.settleAll();
  assert.equal(events.length, 3);
});

test('сикс-севен: шестёрка и сразу семёрка в руке — пасхалка один раз на игрока', () => {
  const granted = [];
  const seen = new Set();
  const sixSeven = { seen: (p) => seen.has(p.id), grant: (p) => { seen.add(p.id); granted.push(p.name); } };
  const { bj, a, store } = setup({ sixSeven });
  a.balance = 1e6;
  // 7 затем 6 — нет; 6, X, 7 — нет.
  let s = deal(bj, a, 10, ['7s', '9d', '6h', 'Tc']).state;
  assert.equal(s.sixSeven, null);
  bj.stand(a);
  deal(bj, a, 10, ['6s', '9d', '2h', 'Tc']);
  bj._stack(['7d']);
  s = bj.hit(a).state;
  assert.deepEqual(s.hands[0].cards, ['6s', '2h', '7d']);
  assert.equal(s.sixSeven, null);
  bj.stand(a);
  // 6 и сразу 7 после «ещё» — да, рука и номер карты для анимации.
  deal(bj, a, 10, ['2s', '9d', '6h', 'Tc']);
  bj._stack(['7c']);
  s = bj.hit(a).state;
  assert.deepEqual(s.sixSeven, { hand: 0, card: 2 });
  assert.deepEqual(granted, ['Аня']);
  bj.stand(a);
  // Второй раз — уже нет, даже с раздачи.
  s = deal(bj, a, 10, ['6s', '9d', '7h', 'Tc']).state;
  assert.equal(s.sixSeven, null);
  assert.equal(granted.length, 1);
  bj.stand(a);
  // Другому игроку — с раздачи и после сплита.
  const b = store.register('Боря').player;
  s = deal(bj, b, 10, ['6s', '9d', '7h', 'Tc']).state;
  assert.deepEqual(s.sixSeven, { hand: 0, card: 1 });
  bj.stand(b);
  const c = store.register('Вика').player;
  deal(bj, c, 10, ['6s', '9d', '6h', 'Tc']);
  bj._stack(['2d', '7s']);                            // первой руке 6+2, второй 6+7
  s = bj.split(c).state;
  assert.deepEqual(s.sixSeven, { hand: 1, card: 1 });
  assert.deepEqual(granted, ['Аня', 'Боря', 'Вика']);
});

test('сикс-севен: пока анимация не доиграла, второй раз не показываем', () => {
  const timers = [];
  const seen = new Set();
  const { bj, a } = setup({ schedule: (fn, ms) => timers.push({ fn, ms }), sixSeven: { seen: (p) => seen.has(p.id), grant: (p) => seen.add(p.id) } });
  a.balance = 1e6;
  let s = deal(bj, a, 10, ['6s', '9d', '7h', 'Tc']).state;
  assert.ok(s.sixSeven);
  bj.stand(a);
  s = deal(bj, a, 10, ['6s', '9d', '7h', 'Tc']).state;
  assert.equal(s.sixSeven, null, 'ачивка ещё не выдана, но пасхалка уже была');
  const grant = timers.find((t) => t.ms >= 2800);
  assert.ok(grant, 'выдача после анимации');
  grant.fn();
  assert.ok(seen.has(a.id));
});

test('подкрутка «сикс-севен»: раздача 6 и 7, пасхалка даже повторно, ачивка один раз, дальше честно', () => {
  const granted = [];
  const seen = new Set();
  const { bj, a } = setup({ sixSeven: { seen: (p) => seen.has(p.id), grant: (p) => { if (!seen.has(p.id)) granted.push(p.name); seen.add(p.id); } } });
  a.balance = 1e6;
  for (let i = 0; i < 30; i++) {
    assert.ok(bj.rig('sixseven').ok);
    let s = bj.start(a, 10).state;
    assert.equal(s.hands[0].cards[0][0], '6');
    assert.equal(s.hands[0].cards[1][0], '7');
    assert.deepEqual(s.sixSeven, { hand: 0, card: 1 }, `раздача ${i + 1}`);
    assert.equal(bj.adminState().rigged, null);
    if (s.active) s = bj.stand(a).state;
  }
  assert.deepEqual(granted, ['Аня'], 'ачивка — только раз');
  // Без подкрутки — снова как обычно: у Ани пасхалка уже была.
  const s = deal(bj, a, 10, ['6s', '9d', '7h', 'Tc']).state;
  assert.equal(s.sixSeven, null);
});
