// Техасский холдем без лимита: стол до 6 игроков, блайнды, флоп-тёрн-ривер, олл-ин и побочные банки.
const { randomInt } = require('./rng');

// ---------- Карты ----------

const RANKS = '23456789TJQKA';
const SUITS = 'shdc';  // пики, червы, бубны, трефы

const rankOf = (card) => RANKS.indexOf(card[0]) + 2;  // 2..14
const suitOf = (card) => card[1];

function makeDeck() {
  const deck = [];
  for (const r of RANKS) for (const s of SUITS) deck.push(r + s);
  return deck;
}

const isCard = (c) => typeof c === 'string' && c.length === 2 && RANKS.includes(c[0]) && SUITS.includes(c[1]);

// Фишер-Йетс на crypto. randInt(n) -> целое [0, n).
function shuffle(deck, randInt = (n) => randomInt(0, n - 1)) {
  for (let i = deck.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

// ---------- Комбинации ----------

const HAND = {
  HIGH: 1, PAIR: 2, TWO_PAIR: 3, TRIPS: 4, STRAIGHT: 5, FLUSH: 6, FULL_HOUSE: 7, QUADS: 8, STRAIGHT_FLUSH: 9,
};
const HAND_NAMES = {
  1: 'Старшая карта', 2: 'Пара', 3: 'Две пары', 4: 'Сет', 5: 'Стрит',
  6: 'Флеш', 7: 'Фулл-хаус', 8: 'Каре', 9: 'Стрит-флеш',
};

// Старшая карта стрита из набора рангов или 0. Учитывает «колесо» A-2-3-4-5.
function straightHigh(ranks) {
  const set = new Set(ranks);
  if (set.has(14)) set.add(1);
  for (let hi = 14; hi >= 5; hi--) {
    let ok = true;
    for (let k = 0; k < 5; k++) if (!set.has(hi - k)) { ok = false; break; }
    if (ok) return hi;
  }
  return 0;
}

// Оценка ровно 5 карт -> { rank, tiebreakers }.
function evaluate5(cards) {
  const ranks = cards.map(rankOf).sort((a, b) => b - a);
  const flush = cards.every((c) => suitOf(c) === suitOf(cards[0]));
  const sHigh = straightHigh(ranks);
  const counts = new Map();
  for (const r of ranks) counts.set(r, (counts.get(r) || 0) + 1);
  // Группы: сначала по размеру, потом по рангу.
  const groups = [...counts].sort((a, b) => b[1] - a[1] || b[0] - a[0]);
  const shape = groups.map((g) => g[1]).join('');
  const byGroups = groups.map((g) => g[0]);

  if (flush && sHigh) return { rank: HAND.STRAIGHT_FLUSH, tiebreakers: [sHigh] };
  if (shape === '41') return { rank: HAND.QUADS, tiebreakers: byGroups };
  if (shape === '32') return { rank: HAND.FULL_HOUSE, tiebreakers: byGroups };
  if (flush) return { rank: HAND.FLUSH, tiebreakers: ranks };
  if (sHigh) return { rank: HAND.STRAIGHT, tiebreakers: [sHigh] };
  if (shape === '311') return { rank: HAND.TRIPS, tiebreakers: byGroups };
  if (shape === '221') return { rank: HAND.TWO_PAIR, tiebreakers: byGroups };
  if (shape === '2111') return { rank: HAND.PAIR, tiebreakers: byGroups };
  return { rank: HAND.HIGH, tiebreakers: ranks };
}

function compareHands(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const d = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (d) return d;
  }
  return 0;
}

// Все сочетания по 5 из массива (для 7 карт их 21).
function fives(cards) {
  const out = [];
  const rec = (start, chosen) => {
    if (chosen.length === 5) {
      out.push(chosen.map((i) => cards[i]));
      return;
    }
    for (let i = start; i <= cards.length - (5 - chosen.length); i++) rec(i + 1, [...chosen, i]);
  };
  rec(0, []);
  return out;
}

// Лучшие 5 из 5-7 карт -> { rank, tiebreakers, name, cards }.
function bestHand(cards) {
  let best = null;
  for (const five of fives(cards)) {
    const h = evaluate5(five);
    if (!best || compareHands(h, best) > 0) best = { ...h, cards: five };
  }
  const royal = best.rank === HAND.STRAIGHT_FLUSH && best.tiebreakers[0] === 14;
  return { ...best, name: royal ? 'Роял-флеш' : HAND_NAMES[best.rank] };
}

// ---------- Стол ----------

const SMALL_BLIND = 5;
const BIG_BLIND = 10;
const MIN_BUYIN = 100;
const MAX_SEATS = 6;
const TURN_MS = 30_000;
const START_DELAY_MS = 5000;
const SHOWDOWN_MS = 8000;
const DISCONNECT_GRACE_MS = 60_000;

const BET_STREETS = new Set(['preflop', 'flop', 'turn', 'river']);

function createHoldem({
  store,
  onChange = () => {},
  onEvent = () => {},
  now = Date.now,
  randInt,                 // для перемешивания колоды (в тестах подменяется)
  deckFactory,             // в тестах: заранее заданная колода
  timings = {},
}) {
  const T = { turnMs: TURN_MS, startDelayMs: START_DELAY_MS, showdownMs: SHOWDOWN_MS, disconnectGraceMs: DISCONNECT_GRACE_MS, ...timings };

  const seats = new Array(MAX_SEATS).fill(null);
  let phase = 'waiting';       // waiting | starting | preflop | flop | turn | river | showdown
  let handId = 0;
  let dealer = -1;
  let sbSeat = -1;
  let bbSeat = -1;
  let turn = null;
  let deadline = null;
  let currentBet = 0;          // наибольший вклад на текущей улице
  let lastRaise = BIG_BLIND;   // размер последнего повышения (минимальный рейз)
  let board = [];
  let deck = [];
  let result = null;
  let timer = null;
  const rigged = new Map();    // админ: playerId -> 2 карты на следующую раздачу

  const inHand = (s) => !!s && s.inHand;
  const live = (s) => inHand(s) && !s.folded;             // претендует на банк
  const canAct = (s) => live(s) && !s.allIn;               // может ещё ставить
  const eligible = (s) => !!s && !s.leaving && s.connected && s.stack > 0;
  const pot = () => seats.reduce((sum, s) => sum + (inHand(s) ? s.totalBet : 0), 0);

  function seatOf(player) {
    return seats.findIndex((s) => s && s.player.id === player.id);
  }

  function nextIndex(from, pred) {
    for (let k = 1; k <= MAX_SEATS; k++) {
      const j = (from + k + MAX_SEATS) % MAX_SEATS;
      if (pred(seats[j])) return j;
    }
    return -1;
  }

  function standUp(idx) {
    const s = seats[idx];
    seats[idx] = null;
    if (s.stack > 0) store.adjust(s.player, s.stack);
    else store.notify(s.player);
  }

  function maybeStart() {
    if (phase === 'waiting' && seats.filter(eligible).length >= 2) {
      phase = 'starting';
      deadline = now() + T.startDelayMs;
    }
  }

  function pay(s, amount, label) {
    const n = Math.min(amount, s.stack);
    s.stack -= n;
    s.committed += n;
    s.totalBet += n;
    if (s.stack === 0) s.allIn = true;
    if (label) s.lastAction = s.allIn ? `олл-ин ${s.totalBet}` : label;
    return n;
  }

  function startHand() {
    const players = seats.map((s, i) => (eligible(s) ? i : -1)).filter((i) => i >= 0);
    if (players.length < 2) {
      phase = 'waiting';
      deadline = null;
      return;
    }
    handId += 1;
    result = null;
    board = [];
    deck = deckFactory ? deckFactory() : shuffle(makeDeck(), randInt);

    for (const s of seats) {
      if (!s) continue;
      Object.assign(s, {
        inHand: eligible(s), folded: false, allIn: false, hole: null,
        committed: 0, totalBet: 0, acted: false, lastAction: null,
      });
    }

    dealer = nextIndex(dealer < 0 ? MAX_SEATS - 1 : dealer, eligible);
    const headsUp = players.length === 2;
    sbSeat = headsUp ? dealer : nextIndex(dealer, inHand);
    bbSeat = nextIndex(sbSeat, inHand);

    // Подкрученные руки достаём из колоды заранее, остальным раздаём по порядку.
    const take = (card) => {
      const i = deck.indexOf(card);
      if (i < 0) return false;
      deck.splice(i, 1);
      return true;
    };
    const fixed = new Map();
    for (const [id, cards] of rigged) {
      const idx = seats.findIndex((s) => inHand(s) && s.player.id === id);
      if (idx >= 0 && cards.every((c) => deck.includes(c))) {
        cards.forEach(take);
        fixed.set(idx, [...cards]);
      }
    }
    rigged.clear();
    for (let k = 1; k <= MAX_SEATS; k++) {
      const i = (dealer + k) % MAX_SEATS;
      if (inHand(seats[i])) seats[i].hole = fixed.get(i) || [deck.shift(), deck.shift()];
    }

    pay(seats[sbSeat], SMALL_BLIND, `SB ${SMALL_BLIND}`);
    pay(seats[bbSeat], BIG_BLIND, `BB ${BIG_BLIND}`);
    currentBet = Math.max(seats[sbSeat].committed, seats[bbSeat].committed);
    lastRaise = BIG_BLIND;
    phase = 'preflop';
    // Префлоп: первым ходит следующий после большого блайнда (один на один это дилер-SB).
    turn = nextIndex(bbSeat, canAct);
    if (turn < 0 || roundDone()) return nextStreet();
    deadline = now() + T.turnMs;
  }

  // Круг ставок закончен, если:
  // - ходить некому (все в олл-ине), или
  // - все, кто может ходить, уже походили и уравняли ставку, или
  // - остался один, кто может ставить, и он уже покрыл олл-ины остальных: торговаться не с кем.
  function roundDone() {
    const actors = seats.filter(canAct);
    if (actors.length === 0) return true;
    if (actors.every((s) => s.acted && s.committed === currentBet)) return true;
    return actors.length === 1 && actors[0].committed >= currentBet;
  }

  function nextStreet() {
    for (const s of seats) {
      if (!inHand(s)) continue;
      s.committed = 0;
      s.acted = false;
    }
    currentBet = 0;
    lastRaise = BIG_BLIND;
    if (phase === 'preflop') {
      board.push(deck.shift(), deck.shift(), deck.shift());
      phase = 'flop';
    } else if (phase === 'flop') {
      board.push(deck.shift());
      phase = 'turn';
    } else if (phase === 'turn') {
      board.push(deck.shift());
      phase = 'river';
    } else {
      return showdown();
    }
    // Ставить больше некому (все в олл-ине, кроме максимум одного): докладываем стол до конца.
    if (seats.filter(canAct).length < 2) return nextStreet();
    turn = nextIndex(dealer, canAct);
    deadline = now() + T.turnMs;
  }

  function advance() {
    if (seats.filter(live).length === 1) return settle(false);
    if (roundDone()) return nextStreet();
    turn = nextIndex(turn, (s) => canAct(s) && !(s.acted && s.committed === currentBet));
    deadline = now() + T.turnMs;
  }

  // Невостребованную часть самой большой ставки возвращаем (её никто не уравнял).
  function returnUncalled() {
    const ins = seats.filter(inHand).sort((a, b) => b.totalBet - a.totalBet);
    if (ins.length < 2) return;
    const [top, second] = ins;
    const extra = top.totalBet - second.totalBet;
    if (extra > 0) {
      top.totalBet -= extra;
      top.stack += extra;
      if (top.stack > 0) top.allIn = false;
    }
  }

  // Банки: основной и побочные по уровням вкладов претендентов.
  function buildPots() {
    const ins = seats.filter(inHand);
    const contenders = ins.filter((s) => !s.folded);
    const levels = [...new Set(contenders.map((s) => s.totalBet))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const level of levels) {
      const amount = ins.reduce((sum, s) => sum + Math.max(0, Math.min(s.totalBet, level) - prev), 0);
      if (amount > 0) pots.push({ amount, eligible: contenders.filter((s) => s.totalBet >= level) });
      prev = level;
    }
    const leftover = ins.reduce((sum, s) => sum + Math.max(0, s.totalBet - prev), 0);
    if (leftover && pots.length) pots[pots.length - 1].amount += leftover;
    return pots;
  }

  // Раздача окончена: делим банки. revealed: было вскрытие (иначе все, кроме одного, сбросили).
  function settle(revealed) {
    returnUncalled();
    const idxOf = (s) => seats.indexOf(s);
    const dist = (i) => (i - dealer - 1 + MAX_SEATS) % MAX_SEATS;
    const won = new Map();
    const hands = new Map();
    for (const s of seats.filter(live)) {
      if (revealed) hands.set(s, bestHand([...s.hole, ...board]));
    }

    for (const p of buildPots()) {
      let winners = p.eligible;
      if (revealed && winners.length > 1) {
        const best = winners.reduce((a, b) => (compareHands(hands.get(b), hands.get(a)) > 0 ? b : a));
        winners = winners.filter((s) => compareHands(hands.get(s), hands.get(best)) === 0);
      }
      winners.sort((a, b) => dist(idxOf(a)) - dist(idxOf(b)));
      const share = Math.floor(p.amount / winners.length);
      winners.forEach((s, k) => {
        const amount = share + (k === 0 ? p.amount - share * winners.length : 0);
        won.set(s, (won.get(s) || 0) + amount);
      });
    }

    for (const [s, amount] of won) s.stack += amount;
    const potTotal = pot();
    result = {
      handId,
      revealed,
      board: [...board],
      pot: potTotal,
      winners: [...won].map(([s, amount]) => ({
        seat: idxOf(s), name: s.player.name, won: amount, hand: revealed ? hands.get(s).name : null,
      })),
      hands: revealed
        ? [...hands].map(([s, h]) => ({ seat: idxOf(s), name: s.player.name, hole: s.hole, hand: h.name, best: h.cards }))
        : [],
    };

    // Лента: чистый выигрыш победителей, проигрыш дошедших до вскрытия.
    for (const s of seats.filter(inHand)) {
      const net = (won.get(s) || 0) - s.totalBet;
      if (net > 0) {
        onEvent({ game: 'poker', kind: 'win', player: s.player, amount: net, note: revealed ? hands.get(s).name : 'все сбросили' });
      } else if (net < 0 && revealed && !s.folded) {
        onEvent({ game: 'poker', kind: 'lose', player: s.player, amount: -net, note: hands.get(s).name });
      }
    }

    for (const s of seats) {
      if (!inHand(s)) continue;
      s.totalBet = 0;
      s.committed = 0;
      store.notify(s.player);
    }
    phase = 'showdown';
    turn = null;
    deadline = now() + T.showdownMs;
  }

  function showdown() {
    settle(true);
  }

  function endShowdown() {
    seats.forEach((s, i) => {
      if (!s) return;
      if (s.leaving || !s.connected || s.stack <= 0) {
        standUp(i);
        return;
      }
      Object.assign(s, { inHand: false, folded: false, allIn: false, hole: null, lastAction: null });
    });
    board = [];
    phase = 'waiting';
    deadline = null;
    maybeStart();
  }

  function foldSeat(idx) {
    const s = seats[idx];
    s.folded = true;
    s.acted = true;
    s.lastAction = 'фолд';
    if (seats.filter(live).length === 1) return settle(false);
    if (BET_STREETS.has(phase) && turn === idx) return advance();
    if (BET_STREETS.has(phase) && roundDone()) return nextStreet();
  }

  // ---------- Команды ----------

  function join(player, buyIn) {
    if (seatOf(player) >= 0) return { error: 'Ты уже за столом' };
    if (!Number.isSafeInteger(buyIn) || buyIn < MIN_BUYIN) return { error: `Бай-ин: целое число от ${MIN_BUYIN}` };
    if (buyIn > player.balance) return { error: 'Не хватает фишек' };
    const idx = seats.indexOf(null);
    if (idx < 0) return { error: 'Стол полон' };
    seats[idx] = {
      player, stack: buyIn, connected: true, disconnectedAt: null, leaving: false,
      inHand: false, folded: false, allIn: false, hole: null, committed: 0, totalBet: 0, acted: false, lastAction: null,
    };
    store.adjust(player, -buyIn);
    maybeStart();
    onChange();
    return { ok: true };
  }

  function leave(player) {
    const idx = seatOf(player);
    if (idx < 0) return { error: 'Ты не за столом' };
    const s = seats[idx];
    if (s.inHand && BET_STREETS.has(phase)) {
      s.leaving = true;
      if (!s.folded && !s.allIn) foldSeat(idx);
      onChange();
      return { ok: true, pending: true };
    }
    standUp(idx);
    if (phase === 'starting' && seats.filter(eligible).length < 2) {
      phase = 'waiting';
      deadline = null;
    }
    onChange();
    return { ok: true };
  }

  // action: fold | check | call | raise (amount = до скольки поднять ставку на этой улице) | allin
  function act(player, action, amount) {
    const idx = seatOf(player);
    if (idx < 0) return { error: 'Ты не за столом' };
    if (!BET_STREETS.has(phase)) return { error: 'Сейчас не время ставок' };
    if (turn !== idx) return { error: 'Сейчас не твой ход' };
    const s = seats[idx];
    const toCall = currentBet - s.committed;
    const maxTo = s.committed + s.stack;

    if (action === 'allin') {
      if (maxTo > currentBet) return act(player, 'raise', maxTo);
      action = 'call';
    }
    switch (action) {
      case 'fold':
        foldSeat(idx);
        onChange();
        return { ok: true };
      case 'check':
        if (toCall > 0) return { error: `Чек нельзя: нужно уравнять ${toCall}` };
        s.acted = true;
        s.lastAction = 'чек';
        break;
      case 'call':
        if (toCall <= 0) return { error: 'Нечего уравнивать, можно чек' };
        pay(s, toCall, `колл ${Math.min(toCall, s.stack)}`);
        s.acted = true;
        break;
      case 'raise': {
        if (!Number.isSafeInteger(amount)) return { error: 'Сумма ставки: целое число' };
        if (amount <= currentBet) return { error: `Ставка должна быть больше ${currentBet}` };
        if (amount > maxTo) return { error: `Максимум ${maxTo} (весь стек)` };
        const minTo = currentBet + lastRaise;
        if (amount < minTo && amount !== maxTo) return { error: `Минимальное повышение: до ${minTo}` };
        const raiseSize = amount - currentBet;
        const opened = currentBet === 0;
        pay(s, amount - s.committed, opened ? `бет ${amount}` : `рейз до ${amount}`);
        if (raiseSize >= lastRaise) lastRaise = raiseSize;
        currentBet = amount;
        for (const other of seats) if (canAct(other) && other !== s) other.acted = false;
        s.acted = true;
        break;
      }
      default:
        return { error: 'Неизвестное действие' };
    }
    advance();
    onChange();
    return { ok: true };
  }

  function setConnected(player, connected) {
    const idx = seatOf(player);
    if (idx < 0) return;
    seats[idx].connected = connected;
    seats[idx].disconnectedAt = connected ? null : now();
    if (connected) maybeStart();
    onChange();
  }

  // ---------- Время ----------

  function dropIdle() {
    let dropped = false;
    seats.forEach((s, i) => {
      if (!s || s.connected || now() - s.disconnectedAt < T.disconnectGraceMs) return;
      if (s.inHand && (BET_STREETS.has(phase))) return;
      standUp(i);
      dropped = true;
    });
    if (dropped && phase === 'starting' && seats.filter(eligible).length < 2) {
      phase = 'waiting';
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
    if (phase === 'starting') {
      startHand();
    } else if (BET_STREETS.has(phase)) {
      const s = seats[turn];
      if (s.committed === currentBet) {
        s.acted = true;
        s.lastAction = 'чек (время)';
        advance();
      } else {
        foldSeat(turn);
      }
    } else if (phase === 'showdown') {
      endShowdown();
    }
    onChange();
  }

  // ---------- Наружу ----------

  function seatView(s, i, showCards) {
    return s && {
      seat: i,
      id: s.player.id,
      name: s.player.name,
      stack: s.stack,
      committed: s.committed,
      inHand: s.inHand,
      folded: s.folded,
      allIn: s.allIn,
      connected: s.connected,
      leaving: s.leaving,
      lastAction: s.lastAction,
      hasCards: !!s.hole,
      hole: showCards ? s.hole : null,
    };
  }

  // Состояние глазами viewer (null = зритель). Чужие карты только во вскрытии (result.hands).
  function view(viewer) {
    const mySeat = viewer ? seatOf(viewer) : -1;
    const me = mySeat >= 0 ? seats[mySeat] : null;
    let you = null;
    if (me) {
      const myTurn = BET_STREETS.has(phase) && turn === mySeat;
      const toCall = Math.max(0, currentBet - me.committed);
      const maxTo = me.committed + me.stack;
      const minTo = Math.min(maxTo, currentBet + lastRaise);
      you = {
        seat: mySeat,
        hole: me.hole,
        hand: me.hole && board.length >= 3 ? bestHand([...me.hole, ...board]).name : null,
        inHand: live(me),
        myTurn,
        toCall: Math.min(toCall, me.stack),
        canCheck: myTurn && toCall === 0,
        canCall: myTurn && toCall > 0,
        canRaise: myTurn && maxTo > currentBet,
        minRaiseTo: minTo,
        maxRaiseTo: maxTo,
        leaving: me.leaving,
      };
    }
    return {
      phase,
      handId,
      board: [...board],
      pot: pot(),
      dealer,
      sb: sbSeat,
      bb: bbSeat,
      turn,
      currentBet,
      blinds: [SMALL_BLIND, BIG_BLIND],
      minBuyIn: MIN_BUYIN,
      timeLeft: deadline === null ? null : Math.max(0, deadline - now()),
      turnMs: T.turnMs,
      seats: seats.map((s, i) => seatView(s, i, false)),
      you,
      result: phase === 'showdown' ? result : null,
    };
  }

  function adminView() {
    return {
      ...view(null),
      seats: seats.map((s, i) => {
        const v = seatView(s, i, true);
        if (v && s.hole && board.length >= 3) v.hand = bestHand([...s.hole, ...board]).name;
        return v;
      }),
      rigged: [...rigged].map(([id, cards]) => ({ id, cards })),
    };
  }

  // Админ: две карты игроку на следующую раздачу.
  function rigHole(player, cards) {
    if (!Array.isArray(cards) || cards.length !== 2 || !cards.every(isCard) || cards[0] === cards[1]) {
      return { error: 'Две разные карты, например As Kh' };
    }
    rigged.set(player.id, [...cards]);
    return { ok: true };
  }

  function reserved(player) {
    const idx = seatOf(player);
    return idx < 0 ? 0 : seats[idx].stack + seats[idx].totalBet;
  }

  function refundAll() {
    seats.forEach((s, i) => {
      if (!s) return;
      seats[i] = null;
      const amount = s.stack + s.totalBet;
      if (amount > 0) store.adjust(s.player, amount);
    });
  }

  return {
    join,
    leave,
    act,
    setConnected,
    tick,
    view,
    adminView,
    rigHole,
    reserved,
    refundAll,
    isSeated: (player) => seatOf(player) >= 0,
    start() {
      timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          console.error('Покер: ошибка в тике', err);
        }
      }, 250);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = {
  createHoldem, makeDeck, shuffle, evaluate5, bestHand, compareHands, straightHigh, HAND, HAND_NAMES,
  SMALL_BLIND, BIG_BLIND, MIN_BUYIN, TURN_MS, START_DELAY_MS, SHOWDOWN_MS, DISCONNECT_GRACE_MS,
};
