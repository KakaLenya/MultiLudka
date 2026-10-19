const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const {
  parseChord, parseProgression, parseMelody, noteMidi, walkingBar, voicing, chordAt, bluesSolo, formPlan, trackMelody,
  TRACKS, TICKS, LEAD_RANGE, BASS_LO, BASS_HI,
} = require('../public/lounge');

function seeded(seed) {
  let s = seed;
  return () => {
    s = (s * 1103515245 + 12345) % 2 ** 31;
    return s / 2 ** 31;
  };
}

// Какие ноты красиво звучат на сильной доле над аккордом (полутоны от корня):
// звуки аккорда и надстройки; над доминантой — и блюзовые #9, b9, b13.
const GOOD_ON_BEAT = {
  7: [0, 1, 2, 3, 4, 7, 8, 9, 10],
  m7: [0, 2, 3, 5, 7, 9, 10],
  maj7: [0, 2, 4, 7, 9, 11],
  6: [0, 2, 4, 7, 9],
  m6: [0, 2, 3, 5, 7, 9],
  m7b5: [0, 3, 5, 6, 8, 10],
  dim7: [0, 2, 3, 5, 6, 8, 9, 11],
};

test('аккорды и ноты разбираются', () => {
  assert.deepEqual(parseChord('F7').tones, [0, 4, 7, 10]);
  assert.equal(parseChord('Bb7').root, 10);
  assert.equal(parseChord('Am7b5').quality, 'm7b5');
  assert.throws(() => parseChord('H7'));
  assert.equal(noteMidi('C4'), 60);
  assert.equal(noteMidi('Bb3'), 58);
  assert.equal(noteMidi('F#4'), 66);
  assert.throws(() => parseMelody('C4:3 D4:3', 8), /Такт 1/);
});

test('треки: 10-15, у каждого тема ровно на всю гармонию, инструменты известны', () => {
  assert.ok(TRACKS.length >= 10 && TRACKS.length <= 15);
  assert.equal(new Set(TRACKS.map((t) => t.name)).size, TRACKS.length);
  for (const t of TRACKS) {
    const bars = parseProgression(t.changes);
    assert.ok(bars.length >= 8, t.name);
    assert.ok(t.bpm >= 50 && t.bpm <= 160, `${t.name}: темп`);
    assert.ok(TICKS[t.feel], `${t.name}: грув ${t.feel}`);
    assert.ok(['epiano', 'piano', 'jazzguitar', 'nylon'].includes(t.comp), `${t.name}: аккомпанемент`);
    assert.ok(LEAD_RANGE[t.lead], `${t.name}: солист`);
    assert.equal(trackMelody(t).bars.length, bars.length, `${t.name}: тема на ${bars.length} тактов`);
    if (t.form === 'blues') assert.equal(bars.length, 12, `${t.name}: блюз — 12 тактов`);
  }
});

test('тема ложится на гармонию: на сильных долях — звуки аккорда и надстройки', () => {
  const problems = [];
  for (const t of TRACKS) {
    const bars = parseProgression(t.changes);
    const perBar = TICKS[t.feel];
    const perBeat = perBar / 4;
    trackMelody(t).bars.forEach((notes, i) => {
      for (const n of notes) {
        if (n.tick % perBeat !== 0) continue;   // слабые доли — проходящие, им можно всё
        const { chord } = chordAt(bars[i], n.tick / perBeat);
        const rel = ((n.midi - chord.root) % 12 + 12) % 12;
        if (!GOOD_ON_BEAT[chord.quality].includes(rel)) problems.push(`${t.name}, такт ${i + 1}: ${n.midi} над ${chord.sym} (${rel})`);
      }
    });
  }
  assert.deepEqual(problems, []);
});

test('тема в диапазоне солиста', () => {
  for (const t of TRACKS) {
    const [lo, hi] = LEAD_RANGE[t.lead];
    for (const bar of trackMelody(t).bars) for (const n of bar) assert.ok(n.midi >= lo && n.midi <= hi, `${t.name}: ${n.midi} вне ${lo}-${hi}`);
  }
});

test('блюзовое соло: фразы в диапазоне, в своих тактах, на тонике блюза', () => {
  for (const t of TRACKS.filter((x) => x.form === 'blues')) {
    const [lo, hi] = LEAD_RANGE[t.lead];
    const perBar = TICKS[t.feel];
    for (let chorus = 0; chorus < 4; chorus++) {
      const notes = bluesSolo(t, chorus);
      assert.ok(notes.length > 15, `${t.name}: в соло ${notes.length} нот`);
      for (const n of notes) {
        assert.ok(n.midi >= lo && n.midi <= hi, `${t.name}: ${n.midi}`);
        assert.ok(n.bar >= 0 && n.bar < 12 && n.tick >= 0 && n.tick < perBar && n.len >= 1);
        if (t.minor) {
          const third = ((n.midi - parseChord(`${t.key}m7`).root) % 12 + 12) % 12;
          assert.notEqual(third, 4, `${t.name}: в минорном блюзе нет большой терции`);
        }
      }
    }
  }
});

test('форма: тема в начале и в конце, трек около трёх минут', () => {
  for (const t of TRACKS) {
    const plan = formPlan(t);
    assert.equal(plan[0], 'head');
    assert.equal(plan.at(-1), 'head');
    const seconds = (plan.length * parseProgression(t.changes).length * 4 * 60) / t.bpm;
    assert.ok(seconds > 100 && seconds < 280, `${t.name}: ${Math.round(seconds)} с`);
  }
});

test('шагающий бас: в диапазоне, корень на «раз», подход к следующему корню', () => {
  const rnd = seeded(7);
  for (const t of TRACKS) {
    const bars = parseProgression(t.changes);
    let last = 36;
    for (let i = 0; i < bars.length * 3; i++) {
      const bar = bars[i % bars.length];
      const next = bars[(i + 1) % bars.length];
      const notes = walkingBar(bar, next, last, rnd);
      for (const n of notes) assert.ok(n.midi >= BASS_LO && n.midi <= BASS_HI);
      assert.equal(((notes[0].midi - bar[0].chord.root) % 12 + 12) % 12, 0);
      if (bar.length === 1) {
        const dist = ((notes[3].midi - next[0].chord.root) % 12 + 12) % 12;
        assert.ok(dist === 1 || dist === 11);
      }
      last = notes[3].midi;
    }
  }
});

test('раскладки аккордов: по возрастанию, из нот аккорда и ноны', () => {
  for (const t of TRACKS) {
    for (const bar of parseProgression(t.changes)) {
      for (const { chord } of bar) {
        const v = voicing(chord);
        for (let i = 1; i < v.length; i++) assert.ok(v[i] > v[i - 1]);
        for (const n of v) {
          const rel = ((n - chord.root) % 12 + 12) % 12;
          assert.ok(chord.tones.includes(rel) || rel === 2, `${chord.sym}: ${rel}`);
        }
      }
    }
  }
});

test('сэмплы на месте: на каждый инструмент — ноты через малую терцию, есть авторы и лицензии', () => {
  const dir = path.join(__dirname, '..', 'public', 'samples');
  for (const inst of ['bass', 'epiano', 'sax', 'vibes', 'jazzguitar', 'trumpet', 'nylon', 'piano']) {
    const files = fs.readdirSync(path.join(dir, inst)).filter((f) => f.endsWith('.mp3'));
    assert.ok(files.length >= 13, `${inst}: ${files.length} сэмплов`);
  }
  assert.match(fs.readFileSync(path.join(dir, 'CREDITS.md'), 'utf8'), /CC BY/);
});
