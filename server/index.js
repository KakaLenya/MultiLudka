const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { createStore } = require('./players');
const { createCrashGame } = require('./crash');
const { createTable } = require('./dicepoker');

const PORT = Number(process.env.PORT) || 3000;
// По умолчанию слушаем только локально: наружу пускает cloudflared.
const HOST = process.env.HOST || '127.0.0.1';
const HEARTBEAT_MS = 30_000;
const LEADERBOARD_THROTTLE_MS = 300;

const store = createStore({ file: path.join(__dirname, '..', 'data', 'players.json') });

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
      const result = store.register(msg.name);
      if (result.error) return send(ws, { type: 'error', code: 'bad_name', message: result.error });
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

crash.start();
table.start();

server.listen(PORT, HOST, () => {
  console.log(`Казино-зал: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
