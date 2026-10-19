// Мины: поле 5×5, игрок выбирает ставку и число мин. Открывает клетки по одной: каждая безопасная
// поднимает множитель, мина — ставка сгорела. Забрать можно в любой момент.
// Мины расставляет сервер в начале игры, клиенту они не видны, пока игра не кончилась.
const { randomInt } = require('./rng');

const TILES = 25;
const MIN_BET = 1;
const RTP = 0.99;
const FEED_SIZE = 20;

// Множитель после k безопасных клеток при m минах: честная вероятность, преимущество казино 1%.
function multiplierFor(mines, picks) {
  if (picks === 0) return 1;
  let m = RTP;
  for (let i = 0; i < picks; i++) m *= (TILES - i) / (TILES - mines - i);
  return Math.floor(m * 100) / 100;
}

const payoutFor = (bet, mult) => Math.floor(bet * mult + 1e-9);

function createMines({
  store,
  onEvent = () => {},
  onFeed = () => {},
  now = Date.now,
  randInt = (n) => randomInt(0, n - 1),
  lucky = () => false,
}) {
  const games = new Map();   // playerId -> игра
  const feed = [];
  let rigged = null;         // админ: 'boom' — следующий клик любого игрока попадёт на мину

  function view(player) {
    const g = games.get(player.id);
    if (!g) return { active: false };
    const over = g.status !== 'playing';
    return {
      active: g.status === 'playing',
      status: g.status,
      bet: g.bet,
      mines: g.mines,
      revealed: g.revealed.slice(),
      multiplier: multiplierFor(g.mines, g.revealed.length),
      next: g.revealed.length < TILES - g.mines ? multiplierFor(g.mines, g.revealed.length + 1) : null,
      payout: g.payout,
      boom: g.boom,
      minesAt: over ? [...g.minesAt] : null,
    };
  }

  function start(player, amount, mines) {
    if (!Number.isSafeInteger(amount) || amount < MIN_BET) return { error: `Ставка: целое число от ${MIN_BET}` };
    if (!Number.isInteger(mines) || mines < 1 || mines > 24) return { error: 'Мин: от 1 до 24' };
    const cur = games.get(player.id);
    if (cur && cur.status === 'playing') return { error: 'Сначала доиграй: забери или открывай дальше' };
    if (amount > player.balance) return { error: 'Не хватает фишек' };
    // Мины — случайные клетки.
    const cells = Array.from({ length: TILES }, (_, i) => i);
    for (let i = cells.length - 1; i > 0; i--) {
      const j = randInt(i + 1);
      [cells[i], cells[j]] = [cells[j], cells[i]];
    }
    const g = { bet: amount, mines, minesAt: new Set(cells.slice(0, mines)), revealed: [], status: 'playing', payout: 0, boom: null, startedAt: now() };
    games.set(player.id, g);   // сначала игра, потом списание: капитал в рассылке уже верный
    store.adjust(player, -amount);
    return { ok: true, state: view(player) };
  }

  // Перенести мину с клетки на другую закрытую безопасную (для везения) или на эту клетку (подкрутка).
  function moveMine(g, from, to) {
    g.minesAt.delete(from);
    g.minesAt.add(to);
  }
  const freeSafe = (g, except) => {
    const out = [];
    for (let i = 0; i < TILES; i++) if (i !== except && !g.minesAt.has(i) && !g.revealed.includes(i)) out.push(i);
    return out;
  };

  function finish(player, g, status) {
    g.status = status;
    const mult = multiplierFor(g.mines, g.revealed.length);
    g.payout = status === 'won' ? payoutFor(g.bet, mult) : 0;
    if (g.payout > 0) store.adjust(player, g.payout);
    else store.notify(player);
    feed.unshift({ playerId: player.id, name: player.name, bet: g.bet, mines: g.mines, picks: g.revealed.length, multiplier: status === 'won' ? mult : 0, payout: g.payout, at: now() });
    if (feed.length > FEED_SIZE) feed.pop();
    onFeed(feed.slice());
    const net = g.payout - g.bet;
    if (net !== 0) {
      onEvent({
        game: 'mines',
        kind: net > 0 ? 'win' : 'lose',
        player,
        amount: Math.abs(net),
        note: status === 'won' ? `×${mult} · ${g.revealed.length} кл., ${g.mines} мин` : `мина на ${g.revealed.length + 1}-й клетке, ${g.mines} мин`,
        meta: { multiplier: status === 'won' ? mult : 0, cleared: g.revealed.length === TILES - g.mines, stake: g.bet },
      });
    }
  }

  function pick(player, tile) {
    const g = games.get(player.id);
    if (!g || g.status !== 'playing') return { error: 'Игра не начата' };
    if (!Number.isInteger(tile) || tile < 0 || tile >= TILES) return { error: 'Нет такой клетки' };
    if (g.revealed.includes(tile)) return { error: 'Эта клетка уже открыта' };

    if (rigged === 'boom' && !g.minesAt.has(tile)) {
      moveMine(g, [...g.minesAt][randInt(g.minesAt.size)], tile);
    } else if (g.minesAt.has(tile) && lucky(player)) {
      const free = freeSafe(g, tile);
      if (free.length) moveMine(g, tile, free[randInt(free.length)]);
    }
    rigged = null;

    if (g.minesAt.has(tile)) {
      g.boom = tile;
      finish(player, g, 'lost');
    } else {
      g.revealed.push(tile);
      if (g.revealed.length === TILES - g.mines) finish(player, g, 'won');   // открыл всё — забираем сами
    }
    return { ok: true, state: view(player) };
  }

  function cashout(player) {
    const g = games.get(player.id);
    if (!g || g.status !== 'playing') return { error: 'Игра не начата' };
    if (!g.revealed.length) return { error: 'Открой хотя бы одну клетку' };
    finish(player, g, 'won');
    return { ok: true, state: view(player) };
  }

  function rig(mode) {
    if (mode !== 'boom' && mode !== null) return { error: 'Режим: boom или null' };
    rigged = mode;
    return { ok: true };
  }

  // Сервер останавливается: открыл клетки — забираем по текущему множителю, не открыл — ставку назад.
  function settleAll() {
    for (const [id, g] of games) {
      if (g.status !== 'playing') continue;
      const player = store.get(id);
      if (!player) continue;
      if (g.revealed.length) finish(player, g, 'won');
      else {
        g.status = 'refunded';
        store.adjust(player, g.bet);
      }
    }
  }

  return {
    start,
    pick,
    cashout,
    rig,
    view,
    settleAll,
    forget: (playerId) => games.delete(playerId),
    reserved: (player) => {
      const g = games.get(player.id);
      return g && g.status === 'playing' ? g.bet : 0;
    },
    feed: () => feed.slice(),
    adminState: () => ({
      rigged,
      playing: [...games.entries()].filter(([, g]) => g.status === 'playing').map(([id, g]) => ({
        id, name: (store.get(id) || {}).name, bet: g.bet, mines: g.mines, picks: g.revealed.length, multiplier: multiplierFor(g.mines, g.revealed.length),
      })),
      feed: feed.slice(),
    }),
  };
}

module.exports = { createMines, multiplierFor, payoutFor, TILES };
