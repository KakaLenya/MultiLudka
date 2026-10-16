const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const express = require('express');
const { WebSocketServer } = require('ws');
const { createStore } = require('./players');
const { randomToken } = require('./rng');
const { createCrashGame } = require('./crash');
const { createHoldem } = require('./holdem');
const { createAdminRouter } = require('./admin');
const { createRoulette } = require('./roulette');
const { createBomb } = require('./bomb');
const { createUpgrader } = require('./upgrader');
const { createPool } = require('./pool');
const { createMusic, sniffAudioType } = require('./music');
const { createSongRequests } = require('./requests');

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
// Сюда владелец зала кладёт mp3; в git папка не попадает.
const MUSIC_DIR = process.env.MUSIC_DIR || path.join(__dirname, '..', 'music');
fs.mkdirSync(MUSIC_DIR, { recursive: true });

const store = createStore({ file: path.join(DATA_DIR, 'players.json') });

// Секрет для /admin/api (нужен только при входе не с этого компьютера): лежит только локально в data/admin.token, создаётся при первом старте.
const adminToken = (() => {
  const file = path.join(DATA_DIR, 'admin.token');
  if (fs.existsSync(file)) return fs.readFileSync(file, 'utf8').trim();
  const token = randomToken(32);
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(file, token);
  return token;
})();

const app = express();
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/music-files', express.static(MUSIC_DIR, {
  index: false,
  dotfiles: 'ignore',
  maxAge: '1h',
  setHeaders: (res, file) => {
    const type = sniffAudioType(file);
    if (type) res.setHeader('Content-Type', type);
  },
}));

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

// Общая лента ставок и выигрышей по всем играм.
const ACTIVITY_SIZE = 40;
const activity = [];
let activitySeq = 0;
function onActivity({ game, kind, player, amount, note = '' }) {
  if (!amount) return;
  const entry = { id: ++activitySeq, at: Date.now(), game, kind, playerId: player.id, name: player.name, amount, note };
  activity.unshift(entry);
  if (activity.length > ACTIVITY_SIZE) activity.pop();
  broadcast({ type: 'activity', entry });
}

const chatLog = [];
let chatSeq = 0;
const mutes = new Map();  // playerId -> до какого времени молчит (админ)

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
  if (typeof broadcastPool === 'function') broadcastPool();
  // Удалённый админом игрок может ещё долю секунды висеть в соединениях: пропускаем его.
  const players = [...onlineIds()].map((id) => store.get(id)).filter(Boolean).map((p) => ({ id: p.id, name: p.name }));
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
  onEvent: onActivity,
  onState: (s) => broadcast({ type: 'crash_state', ...s }),
});
store.addReserver(crash.reserved);

const roulette = createRoulette({
  store,
  onEvent: onActivity,
  onState: (s) => broadcast({ type: 'roulette_state', ...s }),
});
store.addReserver(roulette.reserved);

const bomb = createBomb({
  store,
  onEvent: onActivity,
  onState: (s) => broadcast({ type: 'bomb_state', ...s }),
});
store.addReserver(bomb.reserved);

const upgrader = createUpgrader({
  store,
  onEvent: onActivity,
  onFeed: (feed) => broadcast({ type: 'upgrade_feed', feed }),
});

// Текущий трек переживает перезапуск сервера: пишем его в data/music-now.json.
const MUSIC_NOW_FILE = path.join(DATA_DIR, 'music-now.json');
const music = createMusic({
  dir: MUSIC_DIR,
  onChange: (track) => {
    broadcast({ type: 'music', track });
    try {
      if (track) {
        fs.writeFileSync(MUSIC_NOW_FILE, JSON.stringify({
          id: track.id, startedAt: track.startedAt, autoplay: track.autoplay, duration: track.duration,
        }));
      }
      else fs.rmSync(MUSIC_NOW_FILE, { force: true });
    } catch (err) {
      console.error('Не удалось сохранить текущий трек:', err.message);
    }
  },
});
try {
  music.restore(JSON.parse(fs.readFileSync(MUSIC_NOW_FILE, 'utf8')));
} catch { /* ничего не играло */ }
const songRequests = createSongRequests({ playlist: music.playlist, play: music.play });

// Список треков для кнопки «Заказать»: шлём при входе и когда в папке что-то поменялось.
function libraryMsg() {
  return { type: 'music_library', tracks: music.playlist().map((s) => ({ id: s.id, title: s.title })) };
}
let libraryKey = '';
setInterval(() => {
  const msg = libraryMsg();
  const key = msg.tracks.map((t) => t.id).join('|');
  if (key !== libraryKey) {
    libraryKey = key;
    broadcast(msg);
  }
}, 10_000);

// Заказ песни от игрока: в чат уходит объявление, админ подтверждает в админке.
function requestSong(ws, payload) {
  const result = songRequests.request(ws.player, payload);
  if (result.error) return send(ws, { type: 'error', message: result.error });
  const r = result.request;
  postChat(null, '🎰 Зал', `🎵 ${r.name} заказывает: ${r.text}${result.track ? '' : ' (такого трека пока нет)'}`);
  send(ws, { type: 'notice', message: 'Заказ отправлен, ждём подтверждения админа' });
}
const SONG_COMMAND = /^[!/](песня|заказ|song|трек)\s+(.+)$/i;

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
const table = createHoldem({ store, onChange: broadcastPoker, onEvent: onActivity });
store.addReserver(table.reserved);

