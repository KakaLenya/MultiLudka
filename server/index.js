const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer } = require('ws');
const players = require('./players');

const PORT = Number(process.env.PORT) || 3000;
// По умолчанию слушаем только локально: наружу пускает cloudflared.
const HOST = process.env.HOST || '127.0.0.1';
const HEARTBEAT_MS = 30_000;

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

// Все открытые соединения. У каждого: ws.player (после hello) и ws.alive (heartbeat).
const clients = new Set();

function send(ws, msg) {
  if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
}

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const ws of clients) {
    if (ws.player && ws.readyState === ws.OPEN) ws.send(data);
  }
}

// Список онлайн без дублей: один игрок может быть открыт в нескольких вкладках.
function onlineList() {
  const seen = new Map();
  for (const ws of clients) {
    if (ws.player) seen.set(ws.player.id, { id: ws.player.id, name: ws.player.name });
  }
  return [...seen.values()];
}

function broadcastOnline() {
  broadcast({ type: 'online', players: onlineList() });
}

const handlers = {
  hello(ws, msg) {
    if (ws.player) return send(ws, { type: 'error', message: 'Уже вошёл' });

    let player = players.findByToken(msg.token);
    if (!player) {
      const name = players.cleanName(msg.name);
      if (!name) return send(ws, { type: 'error', message: 'Введи имя (1-20 символов)' });
      player = players.create(name);
    }

    ws.player = player;
    send(ws, {
      type: 'welcome',
      playerId: player.id,
      token: player.token,
      name: player.name,
      balance: player.balance,
    });
    broadcastOnline();
  },
};

wss.on('connection', (ws) => {
  ws.alive = true;
  clients.add(ws);

  ws.on('pong', () => { ws.alive = true; });

  ws.on('message', (data, isBinary) => {
    if (isBinary) return;
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
    handler(ws, msg);
  });

  ws.on('close', () => {
    clients.delete(ws);
    if (ws.player) broadcastOnline();
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

server.listen(PORT, HOST, () => {
  console.log(`Казино-зал: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
