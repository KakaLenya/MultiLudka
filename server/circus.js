// «Заброшенный цирк» — слот. Исход спина (ход, модификатор, метатель ножей) считает сервер сразу,
// клиент показывает его анимацией. Ставка списывается сразу и считается «в игре»; выигрыш, лента и
// рейтинг — когда игрок досмотрел (клиент шлёт circus_done) или вышло время на показ.
const { randomFloat } = require('./rng');
const C = require('./circus-math');

const MIN_BET = 10;
const FEED_SIZE = 20;
const LUCKY_TRIES = 40;
const MODES = ['spin', 'buy-knives'];

// Сколько клиент показывает исход (с запасом): после этого выигрыш зачисляется сам.
// Метатель ждёт, пока игрок сам выберет сектор, поэтому на него запас побольше.
function showMs(o) {
  let ms = o.steps.reduce((t, s) => t + 2600 + s.wins.length * 500, 0);
  if (o.knives) ms += 60_000 + o.knives.throws.length * 2500;
  return ms + 15_000;
}

function createCircus({
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
  let rigged = null;           // админ: 'knives' | 'hoops' | 'lose' для следующего спина
  let seq = 0;

  function spin(player, bet, mode = 'spin') {
    if (!MODES.includes(mode)) return { error: 'Неизвестный режим' };
    if (!Number.isSafeInteger(bet) || bet < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (pending.has(player.id)) return { error: 'Представление ещё идёт' };
    const cost = C.costOf(mode, bet);
    if (!Number.isSafeInteger(cost)) return { error: 'Слишком большая ставка' };
    if (cost > player.balance) return { error: mode === 'spin' ? 'Не хватает фишек' : `Метатель стоит ${String(cost).replace(/\B(?=(\d{3})+(?!\d))/g, '.')} — не хватает фишек` };

    const rig = rigged;
    rigged = null;
    let outcome = C.play(rand, { mode, rig });
    // Режим везения: ищем исход, который окупает ставку.
    if (!rig && lucky(player)) {
      for (let i = 0; i < LUCKY_TRIES && Math.floor(outcome.mult * bet) <= cost; i++) outcome = C.play(rand, { mode });
    }
    const payout = Math.floor(bet * outcome.mult);
    const id = ++seq;
    const k = outcome.knives;
    const mods = outcome.steps.map((s) => s.mod.type);

    const settle = () => {
      const p = pending.get(player.id);
      if (!p || p.id !== id) return;
      pending.delete(player.id);
      if (payout > 0) store.adjust(player, payout);
      else store.notify(player);
      feed.unshift({ id, playerId: player.id, name: player.name, bet, cost, payout, mult: outcome.mult, mode, knives: !!k, mod: mods[0], at: now() });
      if (feed.length > FEED_SIZE) feed.pop();
      onFeed(feed.slice());
      const net = payout - cost;
      if (net !== 0) {
        onEvent({
          game: 'circus',
          kind: net > 0 ? 'win' : 'lose',
          player,
          amount: Math.abs(net),
          note: k ? `метатель ножей, ${k.throws.length} бросков` : `${C.MOD_NAMES[mods[0]].toLowerCase()}, ×${outcome.mult}`,
          meta: { stake: cost, mult: outcome.mult, knives: !!k, assistant: !!(k && k.assistant), top: !!(k && k.throws.some((i) => k.board[i] === Math.max(...k.board.filter((x) => typeof x === 'number')))), mods },
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
    if (![null, 'knives', 'hoops', 'lose'].includes(mode)) return { error: 'Режим: knives, hoops, lose или null' };
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

module.exports = { createCircus, MIN_BET, showMs };
