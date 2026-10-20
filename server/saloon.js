// «Салун мертвецов» — слот. Исход спина (вместе с дуэлью) считает сервер сразу, клиент показывает
// его анимацией. Ставка списывается сразу и считается «в игре»; выигрыш, лента и рейтинг — когда
// игрок досмотрел (клиент шлёт saloon_done) или вышло время на показ.
const { randomFloat } = require('./rng');
const S = require('./saloon-math');

const MIN_BET = 10;
const FEED_SIZE = 20;
const LUCKY_TRIES = 40;
const MODES = ['spin', 'buy-duel', 'buy-super'];

// Сколько клиент показывает исход (с запасом): после этого выигрыш зачисляется сам.
function showMs(o) {
  let ms = 2600 + o.base.wins.length * 400 + (o.base.bullets ? 2500 : 0) + o.base.expanded.length * 700;
  if (o.duel) ms += 6000 + o.duel.rounds.length * 5200;
  return ms + 15_000;
}

function createSaloon({
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
  let rigged = null;           // админ: 'duel' | 'bullets' | 'lose' для следующего спина
  let seq = 0;

  function spin(player, bet, mode = 'spin') {
    if (!MODES.includes(mode)) return { error: 'Неизвестный режим' };
    if (!Number.isSafeInteger(bet) || bet < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (pending.has(player.id)) return { error: 'Барабаны ещё крутятся' };
    const cost = S.costOf(mode, bet);
    if (!Number.isSafeInteger(cost)) return { error: 'Слишком большая ставка' };
    if (cost > player.balance) return { error: mode === 'spin' ? 'Не хватает фишек' : `Дуэль стоит ${String(cost).replace(/B(?=(d{3})+(?!d))/g, '.')} — не хватает фишек` };

    const rig = rigged;
    rigged = null;
    let outcome = S.play(rand, { mode, rig });
    // Режим везения: ищем исход, который окупает ставку.
    if (!rig && lucky(player)) {
      for (let i = 0; i < LUCKY_TRIES && outcome.mult * bet <= cost; i++) outcome = S.play(rand, { mode });
    }
    const payout = Math.floor(bet * outcome.mult);
    const id = ++seq;
    const d = outcome.duel;
    const maxMult = d ? Math.max(1, ...d.rounds.map((r) => Math.max(1, ...Object.values(r.sticky)))) : 0;

    const settle = () => {
      const p = pending.get(player.id);
      if (!p || p.id !== id) return;
      pending.delete(player.id);
      if (payout > 0) store.adjust(player, payout);
      else store.notify(player);
      feed.unshift({ id, playerId: player.id, name: player.name, bet, cost, payout, mult: outcome.mult, mode, duel: !!d, spins: d ? d.rounds.length : 0, at: now() });
      if (feed.length > FEED_SIZE) feed.pop();
      onFeed(feed.slice());
      const net = payout - cost;
      if (net !== 0) {
        onEvent({
          game: 'saloon',
          kind: net > 0 ? 'win' : 'lose',
          player,
          amount: Math.abs(net),
          note: d ? `дуэль на закате, ${d.rounds.length} вращ.` : `×${outcome.mult}`,
          meta: { stake: cost, mult: outcome.mult, duel: !!d, spins: d ? d.rounds.length : 0, maxMult },
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
    if (![null, 'duel', 'bullets', 'lose'].includes(mode)) return { error: 'Режим: duel, bullets, lose или null' };
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

module.exports = { createSaloon, MIN_BET, showMs };
