// Пул (восьмёрка) по приглашению: приглашения, матчи на двоих, ставка, правила.
// Физику удара считает сервер тем же кодом, что и браузер (public/pool-physics.js).
const Physics = require('../public/pool-physics');
const { randomInt } = require('./rng');

const INVITE_MS = 60_000;
const SHOT_MS = 60_000;
const SETTLE_PAD_MS = 700;     // пауза после остановки шаров
const MAX_TIMEOUTS = 3;
const MAX_STAKE = 1_000_000;
const KEEP_FINISHED_MS = 30_000;

const groupOf = (id) => (id >= 1 && id <= 7 ? 'solids' : id >= 9 && id <= 15 ? 'stripes' : null);
const otherGroup = (g) => (g === 'solids' ? 'stripes' : 'solids');
const GROUP_NAMES = { solids: 'сплошными', stripes: 'полосатыми' };

function shuffled(arr, randInt) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = randInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// Пирамида: восьмёрка в центре, в задних углах сплошной и полосатый, остальное случайно.
function rackOrder(randInt) {
  const solids = shuffled([1, 2, 3, 4, 5, 6, 7], randInt);
  const stripes = shuffled([9, 10, 11, 12, 13, 14, 15], randInt);
  const order = new Array(15).fill(null);
  order[4] = 8;
  const [c1, c2] = randInt(2) ? [solids.pop(), stripes.pop()] : [stripes.pop(), solids.pop()];
  order[10] = c1;
  order[14] = c2;
  const rest = shuffled([...solids, ...stripes], randInt);
  for (let i = 0; i < 15; i++) if (order[i] === null) order[i] = rest.pop();
  return order;
}

// Судья: итог удара по правилам восьмёрки.
// state: { balls (до удара), groups: [g0, g1], turn, breakShot }, sim: результат Physics.simulate.
function judge(state, sim) {
  const me = state.turn;
  const opp = 1 - me;
  const pocketed = sim.events.pocketed;
  const cueIn = pocketed.includes(0);
  const eightIn = pocketed.includes(8);
  const objIn = pocketed.filter((id) => id !== 0 && id !== 8);
  const myGroup = state.groups[me];
  const left = (g) => state.balls.filter((b) => !b.in && groupOf(b.id) === g).length;
  const clearedBefore = myGroup !== null && left(myGroup) === 0;
  const first = sim.events.firstHit;

  let legalFirst;
  if (state.breakShot) legalFirst = first !== null;
  else if (first === null) legalFirst = false;
  else if (myGroup === null) legalFirst = first !== 8;
  else if (clearedBefore) legalFirst = first === 8;
  else legalFirst = groupOf(first) === myGroup;
  const foul = cueIn || !legalFirst;
  let foulReason = null;
  if (cueIn) foulReason = 'биток в лузе';
  else if (first === null) foulReason = 'ни во что не попал';
  else if (!legalFirst) foulReason = first === 8 ? 'первой задета восьмёрка' : 'первым задет чужой шар';

  if (eightIn && !state.breakShot) {
    if (clearedBefore && !foul) return { winner: me, reason: 'забил восьмёрку' };
    return { winner: opp, reason: clearedBefore ? `восьмёрка с фолом (${foulReason})` : 'восьмёрка забита раньше времени' };
  }

  let groups = state.groups;
  let assigned = null;
  if (!state.breakShot && myGroup === null && !foul && objIn.length) {
    assigned = groupOf(objIn[0]);
    groups = me === 0 ? [assigned, otherGroup(assigned)] : [otherGroup(assigned), assigned];
  }
  const mine = groups[me];
  const scoredOwn = mine === null ? objIn.length > 0 : objIn.some((id) => groupOf(id) === mine);
  return {
    winner: null,
    foul,
    foulReason,
    keepTurn: !foul && scoredOwn,
    groups,
    assigned,
    respotEight: state.breakShot && eightIn,
    cueIn,
  };
}

