// «Кракен: сундук глубин» — слот. Исход спина (вместе со всеми бонусами) считает сервер сразу,
// клиент показывает его анимацией. Ставка списывается сразу и считается «в игре»; выигрыш, лента
// и рейтинг — когда игрок досмотрел (клиент шлёт kraken_done) или вышло время на показ.
const { randomFloat } = require('./rng');
const K = require('./kraken-math');

const MIN_BET = 10;
const FEED_SIZE = 20;
const LUCKY_TRIES = 40;
const MODES = ['spin', 'buy-fs', 'buy-hw'];

// Сколько клиент показывает исход (с запасом): после этого выигрыш зачисляется сам.
function showMs(o) {
  let ms = 2600 + o.base.wins.length * 300 + (o.base.tentacle ? 2500 : 0) + (o.base.collect ? 1500 : 0);
  if (o.hw) ms += 4000 + o.hw.rounds.length * 1400;
  if (o.fs) ms += 5000 + o.fs.spins.length * 3200;
  return ms + 15_000;
}

function createKraken({
  store,
  onEvent = () => {},
  onFeed = () => {},
  now = Date.now,
  rand = randomFloat,
  schedule = (fn, ms) => setTimeout(fn, ms),
  lucky = () => false,
}) {
  const pending = new Map();   // playerId -> { id, cost, settle }
  const feed = [];
  let rigged = null;           // админ: 'fs' | 'hw' | 'tentacle' | 'lose' | 'ships' для следующего спина
  let seq = 0;

  function spin(player, bet, mode = 'spin') {
    if (!MODES.includes(mode)) return { error: 'Неизвестный режим' };
    if (!Number.isSafeInteger(bet) || bet < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (pending.has(player.id)) return { error: 'Барабаны ещё крутятся' };
    const cost = K.costOf(mode, bet);
    if (!Number.isSafeInteger(cost)) return { error: 'Слишком большая ставка' };
    if (cost > player.balance) return { error: mode === 'spin' ? 'Не хватает фишек' : `Бонус стоит ${String(cost).replace(/B(?=(d{3})+(?!d))/g, '.')} — не хватает фишек` };

    const rig = rigged;
    rigged = null;
    let outcome = K.play(rand, { mode, rig });
    // Режим везения: ищем исход, который окупает ставку.
    if (!rig && lucky(player)) {
      for (let i = 0; i < LUCKY_TRIES && outcome.mult * bet <= cost; i++) outcome = K.play(rand, { mode });
    }
    const payout = Math.floor(bet * outcome.mult);
    const id = ++seq;
    const bonus = outcome.fs && outcome.hw ? 'both' : outcome.fs ? 'fs' : outcome.hw ? 'hw' : null;

    const settle = () => {
      const p = pending.get(player.id);
      if (!p || p.id !== id) return;
      pending.delete(player.id);
      if (payout > 0) store.adjust(player, payout);
      else store.notify(player);
      feed.unshift({ id, playerId: player.id, name: player.name, bet, cost, payout, mult: outcome.mult, mode, bonus, at: now() });
      if (feed.length > FEED_SIZE) feed.pop();
      onFeed(feed.slice());
      const net = payout - cost;
      if (net !== 0) {
        onEvent({
          game: 'kraken',
          kind: net > 0 ? 'win' : 'lose',
          player,
          amount: Math.abs(net),
          note: bonus === 'fs' ? 'фриспины' : bonus === 'hw' ? 'сундук глубин' : bonus === 'both' ? 'сундук и фриспины' : `×${outcome.mult}`,
          meta: {
            stake: cost, mult: outcome.mult, bonus, grand: !!(outcome.hw && outcome.hw.full), level: outcome.fs ? outcome.fs.spins.at(-1).level : 0,
          },
        });
      }
    };
    pending.set(player.id, { id, cost, settle });
    store.adjust(player, -cost);
    schedule(settle, showMs(outcome));
    return { ok: true, result: { id, bet, cost, mode, payout, outcome } };
  }

  // Клиент досмотрел анимацию.
  function done(player, id) {
    const p = pending.get(player.id);
    if (p && p.id === id) p.settle();
  }

  function rig(mode) {
    if (![null, 'fs', 'hw', 'tentacle', 'lose', 'ships'].includes(mode)) return { error: 'Режим: fs, hw, tentacle, lose, ships или null' };
    rigged = mode;
    return { ok: true };
  }

  return {
    spin,
    done,
    rig,
    settleAll: () => { for (const p of [...pending.values()]) p.settle(); },
    reserved: (player) => (pending.has(player.id) ? pending.get(player.id).cost : 0),
    forget: (playerId) => pending.delete(playerId),
    feed: () => feed.slice(),
    adminState: () => ({ rigged, feed: feed.slice() }),
  };
}

module.exports = { createKraken, MIN_BET, showMs };
