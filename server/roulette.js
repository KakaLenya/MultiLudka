// Рулетка (европейская, одно зеро): один общий стол, раунды betting -> spinning -> result.
const { randomInt } = require('./rng');

const BETTING_MS = 20_000;
const SPIN_MS = 7000;
const RESULT_MS = 5000;
const TICK_MS = 250;
const MIN_BET = 10;
const MAX_BETS = 60;          // разных ставок одного игрока за раунд
const HISTORY_SIZE = 20;

const RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
// Порядок номеров на колесе по часовой стрелке, начиная с зеро.
const WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];

const colorOf = (n) => (n === 0 ? 'green' : RED.has(n) ? 'red' : 'black');

// payout: выигрыш к одному (ставка возвращается сверху).
const BET_TYPES = {
  straight: { payout: 35, wins: (n, num) => n === num },
  red: { payout: 1, wins: (n) => RED.has(n) },
  black: { payout: 1, wins: (n) => n !== 0 && !RED.has(n) },
  even: { payout: 1, wins: (n) => n !== 0 && n % 2 === 0 },
  odd: { payout: 1, wins: (n) => n % 2 === 1 },
  low: { payout: 1, wins: (n) => n >= 1 && n <= 18 },
  high: { payout: 1, wins: (n) => n >= 19 },
  dozen1: { payout: 2, wins: (n) => n >= 1 && n <= 12 },
  dozen2: { payout: 2, wins: (n) => n >= 13 && n <= 24 },
  dozen3: { payout: 2, wins: (n) => n >= 25 },
  column1: { payout: 2, wins: (n) => n !== 0 && n % 3 === 1 },
  column2: { payout: 2, wins: (n) => n !== 0 && n % 3 === 2 },
  column3: { payout: 2, wins: (n) => n !== 0 && n % 3 === 0 },
};

// Сколько вернётся по ставке при выпадении n (0, если проиграла).
function payoutFor(bet, n) {
  const t = BET_TYPES[bet.type];
  return t.wins(n, bet.number) ? bet.amount * (t.payout + 1) : 0;
}

// now, random, timings подменяются в тестах; tick() там дёргается вручную.
// Короткое название ставки для ленты.
const BET_LABELS = {
  red: 'красное', black: 'чёрное', even: 'чёт', odd: 'нечёт', low: '1-18', high: '19-36',
  dozen1: '1-12', dozen2: '13-24', dozen3: '25-36', column1: 'кол. 1', column2: 'кол. 2', column3: 'кол. 3',
};
const betLabel = (b) => (b.type === 'straight' ? `№${b.number}` : BET_LABELS[b.type]);

