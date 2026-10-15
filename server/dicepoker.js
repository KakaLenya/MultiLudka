// Покер на кубиках: оценка комбинаций и стол на 2-6 игроков.
const { randomInt } = require('./rng');

// ---------- Комбинации ----------

const RANK = {
  HIGH: 1,
  PAIR: 2,
  TWO_PAIR: 3,
  THREE: 4,
  STRAIGHT: 5,
  FULL_HOUSE: 6,
  FOUR: 7,
  FIVE: 8,
};

const RANK_NAMES = {
  [RANK.HIGH]: 'Старшая',
  [RANK.PAIR]: 'Пара',
  [RANK.TWO_PAIR]: 'Две пары',
  [RANK.THREE]: 'Сет',
  [RANK.STRAIGHT]: 'Стрит',
  [RANK.FULL_HOUSE]: 'Фулл-хаус',
  [RANK.FOUR]: 'Каре',
  [RANK.FIVE]: 'Покер',
};

function isValidDice(dice) {
  return Array.isArray(dice) && dice.length === 5
    && dice.every((v) => Number.isInteger(v) && v >= 1 && v <= 6);
}

// -> { rank, name, tiebreakers }. tiebreakers: значения групп по убыванию (размер группы, значение),
// поэтому одинаково работает для каре+кикер, двух пар+кикер, старшей и стритов.
function evaluate(dice) {
  if (!isValidDice(dice)) throw new TypeError(`Некорректные кубики: ${JSON.stringify(dice)}`);
  const counts = new Array(7).fill(0);
  for (const v of dice) counts[v]++;

  const groups = [];
  for (let v = 6; v >= 1; v--) if (counts[v]) groups.push([counts[v], v]);
  groups.sort((a, b) => b[0] - a[0] || b[1] - a[1]);

  const shape = groups.map((g) => g[0]).join('');
  const tiebreakers = groups.map((g) => g[1]);
  let rank;
  switch (shape) {
    case '5': rank = RANK.FIVE; break;
    case '41': rank = RANK.FOUR; break;
    case '32': rank = RANK.FULL_HOUSE; break;
    case '311': rank = RANK.THREE; break;
    case '221': rank = RANK.TWO_PAIR; break;
    case '2111': rank = RANK.PAIR; break;
    default:
      // Пять разных значений: стрит, если нет единицы (2-6) или шестёрки (1-5).
      rank = counts[1] === 0 || counts[6] === 0 ? RANK.STRAIGHT : RANK.HIGH;
  }
  return { rank, name: RANK_NAMES[rank], tiebreakers };
}

// > 0: a сильнее, < 0: b сильнее, 0: равны.
function compare(a, b) {
  if (a.rank !== b.rank) return a.rank - b.rank;
  for (let i = 0; i < Math.max(a.tiebreakers.length, b.tiebreakers.length); i++) {
    const d = (a.tiebreakers[i] || 0) - (b.tiebreakers[i] || 0);
    if (d !== 0) return d;
  }
  return 0;
}

// ---------- Стол ----------

const ANTE = 10;
const MIN_BUYIN = 50;
const MAX_SEATS = 6;
const MIN_BET = 10;
const MAX_RAISES = 3;
const TURN_MS = 30_000;
const REROLL_MS = 30_000;
const START_DELAY_MS = 5000;
const SHOWDOWN_MS = 7000;

const BET_PHASES = new Set(['bet1', 'bet2']);
const HAND_PHASES = new Set(['bet1', 'reroll', 'bet2']);

