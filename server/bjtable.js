// Блэкджек за общим столом: пять мест, один дилер на всех, свой шуз из 6 колод.
// Раунд: ставки (таймер с первой ставки, или сразу, когда поставили все сидящие) → раздача → игроки ходят
// по очереди со своим таймером (не успел — «Хватит») → дилер открывает карту и добирает → расчёт.
// Правила как в одиночном блэкджеке (server/blackjack.js): 3:2, дилер стоит на мягких 17, удвоение, один сплит.
// Фазы с анимацией у игроков (раздача, ход дилера) тоже идут по таймеру, чтобы ход не начинался раньше,
// чем карты долетели, а выплата — раньше, чем дилер открыл карты.
const { randomInt } = require('./rng');
const {
  createShoe, steerDealer, handValue, isNatural, makesNatural, handPayout, naturalPayout, pointsOf, SHOE_SIZE, RESHUFFLE_AT,
} = require('./blackjack');

const SEATS = 5;
const MIN_BET = 1;
const FEED_SIZE = 20;
const SKIP_LIMIT = 5;          // столько раундов подряд без ставки — место освобождается
const TIMINGS = {
  betMs: 12_000,               // ставки: с первой ставки до раздачи
  turnMs: 15_000,              // ход игрока
  dealCardMs: 300,             // раздача у игроков: по карте
  dealExtraMs: 900,            // и запас на старт и последнюю карту
  actionMs: 500,               // анимация карты после действия — в таймер хода не входит
  flipMs: 950,                 // переворот закрытой карты дилера
  dealerCardMs: 620,           // каждая карта добора дилера
  resultsMs: 5_000,            // итоги на столе
  disconnectGraceMs: 60_000,   // отключился и не играет — через минуту место свободно
};

