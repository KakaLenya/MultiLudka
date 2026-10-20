// Колесо фортуны: одно общее колесо на весь зал, раунды betting -> spinning -> result.
// Ставят на цвет (множитель). Выпал твой цвет — ставка умножается, иначе сгорает.
// На колесе 61 сектор: 30 ×2, 20 ×3, 6 ×10, 1 ×60 и 4 черепа (не платит никому).
// Каждая ставка в среднем возвращает 60/61 ≈ 98.4% — чуть лучше рулетки (97.3%).
const { randomInt } = require('./rng');

const BETTING_MS = 15_000;
const SPIN_MS = 9000;
const RESULT_MS = 4000;
const TICK_MS = 250;
const MIN_BET = 1;
const HISTORY_SIZE = 24;

const BET_MULTS = [2, 3, 10, 60];
const COUNTS = { 60: 1, 10: 6, 0: 4, 3: 20, 2: 30 };

// Раскладка: редкие сектора расставляем равномерно, остальное — ×2 и ×3 вперемешку.
function buildWheel() {
  const counts = Object.entries(COUNTS);
  const n = counts.reduce((s, [, c]) => s + c, 0);
  const slots = new Array(n).fill(null);
  const offsets = { 60: 0, 10: 5, 0: 13, 3: 1.4 };
  for (const mult of [60, 10, 0, 3]) {
    const count = COUNTS[mult];
    for (let k = 0; k < count; k++) {
      let i = Math.round(offsets[mult] + (k * n) / count) % n;
      while (slots[i] !== null) i = (i + 1) % n;
      slots[i] = Number(mult);
    }
  }
  return slots.map((m) => (m === null ? 2 : m));
}
const WHEEL = buildWheel();
const SEGMENTS = WHEEL.length;

const multLabel = (m) => (m === 0 ? '💀' : `×${m}`);

function createWheel({ store, onState = () => {}, onEvent = () => {}, now = Date.now, random = () => randomInt(0, SEGMENTS - 1), timings = {}, lucky = () => false }) {
  const T = { bettingMs: BETTING_MS, spinMs: SPIN_MS, resultMs: RESULT_MS, ...timings };

  let roundId = 0;
  let phase = 'betting';
  let phaseStartedAt = 0;
  let result = null;          // индекс сектора, известен с начала вращения
  let rigged = null;          // админ: множитель следующего вращения (0 — череп)
  let bets = new Map();       // playerId -> { player, stakes: { 2: n, 3: n, ... }, total, won }
  const history = [];
  let timer = null;

  function newRound(t) {
    roundId += 1;
    phase = 'betting';
    phaseStartedAt = t;
    result = null;
    bets = new Map();
  }

  const winOf = (b, seg) => (b.stakes[WHEEL[seg]] || 0) * WHEEL[seg];

  function segmentOf(mult) {
    const list = WHEEL.map((m, i) => (m === mult ? i : -1)).filter((i) => i >= 0);
    return list[randomInt(0, list.length - 1)];
  }

  // Сектор, на котором все везунчики раунда в плюсе (или хотя бы первый). null — везения нет.
  function luckyResult() {
    const favoured = [...bets.values()].filter((b) => lucky(b.player));
    if (!favoured.length) return null;
    const all = WHEEL.map((_, i) => i);
    let good = all.filter((i) => favoured.every((b) => winOf(b, i) > b.total));
    if (!good.length) good = all.filter((i) => winOf(favoured[0], i) > favoured[0].total);
    return good.length ? good[randomInt(0, good.length - 1)] : null;
  }

  function settle() {
    const mult = WHEEL[result];
    for (const b of bets.values()) {
      b.won = winOf(b, result);
      if (b.won > 0) store.adjust(b.player, b.won);
      else store.notify(b.player);  // ставки сгорели: фишки больше не "в игре"
      const net = b.won - b.total;
      if (net !== 0) {
        const hit = b.won > 0;
        onEvent({
          game: 'wheel', kind: net > 0 ? 'win' : 'lose', player: b.player, amount: Math.abs(net), note: `выпало ${multLabel(mult)}`,
          meta: { mult, gold: hit && mult === 60, skull: mult === 0 },
        });
      }
    }
    history.unshift(mult);
    if (history.length > HISTORY_SIZE) history.pop();
  }

  function advance() {
    const t = now();
    if (phase === 'betting' && t - phaseStartedAt >= T.bettingMs) {
      phase = 'spinning';
      phaseStartedAt += T.bettingMs;
      result = rigged !== null ? segmentOf(rigged) : luckyResult() ?? random();
      rigged = null;
      // Ставки закрыты: в ленту уходит, кто сколько и на что поставил.
      for (const b of bets.values()) {
        const note = BET_MULTS.filter((m) => b.stakes[m]).map((m) => `×${m}`).join(', ');
        onEvent({ game: 'wheel', kind: 'bet', player: b.player, amount: b.total, note, meta: { stake: b.total } });
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
    const pots = Object.fromEntries(BET_MULTS.map((m) => [m, 0]));
    for (const b of bets.values()) for (const m of BET_MULTS) pots[m] += b.stakes[m] || 0;
    return {
      roundId,
      phase,
      timeLeft: Math.max(0, total - elapsed),
      spinMs: T.spinMs,
      // Сектор виден только после закрытия ставок: клиенту нужен, чтобы колесо остановилось на нём.
      result: phase === 'betting' ? null : result,
      mult: phase === 'betting' ? null : WHEEL[result],
      history,
      pots,
      players: [...bets.values()]
        .sort((a, b) => b.total - a.total)
        .map((b) => ({
          id: b.player.id,
          name: b.player.name,
          total: b.total,
          stakes: b.stakes,
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

  function bet(player, mult, amount) {
    advance();
    if (phase !== 'betting') return { error: 'Ставки закрыты, колесо крутится' };
    if (!BET_MULTS.includes(mult)) return { error: 'Ставить можно на ×2, ×3, ×10 или ×60' };
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (amount > player.balance) return { error: 'Не хватает фишек' };

    // Сначала записываем ставку, потом списываем: капитал в рассылке баланса сразу верный.
    let b = bets.get(player.id);
    if (!b) {
      b = { player, stakes: {}, total: 0, won: 0 };
      bets.set(player.id, b);
    }
    b.stakes[mult] = (b.stakes[mult] || 0) + amount;
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

  // Админ: множитель следующего вращения (если колесо уже крутится, то через раунд).
  function rig(mult) {
    if (![0, ...BET_MULTS].includes(mult)) return { error: 'Множитель: 0 (череп), 2, 3, 10 или 60' };
    rigged = mult;
    advance();
    return { ok: true, round: phase === 'betting' ? 'current' : 'next' };
  }

  function adminState() {
    advance();
    return { ...publicState(), result, mult: result === null ? null : WHEEL[result], rigged };
  }

  // Игрока удалили: его ставки пропадают вместе с ним.
  function forget(playerId) {
    if (bets.delete(playerId)) emit();
  }

  return {
    start() {
      newRound(now());
      timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          console.error('Колесо: ошибка в тике', err);
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
    forget,
    adminState,
    state: () => { advance(); return publicState(); },
    // Только для тестов.
    _reset: (t = now()) => newRound(t),
  };
}

module.exports = {
  createWheel, WHEEL, SEGMENTS, BET_MULTS, COUNTS, MIN_BET, BETTING_MS, SPIN_MS, RESULT_MS, multLabel,
};
