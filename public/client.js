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

// Кружок с первой буквой; цвет постоянный для имени.
function avatarEl(name) {
  const a = document.createElement('span');
  a.className = 'avatar';
  a.textContent = [...name.trim()][0] || '?';
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.codePointAt(0)) % 360;
  a.style.setProperty('--h', h);
  return a;
}

function listItem(name, isSelf) {
  const li = document.createElement('li');
  li.append(avatarEl(name));
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
  ctx.save();
  ctx.shadowColor = `rgba(${color}, .8)`;
  ctx.shadowBlur = 16;
  ctx.strokeStyle = `rgb(${color})`;
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.restore();
  ctx.lineTo(x(tNow), y(1));
  ctx.lineTo(x(0), y(1));
  ctx.closePath();
  const fill = ctx.createLinearGradient(0, y(m), 0, y(1));
  fill.addColorStop(0, `rgba(${color}, .35)`);
  fill.addColorStop(1, `rgba(${color}, 0)`);
  ctx.fillStyle = fill;
  ctx.fill();

  // Ракета на кончике графика (по касательной), взрыв при краше.
  const tipX = x(tNow);
  const tipY = y(m);
  const dt = Math.max(0.05, tNow * 0.02);
  const angle = Math.atan2(y(m) - y(Math.exp(CRASH_GROWTH * Math.max(0, tNow - dt))), x(tNow) - x(Math.max(0, tNow - dt)));
  ctx.save();
  ctx.translate(tipX, tipY);
  ctx.font = '30px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  if (c.phase === 'crashed') {
    ctx.font = '42px "Segoe UI Emoji", "Apple Color Emoji", "Noto Color Emoji", sans-serif';
    ctx.fillText('💥', 0, 0);
  } else {
    ctx.rotate(angle + Math.PI / 4);  // эмодзи ракеты смотрит вверх-вправо
    ctx.fillText('🚀', 0, 0);
  }
  ctx.restore();
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
  for (const id of ['crash', 'roulette', 'upgrade', 'bomb', 'poker']) $(id).hidden = name !== id;
  // канвас апгрейдера создаётся ниже по файлу: рисуем на следующем кадре
  if (name === 'upgrade') requestAnimationFrame(() => drawUpgrader());
  storage.set(TAB_KEY, name);
}
document.querySelectorAll('.tab').forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
showTab(['roulette', 'upgrade', 'bomb', 'poker'].includes(storage.get(TAB_KEY)) ? storage.get(TAB_KEY) : 'crash');

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

// ---------- Покер (Техасский холдем) ----------

const SUIT_SYM = { s: '♠', h: '♥', d: '♦', c: '♣' };

// Карта: лицом (ранг и масть), рубашкой или пустой слот на столе.
function cardEl(card, { small = false, back = false, deal = false, hl = false } = {}) {
  const el = document.createElement('span');
  el.className = 'pcard' + (small ? ' small' : '') + (deal ? ' deal' : '') + (hl ? ' hl' : '');
  if (back) {
    el.classList.add('back');
    return el;
  }
  if (!card) {
    el.classList.add('slot');
    return el;
  }
  if (card[1] === 'h' || card[1] === 'd') el.classList.add('red');
  const r = document.createElement('b');
  r.textContent = card[0] === 'T' ? '10' : card[0];
  const s = document.createElement('i');
  s.textContent = SUIT_SYM[card[1]];
  el.append(r, s);
  el.title = `${r.textContent}${s.textContent}`;
  return el;
}

