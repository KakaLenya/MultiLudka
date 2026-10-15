// Игроки. Этап 0: только в памяти. Этап 1: токены + data/players.json.
const { randomToken } = require('./rng');

const START_BALANCE = 1000;
const NAME_MAX = 20;

const byId = new Map();
const byToken = new Map();
let nextId = 1;

// Имя: строка, без управляющих символов, 1..NAME_MAX символов. null, если не годится.
function cleanName(raw) {
  if (typeof raw !== 'string') return null;
  const name = raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, NAME_MAX);
  return name.length > 0 ? name : null;
}

function create(name) {
  const player = {
    id: String(nextId++),
    token: randomToken(),
    name,
    balance: START_BALANCE,
  };
  byId.set(player.id, player);
  byToken.set(player.token, player);
  return player;
}

function findByToken(token) {
  return typeof token === 'string' ? byToken.get(token) || null : null;
}

module.exports = { cleanName, create, findByToken };
