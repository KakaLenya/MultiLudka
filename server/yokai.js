// «Ночной парад ста демонов» — слот. Исход спина (весь парад и ночь) считает сервер сразу, клиент
// показывает его анимацией. Ставка списывается сразу и считается «в игре»; выигрыш, лента и рейтинг —
// когда игрок досмотрел (клиент шлёт yokai_done) или вышло время на показ.
const { randomFloat } = require('./rng');
const Y = require('./yokai-math');

const MIN_BET = 10;
const FEED_SIZE = 20;
const LUCKY_TRIES = 40;
const MODES = ['spin', 'buy-bonus'];

// Сколько клиент показывает исход (с запасом): после этого выигрыш зачисляется сам.
function showMs(o) {
  const stepMs = (s) => 1600 + s.wins.length * 450 + s.arrived.length * 600;
  let ms = o.base.steps.reduce((t, s) => t + stepMs(s), 0);
  if (o.night) ms += 6000 + o.night.steps.reduce((t, s) => t + stepMs(s) + 300, 0);
  return ms + 15_000;
}

function createYokai({
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
  let rigged = null;           // админ: 'bonus' | 'fox' | 'lose' для следующего спина
  let seq = 0;

  function spin(player, bet, mode = 'spin') {
    if (!MODES.includes(mode)) return { error: 'Неизвестный режим' };
    if (!Number.isSafeInteger(bet) || bet < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (pending.has(player.id)) return { error: 'Парад ещё идёт' };
    const cost = Y.costOf(mode, bet);
    if (!Number.isSafeInteger(cost)) return { error: 'Слишком большая ставка' };
    if (cost > player.balance) return { error: mode === 'spin' ? 'Не хватает фишек' : `Ночь стоит ${String(cost).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} — не хватает фишек` };

    const rig = rigged;
    rigged = null;
    let outcome = Y.play(rand, { mode, rig });
    // Режим везения: ищем исход, который окупает ставку.
    if (!rig && lucky(player)) {
      for (let i = 0; i < LUCKY_TRIES && Math.floor(outcome.mult * bet) <= cost; i++) outcome = Y.play(rand, { mode });
    }
    const payout = Math.floor(bet * outcome.mult);
    const id = ++seq;
    const n = outcome.night;
    const allSteps = [...outcome.base.steps, ...(n ? n.steps : [])];
    const maxTails = Math.max(0, ...allSteps.flatMap((s) => s.foxes.map((f) => f.tails)));
    const parade = outcome.base.steps.length - 1;

    const settle = () => {
      const p = pending.get(player.id);
      if (!p || p.id !== id) return;
      pending.delete(player.id);
      if (payout > 0) store.adjust(player, payout);
      else store.notify(player);
      feed.unshift({ id, playerId: player.id, name: player.name, bet, cost, payout, mult: outcome.mult, mode, night: !!n, parade, at: now() });
      if (feed.length > FEED_SIZE) feed.pop();
      onFeed(feed.slice());
      const net = payout - cost;
      if (net !== 0) {
        onEvent({
          game: 'yokai',
          kind: net > 0 ? 'win' : 'lose',
          player,
          amount: Math.abs(net),
          note: n ? `ночь ста демонов, ${n.steps.length} вращ.` : parade ? `парад, ${parade} шаг.` : `×${outcome.mult}`,
          meta: { stake: cost, mult: outcome.mult, night: !!n, parade, maxTails },
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
    if (![null, 'bonus', 'fox', 'lose'].includes(mode)) return { error: 'Режим: bonus, fox, lose или null' };
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

module.exports = { createYokai, MIN_BET, showMs };