const poker = {
  view: null,
  recvAt: 0,
  lastResultHand: 0,
  wasMyTurn: false,
  boardShown: 0,      // сколько карт стола уже нарисовано в этой раздаче (для анимации)
  boardHand: 0,
  holeKey: '',
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

const PK_STREETS = { preflop: 'Префлоп', flop: 'Флоп', turn: 'Тёрн', river: 'Ривер' };
const pkBetting = (v) => Object.hasOwn(PK_STREETS, v.phase);

function renderPokerPhase() {
  const v = poker.view;
  if (!v) return;
  const secs = Math.ceil(pokerTimeLeft() / 1000);
  let text;
  if (v.phase === 'waiting') text = 'Ждём игроков: нужно двое за столом';
  else if (v.phase === 'starting') text = `Раздача через ${secs} с`;
  else if (pkBetting(v)) text = `${PK_STREETS[v.phase]} · ходит ${v.turn !== null ? seatName(v.turn) : '…'} · ${secs} с`;
  else text = 'Итоги раздачи';
  $('poker-phase').textContent = text;
  const bar = document.querySelector('.pk-seat.turn .pk-timer i');
  if (bar) bar.style.width = `${Math.min(100, (pokerTimeLeft() / v.turnMs) * 100)}%`;
}
setInterval(renderPokerPhase, 250);

// Места по кругу стола, [left%, top%]. Своё место всегда внизу по центру.
const PK_SLOTS = [[50, 92], [9, 68], [9, 22], [50, 3], [91, 22], [91, 68]];

function renderPokerSeats() {
  const v = poker.view;
  const res = v.result;
  const shown = new Map((res ? res.hands : []).map((x) => [x.seat, x]));
  const won = new Map((res ? res.winners : []).map((w) => [w.seat, w]));
  const mySeat = v.you ? v.you.seat : 0;
  const inPlay = pkBetting(v) || v.phase === 'showdown';

  $('poker-seats').replaceChildren(...v.seats.map((s, i) => {
    const slot = (i - mySeat + 6) % 6;
    const el = document.createElement('div');
    el.className = `pk-seat slot-${slot}`;
    el.style.left = `${PK_SLOTS[slot][0]}%`;
    el.style.top = `${PK_SLOTS[slot][1]}%`;
    if (!s) {
      el.classList.add('empty');
      el.textContent = 'свободно';
      return el;
    }
    if (state.me && s.id === state.me.playerId) el.classList.add('mine');
    if (v.turn === i && pkBetting(v)) el.classList.add('turn');
    if (s.folded) el.classList.add('folded');
    if (won.has(i)) el.classList.add('winner');
    if (!s.connected) el.classList.add('offline');

    const head = document.createElement('div');
    head.className = 'pk-head';
    const name = document.createElement('span');
    name.className = 'pk-name';
    name.textContent = s.name;
    head.append(avatarEl(s.name), name);

    const stack = document.createElement('div');
    stack.className = 'pk-stack';
    stack.textContent = s.allIn && inPlay ? `${s.stack} · олл-ин` : `${s.stack}`;

    // Карты: во вскрытии лицом, во время раздачи рубашкой (свои лицом).
    const cards = document.createElement('div');
    cards.className = 'pk-cards';
    const reveal = shown.get(i);
    const mine = v.you && v.you.seat === i && v.you.hole;
    if (reveal) cards.append(...reveal.hole.map((c) => cardEl(c, { small: true })));
    else if (mine && !s.folded) cards.append(...v.you.hole.map((c) => cardEl(c, { small: true })));
    else if (s.hasCards && !s.folded && inPlay) cards.append(cardEl(null, { small: true, back: true }), cardEl(null, { small: true, back: true }));

    el.append(cards, head, stack);

    // Кнопка дилера и блайнды.
    if (inPlay || v.phase === 'starting') {
      const tags = [];
      if (v.dealer === i) tags.push(['D', 'dealer']);
      if (pkBetting(v) && v.sb === i) tags.push(['SB', 'blind']);
      if (pkBetting(v) && v.bb === i) tags.push(['BB', 'blind']);
      for (const [t, cls] of tags) {
        const b = document.createElement('span');
        b.className = `pk-tag ${cls}`;
        b.textContent = t;
        el.append(b);
      }
    }

    // Последнее действие или итог.
    const note = document.createElement('div');
    note.className = 'pk-note';
    if (won.has(i)) {
      note.textContent = `+${won.get(i).won}${won.get(i).hand ? ` · ${won.get(i).hand}` : ''}`;
      note.classList.add('won');
    } else if (reveal) {
      note.textContent = reveal.hand;
    } else if (s.leaving) {
      note.textContent = 'уходит';
    } else if (!s.connected) {
      note.textContent = 'нет связи';
    } else if (s.lastAction && inPlay) {
      note.textContent = s.lastAction;
    }
    if (note.textContent) el.append(note);

    // Ставка на этой улице: фишки перед игроком.
    if (s.committed > 0 && pkBetting(v)) {
      const bet = document.createElement('div');
      bet.className = 'pk-bet';
      bet.textContent = s.committed;
      el.append(bet);
    }

    if (v.turn === i && pkBetting(v)) {
      const timer = document.createElement('div');
      timer.className = 'pk-timer';
      timer.append(document.createElement('i'));
      el.append(timer);
    }
    return el;
  }));
}

function renderBoard() {
  const v = poker.view;
  const res = v.result;
  const board = res ? res.board : v.board;
  if (poker.boardHand !== v.handId) {
    poker.boardHand = v.handId;
    poker.boardShown = 0;
  }
  // На вскрытии подсвечиваем карты стола, из которых собрана рука победителя.
  const winnerBest = new Set();
  if (res && res.revealed && res.winners.length) {
    const w = res.hands.find((x) => x.seat === res.winners[0].seat);
    if (w) w.best.forEach((c) => winnerBest.add(c));
  }
  const prev = poker.boardShown;
  $('pk-board').replaceChildren(...[0, 1, 2, 3, 4].map((i) => cardEl(board[i] || null, {
    deal: i >= prev && !!board[i],
    hl: !!board[i] && winnerBest.has(board[i]),
  })));
  if (board.length > prev) beep([[520, 0.03], [700, 0.03]], 'triangle');
  poker.boardShown = board.length;
  $('pk-pot-center').textContent = v.pot > 0 ? `Банк ${v.pot}` : '';
}

function renderPoker() {
  const v = poker.view;
  if (!v) return;
  const you = v.you;

  $('poker-pot').textContent = v.pot;
  renderPokerPhase();
  renderBoard();
  renderPokerSeats();
  renderPokerPhase();

  // Итог раздачи.
  const res = v.result;
  if (res) {
    const winners = res.winners.map((w) => `${w.name} +${w.won}`).join(', ');
    const how = res.revealed ? (res.winners[0] && res.winners[0].hand) : 'все сбросили';
    $('poker-result').textContent = `${res.winners.length > 1 ? 'Делёж' : 'Банк'}: ${winners} · ${how}`;
    $('poker-result').hidden = false;
    if (poker.lastResultHand !== res.handId) {
      poker.lastResultHand = res.handId;
      if (you && res.winners.some((w) => w.seat === you.seat)) sounds.win();
      else if (you && res.hands.some((x) => x.seat === you.seat)) sounds.lose();
    }
  } else {
    $('poker-result').hidden = true;
  }

  // Мои карты крупно.
  $('poker-me').hidden = !(you && you.hole);
  if (you && you.hole) {
    const key = `${v.handId}:${you.hole.join('')}`;
    const fresh = key !== poker.holeKey;
    poker.holeKey = key;
    $('my-hole').replaceChildren(...you.hole.map((c) => cardEl(c, { deal: fresh })));
    $('my-hole').classList.toggle('folded', !you.inHand && pkBetting(v));
    if (fresh) beep([[440, 0.04], [560, 0.04]], 'triangle');
    const pair = you.hole[0][0] === you.hole[1][0];
    const suited = you.hole[0][1] === you.hole[1][1];
    $('my-hand-name').textContent = you.hand || (pair ? 'Карманная пара' : suited ? 'Одномастные' : '');
    $('poker-hint').textContent = you.myTurn
      ? (you.toCall > 0 ? `Твой ход: колл ${you.toCall}, рейз или фолд` : 'Твой ход: чек или ставка')
      : !you.inHand && pkBetting(v) ? 'Ты сбросил'
        : v.phase === 'showdown' ? '' : pkBetting(v) ? 'Ждём остальных' : '';
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
    btn('call').textContent = `Колл ${you.toCall}`;
    $('pk-raise').hidden = !you.canRaise;
    if (you.canRaise) {
      const slider = $('raise-slider');
      slider.min = you.minRaiseTo;
      slider.max = you.maxRaiseTo;
      const cur = Number($('raise-amount').value);
      const val = cur >= you.minRaiseTo && cur <= you.maxRaiseTo ? cur : you.minRaiseTo;
      setRaise(val);
    }
  }

  const myTurnNow = !!(you && you.myTurn);
  if (myTurnNow && !poker.wasMyTurn) sounds.turn();
  poker.wasMyTurn = myTurnNow;
  $('poker-dot').hidden = !myTurnNow;
}

// Ползунок и поле «ставка до» синхронно, текст кнопки по смыслу.
function setRaise(value) {
  const v = poker.view;
  const you = v && v.you;
  if (!you) return;
  const val = Math.max(you.minRaiseTo, Math.min(you.maxRaiseTo, Math.round(value) || you.minRaiseTo));
  $('raise-slider').value = val;
  $('raise-amount').value = val;
  const allIn = val === you.maxRaiseTo;
  $('raise-btn').textContent = allIn ? `Олл-ин ${val}` : v.currentBet === 0 ? `Бет ${val}` : `Рейз до ${val}`;
}

$('raise-slider').addEventListener('input', () => setRaise(Number($('raise-slider').value)));
$('raise-amount').addEventListener('change', () => setRaise(Number($('raise-amount').value)));
document.querySelectorAll('[data-rq]').forEach((b) => b.addEventListener('click', () => {
  const v = poker.view;
  if (!v || !v.you) return;
  const you = v.you;
  const target = {
    min: you.minRaiseTo,
    half: v.currentBet + Math.floor(v.pot / 2),
    pot: v.currentBet + v.pot,
    allin: you.maxRaiseTo,
  }[b.dataset.rq];
  setRaise(target);
}));

$('poker-join').addEventListener('submit', (ev) => {
  ev.preventDefault();
  send({ type: 'poker_join', buyIn: Math.floor(Number($('buyin').value)) });
});

$('poker-leave').addEventListener('click', () => send({ type: 'poker_leave' }));

document.querySelectorAll('[data-act]').forEach((btn) => {
  btn.addEventListener('click', () => {
    const action = btn.dataset.act;
    const msg = { type: 'poker_action', action };
    if (action === 'raise') msg.amount = Math.floor(Number($('raise-amount').value));
    send(msg);
  });
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
    s.className = `rn ${h.color}`;
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

// Колесо и шарик. Колесо крутится по часовой, шарик бежит по дорожке против часовой,
// замедляется, скатывается к карманам, отскакивает по перегородкам и оседает в выпавшем номере.
// Номер выбирает сервер, анимация только красиво доводит шарик до него.
const rCanvas = $('r-wheel');
const rCtx = rCanvas.getContext('2d');
const W_SIZE = 300;
const W_C = W_SIZE / 2;
const R_DISK = 116;       // вращающийся диск
const R_NUM = 106;        // кольцо с номерами
const R_WELL = 96;        // карманы
const R_CONE = 80;        // центральный конус
const R_TRACK = 126;      // дорожка шарика
const R_POCKET = 88;      // шарик в кармане
const BALL_R = 6.5;

// Неподвижная часть (обод и дорожка) и вращающийся диск рисуются один раз в offscreen-канвасы
// с запасом по разрешению, а при выводе растягиваются на точный размер канваса:
// масштаб экрана (devicePixelRatio) может поменяться после загрузки страницы.
const LAYER_SCALE = Math.max(2, window.devicePixelRatio || 1);
function makeLayer(draw) {
  const cv = document.createElement('canvas');
  cv.width = W_SIZE * LAYER_SCALE;
  cv.height = W_SIZE * LAYER_SCALE;
  const ctx = cv.getContext('2d');
  ctx.scale(LAYER_SCALE, LAYER_SCALE);
  ctx.translate(W_C, W_C);
  draw(ctx);
  return cv;
}

const wheelBase = makeLayer((ctx) => {
  // Деревянный обод.
  const wood = ctx.createRadialGradient(0, 0, 130, 0, 0, 150);
  wood.addColorStop(0, '#2b140a');
  wood.addColorStop(0.35, '#7a4220');
  wood.addColorStop(0.7, '#a35f2f');
  wood.addColorStop(1, '#4a250f');
  ctx.beginPath();
  ctx.arc(0, 0, 148, 0, 2 * Math.PI);
  ctx.fillStyle = wood;
  ctx.fill();
  // Полированная дорожка шарика.
  const track = ctx.createRadialGradient(0, 0, R_DISK, 0, 0, 136);
  track.addColorStop(0, '#120b07');
  track.addColorStop(0.6, '#3a2618');
  track.addColorStop(1, '#1c120b');
  ctx.beginPath();
  ctx.arc(0, 0, 136, 0, 2 * Math.PI);
  ctx.fillStyle = track;
  ctx.fill();
  // Блик на дорожке.
  ctx.beginPath();
  ctx.arc(0, 0, 131, Math.PI * 1.1, Math.PI * 1.6);
  ctx.strokeStyle = 'rgba(255, 230, 190, .18)';
  ctx.lineWidth = 4;
  ctx.stroke();
  // Золотые кольца.
  for (const r of [136, 147]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.strokeStyle = '#d9a93c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
});

const pocketColor = (n) => (n === 0 ? '#14894a' : R_RED.has(n) ? '#c0281f' : '#151515');
const pocketFloor = (n) => (n === 0 ? '#0d5c32' : R_RED.has(n) ? '#7d1813' : '#0b0b0b');

const wheelDisk = makeLayer((ctx) => {
  // Номер i занимает сектор [i*STEP - STEP/2, i*STEP + STEP/2] от верха по часовой.
  ctx.rotate(-Math.PI / 2 - R_STEP / 2);
  R_WHEEL.forEach((n, i) => {
    const a0 = i * R_STEP;
    // Кольцо с номером.
    ctx.beginPath();
    ctx.arc(0, 0, R_DISK, a0, a0 + R_STEP);
    ctx.arc(0, 0, R_WELL, a0 + R_STEP, a0, true);
    ctx.closePath();
    ctx.fillStyle = pocketColor(n);
    ctx.fill();
    // Карман (дно потемнее).
    ctx.beginPath();
    ctx.arc(0, 0, R_WELL, a0, a0 + R_STEP);
    ctx.arc(0, 0, R_CONE, a0 + R_STEP, a0, true);
    ctx.closePath();
    ctx.fillStyle = pocketFloor(n);
    ctx.fill();
    // Перегородка.
    ctx.beginPath();
    ctx.moveTo(Math.cos(a0) * R_CONE, Math.sin(a0) * R_CONE);
    ctx.lineTo(Math.cos(a0) * R_DISK, Math.sin(a0) * R_DISK);
    ctx.strokeStyle = '#e2b54c';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    // Номер.
    ctx.save();
    ctx.rotate(a0 + R_STEP / 2);
    ctx.translate(R_NUM, 0);
    ctx.rotate(Math.PI / 2);
    ctx.fillStyle = '#fff';
    ctx.font = '700 11px Manrope, system-ui, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(n), 0, 0);
    ctx.restore();
  });
  for (const r of [R_DISK, R_WELL]) {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, 2 * Math.PI);
    ctx.strokeStyle = '#e2b54c';
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  // Конус.
  const cone = ctx.createRadialGradient(-12, -14, 4, 0, 0, R_CONE);
  cone.addColorStop(0, '#d79a52');
  cone.addColorStop(0.45, '#8a4b22');
  cone.addColorStop(1, '#3d1d0b');
  ctx.beginPath();
  ctx.arc(0, 0, R_CONE, 0, 2 * Math.PI);
  ctx.fillStyle = cone;
  ctx.fill();
  // Турель: четыре золотые спицы и шишечка.
  ctx.lineCap = 'round';
  for (let k = 0; k < 4; k++) {
    const a = (k * Math.PI) / 2 + R_STEP / 2;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(Math.cos(a) * 46, Math.sin(a) * 46);
    ctx.strokeStyle = '#f4d27a';
    ctx.lineWidth = 5;
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(Math.cos(a) * 46, Math.sin(a) * 46, 5, 0, 2 * Math.PI);
    ctx.fillStyle = '#f4d27a';
    ctx.fill();
  }
  const knob = ctx.createRadialGradient(-4, -4, 1, 0, 0, 14);
  knob.addColorStop(0, '#fff6d6');
  knob.addColorStop(1, '#c9962e');
  ctx.beginPath();
  ctx.arc(0, 0, 14, 0, 2 * Math.PI);
  ctx.fillStyle = knob;
  ctx.fill();
});

function drawWheel(rotation, ball) {
  const dpr = window.devicePixelRatio || 1;
  if (rCanvas.width !== W_SIZE * dpr) {
    rCanvas.width = W_SIZE * dpr;
    rCanvas.height = W_SIZE * dpr;
  }
  const ctx = rCtx;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, rCanvas.width, rCanvas.height);
  const size = W_SIZE * dpr;
  ctx.drawImage(wheelBase, 0, 0, size, size);
  ctx.save();
  ctx.translate(size / 2, size / 2);
  ctx.rotate(rotation);
  ctx.drawImage(wheelDisk, -size / 2, -size / 2, size, size);
  ctx.restore();
  if (!ball) return;
  // Шарик: тень и блик.
  const x = (W_C + Math.cos(ball.angle) * ball.r) * dpr;
  const y = (W_C + Math.sin(ball.angle) * ball.r) * dpr;
  ctx.beginPath();
  ctx.arc(x + 1.5 * dpr, y + 2 * dpr, BALL_R * dpr, 0, 2 * Math.PI);
  ctx.fillStyle = 'rgba(0, 0, 0, .45)';
  ctx.fill();
  const g = ctx.createRadialGradient(x - 2 * dpr, y - 2.5 * dpr, 0.5 * dpr, x, y, BALL_R * dpr);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(0.6, '#e9e9e9');
  g.addColorStop(1, '#9a9a9a');
  ctx.beginPath();
  ctx.arc(x, y, BALL_R * dpr, 0, 2 * Math.PI);
  ctx.fillStyle = g;
  ctx.fill();
}

const easeOut = (x) => 1 - (1 - x) ** 4;
// Поворот колеса, при котором номер n наверху (там шарик и останавливается).
const restingRotation = (n) => -R_WHEEL.indexOf(n) * R_STEP;
// Угол кармана номера n на экране при повороте колеса rotation.
const pocketAngle = (rotation, n) => rotation - Math.PI / 2 + R_WHEEL.indexOf(n) * R_STEP;

const BALL_TURNS = 7;     // сколько оборотов шарик делает относительно колеса
const DROP_AT = 0.55;     // когда начинает скатываться с дорожки
const BOUNCE_AT = 0.62;   // когда начинает прыгать по перегородкам

// Положение шарика во время вращения: p от 0 до 1.
function ballDuringSpin(p, rotation, result) {
  const home = pocketAngle(rotation, result);
  let rel = 2 * Math.PI * BALL_TURNS * (1 - p) ** 3;
  let r = R_TRACK;
  if (p > DROP_AT) {
    const d = Math.min(1, (p - DROP_AT) / (0.72 - DROP_AT));
    r = R_TRACK - (R_TRACK - R_POCKET) * d * d;
  }
  if (p > BOUNCE_AT) {
    const k = (p - BOUNCE_AT) / (1 - BOUNCE_AT);
    const fade = (1 - k) ** 2;
    rel += 0.5 * Math.sin(k * Math.PI * 4) * fade;       // перескакивает соседние карманы
    r += 7 * Math.abs(Math.sin(k * Math.PI * 4)) * fade; // подпрыгивает на перегородках
  }
  return { angle: home + rel, r };
}

let lastClick = { pocket: null, at: 0 };
// Щелчки шарика о перегородки, пока он прыгает.
function ballClicks(p, ball, rotation) {
  if (p < DROP_AT || p >= 1 || !soundOn) return;
  const pocket = Math.floor((ball.angle - rotation) / R_STEP);
  const t = performance.now();
  if (pocket !== lastClick.pocket && t - lastClick.at > 45) {
    lastClick = { pocket, at: t };
    beep([[1500 + Math.random() * 600, 0.012]], 'square');
  }
}

function rouletteFrame() {
  const v = rl.view;
  if (v && !$('roulette').hidden) {
    let ball = null;
    if (v.phase === 'spinning') {
      if (!rl.spin || rl.spin.roundId !== v.roundId) {
        // Старт вращения: минимум 4 оборота колеса и остановка выпавшего номера наверху.
        const from = rl.rotation;
        const base = restingRotation(v.result);
        const turns = Math.ceil((from - base) / (2 * Math.PI)) + 4;
        rl.spin = { roundId: v.roundId, from, to: base + turns * 2 * Math.PI };
      }
      const p = Math.min(1, 1 - rouletteTimeLeft() / v.spinMs);
      rl.rotation = rl.spin.from + (rl.spin.to - rl.spin.from) * easeOut(p);
      ball = ballDuringSpin(p, rl.rotation, v.result);
      ballClicks(p, ball, rl.rotation);
    } else {
      if (v.phase === 'result' && v.result !== null) {
        // Видели вращение: стоим там, где оно закончилось; зашли позже: просто ставим на номер.
        rl.rotation = rl.spin && rl.spin.roundId === v.roundId ? rl.spin.to : restingRotation(v.result);
      }
      // Шарик лежит в последнем выпавшем номере.
      const last = v.phase === 'result' ? v.result : v.history.length ? v.history[0].n : null;
      if (last !== null) ball = { angle: pocketAngle(rl.rotation, last), r: R_POCKET };
    }
    drawWheel(rl.rotation, ball);

    const center = $('r-center');
    const secs = Math.ceil(rouletteTimeLeft() / 1000);
    if (v.phase === 'betting') {
      center.textContent = secs;
      center.className = 'r-center';
      $('r-phase').textContent = `Делайте ставки: ${secs} с`;
    } else if (v.phase === 'spinning') {
      center.textContent = '';
      center.className = 'r-center spinning';
      $('r-phase').textContent = 'Ставок больше нет, шарик в игре';
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
  // Пока играет песня из зала, фоновый джаз молчит.
  if (window.Lounge) window.Lounge.setDucked(!!t && music.on);
  document.body.classList.toggle('has-music', !!t);
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
    // Сообщаем серверу длину трека: так он сам выключит песню, когда она доиграет.
    if (Number.isFinite(audioEl.duration)) send({ type: 'music_duration', id: t.id, duration: audioEl.duration });
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

// ---------- Апгрейдер ----------

const UPG_RTP = 99;  // как на сервере: множитель = 99 / шанс
const upgMult = (chance) => Math.floor((UPG_RTP / chance) * 100) / 100;

const upg = {
  start: 0,          // где начинается зелёный сектор (0..100, от верха по часовой)
  needle: 0,         // где стрелка (0..100, может уходить за 100 при вращении)
  spin: null,        // { from, to, t0, dur, result }
  awaiting: false,   // запрос отправлен, ответа ещё нет
  pendingBalance: null,
};

const uCanvas = $('u-wheel');
const uCtx = uCanvas.getContext('2d');
const U_SIZE = 280;

function upgChance() {
  return Math.max(1, Math.min(95, Math.round(Number($('u-chance').value) || 30)));
}

function upgAmount() {
  const n = Math.floor(Number($('u-amount').value));
  return Number.isFinite(n) ? n : 0;
}

function drawUpgrader() {
  const dpr = window.devicePixelRatio || 1;
  if (uCanvas.width !== Math.round(U_SIZE * dpr)) {
    uCanvas.width = Math.round(U_SIZE * dpr);
    uCanvas.height = Math.round(U_SIZE * dpr);
  }
  const ctx = uCtx;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, U_SIZE, U_SIZE);
  const c = U_SIZE / 2;
  const R = c - 8;
  const toRad = (p) => (p / 100) * 2 * Math.PI - Math.PI / 2;  // 0% наверху, по часовой
  const chance = upg.spin ? upg.spin.result.chance : upgChance();

  // Кольцо.
  ctx.beginPath();
  ctx.arc(c, c, R, 0, 2 * Math.PI);
  ctx.lineWidth = 22;
  ctx.strokeStyle = 'rgba(255, 255, 255, .07)';
  ctx.stroke();

  // Зелёный сектор шанса.
  ctx.save();
  ctx.shadowColor = 'rgba(69, 212, 131, .8)';
  ctx.shadowBlur = 16;
  ctx.beginPath();
  ctx.arc(c, c, R, toRad(upg.start), toRad(upg.start + chance));
  ctx.lineWidth = 22;
  const g = ctx.createLinearGradient(0, 0, U_SIZE, U_SIZE);
  g.addColorStop(0, '#8af5b6');
  g.addColorStop(1, '#1f9a55');
  ctx.strokeStyle = g;
  ctx.stroke();
  ctx.restore();

  // Риски через каждые 5%.
  for (let p = 0; p < 100; p += 5) {
    const a = toRad(p);
    const r1 = R - 18;
    const r2 = R - (p % 25 === 0 ? 30 : 24);
    ctx.beginPath();
    ctx.moveTo(c + Math.cos(a) * r1, c + Math.sin(a) * r1);
    ctx.lineTo(c + Math.cos(a) * r2, c + Math.sin(a) * r2);
    ctx.strokeStyle = 'rgba(255, 255, 255, .18)';
    ctx.lineWidth = p % 25 === 0 ? 2 : 1;
    ctx.stroke();
  }

  // Стрелка.
  const a = toRad(upg.needle);
  const tipX = c + Math.cos(a) * (R + 6);
  const tipY = c + Math.sin(a) * (R + 6);
  ctx.save();
  ctx.shadowColor = 'rgba(242, 193, 78, .9)';
  ctx.shadowBlur = 12;
  ctx.beginPath();
  ctx.moveTo(c + Math.cos(a) * 46, c + Math.sin(a) * 46);
  ctx.lineTo(tipX, tipY);
  ctx.strokeStyle = '#ffdf8a';
  ctx.lineWidth = 4;
  ctx.lineCap = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tipX, tipY, 6, 0, 2 * Math.PI);
  ctx.fillStyle = '#fff6d6';
  ctx.fill();
  ctx.restore();
}

function renderUpgradeForm() {
  const chance = upgChance();
  const mult = upgMult(chance);
  $('u-chance-label').textContent = `${chance}%`;
  $('u-chance-big').textContent = `${chance}%`;
  $('u-mult-big').textContent = `×${mult.toFixed(2)}`;
  $('u-mult').textContent = `×${mult.toFixed(2)}`;
  $('u-payout').textContent = Math.floor((upgAmount() * Math.round(mult * 100)) / 100);
  document.querySelectorAll('[data-uc]').forEach((b) => b.classList.toggle('active', Number(b.dataset.uc) === chance));
  if (!upg.spin) drawUpgrader();
}

// Баланс придерживаем, пока колесо не остановилось: иначе результат виден раньше стрелки.
function upgradeHoldsBalance(msg) {
  if (!upg.awaiting && !upg.spin) return false;
  upg.pendingBalance = msg;
  return true;
}

function releaseBalance() {
  const msg = upg.pendingBalance;
  upg.pendingBalance = null;
  if (msg) handlers.balance(msg);
}

const easeOutUpg = (x) => 1 - (1 - x) ** 4;

function upgradeFrame() {
  const s = upg.spin;
  if (s) {
    const p = Math.min(1, (performance.now() - s.t0) / s.dur);
    upg.needle = s.from + (s.to - s.from) * easeOutUpg(p);
    if (!$('upgrade').hidden) drawUpgrader();
    if (p >= 1) finishUpgrade();
  }
  requestAnimationFrame(upgradeFrame);
}
requestAnimationFrame(upgradeFrame);

function finishUpgrade() {
  const r = upg.spin.result;
  upg.spin = null;
  upg.needle = r.landing;
  releaseBalance();
  $('u-go').disabled = false;
  const res = $('u-result');
  if (r.win) {
    res.textContent = `Апгрейд! ${r.amount} → ${r.payout} (+${r.payout - r.amount})`;
    res.className = 'u-result win';
    sounds.win();
    if (r.multiplier >= 5) effects.confetti();
  } else {
    res.textContent = `Мимо: −${r.amount}`;
    res.className = 'u-result lose';
    sounds.lose();
  }
  $('upgrade').classList.toggle('won', r.win);
  drawUpgrader();
}

function startUpgradeSpin(r) {
  upg.awaiting = false;
  upg.start = r.start;
  // Минимум три оборота, остановка ровно в точке, которую выбрал сервер.
  const from = upg.needle;
  const base = Math.floor(from / 100) * 100 + r.landing;
  const to = base + (base - from < 300 ? 300 : 0) + 100;
  upg.spin = { from, to, t0: performance.now(), dur: Math.max(1500, r.spinMs - 300), result: r };
  $('u-result').textContent = '';
  $('u-result').className = 'u-result';
  $('upgrade').classList.remove('won');
}

function renderUpgradeFeed(feed) {
  const myId = state.me && state.me.playerId;
  $('u-feed').replaceChildren(...(feed.length ? feed.map((e) => {
    const li = document.createElement('li');
    li.className = e.win ? 'win' : 'lose';
    if (e.playerId === myId) li.classList.add('self');
    li.append(avatarEl(e.name));
    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = e.name;
    const what = document.createElement('span');
    what.className = 'u-what';
    what.textContent = e.win ? `${e.amount} → ${e.payout}` : `${e.amount} ✕`;
    const ch = document.createElement('span');
    ch.className = 'u-ch';
    ch.textContent = `${e.chance}% · ×${e.multiplier.toFixed(2)}`;
    li.append(name, what, ch);
    return li;
  }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Пока никто не апгрейдился' })]));
}

$('u-chance').addEventListener('input', renderUpgradeForm);
$('u-amount').addEventListener('input', renderUpgradeForm);
document.querySelectorAll('[data-uc]').forEach((b) => b.addEventListener('click', () => {
  $('u-chance').value = b.dataset.uc;
  renderUpgradeForm();
}));
document.querySelectorAll('[data-uq]').forEach((b) => b.addEventListener('click', () => {
  const v = upgAmount();
  const next = { half: Math.floor(v / 2), double: v * 2, max: state.balance }[b.dataset.uq];
  $('u-amount').value = Math.max(10, Math.min(next, Math.max(10, state.balance)));
  renderUpgradeForm();
}));
$('u-go').addEventListener('click', () => {
  if (upg.spin || upg.awaiting) return;
  upg.awaiting = true;
  $('u-go').disabled = true;
  send({ type: 'upgrade_spin', amount: upgAmount(), chance: upgChance() });
});
renderUpgradeForm();

// ---------- Бомба в банке ----------

const bomb = {
  view: null,
  recvAt: 0,
  lastResultRound: 0,
  wasMyTurn: false,
  lastBank: 0,
};

function bombTimeLeft() {
  const v = bomb.view;
  return v && v.timeLeft !== null ? Math.max(0, v.timeLeft - (performance.now() - bomb.recvAt)) : 0;
}

const bombMe = () => (bomb.view && state.me ? bomb.view.players.find((p) => p.id === state.me.playerId) || null : null);

// «Накал» бомбы по тому, во сколько раз банк вырос от взносов. Фитиль игроку не известен, так что это не подсказка.
function bombHeat(v) {
  const entries = v.players.length * v.entry || 1;
  const ratio = v.bank / entries;
  return v.phase !== 'playing' ? 0 : ratio < 2 ? 1 : ratio < 4 ? 2 : 3;
}

function boomSound() {
  if (!soundOn) return;
  try {
    audio = audio || new AudioContext();
    const t = audio.currentTime;
    const len = audio.sampleRate * 1.2;
    const buf = audio.createBuffer(1, len, audio.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len) ** 3;
    const src = audio.createBufferSource();
    src.buffer = buf;
    const lp = audio.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1800, t);
    lp.frequency.exponentialRampToValueAtTime(120, t + 1);
    const g = audio.createGain();
    g.gain.value = 0.5;
    src.connect(lp).connect(g).connect(audio.destination);
    src.start(t);
  } catch { /* без звука */ }
}

function explodeFx() {
  const flash = document.createElement('div');
  flash.className = 'boom-flash';
  flash.textContent = '💥';
  document.body.append(flash);
  setTimeout(() => flash.remove(), 1300);
  bodyEffect('fx-shake', 900);
  boomSound();
}

function renderBombPhase() {
  const v = bomb.view;
  if (!v) return;
  const secs = Math.ceil(bombTimeLeft() / 1000);
  const turnName = (v.players.find((p) => p.id === v.turn) || {}).name;
  let text;
  if (v.phase === 'lobby') {
    text = v.players.length < 2
      ? `Сбор игроков: нужно минимум двое (${v.players.length}/${v.maxPlayers})`
      : `Старт через ${secs} с · игроков ${v.players.length}/${v.maxPlayers}`;
  } else if (v.phase === 'playing') {
    text = `Ходит ${turnName} · ${secs} с`;
  } else {
    text = v.result.type === 'boom' ? `💥 ${v.result.bomberName} взорвался!` : `🏆 ${v.result.winnerName} забирает банк!`;
  }
  $('b-phase').textContent = text;
  const total = v.phase === 'playing' ? v.turnMs : 15000;
  const show = v.phase === 'playing' || (v.phase === 'lobby' && v.timeLeft !== null);
  $('b-timer-bar').style.width = show ? `${Math.min(100, (bombTimeLeft() / total) * 100)}%` : '0%';
  $('b-timer-bar').classList.toggle('hurry', v.phase === 'playing' && secs <= 5);
}
setInterval(renderBombPhase, 200);

function bombPlayerCard(v, p) {
  const d = document.createElement('div');
  d.className = `b-player ${p.status}`;
  if (p.id === v.turn) d.classList.add('turn');
  if (state.me && p.id === state.me.playerId) d.classList.add('mine');
  const name = document.createElement('span');
  name.className = 'b-name';
  name.textContent = p.name;
  const sum = document.createElement('span');
  sum.className = 'b-sum';
  sum.textContent = `вложил ${p.contributed}`;
  const st = document.createElement('span');
  st.className = 'b-status';
  if (p.status === 'boom') st.textContent = '💥 взорвался';
  else if (p.status === 'out') st.textContent = `🏃 ${p.lastMove || 'сбежал'}`;
  else if (p.payout) st.textContent = `+${p.payout}`;
  else if (p.id === v.turn) st.textContent = '🔥 ходит';
  else st.textContent = p.lastMove || '';
  d.append(avatarEl(p.name), name, sum, st);
  return d;
}

function renderBomb() {
  const v = bomb.view;
  if (!v) return;
  const me = bombMe();
  const myTurn = !!(v.phase === 'playing' && me && v.turn === me.id);
  const inGame = !!(me && me.status === 'in');

  $('b-bank').textContent = v.bank;
  const el = $('b-bomb');
  el.dataset.heat = bombHeat(v);
  el.classList.toggle('lit', v.phase === 'playing');
  el.classList.toggle('exploded', v.phase === 'result' && v.result.type === 'boom');
  if (v.bank > bomb.lastBank && v.phase === 'playing') {
    el.classList.remove('bump');
    void el.offsetWidth;
    el.classList.add('bump');
  }
  bomb.lastBank = v.bank;

  $('b-history').replaceChildren(...v.history.map((h) => {
    const s = document.createElement('span');
    s.textContent = `${h.boom ? '💥' : '🏆'} ${h.fuse}`;
    s.className = h.boom ? '' : 'good';
    s.title = h.boom ? 'фитиль, на котором рвануло' : 'никто не взорвался';
    return s;
  }));

  if (v.players.length) {
    $('b-players').replaceChildren(...v.players.map((p) => bombPlayerCard(v, p)));
  } else {
    const empty = document.createElement('p');
    empty.className = 'muted';
    empty.textContent = 'Пока никого. Заходи первым!';
    $('b-players').replaceChildren(empty);
  }

  // Итог раунда.
  const r = v.result;
  if (r) {
    const mine = r.payouts.find((p) => state.me && p.id === state.me.playerId);
    $('b-result').textContent = r.type === 'boom'
      ? `Фитиль был на ${r.fuse}. Банк ${r.bank} делят: ${r.payouts.map((p) => `${p.name} +${p.amount}`).join(', ')}`
      : `Все сбежали, ${r.winnerName} забирает ${r.bank}. Фитиль был на ${r.fuse}`;
    $('b-result').className = `b-result ${mine ? 'win' : me ? 'lose' : ''}`;
    if (bomb.lastResultRound !== v.roundId) {
      bomb.lastResultRound = v.roundId;
      if (r.type === 'boom' && !$('bomb').hidden) explodeFx();
      else if (r.type === 'boom') boomSound();
      if (mine) sounds.win();
    }
  } else {
    $('b-result').textContent = '';
    $('b-result').className = 'b-result';
  }

  // Кнопки.
  $('b-join').hidden = !(v.phase === 'lobby' && !me);
  $('b-join').disabled = v.players.length >= v.maxPlayers;
  $('b-leave').hidden = !(v.phase === 'lobby' && me);
  $('b-deposit').hidden = !myTurn;
  $('b-flee').hidden = !(v.phase === 'playing' && inGame);
  if (inGame) $('b-flee').textContent = `Сбежать (+${Math.floor(me.contributed / 2)})`;
  let hint = '';
  if (v.phase === 'lobby' && me) hint = 'Ты в раунде, ждём старта';
  else if (myTurn) hint = 'Твой ход: подложи фишки или беги';
  else if (v.phase === 'playing' && inGame) hint = 'Жди своего хода. Сбежать можно в любой момент';
  else if (v.phase === 'playing' && me && me.status === 'boom') hint = 'Ты взорвался 💥';
  else if (v.phase === 'playing') hint = 'Раунд идёт, войти можно в следующий';
  $('b-hint').textContent = hint;

  if (myTurn && !bomb.wasMyTurn) sounds.turn();
  bomb.wasMyTurn = myTurn;
  $('bomb-dot').hidden = !myTurn;
  renderBombPhase();
}

bomb.onState = (msg) => {
  bomb.view = msg;
  bomb.recvAt = performance.now();
  renderBomb();
};

$('b-join').addEventListener('click', () => send({ type: 'bomb_join' }));
$('b-leave').addEventListener('click', () => send({ type: 'bomb_leave' }));
$('b-flee').addEventListener('click', () => send({ type: 'bomb_flee' }));
$('b-put').addEventListener('click', () => {
  send({ type: 'bomb_deposit', amount: Math.floor(Number($('b-amount').value)) });
});
document.querySelectorAll('[data-dep]').forEach((b) => {
  b.addEventListener('click', () => {
    $('b-amount').value = b.dataset.dep;
    send({ type: 'bomb_deposit', amount: Number(b.dataset.dep) });
  });
});

// ---------- Лента ставок и выигрышей ----------

const ACT_GAMES = {
  crash: { icon: '📈', name: 'Краш' },
  roulette: { icon: '🎡', name: 'Рулетка' },
  bomb: { icon: '💣', name: 'Бомба' },
  upgrade: { icon: '⬆️', name: 'Апгрейд' },
  poker: { icon: '🃏', name: 'Покер' },
};
const ACT_FILTER_KEY = 'casino.activity.filter';
const act = { entries: [], filter: storage.get(ACT_FILTER_KEY) || 'all', freshId: 0 };

function actVisible(e) {
  if (act.filter === 'win') return e.kind === 'win';
  if (act.filter === 'mine') return !!state.me && e.playerId === state.me.playerId;
  return true;
}

function renderActivity() {
  document.querySelectorAll('[data-af]').forEach((b) => b.classList.toggle('active', b.dataset.af === act.filter));
  const shown = act.entries.filter(actVisible).slice(0, 30);
  if (!shown.length) {
    const li = document.createElement('li');
    li.className = 'muted act-empty';
    li.textContent = act.filter === 'mine' ? 'Ты ещё ничего не ставил' : 'Пока тихо. Сделай первую ставку!';
    $('act-list').replaceChildren(li);
    return;
  }
  $('act-list').replaceChildren(...shown.map((e) => {
    const g = ACT_GAMES[e.game] || { icon: '🎲', name: e.game };
    const li = document.createElement('li');
    li.className = `act-${e.kind}`;
    if (state.me && e.playerId === state.me.playerId) li.classList.add('self');
    if (e.id === act.freshId) li.classList.add('fresh');
    const icon = document.createElement('span');
    icon.className = 'act-icon';
    icon.textContent = g.icon;
    icon.title = g.name;
    const body = document.createElement('span');
    body.className = 'act-body';
    const name = document.createElement('b');
    name.textContent = e.name;
    const what = document.createElement('span');
    what.className = 'act-what';
    what.textContent = `${e.kind === 'bet' ? 'ставка' : e.kind === 'win' ? 'выигрыш' : 'проигрыш'} · ${g.name}${e.note ? ` · ${e.note}` : ''}`;
    body.append(name, what);
    const amount = document.createElement('span');
    amount.className = 'act-amount';
    amount.textContent = e.kind === 'win' ? `+${e.amount}` : e.kind === 'lose' ? `−${e.amount}` : `${e.amount}`;
    li.append(icon, avatarEl(e.name), body, amount);
    return li;
  }));
}

document.querySelectorAll('[data-af]').forEach((b) => b.addEventListener('click', () => {
  act.filter = b.dataset.af;
  storage.set(ACT_FILTER_KEY, act.filter);
  renderActivity();
}));

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

  activity_history(msg) {
    act.entries = msg.entries;
    renderActivity();
  },

  activity(msg) {
    act.entries.unshift(msg.entry);
    if (act.entries.length > 60) act.entries.pop();
    act.freshId = msg.entry.id;
    renderActivity();
  },

  upgrade_result(msg) {
    startUpgradeSpin(msg);
  },

  upgrade_feed(msg) {
    renderUpgradeFeed(msg.feed);
  },

  bomb_state(msg) {
    bomb.onState(msg);
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
    if (upgradeHoldsBalance(msg)) return;
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
    if (upg.awaiting) {
      upg.awaiting = false;
      $('u-go').disabled = false;
      releaseBalance();
    }
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

// ---------- Фоновый джаз (lounge.js) ----------

(function setupLounge() {
  const L = window.Lounge;
  if (!L) return;
  // Браузер даёт звук только после действия человека: заводим фон на первый клик или клавишу.
  const unlock = () => L.unlock();
  for (const ev of ['pointerdown', 'keydown', 'touchstart']) document.addEventListener(ev, unlock, { capture: true });

  const panel = $('lounge-panel');
  $('lounge-btn').addEventListener('click', () => { panel.hidden = !panel.hidden; });
  document.addEventListener('click', (ev) => {
    if (!$('lounge').contains(ev.target)) panel.hidden = true;
  });
  $('lounge-toggle').addEventListener('click', () => L.toggle());
  $('lounge-next').addEventListener('click', () => L.next());
  $('lounge-prev').addEventListener('click', () => L.prev());
  $('lounge-vol').addEventListener('input', () => L.setVolume($('lounge-vol').value));

  function render(s) {
    $('lounge-vol').value = s.vol;
    $('lounge-track').textContent = s.track ? `«${s.track}»` : 'Ещё не играл';
    $('lounge-toggle').textContent = s.on ? 'Выключить' : 'Включить';
    $('lounge-btn').classList.toggle('playing', s.playing && !s.ducked);
    $('lounge-btn').classList.toggle('off', !s.on);
    $('lounge-note').textContent = !s.on ? 'Фон выключен'
      : s.ducked ? 'Пауза: играет песня из зала'
        : !s.playing ? 'Заиграет после первого клика на странице' : '';
  }
  L.onChange(render);
  render(L.status());
})();