// Пул: у каждого свои приглашения, матчи видны всем (можно смотреть).
let poolTimer = null;
function broadcastPool() {
  if (poolTimer) return;
  poolTimer = setImmediate(() => {
    poolTimer = null;
    for (const ws of clients) {
      if (ws.player) send(ws, { type: 'pool_state', ...pool.view(ws.player) });
    }
  });
}
const pool = createPool({
  store,
  isOnline: (id) => onlineIds().has(id),
  onChange: broadcastPool,
  onEvent: onActivity,
});
store.addReserver(pool.reserved);

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
    send(ws, { type: 'roulette_state', ...roulette.state() });
    send(ws, { type: 'bomb_state', ...bomb.state() });
    send(ws, { type: 'upgrade_feed', feed: upgrader.feed() });
    send(ws, { type: 'activity_history', entries: activity });
    send(ws, { type: 'pool_state', ...pool.view(player) });
    table.setConnected(player, true);
    send(ws, { type: 'poker_state', ...table.view(player) });
    send(ws, { type: 'chat_history', messages: chatLog });
    send(ws, { type: 'music', track: music.state() });
    send(ws, libraryMsg());
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

  roulette_bet(ws, msg) {
    reply(ws, roulette.bet(ws.player, msg.betType, msg.number, msg.amount));
  },

  roulette_clear(ws) {
    reply(ws, roulette.clear(ws.player));
  },

  bomb_join(ws) {
    reply(ws, bomb.join(ws.player));
  },

  bomb_leave(ws) {
    reply(ws, bomb.leave(ws.player));
  },

  bomb_deposit(ws, msg) {
    reply(ws, bomb.deposit(ws.player, msg.amount));
  },

  bomb_flee(ws) {
    reply(ws, bomb.flee(ws.player));
  },

  pool_invite(ws, msg) {
    reply(ws, pool.invite(ws.player, msg.toId, msg.stake));
  },

  pool_cancel(ws) {
    reply(ws, pool.cancel(ws.player));
  },

  pool_accept(ws, msg) {
    reply(ws, pool.accept(ws.player, msg.inviteId));
  },

  pool_decline(ws, msg) {
    reply(ws, pool.decline(ws.player, msg.inviteId));
  },

  pool_shoot(ws, msg) {
    reply(ws, pool.shoot(ws.player, { dir: msg.dir, power: msg.power, cue: msg.cue }));
  },

  pool_concede(ws) {
    reply(ws, pool.concede(ws.player));
  },

  upgrade_spin(ws, msg) {
    const result = upgrader.spin(ws.player, msg.amount, msg.chance);
    if (result.error) return send(ws, { type: 'error', message: result.error });
    send(ws, { type: 'upgrade_result', ...result.spin });
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


  // Браузер загрузил трек и сообщает его длину: по ней сервер сам выключит трек.
  music_duration(ws, msg) {
    music.reportDuration(msg.id, Number(msg.duration));
  },

  song_request(ws, msg) {
    const trackId = typeof msg.trackId === 'string' ? msg.trackId : undefined;
    requestSong(ws, { text: msg.text, trackId });
  },

  chat(ws, msg) {
    const text = cleanChat(msg.text);
    if (!text) return;
    const mutedFor = (mutes.get(ws.player.id) || 0) - Date.now();
    if (mutedFor > 0) return send(ws, { type: 'error', message: `Ты в муте ещё ${Math.ceil(mutedFor / 60000)} мин` });
    const command = SONG_COMMAND.exec(text);
    if (command) return requestSong(ws, { text: command[2] });
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
    roulette.stop();
    roulette.refundActive();
    bomb.stop();
    bomb.refundAll();
    pool.stop();
    pool.refundAll();
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

app.use('/admin/api', createAdminRouter({
  adminToken,
  store,
  crash,
  table,
  roulette,
  bomb,
  upgrader,
  pool,
  music,
  songRequests,
  chat: {
    log: () => chatLog,
    post: postChat,
    clear: () => {
      chatLog.length = 0;
      broadcast({ type: 'chat_history', messages: [] });
    },
  },
  mutes,
  cleanText: cleanChat,
  onlineIds,
  sendToPlayer,
  broadcast,
  refreshLists: () => { broadcastOnline(); broadcastPoker(); scheduleLeaderboard(); },
  // Удалённого игрока выкидываем: при переподключении его токен уже не узнают, клиент покажет вход.
  disconnectPlayer: (player) => {
    for (const ws of clients) {
      if (ws.player !== player) continue;
      ws.player = null;  // сразу из списка онлайн, не дожидаясь закрытия сокета
      ws.close(4001, 'deleted');
    }
  },
}));

crash.start();
table.start();
roulette.start();
bomb.start();
pool.start();

server.listen(PORT, HOST, () => {
  console.log(`Казино-зал: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
});