// onEvent: события для общей ленты ставок и выигрышей.
function createRoulette({ store, onState = () => {}, onEvent = () => {}, now = Date.now, random = () => randomInt(0, 36), timings = {} }) {
  const T = { bettingMs: BETTING_MS, spinMs: SPIN_MS, resultMs: RESULT_MS, ...timings };

  let roundId = 0;
  let phase = 'betting';
  let phaseStartedAt = 0;
  let result = null;          // номер, известен с начала вращения
  let rigged = null;          // админ: номер следующего вращения
  let bets = new Map();       // playerId -> { player, list: [{ type, number, amount }], total, won }
  const history = [];
  let timer = null;

  function newRound(t) {
    roundId += 1;
    phase = 'betting';
    phaseStartedAt = t;
    result = null;
    bets = new Map();
  }

  function settle() {
    for (const b of bets.values()) {
      b.won = b.list.reduce((sum, bet) => sum + payoutFor(bet, result), 0);
      if (b.won > 0) store.adjust(b.player, b.won);
      else store.notify(b.player);  // ставки сгорели: фишки больше не "в игре"
      const net = b.won - b.total;
      if (net !== 0) {
        onEvent({ game: 'roulette', kind: net > 0 ? 'win' : 'lose', player: b.player, amount: Math.abs(net), note: `выпало ${result}` });
      }
    }
    history.unshift(result);
    if (history.length > HISTORY_SIZE) history.pop();
  }

  function advance() {
    const t = now();
    if (phase === 'betting' && t - phaseStartedAt >= T.bettingMs) {
      phase = 'spinning';
      phaseStartedAt += T.bettingMs;
      result = rigged ?? random();
      rigged = null;
      // Ставки закрыты: в ленту уходит, кто сколько и на что поставил.
      for (const b of bets.values()) {
        const labels = b.list.map(betLabel);
        const note = labels.slice(0, 3).join(', ') + (labels.length > 3 ? ` и ещё ${labels.length - 3}` : '');
        onEvent({ game: 'roulette', kind: 'bet', player: b.player, amount: b.total, note });
      }
    }
    if (phase === 'spinning' && t - phaseStartedAt >= T.spinMs) {
      phase = 'result';
      phaseStartedAt += T.spinMs;
      settle();
    }
    if (phase === 'result' && t - phaseStartedAt >= T.resultMs) {
      newRound(phaseStartedAt + T.resultMs);
    }
  }

  function publicState() {
    const elapsed = now() - phaseStartedAt;
    const total = { betting: T.bettingMs, spinning: T.spinMs, result: T.resultMs }[phase];
    return {
      roundId,
      phase,
      timeLeft: Math.max(0, total - elapsed),
      spinMs: T.spinMs,
      // Номер виден только после закрытия ставок: клиенту нужен, чтобы колесо остановилось на нём.
      result: phase === 'betting' ? null : result,
      color: phase === 'betting' ? null : colorOf(result),
      history: history.map((n) => ({ n, color: colorOf(n) })),
      players: [...bets.values()]
        .sort((a, b) => b.total - a.total)
        .map((b) => ({
          id: b.player.id,
          name: b.player.name,
          total: b.total,
          bets: b.list,
          won: phase === 'result' ? b.won : null,
        })),
    };
  }

  function emit() {
    onState(publicState());
  }

  let lastKey = '';
  // Рассылаем при смене фазы и раз в секунду (для таймера); ставки рассылаются сразу.
  function tick() {
    advance();
    const key = `${roundId}:${phase}:${Math.floor((now() - phaseStartedAt) / 1000)}`;
    if (key !== lastKey) {
      lastKey = key;
      emit();
    }
  }

  function bet(player, type, number, amount) {
    advance();
    if (phase !== 'betting') return { error: 'Ставки закрыты, колесо крутится' };
    if (typeof type !== 'string' || !Object.hasOwn(BET_TYPES, type)) return { error: 'Неизвестная ставка' };
    if (type === 'straight') {
      if (!Number.isInteger(number) || number < 0 || number > 36) return { error: 'Номер от 0 до 36' };
    } else {
      number = null;
    }
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (amount > player.balance) return { error: 'Не хватает фишек' };

    let b = bets.get(player.id);
    const same = b && b.list.find((x) => x.type === type && x.number === number);
    if (b && !same && b.list.length >= MAX_BETS) return { error: `Не больше ${MAX_BETS} ставок за раунд` };

    // Сначала записываем ставку, потом списываем: капитал в рассылке баланса сразу верный.
    if (!b) {
      b = { player, list: [], total: 0, won: 0 };
      bets.set(player.id, b);
    }
    if (same) same.amount += amount;
    else b.list.push({ type, number, amount });
    b.total += amount;
    store.adjust(player, -amount);
    emit();
    return { ok: true };
  }

  // Снять все свои ставки, пока идёт приём.
  function clear(player) {
    advance();
    if (phase !== 'betting') return { error: 'Ставки уже не снять' };
    const b = bets.get(player.id);
    if (!b) return { error: 'Ставок нет' };
    bets.delete(player.id);
    store.adjust(player, b.total);
    emit();
    return { ok: true };
  }

  function reserved(player) {
    const b = bets.get(player.id);
    return b && phase !== 'result' ? b.total : 0;
  }

  // При остановке сервера: вернуть ставки неразыгранного раунда.
  function refundActive() {
    if (phase === 'result') return;
    for (const b of bets.values()) store.adjust(b.player, b.total);
    bets = new Map();
  }

  // Админ: номер следующего вращения (если колесо уже крутится, то через раунд).
  function rig(n) {
    if (!Number.isInteger(n) || n < 0 || n > 36) return { error: 'Номер от 0 до 36' };
    rigged = n;
    advance();
    return { ok: true, round: phase === 'betting' ? 'current' : 'next' };
  }

  function adminState() {
    advance();
    return { ...publicState(), result, rigged };
  }

  return {
    start() {
      newRound(now());
      timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          console.error('Рулетка: ошибка в тике', err);
        }
      }, TICK_MS);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
    tick,
    bet,
    clear,
    reserved,
    refundActive,
    rig,
    adminState,
    state: () => { advance(); return publicState(); },
    // Только для тестов.
    _reset: (t = now()) => newRound(t),
  };
}

module.exports = {
  createRoulette, payoutFor, colorOf, BET_TYPES, WHEEL, RED, MIN_BET, BETTING_MS, SPIN_MS, RESULT_MS,
};
