const crypto = require('node:crypto');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { createStore } = require('./players');
const { randomToken } = require('./rng');
const { createCrashGame } = require('./crash');
const { createTable } = require('./dicepoker');

const PORT = Number(process.env.PORT) || 3000;
// По умолчанию слушаем только локально: наружу пускает cloudflared.
const HOST = process.env.HOST || '127.0.0.1';
const HEARTBEAT_MS = 30_000;
const LEADERBOARD_THROTTLE_MS = 300;
const CHAT_MAX_LEN = 200;
const CHAT_HISTORY = 50;
// Лимиты частоты (token bucket): burst сообщений подряд, дальше perSec в секунду.
const MSG_LIMIT = { burst: 20, perSec: 10 };
const CHAT_LIMIT = { burst: 5, perSec: 0.5 };
const FLOOD_STRIKES = 100;   // столько отброшенных сообщений, и соединение закрывается
// Новые игроки с одного адреса: не больше REG_PER_IP за REG_WINDOW_MS (против фермы аккаунтов).
const REG_PER_IP = 10;
const REG_WINDOW_MS = 60 * 60 * 1000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const ADMIN_GRANT_MAX = 1_000_000;

const store = createStore({ file: path.join(DATA_DIR, 'players.json') });

// Секрет для /admin/*: лежит только локально в data/admin.token, создаётся при первом старте.
const adminToken = (() => {
  const file = path.join(DATA_DIR, 'admin.token');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const token = randomToken(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, token);
  return token;
})();

function isAdmin(req) {
  const given = Buffer.from(String(req.get('x-admin-token') || ''));
  const expected = Buffer.from(adminToken);
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

// Все открытые соединения. У каждого: ws.player (после hello) и ws.alive (heartbeat).
const clients = new Set();

function makeBucket(limit) {
  return { tokens: limit.burst, at: Date.now() };
}

function allow(bucket, limit) {
  const t = Date.now();
  bucket.tokens = Math.min(limit.burst, bucket.tokens + ((t - bucket.at) / 1000) * limit.perSec);
  bucket.at = t;
  if (bucket.tokens < 1) return false;
  bucket.tokens -= 1;
  return true;
}

// Текст чата: без управляющих символов, пробелы схлопнуты, не длиннее CHAT_MAX_LEN.
function cleanChat(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, CHAT_MAX_LEN);
  return text || null;
}

const chatLog = [];
let chatSeq = 0;

const registrations = new Map();  // ip -> [время регистрации, ...]

function canRegister(ip) {
  const t = Date.now();
  const recent = (registrations.get(ip) || []).filter((at) => t - at < REG_WINDOW_MS);
  registrations.set(ip, recent);
  return recent.length < REG_PER_IP;
}

// За cloudflared настоящий адрес в CF-Connecting-IP; локально берём адрес сокета.
function clientIp(req) {
  const cf = req.headers['cf-connecting-ip'];
  return typeof cf === 'string' && cf ? cf : req.socket.remoteAddress;
}

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.player && ws.readyState === ws.OPEN) ws.send(data);
  }
}

// Всем вкладкам одного игрока.
function sendToPlayer(player, msg) {
  for (const ws of clients) {
    if (ws.player === player) send(ws, msg);
  }
}

function onlineIds() {
  const ids = new Set();
  for (const ws of clients) if (ws.player) ids.add(ws.player.id);
  return ids;
}

function broadcastOnline() {
  const players = [...onlineIds()].map((id) => ({ id, name: store.get(id).name }));
  broadcast({ type: 'online', players });
  scheduleLeaderboard();
}

function balanceMsg(player) {
  return {
    type: 'balance',
    balance: player.balance,
    reserved: store.reserved(player),
    bonus: store.bonusStatus(player),
  };
}

function leaderboardMsg() {
  const online = onlineIds();
  return {
    type: 'leaderboard',
    players: store.leaderboard().map((p) => ({ ...p, online: online.has(p.id) })),
  };
}

