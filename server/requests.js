// Заказы песен: игрок просит, админ подтверждает, трек сразу играет у всех.

const MAX_TEXT = 80;
const MAX_PENDING = 30;
const COOLDOWN_MS = 20_000;

// Кириллица в латиницу и одинаковые варианты записи ("ya"/"ja", "kh"/"h"),
// чтобы «Запутался» нашёл файл «Arthur Pirozhkov Zaputalsja».
const TRANSLIT = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'e', ж: 'zh', з: 'z', и: 'i', й: 'j', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'h', ц: 'c',
  ч: 'ch', ш: 'sh', щ: 'sch', ъ: '', ы: 'y', ь: '', э: 'e', ю: 'ju', я: 'ja',
};

function normalize(text) {
  return String(text)
    .toLowerCase()
    .replace(/[а-яё]/g, (ch) => TRANSLIT[ch] ?? ch)
    .replace(/kh/g, 'h')
    .replace(/ts/g, 'c')
    .replace(/y([aeou])/g, 'j$1')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

// Слова, которые есть почти в каждом названии: на выбор трека почти не влияют.
const COMMON = new Set(['artur', 'arthur', 'pirozhkov', 'pirozhkova', 'pesnja', 'pesnju', 'vkljuchi', 'postav', 'mp3']);

// Лучший трек из playlist для текста игрока, или null.
function bestMatch(text, playlist) {
  const words = normalize(text).split(' ').filter((w) => w.length >= 3);
  if (!words.length) return null;
  let best = null;
  let bestScore = 0;
  for (const song of playlist) {
    const title = normalize(song.title).replace(/ /g, '');
    let score = 0;
    let meaningful = false;
    for (const w of words) {
      // Целиком или хотя бы начало слова (окончания часто путают: «зацепил», «чику»).
      const hit = title.includes(w) || (w.length >= 5 && title.includes(w.slice(0, w.length - 2)));
      if (!hit) continue;
      if (COMMON.has(w)) score += 1;
      else {
        score += w.length;
        meaningful = true;
      }
    }
    if (meaningful && score > bestScore) {
      best = song;
      bestScore = score;
    }
  }
  return best;
}

function cleanText(raw) {
  if (typeof raw !== 'string') return null;
  const text = raw.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
  return text || null;
}

// playlist(): текущие треки ({ id, title }). play(id): включить трек у всех.
function createSongRequests({ playlist, play, now = Date.now }) {
  let pending = [];           // [{ id, playerId, name, text, trackId, at }]
  const lastAt = new Map();   // playerId -> время последнего заказа
  let seq = 0;

  // text: что написал игрок; trackId: если выбрал из списка.
  function request(player, { text, trackId } = {}) {
    if (pending.some((r) => r.playerId === player.id)) return { error: 'Твой заказ уже ждёт, дождись ответа' };
    const last = lastAt.get(player.id);
    const wait = last === undefined ? 0 : last + COOLDOWN_MS - now();
    if (wait > 0) return { error: `Следующий заказ через ${Math.ceil(wait / 1000)} с` };
    if (pending.length >= MAX_PENDING) return { error: 'Слишком много заказов, подожди' };

    const list = playlist();
    let track = null;
    let cleaned = cleanText(text);
    if (trackId !== undefined && trackId !== null) {
      track = list.find((s) => s.id === trackId) || null;
      if (!track) return { error: 'Такого трека нет' };
      cleaned = cleaned || track.title;
    } else {
      if (!cleaned) return { error: 'Напиши, какую песню включить' };
      track = bestMatch(cleaned, list);
    }

    const req = { id: String(++seq), playerId: player.id, name: player.name, text: cleaned, trackId: track ? track.id : null, at: now() };
    pending.push(req);
    lastAt.set(player.id, now());
    return { ok: true, request: req, track };
  }

  // Для админки: с актуальными названиями (файлы могли добавить или переименовать).
  function list() {
    const songs = playlist();
    return pending.map((r) => {
      const track = songs.find((s) => s.id === r.trackId) || bestMatch(r.text, songs);
      return { ...r, trackId: track ? track.id : null, trackTitle: track ? track.title : null };
    });
  }

  // trackId: если админ выбрал другой трек, иначе найденный.
  function approve(id, trackId) {
    const req = list().find((r) => r.id === String(id));
    if (!req) return { error: 'Заказ не найден' };
    const chosen = trackId || req.trackId;
    if (!chosen) return { error: 'Для заказа не нашёлся трек: выбери его вручную' };
    const result = play(chosen);
    if (result.error) return result;
    pending = pending.filter((r) => r.id !== req.id);
    return { ok: true, request: req, track: result.track };
  }

  function reject(id) {
    const req = pending.find((r) => r.id === String(id));
    if (!req) return { error: 'Заказ не найден' };
    pending = pending.filter((r) => r.id !== req.id);
    return { ok: true, request: req };
  }

  // Игрока удалили: его заказы тоже.
  function forget(playerId) {
    pending = pending.filter((r) => r.playerId !== playerId);
    lastAt.delete(playerId);
  }

  return { request, list, approve, reject, forget };
}

module.exports = { createSongRequests, bestMatch, normalize, COOLDOWN_MS };
