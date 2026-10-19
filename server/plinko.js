// Плинко: шарик падает сквозь пирамиду штырьков, на каждом ряду уходит влево или вправо (50 на 50),
// и попадает в лунку с множителем. Путь выбирает сервер; браузер только доводит шарик по этому пути.
// Ставка «в игре», пока шарик летит; выигрыш, лента и достижения — когда он упал в лунку.
const { randomInt } = require('./rng');

const MIN_BET = 1;
const MAX_IN_FLIGHT = 40;          // столько шариков одного игрока может лететь сразу (зажатый пробел — ~20)
const FEED_SIZE = 20;
const ROW_MS = 170;                // шарик проходит ряд
const LAND_MS = 450;               // и ещё немного прыгает в лунке

// Множители по лункам (слева направо) для 8, 12 и 16 рядов и трёх рисков. Отдача — около 99%.
const MULTIPLIERS = {
  8: {
    low: [5.6, 2.1, 1.1, 1, 0.5, 1, 1.1, 2.1, 5.6],
    medium: [13, 3, 1.3, 0.7, 0.4, 0.7, 1.3, 3, 13],
    high: [29, 4, 1.5, 0.3, 0.2, 0.3, 1.5, 4, 29],
  },
  12: {
    low: [10, 3, 1.6, 1.4, 1.1, 1, 0.5, 1, 1.1, 1.4, 1.6, 3, 10],
    medium: [33, 11, 4, 2, 1.1, 0.6, 0.3, 0.6, 1.1, 2, 4, 11, 33],
    high: [170, 24, 8.1, 2, 0.7, 0.2, 0.2, 0.2, 0.7, 2, 8.1, 24, 170],
  },
  16: {
    low: [16, 9, 2, 1.4, 1.4, 1.2, 1.1, 1, 0.5, 1, 1.1, 1.2, 1.4, 1.4, 2, 9, 16],
    medium: [110, 41, 10, 5, 3, 1.5, 1, 0.5, 0.3, 0.5, 1, 1.5, 3, 5, 10, 41, 110],
    high: [1000, 130, 26, 9, 4, 2, 0.2, 0.2, 0.2, 0.2, 0.2, 2, 4, 9, 26, 130, 1000],
  },
};
const RISK_NAMES = { low: 'низкий', medium: 'средний', high: 'высокий' };

const durationMs = (rows) => rows * ROW_MS + LAND_MS;
const payoutFor = (amount, mult) => Math.floor(amount * mult + 1e-9);

// Путь с заданным числом поворотов вправо: случайная перестановка.
function pathWithRights(rows, rights, randInt) {
  const bits = Array.from({ length: rows }, (_, i) => (i < rights ? 1 : 0));
  for (let i = bits.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [bits[i], bits[j]] = [bits[j], bits[i]];
  }
  return bits;
}

function createPlinko({
  store,
  onFeed = () => {},
  onEvent = () => {},
  now = Date.now,
  randInt = (n) => randomInt(0, n - 1),
  schedule = (fn, ms) => setTimeout(fn, ms),
  lucky = () => false,
}) {
  const pending = new Map();   // ballId -> { player, amount, settle }
  const feed = [];
  let rigged = null;           // админ: 'edge' — следующий шарик в крайнюю лунку
  let seq = 0;

  const inFlight = (player) => [...pending.values()].filter((p) => p.player.id === player.id);

  function drop(player, amount, rows, risk) {
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (!MULTIPLIERS[rows]) return { error: 'Рядов: 8, 12 или 16' };
    if (!MULTIPLIERS[rows][risk]) return { error: 'Риск: низкий, средний или высокий' };
    if (inFlight(player).length >= MAX_IN_FLIGHT) return { error: 'Подожди, пока упадут уже брошенные шарики' };
    if (amount > player.balance) return { error: 'Не хватает фишек' };

    const table = MULTIPLIERS[rows][risk];
    let path;
    if (rigged === 'edge') {
      path = pathWithRights(rows, randInt(2) ? rows : 0, randInt);
    } else if (lucky(player)) {
      // Везение: лунка с выигрышем больше ставки (чаще ближние, изредка дальние).
      const good = table.map((m, i) => i).filter((i) => table[i] > 1);
      const weights = good.map((i) => 1 / table[i]);
      let r = (randInt(1_000_000) / 1_000_000) * weights.reduce((a, b) => a + b, 0);
      let slot = good[0];
      for (let k = 0; k < good.length; k++) {
        r -= weights[k];
        if (r <= 0) {
          slot = good[k];
          break;
        }
      }
      path = pathWithRights(rows, slot, randInt);
    } else {
      path = Array.from({ length: rows }, () => randInt(2));
    }
    rigged = null;
    const slot = path.reduce((a, b) => a + b, 0);
    const multiplier = table[slot];
    const payout = payoutFor(amount, multiplier);
    const id = ++seq;
    const ms = durationMs(rows);

    const settle = () => {
      if (!pending.has(id)) return;
      pending.delete(id);
      if (payout > 0) store.adjust(player, payout);
      else store.notify(player);
      feed.unshift({ id, playerId: player.id, name: player.name, amount, rows, risk, multiplier, payout, at: now() });
      if (feed.length > FEED_SIZE) feed.pop();
      onFeed(feed.slice());
      const net = payout - amount;
      if (net !== 0) {
        onEvent({
          game: 'plinko',
          kind: net > 0 ? 'win' : 'lose',
          player,
          amount: Math.abs(net),
          note: `×${multiplier} · ${rows} рядов, риск ${RISK_NAMES[risk]}`,
          meta: { multiplier, edge: slot === 0 || slot === rows, stake: amount },
        });
      }
    };
    // Сначала шарик «в игре», потом списание: капитал в рассылке баланса уже верный.
    pending.set(id, { player, amount, settle });
    store.adjust(player, -amount);
    schedule(settle, ms);
    return { ok: true, ball: { id, amount, rows, risk, path, slot, multiplier, payout, durationMs: ms } };
  }

  function rig(mode) {
    if (mode !== 'edge' && mode !== null) return { error: 'Режим: edge или null' };
    rigged = mode;
    return { ok: true };
  }

  return {
    drop,
    rig,
    settleAll: () => {
      for (const p of [...pending.values()]) p.settle();
    },
    reserved: (player) => inFlight(player).reduce((s, p) => s + p.amount, 0),
    feed: () => feed.slice(),
    adminState: () => ({ rigged, inFlight: pending.size, feed: feed.slice() }),
  };
}

module.exports = { createPlinko, MULTIPLIERS, durationMs, payoutFor, pathWithRights, ROW_MS, LAND_MS };
