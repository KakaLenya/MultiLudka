// Верити: монетка 50 на 50 с характером. Добрый Верити удваивает ставку, злой забирает.
// Серия: после победы можно поставить весь выигрыш ещё раз — ×2, ×4, ×8… от первой ставки.
// Злой Верити обрывает серию и съедает всё, что в ней накоплено.
const { randomInt } = require('./rng');

const MIN_BET = 1;
const SPIN_MS = 5000;      // Верити решает и разыгрывает сценку у игрока; итог объявляется после неё
const FEED_SIZE = 20;

function createVerity({
  store,
  onFeed = () => {},
  onEvent = () => {},
  now = Date.now,
  coin = () => randomInt(0, 1) === 1,     // true = добрый
  schedule = (fn, ms) => setTimeout(fn, ms),
  spinMs = SPIN_MS,
  lucky = () => false,     // админский режим везения
}) {
  const busyUntil = new Map();
  const pending = new Map();  // playerId -> { amount, settle }: ставка в игре, итог ещё не объявлен
  const series = new Map();   // playerId -> { base, streak, next }: можно продолжить серию ставкой next
  const feed = [];
  let rigged = null;          // админ: 'good' | 'evil' для следующей ставки
  let seq = 0;

  // continueSeries: поставить весь прошлый выигрыш (сумму берём из серии, а не от клиента).
  function play(player, amount, { continueSeries = false } = {}) {
    if (pending.has(player.id) || (busyUntil.get(player.id) || 0) > now()) return { error: 'Верити ещё думает' };
    let base = amount;
    let streak = 1;
    if (continueSeries) {
      const s = series.get(player.id);
      if (!s) return { error: 'Серии нет: сначала выиграй' };
      amount = s.next;
      base = s.base;
      streak = s.streak + 1;
    }
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (amount > player.balance) return { error: 'Не хватает фишек' };
    series.delete(player.id);

    const good = rigged === 'good' ? true : rigged === 'evil' ? false : lucky(player) || coin();
    rigged = null;
    busyUntil.set(player.id, now() + spinMs);

    const entry = { id: ++seq, playerId: player.id, name: player.name, amount, good, streak, at: now() };
    // Ставка сразу «в игре», выигрыш и решение для всех — когда Верити его объявит.
    const settle = () => {
      if (!pending.has(player.id) || pending.get(player.id).settle !== settle) return;
      pending.delete(player.id);
      if (good) {
        store.adjust(player, 2 * amount);
        series.set(player.id, { base, streak, next: 2 * amount });
      } else store.notify(player);
      feed.unshift(entry);
      if (feed.length > FEED_SIZE) feed.pop();
      onFeed(feed.slice());
      onEvent({
        game: 'verity',
        kind: good ? 'win' : 'lose',
        player,
        amount,
        note: good ? (streak > 1 ? `серия ×${2 ** streak}` : 'добрый Верити удвоил') : (streak > 1 ? `оборвал серию на ×${2 ** (streak - 1)}` : 'злой Верити забрал'),
        meta: { good, stake: amount, streak },
      });
    };
    pending.set(player.id, { amount, settle });
    store.adjust(player, -amount);
    schedule(settle, spinMs);

    return { ok: true, result: { id: entry.id, amount, good, spinMs, streak, base } };
  }

  function rig(mode) {
    if (mode !== 'good' && mode !== 'evil' && mode !== null) return { error: 'Режим: good, evil или null' };
    rigged = mode;
    return { ok: true };
  }

  // Сервер останавливается: объявить все решения сразу.
  function settleAll() {
    for (const p of [...pending.values()]) p.settle();
  }

  return {
    play,
    rig,
    settleAll,
    reserved: (player) => (pending.has(player.id) ? pending.get(player.id).amount : 0),
    feed: () => feed.slice(),
    // Серия игрока: { base, streak, next } или null.
    seriesOf: (player) => series.get(player.id) || null,
    forget: (playerId) => series.delete(playerId),
    adminState: () => ({ rigged, feed: feed.slice() }),
  };
}

module.exports = { createVerity, MIN_BET, SPIN_MS };
