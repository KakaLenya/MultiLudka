'use strict';

const $ = (id) => document.getElementById(id);

const TOKEN_KEY = 'casino.token';
const NAME_KEY = 'casino.name';
const BET_KEY = 'casino.crash.bet';
const AUTO_KEY = 'casino.crash.auto';
const CRASH_GROWTH = 0.07;       // как на сервере: m(t) = exp(0.07 * t)
const CRASH_MAX_AHEAD_MS = 300;  // насколько анимация может обгонять последний пакет

// localStorage может быть недоступен (приватный режим, запрет cookies).
const storage = {
  get(key) { try { return localStorage.getItem(key); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, value); } catch {} },
  remove(key) { try { localStorage.removeItem(key); } catch {} },
};

const state = {
  ws: null,
  me: null,           // { playerId, token, name } после welcome
  token: storage.get(TOKEN_KEY),
  bonus: null,        // { amount, eligible, readyAt (локальное время) }
  balance: 0,
  crash: null,        // последний crash_state
  crashRecvAt: 0,     // performance.now() в момент получения
  retryMs: 1000,
};

$('name').value = storage.get(NAME_KEY) || '';
$('bet-amount').value = storage.get(BET_KEY) || 50;
$('auto-cashout').value = storage.get(AUTO_KEY) || '';

function setConn(stateName, text) {
  $('conn').dataset.state = stateName;
  $('conn').textContent = text;
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
}

function showLogin() {
  $('lobby').hidden = true;
  $('me').hidden = true;
  $('login').hidden = false;
}

let toastTimer = null;
function toast(text, ok = false) {
  $('toast').textContent = text;
  $('toast').classList.toggle('ok', ok);
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { $('toast').textContent = ''; }, 4000);
}