// store: хранилище игроков. onChange(): что-то поменялось, разослать состояние.
// now, rollDie, timings подменяются в тестах; таймауты срабатывают в tick().
function createTable({
  store,
  onChange = () => {},
  now = Date.now,
  rollDie = () => randomInt(1, 6),
  timings = {},
}) {
  const T = {
    turnMs: TURN_MS,
    rerollMs: REROLL_MS,
    startDelayMs: START_DELAY_MS,
    showdownMs: SHOWDOWN_MS,
    ...timings,
  };

  const seats = new Array(MAX_SEATS).fill(null);
  let phase = 'waiting';   // waiting | starting | bet1 | reroll | bet2 | showdown
  let handId = 0;
  let pot = 0;
  let dealer = -1;
  let turn = null;         // индекс места, чей ход
  let deadline = null;     // когда истекает текущий таймер
  let currentBet = 0;      // максимальный вклад в текущем круге ставок
  let raises = 0;
  let result = null;       // итог последней раздачи (для показа в showdown)
  let timer = null;

  const roll5 = () => Array.from({ length: 5 }, () => rollDie());
  const isActive = (s) => !!s && s.inHand && !s.folded;
  const activeSeats = () => seats.filter(isActive);
  const isEligible = (s) => !!s && !s.leaving && s.connected && s.stack >= ANTE;

  function seatOf(player) {
    return seats.findIndex((s) => s && s.player.id === player.id);
  }

  // Следующее место после from (по кругу), удовлетворяющее pred. -1, если нет.
  function nextIndex(from, pred) {
    for (let i = 1; i <= MAX_SEATS; i++) {
      const j = (from + i + MAX_SEATS) % MAX_SEATS;
      if (pred(seats[j])) return j;
    }
    return -1;
  }

  // Потолок вклада за раздачу: наименьший стек среди оставшихся (без all-in и side pots).
  function cap() {
    return Math.min(...activeSeats().map((s) => s.stack + s.totalBet));
  }

  function standUp(idx) {
    const s = seats[idx];
    seats[idx] = null;
    if (s.stack > 0) store.adjust(s.player, s.stack);
    else store.notify(s.player);
  }

  function maybeStart() {
    if (phase === 'waiting' && seats.filter(isEligible).length >= 2) {
      phase = 'starting';
      deadline = now() + T.startDelayMs;
    }
  }

  function startHand() {
    if (seats.filter(isEligible).length < 2) {
      phase = 'waiting';
      deadline = null;
      return;
    }
    handId += 1;
    pot = 0;
    result = null;
    dealer = nextIndex(dealer < 0 ? MAX_SEATS - 1 : dealer, isEligible);
    for (const s of seats) {
      if (!s) continue;
      Object.assign(s, {
        inHand: isEligible(s), folded: false, committed: 0, totalBet: 0,
        acted: false, keep: null, rerolled: null, dice: null, lastAction: null,
      });
      if (s.inHand) {
        s.stack -= ANTE;
        s.totalBet = ANTE;
        pot += ANTE;
        s.dice = roll5();
      }
    }
    phase = 'bet1';
    startBettingRound();
  }

  function startBettingRound() {
    currentBet = 0;
    raises = 0;
    for (const s of activeSeats()) {
      s.committed = 0;
      s.acted = false;
      s.lastAction = null;
    }
    turn = nextIndex(dealer, isActive);
    deadline = now() + T.turnMs;
  }

  function pay(s, n) {
    s.stack -= n;
    s.committed += n;
    s.totalBet += n;
    pot += n;
  }

  const roundDone = () => activeSeats().every((s) => s.acted && s.committed === currentBet);

  // После хода: следующий игрок, или следующая фаза.
  function advance() {
    if (activeSeats().length === 1) return settle(false);
    if (roundDone()) {
      if (phase === 'bet1') return startReroll();
      return settle(true);
    }
    turn = nextIndex(turn, (s) => isActive(s) && !(s.acted && s.committed === currentBet));
    deadline = now() + T.turnMs;
  }

  function startReroll() {
    phase = 'reroll';
    turn = null;
    deadline = now() + T.rerollMs;
  }

  function applyRerolls() {
    for (const s of activeSeats()) {
      const keep = s.keep || [true, true, true, true, true];
      s.dice = s.dice.map((v, i) => (keep[i] ? v : rollDie()));
      s.rerolled = keep.filter((k) => !k).length;
    }
    phase = 'bet2';
    startBettingRound();
  }

  // Раздача окончена: делим банк. revealed = было вскрытие (иначе все, кроме одного, сбросили).
  function settle(revealed) {
    const contenders = seats
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => isActive(s))
      .map((c) => ({ ...c, hand: evaluate(c.s.dice) }));

    let winners = contenders;
    if (revealed) {
      const best = contenders.reduce((a, b) => (compare(b.hand, a.hand) > 0 ? b : a)).hand;
      winners = contenders.filter((c) => compare(c.hand, best) === 0);
    }
    // Остаток от деления: первому победителю после дилера.
    const dist = (i) => (i - dealer - 1 + MAX_SEATS) % MAX_SEATS;
    winners.sort((a, b) => dist(a.i) - dist(b.i));
    const share = Math.floor(pot / winners.length);
    const won = new Map(winners.map((w, k) => [w.i, share + (k === 0 ? pot - share * winners.length : 0)]));

    for (const [i, amount] of won) seats[i].stack += amount;

    result = {
      handId,
      pot,
      revealed,
      winners: winners.map((w) => ({ seat: w.i, name: w.s.player.name, won: won.get(w.i) })),
      hands: revealed
        ? contenders.map((c) => ({ seat: c.i, name: c.s.player.name, dice: c.s.dice, hand: c.hand.name }))
        : [],
    };

    pot = 0;
    for (const s of seats) {
      if (!s) continue;
      s.totalBet = 0;
      s.committed = 0;
      if (s.inHand) store.notify(s.player);
    }
    phase = 'showdown';
    turn = null;
    deadline = now() + T.showdownMs;
  }

  // После показа итогов: убираем ушедших, отключившихся и тех, у кого не хватает на анте.
  function endShowdown() {
    seats.forEach((s, i) => {
      if (!s) return;
      if (s.leaving || !s.connected || s.stack < ANTE) {
        standUp(i);
        return;
      }
      Object.assign(s, { inHand: false, folded: false, dice: null, keep: null, rerolled: null });
    });
    phase = 'waiting';
    deadline = null;
    maybeStart();
  }

  function foldSeat(idx) {
    const s = seats[idx];
    s.folded = true;
    s.acted = true;
    s.lastAction = 'пас';
    if (activeSeats().length === 1) return settle(false);
    if (BET_PHASES.has(phase) && turn === idx) return advance();
    if (phase === 'reroll' && activeSeats().every((a) => a.keep)) return applyRerolls();
  }

  // ---------- Команды игроков ----------

  function join(player, buyIn) {
    if (seatOf(player) >= 0) return { error: 'Ты уже за столом' };
    if (!Number.isSafeInteger(buyIn) || buyIn < MIN_BUYIN) return { error: `Бай-ин: целое число от ${MIN_BUYIN}` };
    if (buyIn > player.balance) return { error: 'Не хватает фишек' };
    const idx = seats.indexOf(null);
    if (idx < 0) return { error: 'Стол полон' };

    // Сначала садим, потом списываем: капитал в рассылке баланса сразу верный.
    seats[idx] = {
      player, stack: buyIn, connected: true, leaving: false,
      inHand: false, folded: false, dice: null, committed: 0, totalBet: 0,
      acted: false, keep: null, rerolled: null, lastAction: null,
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
    if (s.inHand && HAND_PHASES.has(phase)) {
      // Посреди раздачи: сброс, стек вернётся после её окончания.
      s.leaving = true;
      if (!s.folded) foldSeat(idx);
      onChange();
      return { ok: true, pending: true };
    }
    standUp(idx);
    if (phase === 'starting' && seats.filter(isEligible).length < 2) {
      phase = 'waiting';
      deadline = null;
    }
    onChange();
    return { ok: true };
  }

  function act(player, action, amount) {
    const idx = seatOf(player);
    if (idx < 0) return { error: 'Ты не за столом' };
    if (!BET_PHASES.has(phase)) return { error: 'Сейчас не время ставок' };
    if (turn !== idx) return { error: 'Сейчас не твой ход' };

    const s = seats[idx];
    const toCall = currentBet - s.committed;
    switch (action) {
      case 'check':
        if (toCall > 0) return { error: `Чек нельзя: нужно уравнять ${toCall}` };
        s.acted = true;
        s.lastAction = 'чек';
        break;
      case 'call':
        if (toCall === 0) return { error: 'Нечего уравнивать, можно чек' };
        pay(s, toCall);
        s.acted = true;
        s.lastAction = `колл ${toCall}`;
        break;
      case 'bet':
      case 'raise': {
        if (action === 'bet' && currentBet > 0) return { error: 'Ставка уже есть, можно повысить' };
        if (action === 'raise' && currentBet === 0) return { error: 'Повышать нечего, сделай ставку' };
        if (raises >= MAX_RAISES) return { error: `Не больше ${MAX_RAISES} повышений за круг` };
        if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Минимум ${MIN_BET}` };
        const room = cap() - s.totalBet - toCall;
        if (amount > room) {
          return { error: room >= MIN_BET ? `Максимум ${room} (по наименьшему стеку)` : 'Повышать некуда: упёрлись в наименьший стек' };
        }
        pay(s, toCall + amount);
        currentBet = s.committed;
        if (action === 'raise') raises += 1;  // первая ставка круга не считается повышением
        for (const other of activeSeats()) other.acted = false;
        s.acted = true;
        s.lastAction = action === 'bet' ? `ставка ${amount}` : `рейз +${amount}`;
        break;
      }
      case 'fold':
        foldSeat(idx);
        onChange();
        return { ok: true };
      default:
        return { error: 'Неизвестное действие' };
    }
    advance();
    onChange();
    return { ok: true };
  }

  function reroll(player, keep) {
    const idx = seatOf(player);
    if (idx < 0) return { error: 'Ты не за столом' };
    if (phase !== 'reroll') return { error: 'Сейчас не перебросок' };
    const s = seats[idx];
    if (!isActive(s)) return { error: 'Ты не в раздаче' };
    if (s.keep) return { error: 'Выбор уже сделан' };
    if (!Array.isArray(keep) || keep.length !== 5 || !keep.every((k) => typeof k === 'boolean')) {
      return { error: 'keep: 5 значений true/false' };
    }
    s.keep = [...keep];
    if (activeSeats().every((a) => a.keep)) applyRerolls();
    onChange();
    return { ok: true };
  }

  // Отключение не сбрасывает карты: ход истечёт по таймеру, а после раздачи игрок встанет.
  function setConnected(player, connected) {
    const idx = seatOf(player);
    if (idx < 0) return;
    seats[idx].connected = connected;
    if (connected) maybeStart();
    onChange();
  }

  // ---------- Время ----------

  function tick() {
    if (deadline === null || now() < deadline) return;
    if (phase === 'starting') {
      startHand();
    } else if (BET_PHASES.has(phase)) {
      const s = seats[turn];
      if (s.committed === currentBet) {
        s.acted = true;
        s.lastAction = 'чек (время)';
        advance();
      } else {
        foldSeat(turn);
      }
    } else if (phase === 'reroll') {
      applyRerolls();
    } else if (phase === 'showdown') {
      endShowdown();
    }
    onChange();
  }

  // ---------- Наружу ----------

  // Состояние глазами viewer (null = зритель). Чужие кубики только во вскрытии (result.hands).
  function view(viewer) {
    const mySeat = viewer ? seatOf(viewer) : -1;
    const me = mySeat >= 0 ? seats[mySeat] : null;
    let you = null;
    if (me) {
      const toCall = Math.max(0, currentBet - me.committed);
      const myTurn = BET_PHASES.has(phase) && turn === mySeat;
      const room = myTurn ? cap() - me.totalBet - toCall : 0;
      const canRaise = myTurn && raises < MAX_RAISES && room >= MIN_BET;
      you = {
        seat: mySeat,
        dice: me.dice,
        hand: me.dice ? evaluate(me.dice).name : null,
        inHand: isActive(me),
        myTurn,
        toCall,
        canCheck: myTurn && toCall === 0,
        canCall: myTurn && toCall > 0,
        canBet: canRaise && currentBet === 0,
        canRaise: canRaise && currentBet > 0,
        minRaise: MIN_BET,
        maxRaise: canRaise ? room : 0,
        needReroll: phase === 'reroll' && isActive(me) && !me.keep,
        keep: me.keep,
        leaving: me.leaving,
      };
    }
    return {
      phase,
      handId,
      pot,
      dealer,
      turn,
      currentBet,
      timeLeft: deadline === null ? null : Math.max(0, deadline - now()),
      ante: ANTE,
      minBuyIn: MIN_BUYIN,
      seats: seats.map((s, i) => s && {
        seat: i,
        id: s.player.id,
        name: s.player.name,
        stack: s.stack,
        committed: s.committed,
        inHand: s.inHand,
        folded: s.folded,
        connected: s.connected,
        leaving: s.leaving,
        rerolled: s.rerolled,
        lastAction: s.lastAction,
        decided: phase === 'reroll' && isActive(s) ? !!s.keep : null,
      }),
      you,
      result: phase === 'showdown' ? result : null,
    };
  }

  // Фишки игрока за столом: стек + то, что он уже внёс в текущий банк.
  function reserved(player) {
    const idx = seatOf(player);
    return idx < 0 ? 0 : seats[idx].stack + seats[idx].totalBet;
  }

  // При остановке сервера: всем вернуть стек и вклад в незавершённый банк.
  function refundAll() {
    seats.forEach((s, i) => {
      if (!s) return;
      seats[i] = null;
      const amount = s.stack + s.totalBet;
      if (amount > 0) store.adjust(s.player, amount);
    });
    pot = 0;
  }

  return {
    join,
    leave,
    act,
    reroll,
    setConnected,
    tick,
    view,
    reserved,
    refundAll,
    isSeated: (player) => seatOf(player) >= 0,
    start: () => { timer = setInterval(tick, 250); },
    stop: () => { clearInterval(timer); timer = null; },
    // Только для тестов.
    _debug: () => ({ phase, pot, dealer, turn, currentBet, seats }),
  };
}

module.exports = {
  evaluate,
  compare,
  isValidDice,
  createTable,
  RANK,
  RANK_NAMES,
  ANTE,
  MIN_BUYIN,
  MIN_BET,
  MAX_RAISES,
  TURN_MS,
  REROLL_MS,
  START_DELAY_MS,
  SHOWDOWN_MS,
};