// Балансы в играх меняются пачками: рассылаем лидерборд не чаще раза в LEADERBOARD_THROTTLE_MS.
let leaderboardTimer = null;
function scheduleLeaderboard() {
  if (leaderboardTimer) return;
  leaderboardTimer = setTimeout(() => {
    leaderboardTimer = null;
    broadcast(leaderboardMsg());
  }, LEADERBOARD_THROTTLE_MS);
}

store.onChange((player) => {
  sendToPlayer(player, balanceMsg(player));
  scheduleLeaderboard();
});

const crash = createCrashGame({
  store,
  onState: (s) => broadcast({ type: 'crash_state', ...s }),
});
store.addReserver(crash.reserved);

// Покер: каждому своё состояние (свои кубики видны только себе).
let pokerTimer = null;
function broadcastPoker() {
  // Несколько изменений за один тик сервера уходят одной рассылкой.
  if (pokerTimer) return;
  pokerTimer = setImmediate(() => {
    pokerTimer = null;
    for (const ws of clients) {
      if (ws.player) send(ws, { type: 'poker_state', ...table.view(ws.player) });
    }
  });
}
const table = createTable({ store, onChange: broadcastPoker });
store.addReserver(table.reserved);

function isOnline(player) {
  for (const ws of clients) if (ws.player === player) return true;
  return false;
}

// playerId null: системное сообщение от зала.
function postChat(playerId, name, text) {
  const message = { id: ++chatSeq, playerId, name, text, at: Date.now() };
  chatLog.push(message);
  if (chatLog.length > CHAT_HISTORY) chatLog.shift();
  broadcast({ type: 'chat', message });
}

// Ответ на команду: ошибку показываем игроку, успех виден из рассылки состояния.
function reply(ws, result) {
  if (result && result.error) send(ws, { type: 'error', message: result.error });
}

const handlers = {
  hello(ws, msg) {
    if (ws.player) return send(ws, { type: 'error', message: 'Уже вошёл' });

    let player = store.findByToken(msg.token);
    if (!player) {
      if (msg.name === undefined) {
        // Токен из localStorage не узнали (например, удалили data/). Клиент покажет форму входа.
        return send(ws, { type: 'error', code: 'bad_token', message: 'Сессия не найдена, войди заново' });
      }
      if (!canRegister(ws.ip)) {
        return send(ws, { type: 'error', code: 'bad_name', message: 'Слишком много новых игроков с этого адреса, попробуй позже' });
      }
      const result = store.register(msg.name);
      if (result.error) return send(ws, { type: 'error', code: 'bad_name', message: result.error });
      registrations.get(ws.ip).push(Date.now());
      player = result.player;
    }

    ws.player = player;
    send(ws, {
      type: 'welcome',
      playerId: player.id,
      token: player.token,
      name: player.name,
      balance: player.balance,
    });
    send(ws, balanceMsg(player));
    send(ws, leaderboardMsg());
    send(ws, { type: 'crash_state', ...crash.state() });
    table.setConnected(player, true);
    send(ws, { type: 'poker_state', ...table.view(player) });
    send(ws, { type: 'chat_history', messages: chatLog });
    broadcastOnline();
  },

  claim_bonus(ws) {
    reply(ws, store.claimBonus(ws.player));
  },

  crash_bet(ws, msg) {
    reply(ws, crash.bet(ws.player, msg.amount, msg.autoCashout));
  },

  crash_cashout(ws) {
    reply(ws, crash.cashout(ws.player));
  },

  poker_join(ws, msg) {
    reply(ws, table.join(ws.player, msg.buyIn));
  },

  poker_leave(ws) {
    reply(ws, table.leave(ws.player));
  },

  poker_action(ws, msg) {
    reply(ws, table.act(ws.player, msg.action, msg.amount));
  },

  poker_reroll(ws, msg) {
    reply(ws, table.reroll(ws.player, msg.keep));
  },

  chat(ws, msg) {
    const text = cleanChat(msg.text);
    if (!text) return;
    if (!allow(ws.chatRate, CHAT_LIMIT)) return send(ws, { type: 'error', message: 'Не так быстро, чат отдыхает' });
    postChat(ws.player.id, ws.player.name, text);
  },
};

