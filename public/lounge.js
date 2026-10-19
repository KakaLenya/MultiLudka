// Фоновая музыка зала: джаз и блюз на живых сэмплах (рояль Salamander, Musyng Kite — см. samples/CREDITS.md).
// У каждого трека написанная тема (мелодия по нотам под гармонию) и форма, как у джазового стандарта:
// тема, тема, соло, тема. Соло в блюзах собирается из блюзовых фраз «вопрос — ответ», в песнях
// тему во втором проходе играет аккомпанирующий инструмент. Ритм-секция: шагающий контрабас,
// аккорды по устойчивым ритмическим фигурам, щётки и райд (синтез).
//
// В браузере: window.Lounge. В Node (тесты): module.exports с теорией и партитурами.
(function (root) {
  'use strict';

  // ---------- Теория ----------

  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const QUALITIES = {
    maj7: [0, 4, 7, 11],
    6: [0, 4, 7, 9],
    m7: [0, 3, 7, 10],
    m6: [0, 3, 7, 9],
    7: [0, 4, 7, 10],
    m7b5: [0, 3, 6, 10],
    dim7: [0, 3, 6, 9],
  };
  const SCALES = {
    maj7: [0, 2, 4, 7, 9, 11],
    6: [0, 2, 4, 7, 9],
    m7: [0, 2, 3, 5, 7, 9, 10],
    m6: [0, 2, 3, 5, 7, 9],
    7: [0, 2, 3, 4, 7, 9, 10],
    m7b5: [0, 3, 5, 6, 8, 10],
    dim7: [0, 2, 3, 5, 6, 8, 9, 11],
  };

  function parseChord(sym) {
    const m = /^([A-G])([b#]?)(maj7|m7b5|dim7|m7|m6|6|7)$/.exec(sym);
    if (!m) throw new Error(`Непонятный аккорд: ${sym}`);
    const root = (NOTE[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0) + 12) % 12;
    return { sym, root, quality: m[3], tones: QUALITIES[m[3]], scale: SCALES[m[3]] };
  }

  // "F7 | Bb7 | Cm7 F7" -> по такту: [{ chord, beat, beats }]
  function parseProgression(text) {
    return text.split('|').map((bar) => {
      const syms = bar.trim().split(/\s+/).filter(Boolean);
      if (!syms.length || 4 % syms.length !== 0) throw new Error(`Такт «${bar}»: 1, 2 или 4 аккорда`);
      const beats = 4 / syms.length;
      return syms.map((s, i) => ({ chord: parseChord(s), beat: i * beats, beats }));
    });
  }

  const chordAt = (bar, beat) => bar.filter((c) => c.beat <= beat).pop();

  function noteMidi(s) {
    const m = /^([A-G])([b#]?)(\d)$/.exec(s);
    if (!m) throw new Error(`Непонятная нота: ${s}`);
    return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
  }

  // Мелодия: «нота:длина» через пробел, такты через «|». Длина — в долях такта (тиках):
  // 8 на такт в 4/4 (восьмые), 12 в 12/8 (восьмые триоли). «r» — пауза.
  // -> { bars: [[{ tick, midi, len }]], ticks } — нота живёт в такте, где началась.
  function parseMelody(text, ticksPerBar) {
    const bars = text.split('|').map((b) => b.trim()).filter(Boolean);
    const out = [];
    bars.forEach((bar, i) => {
      let tick = 0;
      const notes = [];
      for (const tok of bar.split(/\s+/)) {
        const [n, l] = tok.split(':');
        const len = Number(l);
        if (!(len > 0)) throw new Error(`Такт ${i + 1}: длина у «${tok}»`);
        if (n !== 'r') notes.push({ tick, midi: noteMidi(n), len });
        tick += len;
      }
      if (tick !== ticksPerBar) throw new Error(`Такт ${i + 1} мелодии: ${tick} вместо ${ticksPerBar}`);
      out.push(notes);
    });
    return { bars: out, ticks: out.length * ticksPerBar };
  }

  // Высота с нужным классом высоты, ближайшая к target.
  function nearest(pc, target) {
    let n = target - ((target - pc) % 12 + 12) % 12;
    if (target - n > 6) n += 12;
    return n;
  }
  function fold(n, lo, hi) {
    while (n < lo) n += 12;
    while (n > hi) n -= 12;
    return n;
  }

  const BASS_LO = 28;  // E1
  const BASS_HI = 50;  // D3

  // Шагающий бас на такт: корень на «раз», аккордовые ноты, на 4-ю долю — подход к следующему корню.
  function walkingBar(bar, nextBar, prev, rnd) {
    const notes = [];
    let last = prev;
    for (let beat = 0; beat < 4; beat++) {
      const c = chordAt(bar, beat).chord;
      let n;
      if (beat === chordAt(bar, beat).beat) {
        n = nearest(c.root, last);
      } else if (beat === 3) {
        const target = nearest(chordAt(nextBar, 0).chord.root, last);
        n = target + (rnd() < 0.5 ? 1 : -1);
      } else {
        const tone = c.tones[1 + Math.floor(rnd() * 3)];
        n = nearest((c.root + tone) % 12, last + (rnd() < 0.5 ? 2 : -2));
      }
      n = fold(n, BASS_LO, BASS_HI);
      notes.push({ beat, midi: n, dur: 0.95 });
      last = n;
    }
    return notes;
  }

  // Безкорневая раскладка: терция, септима, нона (и квинта) в середине клавиатуры.
  function voicing(chord, lo = 52) {
    const want = chord.quality === 'm7b5' || chord.quality === 'dim7'
      ? [chord.tones[1], chord.tones[2], chord.tones[3]]
      : [chord.tones[1], chord.tones[3], 14, chord.tones[2]];
    const out = [];
    let floor = lo;
    for (const t of want) {
      let n = lo + (((chord.root + t) - lo) % 12 + 12) % 12;
      while (n < floor) n += 12;
      out.push(n);
      floor = n + 1;
    }
    return out;
  }

  function scaleNotes(chord, lo, hi) {
    const out = [];
    for (let n = lo; n <= hi; n++) if (chord.scale.includes(((n - chord.root) % 12 + 12) % 12)) out.push(n);
    return out;
  }

  // ---------- Блюзовые фразы для соло ----------
  // В восьмых 4/4 (8 на такт), ступени — в полутонах от тоники блюза: [тик, ступень, длина].
  // Над всем блюзом звучит блюзовый лад тоники: малая терция к большой, пониженная квинта, малая септима.
  const LICKS = {
    call: [
      [[1, 7, 1], [2, 10, 1], [3, 12, 1], [4, 10, 2], [6, 7, 1], [7, 3, 1], [8, 4, 2], [10, 0, 4]],
      [[0, 3, 1], [1, 4, 1], [2, 7, 2], [4, 9, 2], [6, 7, 1], [7, 4, 1], [8, 3, 1], [9, 0, 1], [10, -2, 1], [11, 0, 3]],
      [[0, 12, 2], [2, 10, 1], [3, 7, 1], [4, 6, 1], [5, 5, 1], [6, 3, 2], [8, 0, 1], [9, 3, 1], [10, 0, 4]],
      [[2, 7, 1], [3, 9, 1], [4, 10, 2], [6, 9, 1], [7, 7, 1], [8, 10, 1], [9, 9, 1], [10, 7, 1], [11, 4, 1], [12, 7, 3]],
      [[0, 3, 1], [1, 4, 3], [4, 3, 1], [5, 4, 3], [8, 7, 2], [10, 4, 1], [11, 0, 3]],
    ],
    answer: [
      [[3, 7, 1], [4, 10, 1], [5, 7, 1], [6, 0, 2]],
      [[2, 12, 1], [3, 10, 1], [4, 7, 4]],
      [[4, 3, 1], [5, 4, 1], [6, 0, 2]],
      [[3, 5, 1], [4, 6, 1], [5, 7, 3]],
    ],
    // Конец квадрата: спуск по блюзовому ладу и подход через доминанту.
    ending: [
      [[0, 12, 1], [1, 10, 1], [2, 7, 1], [3, 6, 1], [4, 5, 1], [5, 3, 1], [6, 0, 2], [10, -5, 2], [12, -1, 2], [14, 2, 2]],
      [[1, 7, 1], [2, 6, 1], [3, 5, 1], [4, 3, 1], [5, 0, 3], [10, 2, 1], [11, 4, 1], [12, 7, 4]],
    ],
  };

  // ---------- Партитуры ----------
  // feel: swing | shuffle | slow (12/8) | ballad | bossa.
  // form: blues — 12-тактовый блюз (key — тоника, minor — минорный), song — песня.
  // comp: epiano | piano | jazzguitar | nylon. lead: sax | trumpet | vibes | piano | jazzguitar | epiano.
  const TRACKS = [
    {
      name: 'Зелёное сукно', bpm: 126, feel: 'swing', form: 'blues', key: 'F', comp: 'epiano', lead: 'sax',
      changes: 'F7 | Bb7 | F7 | F7 | Bb7 | Bb7 | F7 | D7 | Gm7 | C7 | F7 D7 | Gm7 C7',
      head: `r:1 F4:1 Ab4:1 A4:1 C5:2 A4:1 F4:1 | Ab4:2 G4:1 F4:1 D4:2 r:2 |
             r:1 F4:1 Ab4:1 A4:1 C5:2 A4:1 F4:1 | Eb5:2 C5:1 A4:1 C5:4 |
             r:1 Bb4:1 Db5:1 D5:1 F5:2 D5:1 Bb4:1 | Db5:2 C5:1 Bb4:1 G4:2 r:2 |
             r:1 F4:1 Ab4:1 A4:1 C5:2 A4:1 F4:1 | C5:2 A4:1 F#4:1 A4:4 |
             r:1 G4:1 Bb4:1 D5:1 F5:2 D5:2 | E5:2 C5:1 Bb4:1 G4:2 E4:2 |
             F4:2 A4:2 C5:2 F#4:2 | G4:1 Bb4:1 D5:2 E5:1 D5:1 C5:1 Bb4:1`,
    },
    {
      name: 'Полночный шаффл', bpm: 56, feel: 'slow', form: 'blues', key: 'Bb', comp: 'epiano', lead: 'jazzguitar',
      changes: 'Bb7 | Eb7 | Bb7 | Bb7 | Eb7 | Eb7 | Bb7 | G7 | Cm7 | F7 | Bb7 G7 | Cm7 F7',
      head: `r:3 F4:2 Ab4:1 Bb4:3 Db5:1 D5:2 | Db5:6 Bb4:3 G4:3 |
             r:3 Bb4:2 Db5:1 D5:3 F5:3 | Ab4:3 F4:3 D4:6 |
             r:3 Bb4:2 Db5:1 Eb5:3 Gb5:1 G5:2 | F5:3 Eb5:3 Db5:6 |
             r:3 F4:2 Ab4:1 Bb4:6 | B4:3 D5:3 F5:6 |
             Eb5:6 C5:3 G4:3 | A4:3 C5:3 Eb5:6 |
             D5:3 Bb4:3 B4:3 F4:3 | Eb4:3 G4:3 A4:3 C5:3`,
    },
    {
      name: 'Последняя ставка', bpm: 66, feel: 'ballad', form: 'song', comp: 'epiano', lead: 'piano',
      changes: 'Ebmaj7 | Cm7 | Fm7 | Bb7 | Gm7 | C7 | Fm7 | Bb7 | Abmaj7 | Abm7 Db7 | Ebmaj7 Cm7 | Fm7 Bb7',
      head: `G5:4 F5:2 Eb5:2 | G5:2 Bb5:2 G5:4 | Ab5:4 G5:2 F5:2 | D5:6 r:2 |
             Bb5:4 A5:2 G5:2 | E5:2 G5:2 Bb5:4 | Ab5:4 C6:2 Ab5:2 | G5:4 F5:4 |
             Eb5:2 G5:2 C6:4 | B5:2 Ab5:2 F5:2 Eb5:2 | G5:4 Eb5:4 | F5:2 Ab5:2 D5:4`,
    },
    {
      name: 'Бархатный покер', bpm: 128, feel: 'bossa', form: 'song', comp: 'nylon', lead: 'vibes',
      changes: 'Fmaj7 | Fmaj7 | Gm7 | C7 | Am7 | D7 | Gm7 | C7 | Fmaj7 | Bbmaj7 | Em7b5 | A7 | Dm7 | G7 | Gm7 | C7',
      head: `A5:6 G5:2 | E5:4 r:2 F5:1 G5:1 | A5:3 Bb5:1 A5:4 | G5:4 r:2 E5:1 F5:1 |
             G5:3 E5:1 C5:4 | F#5:4 r:2 A5:2 | Bb5:3 A5:1 G5:2 F5:2 | E5:6 r:2 |
             A5:6 C6:2 | A5:4 F5:2 D5:2 | G5:3 Bb5:1 G5:4 | C#5:4 r:2 E5:2 |
             F5:3 A5:1 C6:4 | B5:4 r:2 A5:1 G5:1 | Bb5:3 A5:1 G5:2 E5:2 | G5:2 E5:2 r:4`,
    },
    {
      name: 'Дым над рулеткой', bpm: 116, feel: 'swing', form: 'blues', key: 'C', minor: true, comp: 'piano', lead: 'vibes',
      changes: 'Cm7 | Fm7 | Cm7 | Cm7 | Fm7 | Fm7 | Cm7 | Cm7 | Ab7 | G7 | Cm7 G7 | Cm7 G7',
      head: `G4:2 Bb4:1 C5:1 Eb5:2 C5:2 | Ab5:2 F5:1 Eb5:1 C5:4 |
             G4:2 Bb4:1 C5:1 Eb5:2 F5:1 F#5:1 | G5:4 Eb5:2 C5:2 |
             C5:2 Eb5:1 F5:1 Ab5:2 F5:2 | Eb5:2 C5:2 Ab4:4 |
             G4:2 Bb4:1 C5:1 Eb5:2 C5:2 | Bb4:2 G4:2 r:4 |
             Gb5:2 Eb5:1 C5:1 Ab4:4 | F5:2 D5:1 B4:1 G4:4 |
             C5:2 Eb5:2 D5:2 B4:2 | C5:4 r:2 G4:2`,
    },
    {
      name: 'Шаффл крупье', bpm: 96, feel: 'shuffle', form: 'blues', key: 'G', comp: 'epiano', lead: 'piano',
      changes: 'G7 | C7 | G7 | G7 | C7 | C7 | G7 | E7 | Am7 | D7 | G7 E7 | Am7 D7',
      head: `D5:1 F5:1 G5:2 Bb5:1 B5:1 G5:2 | Bb5:2 G5:1 E5:1 C5:2 r:2 |
             D5:1 F5:1 G5:2 Bb5:1 B5:1 G5:2 | F5:2 D5:1 B4:1 G4:4 |
             G5:1 Bb5:1 C6:2 Eb6:1 E6:1 C6:2 | Bb5:2 G5:1 E5:1 C5:2 r:2 |
             D5:1 F5:1 G5:2 Bb5:1 B5:1 G5:2 | D5:2 B4:1 G#4:1 B4:4 |
             C5:2 E5:1 G5:1 A5:2 G5:2 | F#5:2 A5:1 C6:1 A5:2 F#5:2 |
             G5:2 D5:2 D5:2 G#4:2 | A4:2 C5:2 C5:1 B4:1 A4:2`,
    },
    {
      name: 'Тихий джекпот', bpm: 62, feel: 'ballad', form: 'song', comp: 'epiano', lead: 'vibes',
      changes: 'Cmaj7 Am7 | Dm7 G7 | Em7 A7 | Dm7 G7 | Cmaj7 C7 | Fmaj7 Fm7 | Em7 A7 | Dm7 G7',
      head: `E5:4 C5:2 B4:2 | A4:2 C5:2 B4:4 | G5:4 E5:2 C#5:2 | D5:2 F5:2 E5:4 |
             G5:2 E5:2 Bb5:2 G5:2 | A5:4 Ab5:4 | G5:2 E5:2 C#5:4 | D5:2 F5:2 E5:4`,
    },
    {
      name: 'Утро после смены', bpm: 54, feel: 'slow', form: 'blues', key: 'A', minor: true, comp: 'piano', lead: 'epiano',
      changes: 'Am7 | Dm7 | Am7 | Am7 | Dm7 | Dm7 | Am7 | Am7 | F7 | E7 | Am7 E7 | Am7 E7',
      head: `r:3 E4:2 G4:1 A4:3 C5:3 | F5:6 D5:3 C5:3 |
             r:3 A4:2 C5:1 D5:1 Eb5:1 E5:4 | G5:3 E5:3 C5:6 |
             r:3 D5:2 F5:1 A5:3 G5:3 | F5:3 E5:3 D5:6 |
             r:3 E4:2 G4:1 A4:3 C5:3 | B4:6 A4:6 |
             Eb5:6 C5:3 A4:3 | D5:6 B4:3 G#4:3 |
             A4:3 C5:3 B4:3 G#4:3 | A4:6 r:3 E4:3`,
    },
    {
      name: 'Лаундж у бара', bpm: 124, feel: 'bossa', form: 'song', comp: 'nylon', lead: 'sax',
      changes: 'Am7 | Am7 | Dm7 | Dm7 | Bm7b5 | E7 | Am7 | Am7 | Dm7 | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7 | Am7 | E7',
      head: `E5:6 C5:2 | B4:4 A4:2 G4:2 | A4:6 F4:2 | E4:4 D4:2 E4:2 |
             F4:3 A4:1 D5:4 | C5:2 B4:2 G#4:4 | A4:6 E4:2 | C5:4 r:4 |
             F5:6 E5:2 | D5:4 B4:2 G4:2 | E5:6 D5:2 | C5:4 A4:4 |
             D5:3 F5:1 D5:4 | B4:4 G#4:4 | A4:6 C5:2 | B4:4 r:4`,
    },
    {
      name: 'Огни Вегаса', bpm: 132, feel: 'swing', form: 'song', comp: 'piano', lead: 'trumpet',
      changes: 'Bbmaj7 | G7 | Cm7 | F7 | Dm7 | G7 | Cm7 | F7 | Ebmaj7 | Edim7 | Bbmaj7 G7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Bbmaj7 G7 | Cm7 F7',
      head: `r:1 D5:1 F5:1 A5:1 G5:2 F5:2 | B4:2 D5:1 F5:1 Ab5:2 G5:2 | G5:4 Eb5:2 C5:2 | A4:2 C5:1 Eb5:1 D5:4 |
             r:1 A4:1 C5:1 F5:1 E5:2 D5:2 | F5:2 D5:1 B4:1 G4:4 | Eb5:2 G5:2 Bb5:2 G5:2 | A5:2 F5:2 Eb5:4 |
             G5:4 Bb5:2 G5:2 | Bb5:2 G5:2 E5:2 Db5:2 | D5:4 B4:4 | C5:2 Eb5:2 A4:4 |
             F5:2 D5:2 F5:2 B4:2 | Eb5:2 G5:2 A5:2 F5:2 | D5:4 r:2 B4:2 | C5:2 Eb5:2 F5:4`,
    },
  ];

  const TICKS = { swing: 8, shuffle: 8, ballad: 8, bossa: 8, slow: 12 };
  const LEAD_RANGE = {
    sax: [50, 77], trumpet: [56, 84], vibes: [55, 88], piano: [55, 90], jazzguitar: [50, 80], epiano: [52, 84],
  };

  // Разобранная мелодия трека (кэш).
  function trackMelody(track) {
    if (!track._melody) track._melody = parseMelody(track.head, TICKS[track.feel]);
    return track._melody;
  }

  // План квадратов трека на ~3 минуты: тема в начале и в конце, посередине — соло (блюз) или
  // тема у аккомпанемента и проход одной ритм-секции (песня).
  const TRACK_SECONDS = 180;
  function formPlan(track) {
    const bars = parseProgression(track.changes).length;
    const chorus = (bars * 4 * 60) / track.bpm;
    const n = Math.max(3, Math.min(8, Math.round(TRACK_SECONDS / chorus)));
    const plan = [];
    for (let i = 0; i < n; i++) {
      if (i === 0 || i === n - 1 || (i === 1 && n >= 5) || (i === n - 2 && n >= 6)) plan.push('head');
      else if (track.form === 'blues') plan.push('solo');
      else plan.push(plan.filter((r) => r === 'comp').length > plan.filter((r) => r === 'open').length ? 'open' : 'comp');
    }
    return plan;
  }

  // Ноты соло-квадрата блюза: фразы на тактах 1, 5, 9 (вопрос), 3, 7 (ответ), 11 (концовка).
  // -> [{ bar, tick, midi, len }] в тиках трека.
  function bluesSolo(track, chorusIndex) {
    const perBar = TICKS[track.feel];
    const [lo, hi] = LEAD_RANGE[track.lead];
    const keyPc = NOTE[track.key[0]] + (track.key[1] === 'b' ? -1 : track.key[1] === '#' ? 1 : 0);
    let tonic = keyPc + 12 * Math.floor((lo + 4) / 12);
    while (tonic < lo + 4) tonic += 12;
    // Восьмые 4/4 в тики трека (в 12/8 «свинговая» восьмая — третья триоль доли).
    const toTicks = (t8) => (perBar === 12 ? Math.floor(t8 / 2) * 3 + (t8 % 2 ? 2 : 0) : t8);
    const slots = [['call', 0], ['answer', 2], ['call', 4], ['answer', 6], ['call', 8], ['ending', 10]];
    const out = [];
    slots.forEach(([kind, bar], k) => {
      const list = LICKS[kind];
      const lick = list[(chorusIndex * 3 + k) % list.length];
      for (const [t8, deg0, len8] of lick) {
        const deg = track.minor && (deg0 === 4 || deg0 === 9) ? deg0 - 1 : deg0;
        const start = toTicks(t8);
        const len = Math.max(1, toTicks(t8 + len8) - start);
        out.push({ bar: bar + Math.floor(start / perBar), tick: start % perBar, midi: fold(tonic + deg, lo, hi), len });
      }
    });
    return out;
  }

  // Тесты в Node: теория и партитуры.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = {
      parseChord, parseProgression, parseMelody, noteMidi, walkingBar, voicing, scaleNotes, nearest, fold, chordAt,
      bluesSolo, formPlan, trackMelody, TRACKS, TICKS, LEAD_RANGE, LICKS, BASS_LO, BASS_HI,
    };
    return;
  }

  // ---------- Звук ----------

  const rand = Math.random;
  const SAMPLE_DIR = 'samples';
  // Какие ноты скачаны (через малую терцию) и насколько поднять громкость сэмплов до общего уровня.
  const SAMPLE_SETS = {
    bass: { lo: 24, hi: 60, gain: 3.0 },
    epiano: { lo: 36, hi: 84, gain: 3.2 },
    sax: { lo: 36, hi: 72, gain: 2.6 },
    vibes: { lo: 48, hi: 96, gain: 3.4 },
    jazzguitar: { lo: 36, hi: 84, gain: 3.0 },
    trumpet: { lo: 48, hi: 84, gain: 2.6 },
    nylon: { lo: 36, hi: 84, gain: 3.4 },
    piano: { lo: 24, hi: 96, gain: 1.0 },
  };
  // Как звучит нота инструмента: атака, затухание после конца ноты, тембр (фильтр), держит ли ноту.
  const ARTIC = {
    bass: { attack: 0.005, release: 0.12, lp: 1400 },
    epiano: { attack: 0.004, release: 0.35, lp: 3000 },
    sax: { attack: 0.03, release: 0.12, lp: 3200 },
    vibes: { attack: 0.002, release: 0.9, lp: 6000 },
    jazzguitar: { attack: 0.004, release: 0.2, lp: 2600 },
    trumpet: { attack: 0.025, release: 0.1, lp: 3500 },
    nylon: { attack: 0.003, release: 0.4, lp: 4200 },
    piano: { attack: 0.003, release: 0.45, lp: 5200 },
  };

  let ctx = null;
  let master = null;     // громкость, которую двигает человек
  let duck = null;       // приглушение, когда играет песня из админки
  let reverb = null;
  let noiseBuf = null;
  let crackle = null;
  const buffers = {};    // инструмент -> Map(midi -> AudioBuffer)
  const loading = {};    // инструмент -> Promise

  function loadInstrument(inst) {
    if (loading[inst]) return loading[inst];
    const set = SAMPLE_SETS[inst];
    const map = new Map();
    const jobs = [];
    for (let m = set.lo; m <= set.hi; m += 3) {
      jobs.push(fetch(`${SAMPLE_DIR}/${inst}/${m}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => map.set(m, buf))
        .catch(() => {}));
    }
    loading[inst] = Promise.all(jobs).then(() => { buffers[inst] = map; });
    return loading[inst];
  }

  // context: свой контекст (для офлайн-рендера в проверках), иначе обычный.
  function setupAudio(context) {
    ctx = context || new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -16;
    comp.ratio.value = 2.5;
    comp.attack.value = 0.02;
    comp.release.value = 0.3;
    comp.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0;
    duck = ctx.createGain();
    // Тёплый общий тон: чуть срезать верх.
    const warm = ctx.createBiquadFilter();
    warm.type = 'highshelf';
    warm.frequency.value = 6000;
    warm.gain.value = -4;
    master.connect(warm).connect(duck).connect(comp);

    // Ревер небольшого зала: затухающий шум, мягкий (без звона на верхах).
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += ((rand() * 2 - 1) - lp) * 0.35;
        d[i] = lp * (1 - i / len) ** 2.8;
      }
    }
    reverb.buffer = ir;
    const wetLp = ctx.createBiquadFilter();
    wetLp.type = 'lowpass';
    wetLp.frequency.value = 4200;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    reverb.connect(wetLp).connect(wet).connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;

    // Еле слышный треск винила для уюта.
    const cl = ctx.createBuffer(1, ctx.sampleRate * 5, ctx.sampleRate);
    const cd = cl.getChannelData(0);
    let hiss = 0;
    for (let i = 0; i < cd.length; i++) {
      hiss += ((rand() * 2 - 1) - hiss) * 0.08;
      cd[i] = hiss * 0.06 + (rand() < 0.0004 ? (rand() * 2 - 1) * 0.9 : 0);
    }
    crackle = ctx.createBufferSource();
    crackle.buffer = cl;
    crackle.loop = true;
    const clLp = ctx.createBiquadFilter();
    clLp.type = 'bandpass';
    clLp.frequency.value = 2500;
    clLp.Q.value = 0.5;
    const clG = ctx.createGain();
    clG.gain.value = 0.05;
    crackle.connect(clLp).connect(clG).connect(master);
    crackle.start();
  }

  // Шина трека: свой уровень (для плавной смены трека) и отправка в ревер.
  function makeBus() {
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(master);
    const send = ctx.createGain();
    send.gain.value = 0.9;
    bus.connect(send).connect(reverb);
    return bus;
  }

  // Нота на сэмпле: ближайший скачанный сэмпл, подтянутый по высоте.
  function playNote(inst, out, t, midi, dur, vel) {
    const map = buffers[inst];
    if (!map || !map.size) return;
    let best = null;
    for (const m of map.keys()) if (best === null || Math.abs(m - midi) < Math.abs(best - midi)) best = m;
    const a = ARTIC[inst];
    const src = ctx.createBufferSource();
    src.buffer = map.get(best);
    src.playbackRate.value = 2 ** ((midi - best) / 12);
    const g = ctx.createGain();
    const peak = vel * SAMPLE_SETS[inst].gain;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a.attack);
    g.gain.setValueAtTime(peak, t + Math.max(a.attack, dur));
    g.gain.setTargetAtTime(0.0001, t + Math.max(a.attack, dur), a.release / 3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = a.lp;
    src.connect(lp).connect(g).connect(out);
    src.start(t);
    src.stop(t + dur + a.release * 2 + 0.05);
  }

  function noise(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.start(t, rand() * 0.5);
    s.stop(t + dur);
    return s;
  }

  // Ударные — синтез: щётки, райд, римшот, шейкер, мягкая бочка.
  const DRUMS = {
    ride(out, t, vel) {
      const s = noise(t, 0.7);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 7000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.022 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.55);
      s.connect(hp).connect(g).connect(out);
      const o = ctx.createOscillator();
      o.frequency.value = 4800 + rand() * 60;
      const og = ctx.createGain();
      og.gain.setValueAtTime(0.003 * vel, t);
      og.gain.exponentialRampToValueAtTime(0.0001, t + 0.5);
      o.connect(og).connect(out);
      o.start(t);
      o.stop(t + 0.55);
    },
    // Щётка ведётся по пластику: длинный мягкий шорох.
    swish(out, t, len, vel) {
      const s = noise(t, len + 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1800, t);
      bp.frequency.linearRampToValueAtTime(3200, t + len);
      bp.Q.value = 0.7;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.014 * vel, t + len * 0.4);
      g.gain.linearRampToValueAtTime(0.0001, t + len);
      s.connect(bp).connect(g).connect(out);
    },
    // Удар щёткой: короткий шлепок.
    tap(out, t, vel) {
      const s = noise(t, 0.15);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2600;
      bp.Q.value = 0.8;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.03 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
      s.connect(bp).connect(g).connect(out);
    },
    chick(out, t, vel) {
      const s = noise(t, 0.06);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 8000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.016 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      s.connect(hp).connect(g).connect(out);
    },
    kick(out, t, vel) {
      const o = ctx.createOscillator();
      o.frequency.setValueAtTime(90, t);
      o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.12 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.3);
    },
    rim(out, t, vel) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = 1650;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.022 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.045);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.06);
    },
    shaker(out, t, vel) {
      const s = noise(t, 0.08);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6000;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.009 * vel, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.07);
      s.connect(hp).connect(g).connect(out);
    },
  };

  // ---------- Ансамбль ----------

  const SWING = { swing: 0.64, shuffle: 0.67, bossa: 0.5, ballad: 0.6, slow: 0.667 };
  // Аккорд из 3-4 нот не должен заглушать мелодию: на ноту аккорда — меньше, чем на ноту темы.
  const LEVEL = { bass: 0.5, comp: 0.17, lead: 0.44, melodyOnComp: 0.36 };
  const COMP_LO = { epiano: 52, piano: 52, jazzguitar: 50, nylon: 50 };

  function instrumentsOf(track) {
    return ['bass', track.comp, track.lead];
  }

  // Один такт трека: всё, что в нём звучит, ставится в расписание сразу.
  function playBar(player, t0) {
    const tr = player.track;
    const bars = player.bars;
    const n = bars.length;
    const barInChorus = player.bar % n;
    const chorus = Math.floor(player.bar / n);
    const role = player.plan[chorus] || 'head';
    const bar = bars[barInChorus];
    const nextBar = bars[(barInChorus + 1) % n];
    const beat = 60 / tr.bpm;
    const sw = SWING[tr.feel];
    const perBar = TICKS[tr.feel];
    const jitter = () => (rand() - 0.5) * 0.008;
    // Позиция в долях (0..4, .5 — «и» со свингом) -> время.
    const at = (pos) => t0 + (Math.floor(pos) + (pos % 1 ? sw : 0)) * beat + jitter();
    // Тик мелодии (может уходить в следующий такт) -> время.
    const tickTime = (tick) => {
      const b = Math.floor(tick / perBar);
      const t = tick - b * perBar;
      const inBeats = perBar === 12 ? t / 3 : Math.floor(t / 2) + (t % 2 ? sw : 0);
      return t0 + (b * 4 + inBeats) * beat;
    };
    const out = player.bus;
    const soft = (v) => v * (0.88 + rand() * 0.2);

    // --- Бас ---
    if (tr.feel === 'swing' || tr.feel === 'shuffle' || tr.feel === 'slow') {
      for (const nt of walkingBar(bar, nextBar, player.lastBass, rand)) {
        playNote('bass', out, at(nt.beat), nt.midi, beat * 0.9, LEVEL.bass * (nt.beat === 0 ? 1 : soft(0.85)));
        player.lastBass = nt.midi;
      }
    } else {
      for (const c of bar) {
        const r = fold(nearest(c.chord.root, player.lastBass), BASS_LO, BASS_HI);
        const fifth = fold(r + 7, BASS_LO, BASS_HI);
        if (tr.feel === 'bossa') {
          playNote('bass', out, at(c.beat), r, beat * 1.3, LEVEL.bass);
          if (c.beats === 4) {
            playNote('bass', out, at(c.beat + 1.5), fifth, beat * 0.45, LEVEL.bass * 0.7);
            playNote('bass', out, at(c.beat + 2), fifth, beat * 1.3, LEVEL.bass * 0.85);
            playNote('bass', out, at(c.beat + 3.5), r, beat * 0.45, LEVEL.bass * 0.7);
          } else {
            playNote('bass', out, at(c.beat + 1.5), fifth, beat * 0.45, LEVEL.bass * 0.7);
          }
        } else {
          playNote('bass', out, at(c.beat), r, beat * Math.min(2, c.beats) * 0.95, LEVEL.bass * 0.9);
          if (c.beats === 4) playNote('bass', out, at(c.beat + 2), fifth, beat * 1.9, LEVEL.bass * 0.75);
        }
        player.lastBass = r;
      }
    }

    // --- Аккомпанемент: устойчивые ритмические фигуры ---
    const melodyOnComp = role === 'comp';
    const compLevel = LEVEL.comp * (melodyOnComp ? 0.7 : 1);
    const hit = (c, pos, len, vel) => {
      const notes = voicing(c.chord, COMP_LO[tr.comp]);
      notes.forEach((nn, i) => {
        const strum = tr.comp === 'nylon' || tr.comp === 'jazzguitar' ? i * 0.016 : rand() * 0.006;
        playNote(tr.comp, out, at(pos) + strum, nn, beat * len, compLevel * vel * soft(1));
      });
    };
    for (const c of bar) {
      if (tr.feel === 'swing') {
        // Чарльстон и его родственники, по кругу через такт.
        const figures = c.beats === 4 ? [[0, 1.5], [0, 2.5], [1.5, 3], [0, 1.5]] : [[0], [1.5], [0], [0, 1.5]];
        for (const p of figures[barInChorus % figures.length]) hit(c, c.beat + p, p % 1 ? 0.45 : 0.9, p % 1 ? 0.85 : 0.75);
      } else if (tr.feel === 'shuffle') {
        for (const p of c.beats === 4 ? [1, 3] : [1]) hit(c, c.beat + p, 0.4, 0.8);
        if (c.beats === 4 && barInChorus % 2 === 1) hit(c, c.beat + 3.5, 0.3, 0.6);
      } else if (tr.feel === 'slow') {
        hit(c, c.beat, Math.min(c.beats, 2) * 0.95, 0.75);
        if (c.beats === 4) hit(c, c.beat + 2, 1.9, 0.6);
      } else if (tr.feel === 'bossa') {
        const figure = barInChorus % 2 === 0 ? [0, 1.5, 3] : [1, 2.5];
        for (const p of figure.filter((x) => x < c.beats)) hit(c, c.beat + p, p === 0 ? 1.2 : 0.45, p === 0 ? 0.85 : 0.7);
      } else {
        hit(c, c.beat, c.beats * 0.97, 0.7);
      }
    }

    // --- Ударные ---
    const D = DRUMS;
    if (tr.feel === 'swing') {
      for (const p of [0, 1, 1.5, 2, 3, 3.5]) D.ride(out, at(p), p % 1 ? 0.55 : 0.85);
      for (const p of [0, 2]) D.swish(out, at(p), beat * 1.8, 1);
      for (const p of [1, 3]) { D.tap(out, at(p), 0.5); D.chick(out, at(p), 0.8); }
      for (const p of [0, 1, 2, 3]) D.kick(out, at(p), 0.16);
    } else if (tr.feel === 'shuffle') {
      for (const p of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) D.ride(out, at(p), p % 1 ? 0.5 : 0.8);
      for (const p of [1, 3]) D.tap(out, at(p), 1);
      for (const p of [0, 2]) D.kick(out, at(p), 0.4);
    } else if (tr.feel === 'slow') {
      for (let k = 0; k < 12; k++) D.ride(out, t0 + (k / 3) * beat + jitter(), k % 3 === 0 ? 0.6 : 0.35);
      for (const p of [1, 3]) D.tap(out, at(p), 0.9);
      for (const p of [0, 2]) D.swish(out, at(p), beat * 0.9, 0.9);
      D.kick(out, at(0), 0.35);
    } else if (tr.feel === 'bossa') {
      for (let p = 0; p < 4; p += 0.5) D.shaker(out, at(p), p % 1 ? 0.7 : 1);
      const clave = barInChorus % 2 === 0 ? [0, 1.5, 3] : [1, 2];
      for (const p of clave) D.rim(out, at(p), 0.8);
      for (const p of [0, 1.5, 2, 3.5]) D.kick(out, at(p), p % 1 ? 0.2 : 0.35);
    } else {
      for (const p of [0, 1, 2, 3]) D.swish(out, at(p), beat * 0.95, 0.8);
      for (const p of [0, 1, 2, 3]) D.ride(out, at(p), 0.3);
    }

    // --- Мелодия ---
    const leadArt = tr.lead === 'vibes' || tr.lead === 'piano' ? 1 : 0.94;   // духовые — легато
    if (role === 'head') {
      for (const nt of trackMelody(tr).bars[barInChorus]) {
        const strong = nt.tick % (perBar === 12 ? 3 : 2) === 0;
        const start = tickTime(nt.tick) + jitter();
        const dur = (tickTime(nt.tick + nt.len) - tickTime(nt.tick)) * leadArt;
        playNote(tr.lead, out, start, nt.midi, dur, LEVEL.lead * (strong ? 1 : 0.85) * soft(1));
      }
    } else if (melodyOnComp) {
      // Второй проход песни: тему тихо играет аккомпанирующий инструмент, солист отдыхает.
      for (const nt of trackMelody(tr).bars[barInChorus]) {
        const start = tickTime(nt.tick) + jitter();
        const dur = tickTime(nt.tick + nt.len) - tickTime(nt.tick);
        playNote(tr.comp, out, start, nt.midi, dur, LEVEL.melodyOnComp * soft(1));
      }
    } else if (role === 'solo') {
      if (!player.solo || player.solo.chorus !== chorus) player.solo = { chorus, notes: bluesSolo(tr, chorus) };
      for (const nt of player.solo.notes.filter((x) => x.bar === barInChorus)) {
        const start = tickTime(nt.tick) + jitter();
        const dur = (tickTime(nt.tick + nt.len) - tickTime(nt.tick)) * leadArt;
        playNote(tr.lead, out, start, nt.midi, dur, LEVEL.lead * 0.9 * soft(1));
      }
    }
  }

  // ---------- Плеер ----------

  const STORE = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const ON_KEY = 'casino.lounge.on';
  const VOL_KEY = 'casino.lounge.vol';

  const state = {
    on: STORE.get(ON_KEY) !== 'off',
    vol: Number(STORE.get(VOL_KEY) ?? 30),
    playing: false,
    ducked: false,
    player: null,
    order: [],
    timer: null,
    listeners: [],
    starting: null,
  };

  const userGain = () => (state.vol / 100) ** 2 * 0.9;

  function nextIndex() {
    if (!state.order.length) {
      state.order = TRACKS.map((_, i) => i).sort(() => rand() - 0.5);
      if (state.player && state.order[0] === state.player.index) state.order.push(state.order.shift());
    }
    return state.order.shift();
  }

  // Сначала грузим сэмплы трека, потом играем. Остальные инструменты догружаем в фоне.
  async function startTrack(index) {
    const token = {};
    state.starting = token;
    const track = TRACKS[index];
    await Promise.all(instrumentsOf(track).map(loadInstrument));
    if (state.starting !== token) return;
    const old = state.player;
    if (old) {
      old.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.8);
      setTimeout(() => old.bus.disconnect(), 5000);
    }
    const bus = makeBus();
    bus.gain.setTargetAtTime(1, ctx.currentTime + 0.2, 0.6);
    state.player = {
      index,
      track,
      bars: parseProgression(track.changes),
      plan: formPlan(track),
      bus,
      bar: 0,
      nextBarAt: ctx.currentTime + 0.3,
      lastBass: 36,
      solo: null,
    };
    state.starting = null;
    emit();
    for (const inst of Object.keys(SAMPLE_SETS)) loadInstrument(inst);
  }

  // Планировщик: тактами, с запасом вперёд. Трек кончается после последнего квадрата.
  function tick() {
    const p = state.player;
    if (!p || !state.playing) return;
    while (p.nextBarAt < ctx.currentTime + 0.7) {
      if (p.bar >= p.plan.length * p.bars.length) {
        if (!state.starting) startTrack(nextIndex());   // пока грузится следующий, старый уже молчит
        return;
      }
      playBar(p, p.nextBarAt);
      p.nextBarAt += (60 / p.track.bpm) * 4;
      p.bar += 1;
    }
  }

  function applyVolume() {
    if (!ctx) return;
    const target = state.playing ? userGain() : 0;
    master.gain.setTargetAtTime(target, ctx.currentTime, 0.25);
    duck.gain.setTargetAtTime(state.ducked ? 0 : 1, ctx.currentTime, state.ducked ? 0.4 : 1.2);
  }

  function play() {
    if (!ctx) setupAudio();
    ctx.resume();
    state.playing = true;
    if (!state.player && !state.starting) startTrack(nextIndex());
    else if (state.player) state.player.nextBarAt = Math.max(state.player.nextBarAt, ctx.currentTime + 0.1);
    clearInterval(state.timer);
    state.timer = setInterval(tick, 100);
    tick();
    applyVolume();
    emit();
  }

  function pause() {
    state.playing = false;
    applyVolume();
    clearInterval(state.timer);
    setTimeout(() => { if (!state.playing && ctx) ctx.suspend(); }, 1200);
    emit();
  }

  function emit() {
    for (const fn of state.listeners) fn(api.status());
  }

  const api = {
    TRACKS,
    status: () => ({
      on: state.on,
      playing: state.playing,
      vol: state.vol,
      ducked: state.ducked,
      track: state.player ? state.player.track.name : null,
      index: state.player ? state.player.index : null,
    }),
    onChange: (fn) => state.listeners.push(fn),
    // Вызывается при любом действии человека на странице: браузер даёт звук только после жеста.
    unlock() {
      if (state.on && !state.playing) play();
    },
    toggle() {
      state.on = !state.on;
      STORE.set(ON_KEY, state.on ? 'on' : 'off');
      if (state.on) play();
      else pause();
    },
    next() {
      if (!state.on) {
        state.on = true;
        STORE.set(ON_KEY, 'on');
      }
      if (!state.playing) play();
      startTrack(nextIndex());
    },
    prev() {
      if (!state.player) return api.next();
      const i = (state.player.index - 1 + TRACKS.length) % TRACKS.length;
      if (!state.playing) play();
      startTrack(i);
    },
    setVolume(v) {
      state.vol = Math.max(0, Math.min(100, Number(v) || 0));
      STORE.set(VOL_KEY, String(state.vol));
      applyVolume();
      emit();
    },
    setDucked(on) {
      if (state.ducked === on) return;
      state.ducked = on;
      applyVolume();
      emit();
    },
  };

  // Проверка без ушей: рендерим кусок трека офлайн, меряем пик и громкость (RMS) по ролям.
  // part: 'head' | 'solo'. Возвращает и сам буфер (для прослушивания в проверках).
  api._renderTest = async (index, seconds = 16, part = 'head') => {
    const saved = { ctx, master, duck, reverb, noiseBuf, crackle };
    const sr = 44100;
    const off = new OfflineAudioContext(2, sr * seconds, sr);
    setupAudio(off);
    master.gain.value = (100 / 100) ** 2 * 0.9;
    const track = TRACKS[index];
    await Promise.all(instrumentsOf(track).map(loadInstrument));
    const bars = parseProgression(track.changes);
    const player = {
      index, track, bars, plan: part === 'solo' ? (track.form === 'blues' ? ['solo', 'solo'] : ['comp', 'open']) : ['head', 'head'], bus: makeBus(), bar: 0, lastBass: 36, solo: null,
    };
    player.bus.gain.value = 1;
    const barDur = (60 / track.bpm) * 4;
    for (let t = 0.1; t < seconds - barDur; t += barDur) {
      playBar(player, t);
      player.bar += 1;
    }
    const buf = await off.startRendering();
    ({ ctx, master, duck, reverb, noiseBuf, crackle } = saved);
    let peak = 0;
    let sum = 0;
    for (let ch = 0; ch < buf.numberOfChannels; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > peak) peak = v;
        sum += d[i] * d[i];
      }
    }
    const rms = Math.sqrt(sum / (buf.length * buf.numberOfChannels));
    return { name: track.name, peak: +peak.toFixed(3), rmsDb: +(20 * Math.log10(rms)).toFixed(1), bars: player.bar, buffer: buf };
  };

  root.Lounge = api;
})(typeof window !== 'undefined' ? window : globalThis);