// isOnline(playerId): игрок сейчас на сайте.
function createPool({
  store,
  isOnline = () => true,
  onChange = () => {},
  onEvent = () => {},
  now = Date.now,
  randInt = (n) => randomInt(0, n - 1),
}) {
  const invites = new Map();   // id -> { id, from, to, stake, expiresAt }
  const matches = new Map();   // id -> матч
  let inviteSeq = 0;
  let matchSeq = 0;
  let timer = null;

  const activeMatchOf = (player) => [...matches.values()].find((m) => m.phase === 'playing' && m.players.some((p) => p.id === player.id)) || null;
  const outgoingOf = (player) => [...invites.values()].find((i) => i.from.id === player.id) || null;

  function invite(from, toId, stake) {
    const to = store.get(String(toId));
    if (!to) return { error: 'Игрок не найден' };
    if (to.id === from.id) return { error: 'Сам с собой не сыграешь' };
    if (!isOnline(to.id)) return { error: `${to.name} сейчас не на сайте` };
    if (!Number.isSafeInteger(stake) || stake < 0 || stake > MAX_STAKE) return { error: `Ставка: целое от 0 до ${MAX_STAKE}` };
    if (stake > from.balance) return { error: 'Не хватает фишек на ставку' };
    if (activeMatchOf(from)) return { error: 'Ты уже в матче' };
    if (activeMatchOf(to)) return { error: `${to.name} уже играет` };
    if (outgoingOf(from)) return { error: 'Одно приглашение за раз: дождись ответа или отмени' };
    const inv = { id: String(++inviteSeq), from, to, stake, expiresAt: now() + INVITE_MS };
    invites.set(inv.id, inv);
    onChange({ invite: inv });
    return { ok: true, invite: inv };
  }

  function cancel(player) {
    const inv = outgoingOf(player);
    if (!inv) return { error: 'Нет приглашения' };
    invites.delete(inv.id);
    onChange();
    return { ok: true };
  }

  function decline(player, inviteId) {
    const inv = invites.get(String(inviteId));
    if (!inv || inv.to.id !== player.id) return { error: 'Приглашение не найдено' };
    invites.delete(inv.id);
    onChange({ declined: inv });
    return { ok: true };
  }

  function accept(player, inviteId) {
    const inv = invites.get(String(inviteId));
    if (!inv || inv.to.id !== player.id) return { error: 'Приглашение не найдено или истекло' };
    invites.delete(inv.id);
    const { from, stake } = inv;
    if (!isOnline(from.id)) return { error: `${from.name} уже ушёл` };
    if (activeMatchOf(from) || activeMatchOf(player)) return { error: 'Кто-то из вас уже в матче' };
    if (from.balance < stake) return { error: `У ${from.name} не хватает фишек на ставку` };
    if (player.balance < stake) return { error: 'Не хватает фишек на ставку' };

    const players = randInt(2) ? [from, player] : [player, from];   // кто разбивает, решает жребий
    const m = {
      id: String(++matchSeq),
      players,
      stake,
      balls: Physics.rack(rackOrder(randInt)),
      turn: 0,
      groups: [null, null],
      breakShot: true,
      ballInHand: 'kitchen',
      shotNo: 0,
      busyUntil: 0,
      deadline: now() + SHOT_MS,
      phase: 'playing',
      winner: null,
      message: `${players[0].name} разбивает`,
      timeouts: [0, 0],
      lastShot: null,
      endedAt: null,
    };
    matches.set(m.id, m);
    // Сначала матч, потом списание: капитал в рассылке баланса уже верный.
    if (stake > 0) {
      store.adjust(from, -stake);
      store.adjust(player, -stake);
    }
    // Остальные приглашения этих двоих больше не нужны.
    for (const [id, i] of invites) {
      if ([i.from.id, i.to.id].some((pid) => pid === from.id || pid === player.id)) invites.delete(id);
    }
    onChange({ started: m });
    return { ok: true, matchId: m.id };
  }

  function finish(m, winnerIdx, reason) {
    m.phase = 'over';
    m.winner = winnerIdx;
    m.endedAt = now();
    m.turn = -1;
    const w = m.players[winnerIdx];
    const l = m.players[1 - winnerIdx];
    m.message = `${w.name} побеждает: ${reason}`;
    if (m.stake > 0) store.adjust(w, 2 * m.stake);
    else store.notify(w);
    store.notify(l);
    onEvent({ game: 'pool', kind: 'win', player: w, amount: m.stake, note: `против ${l.name}: ${reason}`, meta: { byEight: reason === 'забил восьмёрку' } });
    onEvent({ game: 'pool', kind: 'lose', player: l, amount: m.stake, note: `против ${w.name}` });
  }

  // Восьмёрку, забитую на разбивке, возвращаем на точку (или левее, если занято).
  function respotEight(balls) {
    const eight = balls.find((b) => b.id === 8);
    eight.in = false;
    for (let x = Physics.FOOT.x; x > Physics.HEAD_X; x -= 2 * Physics.R) {
      const free = balls.every((b) => b.in || b.id === 8 || (b.x - x) ** 2 + (b.y - Physics.FOOT.y) ** 2 >= 4 * Physics.R ** 2);
      if (free) {
        eight.x = x;
        eight.y = Physics.FOOT.y;
        return;
      }
    }
  }

  // shot: { dir: { x, y }, power: 0..1, spin?: -1..1, cue?: { x, y } } — cue нужен, если шар с руки.
  // spin: винт по вертикали, -1 — оттяжка, 1 — накат.
  function shoot(player, shot) {
    const m = activeMatchOf(player);
    if (!m) return { error: 'Ты не в матче' };
    const me = m.players.findIndex((p) => p.id === player.id);
    if (m.turn !== me) return { error: 'Сейчас удар соперника' };
    if (now() < m.busyUntil || m.pendingFinish) return { error: 'Шары ещё катятся' };
    const dir = shot && shot.dir;
    const power = shot && shot.power;
    if (!dir || !Number.isFinite(dir.x) || !Number.isFinite(dir.y)) return { error: 'Нет направления удара' };
    const len = Math.sqrt(dir.x * dir.x + dir.y * dir.y);
    if (len < 1e-6) return { error: 'Нет направления удара' };
    if (!Number.isFinite(power) || power < 0.02 || power > 1) return { error: 'Сила удара от 0.02 до 1' };
    const spin = shot.spin === undefined ? 0 : shot.spin;
    if (!Number.isFinite(spin) || spin < -1 || spin > 1) return { error: 'Винт от -1 до 1' };

    const balls = m.balls.map((b) => ({ ...b }));
    const cue = balls.find((b) => b.id === 0);
    if (m.ballInHand) {
      const c = shot.cue;
      if (!c || !Physics.canPlaceCue(balls, c.x, c.y, m.ballInHand === 'kitchen')) {
        return { error: m.ballInHand === 'kitchen' ? 'Поставь биток в дом (левее линии)' : 'Поставь биток на свободное место' };
      }
      cue.x = c.x;
      cue.y = c.y;
      cue.in = false;
    }

    const vel = { x: (dir.x / len) * power * Physics.MAX_SPEED, y: (dir.y / len) * power * Physics.MAX_SPEED };
    const sim = Physics.simulate(balls, vel, { spin });
    const verdict = judge({ balls, groups: m.groups, turn: me, breakShot: m.breakShot }, sim);

    m.shotNo += 1;
    m.lastShot = { shotNo: m.shotNo, by: me, start: balls, vel, spin, duration: sim.duration };
    m.balls = sim.balls;
    m.timeouts[me] = 0;
    m.busyUntil = now() + sim.duration * 1000 + SETTLE_PAD_MS;
    const name = player.name;
    const oppName = m.players[1 - me].name;

    if (verdict.winner !== null) {
      // Итог объявим, когда шары остановятся: иначе рейтинг и лента выдают его раньше анимации.
      m.pendingFinish = { winner: verdict.winner, reason: verdict.reason };
      m.message = '';
      m.deadline = m.busyUntil;
      onChange({ shot: m });
      return { ok: true };
    }

    if (verdict.respotEight) respotEight(m.balls);
    m.groups = verdict.groups;
    m.breakShot = false;
    const parts = [];
    if (verdict.assigned) parts.push(`${name} играет ${GROUP_NAMES[verdict.assigned]}.`);
    if (verdict.foul) {
      m.turn = 1 - me;
      m.ballInHand = 'anywhere';
      if (verdict.cueIn) {
        const c = m.balls.find((b) => b.id === 0);
        Object.assign(c, { in: false, x: Physics.HEAD_X - 60, y: Physics.H / 2 });
      }
      parts.push(`Фол: ${verdict.foulReason}. Шар с руки у ${oppName}.`);
    } else if (verdict.keepTurn) {
      m.ballInHand = null;
      parts.push(`${name} забивает и бьёт ещё.`);
    } else {
      m.turn = 1 - me;
      m.ballInHand = null;
      parts.push(`Бьёт ${oppName}.`);
    }
    m.message = parts.join(' ');
    m.deadline = m.busyUntil + SHOT_MS;
    onChange({ shot: m });
    return { ok: true };
  }

  function concede(player) {
    const m = activeMatchOf(player);
    if (!m) return { error: 'Ты не в матче' };
    if (m.pendingFinish) return { error: 'Партия уже решена, шары докатываются' };
    const me = m.players.findIndex((p) => p.id === player.id);
    finish(m, 1 - me, `${player.name} сдался`);
    onChange();
    return { ok: true };
  }

  // Игрока удалили или он навсегда ушёл: приглашения убрать, матч засчитать сопернику.
  function forget(playerId) {
    for (const [id, i] of invites) if (i.from.id === playerId || i.to.id === playerId) invites.delete(id);
    for (const m of matches.values()) {
      const idx = m.players.findIndex((p) => p.id === playerId);
      if (m.phase !== 'playing' || idx < 0) continue;
      // Победный удар уже сделан: засчитываем его, а не уход.
      if (m.pendingFinish) finish(m, m.pendingFinish.winner, m.pendingFinish.reason);
      else finish(m, 1 - idx, 'соперник покинул зал');
    }
    onChange();
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
    for (const [id, m] of matches) {
      if (m.phase === 'playing' && m.pendingFinish) {
        if (t >= m.busyUntil) {
          finish(m, m.pendingFinish.winner, m.pendingFinish.reason);
          changed = true;
        }
        continue;
      }
      if (m.phase === 'playing' && t >= m.deadline) {
        // Просрочка удара: ход сопернику с шаром с руки; три подряд — поражение.
        const me = m.turn;
        m.timeouts[me] += 1;
        if (m.timeouts[me] >= MAX_TIMEOUTS) {
          finish(m, 1 - me, `${m.players[me].name} трижды не ударил`);
        } else {
          m.turn = 1 - me;
          // На разбивке соперник разбивает сам (биток в доме), иначе шар с руки куда угодно.
          m.ballInHand = m.breakShot ? 'kitchen' : 'anywhere';
          m.message = `${m.players[me].name} не успел ударить. Шар с руки у ${m.players[1 - me].name}.`;
          m.deadline = t + SHOT_MS;
        }
        changed = true;
      }
      if (m.phase === 'over' && t - m.endedAt >= KEEP_FINISHED_MS) {
        matches.delete(id);
        changed = true;
      }
    }
    if (changed) onChange();
  }

  function matchView(m) {
    const t = now();
    return {
      id: m.id,
      players: m.players.map((p) => ({ id: p.id, name: p.name })),
      stake: m.stake,
      balls: m.balls,
      turn: m.turn,
      groups: m.groups,
      ballInHand: m.ballInHand,
      breakShot: m.breakShot,
      shotNo: m.shotNo,
      busyLeft: Math.max(0, m.busyUntil - t),
      timeLeft: m.phase === 'playing' ? Math.max(0, m.deadline - t) : null,
      phase: m.phase,
      winner: m.winner,
      message: m.message,
      timeouts: m.timeouts,
      lastShot: m.lastShot,
    };
  }

  // Состояние для конкретного игрока: его приглашения и все матчи (смотреть можно любой).
  function view(viewer) {
    const mine = viewer ? activeMatchOf(viewer) : null;
    return {
      invitesIn: viewer ? [...invites.values()].filter((i) => i.to.id === viewer.id)
        .map((i) => ({ id: i.id, fromId: i.from.id, fromName: i.from.name, stake: i.stake, expiresIn: Math.max(0, i.expiresAt - now()) })) : [],
      inviteOut: viewer && outgoingOf(viewer) ? (({ id, to, stake, expiresAt }) => ({ id, toId: to.id, toName: to.name, stake, expiresIn: Math.max(0, expiresAt - now()) }))(outgoingOf(viewer)) : null,
      myMatchId: mine ? mine.id : null,
      matches: [...matches.values()].map(matchView),
    };
  }

  function reserved(player) {
    const m = activeMatchOf(player);
    return m ? m.stake : 0;
  }

  // Остановка сервера: ставки идущих матчей обратно.
  function refundAll() {
    for (const m of matches.values()) {
      if (m.phase !== 'playing') continue;
      m.phase = 'over';
      if (m.stake > 0) for (const p of m.players) store.adjust(p, m.stake);
    }
  }

  return {
    invite, cancel, decline, accept, shoot, concede, forget, tick, view, reserved, refundAll,
    adminState: () => ({ matches: [...matches.values()].map(matchView), invites: invites.size }),
    _match: (id) => matches.get(id),   // для тестов
    start() {
      timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          console.error('Пул: ошибка в тике', err);
        }
      }, 500);
    },
    stop() {
      clearInterval(timer);
      timer = null;
    },
  };
}

module.exports = { createPool, judge, rackOrder, groupOf, INVITE_MS, SHOT_MS, MAX_TIMEOUTS };