wss.on('connection', (ws, req) => {
  ws.ip = clientIp(req);
  ws.alive = true;
  ws.rate = makeBucket(MSG_LIMIT);
  ws.chatRate = makeBucket(CHAT_LIMIT);
  ws.strikes = 0;
  clients.add(ws);

  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
    if (!allow(ws.rate, MSG_LIMIT)) {
      ws.strikes += 1;
      if (ws.strikes >= FLOOD_STRIKES) ws.close(1008, 'flood');
      else if (ws.strikes % 10 === 1) send(ws, { type: 'error', message: 'Слишком много сообщений, притормози' });
      return;
    }
    let msg;
    try {
      msg = JSON.parse(data.toString());
    } catch {
      return send(ws, { type: 'error', message: 'Некорректный JSON' });
    }
    if (!msg || typeof msg !== 'object' || typeof msg.type !== 'string') {
      return send(ws, { type: 'error', message: 'Нет поля type' });
    }

    const handler = Object.hasOwn(handlers, msg.type) ? handlers[msg.type] : null;
    if (!handler) return send(ws, { type: 'error', message: `Неизвестный тип: ${msg.type}` });
    if (msg.type !== 'hello' && !ws.player) {
      return send(ws, { type: 'error', message: 'Сначала hello' });
    }
    try {
      handler(ws, msg);
    } catch (err) {
      console.error(`Ошибка в обработчике ${msg.type}:`, err);
      send(ws, { type: 'error', message: 'Ошибка сервера' });
    }
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (ws.player) {
      if (!isOnline(ws.player)) table.setConnected(ws.player, false);
      broadcastOnline();
    }
  });
});

// Обрываем мёртвые соединения (туннель может молча потерять клиента).
setInterval(() => {
  for (const ws of clients) {
    if (!ws.alive) {
      ws.terminate();
      continue;
    }
    ws.alive = false;
    ws.ping();
  }
}, HEARTBEAT_MS);

// Возвращаем ставки незавершённого раунда и дописываем то, что ждёт дебаунса.
function shutdown() {
  try {
    crash.stop();
    crash.refundActive();
    table.stop();
    table.refundAll();
    store.flush();
  } finally {
    process.exit(0);
  }
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
process.on('SIGHUP', shutdown);

// Админ: начислить фишки. body: { amount, target: "online" | "all" }. Заголовок X-Admin-Token.
app.post('/admin/grant', express.json({ limit: '1kb' }), (req, res) => {
  if (!isAdmin(req)) return res.status(403).json({ error: 'forbidden' });
  const { amount, target = 'online' } = req.body || {};
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > ADMIN_GRANT_MAX) {
    return res.status(400).json({ error: `amount: целое от 1 до ${ADMIN_GRANT_MAX}` });
  }
  if (target !== 'online' && target !== 'all') return res.status(400).json({ error: 'target: online или all' });

  const ids = target === 'online' ? [...onlineIds()] : store.leaderboard(Infinity).map((p) => p.id);
  const granted = ids.map((id) => store.get(id)).map((p) => {
    store.adjust(p, amount);
    return { name: p.name, balance: p.balance };
  });
  if (granted.length) {
    postChat(null, '🎰 Зал', `Подарок: ${target === 'online' ? 'всем онлайн' : 'всем'} по ${amount} фишек!`);
  }
  console.log(`Админ: начислено по ${amount} → ${granted.map((g) => g.name).join(', ') || 'никому'}`);
  res.json({ amount, target, granted });
});

crash.start();
table.start();

server.listen(PORT, HOST, () => {
  console.log(`Казино-зал: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
