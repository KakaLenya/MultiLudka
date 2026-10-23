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
const GAMES = ['crash', 'roulette', 'wheel', 'upgrade', 'verity', 'plinko', 'mines', 'blackjack', 'bjtable', 'kraken', 'saloon', 'yokai', 'circus', 'bomb', 'pool', 'poker'];

const ACHIEVEMENTS = [
  { id: 'first_win', icon: '🩸', name: 'Первая кровь', desc: 'Выиграть в любой игре' },
  { id: 'regular', icon: '🎪', name: 'Завсегдатай', desc: 'Сыграть во все шестнадцать игр зала' },
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
  { id: 'wheel_gold', icon: '🌟', name: 'Золотой сектор', desc: 'Поймать ×60 на колесе фортуны' },
  { id: 'wheel_skull', icon: '💀', name: 'Черепушка', desc: 'Проиграть черепу на колесе фортуны' },
  { id: 'upgrade_odds', icon: '🍀', name: 'Против всех шансов', desc: 'Выиграть апгрейд с шансом 5% или меньше' },
  { id: 'verity_good', icon: '😊', name: 'Любимчик Верити', desc: 'Добрый Верити 5 раз подряд' },
  { id: 'verity_evil', icon: '😈', name: 'Ужин Верити', desc: 'Злой Верити 5 раз подряд' },
  { id: 'verity_series', icon: '🔥', name: 'Огненная серия', desc: 'Довести серию Верити до ×16' },
  { id: 'plinko_edge', icon: '🔺', name: 'В самый край', desc: 'Попасть шариком плинко в крайнюю лунку' },
  { id: 'plinko_1000', icon: '🌠', name: 'Тысяча!', desc: 'Поймать ×1000 в плинко' },
  { id: 'kraken_awake', icon: '🐙', name: 'Кракен проснулся', desc: 'Разбудить Кракена в фриспинах до множителя ×10' },
  { id: 'kraken_grand', icon: '🏴‍☠️', name: 'Сундук Дейви Джонса', desc: 'Заполнить жемчугом весь сундук глубин' },
  { id: 'kraken_1000', icon: '🌊', name: 'Ужас глубин', desc: 'Выиграть ×1000 в Кракене' },
  { id: 'saloon_sniper', icon: '🎯', name: 'Меткий стрелок', desc: 'Пробить в дуэли одну клетку трижды — вайлд ×3' },
  { id: 'saloon_long', icon: '🤠', name: 'Неуловимый', desc: 'Продержаться в дуэли на закате 15 вращений' },
  { id: 'saloon_1000', icon: '💀', name: 'Награда за голову', desc: 'Выиграть ×1000 в Салуне мертвецов' },
  { id: 'yokai_parade', icon: '🦊', name: 'Девятихвостая', desc: 'Довести кицунэ в Ночи ста демонов до 9 хвостов и больше' },
  { id: 'yokai_bonus', icon: '⛩️', name: 'Ночь ста демонов', desc: 'Пройти через ворота тории в Ночь ста демонов' },
  { id: 'yokai_1000', icon: '🏮', name: 'Хозяин парада', desc: 'Выиграть ×1000 в Ночном параде' },
  { id: 'circus_bullseye', icon: '🎯', name: 'Яблочко', desc: 'Попасть ножом в главный приз щита в Заброшенном цирке' },
  { id: 'circus_assistant', icon: '🔪', name: 'Ассистентка цела?', desc: 'Попасть ножом в ассистентку' },
  { id: 'circus_300', icon: '🎪', name: 'Гвоздь программы', desc: 'Выиграть ×300 в Заброшенном цирке' },
  { id: 'mines_x10', icon: '💎', name: 'Алмазная жила', desc: 'Забрать в минах ×10 или больше' },
  { id: 'mines_clear', icon: '🧹', name: 'Чистое поле', desc: 'Открыть в минах все безопасные клетки' },
  { id: 'bj_natural', icon: '🂡', name: 'Двадцать одно', desc: 'Собрать блэкджек с первых двух карт' },
  { id: 'bj_double', icon: '⏫', name: 'Дерзкое удвоение', desc: 'Выиграть удвоенную руку в блэкджеке' },
  { id: 'bj_split', icon: '✂️', name: 'Двойной удар', desc: 'Выиграть обе руки после сплита в блэкджеке' },
  // hidden: секретная — в списке не видна, пока её не открыли (игрокам уходит заглушка, см. defsFor).
  { id: 'bj_sixseven', icon: '🤲', name: 'Сикс-севен', desc: 'Шестёрка и сразу за ней семёрка в одиночном блэкджеке', hidden: true },
  { id: 'bjt_seat', icon: '🪑', name: 'За общим столом', desc: 'Сыграть раздачу за общим столом блэкджека' },
  { id: 'bjt_full', icon: '🎉', name: 'Аншлаг', desc: 'Собрать блэкджек, когда за столом играют все пять мест' },
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

// Список достижений для игрока: секретные, которых у него нет, — только заглушкой, без названия и условия.
const defsFor = (unlocked = {}) => ACHIEVEMENTS.map((d) => (d.hidden && !unlocked[d.id] ? { id: d.id, hidden: true } : d));
// Секретные, открытые этим игроком (чтобы показать их в чужом профиле).
const secretsOf = (unlocked = {}) => ACHIEVEMENTS.filter((d) => d.hidden && unlocked[d.id]);

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
      case 'wheel':
        if (meta.gold) unlock(player, 'wheel_gold');
        if (meta.skull) unlock(player, 'wheel_skull');
        break;
      case 'upgrade':
        if (kind === 'win' && meta.chance <= 5) unlock(player, 'upgrade_odds');
        break;
      case 'mines':
        if (kind === 'win' && meta.multiplier >= 10) unlock(player, 'mines_x10');
        if (kind === 'win' && meta.cleared) unlock(player, 'mines_clear');
        break;
      case 'blackjack':
        if (meta.natural) unlock(player, 'bj_natural');
        if (meta.doubledWin) unlock(player, 'bj_double');
        if (meta.splitWin) unlock(player, 'bj_split');
        break;
      case 'bjtable':
        if (kind === 'bet') unlock(player, 'bjt_seat');
        if (meta.natural && meta.fullTable) unlock(player, 'bjt_full');
        break;
      case 'kraken':
        if (meta.level >= 4) unlock(player, 'kraken_awake');
        if (meta.grand) unlock(player, 'kraken_grand');
        if (kind === 'win' && meta.mult >= 1000) unlock(player, 'kraken_1000');
        break;
      case 'saloon':
        if (meta.maxMult >= 3) unlock(player, 'saloon_sniper');
        if (meta.spins >= 15) unlock(player, 'saloon_long');
        if (kind === 'win' && meta.mult >= 1000) unlock(player, 'saloon_1000');
        break;
      case 'yokai':
        if (meta.night && meta.maxTails >= 9) unlock(player, 'yokai_parade');
        if (meta.night) unlock(player, 'yokai_bonus');
        if (kind === 'win' && meta.mult >= 1000) unlock(player, 'yokai_1000');
        break;
      case 'circus':
        if (meta.top) unlock(player, 'circus_bullseye');
        if (meta.assistant) unlock(player, 'circus_assistant');
        if (kind === 'win' && meta.mult >= 300) unlock(player, 'circus_300');
        break;
      case 'plinko':
        if (meta.edge) unlock(player, 'plinko_edge');
        if (meta.multiplier >= 1000) unlock(player, 'plinko_1000');
        break;
      case 'verity':
        if (typeof meta.good === 'boolean') {
          st.verityGood = meta.good ? st.verityGood + 1 : 0;
          st.verityEvil = meta.good ? 0 : st.verityEvil + 1;
          save();
          if (st.verityGood >= 5) unlock(player, 'verity_good');
          if (st.verityEvil >= 5) unlock(player, 'verity_evil');
          if (meta.good && meta.streak >= 4) unlock(player, 'verity_series');
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
    has: (id, achId) => !!(players[id] && players[id].unlocked[achId]),
    // Открыть напрямую (пасхалки, которые решает сама игра). true — открыто сейчас впервые.
    grant: (player, achId) => BY_ID.has(achId) && unlock(player, achId),
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

module.exports = { createAchievements, ACHIEVEMENTS, defsFor, secretsOf, weekStart, WEEK };
