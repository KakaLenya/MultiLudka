// Краш: один общий стол, раунды по кругу betting -> running -> crashed.
// Все множители хранятся в сотых (целые "центы"): 198 = x1.98. Так нет ошибок округления.
const { randomFloat } = require('./rng');

const BETTING_MS = 8000;
const PAUSE_MS = 4000;
const TICK_MS = 100;
const GROWTH = 0.07;          // m(t) = exp(0.07 * t), t в секундах
const MAX_CENTS = 10000;      // потолок x100
const MIN_BET = 10;
const MIN_AUTO_CENTS = 101;
const HISTORY_SIZE = 20;

// r в [0, 1). Преимущество казино 1%: P(краш >= x) = 0.99 / x.
// Около 2% раундов крашатся сразу на x1.00 (r < 1 - 99/101).
function crashPointCents(r) {
  return Math.min(MAX_CENTS, Math.max(100, Math.floor(99 / (1 - r))));
}

function multiplierCents(elapsedMs) {
  return Math.floor(100 * Math.exp((GROWTH * elapsedMs) / 1000));
}

function payoutFor(amount, cents) {
  return Math.floor((amount * cents) / 100);
}

// Автовывод от клиента: число (x2.5) или пусто. -> { cents } или { error }
function parseAutoCashout(raw) {
  if (raw === undefined || raw === null) return { cents: null };
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return { error: 'Автовывод должен быть числом' };
  const cents = Math.round(raw * 100);
  if (cents < MIN_AUTO_CENTS || cents > MAX_CENTS) return { error: 'Автовывод: от x1.01 до x100' };
  return { cents };
}

