// Апгрейдер: ставка + выбранный шанс. На колесе зелёный сектор размером с шанс,
// стрелка останавливается в случайной точке. Попал в сектор: ставка × (99 / шанс), иначе сгорает.
const { randomFloat } = require('./rng');

const MIN_BET = 10;
const MIN_CHANCE = 1;
const MAX_CHANCE = 95;
const RTP = 99;            // возврат 99%: преимущество казино 1%, как в Краше
const SPIN_MS = 4500;      // сколько крутится колесо у игрока
const FEED_SIZE = 15;

// 30% -> 3.30, 50% -> 1.98, 1% -> 99. Округляем вниз до сотых.
function multiplierFor(chance) {
  return Math.floor((RTP / chance) * 100) / 100;
}

function payoutFor(amount, chance) {
  return Math.floor((amount * Math.round(multiplierFor(chance) * 100)) / 100);
}

// Точка (0..100) попала в сектор [start, start + chance) с переходом через 100.
function inZone(point, start, chance) {
  const d = (((point - start) % 100) + 100) % 100;
  return d < chance;
}

// onFeed(feed): разослать ленту. schedule(fn, ms): отложить (в тестах подменяется).
function createUpgrader({
  store,
  onFeed = () => {},
  onEvent = () => {},   // события для общей ленты ставок и выигрышей
  now = Date.now,
  random = randomFloat,
  schedule = (fn, ms) => setTimeout(fn, ms),
  spinMs = SPIN_MS,
  lucky = () => false,     // админский режим везения
}) {
  const busyUntil = new Map();   // playerId -> когда колесо остановится
  const pending = new Map();     // playerId -> { amount, settle }: ставка в игре, итог ещё не объявлен
  const feed = [];
  let rigged = null;             // админ: 'win' | 'lose' для следующего апгрейда
  let seq = 0;

  function spin(player, amount, chance) {
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (!Number.isInteger(chance) || chance < MIN_CHANCE || chance > MAX_CHANCE) {
      return { error: `Шанс: от ${MIN_CHANCE}% до ${MAX_CHANCE}%` };
    }
    if (pending.has(player.id) || (busyUntil.get(player.id) || 0) > now()) return { error: 'Колесо ещё крутится' };
    if (amount > player.balance) return { error: 'Не хватает фишек' };

    const start = random() * 100;
    let landing;
    if (rigged === 'win') landing = (start + random() * chance) % 100;
    else if (rigged === 'lose') landing = (start + chance + random() * (100 - chance)) % 100;
    else if (lucky(player)) landing = (start + random() * chance) % 100;
    else landing = random() * 100;
    rigged = null;

    const win = inZone(landing, start, chance);
    const payout = win ? payoutFor(amount, chance) : 0;
    busyUntil.set(player.id, now() + spinMs);

    const entry = {
      id: ++seq,
      playerId: player.id,
      name: player.name,
      amount,
      chance,
      multiplier: multiplierFor(chance),
      win,
      payout,
      start: Math.round(start * 100) / 100,      // где был зелёный сектор и где встала стрелка:
      landing: Math.round(landing * 100) / 100,  // по ленте можно проверить любой спорный апгрейд
      at: now(),
    };
    // Ставка сразу «в игре» (капитал не меняется), выигрыш — когда колесо у игрока остановится:
    // тогда же его увидят остальные, рейтинг и достижения.
    const settle = () => {
      if (!pending.has(player.id) || pending.get(player.id).settle !== settle) return;
      pending.delete(player.id);
      if (payout > 0) store.adjust(player, payout);
      else store.notify(player);
      feed.unshift(entry);
      if (feed.length > FEED_SIZE) feed.pop();
      onFeed(feed.slice());
      onEvent({
        game: 'upgrade',
        kind: win ? 'win' : 'lose',
        player,
        amount: win ? payout - amount : amount,
        note: `${chance}% · ×${entry.multiplier.toFixed(2)}`,
        meta: { chance, stake: amount },
      });
    };
    pending.set(player.id, { id: entry.id, amount, settle });
    store.adjust(player, -amount);
    schedule(settle, spinMs);

    return {
      ok: true,
      spin: { id: entry.id, amount, chance, multiplier: entry.multiplier, start, landing, win, payout, spinMs },
    };
  }

  // Колесо у игрока остановилось раньше запаса (анимация бывает короче spinMs): итог объявляем сразу
  // и снимаем блокировку — иначе новый апгрейд ещё пару секунд отвечал «Колесо ещё крутится».
  function done(player, id) {
    const p = pending.get(player.id);
    if (!p || p.id !== id) return;
    p.settle();
    busyUntil.delete(player.id);
  }

  // Админ: исход следующего апгрейда любого игрока. null = честно.
  function rig(mode) {
    if (mode !== 'win' && mode !== 'lose' && mode !== null) return { error: 'Режим: win, lose или null' };
    rigged = mode;
    return { ok: true };
  }

  // Сервер останавливается: объявить все итоги сразу.
  function settleAll() {
    for (const p of [...pending.values()]) p.settle();
  }

  return {
    spin,
    done,
    settleAll,
    reserved: (player) => (pending.has(player.id) ? pending.get(player.id).amount : 0),
    rig,
    feed: () => feed.slice(),
    adminState: () => ({ rigged, feed: feed.slice() }),
  };
}

module.exports = {
  createUpgrader, multiplierFor, payoutFor, inZone, MIN_BET, MIN_CHANCE, MAX_CHANCE, SPIN_MS,
};
