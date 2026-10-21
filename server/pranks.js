// Приколы зала от админа: сундук в чате (кто первый схватил — того и фишки), лотерея среди тех,
// кто онлайн, и титул дня рядом с ником («👑 Король зала», «🤡 Клоун дня»…). Титулы переживают
// перезапуск сервера (файл), сундук и лотерея — нет: это события «здесь и сейчас».
const fs = require('node:fs');
const path = require('node:path');
const { randomFloat } = require('./rng');

const MAX_TITLE = 24;
const MAX_HOURS = 24 * 7;
const LOTTERY_SPIN_MS = 6500;

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

function createPranks({
  store,
  broadcast,
  postChat,
  onlineIds,
  file = null,
  now = Date.now,
  random = randomFloat,
  schedule = (fn, ms) => setTimeout(fn, ms),
  systemName = '🎰 Зал',
}) {
  // ---------- Титулы ----------
  const titles = new Map();   // playerId -> { text, until }
  if (file && fs.existsSync(file)) {
    try {
      for (const [id, t] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) titles.set(id, t);
    } catch { /* битый файл — начинаем без титулов */ }
  }
  function saveTitles() {
    if (!file) return;
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFile(file, JSON.stringify(Object.fromEntries(titles)), () => {});
  }
  function titlesMap() {
    const t = now();
    const out = {};
    for (const [id, v] of titles) {
      if (v.until > t) out[id] = v.text;
      else titles.delete(id);
    }
    return out;
  }
  const sendTitles = () => broadcast({ type: 'titles', titles: titlesMap() });

  function setTitle(playerId, text, hours = 24) {
    const p = store.get(playerId);
    if (!p) return { error: 'Игрок не найден' };
    const clean = String(text || '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, MAX_TITLE);
    if (!clean) return { error: 'Пустой титул' };
    const h = Math.min(MAX_HOURS, Math.max(1, Number(hours) || 24));
    titles.set(p.id, { text: clean, until: now() + h * 3600_000 });
    saveTitles();
    sendTitles();
    postChat(null, systemName, `${clean} — так теперь величают ${p.name}`);
    return { ok: true };
  }
  function clearTitle(playerId) {
    if (!titles.delete(playerId)) return { error: 'У игрока нет титула' };
    saveTitles();
    sendTitles();
    return { ok: true };
  }

  // ---------- Сундук в чате ----------
  let chest = null;   // { id, amount, until, claimedBy }
  let chestSeq = 0;
  function dropChest(amount, seconds = 60) {
    if (!Number.isSafeInteger(amount) || amount <= 0) return { error: 'Сумма сундука: целое число больше нуля' };
    if (chest && !chest.claimedBy && chest.until > now()) return { error: 'Прошлый сундук ещё лежит' };
    const ms = Math.min(600, Math.max(10, Number(seconds) || 60)) * 1000;
    const id = ++chestSeq;
    chest = { id, amount, until: now() + ms, claimedBy: null };
    broadcast({ type: 'chest', id, amount, until: chest.until });
    postChat(null, systemName, `📦 В зал упал сундук с ${fmt(amount)} фишек! Кто первый — того и фишки`);
    schedule(() => {
      if (!chest || chest.id !== id || chest.claimedBy) return;
      chest = null;
      broadcast({ type: 'chest_gone', id });
      postChat(null, systemName, '📦 Сундук никто не открыл — и он растворился');
    }, ms);
    return { ok: true, id };
  }
  function claimChest(player, id) {
    if (!chest || chest.id !== id) return { error: 'Сундук уже пропал' };
    if (chest.claimedBy) return { error: `Сундук уже схватил ${chest.claimedBy}` };
    if (chest.until <= now()) return { error: 'Сундук уже пропал' };
    chest.claimedBy = player.name;
    const { amount } = chest;
    store.adjust(player, amount);
    broadcast({ type: 'chest_claimed', id, name: player.name, amount });
    postChat(null, systemName, `📦 ${player.name} первым схватил сундук: +${fmt(amount)}`);
    chest = null;
    return { ok: true, amount };
  }
  const chestNow = () => (chest && !chest.claimedBy && chest.until > now() ? { id: chest.id, amount: chest.amount, until: chest.until } : null);

  // ---------- Лотерея ----------
  let lottery = null;   // { id, until }
  let lotterySeq = 0;
  function runLottery(amount) {
    if (!Number.isSafeInteger(amount) || amount <= 0) return { error: 'Приз лотереи: целое число больше нуля' };
    if (lottery && lottery.until > now()) return { error: 'Лотерея уже крутится' };
    const players = [...onlineIds()].map((id) => store.get(id)).filter(Boolean);
    if (!players.length) return { error: 'В зале никого нет' };
    const winner = players[Math.floor(random() * players.length)];
    const id = ++lotterySeq;
    lottery = { id, until: now() + LOTTERY_SPIN_MS };
    broadcast({ type: 'lottery', id, names: players.map((p) => p.name), winner: winner.name, amount, spinMs: LOTTERY_SPIN_MS });
    postChat(null, systemName, `🎟 Лотерея на ${fmt(amount)} фишек среди ${players.length} игроков — крутим!`);
    // Приз — когда колесо у всех остановилось.
    schedule(() => {
      lottery = null;
      const p = store.get(winner.id);
      if (!p) return;
      store.adjust(p, amount);
      postChat(null, systemName, `🎟 Лотерею выиграл ${p.name}: +${fmt(amount)}`);
    }, LOTTERY_SPIN_MS + 400);
    return { ok: true, winner: winner.name };
  }

  return {
    setTitle,
    clearTitle,
    titles: titlesMap,
    dropChest,
    claimChest,
    chest: chestNow,
    runLottery,
    forget: (playerId) => { if (titles.delete(playerId)) { saveTitles(); sendTitles(); } },
    adminState: () => {
      const t = titlesMap();
      return {
        titles: Object.entries(t).map(([id, text]) => ({ id, name: store.get(id)?.name || '?', text, until: titles.get(id)?.until })),
        chest: chestNow(),
        lottery: !!(lottery && lottery.until > now()),
      };
    },
  };
}

module.exports = { createPranks, MAX_TITLE, LOTTERY_SPIN_MS };