function connect() {
  // Адрес берём из текущей страницы: работает и локально, и через cloudflared.
  const url = (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host;
  const ws = new WebSocket(url);
  state.ws = ws;
  setConn('connecting', 'подключение…');

  ws.addEventListener('open', () => {
    state.retryMs = 1000;
    setConn('open', 'онлайн');
    $('login-btn').disabled = false;
    // Знакомый токен: входим молча. Иначе ждём имя.
    if (state.token) send({ type: 'hello', token: state.token });
    else showLogin();
  });

  ws.addEventListener('message', (ev) => {
    let msg;
    try { msg = JSON.parse(ev.data); } catch { return; }
    const handler = handlers[msg.type];
    if (handler) handler(msg);
  });

  ws.addEventListener('close', () => {
    $('login-btn').disabled = true;
    setConn('closed', 'нет связи, переподключаюсь…');
    setTimeout(connect, state.retryMs);
    state.retryMs = Math.min(state.retryMs * 2, 10000);
  });
}

function formatWait(ms) {
  const totalMin = Math.ceil(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h} ч ${m} мин` : `${m} мин`;
}

function renderBonus() {
  const b = state.bonus;
  if (!b || !b.eligible) {
    $('bonus').hidden = true;
    return;
  }
  $('bonus').hidden = false;
  const wait = b.readyAt - Date.now();
  if (wait > 0) {
    $('bonus-text').textContent = `Следующее пособие (${b.amount} фишек) через ${formatWait(wait)}.`;
    $('bonus-btn').hidden = true;
  } else {
    $('bonus-text').textContent = `Раз в сутки можно взять пособие: ${b.amount} фишек.`;
    $('bonus-btn').hidden = false;
    $('bonus-btn').textContent = `Забрать ${b.amount}`;
  }
}
setInterval(renderBonus, 30_000);

function listItem(name, isSelf) {
  const li = document.createElement('li');
  const span = document.createElement('span');
  span.className = 'name';
  span.textContent = name;
  li.append(span);
  if (isSelf) li.classList.add('self');
  return li;
}

// ---------- Краш ----------

function myCrashBet() {
  const c = state.crash;
  return c && state.me ? c.players.find((p) => p.id === state.me.playerId) || null : null;
}

// Множитель для показа: сервер шлёт ~10 раз в секунду, между пакетами досчитываем сами,
// но не дальше CRASH_MAX_AHEAD_MS вперёд (исход знает только сервер).
function liveMultiplier() {
  const c = state.crash;
  if (!c || c.phase !== 'running') return c ? c.multiplier : 1;
  const ahead = Math.min(performance.now() - state.crashRecvAt, CRASH_MAX_AHEAD_MS);
  const m = Math.exp((CRASH_GROWTH * (c.elapsed + ahead)) / 1000);
  return Math.max(c.multiplier, Math.floor(m * 100) / 100);
}

function phaseTimeLeft() {
  const c = state.crash;
  if (!c || c.timeLeft === null) return 0;
  return Math.max(0, c.timeLeft - (performance.now() - state.crashRecvAt));
}

// Что делает большая кнопка: 'bet', 'cashout' или null (недоступна).
function crashAction() {
  const c = state.crash;
  const mine = myCrashBet();
  if (!c) return { mode: null, label: '…' };
  if (c.phase === 'betting') {
    return mine
      ? { mode: null, label: `Ставка ${mine.amount} принята` }
      : { mode: 'bet', label: 'Поставить' };
  }
  if (c.phase === 'running' && mine && mine.cashout === null) {
    return { mode: 'cashout', label: `Забрать ${Math.floor(mine.amount * liveMultiplier())}` };
  }
  return { mode: null, label: 'Ждём следующий раунд' };
}

function renderCrashAction() {
  const btn = $('crash-action');
  const a = crashAction();
  btn.textContent = a.label;
  btn.disabled = a.mode === null;
  btn.dataset.mode = a.mode || '';
  btn.classList.toggle('cashout', a.mode === 'cashout');
}

function renderCrash() {
  const c = state.crash;
  if (!c) return;

  $('crash-history').replaceChildren(...c.history.map((m) => {
    const span = document.createElement('span');
    span.textContent = `${m.toFixed(2)}×`;
    if (m >= 10) span.className = 'great';
    else if (m >= 2) span.className = 'good';
    return span;
  }));

  const myId = state.me && state.me.playerId;
  $('crash-bets').replaceChildren(...c.players.map((p) => {
    const tr = document.createElement('tr');
    if (p.id === myId) tr.className = 'self';
    const name = document.createElement('td');
    name.textContent = p.name;
    const amount = document.createElement('td');
    amount.textContent = p.amount;
    const result = document.createElement('td');
    if (p.cashout !== null) {
      result.textContent = `${p.cashout.toFixed(2)}× · +${p.payout - p.amount}`;
      result.className = 'won';
    } else if (c.phase === 'crashed') {
      result.textContent = `−${p.amount}`;
      result.className = 'lost';
    } else {
      result.textContent = '…';
    }
    tr.append(name, amount, result);
    return tr;
  }));

  const mine = myCrashBet();
  const my = $('crash-my');
  if (mine && mine.cashout !== null) {
    my.textContent = `Забрал ${mine.payout} на ${mine.cashout.toFixed(2)}× (+${mine.payout - mine.amount})`;
    my.className = 'my-result win';
  } else if (mine && c.phase === 'crashed') {
    my.textContent = `Сгорело ${mine.amount}`;
    my.className = 'my-result lose';
  } else {
    my.textContent = '';
    my.className = 'my-result';
  }

  renderCrashAction();
}

const canvas = $('crash-canvas');
const ctx = canvas.getContext('2d');

function drawCrash(m) {
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth;
  const h = canvas.clientHeight;
  if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const c = state.crash;
  if (!c) return;

  if (c.phase === 'betting') {
    // Полоска обратного отсчёта приёма ставок.
    const total = 8000;
    ctx.fillStyle = 'rgba(242, 193, 78, 0.25)';
    ctx.fillRect(0, h - 6, (w * phaseTimeLeft()) / total, 6);
    return;
  }

  // Время полёта выводим из множителя: t = ln(m) / 0.07.
  const tNow = Math.log(m) / CRASH_GROWTH;
  const tMax = Math.max(10, tNow * 1.1);
  const mMax = Math.max(2, m * 1.15);
  const pad = 16;
  const x = (t) => pad + ((w - 2 * pad) * t) / tMax;
  const y = (mult) => h - pad - ((h - 2 * pad) * (mult - 1)) / (mMax - 1);

  const color = c.phase === 'crashed' ? '229, 97, 91' : '242, 193, 78';
  ctx.beginPath();
  ctx.moveTo(x(0), y(1));
  const steps = 60;
  for (let i = 1; i <= steps; i++) {
    const t = (tNow * i) / steps;
    ctx.lineTo(x(t), y(Math.exp(CRASH_GROWTH * t)));
  }
  ctx.strokeStyle = `rgb(${color})`;
  ctx.lineWidth = 3;
  ctx.stroke();
  ctx.lineTo(x(tNow), y(1));
  ctx.closePath();
  ctx.fillStyle = `rgba(${color}, 0.12)`;
  ctx.fill();
}

function crashFrame() {
  const c = state.crash;
  if (c && !$('lobby').hidden) {
    const m = liveMultiplier();
    const mult = $('crash-mult');
    mult.textContent = `${m.toFixed(2)}×`;
    mult.dataset.phase = c.phase;
    const secs = Math.ceil(phaseTimeLeft() / 1000);
    $('crash-phase').textContent =
      c.phase === 'betting' ? `Приём ставок: ${secs} с`
        : c.phase === 'running' ? 'Летим!'
          : `Краш! Новый раунд через ${secs} с`;
    drawCrash(m);
    if (c.phase === 'running') renderCrashAction();
  }
  requestAnimationFrame(crashFrame);
}
requestAnimationFrame(crashFrame);

function readBetAmount() {
  const n = Math.floor(Number($('bet-amount').value));
  return Number.isFinite(n) ? n : 0;
}

$('crash-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const mode = $('crash-action').dataset.mode;
  if (mode === 'cashout') {
    send({ type: 'crash_cashout' });
    return;
  }
  if (mode !== 'bet') return;

  const amount = readBetAmount();
  const autoRaw = $('auto-cashout').value.trim();
  const autoCashout = autoRaw === '' ? undefined : Number(autoRaw);
  storage.set(BET_KEY, String(amount));
  storage.set(AUTO_KEY, autoRaw);
  send({ type: 'crash_bet', amount, autoCashout });
});

document.querySelectorAll('[data-quick]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const v = readBetAmount();
    const next = {
      half: Math.floor(v / 2),
      double: v * 2,
      max: state.balance,
    }[btn.dataset.quick];
    $('bet-amount').value = Math.max(10, Math.min(next, Math.max(10, state.balance)));
  });
});

// Пробел: поставить/забрать, если фокус не в поле ввода.
document.addEventListener('keydown', (ev) => {
  if (ev.code !== 'Space' || ev.repeat) return;
  if (['INPUT', 'TEXTAREA', 'BUTTON'].includes(document.activeElement.tagName)) return;
  if ($('lobby').hidden || $('crash-action').disabled) return;
  ev.preventDefault();
  $('crash-form').requestSubmit();
});

// ---------- Вкладки ----------

const TAB_KEY = 'casino.tab';

function showTab(name) {
  document.querySelectorAll('.tab').forEach((t) => t.classList.toggle('active', t.dataset.tab === name));
  for (const id of ['crash', 'roulette', 'poker']) $(id).hidden = name !== id;
  storage.set(TAB_KEY, name);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
showTab(['roulette', 'poker'].includes(storage.get(TAB_KEY)) ? storage.get(TAB_KEY) : 'crash');

// ---------- Звуки (WebAudio, без файлов) ----------

const SOUND_KEY = 'casino.sound';
let soundOn = storage.get(SOUND_KEY) !== 'off';
let audio = null;

function renderSoundBtn() {
  $('sound').textContent = soundOn ? '🔊' : '🔇';
}
renderSoundBtn();
$('sound').addEventListener('click', () => {
  soundOn = !soundOn;
  storage.set(SOUND_KEY, soundOn ? 'on' : 'off');
  renderSoundBtn();
});

// notes: [[частота Гц, длительность с], ...]
function beep(notes, type = 'sine') {
  if (!soundOn) return;
  try {
    audio = audio || new AudioContext();
    let t = audio.currentTime;
    for (const [freq, dur] of notes) {
      const osc = audio.createOscillator();
      const gain = audio.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.12, t);
      gain.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(gain).connect(audio.destination);
      osc.start(t);
      osc.stop(t + dur);
      t += dur * 0.9;
    }
  } catch { /* без звука */ }
}

const sounds = {
  win: () => beep([[523, 0.12], [659, 0.12], [784, 0.25]], 'triangle'),
  lose: () => beep([[220, 0.25], [165, 0.35]], 'sawtooth'),
  turn: () => beep([[880, 0.08], [1175, 0.12]]),
  dice: () => beep([[300, 0.04], [420, 0.04], [360, 0.05]], 'square'),
};

// ---------- Покер на кубиках ----------

const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };

function dieEl(value, { small = false, rolling = false } = {}) {
  const el = document.createElement('button');
  el.type = 'button';
  el.className = 'die' + (small ? ' small' : '') + (rolling ? ' rolling' : '');
  el.setAttribute('aria-label', `кубик ${value}`);
  for (let i = 0; i < 9; i++) {
    const pip = document.createElement('i');
    if (PIPS[value].includes(i)) pip.className = 'on';
    el.append(pip);
  }
  return el;
}

const poker = {
  view: null,
  recvAt: 0,
  pick: new Set(),        // индексы кубиков, отмеченных на перебросок
  shownDice: null,        // что уже нарисовано (для анимации только изменившихся)
  lastResultHand: 0,
  wasMyTurn: false,
};

function pokerTimeLeft() {
  const v = poker.view;
  if (!v || v.timeLeft === null) return 0;
  return Math.max(0, v.timeLeft - (performance.now() - poker.recvAt));
}

function seatName(i) {
  const s = poker.view.seats[i];
  return s ? s.name : '?';
}

function renderPokerPhase() {
  const v = poker.view;
  if (!v) return;
  const secs = Math.ceil(pokerTimeLeft() / 1000);
  const text = {
    waiting: 'Ждём игроков: нужно двое за столом',
    starting: `Раздача через ${secs} с`,
    bet1: `Круг ставок 1 · ходит ${v.turn !== null ? seatName(v.turn) : ''} · ${secs} с`,
    reroll: `Перебросок · ${secs} с`,
    bet2: `Круг ставок 2 · ходит ${v.turn !== null ? seatName(v.turn) : ''} · ${secs} с`,
    showdown: 'Итоги раздачи',
  }[v.phase];
  $('poker-phase').textContent = text;
}
setInterval(renderPokerPhase, 250);

function renderPokerSeats() {
  const v = poker.view;
  const result = v.result;
  const handsBySeat = new Map((result ? result.hands : []).map((h) => [h.seat, h]));
  const wonBySeat = new Map((result ? result.winners : []).map((w) => [w.seat, w.won]));
  const myId = state.me && state.me.playerId;

  $('poker-seats').replaceChildren(...v.seats.map((s, i) => {
    const el = document.createElement('div');
    if (!s) {
      el.className = 'seat empty';
      el.textContent = 'свободно';
      return el;
    }
    el.className = 'seat';
    if (s.id === myId) el.classList.add('mine');
    if (v.turn === i) el.classList.add('turn');
    if (s.folded) el.classList.add('folded');
    if (wonBySeat.has(i)) el.classList.add('winner');

    const top = document.createElement('div');
    top.className = 'top';
    const who = document.createElement('span');
    who.className = 'who';
    who.textContent = s.name;
    top.append(who);
    if (v.dealer === i && v.phase !== 'waiting') {
      const d = document.createElement('span');
      d.className = 'badge';
      d.textContent = 'D';
      d.title = 'Дилер';
      top.append(d);
    }
    if (!s.connected) {
      const off = document.createElement('span');
      off.className = 'off';
      off.textContent = 'нет связи';
      top.append(off);
    }

    const stack = document.createElement('div');
    stack.className = 'stack';
    stack.textContent = `${s.stack} фишек`;

    const status = document.createElement('div');
    status.className = 'status';
    const handActive = ['bet1', 'reroll', 'bet2'].includes(v.phase);
    if (s.leaving) status.textContent = 'уходит';
    else if (s.folded) status.textContent = 'пас';
    else if (handActive && !s.inHand) status.textContent = 'ждёт раздачу';
    else if (s.decided === false) status.textContent = 'выбирает кубики…';
    else if (s.decided === true) status.textContent = 'готов';
    else if (s.rerolled !== null && s.rerolled !== undefined && handActive) {
      status.textContent = s.rerolled === 0 ? 'ничего не перебросил' : `перебросил ${s.rerolled}`;
    }

    el.append(top, stack, status);

    if (s.lastAction && handActive && !s.folded) {
      const act = document.createElement('div');
      act.className = 'bet';
      act.textContent = s.lastAction;
      el.append(act);
    }

    if (s.committed > 0 && handActive) {
      const bet = document.createElement('div');
      bet.className = 'bet';
      bet.textContent = `в круге: ${s.committed}`;
      el.append(bet);
    }

    const shown = handsBySeat.get(i);
    if (shown) {
      const dice = document.createElement('div');
      dice.className = 'dice';
      dice.append(...shown.dice.map((d) => dieEl(d, { small: true })));
      const name = document.createElement('div');
      name.className = 'status';
      name.textContent = shown.hand;
      el.append(dice, name);
    }
    if (wonBySeat.has(i)) {
      const won = document.createElement('div');
      won.className = 'won';
      won.textContent = `+${wonBySeat.get(i)}`;
      el.append(won);
    }
    return el;
  }));
}

function renderMyDice() {
  const v = poker.view;
  const you = v.you;
  const box = $('my-dice');
  if (!you || !you.dice) {
    box.replaceChildren();
    poker.shownDice = null;
    return;
  }
  const prev = poker.shownDice;
  const picking = you.needReroll;
  box.replaceChildren(...you.dice.map((d, i) => {
    // Крутим только новые кубики: при раздаче все, после переброса изменившиеся.
    const changed = !prev || prev[i] !== d || (prev.handId !== v.handId);
    const el = dieEl(d, { rolling: changed });
    if (picking) {
      el.classList.add('pick');
      el.title = 'Нажми, чтобы перебросить';
      if (poker.pick.has(i)) el.classList.add('reroll');
      el.addEventListener('click', () => {
        if (poker.pick.has(i)) poker.pick.delete(i);
        else poker.pick.add(i);
        renderMyDice();
      });
    } else if (you.keep && v.phase === 'reroll' && !you.keep[i]) {
      el.classList.add('reroll');
    }
    return el;
  }));
  const changedAny = !prev || prev.handId !== v.handId || you.dice.some((d, i) => prev[i] !== d);
  if (changedAny) sounds.dice();
  poker.shownDice = Object.assign([...you.dice], { handId: v.handId });
}

function renderPoker() {
  const v = poker.view;
  if (!v) return;
  const you = v.you;

  $('poker-pot').textContent = v.pot;
  renderPokerPhase();
  renderPokerSeats();

  // Итог раздачи.
  const res = v.result;
  if (res) {
    const winners = res.winners.map((w) => `${w.name} +${w.won}`).join(', ');
    const how = res.revealed
      ? (res.hands.find((h) => h.seat === res.winners[0].seat) || {}).hand
      : 'остальные сбросили';
    $('poker-result').textContent = `${res.winners.length > 1 ? 'Ничья' : 'Банк забирает'}: ${winners} (${how})`;
    $('poker-result').hidden = false;
    if (poker.lastResultHand !== res.handId) {
      poker.lastResultHand = res.handId;
      if (you && res.winners.some((w) => w.seat === you.seat)) sounds.win();
      else if (you && you.dice) sounds.lose();
    }
  } else {
    $('poker-result').hidden = true;
  }

  // Мои кубики.
  $('poker-me').hidden = !(you && you.dice);
  if (you && you.dice) {
    if (!you.needReroll) poker.pick.clear();
    renderMyDice();
    $('my-hand-name').textContent = you.hand || '';
    $('poker-hint').textContent =
      you.myTurn ? 'Твой ход'
        : you.needReroll ? 'Отметь кубики, которые хочешь перебросить'
          : v.phase === 'reroll' && you.inHand ? 'Ждём остальных'
            : !you.inHand && v.phase !== 'showdown' ? 'Ты сбросил' : '';
  }

  // Кнопки.
  $('poker-join').hidden = !!you;
  $('poker-leave').hidden = !you;
  $('poker-leave').textContent = you && you.leaving ? 'Встанешь после раздачи' : 'Встать из-за стола';
  $('poker-leave').disabled = !!(you && you.leaving);

  const acting = !!(you && you.myTurn);
  $('poker-actions').hidden = !acting;
  if (acting) {
    const btn = (a) => document.querySelector(`[data-act="${a}"]`);
    btn('check').hidden = !you.canCheck;
    btn('call').hidden = !you.canCall;
    btn('call').textContent = `Уравнять ${you.toCall}`;
    btn('bet').hidden = !you.canBet;
    btn('raise').hidden = !you.canRaise;
    const canSize = you.canBet || you.canRaise;
    $('raise-amount').closest('label').hidden = !canSize;
    $('raise-amount').max = you.maxRaise;
    $('raise-label').textContent = `${you.canBet ? 'Ставка' : 'Повысить на'} (до ${you.maxRaise})`;
    const cur = Number($('raise-amount').value);
    if (!(cur >= you.minRaise && cur <= you.maxRaise)) $('raise-amount').value = you.minRaise;
  }
  $('poker-reroll').hidden = !(you && you.needReroll);

  // Мой ход: звук и точка на вкладке.
  const myTurnNow = !!(you && (you.myTurn || you.needReroll));
  if (myTurnNow && !poker.wasMyTurn) sounds.turn();
  poker.wasMyTurn = myTurnNow;
  $('poker-dot').hidden = !myTurnNow;
}

$('poker-join').addEventListener('submit', (ev) => {
  ev.preventDefault();
  send({ type: 'poker_join', buyIn: Math.floor(Number($('buyin').value)) });
});

$('poker-leave').addEventListener('click', () => send({ type: 'poker_leave' }));

document.querySelectorAll('[data-act]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.act;
    const msg = { type: 'poker_action', action };
    if (action === 'bet' || action === 'raise') msg.amount = Math.floor(Number($('raise-amount').value));
    send(msg);
  });
});

$('reroll-btn').addEventListener('click', () => {
  send({ type: 'poker_reroll', keep: [0, 1, 2, 3, 4].map((i) => !poker.pick.has(i)) });
});
$('keep-all-btn').addEventListener('click', () => {
  send({ type: 'poker_reroll', keep: [true, true, true, true, true] });
});

// ---------- Чат ----------

function chatItem(m) {
  const li = document.createElement('li');
  if (m.playerId === null) li.className = 'system';
  else if (state.me && m.playerId === state.me.playerId) li.className = 'self';
  const time = document.createElement('span');
  time.className = 'time';
  time.textContent = new Date(m.at).toLocaleTimeString('ru', { hour: '2-digit', minute: '2-digit' });
  const author = document.createElement('span');
  author.className = 'author';
  author.textContent = m.name;
  const text = document.createElement('span');
  text.textContent = m.text;
  li.append(time, author, text);
  return li;
}

function renderChat(messages, append) {
  const log = $('chat-log');
  // Прокручиваем вниз, только если человек и так был внизу (не мешаем читать историю).
  const atBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 30;
  if (!append) log.replaceChildren();
  log.querySelector('.empty')?.remove();
  log.append(...messages.map(chatItem));
  if (!log.children.length) {
    const li = document.createElement('li');
    li.className = 'empty';
    li.textContent = 'Пока тихо';
    log.append(li);
  }
  while (log.children.length > 50) log.firstChild.remove();
  if (atBottom || !append) log.scrollTop = log.scrollHeight;
}

$('order-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const trackId = $('order-track').value;
  if (!trackId) return toast('Выбери песню из списка');
  send({ type: 'song_request', trackId });
  $('order-track').value = '';
});

$('chat-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const text = $('chat-input').value.trim();
  if (!text) return;
  send({ type: 'chat', text });
  $('chat-input').value = '';
});

// ---------- Рулетка ----------

const R_WHEEL = [0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
  24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26];
const R_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const R_STEP = (2 * Math.PI) / R_WHEEL.length;
const R_CHIPS = [10, 50, 100, 500, 1000, 5000];
const R_CHIP_KEY = 'casino.roulette.chip';
const rColor = (n) => (n === 0 ? 'green' : R_RED.has(n) ? 'red' : 'black');

// Как на сервере: какие ставки выигрывают при номере n.
const R_WINS = {
  straight: (n, num) => n === num,
  red: (n) => R_RED.has(n),
  black: (n) => n !== 0 && !R_RED.has(n),
  even: (n) => n !== 0 && n % 2 === 0,
  odd: (n) => n % 2 === 1,
  low: (n) => n >= 1 && n <= 18,
  high: (n) => n >= 19,
  dozen1: (n) => n >= 1 && n <= 12,
  dozen2: (n) => n >= 13 && n <= 24,
  dozen3: (n) => n >= 25,
  column1: (n) => n !== 0 && n % 3 === 1,
  column2: (n) => n !== 0 && n % 3 === 2,
  column3: (n) => n !== 0 && n % 3 === 0,
};

const rl = {
  view: null,
  recvAt: 0,
  chip: Number(storage.get(R_CHIP_KEY)) || 50,
  rotation: 0,          // текущий поворот колеса
  spin: null,           // { roundId, from, to }
  lastResultRound: 0,
  cells: [],            // [{ el, type, number }]
};
if (!R_CHIPS.includes(rl.chip)) rl.chip = 50;

// Чипы выбора номинала.
$('r-chips').replaceChildren(...R_CHIPS.map((v) => {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = 'chip';
  b.dataset.v = v;
  b.textContent = v >= 1000 ? `${v / 1000}k` : v;
  b.addEventListener('click', () => {
    rl.chip = v;
    storage.set(R_CHIP_KEY, String(v));
    renderChips();
  });
  return b;
}));
function renderChips() {
  document.querySelectorAll('.chip').forEach((c) => c.classList.toggle('active', Number(c.dataset.v) === rl.chip));
}
renderChips();

// Поле: зеро, 12x3 номеров, колонки, дюжины, внешние ставки.
(function buildBoard() {
  const cells = [];
  const add = (label, type, number, col, row, cls) => {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = `cell ${cls || ''}`;
    el.style.gridColumn = col;
    el.style.gridRow = row;
    el.textContent = label;
    el.addEventListener('click', () => {
      send({ type: 'roulette_bet', betType: type, number, amount: rl.chip });
    });
    cells.push({ el, type, number });
  };
  add('0', 'straight', 0, '1', '1 / 4', 'green');
  for (let c = 1; c <= 12; c++) {
    for (let r = 1; r <= 3; r++) {
      const n = 3 * c - (r - 1);   // верхний ряд 3,6,...,36
      add(String(n), 'straight', n, String(c + 1), String(r), rColor(n));
    }
  }
  add('2:1', 'column3', null, '14', '1');
  add('2:1', 'column2', null, '14', '2');
  add('2:1', 'column1', null, '14', '3');
  add('1-12', 'dozen1', null, '2 / 6', '4');
  add('13-24', 'dozen2', null, '6 / 10', '4');
  add('25-36', 'dozen3', null, '10 / 14', '4');
  add('1-18', 'low', null, '2 / 4', '5');
  add('Чёт', 'even', null, '4 / 6', '5');
  add('◆', 'red', null, '6 / 8', '5', 'red');
  add('◆', 'black', null, '8 / 10', '5', 'black');
  add('Нечёт', 'odd', null, '10 / 12', '5');
  add('19-36', 'high', null, '12 / 14', '5');
  $('r-board').replaceChildren(...cells.map((c) => c.el));
  rl.cells = cells;
})();

$('r-clear').addEventListener('click', () => send({ type: 'roulette_clear' }));

function myRouletteBets() {
  const v = rl.view;
  return v && state.me ? v.players.find((p) => p.id === state.me.playerId) || null : null;
}

function rouletteTimeLeft() {
  return rl.view ? Math.max(0, rl.view.timeLeft - (performance.now() - rl.recvAt)) : 0;
}

function renderRoulette() {
  const v = rl.view;
  if (!v) return;
  const mine = myRouletteBets();
  const betting = v.phase === 'betting';

  // История.
  $('r-history').replaceChildren(...v.history.map((h) => {
    const s = document.createElement('span');
    s.textContent = h.n;
    s.className = h.color === 'red' ? '' : h.color === 'green' ? 'good' : 'great';
    s.style.color = h.color === 'red' ? '#ff6b61' : h.color === 'green' ? 'var(--green)' : '#ddd';
    return s;
  }));

  // Мои фишки на поле и подсветка выигравших клеток.
  const stakes = new Map();
  for (const b of (mine ? mine.bets : [])) stakes.set(`${b.type}:${b.number}`, b.amount);
  for (const c of rl.cells) {
    c.el.disabled = !betting;
    c.el.querySelector('.stake')?.remove();
    const amt = stakes.get(`${c.type}:${c.number}`);
    if (amt) {
      const s = document.createElement('span');
      s.className = 'stake';
      s.textContent = amt >= 1000 ? `${Math.round(amt / 100) / 10}k` : amt;
      c.el.append(s);
    }
    c.el.classList.toggle('win', v.phase === 'result' && R_WINS[c.type](v.result, c.number));
  }

  $('r-mytotal').textContent = mine ? `Твои ставки: ${mine.total}` : '';
  $('r-clear').disabled = !(betting && mine);

  // Итог раунда.
  const res = $('r-result');
  if (v.phase === 'result' && mine) {
    res.textContent = mine.won > 0 ? `Выигрыш ${mine.won} (+${mine.won - mine.total})` : `Мимо: −${mine.total}`;
    res.className = `r-result ${mine.won > 0 ? 'win' : 'lose'}`;
  } else {
    res.textContent = '';
    res.className = 'r-result';
  }
  if (v.phase === 'result' && rl.lastResultRound !== v.roundId) {
    rl.lastResultRound = v.roundId;
    if (mine && mine.won > 0) sounds.win();
    else if (mine) sounds.lose();
  }

  // Ставки игроков.
  $('r-bets').replaceChildren(...v.players.map((p) => {
    const tr = document.createElement('tr');
    if (state.me && p.id === state.me.playerId) tr.className = 'self';
    const name = document.createElement('td');
    name.textContent = p.name;
    const total = document.createElement('td');
    total.textContent = p.total;
    const won = document.createElement('td');
    if (p.won !== null) {
      won.textContent = p.won > 0 ? `+${p.won - p.total}` : `−${p.total}`;
      won.className = p.won > 0 ? 'won' : 'lost';
    } else {
      won.textContent = '…';
    }
    tr.append(name, total, won);
    return tr;
  }));
}

// Колесо: рисуем каждый кадр, во время вращения плавно доводим до выпавшего номера.
const rCanvas = $('r-wheel');
const rCtx = rCanvas.getContext('2d');

function drawWheel(rotation) {
  const dpr = window.devicePixelRatio || 1;
  const size = 260;
  if (rCanvas.width !== size * dpr) {
    rCanvas.width = size * dpr;
    rCanvas.height = size * dpr;
  }
  const ctx = rCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, size, size);
  const c = size / 2;
  const outer = c - 4;
  const inner = outer - 34;
  ctx.save();
  ctx.translate(c, c);
  ctx.rotate(rotation - Math.PI / 2 - R_STEP / 2);  // номер 0 по центру сверху при rotation = 0
  R_WHEEL.forEach((n, i) => {
    const a0 = i * R_STEP;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, outer, a0, a0 + R_STEP);
    ctx.closePath();
    ctx.fillStyle = n === 0 ? '#1e7a46' : R_RED.has(n) ? '#b3261e' : '#161616';
    ctx.fill();
    ctx.strokeStyle = 'rgba(242, 193, 78, .5)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.save();
    ctx.rotate(a0 + R_STEP / 2);
    ctx.translate(outer - 15, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.font = 'bold 12px system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  });
  ctx.beginPath();
  ctx.arc(0, 0, inner, 0, 2 * Math.PI);
  ctx.fillStyle = '#0f1a14';
  ctx.fill();
  ctx.strokeStyle = 'rgba(242, 193, 78, .6)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.restore();
}

const easeOut = (x) => 1 - (1 - x) ** 4;
// Поворот, при котором номер n стоит под указателем.
const restingRotation = (n) => -R_WHEEL.indexOf(n) * R_STEP;

function rouletteFrame() {
  const v = rl.view;
  if (v && !$('roulette').hidden) {
    if (v.phase === 'spinning') {
      if (!rl.spin || rl.spin.roundId !== v.roundId) {
        // Старт вращения: минимум 5 оборотов и остановка ровно на выпавшем номере.
        const from = rl.rotation;
        const base = restingRotation(v.result);
        const turns = Math.ceil((from - base) / (2 * Math.PI)) + 5;
        rl.spin = { roundId: v.roundId, from, to: base + turns * 2 * Math.PI };
      }
      const p = Math.min(1, 1 - rouletteTimeLeft() / v.spinMs);
      rl.rotation = rl.spin.from + (rl.spin.to - rl.spin.from) * easeOut(p);
    } else if (v.phase === 'result' && v.result !== null) {
      // Видели вращение: стоим там, где оно закончилось; зашли позже: просто ставим на номер.
      rl.rotation = rl.spin && rl.spin.roundId === v.roundId ? rl.spin.to : restingRotation(v.result);
    }
    drawWheel(rl.rotation);

    const center = $('r-center');
    const secs = Math.ceil(rouletteTimeLeft() / 1000);
    if (v.phase === 'betting') {
      center.textContent = secs;
      center.className = 'r-center';
      $('r-phase').textContent = `Делайте ставки: ${secs} с`;
    } else if (v.phase === 'spinning') {
      center.textContent = '…';
      center.className = 'r-center';
      $('r-phase').textContent = 'Ставок больше нет, колесо крутится';
    } else {
      center.textContent = v.result;
      center.className = `r-center ${v.color}`;
      $('r-phase').textContent = `Выпало ${v.result}. Новый раунд через ${secs} с`;
    }
  }
  requestAnimationFrame(rouletteFrame);
}
requestAnimationFrame(rouletteFrame);

// ---------- Музыка (включает админ, файлы из папки music на сервере) ----------

const MUSIC_KEY = 'casino.music';
const VOLUME_KEY = 'casino.volume.pos';  // положение ползунка 0..100
const music = {
  track: null,          // { id, title, url, offset }
  recvAt: 0,
  on: storage.get(MUSIC_KEY) !== 'off',
  loadedId: null,       // какой трек сейчас в <audio>
};
const audioEl = $('music-audio');
// Слух логарифмический: при линейной громкости почти весь ход ползунка звучит одинаково,
// а у нуля звук резко пропадает. Квадрат даёт ровное «тише-громче» по всей длине.
const volumeFromSlider = (pos) => (pos / 100) ** 2;
function applyVolume() {
  audioEl.volume = volumeFromSlider(Number($('music-volume').value));
}
const savedPos = Number(storage.get(VOLUME_KEY));
$('music-volume').value = Number.isFinite(savedPos) && storage.get(VOLUME_KEY) !== null ? savedPos : 70;
applyVolume();

// iPhone/iPad не дают странице менять громкость (volume всегда 1): прячем ползунок.
(function detectFixedVolume() {
  const probe = new Audio();
  probe.volume = 0.5;
  if (probe.volume === 1) {
    $('music-volume-box').hidden = true;
    $('music-volume-hint').hidden = false;
  }
})();

// Где сейчас трек у всех: смещение от сервера + сколько прошло с получения.
function musicPosition() {
  return music.track.offset + (performance.now() - music.recvAt) / 1000;
}

function tryPlay() {
  audioEl.play().then(
    () => { $('music-start').hidden = true; },
    // Браузер не даёт играть звук, пока человек ничего не нажал на странице.
    () => { $('music-start').hidden = false; },
  );
}

function renderMusic() {
  const t = music.track;
  $('music').hidden = !t;
  $('music').classList.toggle('off', !!t && !music.on);
  if (!t || !music.on) {
    audioEl.pause();
    audioEl.removeAttribute('src');
    music.loadedId = null;
    $('music-start').hidden = true;
    if (t) {
      $('music-title').textContent = `🎵 ${t.title}`;
      $('music-toggle').textContent = 'включить';
    }
    return;
  }
  $('music-title').textContent = `🎵 ${t.title}`;
  $('music-toggle').textContent = 'выключить у себя';
  if (music.loadedId === t.id) return;
  music.loadedId = t.id;
  audioEl.src = t.url;
  // Перематываем, когда браузер узнал длину трека.
  audioEl.onloadedmetadata = () => {
    const pos = musicPosition();
    if (Number.isFinite(audioEl.duration) && pos >= audioEl.duration) {
      audioEl.pause();  // трек у всех уже закончился
      return;
    }
    audioEl.currentTime = pos;
    tryPlay();
  };
}

$('music-start').addEventListener('click', () => {
  if (music.track) audioEl.currentTime = musicPosition();
  tryPlay();
});

$('music-toggle').addEventListener('click', () => {
  music.on = !music.on;
  storage.set(MUSIC_KEY, music.on ? 'on' : 'off');
  renderMusic();
});

$('music-volume').addEventListener('input', () => {
  applyVolume();
  storage.set(VOLUME_KEY, $('music-volume').value);
});

// ---------- Объявления и эффекты от админа ----------

function showBanner(text) {
  const el = document.createElement('div');
  el.className = 'banner';
  const inner = document.createElement('div');
  inner.className = 'banner-text';
  inner.textContent = text;
  el.append(inner);
  el.addEventListener('click', () => el.remove());
  document.body.append(el);
  beep([[660, 0.15], [880, 0.15], [1320, 0.3]], 'triangle');
  setTimeout(() => el.remove(), 7000);
}

// Падающие частицы: цветные бумажки или эмодзи.
function rain(symbols, count) {
  const layer = document.createElement('div');
  layer.className = 'fx-layer';
  const colors = ['#f2c14e', '#4fd18b', '#e5615b', '#6fa8ff', '#d77bff'];
  for (let i = 0; i < count; i++) {
    const p = document.createElement('span');
    p.className = symbols ? 'fx-emoji' : 'fx-confetti';
    if (symbols) p.textContent = symbols[i % symbols.length];
    else p.style.background = colors[i % colors.length];
    p.style.left = `${Math.random() * 100}vw`;
    p.style.animationDelay = `${Math.random() * 1.2}s`;
    p.style.animationDuration = `${2 + Math.random() * 1.5}s`;
    p.style.setProperty('--spin', `${(Math.random() - 0.5) * 1440}deg`);
    layer.append(p);
  }
  document.body.append(layer);
  setTimeout(() => layer.remove(), 5000);
}

function bodyEffect(cls, ms) {
  document.body.classList.remove(cls);
  void document.body.offsetWidth;  // перезапуск анимации, если эффект прислали дважды
  document.body.classList.add(cls);
  setTimeout(() => document.body.classList.remove(cls), ms);
}

const effects = {
  confetti: () => { rain(null, 140); sounds.win(); },
  money: () => { rain(['💸', '💰', '🪙', '💵'], 70); sounds.win(); },
  shake: () => { bodyEffect('fx-shake', 900); beep([[90, 0.4]], 'sawtooth'); },
  flip: () => bodyEffect('fx-flip', 6000),
  disco: () => { bodyEffect('fx-disco', 6000); beep([[523, 0.1], [659, 0.1], [523, 0.1], [784, 0.2]], 'square'); },
};

// ---------- Сообщения сервера ----------

const handlers = {
  welcome(msg) {
    state.me = msg;
    state.token = msg.token;
    storage.set(TOKEN_KEY, msg.token);
    storage.set(NAME_KEY, msg.name);
    $('login').hidden = true;
    $('lobby').hidden = false;
    $('me').hidden = false;
    $('me-name').textContent = msg.name;
    $('me-balance').textContent = msg.balance;
    state.balance = msg.balance;
  },

  music(msg) {
    // Новый трек от админа: снова пускаем видео, даже если тот же самый клип включили заново.
    if (msg.track && music.track && msg.track.id === music.track.id && msg.track.offset === 0) music.loadedId = null;
    music.track = msg.track;
    music.recvAt = performance.now();
    renderMusic();
  },

  roulette_state(msg) {
    rl.view = msg;
    rl.recvAt = performance.now();
    renderRoulette();
  },

  notice(msg) {
    toast(msg.message, true);
  },

  music_library(msg) {
    const select = $('order-track');
    const current = select.value;
    select.replaceChildren(select.options[0], ...msg.tracks.map((t) => {
      const o = document.createElement('option');
      o.value = t.id;
      o.textContent = t.title;
      return o;
    }));
    select.value = msg.tracks.some((t) => t.id === current) ? current : '';
    $('order-form').hidden = !msg.tracks.length;
  },

  announce(msg) {
    showBanner(msg.text);
  },

  fx(msg) {
    if (Object.hasOwn(effects, msg.effect)) effects[msg.effect]();
  },

  chat_history(msg) {
    renderChat(msg.messages, false);
  },

  chat(msg) {
    renderChat([msg.message], true);
  },

  poker_state(msg) {
    poker.view = msg;
    poker.recvAt = performance.now();
    renderPoker();
  },

  crash_state(msg) {
    // Звук на краше, если у меня была ставка, которую я не забрал.
    const prev = state.crash;
    const findMine = (s) => s && s.players.find((p) => state.me && p.id === state.me.playerId);
    const mine = findMine(msg);
    const minePrev = findMine(prev);
    if (prev && prev.phase === 'running' && msg.phase === 'crashed' && mine && mine.cashout === null) sounds.lose();
    if (mine && mine.cashout !== null && minePrev && minePrev.cashout === null) sounds.win();
    state.crash = msg;
    state.crashRecvAt = performance.now();
    renderCrash();
  },

  balance(msg) {
    state.balance = msg.balance;
    $('me-balance').textContent = msg.balance;
    state.bonus = {
      amount: msg.bonus.amount,
      eligible: msg.bonus.eligible,
      readyAt: Date.now() + msg.bonus.availableIn,
    };
    renderBonus();
  },

  online(msg) {
    $('online-list').replaceChildren(...msg.players.map((p) =>
      listItem(p.name, state.me && p.id === state.me.playerId)));
    $('online-count').textContent = msg.players.length;
  },

  leaderboard(msg) {
    $('leaderboard').replaceChildren(...msg.players.map((p) => {
      const li = listItem(p.name, state.me && p.id === state.me.playerId);
      if (!p.online) li.classList.add('offline');
      const score = document.createElement('span');
      score.className = 'score';
      score.textContent = p.capital;
      li.append(score);
      return li;
    }));
  },

  error(msg) {
    if (msg.code === 'bad_token') {
      state.token = null;
      storage.remove(TOKEN_KEY);
      showLogin();
    }
    if (state.me) toast(msg.message);
    else $('login-error').textContent = msg.message;
    console.warn('server error:', msg.message);
  },
};

$('login-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = $('name').value.trim();
  if (!name) return;
  $('login-error').textContent = '';
  send({ type: 'hello', name });
});

$('bonus-btn').addEventListener('click', () => send({ type: 'claim_bonus' }));

$('logout').addEventListener('click', () => {
  if (!confirm('Выйти? Без этого браузера вернуться к игроку не получится.')) return;
  storage.remove(TOKEN_KEY);
  location.reload();
});

connect();
