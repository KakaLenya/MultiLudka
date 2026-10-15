'use strict';

const $ = (id) => document.getElementById(id);

const TOKEN_KEY = 'casino.token';
const NAME_KEY = 'casino.name';

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
  retryMs: 1000,
};

$('name').value = storage.get(NAME_KEY) || '';

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
  },

  balance(msg) {
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
