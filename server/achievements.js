// Достижения и недельный сезон.
// Достижения открываются по событиям игр (те же, что идут в ленту ставок) и по капиталу.
// Сезон: неделя с понедельника 00:00 по Москве, очки — чистый выигрыш за неделю.
// В конце недели тройка лучших попадает в зал славы, и начинается новая неделя.
const fs = require('node:fs');
const { writeAtomic } = require('./players');

const DAY = 24 * 60 * 60 * 1000;
const WEEK = 7 * DAY;
const MSK = 3 * 60 * 60 * 1000;
const HALL_SIZE = 12;
const SEASON_TOP = 10;
const SAVE_DELAY_MS = 1000;
const GAMES = ['crash', 'roulette', 'upgrade', 'verity', 'bomb', 'pool', 'poker'];

const ACHIEVEMENTS = [
  { id: 'first_win', icon: '🩸', name: 'Первая кровь', desc: 'Выиграть в любой игре' },
  { id: 'regular', icon: '🎪', name: 'Завсегдатай', desc: 'Сыграть во все семь игр зала' },
  { id: 'big_win', icon: '💰', name: 'Крупный куш', desc: 'Выиграть 10 000 за раз' },
  { id: 'jackpot', icon: '💎', name: 'Джекпот', desc: 'Выиграть 100 000 за раз' },
  { id: 'high_roller', icon: '🎩', name: 'Хайроллер', desc: 'Поставить 50 000 за раз' },
  { id: 'millionaire', icon: '🤑', name: 'Миллионер', desc: 'Набрать капитал 1 000 000' },
  { id: 'comeback', icon: '🔥', name: 'Из грязи в князи', desc: 'Взять пособие, а потом поднять капитал до 10 000' },
  { id: 'crash_x10', icon: '🚀', name: 'Ракета', desc: 'Забрать в Краше на ×10 или выше' },
  { id: 'crash_x50', icon: '🌌', name: 'В стратосферу', desc: 'Забрать в Краше на ×50 или выше' },
  { id: 'crash_instant', icon: '🫠', name: 'Не взлетели', desc: 'Проиграть в Краше на ×1.00' },
  { id: 'roulette_straight', icon: '🎯', name: 'Снайпер', desc: 'Угадать число в рулетке' },
  { id: 'roulette_zero', icon: '🟢', name: 'Зеро!', desc: 'Выиграть ставкой на зеро' },
  { id: 'upgrade_odds', icon: '🍀', name: 'Против всех шансов', desc: 'Выиграть апгрейд с шансом 5% или меньше' },
  { id: 'verity_good', icon: '😊', name: 'Любимчик Верити', desc: 'Добрый Верити 5 раз подряд' },
  { id: 'verity_evil', icon: '😈', name: 'Ужин Верити', desc: 'Злой Верити 5 раз подряд' },
  { id: 'bomb_win', icon: '🧨', name: 'Сапёр', desc: 'Выиграть в Бомбе' },
  { id: 'bomb_boom', icon: '💥', name: 'Бабах', desc: 'Взорваться в Бомбе' },
  { id: 'bomb_last', icon: '🦁', name: 'Последний герой', desc: 'Забрать банк Бомбы, когда все остальные сбежали' },
  { id: 'pool_win', icon: '🎱', name: 'Кий в руке', desc: 'Выиграть партию в пул' },
  { id: 'pool_clean', icon: '✨', name: 'Чистая восьмёрка', desc: 'Выиграть пул, забив восьмёрку' },
  { id: 'pool_shark', icon: '🦈', name: 'Акула пула', desc: 'Выиграть 5 партий в пул' },
  { id: 'poker_win', icon: '🃏', name: 'Банк мой', desc: 'Выиграть раздачу в покере' },
  { id: 'poker_bluff', icon: '😎', name: 'Блефун', desc: 'Забрать банк, когда все сбросили' },
  { id: 'poker_quads', icon: '🀄', name: 'Каре', desc: 'Выиграть раздачу с каре или сильнее' },
  { id: 'poker_royal', icon: '👑', name: 'Роял-флеш', desc: 'Выиграть с роял-флешем' },
  { id: 'season_podium', icon: '🥉', name: 'Призёр недели', desc: 'Войти в тройку лучших по итогам недели' },
  { id: 'season_champ', icon: '🏆', name: 'Чемпион недели', desc: 'Занять первое место по итогам недели' },
];
const BY_ID = new Map(ACHIEVEMENTS.map((a) => [a.id, a]));

