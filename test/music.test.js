const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMusic, sniffAudioType } = require('../server/music');

function musicDir(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-music-'));
  for (const f of files) fs.writeFileSync(path.join(dir, f), 'x');
  return dir;
}

test('плейлист: только аудио, по алфавиту, имя без расширения', () => {
  const dir = musicDir(['Чика.mp3', 'Зацепила.MP3', 'обложка.jpg', 'notes.txt', 'Алкоголичка.m4a']);
  fs.mkdirSync(path.join(dir, 'папка.mp3'));
  const list = createMusic({ dir }).playlist();
  assert.deepEqual(list.map((s) => s.title), ['Алкоголичка', 'Зацепила', 'Чика']);
  assert.equal(list[1].url, `/music-files/${encodeURIComponent('Зацепила.MP3')}`);
});

test('нет папки: пустой список и понятная ошибка', () => {
  const m = createMusic({ dir: path.join(os.tmpdir(), 'нет-такой-папки-123') });
  assert.deepEqual(m.playlist(), []);
  assert.match(m.play('random').error, /пустая/);
});

test('play, смещение для зашедших позже, stop; чужие пути не принимаются', () => {
  let t = 1000;
  const events = [];
  const m = createMusic({ dir: musicDir(['Зацепила.mp3']), now: () => t, onChange: (x) => events.push(x) });
  assert.ok(m.play('../../data/players.json').error);
  assert.ok(m.play('нет такого.mp3').error);
  assert.equal(m.state(), null);
  m.play('Зацепила.mp3');
  assert.equal(events.at(-1).title, 'Зацепила');
  assert.equal(events.at(-1).offset, 0);
  t += 65_000;
  assert.equal(m.state().offset, 65, 'зашедший через минуту начнёт с 1:05');
  m.stop();
  assert.equal(events.at(-1), null);
});

test('тип аудио по содержимому, а не по расширению', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-sniff-'));
  const put = (name, bytes) => { const p = path.join(dir, name); fs.writeFileSync(p, Buffer.from(bytes)); return p; };
  assert.equal(sniffAudioType(put('m4a под видом.mp3', [0, 0, 0, 0x1c, ...Buffer.from('ftypisom')])), 'audio/mp4');
  assert.equal(sniffAudioType(put('id3.mp3', [...Buffer.from('ID3'), 4, 0, 0, 0, 0, 0, 0, 0, 0])), 'audio/mpeg');
  assert.equal(sniffAudioType(put('raw.mp3', [0xff, 0xfb, 0x90, 0x64, 0, 0, 0, 0, 0, 0, 0, 0])), 'audio/mpeg');
  assert.equal(sniffAudioType(put('a.ogg', [...Buffer.from('OggS'), 0, 0, 0, 0, 0, 0, 0, 0])), 'audio/ogg');
  assert.equal(sniffAudioType(put('мусор.mp3', [1, 2, 3])), null);
  assert.equal(sniffAudioType(path.join(dir, 'нет файла.mp3')), null);
});

test('после перезапуска трек продолжается с того же места', () => {
  let t = 100_000;
  const dir = musicDir(['Чика.mp3']);
  const m1 = createMusic({ dir, now: () => t });
  m1.play('Чика.mp3');
  const saved = { id: m1.state().id, startedAt: m1.state().startedAt };
  t += 30_000;
  const m2 = createMusic({ dir, now: () => t });
  assert.equal(m2.restore(saved), true);
  assert.equal(m2.state().offset, 30);
  assert.equal(createMusic({ dir, now: () => t }).restore({ id: 'удалён.mp3', startedAt: 0 }), false);
  assert.equal(createMusic({ dir, now: () => t }).restore(null), false);
});
