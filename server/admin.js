// Админка: REST API под /admin/api. Доступ: локально напрямую (без туннеля) или по X-Admin-Token.
const crypto = require('node:crypto');
const express = require('express');

const { MAX_BALANCE } = require('./players');
const MAX_AMOUNT = MAX_BALANCE;   // сколько угодно — до потолка баланса (квадриллион)
const MAX_MUTE_MIN = 24 * 60;
const EFFECTS = new Set(['confetti', 'money', 'shake', 'flip', 'disco']);
const LOOPBACK = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1']);
const SYSTEM_NAME = '🎰 Зал';

// Запрос пришёл с этого компьютера напрямую, а не через cloudflared:
// туннель всегда добавляет cf-* заголовки и свой Host (*.trycloudflare.com).
function isLocalDirect(req) {
  const host = String(req.headers.host || '').replace(/:\d+$/, '');
  return LOOPBACK.has(req.socket.remoteAddress)
    && !req.headers['cf-connecting-ip'] && !req.headers['cf-ray']
    && (host === '127.0.0.1' || host === 'localhost' || host === '[::1]');
}

function tokenMatches(given, expected) {
  const a = Buffer.from(String(given || ''));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function createAdminRouter({
  adminToken, store, crash, table, roulette, bomb, upgrader, verity, plinko = null, mines = null, achievements, luck, pool, duel = null, music, songRequests, chat, mutes, cleanText,
  onlineIds, sendToPlayer, broadcast, refreshLists, disconnectPlayer = () => {}, shutdown = () => {},
}) {
  const router = express.Router();
  router.use(express.json({ limit: '4kb' }));
  router.use((req, res, next) => {
    if (isLocalDirect(req) || tokenMatches(req.get('x-admin-token'), adminToken)) return next();
    res.status(403).json({ error: 'Нужен админский токен' });
  });

  const ok = (res, body = {}) => res.json({ ok: true, ...body });
  const fail = (res, error, code = 400) => res.status(code).json({ error });
  const findPlayer = (id) => store.get(String(id));

  // Положительное: начислить. Отрицательное: забрать, но не больше, чем есть свободного.
  function give(player, amount) {
    const delta = amount < 0 ? -Math.min(player.balance, -amount) : Math.min(amount, MAX_BALANCE - player.balance);
    store.adjust(player, delta);
    return delta;
  }

  function parseAmount(raw) {
    return Number.isSafeInteger(raw) && raw !== 0 && Math.abs(raw) <= MAX_AMOUNT ? raw : null;
  }

  router.get('/state', (req, res) => {
    const online = onlineIds();
    const t = Date.now();
    const players = store.all()
      .map((p) => ({
        id: p.id,
        name: p.name,
        online: online.has(p.id),
        balance: p.balance,
        reserved: store.reserved(p),
        capital: store.capital(p),
        bonusReadyIn: store.bonusStatus(p).availableIn,
        mutedFor: Math.max(0, (mutes.get(p.id) || 0) - t),
        luck: luck.percentOf(p.id),
        hasPassword: store.hasPassword(p),
        password: store.passwordOf(p),
        createdAt: p.createdAt,
      }))
      .sort((a, b) => b.online - a.online || b.capital - a.capital);
    res.json({ players, crash: crash.adminState(), roulette: roulette.adminState(), bomb: bomb.adminState(), upgrader: upgrader.adminState(), verity: verity.adminState(), plinko: plinko ? plinko.adminState() : null, mines: mines ? mines.adminState() : null, season: achievements.adminState(), pool: pool.adminState(), duel: duel ? duel.adminState() : null, poker: table.adminView(), chat: chat.log(),
      music: { current: music.state(), playlist: music.playlist(), autoplay: music.autoplay() },
      requests: songRequests.list() });
  });

  // { amount, target: "online" | "all" | "player", playerId? }
  router.post('/grant', (req, res) => {
    const { target = 'player', playerId } = req.body;
    const amount = parseAmount(req.body.amount);
    if (amount === null) return fail(res, 'Сумма: целое, не 0, по модулю до квадриллиона');

    let players;
    if (target === 'online') players = [...onlineIds()].map(findPlayer);
    else if (target === 'all') players = store.all();
    else if (target === 'player') {
      const p = findPlayer(playerId);
      if (!p) return fail(res, 'Игрок не найден', 404);
      players = [p];
    } else return fail(res, 'target: online, all или player');

    const results = players.map((p) => ({ name: p.name, delta: give(p, amount), balance: p.balance }));
    if (results.length) {
      const who = target === 'online' ? 'всем онлайн' : target === 'all' ? 'всем' : results[0].name;
      chat.post(null, SYSTEM_NAME, amount > 0
        ? `🎁 Подарок ${target === 'player' ? 'для ' : ''}${who}: +${amount} фишек!`
        : `💸 Зал забрал фишки у ${who}: ${amount}`);
    }
    ok(res, { results });
  });

  router.post('/set-balance', (req, res) => {
    const p = findPlayer(req.body.playerId);
    if (!p) return fail(res, 'Игрок не найден', 404);
    const balance = req.body.balance;
    if (!Number.isSafeInteger(balance) || balance < 0 || balance > MAX_BALANCE) return fail(res, 'Баланс: целое от 0 до квадриллиона');
    store.adjust(p, balance - p.balance);
    ok(res, { balance: p.balance });
  });

  router.post('/rename', (req, res) => {
    const p = findPlayer(req.body.playerId);
    if (!p) return fail(res, 'Игрок не найден', 404);
    const old = p.name;
    const result = store.rename(p, req.body.name);
    if (result.error) return fail(res, result.error);
    refreshLists();
    if (old !== p.name) chat.post(null, SYSTEM_NAME, `${old} теперь зовут ${p.name}`);
    ok(res, { name: p.name });
  });

  // minutes: 0 = снять мут.
  router.post('/mute', (req, res) => {
    const p = findPlayer(req.body.playerId);
    if (!p) return fail(res, 'Игрок не найден', 404);
    const minutes = req.body.minutes;
    if (!Number.isSafeInteger(minutes) || minutes < 0 || minutes > MAX_MUTE_MIN) return fail(res, `Минуты: от 0 до ${MAX_MUTE_MIN}`);
    if (minutes === 0) mutes.delete(p.id);
    else {
      mutes.set(p.id, Date.now() + minutes * 60_000);
      chat.post(null, SYSTEM_NAME, `🤐 ${p.name} помолчит ${minutes} мин`);
    }
    ok(res);
  });

  // Удалить игрока: встаёт из-за стола, отключается, пропадает из списков. Фишки пропадают вместе с ним.
  router.post('/delete-player', (req, res) => {
    const p = findPlayer(req.body.playerId);
    if (!p) return fail(res, 'Игрок не найден', 404);
    if (table.isSeated(p)) table.leave(p);
    mutes.delete(p.id);
    songRequests.forget(p.id);
    pool.forget(p.id);
    if (duel) duel.forget(p.id);
    achievements.forget(p.id);
    luck.forget(p.id);
    if (mines) mines.forget(p.id);
    const result = store.remove(p);
    if (result.error) return fail(res, result.error);
    disconnectPlayer(p);
    refreshLists();
    ok(res, { name: p.name });
  });

  router.post('/reset-bonus', (req, res) => {
    const p = findPlayer(req.body.playerId);
    if (!p) return fail(res, 'Игрок не найден', 404);
    store.resetBonus(p);
    ok(res);
  });

  router.post('/kick-table', (req, res) => {
    const p = findPlayer(req.body.playerId);
    if (!p) return fail(res, 'Игрок не найден', 404);
    const result = table.leave(p);
    if (result.error) return fail(res, result.error);
    ok(res, result);
  });

  // { text, style: "banner" | "chat" }
  // Выключить зал аккуратно (как Ctrl+C): фишки из игр вернутся игрокам. Нужен пульту запуска.
  router.post('/shutdown', (req, res) => {
    ok(res);
    setTimeout(shutdown, 200);
  });

  router.post('/announce', (req, res) => {
    const text = cleanText(req.body.text);
    if (!text) return fail(res, 'Пустой текст');
    if (req.body.style === 'chat') chat.post(null, SYSTEM_NAME, text);
    else broadcast({ type: 'announce', text });
    ok(res);
  });

  // { effect, target: "all" | playerId }
  router.post('/effect', (req, res) => {
    const { effect, target = 'all' } = req.body;
    if (!EFFECTS.has(effect)) return fail(res, `Эффекты: ${[...EFFECTS].join(', ')}`);
    if (target === 'all') broadcast({ type: 'fx', effect });
    else {
      const p = findPlayer(target);
      if (!p) return fail(res, 'Игрок не найден', 404);
      sendToPlayer(p, { type: 'fx', effect });
    }
    ok(res);
  });

  router.post('/crash/rig', (req, res) => {
    const result = crash.rig(req.body.multiplier);
    if (result.error) return fail(res, result.error);
    ok(res, result);
  });

  router.post('/crash/now', (req, res) => {
    const result = crash.crashNow();
    if (result.error) return fail(res, result.error);
    ok(res, result);
  });

  // { id } — ID видео из плейлиста или "random".
  router.post('/music/play', (req, res) => {
    const result = music.play(req.body.id);
    if (result.error) return fail(res, result.error);
    ok(res, result);
  });

  router.post('/music/stop', (req, res) => ok(res, music.stop()));

  // { on } — «случайные подряд»: по окончании трека сразу следующий случайный.
  router.post('/music/autoplay', (req, res) => {
    const result = music.setAutoplay(!!req.body.on);
    if (result.error) return fail(res, result.error);
    ok(res, { autoplay: music.autoplay() });
  });

  // { id, duration } — длину трека может сообщить и админка.
  router.post('/music/duration', (req, res) => ok(res, { accepted: music.reportDuration(req.body.id, Number(req.body.duration)) }));

  // { id, trackId? } — включить заказ сразу у всех (trackId, если админ выбрал другой трек).
  router.post('/requests/approve', (req, res) => {
    const trackId = typeof req.body.trackId === 'string' && req.body.trackId ? req.body.trackId : undefined;
    const result = songRequests.approve(req.body.id, trackId);
    if (result.error) return fail(res, result.error);
    chat.post(null, SYSTEM_NAME, `🎵 Включаю заказ ${result.request.name}: ${result.track.title}`);
    ok(res, result);
  });

  router.post('/requests/reject', (req, res) => {
    const result = songRequests.reject(req.body.id);
    if (result.error) return fail(res, result.error);
    const p = findPlayer(result.request.playerId);
    if (p) sendToPlayer(p, { type: 'error', message: `Админ не стал включать «${result.request.text}»` });
    ok(res, result);
  });

  router.post('/chat/clear', (req, res) => {
    chat.clear();
    ok(res);
  });

  // Задать игроку пароль, чтобы он вошёл с новой ссылки: { playerId, password }.
  router.post('/set-password', (req, res) => {
    const p = findPlayer(req.body.playerId);
    if (!p) return fail(res, 'Игрок не найден', 404);
    const result = store.setPassword(p, req.body.password);
    if (result.error) return fail(res, result.error);
    ok(res, { name: p.name });
  });

  // Режим везения: { playerId, percent } — 1..100 включить, 0 выключить.
  router.post('/luck', (req, res) => {
    const p = findPlayer(req.body.playerId);
    if (!p) return fail(res, 'Игрок не найден', 404);
    const result = luck.set(p.id, req.body.percent);
    if (result.error) return fail(res, result.error);
    ok(res, { name: p.name, percent: luck.percentOf(p.id) });
  });

  // Закрыть неделю досрочно: итоги в зал славы, новая неделя.
  router.post('/season/end', (req, res) => {
    achievements.endSeasonNow();
    refreshLists();
    ok(res);
  });

  // { mode: 'good' | 'evil' | null } — каким будет Верити в следующий раз.
  // { mode: 'edge' | null } — следующий шарик плинко любого игрока в крайнюю лунку.
  // { mode: 'boom' | null } — следующий клик в минах любого игрока попадёт на мину.
  router.post('/mines/rig', (req, res) => {
    if (!mines) return fail(res, 'Мины не подключены');
    const mode = req.body.mode === undefined ? null : req.body.mode;
    const result = mines.rig(mode);
    if (result.error) return fail(res, result.error);
    ok(res);
  });

  router.post('/plinko/rig', (req, res) => {
    if (!plinko) return fail(res, 'Плинко не подключено');
    const mode = req.body.mode === undefined ? null : req.body.mode;
    const result = plinko.rig(mode);
    if (result.error) return fail(res, result.error);
    ok(res);
  });

  router.post('/verity/rig', (req, res) => {
    const mode = req.body.mode === undefined ? null : req.body.mode;
    const result = verity.rig(mode);
    if (result.error) return fail(res, result.error);
    ok(res);
  });

  // { mode: 'win' | 'lose' | null } — исход следующего апгрейда любого игрока.
  router.post('/upgrader/rig', (req, res) => {
    const mode = req.body.mode === undefined ? null : req.body.mode;
    const result = upgrader.rig(mode);
    if (result.error) return fail(res, result.error);
    ok(res);
  });

  // { fuse } — при каком банке рванёт (текущий раунд, если идёт, иначе следующий).
  router.post('/bomb/rig', (req, res) => {
    const result = bomb.rig(req.body.fuse);
    if (result.error) return fail(res, result.error);
    ok(res, result);
  });

  // { number: 0..36 } — номер следующего вращения.
  router.post('/roulette/rig', (req, res) => {
    const result = roulette.rig(req.body.number);
    if (result.error) return fail(res, result.error);
    ok(res, result);
  });

  // { playerId, dice: [5 чисел] } — на ближайший бросок игрока (раздача или перебросок).
  router.post('/poker/rig', (req, res) => {
    const p = findPlayer(req.body.playerId);
    if (!p) return fail(res, 'Игрок не найден', 404);
    const result = table.rigHole(p, req.body.cards);
    if (result.error) return fail(res, result.error);
    ok(res);
  });

  return router;
}

module.exports = { createAdminRouter, isLocalDirect };
