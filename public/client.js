'use strict';

const $ = (id) => document.getElementById(id);

const state = {
  ws: null,
  me: null,      // { playerId, token, name, balance } после welcome
  retryMs: 1000,
};

// Имя запоминаем только для удобства. Токен и баланс: этап 1.
const savedName = (() => {
  try { return localStorage.getItem('casino.name') || ''; } catch { return ''; }
})();
$('name').value = savedName;

function setConn(stateName, text) {
  $('conn').dataset.state = stateName;
  $('conn').textContent = text;
}

function send(msg) {
  if (state.ws && state.ws.readyState === WebSocket.OPEN) state.ws.send(JSON.stringify(msg));
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
    // После обрыва входим заново тем же игроком.
    if (state.me) send({ type: 'hello', token: state.me.token, name: state.me.name });
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

const handlers = {
  welcome(msg) {
    state.me = msg;
    $('login').hidden = true;
    $('lobby').hidden = false;
    $('me').hidden = false;
    $('me-name').textContent = msg.name;
    $('me-balance').textContent = msg.balance;
  },

  online(msg) {
    const list = $('online-list');
    list.replaceChildren(...msg.players.map((p) => {
      const li = document.createElement('li');
      li.textContent = p.name;
      if (state.me && p.id === state.me.playerId) li.className = 'self';
      return li;
    }));
    $('online-count').textContent = msg.players.length;
  },

  error(msg) {
    $('login-error').textContent = msg.message;
    console.warn('server error:', msg.message);
  },
};

$('login-form').addEventListener('submit', (ev) => {
  ev.preventDefault();
  const name = $('name').value.trim();
  if (!name) return;
  try { localStorage.setItem('casino.name', name); } catch {}
  $('login-error').textContent = '';
  send({ type: 'hello', name });
});

connect();