// Начало недели (понедельник 00:00 МСК), в которую попадает момент t.
function weekStart(t) {
  const day = Math.floor((t + MSK) / DAY);
  const monday = day - ((day + 3) % 7);   // 1 января 1970 — четверг
  return monday * DAY - MSK;
}

function createAchievements({
  file = null,
  store,
  now = Date.now,
  onUnlock = () => {},
  onSeasonEnd = () => {},
  saveDelayMs = SAVE_DELAY_MS,
}) {
  let players = {};                 // id -> { unlocked: { achId: at }, stats }
  let season = null;                // { startedAt, endsAt, scores: { id: { name, net } } }
  let hall = [];                    // [{ startedAt, endsAt, top: [{ id, name, net }] }], новые первыми
  let saveTimer = null;

  function load() {
    if (!file || !fs.existsSync(file)) return;
    let data;
    try {
      data = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch (err) {
      throw new Error(`${file} повреждён (${err.message}). Исправь или удали файл.`);
    }
    players = data.players && typeof data.players === 'object' ? data.players : {};
    season = data.season || null;
    hall = Array.isArray(data.hall) ? data.hall : [];
  }

  function flush() {
    clearTimeout(saveTimer);
    saveTimer = null;
    if (!file) return;
    writeAtomic(file, JSON.stringify({ version: 1, players, season, hall }, null, 2));
  }

  function save() {
    if (!file || saveTimer) return;
    saveTimer = setTimeout(() => {
      try {
        flush();
      } catch (err) {
        console.error('Не удалось сохранить достижения:', err);
      }
    }, saveDelayMs);
  }

  function rec(id) {
    if (!players[id]) players[id] = { unlocked: {}, stats: { games: {}, poolWins: 0, verityGood: 0, verityEvil: 0, tookBonus: false } };
    return players[id];
  }

  function unlock(player, achId) {
    const r = rec(player.id);
    if (r.unlocked[achId]) return false;
    r.unlocked[achId] = now();
    save();
    onUnlock(player, BY_ID.get(achId));
    return true;
  }

  function newSeason(t) {
    const startedAt = weekStart(t);
    season = { startedAt, endsAt: startedAt + WEEK, scores: {} };
  }

  function ranking() {
    return Object.entries(season.scores)
      .map(([id, s]) => ({ id, name: s.name, net: s.net }))
      .sort((a, b) => b.net - a.net || a.name.localeCompare(b.name, 'ru'));
  }

  // Неделя кончилась: тройку лучших в зал славы, им достижения, новая неделя.
  function closeSeason() {
    const top = ranking().slice(0, 3);
    if (top.length) {
      const entry = { startedAt: season.startedAt, endsAt: season.endsAt, top };
      hall.unshift(entry);
      if (hall.length > HALL_SIZE) hall.pop();
      top.forEach((p, i) => {
        const player = store.get(p.id);
        if (!player) return;
        if (i === 0) unlock(player, 'season_champ');
        unlock(player, 'season_podium');
      });
      onSeasonEnd(entry);
    }
    newSeason(now());
    save();
  }

  function tick() {
    if (!season) {
      newSeason(now());
      save();
    } else if (now() >= season.endsAt) {
      closeSeason();
    }
  }

  // Событие игры: { game, kind: 'bet'|'win'|'lose', player, amount, meta }.
  function record({ game, kind, player, amount, meta = {} }) {
    if (!player || !Number.isFinite(amount)) return;
    tick();
    const r = rec(player.id);
    const st = r.stats;
    if (GAMES.includes(game) && !st.games[game]) {
      st.games[game] = true;
      save();
      if (GAMES.every((g) => st.games[g])) unlock(player, 'regular');
    }
    if (meta.stake >= 50_000) unlock(player, 'high_roller');

    if (kind === 'win' || kind === 'lose') {
      const s = season.scores[player.id] || (season.scores[player.id] = { name: player.name, net: 0 });
      s.name = player.name;
      s.net += kind === 'win' ? amount : -amount;
      save();
    }

    if (kind === 'win') {
      unlock(player, 'first_win');
      if (amount >= 10_000) unlock(player, 'big_win');
      if (amount >= 100_000) unlock(player, 'jackpot');
    }

    switch (game) {
      case 'crash':
        if (kind === 'win' && meta.mult >= 10) unlock(player, 'crash_x10');
        if (kind === 'win' && meta.mult >= 50) unlock(player, 'crash_x50');
        if (kind === 'lose' && meta.crashedAt === 1) unlock(player, 'crash_instant');
        break;
      case 'roulette':
        if (meta.straight) unlock(player, 'roulette_straight');
        if (meta.zero) unlock(player, 'roulette_zero');
        break;
      case 'upgrade':
        if (kind === 'win' && meta.chance <= 5) unlock(player, 'upgrade_odds');
        break;
      case 'verity':
        if (typeof meta.good === 'boolean') {
          st.verityGood = meta.good ? st.verityGood + 1 : 0;
          st.verityEvil = meta.good ? 0 : st.verityEvil + 1;
          save();
          if (st.verityGood >= 5) unlock(player, 'verity_good');
          if (st.verityEvil >= 5) unlock(player, 'verity_evil');
        }
        break;
      case 'bomb':
        if (kind === 'win') unlock(player, 'bomb_win');
        if (meta.last) unlock(player, 'bomb_last');
        if (meta.boom) unlock(player, 'bomb_boom');
        break;
      case 'pool':
        if (kind === 'win') {
          st.poolWins += 1;
          save();
          unlock(player, 'pool_win');
          if (meta.byEight) unlock(player, 'pool_clean');
          if (st.poolWins >= 5) unlock(player, 'pool_shark');
        }
        break;
      case 'poker':
        if (kind === 'win') {
          unlock(player, 'poker_win');
          if (meta.folded) unlock(player, 'poker_bluff');
          if (meta.rank >= 8) unlock(player, 'poker_quads');
          if (meta.royal) unlock(player, 'poker_royal');
        }
        break;
      default:
    }
  }

  // Капитал изменился: миллионер и «из грязи в князи».
  function checkCapital(player, capital) {
    const r = players[player.id];
    if (capital >= 1_000_000) unlock(player, 'millionaire');
    if (capital >= 10_000 && r && r.stats.tookBonus) unlock(player, 'comeback');
  }

  function bonusClaimed(player) {
    rec(player.id).stats.tookBonus = true;
    save();
  }

  // Место и очки игрока в текущей неделе (place: null — ещё не играл).
  function standing(id) {
    tick();
    const list = ranking();
    const i = list.findIndex((p) => p.id === id);
    return i < 0 ? { place: null, net: 0 } : { place: i + 1, net: list[i].net };
  }

  function unlockedOf(id) {
    return players[id] ? { ...players[id].unlocked } : {};
  }

  function seasonView() {
    tick();
    return { startedAt: season.startedAt, endsAt: season.endsAt, top: ranking().slice(0, SEASON_TOP), hall: hall.slice() };
  }

  // Итоги прошедшей недели подводит первый tick() — уже после запуска сервера (onSeasonEnd пишет в чат).
  load();

  return {
    record,
    checkCapital,
    bonusClaimed,
    unlockedOf,
    standing,
    count: (id) => (players[id] ? Object.keys(players[id].unlocked).length : 0),
    season: seasonView,
    tick,
    // Админ: закрыть неделю прямо сейчас (итоги в зал славы, новая неделя).
    endSeasonNow: () => {
      tick();
      closeSeason();
      season.startedAt = now();   // новая неделя началась сейчас и кончится в обычный понедельник
      save();
    },
    forget: (id) => {
      delete players[id];
      if (season) delete season.scores[id];
      save();
    },
    adminState: () => ({ season: seasonView(), unlockedTotal: Object.values(players).reduce((n, p) => n + Object.keys(p.unlocked).length, 0) }),
    flush,
  };
}

module.exports = { createAchievements, ACHIEVEMENTS, weekStart, WEEK };