// store: хранилище игроков. onState(state): рассылка состояния.
// now, random, timings подменяются в тестах; там же tick() дёргается вручную.
// onEvent: события для общей ленты ставок и выигрышей.
function createCrashGame({ store, onState = () => {}, onEvent = () => {}, now = Date.now, random = randomFloat, timings = {} }) {
  const bettingMs = timings.bettingMs ?? BETTING_MS;
  const pauseMs = timings.pauseMs ?? PAUSE_MS;

  let roundId = 0;
  let phase = 'betting';
  let phaseStartedAt = 0;
  let crashCents = 100;     // секрет раунда, наружу только после краха
  let currentCents = 100;
  let bets = new Map();     // playerId -> { player, amount, autoCents, cashedOutCents, payout }
  const history = [];
  let timer = null;
  let riggedCents = null;   // админ: точка краха следующего раунда

  function newRound(t) {
    roundId += 1;
    phase = 'betting';
    phaseStartedAt = t;
    crashCents = riggedCents ?? crashPointCents(random());
    riggedCents = null;
    currentCents = 100;
    bets = new Map();
  }

  function payOut(bet, cents) {
    bet.cashedOutCents = cents;
    bet.payout = payoutFor(bet.amount, cents);
    store.adjust(bet.player, bet.payout);
    onEvent({ game: 'crash', kind: 'win', player: bet.player, amount: bet.payout - bet.amount, note: `забрал на ${(cents / 100).toFixed(2)}×` });
  }

  function crash(t) {
    phase = 'crashed';
    phaseStartedAt = t;
    currentCents = crashCents;
    history.unshift(crashCents);
    if (history.length > HISTORY_SIZE) history.pop();
    // Проигравшие: баланс не меняется, но фишки больше не "в игре".
    for (const bet of bets.values()) {
      if (bet.cashedOutCents === null) {
        store.notify(bet.player);
        onEvent({ game: 'crash', kind: 'lose', player: bet.player, amount: bet.amount, note: `краш на ${(crashCents / 100).toFixed(2)}×` });
      }
    }
  }

  // Доводит раунд до текущего момента. Вызывается тиком и перед каждой командой игрока,
  // поэтому "забрать" в момент краха сравнивается с реальным временем, а не с последним тиком.
  function advance() {
    const t = now();
    // Границы фаз считаем от расписания, а не от момента тика: иначе полёт стартует с опозданием.
    if (phase === 'betting' && t - phaseStartedAt >= bettingMs) {
      phase = 'running';
      phaseStartedAt += bettingMs;
    }
    if (phase === 'running') {
      const cents = Math.min(multiplierCents(t - phaseStartedAt), crashCents);
      // Автовывод строго ниже точки краха исполняется ровно по своему множителю,
      // даже если тик перескочил через него.
      for (const bet of bets.values()) {
        if (bet.cashedOutCents === null && bet.autoCents !== null
            && bet.autoCents <= cents && bet.autoCents < crashCents) {
          payOut(bet, bet.autoCents);
        }
      }
      currentCents = cents;
      if (cents >= crashCents) crash(t);
    }
    if (phase === 'crashed' && t - phaseStartedAt >= pauseMs) newRound(phaseStartedAt + pauseMs);
  }

  function publicState() {
    const elapsed = now() - phaseStartedAt;
    return {
      roundId,
      phase,
      multiplier: currentCents / 100,
      elapsed: phase === 'running' ? elapsed : null,
      timeLeft: phase === 'betting' ? Math.max(0, bettingMs - elapsed)
        : phase === 'crashed' ? Math.max(0, pauseMs - elapsed) : null,
      history: history.map((c) => c / 100),
      players: [...bets.values()]
        .sort((a, b) => b.amount - a.amount)
        .map((b) => ({
          id: b.player.id,
          name: b.player.name,
          amount: b.amount,
          cashout: b.cashedOutCents === null ? null : b.cashedOutCents / 100,
          payout: b.payout,
        })),
    };
  }

  function emit() {
    onState(publicState());
  }

  function tick() {
    advance();
    emit();
  }

  function bet(player, amount, autoCashout) {
    advance();
    if (phase !== 'betting') return { error: 'Ставки закрыты, дождись следующего раунда' };
    if (bets.has(player.id)) return { error: 'Ты уже поставил в этом раунде' };
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (amount > player.balance) return { error: 'Не хватает фишек' };
    const auto = parseAutoCashout(autoCashout);
    if (auto.error) return { error: auto.error };

    // Сначала регистрируем ставку, потом списываем: тогда капитал в рассылке баланса уже верный.
    bets.set(player.id, { player, amount, autoCents: auto.cents, cashedOutCents: null, payout: 0 });
    store.adjust(player, -amount);
    onEvent({ game: 'crash', kind: 'bet', player, amount, note: auto.cents ? `автовывод ${(auto.cents / 100).toFixed(2)}×` : '' });
    emit();
    return { ok: true };
  }

  function cashout(player) {
    advance();
    const b = bets.get(player.id);
    if (!b) return { error: 'В этом раунде у тебя нет ставки' };
    if (b.cashedOutCents !== null) return { error: 'Уже забрал' };
    if (phase === 'betting') return { error: 'Раунд ещё не начался' };
    if (phase === 'crashed') return { error: 'Поздно, уже крашнулось' };
    payOut(b, currentCents);
    emit();
    return { ok: true, payout: b.payout };
  }

  // Фишки игрока, которые сейчас стоят в раунде.
  function reserved(player) {
    const b = bets.get(player.id);
    return b && b.cashedOutCents === null && phase !== 'crashed' ? b.amount : 0;
  }

  // При остановке сервера: вернуть ставки незавершённого раунда.
  function refundActive() {
    if (phase === 'crashed') return;
    for (const b of bets.values()) {
      if (b.cashedOutCents === null) {
        b.cashedOutCents = 100;
        store.adjust(b.player, b.amount);
      }
    }
  }

  // ---------- Админ ----------

  // Подкрутка: если ставки ещё принимаются, меняем текущий раунд, иначе следующий.
  function rig(multiplier) {
    const cents = Math.round(Number(multiplier) * 100);
    if (!Number.isSafeInteger(cents) || cents < 100 || cents > MAX_CENTS) return { error: 'Множитель от 1.00 до 100' };
    advance();
    if (phase === 'betting') {
      crashCents = cents;
      return { ok: true, round: 'current' };
    }
    riggedCents = cents;
    return { ok: true, round: 'next' };
  }

  // Крашнуть прямо сейчас на текущем множителе.
  function crashNow() {
    advance();
    if (phase !== 'running') return { error: 'Сейчас ничего не летит' };
    crashCents = currentCents;
    crash(now());
    emit();
    return { ok: true, at: crashCents / 100 };
  }

  function adminState() {
    const s = publicState();
    return {
      ...s,
      crashPoint: crashCents / 100,
      rigged: riggedCents === null ? null : riggedCents / 100,
    };
  }

  function start() {
    newRound(now());
    // Ошибка в одном тике не должна ронять сервер.
    timer = setInterval(() => {
      try {
        tick();
      } catch (err) {
        console.error('Краш: ошибка в тике', err);
      }
    }, TICK_MS);
  }

  function stop() {
    clearInterval(timer);
    timer = null;
  }

  return {
    start,
    stop,
    tick,
    bet,
    cashout,
    reserved,
    refundActive,
    state: () => { advance(); return publicState(); },
    rig,
    crashNow,
    adminState: () => { advance(); return adminState(); },
    // Только для тестов.
    _reset: (t = now()) => newRound(t),
  };
}

module.exports = {
  createCrashGame,
  crashPointCents,
  multiplierCents,
  payoutFor,
  parseAutoCashout,
  MIN_BET,
  BETTING_MS,
  PAUSE_MS,
};
