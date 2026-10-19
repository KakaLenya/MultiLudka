// Дуэль на везение: игрок зовёт другого, выбирают игру и ставку, каждый получает свой бросок.
// Чей бросок удачнее — тот забирает обе ставки. Исход считает сервер сразу, оба смотрят одну анимацию,
// выплата и лента — когда анимация закончилась.
const { randomInt, randomFloat } = require('./rng');
const { crashPointCents } = require('./crash');
const { MULTIPLIERS: PLINKO, durationMs: plinkoMs } = require('./plinko');

const INVITE_MS = 60_000;
const MAX_STAKE = 1_000_000_000;
const KEEP_FINISHED_MS = 30_000;
const HISTORY_SIZE = 15;

const GAMES = {
  crash: 'Краш',
  roulette: 'Рулетка',
  upgrade: 'Апгрейд',
  verity: 'Верити',
  plinko: 'Плинко',
};
const PLINKO_ROWS = 12;
const PLINKO_RISK = 'high';

// Тайминги анимаций (клиент рисует ровно столько же).
const CRASH_GROWTH = 0.18;          // множитель в дуэли растёт быстрее, чем в общем краше
const CRASH_CAP_CENTS = 5000;       // ракеты в дуэли — до ×50
const ROULETTE_SPIN_MS = 7000;
const UPGRADE_SPIN_MS = 4500;
const UPGRADE_CHANCE = 30;
const VERITY_ROUND_MS = 2400;
const VERITY_MAX_ROUNDS = 10;
const REVEAL_PAD_MS = 1200;

// Насколько стрелка глубоко в зелёной зоне: от её края, внутри — плюс, снаружи — минус.
function upgradeScore(landing, start, chance) {
  const d = (((landing - start) % 100) + 100) % 100;
  if (d < chance) return Math.min(d, chance - d);
  return -Math.min(d - chance, 100 - d);
}

// Кто победил: 0 или 1.
function winnerOf(game, data) {
  switch (game) {
    case 'crash': return data.crash[0] > data.crash[1] ? 0 : 1;
    case 'roulette': return data.numbers[0] > data.numbers[1] ? 0 : 1;
    case 'upgrade': return upgradeScore(data.landings[0], data.start, data.chance) > upgradeScore(data.landings[1], data.start, data.chance) ? 0 : 1;
    case 'verity': return data.rounds.at(-1)[0] ? 0 : 1;
    case 'plinko': return data.multipliers[0] > data.multipliers[1] ? 0 : 1;
    default: throw new Error(`Нет игры ${game}`);
  }
}

// Поменять игроков местами в исходе (для режима везения).
function swapped(game, data) {
  switch (game) {
    case 'crash': return { crash: [data.crash[1], data.crash[0]] };
    case 'roulette': return { numbers: [data.numbers[1], data.numbers[0]] };
    case 'upgrade': return { ...data, landings: [data.landings[1], data.landings[0]] };
    case 'verity': return { rounds: data.rounds.map(([a, b]) => [b, a]) };
    case 'plinko': return { ...data, paths: [data.paths[1], data.paths[0]], multipliers: [data.multipliers[1], data.multipliers[0]] };
    default: throw new Error(`Нет игры ${game}`);
  }
}

// Сколько длится анимация исхода.
function durationOf(game, data) {
  switch (game) {
    case 'crash': return Math.ceil((Math.log(Math.max(...data.crash) / 100) / CRASH_GROWTH) * 1000) + REVEAL_PAD_MS;
    case 'roulette': return ROULETTE_SPIN_MS + REVEAL_PAD_MS;
    case 'upgrade': return UPGRADE_SPIN_MS + REVEAL_PAD_MS;
    case 'verity': return data.rounds.length * VERITY_ROUND_MS + REVEAL_PAD_MS;
    case 'plinko': return plinkoMs(data.rows) + 400 + REVEAL_PAD_MS;
    default: throw new Error(`Нет игры ${game}`);
  }
}