function createBjTable({
  store,
  onChange = () => {},
  onEvent = () => {},
  onFeed = () => {},
  now = Date.now,
  randInt = (n) => randomInt(0, n - 1),
  lucky = () => false,
  timings = {},
}) {
  const T = { ...TIMINGS, ...timings };
  const seats = new Array(SEATS).fill(null);
  const shoe = createShoe(randInt);
  const feed = [];
  let phase = 'idle';          // idle | betting | dealing | playing | dealer | results
  let deadline = null;
  let round = 0;
  let turn = null;             // место, чей ход
  let dealer = [];
  let hideHole = true;
  let dealerNatural = false;
  let mode = null;             // подкрутка этого раунда
  let rigged = null;           // админ: 'bust' | 'strong' | 'blackjack' на следующий раунд
  let fullTable = false;       // в раунде играли все пять мест
  let timer = null;

  const value = (h) => handValue(h.cards).total;
  const inRound = (s) => !!s && s.hands.length > 0;
  const staked = (s) => (inRound(s) ? s.hands.reduce((sum, h) => sum + h.bet, 0) : s.bet);
  const seatOf = (player) => seats.findIndex((s) => s && s.player.id === player.id);
  const playing = () => phase === 'dealing' || phase === 'playing' || phase === 'dealer';

  // ---------- Места и ставки ----------

  function sit(player, idx) {
    if (!Number.isInteger(idx) || idx < 0 || idx >= SEATS) return { error: 'Нет такого места' };
    if (seats[idx]) return { error: 'Место занято' };
    const cur = seatOf(player);
    if (cur >= 0) {
      const s = seats[cur];
      if (inRound(s) || s.bet) return { error: 'Пересесть можно, когда нет ставки' };
      seats[cur] = null;
      seats[idx] = s;
    } else {
      seats[idx] = { player, connected: true, disconnectedAt: null, leaving: false, skipped: 0, bet: 0, hands: [], cur: 0, natural: false, paid: false, net: null };
    }
    onChange();
    return { ok: true };
  }

  function leave(player) {
    const idx = seatOf(player);
    if (idx < 0) return { error: 'Ты не за столом' };
    const s = seats[idx];
    if (inRound(s) && !s.paid) {
      // Посреди раунда: оставшиеся руки стоят, ставка рассчитается честно, место освободится после итогов.
      s.leaving = true;
      if (phase === 'playing' && turn === idx) {
        for (const h of s.hands) h.done = true;
        nextTurn();
      }
    } else {
      if (s.bet && !inRound(s)) store.adjust(player, s.bet);
      seats[idx] = null;
      if (phase === 'betting' && !seats.some((x) => x && x.bet)) {
        phase = 'idle';
        deadline = null;
      } else {
        maybeDealNow();
      }
    }
    onChange();
    return { ok: true };
  }

  function bet(player, amount) {
    const idx = seatOf(player);
    if (idx < 0) return { error: 'Сначала сядь за стол' };
    if (phase !== 'idle' && phase !== 'betting') return { error: 'Ставки примем в следующем раунде' };
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    const s = seats[idx];
    if (s.bet) return { error: 'Ставка уже сделана' };
    if (amount > player.balance) return { error: 'Не хватает фишек' };
    s.bet = amount;              // сначала ставка на месте, потом списание: капитал не скачет
    s.skipped = 0;
    store.adjust(player, -amount);
    if (phase === 'idle') {
      phase = 'betting';
      deadline = now() + T.betMs;
    }
    maybeDealNow();
    onChange();
    return { ok: true };
  }

  function unbet(player) {
    const idx = seatOf(player);
    if (idx < 0 || phase !== 'betting' || !seats[idx].bet) return { error: 'Ставки нет' };
    const s = seats[idx];
    const amount = s.bet;
    s.bet = 0;
    store.adjust(player, amount);
    if (!seats.some((x) => x && x.bet)) {
      phase = 'idle';
      deadline = null;
    }
    onChange();
    return { ok: true };
  }

  // Все, кто сидит и на связи, поставили — не ждём таймер.
  function maybeDealNow() {
    if (phase !== 'betting') return;
    const ready = seats.filter((s) => s && s.connected && !s.leaving);
    if (ready.length && ready.every((s) => s.bet)) startRound();
  }

  // ---------- Раунд ----------

  function startRound() {
    const players = seats.filter((s) => s && s.bet);
    if (!players.length) {
      phase = 'idle';
      deadline = null;
      return;
    }
    round++;
    mode = rigged;
    rigged = null;
    if (shoe.left() < RESHUFFLE_AT || (mode === 'blackjack' && !shoe.has((c) => pointsOf(c) === 1))) shoe.fresh();
    fullTable = players.length === SEATS;
    seats.forEach((s, i) => {
      if (!s || s.bet) return;
      s.skipped++;
      if (s.skipped >= SKIP_LIMIT) seats[i] = null;   // сидит и не играет — место нужно другим
    });

    // Как за столом: всем по карте, дилеру в открытую, всем по второй, дилеру рубашкой вверх.
    for (const s of players) {
      s.hands = [{ cards: [shoe.draw()], bet: s.bet, doubled: false, done: false, splitAces: false, result: null, payout: 0 }];
      s.cur = 0;
      s.natural = false;
      s.paid = false;
      s.net = null;
    }
    const up = mode === 'blackjack' ? shoe.drawWhere((c) => [1, 10].includes(pointsOf(c))) : shoe.draw();
    for (const s of players) s.hands[0].cards.push(shoe.draw());
    let hole;
    if (mode === 'blackjack') hole = shoe.drawWhere((c) => makesNatural(up, c));
    else if (mode === 'bust') hole = shoe.drawWhere((c) => !makesNatural(up, c));
    else hole = shoe.draw();
    dealer = [up, hole];
    hideHole = true;
    dealerNatural = [1, 10].includes(pointsOf(up)) && isNatural(dealer);

    for (const s of players) {
      if (isNatural(s.hands[0].cards)) {
        s.natural = true;
        s.hands[0].done = true;
      }
      if (dealerNatural) for (const h of s.hands) h.done = true;
      onEvent({ game: 'bjtable', kind: 'bet', player: s.player, amount: s.bet, note: `за столом ${players.length} из ${SEATS}`, meta: { stake: s.bet, players: players.length } });
    }
    phase = 'dealing';
    turn = null;
    deadline = now() + T.dealExtraMs + T.dealCardMs * 2 * (players.length + 1);
  }

  function afterDealing() {
    if (dealerNatural) return toDealer();
    turn = -1;
    nextTurn();
  }

  // Следующее место с недоигранной рукой; таких нет — ход дилера.
  function nextTurn() {
    for (let i = turn + 1; i < SEATS; i++) {
      const s = seats[i];
      if (!inRound(s) || s.paid) continue;
      const cur = s.hands.findIndex((h) => !h.done);
      if (cur < 0) continue;
      if (s.leaving) {
        for (const h of s.hands) h.done = true;
        continue;
      }
      phase = 'playing';
      turn = i;
      s.cur = cur;
      deadline = now() + T.turnMs + T.actionMs;
      return;
    }
    toDealer();
  }

  // Рука доиграна — к следующей руке этого места или к следующему месту.
  function afterAction(s) {
    const h = s.hands[s.cur];
    if (!h.done && value(h) >= 21) h.done = true;
    if (!h.done) {
      deadline = now() + T.turnMs + T.actionMs;
      return;
    }
    const next = s.hands.findIndex((x) => !x.done);
    if (next >= 0) {
      s.cur = next;
      deadline = now() + T.turnMs + T.actionMs;
      return;
    }
    nextTurn();
  }

  // Карта игроку; у везунчика — без перебора, если такая есть.
  function drawFor(s, h) {
    if (lucky(s.player)) return shoe.drawWhere((c) => handValue([...h.cards, c]).total <= 21);
    return shoe.draw();
  }

  function act(player, action) {
    const idx = seatOf(player);
    if (phase !== 'playing' || idx < 0 || idx !== turn) return { error: 'Сейчас не твой ход' };
    const s = seats[idx];
    const h = s.hands[s.cur];
    if (action === 'hit') {
      if (h.splitAces) return { error: 'На тузах после сплита — только одна карта' };
      h.cards.push(drawFor(s, h));
    } else if (action === 'stand') {
      h.done = true;
    } else if (action === 'double') {
      if (h.cards.length !== 2 || h.splitAces) return { error: 'Удвоить можно только на первых двух картах' };
      if (player.balance < h.bet) return { error: 'Не хватает фишек на удвоение' };
      const add = h.bet;
      h.bet += add;
      h.doubled = true;
      store.adjust(player, -add);
      h.cards.push(drawFor(s, h));
      h.done = true;
    } else if (action === 'split') {
      if (s.hands.length > 1) return { error: 'Разделить можно только один раз' };
      if (h.cards.length !== 2 || pointsOf(h.cards[0]) !== pointsOf(h.cards[1])) return { error: 'Разделить можно только пару' };
      if (player.balance < h.bet) return { error: 'Не хватает фишек на сплит' };
      const aces = pointsOf(h.cards[0]) === 1;
      const second = { cards: [h.cards.pop()], bet: h.bet, doubled: false, done: false, splitAces: aces, result: null, payout: 0 };
      h.splitAces = aces;
      s.hands.push(second);
      store.adjust(player, -second.bet);
      for (const x of s.hands) {
        x.cards.push(drawFor(s, x));
        if (aces || value(x) >= 21) x.done = true;
      }
    } else {
      return { error: 'Неизвестное действие' };
    }
    afterAction(s);
    onChange();
    return { ok: true };
  }

  // Время хода вышло: текущая рука стоит. Отключившийся — стоят все его руки, ждать нечего.
  function timeout() {
    const s = seats[turn];
    if (!s) return nextTurn();
    if (!s.connected) for (const h of s.hands) h.done = true;
    else s.hands[s.cur].done = true;
    afterAction(s);
  }

  function toDealer() {
    phase = 'dealer';
    turn = null;
    hideHole = false;
    const players = seats.filter((s) => inRound(s) && !s.paid);
    const live = dealerNatural ? [] : players.flatMap((s) => (s.natural ? [] : s.hands.filter((h) => value(h) <= 21)));
    if (live.length) {
      if (mode === 'bust') steerDealer(shoe, dealer, live, 'win', randInt);
      else if (mode === 'strong') steerDealer(shoe, dealer, live, 'lose', randInt);
      while (handValue(dealer).total < 17) dealer.push(shoe.draw());
    }
    const d = handValue(dealer).total;
    for (const s of players) {
      for (const h of s.hands) {
        h.done = true;
        if (s.natural) Object.assign(h, dealerNatural ? { result: 'push', payout: h.bet } : { result: 'blackjack', payout: naturalPayout(h.bet) });
        else if (dealerNatural) Object.assign(h, { result: 'lose', payout: 0 });
        else Object.assign(h, handPayout(h, d));
      }
    }
    deadline = now() + T.flipMs + T.dealerCardMs * Math.max(0, dealer.length - 2) + 300;
  }

  // Карты дилера у всех открыты — платим, пишем ленту и события.
  function pay() {
    const d = handValue(dealer).total;
    for (const s of seats) {
      if (!inRound(s) || s.paid) continue;
      const stake = staked(s);
      const payout = s.hands.reduce((sum, h) => sum + h.payout, 0);
      s.paid = true;
      s.net = payout - stake;
      if (payout > 0) store.adjust(s.player, payout);
      else store.notify(s.player);
      feed.unshift({
        round,
        playerId: s.player.id,
        name: s.player.name,
        bet: stake,
        payout,
        hands: s.hands.map((h) => ({ total: value(h), result: h.result, doubled: h.doubled })),
        dealer: d,
        natural: s.natural,
        at: now(),
      });
      if (s.net === 0) continue;
      const hands = s.hands.map((h) => (value(h) > 21 ? 'перебор' : String(value(h)))).join(' и ');
      onEvent({
        game: 'bjtable',
        kind: s.net > 0 ? 'win' : 'lose',
        player: s.player,
        amount: Math.abs(s.net),
        note: s.natural ? 'блэкджек 3:2 за столом' : dealerNatural ? 'у дилера блэкджек' : `${hands} против ${d > 21 ? 'перебора' : d}`,
        meta: { stake, natural: s.natural, fullTable },
      });
    }
    feed.splice(FEED_SIZE);
    onFeed(feed.slice());
    if (shoe.left() < RESHUFFLE_AT) shoe.fresh();
    phase = 'results';
    deadline = now() + T.resultsMs;
  }

  function endResults() {
    seats.forEach((s, i) => {
      if (!s) return;
      if (s.leaving) {
        seats[i] = null;
        return;
      }
      Object.assign(s, { bet: 0, hands: [], cur: 0, natural: false, paid: false, net: null });
    });
    dealer = [];
    hideHole = true;
    dealerNatural = false;
    mode = null;
    phase = 'idle';
    deadline = null;
  }

  // ---------- Время и связь ----------

  function setConnected(player, connected) {
    const idx = seatOf(player);
    if (idx < 0) return;
    const s = seats[idx];
    s.connected = connected;
    s.disconnectedAt = connected ? null : now();
    if (!connected) maybeDealNow();
    onChange();
  }

  // Давно отключился и не в раунде — место свободно (ставку до раздачи возвращаем).
  function dropIdle() {
    let dropped = false;
    seats.forEach((s, i) => {
      if (!s || s.connected || now() - s.disconnectedAt < T.disconnectGraceMs) return;
      if (inRound(s) && !s.paid) return;
      if (s.bet && !inRound(s)) store.adjust(s.player, s.bet);
      seats[i] = null;
      dropped = true;
    });
    if (dropped && phase === 'betting' && !seats.some((x) => x && x.bet)) {
      phase = 'idle';
      deadline = null;
    }
    return dropped;
  }

  function tick() {
    const dropped = dropIdle();
    if (deadline === null || now() < deadline) {
      if (dropped) onChange();
      return;
    }
    if (phase === 'betting') startRound();
    else if (phase === 'dealing') afterDealing();
    else if (phase === 'playing') timeout();
    else if (phase === 'dealer') pay();
    else if (phase === 'results') endResults();
    onChange();
  }

  // ---------- Наружу ----------

  function view() {
    const dealerCards = hideHole ? dealer.slice(0, 1).concat(dealer.length > 1 ? [null] : []) : dealer.slice();
    const dv = handValue(dealerCards.filter(Boolean));
    return {
      phase,
      round,
      timeLeft: deadline === null ? null : Math.max(0, deadline - now()),
      turn,
      seats: seats.map((s, i) => s && {
        seat: i,
        playerId: s.player.id,
        name: s.player.name,
        connected: s.connected,
        leaving: s.leaving,
        bet: s.bet,
        cur: s.cur,
        natural: s.natural,
        net: s.net,
        paid: s.paid,
        hands: s.hands.map((h) => ({
          cards: h.cards.slice(),
          bet: h.bet,
          total: value(h),
          soft: handValue(h.cards).soft,
          doubled: h.doubled,
          done: h.done,
          result: phase === 'results' || phase === 'dealer' ? h.result : null,
          payout: h.payout,
        })),
        // Что можно сделать в свой ход (с учётом баланса на удвоение и сплит).
        actions: phase === 'playing' && turn === i ? (() => {
          const h = s.hands[s.cur];
          const afford = s.player.balance >= h.bet;
          return {
            hit: !h.splitAces,
            double: h.cards.length === 2 && !h.splitAces && afford,
            split: s.hands.length === 1 && h.cards.length === 2 && pointsOf(h.cards[0]) === pointsOf(h.cards[1]) && afford,
          };
        })() : null,
      }),
      dealer: { cards: dealerCards, total: dv.total, natural: !hideHole && dealerNatural },
      shoe: { left: shoe.left(), size: SHOE_SIZE },
      timings: { betMs: T.betMs, turnMs: T.turnMs },
    };
  }

  function rig(m) {
    if (!['bust', 'strong', 'blackjack', null].includes(m)) return { error: 'Режим: bust, strong, blackjack или null' };
    rigged = m;
    onChange();
    return { ok: true };
  }

  // Сервер останавливается: раунд не доигран — ставки назад; дилер уже открылся — платим по итогам.
  function refundAll() {
    if (phase === 'dealer') pay();
    seats.forEach((s, i) => {
      if (!s) return;
      if (!s.paid) {
        const amount = staked(s);
        if (amount > 0) store.adjust(s.player, amount);
      }
      seats[i] = null;
    });
    phase = 'idle';
    deadline = null;
  }

  // Игрока удалили: место пропадает вместе с фишками.
  function forget(playerId) {
    const idx = seats.findIndex((s) => s && s.player.id === playerId);
    if (idx < 0) return;
    seats[idx] = null;
    if (phase === 'playing' && turn === idx) nextTurn();
    if (phase === 'betting' && !seats.some((x) => x && x.bet)) {
      phase = 'idle';
      deadline = null;
    }
    onChange();
  }

  return {
    sit,
    leave,
    bet,
    unbet,
    act,
    setConnected,
    tick,
    view,
    rig,
    refundAll,
    forget,
    reserved: (player) => {
      const idx = seatOf(player);
      if (idx < 0 || seats[idx].paid) return 0;
      return staked(seats[idx]);
    },
    isSeated: (player) => seatOf(player) >= 0,
    feed: () => feed.slice(),
    adminState: () => ({
      rigged,
      phase,
      round,
      shoe: { left: shoe.left(), size: SHOE_SIZE },
      seats: seats.map((s) => s && { name: s.player.name, bet: staked(s), hands: s.hands.map((h) => value(h)), connected: s.connected }),
      dealer: dealer.slice(0, 1),
      feed: feed.slice(),
    }),
    start() {
      timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          console.error('Стол блэкджека: ошибка в тике', err);
        }
      }, 250);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    _stack: (cards) => shoe.stack(cards),
  };
}

module.exports = { createBjTable, SEATS, TIMINGS };
