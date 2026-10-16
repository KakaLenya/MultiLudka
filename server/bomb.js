// Бомба в банке: игроки по кругу подкладывают фишки в общий банк, где-то тайный фитиль.
// Чей взнос дотянул банк до фитиля, тот взрывается и теряет вложенное; банк делят выжившие
// пропорционально вкладам. Сбежать можно в любой момент за половину своих взносов.
const { randomFloat } = require('./rng');

const LOBBY_MS = 15_000;
const TURN_MS = 15_000;
const RESULT_MS = 7000;
const ENTRY = 20;
const MIN_DEPOSIT = 10;
const MAX_DEPOSIT = 200;
const MAX_PLAYERS = 8;
const HISTORY_SIZE = 12;

// Сколько ещё фишек выдержит банк сверх взносов: от 10 до 120 на игрока.
// В среднем это пара кругов по столу, но бывают и мгновенные взрывы, и долгие нервы.
function fuseFor(bank, players, r) {
  return bank + Math.max(1, Math.round(players * (10 + r * 110)));
}

// onEvent: события для общей ленты ставок и выигрышей.
function createBomb({ store, onState = () => {}, onEvent = () => {}, now = Date.now, random = randomFloat, timings = {} }) {
  const T = { lobbyMs: LOBBY_MS, turnMs: TURN_MS, resultMs: RESULT_MS, ...timings };

  let roundId = 1;
  let phase = 'lobby';        // lobby | playing | result
  let deadline = null;
  let bank = 0;
  let fuse = null;            // секрет раунда
  let rigged = null;          // админ: фитиль следующего раунда
  let seats = new Map();      // playerId -> { player, contributed, refunded, status: in|out|boom, payout }
  let order = [];             // порядок ходов (playerId)
  let turn = -1;              // индекс в order
  let result = null;
  const history = [];
  let timer = null;

  const active = () => order.filter((id) => seats.get(id).status === 'in');
  const turnId = () => (phase === 'playing' && turn >= 0 ? order[turn] : null);

  function emit() {
    onState(publicState());
  }

  function resetLobby() {
    roundId += 1;
    phase = 'lobby';
    deadline = null;
    bank = 0;
    fuse = null;
    seats = new Map();
    order = [];
    turn = -1;
    result = null;
  }

  function startRound(t) {
    if (seats.size < 2) {
      deadline = seats.size ? t + T.lobbyMs : null;  // ждём второго
      return;
    }
    order = [...seats.keys()];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j], order[i]];
    }
    fuse = rigged !== null && rigged > bank ? rigged : fuseFor(bank, order.length, random());
    rigged = null;
    phase = 'playing';
    turn = 0;
    deadline = t + T.turnMs;
  }

  function nextTurn(t) {
    const alive = active();
    if (alive.length <= 1) return lastStanding(t);
    for (let k = 1; k <= order.length; k++) {
      const i = (turn + k) % order.length;
      if (seats.get(order[i]).status === 'in') {
        turn = i;
        break;
      }
    }
    deadline = t + T.turnMs;
  }

  function finish(t, res) {
    result = { ...res, fuse, bank };
    history.unshift({ fuse, boom: res.type === 'boom' });
    if (history.length > HISTORY_SIZE) history.pop();
    phase = 'result';
    turn = -1;
    deadline = t + T.resultMs;
  }

  // Взрыв: банк делят выжившие пропорционально вкладам, остаток от деления самому щедрому.
  function explode(bomber, t) {
    bomber.status = 'boom';
    const alive = active().map((id) => seats.get(id));
    const total = alive.reduce((s, x) => s + x.contributed, 0);
    let left = bank;
    for (const s of alive) {
      s.payout = Math.floor((bank * s.contributed) / total);
      left -= s.payout;
    }
    alive.sort((a, b) => b.contributed - a.contributed)[0].payout += left;
    for (const s of alive) {
      store.adjust(s.player, s.payout);
      onEvent({ game: 'bomb', kind: 'win', player: s.player, amount: s.payout - s.contributed, note: `рвануло у ${bomber.player.name}` });
    }
    store.notify(bomber.player);  // его фишки больше не «в игре»
    onEvent({ game: 'bomb', kind: 'lose', player: bomber.player, amount: bomber.contributed, note: `взорвался на банке ${bank}` });
    finish(t, {
      type: 'boom',
      bomberId: bomber.player.id,
      bomberName: bomber.player.name,
      payouts: alive.map((s) => ({ id: s.player.id, name: s.player.name, amount: s.payout })),
    });
  }

  // Все, кроме одного, сбежали: смельчак забирает банк.
  function lastStanding(t) {
    const [id] = active();
    const w = seats.get(id);
    w.payout = bank;
    store.adjust(w.player, bank);
    onEvent({ game: 'bomb', kind: 'win', player: w.player, amount: bank - w.contributed, note: 'все остальные сбежали' });
    finish(t, { type: 'last', winnerId: w.player.id, winnerName: w.player.name, payouts: [{ id: w.player.id, name: w.player.name, amount: bank }] });
  }

  function advance() {
    const t = now();
    if (deadline === null || t < deadline) return false;
    if (phase === 'lobby') {
      startRound(t);
    } else if (phase === 'playing') {
      // Проспал ход: автоматически минимальный взнос, а если фишек нет, побег.
      const s = seats.get(turnId());
      if (s.player.balance >= MIN_DEPOSIT) doDeposit(s, MIN_DEPOSIT, t, true);
      else doFlee(s, t);
    } else {
      resetLobby();
    }
    return true;
  }

  function doDeposit(s, amount, t, auto = false) {
    s.contributed += amount;   // сначала учёт, потом списание: капитал в рассылке верный
    bank += amount;
    s.lastMove = auto ? `+${amount} (время)` : `+${amount}`;
    store.adjust(s.player, -amount);
    if (bank >= fuse) explode(s, t);
    else nextTurn(t);
  }

  function doFlee(s, t) {
    const wasTurn = turnId() === s.player.id;
    s.status = 'out';
    s.refunded = Math.floor(s.contributed / 2);
    s.lastMove = `сбежал (+${s.refunded})`;
    bank -= s.refunded;
    store.adjust(s.player, s.refunded);
    onEvent({ game: 'bomb', kind: 'lose', player: s.player, amount: s.contributed - s.refunded, note: 'сбежал' });
    if (active().length <= 1) return lastStanding(t);
    if (wasTurn) nextTurn(t);
  }

  // ---------- Команды ----------

  function join(player) {
    advance();
    if (phase !== 'lobby') return { error: 'Раунд уже идёт, дождись следующего' };
    if (seats.has(player.id)) return { error: 'Ты уже в раунде' };
    if (seats.size >= MAX_PLAYERS) return { error: `Не больше ${MAX_PLAYERS} игроков` };
    if (player.balance < ENTRY) return { error: `Нужно ${ENTRY} фишек на вход` };
    seats.set(player.id, { player, contributed: ENTRY, refunded: 0, status: 'in', payout: 0, lastMove: null });
    bank += ENTRY;
    store.adjust(player, -ENTRY);
    if (deadline === null) deadline = now() + T.lobbyMs;
    emit();
    return { ok: true };
  }

  function leave(player) {
    advance();
    if (phase !== 'lobby') return { error: 'Раунд уже идёт: можно только сбежать' };
    const s = seats.get(player.id);
    if (!s) return { error: 'Ты не в раунде' };
    seats.delete(player.id);
    bank -= s.contributed;
    store.adjust(player, s.contributed);
    if (!seats.size) deadline = null;
    emit();
    return { ok: true };
  }

  function deposit(player, amount) {
    advance();
    if (phase !== 'playing') return { error: 'Сейчас не время класть' };
    if (turnId() !== player.id) return { error: 'Сейчас не твой ход' };
    if (!Number.isSafeInteger(amount) || amount < MIN_DEPOSIT || amount > MAX_DEPOSIT) {
      return { error: `Взнос: целое от ${MIN_DEPOSIT} до ${MAX_DEPOSIT}` };
    }
    if (amount > player.balance) return { error: 'Не хватает фишек' };
    doDeposit(seats.get(player.id), amount, now());
    emit();
    return { ok: true };
  }

  function flee(player) {
    advance();
    if (phase !== 'playing') return { error: 'Бежать некуда: раунд не идёт' };
    const s = seats.get(player.id);
    if (!s || s.status !== 'in') return { error: 'Ты не в игре' };
    doFlee(s, now());
    emit();
    return { ok: true };
  }

  // ---------- Наружу ----------

  function publicState() {
    const t = now();
    return {
      roundId,
      phase,
      bank,
      entry: ENTRY,
      minDeposit: MIN_DEPOSIT,
      maxDeposit: MAX_DEPOSIT,
      maxPlayers: MAX_PLAYERS,
      timeLeft: deadline === null ? null : Math.max(0, deadline - t),
      turnMs: T.turnMs,
      turn: turnId(),
      players: (order.length ? order : [...seats.keys()]).map((id) => {
        const s = seats.get(id);
        return {
          id,
          name: s.player.name,
          contributed: s.contributed,
          status: s.status,
          lastMove: s.lastMove,
          payout: phase === 'result' ? s.payout : null,
        };
      }),
      result: phase === 'result' ? result : null,  // фитиль виден только после раунда
      history: [...history],
    };
  }

  // Фишки игрока в раунде: всё, что вложил, пока он в игре.
  function reserved(player) {
    const s = seats.get(player.id);
    return s && s.status === 'in' && phase !== 'result' ? s.contributed : 0;
  }

  // При остановке сервера: каждому вернуть ещё не возвращённое.
  function refundAll() {
    if (phase === 'result') return;
    for (const s of seats.values()) {
      const back = s.status === 'in' ? s.contributed : s.status === 'out' ? s.contributed - s.refunded : 0;
      if (back > 0) store.adjust(s.player, back);
    }
    seats = new Map();
    bank = 0;
  }

  // Админ: фитиль (банк, на котором рванёт). Во время игры меняет текущий раунд, иначе следующий.
  function rig(amount) {
    if (!Number.isSafeInteger(amount) || amount < 1) return { error: 'Фитиль: целое число фишек' };
    advance();
    if (phase === 'playing') {
      if (amount <= bank) return { error: `В банке уже ${bank}: фитиль должен быть больше` };
      fuse = amount;
      return { ok: true, round: 'current' };
    }
    rigged = amount;
    return { ok: true, round: 'next' };
  }

  function tick() {
    if (advance()) emit();
  }

  return {
    join,
    leave,
    deposit,
    flee,
    tick,
    reserved,
    refundAll,
    rig,
    state: () => { advance(); return publicState(); },
    adminState: () => { advance(); return { ...publicState(), fuse, rigged }; },
    isIn: (player) => seats.has(player.id),
    start() {
      timer = setInterval(() => {
        try {
          tick();
        } catch (err) {
          console.error('Бомба: ошибка в тике', err);
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
  createBomb, fuseFor, ENTRY, MIN_DEPOSIT, MAX_DEPOSIT, MAX_PLAYERS, LOBBY_MS, TURN_MS, RESULT_MS,
};