function createDuel({
  store,
  now = Date.now,
  random = randomFloat,
  randInt = (n) => randomInt(0, n - 1),
  isOnline = () => true,
  onChange = () => {},
  onEvent = () => {},
  lucky = () => false,
}) {
  const invites = new Map();   // id -> { id, from, to, game, stake, expiresAt }
  const duels = new Map();     // id -> дуэль
  const history = [];
  let inviteSeq = 0;
  let duelSeq = 0;
  let timer = null;

  const activeDuelOf = (player) => [...duels.values()].find((d) => d.phase === 'playing' && d.players.some((p) => p.id === player.id)) || null;
  const outgoingOf = (player) => [...invites.values()].find((i) => i.from.id === player.id) || null;

  // Броски для двух игроков, без ничьей.
  function roll(game) {
    switch (game) {
      case 'crash': {
        let a;
        let b;
        do {
          a = Math.min(CRASH_CAP_CENTS, crashPointCents(random()));
          b = Math.min(CRASH_CAP_CENTS, crashPointCents(random()));
        } while (a === b);
        return { crash: [a, b] };
      }
      case 'roulette': {
        let a;
        let b;
        do {
          a = randInt(37);
          b = randInt(37);
        } while (a === b);
        return { numbers: [a, b] };
      }
      case 'upgrade': {
        const start = random() * 100;
        let a;
        let b;
        do {
          a = random() * 100;
          b = random() * 100;
        } while (upgradeScore(a, start, UPGRADE_CHANCE) === upgradeScore(b, start, UPGRADE_CHANCE));
        return { start, chance: UPGRADE_CHANCE, landings: [a, b] };
      }
      case 'verity': {
        // Верити проверяет обоих, пока один не окажется добрым, а другой злым.
        const rounds = [];
        for (let i = 0; i < VERITY_MAX_ROUNDS - 1; i++) {
          const pair = [randInt(2) === 1, randInt(2) === 1];
          rounds.push(pair);
          if (pair[0] !== pair[1]) return { rounds };
        }
        const first = randInt(2) === 1;
        rounds.push([first, !first]);
        return { rounds };
      }
      case 'plinko': {
        // Два шарика, второй стартует чуть позже. Одинаковые множители (симметричные лунки) — бросаем заново.
        const table = PLINKO[PLINKO_ROWS][PLINKO_RISK];
        let paths;
        do {
          paths = [0, 1].map(() => Array.from({ length: PLINKO_ROWS }, () => randInt(2)));
        } while (table[paths[0].reduce((a, b) => a + b, 0)] === table[paths[1].reduce((a, b) => a + b, 0)]);
        return { rows: PLINKO_ROWS, risk: PLINKO_RISK, paths, multipliers: paths.map((p) => table[p.reduce((a, b) => a + b, 0)]) };
      }
      default: throw new Error(`Нет игры ${game}`);
    }
  }

  function invite(from, toId, game, stake) {
    const to = store.get(String(toId));
    if (!GAMES[game]) return { error: 'Выбери игру для дуэли' };
    if (!to) return { error: 'Игрок не найден' };
    if (to.id === from.id) return { error: 'С самим собой дуэль не выйдет' };
    if (!isOnline(to.id)) return { error: `${to.name} сейчас не на сайте` };
    if (!Number.isSafeInteger(stake) || stake < 0 || stake > MAX_STAKE) return { error: 'Ставка: целое число от 0' };
    if (stake > from.balance) return { error: 'Не хватает фишек на ставку' };
    if (activeDuelOf(from)) return { error: 'Ты уже в дуэли' };
    if (activeDuelOf(to)) return { error: `${to.name} уже в дуэли` };
    if (outgoingOf(from)) return { error: 'Один вызов за раз: дождись ответа или отмени' };
    const inv = { id: String(++inviteSeq), from, to, game, stake, expiresAt: now() + INVITE_MS };
    invites.set(inv.id, inv);
    onChange({ invite: inv });
    return { ok: true, invite: inv };
  }

  function cancel(player) {
    const inv = outgoingOf(player);
    if (!inv) return { error: 'Нет вызова' };
    invites.delete(inv.id);
    onChange();
    return { ok: true };
  }

  function decline(player, inviteId) {
    const inv = invites.get(String(inviteId));
    if (!inv || inv.to.id !== player.id) return { error: 'Вызов не найден' };
    invites.delete(inv.id);
    onChange({ declined: inv });
    return { ok: true };
  }

  function accept(player, inviteId) {
    const inv = invites.get(String(inviteId));
    if (!inv || inv.to.id !== player.id) return { error: 'Вызов не найден или истёк' };
    invites.delete(inv.id);
    const { from, stake, game } = inv;
    if (!isOnline(from.id)) return { error: `${from.name} уже ушёл` };
    if (activeDuelOf(from) || activeDuelOf(player)) return { error: 'Кто-то из вас уже в дуэли' };
    if (from.balance < stake) return { error: `У ${from.name} не хватает фишек на ставку` };
    if (player.balance < stake) return { error: 'Не хватает фишек на ставку' };

    const players = [from, player];
    let data = roll(game);
    // Режим везения: если повезло ровно одному, исход в его пользу.
    const luck = players.map((p) => lucky(p));
    if (luck[0] !== luck[1] && winnerOf(game, data) !== luck.indexOf(true)) data = swapped(game, data);

    const t = now();
    const d = {
      id: String(++duelSeq),
      game,
      stake,
      players,
      data,
      startedAt: t,
      revealAt: t + durationOf(game, data),
      phase: 'playing',
      winner: null,
      endedAt: null,
    };
    duels.set(d.id, d);
    // Сначала дуэль, потом списание: капитал в рассылке баланса уже верный.
    if (stake > 0) {
      store.adjust(from, -stake);
      store.adjust(player, -stake);
    }
    for (const [id, i] of invites) {
      if ([i.from.id, i.to.id].some((pid) => pid === from.id || pid === player.id)) invites.delete(id);
    }
    onChange({ started: d });
    return { ok: true, duelId: d.id };
  }

  // Анимация закончилась: банк победителю, итог в ленту.
  function settle(d) {
    d.phase = 'over';
    d.winner = winnerOf(d.game, d.data);
    d.endedAt = now();
    const w = d.players[d.winner];
    const l = d.players[1 - d.winner];
    if (d.stake > 0) store.adjust(w, 2 * d.stake);
    else store.notify(w);
    store.notify(l);
    history.unshift({ id: d.id, game: d.game, stake: d.stake, winner: { id: w.id, name: w.name }, loser: { id: l.id, name: l.name }, at: d.endedAt });
    if (history.length > HISTORY_SIZE) history.pop();
    const note = (other) => `${GAMES[d.game]}-дуэль против ${other.name}`;
    onEvent({ game: 'duel', kind: 'win', player: w, amount: d.stake, note: note(l), meta: { duel: d.game } });
    onEvent({ game: 'duel', kind: 'lose', player: l, amount: d.stake, note: note(w), meta: { duel: d.game } });
  }

  function tick() {
    const t = now();
    let changed = false;
    for (const [id, i] of invites) {
      if (t >= i.expiresAt) {
        invites.delete(id);
        changed = true;
      }
    }
    for (const [id, d] of duels) {
      if (d.phase === 'playing' && t >= d.revealAt) {
        settle(d);
        changed = true;
      }
      if (d.phase === 'over' && t - d.endedAt >= KEEP_FINISHED_MS) {
        duels.delete(id);
        changed = true;
      }
    }
    if (changed) onChange();
  }

  // Игрок ушёл навсегда (удалили): его вызовы убрать, идущую дуэль доиграть сразу.
  function forget(playerId) {
    for (const [id, i] of invites) if (i.from.id === playerId || i.to.id === playerId) invites.delete(id);
    for (const d of duels.values()) {
      if (d.phase === 'playing' && d.players.some((p) => p.id === playerId)) settle(d);
    }
    onChange();
  }

  // Сервер останавливается: исходы уже решены — выплатить сразу.
  function settleAll() {
    for (const d of duels.values()) if (d.phase === 'playing') settle(d);
  }

  function duelView(d, t) {
    return {
      id: d.id,
      game: d.game,
      stake: d.stake,
      players: d.players.map((p) => ({ id: p.id, name: p.name })),
      data: d.data,
      elapsed: t - d.startedAt,
      duration: d.revealAt - d.startedAt,
      phase: d.phase,
      winner: d.phase === 'over' ? d.winner : null,
    };
  }

  function view(viewer) {
    const t = now();
    const mine = viewer ? activeDuelOf(viewer) : null;
    const lastMine = viewer ? [...duels.values()].reverse().find((d) => d.players.some((p) => p.id === viewer.id)) : null;
    return {
      invitesIn: viewer ? [...invites.values()].filter((i) => i.to.id === viewer.id).map((i) => ({
        id: i.id, fromId: i.from.id, fromName: i.from.name, game: i.game, stake: i.stake, expiresIn: i.expiresAt - t,
      })) : [],
      inviteOut: (() => {
        const i = viewer && outgoingOf(viewer);
        return i ? { id: i.id, toId: i.to.id, toName: i.to.name, game: i.game, stake: i.stake, expiresIn: i.expiresAt - t } : null;
      })(),
      myDuelId: mine ? mine.id : lastMine ? lastMine.id : null,
      duels: [...duels.values()].map((d) => duelView(d, t)),
      history: history.slice(),
    };
  }

  return {
    invite,
    cancel,
    decline,
    accept,
    tick,
    forget,
    settleAll,
    view,
    reserved: (player) => {
      const d = activeDuelOf(player);
      return d ? d.stake : 0;
    },
    adminState: () => ({ duels: [...duels.values()].map((d) => duelView(d, now())), invites: invites.size, history: history.slice() }),
    start() {
      timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          console.error('Дуэль: ошибка в тике', err);
        }
      }, 250);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = {
  createDuel, winnerOf, upgradeScore, durationOf, GAMES,
  CRASH_GROWTH, CRASH_CAP_CENTS, ROULETTE_SPIN_MS, UPGRADE_SPIN_MS, UPGRADE_CHANCE, VERITY_ROUND_MS,
};
