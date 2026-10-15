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
function toast(text) {
  $('toast').textContent = text;
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

  crash_state(msg) {
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
