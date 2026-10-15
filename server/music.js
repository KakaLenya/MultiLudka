// Музыка в зале: админ включает трек из папки music/, у всех онлайн он играет синхронно.
// Файлы кладёт владелец зала; в git они не попадают.
const fs = require('node:fs');
const path = require('node:path');

const AUDIO_EXT = new Set(['.mp3', '.m4a', '.aac', '.ogg', '.oga', '.opus', '.wav', '.flac', '.webm']);

// Настоящий тип аудио по первым байтам: файлы часто бывают m4a под именем .mp3,
// а строгие браузеры (Safari, Firefox) не играют их с заголовком audio/mpeg.
function sniffAudioType(file) {
  let fd;
  try {
    fd = fs.openSync(file, 'r');
    const b = Buffer.alloc(12);
    fs.readSync(fd, b, 0, 12, 0);
    const at = (start, end) => b.toString('latin1', start, end);
    if (at(4, 8) === 'ftyp') return 'audio/mp4';
    if (at(0, 4) === 'OggS') return 'audio/ogg';
    if (at(0, 4) === 'RIFF') return 'audio/wav';
    if (at(0, 4) === 'fLaC') return 'audio/flac';
    if (at(0, 3) === 'ID3' || (b[0] === 0xff && (b[1] & 0xe0) === 0xe0)) return 'audio/mpeg';
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

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

  // После перезапуска сервера: продолжить трек с того же места, если файл ещё на месте.
  function restore(saved) {
    if (!saved || typeof saved.id !== 'string' || !Number.isFinite(saved.startedAt)) return false;
    const song = playlist().find((s) => s.id === saved.id);
    if (!song) return false;
    current = { id: song.id, title: song.title, url: song.url, startedAt: saved.startedAt };
    return true;
  }

  return { play, stop, state, playlist, restore };
}

module.exports = { createMusic, sniffAudioType, AUDIO_EXT };
