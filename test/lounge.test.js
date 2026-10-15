const test = require('node:test');
const assert = require('node:assert/strict');
const {
  parseChord, parseProgression, walkingBar, voicing, scaleNotes, TRACKS, BASS_LO, BASS_HI,
} = require('../public/lounge');

// Детерминированный «рандом» для повторяемых тестов.
function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

test('аккорды: корень и качество', () => {
  assert.deepEqual(parseChord('F7').tones, [0, 4, 7, 10]);
  assert.equal(parseChord('Bb7').root, 10);
  assert.equal(parseChord('Ebm7').root, 3);
  assert.equal(parseChord('C#maj7').root, 1);
  assert.equal(parseChord('Am7b5').quality, 'm7b5');
  assert.throws(() => parseChord('H7'));
  assert.throws(() => parseChord('Cmaj9'));
});

test('все треки: 10-15 штук, гармония разбирается, такты по 1-2 аккорда', () => {
  assert.ok(TRACKS.length >= 10 && TRACKS.length <= 15, `треков ${TRACKS.length}`);
  assert.equal(new Set(TRACKS.map((t) => t.name)).size, TRACKS.length, 'названия разные');
  for (const t of TRACKS) {
    const bars = parseProgression(t.changes);
    assert.ok(bars.length >= 8, `${t.name}: ${bars.length} тактов`);
    assert.ok(t.bpm >= 60 && t.bpm <= 160, `${t.name}: темп ${t.bpm}`);
    assert.ok(['swing', 'shuffle', 'bossa', 'ballad'].includes(t.feel));
    assert.ok(['rhodes', 'piano', 'guitar'].includes(t.comp));
    for (const bar of bars) {
      assert.equal(bar.reduce((s, c) => s + c.beats, 0), 4, `${t.name}: такт не на 4 доли`);
    }
  }
});

test('шагающий бас: в диапазоне, корень на сильной доле, подход к следующему корню', () => {
  const rnd = seeded(7);
  for (const t of TRACKS) {
    const bars = parseProgression(t.changes);
    let last = 36;
    for (let i = 0; i < bars.length * 3; i++) {
      const bar = bars[i % bars.length];
      const next = bars[(i + 1) % bars.length];
      const notes = walkingBar(bar, next, last, rnd);
      assert.equal(notes.length, 4);
      for (const n of notes) assert.ok(n.midi >= BASS_LO && n.midi <= BASS_HI, `${t.name}: бас ${n.midi}`);
      assert.equal(((notes[0].midi - bar[0].chord.root) % 12 + 12) % 12, 0, `${t.name}: на «раз» корень`);
      if (bar.length === 1) {
        const dist = ((notes[3].midi - next[0].chord.root) % 12 + 12) % 12;
        assert.ok(dist === 1 || dist === 11, `${t.name}: подход на полтона, а не ${dist}`);
      }
      for (let k = 1; k < 4; k++) assert.ok(Math.abs(notes[k].midi - notes[k - 1].midi) <= 12, 'без диких скачков');
      last = notes[3].midi;
    }
  }
});

test('раскладки аккордов: в средней части клавиатуры, из нот аккорда', () => {
  for (const t of TRACKS) {
    for (const bar of parseProgression(t.changes)) {
      for (const { chord } of bar) {
        const v = voicing(chord);
        assert.ok(v.length >= 3);
        for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1], 'по возрастанию');
        assert.ok(v[0] >= 52 && v.at(-1) <= 80, `${chord.sym}: ${v}`);
        // все ноты из аккорда или нона
        for (const n of v) {
          const rel = ((n - chord.root) % 12 + 12) % 12;
          assert.ok(chord.tones.includes(rel) || rel === 2, `${chord.sym}: лишняя нота ${rel}`);
        }
      }
    }
  }
});

test('лад для соло: ноты в диапазоне и в ладу', () => {
  const c = parseChord('Dm7');
  const notes = scaleNotes(c, 62, 84);
  assert.ok(notes.length > 10);
  for (const n of notes) assert.ok(c.scale.includes(((n - 2) % 12 + 12) % 12));
});
