// Мероприятия от админа: дождь из фишек, викторина в чате, счастливый час и гонка.
// Живут в памяти: перезапуск сервера их заканчивает.
const { randomFloat } = require('./rng');

const fmt = (n) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.');

const RAIN_FALL_MS = 4200;                      // сколько монета летит сверху вниз
const RAIN_MIN_SEC = 10;
const RAIN_MAX_SEC = 60;
const QUIZ_MAX_LEN = 200;
const HAPPY_MULTS = [1.5, 2, 3];
const MAX_MINUTES = 180;
const RACE_SPLIT = [0.5, 0.3, 0.2];             // доли приза за 1-е, 2-е и 3-е место
const RACE_PUSH_MS = 1500;                      // таблицу гонки рассылаем не чаще

// Ответ викторины: без регистра, ё = е, без знаков препинания и лишних пробелов.
const normAnswer = (s) => String(s || '').toLowerCase().replace(/ё/g, 'е').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

function createEvents({
  store,
  broadcast,
  postChat,
  notify = () => {},
  now = Date.now,
  random = randomFloat,
  schedule = (fn, ms) => setTimeout(fn, ms),
  systemName = '🎰 Зал',
}) {
  // ---------- Дождь из фишек ----------
  let rain = null;   // { id, start, until, coins: Map(coinId -> { at, x, value, by }) }
  let rainSeq = 0;
  const rainView = (r) => ({
    id: r.id,
    startIn: r.start - now(),   // относительное время: часы у игроков могут спешить

    fallMs: RAIN_FALL_MS,
    coins: [...r.coins].filter(([, c]) => !c.by).map(([cid, c]) => ({ id: cid, at: c.at, x: c.x, value: c.value })),
  });

  function startRain(total, seconds = 20) {
    if (!Number.isSafeInteger(total) || total <= 0) return { error: 'Сумма дождя: целое число больше нуля' };
    if (rain && rain.until > now()) return { error: 'Дождь уже идёт' };
    const sec = Math.min(RAIN_MAX_SEC, Math.max(RAIN_MIN_SEC, Number(seconds) || 20));
    const count = Math.min(total, Math.round(sec * 2.5));
    const base = Math.floor(total / count);
    const coins = new Map();
    for (let i = 0; i < count; i++) {
      coins.set(i + 1, {
        at: Math.floor(random() * (sec * 1000 - 1000)),
        x: 0.04 + random() * 0.92,
        value: base + (i < total - base * count ? 1 : 0),
        by: null,
      });
    }
    const id = ++rainSeq;
    const start = now() + 1500;   // полторы секунды на «надвигается дождь»
    rain = { id, start, until: start + sec * 1000 + RAIN_FALL_MS, coins };
    broadcast({ type: 'rain', ...rainView(rain) });
    postChat(null, systemName, `🌧 Дождь из фишек! ${fmt(total)} фишек в ${count} монетах — лови мышкой`);
    schedule(() => {
      if (!rain || rain.id !== id) return;
      const caught = new Map();
      for (const c of rain.coins.values()) if (c.by) caught.set(c.by.name, (caught.get(c.by.name) || 0) + c.value);
      rain = null;
      const top = [...caught].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([n, v]) => `${n} +${fmt(v)}`);
      postChat(null, systemName, top.length ? `🌧 Дождь закончился. Больше всех наловили: ${top.join(', ')}` : '🌧 Дождь закончился — никто ничего не поймал');
    }, rain.until - now() + 300);
    return { ok: true, id, coins: count };
  }

  function catchCoin(player, rainId, coinId) {
    if (!rain || rain.id !== rainId) return { error: 'Дождь уже кончился' };
    const c = rain.coins.get(coinId);
    if (!c) return { error: 'Нет такой монеты' };
    if (c.by) return { error: null };   // кто-то успел раньше: молча
    const t = now() - rain.start;
    // Ловить можно, пока монета на экране (с запасом на задержку сети).
    if (t < c.at - 500 || t > c.at + RAIN_FALL_MS + 1500) return { error: null };
    c.by = player;
    store.adjust(player, c.value);
    broadcast({ type: 'rain_caught', id: rainId, coin: coinId, name: player.name, value: c.value });
    return { ok: true, value: c.value };
  }

  // ---------- Викторина ----------
  let quiz = null;   // { id, question, answers, shown, prize, until }
  let quizSeq = 0;

  function startQuiz(question, answer, prize, seconds = 60) {
    const q = String(question || '').replace(/\s+/g, ' ').trim().slice(0, QUIZ_MAX_LEN);
    if (!q) return { error: 'Пустой вопрос' };
    const shown = String(answer || '').replace(/\s+/g, ' ').trim().slice(0, QUIZ_MAX_LEN);
    const answers = shown.split('/').map(normAnswer).filter(Boolean);
    if (!answers.length) return { error: 'Пустой ответ' };
    if (!Number.isSafeInteger(prize) || prize <= 0) return { error: 'Приз: целое число больше нуля' };
    if (quiz) return { error: 'Викторина уже идёт' };
    const ms = Math.min(600, Math.max(15, Number(seconds) || 60)) * 1000;
    const id = ++quizSeq;
    quiz = { id, question: q, answers, shown: shown.split('/')[0].trim(), prize, until: now() + ms };
    broadcast({ type: 'quiz', id, question: q, prize, until: quiz.until });
    postChat(null, systemName, `❓ Викторина на ${fmt(prize)} фишек: ${q} — пиши ответ в чат, первый верный забирает`);
    schedule(() => {
      if (!quiz || quiz.id !== id) return;
      endQuiz(null);
    }, ms);
    return { ok: true, id };
  }

  function endQuiz(winner) {
    const q = quiz;
    quiz = null;
    broadcast({ type: 'quiz_end', id: q.id, winner: winner ? winner.name : null, answer: q.shown, prize: q.prize });
    if (winner) postChat(null, systemName, `✅ ${winner.name} ответил верно: «${q.shown}» — +${fmt(q.prize)}`);
    else postChat(null, systemName, `⌛ Время вышло. Правильный ответ: «${q.shown}»`);
  }

  // Вызывается на каждое сообщение чата (после того как оно ушло в ленту).
  function chatMessage(player, text) {
    if (!quiz || quiz.until <= now()) return false;
    if (!quiz.answers.includes(normAnswer(text))) return false;
    store.adjust(player, quiz.prize);
    endQuiz(player);
    return true;
  }

  function cancelQuiz() {
    if (!quiz) return { error: 'Викторины нет' };
    const id = quiz.id;
    quiz = null;
    broadcast({ type: 'quiz_end', id, winner: null, answer: null, cancelled: true });
    postChat(null, systemName, '❓ Викторину отменили');
    return { ok: true };
  }

  // ---------- Счастливый час ----------
  let happy = null;   // { id, mult, until, paid }
  let happySeq = 0;
  const happyNow = () => (happy && happy.until > now() ? happy : null);

  function startHappy(mult, minutes) {
    const m = Number(mult);
    if (!HAPPY_MULTS.includes(m)) return { error: `Множитель: ${HAPPY_MULTS.join(', ')}` };
    const min = Math.min(MAX_MINUTES, Math.max(1, Math.floor(Number(minutes)) || 0));
    if (!min) return { error: 'Сколько минут?' };
    const id = ++happySeq;
    happy = { id, mult: m, until: now() + min * 60_000, paid: 0 };
    broadcast({ type: 'happy', mult: m, until: happy.until });
    postChat(null, systemName, `⚡ Счастливый час! ${min} мин все выигрыши ×${String(m).replace('.', ',')}`);
    schedule(() => { if (happy && happy.id === id) stopHappy(); }, min * 60_000);
    return { ok: true };
  }

  function stopHappy() {
    if (!happy) return { error: 'Счастливый час не идёт' };
    const { paid } = happy;
    happy = null;
    broadcast({ type: 'happy', mult: 1, until: 0 });
    postChat(null, systemName, `⚡ Счастливый час закончился${paid ? `, зал получил сверху ${fmt(paid)}` : ''}`);
    return { ok: true };
  }

  // ---------- Гонка ----------
  let race = null;   // { id, prize, until, scores: Map(playerId -> { name, net }), pushAt, pushTimer }
  let raceSeq = 0;
  const raceTop = (n = 5) => [...race.scores.entries()]
    .map(([id, s]) => ({ id, name: s.name, net: s.net }))
    .sort((a, b) => b.net - a.net)
    .slice(0, n);
  const prizes = (total) => RACE_SPLIT.map((k, i) => (i === 0 ? total - RACE_SPLIT.slice(1).reduce((s, q) => s + Math.floor(total * q), 0) : Math.floor(total * k)));
  const raceView = () => ({ id: race.id, until: race.until, prizes: prizes(race.prize), top: raceTop() });

  function pushRace() {
    if (!race || race.pushTimer) return;
    const wait = race.pushAt + RACE_PUSH_MS - now();
    const go = () => {
      if (!race) return;
      race.pushTimer = null;
      race.pushAt = now();
      broadcast({ type: 'race', ...raceView() });
    };
    if (wait <= 0) go();
    else race.pushTimer = schedule(go, wait) || true;
  }

  function startRace(prize, minutes) {
    if (!Number.isSafeInteger(prize) || prize < 3) return { error: 'Приз гонки: целое число от 3' };
    const min = Math.min(MAX_MINUTES, Math.max(1, Math.floor(Number(minutes)) || 0));
    if (!min) return { error: 'Сколько минут?' };
    if (race) return { error: 'Гонка уже идёт' };
    const id = ++raceSeq;
    race = { id, prize, until: now() + min * 60_000, scores: new Map(), pushAt: 0, pushTimer: null };
    broadcast({ type: 'race', ...raceView() });
    const [p1, p2, p3] = prizes(prize);
    postChat(null, systemName, `🏁 Гонка на ${min} мин! Кто больше всех наиграет в плюс: 🥇 ${fmt(p1)} · 🥈 ${fmt(p2)} · 🥉 ${fmt(p3)}`);
    schedule(() => { if (race && race.id === id) finishRace(); }, min * 60_000);
    return { ok: true };
  }

  function finishRace() {
    if (!race) return { error: 'Гонка не идёт' };
    const top = raceTop(3).filter((r) => r.net > 0);
    const pr = prizes(race.prize);
    const results = top.map((r, i) => ({ name: r.name, net: r.net, prize: pr[i] }));
    for (let i = 0; i < top.length; i++) {
      const p = store.get(top[i].id);
      if (p) store.adjust(p, pr[i]);
    }
    const id = race.id;
    race = null;
    broadcast({ type: 'race_end', id, results });
    const medals = ['🥇', '🥈', '🥉'];
    postChat(null, systemName, results.length
      ? `🏁 Гонка окончена! ${results.map((r, i) => `${medals[i]} ${r.name} (+${fmt(r.net)}) → ${fmt(r.prize)}`).join(' · ')}`
      : '🏁 Гонка окончена — никто не вышел в плюс, призы остались у зала');
    return { ok: true, results };
  }

  // Каждая ставка и выигрыш во всех играх (amount — чистый плюс или минус).
  function onActivity({ kind, player, amount }) {
    if (!player || !(amount > 0) || (kind !== 'win' && kind !== 'lose')) return;
    const h = happyNow();
    if (h && kind === 'win') {
      const bonus = Math.floor(amount * (h.mult - 1));
      if (bonus > 0) {
        const p = store.get(player.id);
        if (p) {
          store.adjust(p, bonus);
          h.paid += bonus;
          notify(p, { type: 'happy_bonus', bonus, mult: h.mult });
        }
      }
    }
    if (race && race.until > now()) {
      const s = race.scores.get(player.id) || { name: player.name, net: 0 };
      s.name = player.name;
      s.net += kind === 'win' ? amount : -amount;
      race.scores.set(player.id, s);
      pushRace();
    }
  }

  // Что показать игроку, который только что зашёл.
  function snapshot() {
    const out = [];
    if (rain && rain.until > now()) out.push({ type: 'rain', ...rainView(rain) });
    if (quiz && quiz.until > now()) out.push({ type: 'quiz', id: quiz.id, question: quiz.question, prize: quiz.prize, until: quiz.until });
    const h = happyNow();
    if (h) out.push({ type: 'happy', mult: h.mult, until: h.until });
    if (race) out.push({ type: 'race', ...raceView() });
    return out;
  }

  return {
    startRain,
    catchCoin,
    startQuiz,
    cancelQuiz,
    chatMessage,
    startHappy,
    stopHappy,
    startRace,
    finishRace,
    onActivity,
    snapshot,
    happyMult: () => (happyNow() ? happyNow().mult : 1),
    adminState: () => {
      const h = happyNow();
      return {
        rain: rain && rain.until > now() ? { left: [...rain.coins.values()].filter((c) => !c.by).length, until: rain.until } : null,
        quiz: quiz ? { question: quiz.question, answer: quiz.shown, prize: quiz.prize, until: quiz.until } : null,
        happy: h ? { mult: h.mult, until: h.until, paid: h.paid } : null,
        race: race ? { until: race.until, prize: race.prize, top: raceTop() } : null,
      };
    },
  };
}

module.exports = { createEvents, normAnswer, RAIN_FALL_MS, HAPPY_MULTS };
