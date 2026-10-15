// Музыка в зале: админ включает трек из папки music/, у всех онлайн он играет синхронно.
// Файлы кладёт владелец зала; в git они не попадают.
const fs = require('node:fs');
const path = require('node:path');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm']);

// dir: папка с треками. onChange(track | null): разослать всем.
function createMusic({ dir, urlPrefix = '/music-files/', onChange = () => {}, now = Date.now }) {
  let current = null;  // { id, title, url, startedAt }

  // Список читаем с диска при каждом запросе: подкинул файл в папку, и он сразу в админке.
  function playlist() {
    let files;
    try {
      files = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return [];
    }
    return files
      .filter((f) => f.isFile() && AUDIO_EXT.has(path.extname(f.name).toLowerCase()))
      .map((f) => ({
        id: f.name,
        title: path.basename(f.name, path.extname(f.name)),
        url: urlPrefix + encodeURIComponent(f.name),
      }))
      .sort((a, b) => a.title.localeCompare(b.title, 'ru'));
  }

  // offset: сколько секунд трек уже играет (чтобы зашедшие позже попали в то же место).
  function state() {
    if (!current) return null;
    return { ...current, offset: Math.floor((now() - current.startedAt) / 1000) };
  }

  // id: имя файла из playlist() или "random". Чужие пути не пройдут: ищем только среди файлов папки.
  function play(id) {
    const list = playlist();
    if (!list.length) return { error: 'Папка music пустая: положи туда mp3' };
    const song = id === 'random'
      ? list[Math.floor(Math.random() * list.length)]
      : list.find((s) => s.id === id);
    if (!song) return { error: 'Такого трека нет в папке music' };
    current = { id: song.id, title: song.title, url: song.url, startedAt: now() };
    onChange(state());
    return { ok: true, track: state() };
  }

  function stop() {
    current = null;
    onChange(null);
    return { ok: true };
  }

  return { play, stop, state, playlist };
}

module.exports = { createMusic, AUDIO_EXT };
