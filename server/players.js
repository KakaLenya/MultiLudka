// Игроки и балансы. Хранение в JSON-файле: запись с дебаунсом, атомарно (tmp + rename).
const fs = require('node:fs');
const path = require('node:path');
const { randomToken } = require('./rng');

const START_BALANCE = 1000;
const BONUS_AMOUNT = 200;
const BONUS_THRESHOLD = 10;            // пособие, если капитал меньше этого
const BONUS_COOLDOWN_MS = 24 * 60 * 60 * 1000;
const NAME_MAX = 20;
const TOKEN_MAX = 64;
const SAVE_DELAY_MS = 500;

// Имя: строка, без управляющих символов, 1..NAME_MAX символов. null, если не годится.
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').replace(/\s+/g, ' ').trim().slice(0, NAME_MAX);
  return name.length > 0 ? name : null;
}

const nameKey = (name) => name.toLocaleLowerCase('ru');

function isChipAmount(n) {
  return Number.isSafeInteger(n) && n >= 0;
}

// Синхронная пауза для повтора rename (Windows: антивирус/индексатор держит файл).
function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function writeAtomic(file, text) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, text);
  for (let attempt = 0; ; attempt++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (err) {
      if (attempt >= 5 || !['EPERM', 'EBUSY', 'EACCES'].includes(err.code)) throw err;
      sleepSync(20 * (attempt + 1));
    }
  }
}

// file: путь к JSON (null = только в памяти, для тестов). now: часы (подменяются в тестах).
function createStore({ file = null, now = Date.now, saveDelayMs = SAVE_DELAY_MS } = {}) {
  const byId = new Map();
  const byToken = new Map();
  const byName = new Map();
  const changeListeners = [];
  const reservers = [];  // (player) => сколько фишек игрока лежит в играх (стол, ставка)
  let nextId = 1;
  let saveTimer = null;

  function index(player) {
    byId.set(player.id, player);
    byToken.set(player.token, player);
    byName.set(nameKey(player.name), player);
  }

  function load() {
    if (!file || !fs.existsSync(file)) return;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`${file} повреждён (${err.message}). Исправь или удали файл.`);
    }
    for (const p of data.players || []) {
      if (typeof p.token !== 'string' || !cleanName(p.name) || !isChipAmount(p.balance)) {
        throw new Error(`${file}: некорректная запись игрока ${JSON.stringify(p.id)}`);
      }
      index({
        id: String(p.id),
        token: p.token,
        name: p.name,
        balance: p.balance,
        lastBonusAt: Number.isFinite(p.lastBonusAt) ? p.lastBonusAt : null,
        createdAt: Number.isFinite(p.createdAt) ? p.createdAt : now(),
      });
      nextId = Math.max(nextId, Number(p.id) + 1 || 0);
    }
    if (Number.isSafeInteger(data.nextId)) nextId = Math.max(nextId, data.nextId);
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!file) return;
    const players = [...byId.values()].map((p) => ({
      id: p.id,
      token: p.token,
      name: p.name,
      balance: p.balance,
      lastBonusAt: p.lastBonusAt,
      createdAt: p.createdAt,
    }));
    writeAtomic(file, JSON.stringify({ version: 1, nextId, players }, null, 2));
  }

  function scheduleSave() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      try {
        flush();
      } catch (err) {
        console.error('Не удалось сохранить игроков:', err);
      }
    }, saveDelayMs);
  }

  function changed(player) {
    scheduleSave();
    for (const fn of changeListeners) fn(player);
  }

  function findByToken(token) {
    if (typeof token !== 'string' || token.length > TOKEN_MAX) return null;
    return byToken.get(token) || null;
  }

  // -> { player } или { error }
  function register(rawName) {
    const name = cleanName(rawName);
    if (!name) return { error: 'Введи имя (1-20 символов)' };
    if (byName.has(nameKey(name))) return { error: 'Это имя уже занято' };
    const player = {
      id: String(nextId++),
      token: randomToken(),
      name,
      balance: START_BALANCE,
      lastBonusAt: null,
      createdAt: now(),
    };
    index(player);
    changed(player);
    return { player };
  }

  // Единственный способ менять баланс. delta: целое, итог не может уйти в минус.
  function adjust(player, delta) {
    if (!Number.isSafeInteger(delta)) throw new Error(`adjust: дробная сумма ${delta}`);
    if (player.balance + delta < 0) throw new Error(`adjust: баланс ${player.name} ушёл бы в минус`);
    if (delta === 0) return player.balance;
    player.balance += delta;
    changed(player);
    return player.balance;
  }

  function reserved(player) {
    return reservers.reduce((sum, fn) => sum + fn(player), 0);
  }

  // Капитал: свободный баланс + всё, что лежит в играх.
  function capital(player) {
    return player.balance + reserved(player);
  }

  // availableIn: сколько мс ждать (0 = можно сейчас).
  function bonusStatus(player) {
    const readyAt = player.lastBonusAt === null ? 0 : player.lastBonusAt + BONUS_COOLDOWN_MS;
    return {
      amount: BONUS_AMOUNT,
      eligible: capital(player) < BONUS_THRESHOLD,
      availableIn: Math.max(0, readyAt - now()),
    };
  }

  // -> { ok: true } или { error }
  function claimBonus(player) {
    const status = bonusStatus(player);
    if (!status.eligible) return { error: `Пособие только при капитале меньше ${BONUS_THRESHOLD}` };
    if (status.availableIn > 0) return { error: 'Пособие уже получено, приходи позже' };
    player.lastBonusAt = now();
    adjust(player, BONUS_AMOUNT);
    return { ok: true };
  }

  function leaderboard(limit = 20) {
    return [...byId.values()]
      .map((p) => ({ id: p.id, name: p.name, capital: capital(p) }))
      .sort((a, b) => b.capital - a.capital || a.name.localeCompare(b.name, 'ru'))
      .slice(0, limit);
  }

  load();

  return {
    findByToken,
    register,
    get: (id) => byId.get(id) || null,
    adjust,
    capital,
    reserved,
    bonusStatus,
    claimBonus,
    leaderboard,
    flush,
    onChange: (fn) => changeListeners.push(fn),
    addReserver: (fn) => reservers.push(fn),
  };
}

module.exports = {
  createStore,
  cleanName,
  START_BALANCE,
  BONUS_AMOUNT,
  BONUS_THRESHOLD,
  BONUS_COOLDOWN_MS,
};
