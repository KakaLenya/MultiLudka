// Верити: монетка 50 на 50 с характером. Добрый Верити удваивает ставку, злой забирает.
const { randomInt } = require('./rng');

const MIN_BET = 1;
const SPIN_MS = 3200;      // сколько Верити «решает» у игрока
const FEED_SIZE = 20;

function createVerity({
  store,
  onFeed = () => {},
  onEvent = () => {},
  now = Date.now,
  coin = () => randomInt(0, 1) === 1,     // true = добрый
  schedule = (fn, ms) => setTimeout(fn, ms),
  spinMs = SPIN_MS,
}) {
  const busyUntil = new Map();
  const feed = [];
  let rigged = null;          // админ: 'good' | 'evil' для следующей ставки
  let seq = 0;

  function play(player, amount) {
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if ((busyUntil.get(player.id) || 0) > now()) return { error: 'Верити ещё думает' };
    if (amount > player.balance) return { error: 'Не хватает фишек' };

    const good = rigged === 'good' ? true : rigged === 'evil' ? false : coin();
    rigged = null;
    store.adjust(player, good ? amount : -amount);
    busyUntil.set(player.id, now() + spinMs);

    const entry = { id: ++seq, playerId: player.id, name: player.name, amount, good, at: now() };
    // Остальные узнают решение, когда Верити его объявит.
    schedule(() => {
      feed.unshift(entry);
      if (feed.length > FEED_SIZE) feed.pop();
      onFeed(feed.slice());
      onEvent({
        game: 'verity',
        kind: good ? 'win' : 'lose',
        player,
        amount,
        note: good ? 'добрый Верити удвоил' : 'злой Верити забрал',
      });
    }, spinMs);

    return { ok: true, result: { id: entry.id, amount, good, spinMs } };
  }

  function rig(mode) {
    if (mode !== 'good' && mode !== 'evil' && mode !== null) return { error: 'Режим: good, evil или null' };
    rigged = mode;
    return { ok: true };
  }

  return {
    play,
    rig,
    feed: () => feed.slice(),
    adminState: () => ({ rigged, feed: feed.slice() }),
  };
}

module.exports = { createVerity, MIN_BET, SPIN_MS };
