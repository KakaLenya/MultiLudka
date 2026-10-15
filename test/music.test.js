const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createMusic } = require('../server/music');

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
