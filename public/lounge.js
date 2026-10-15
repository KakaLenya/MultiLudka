// Фоновая музыка зала: генеративный джаз и блюз на Web Audio, без аудиофайлов.
// Трек = партитура (гармония, темп, грув, солист). Ансамбль импровизирует по ней в реальном времени:
// шагающий бас, электропиано/гитара, щётки и райд, соло. Поэтому каждый проигрыш немного другой.
//
// В браузере: window.Lounge. В Node (тесты): module.exports с чистыми функциями теории.
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
  // Лады для соло по типу аккорда (ступени от корня).
  const SCALES = {
    maj7: [0, 2, 4, 7, 9, 11],
    6: [0, 2, 4, 7, 9],
    m7: [0, 2, 3, 5, 7, 9, 10],
    m6: [0, 2, 3, 5, 7, 9],
    7: [0, 2, 3, 4, 7, 9, 10],   // миксолидийский с блюзовой терцией
    m7b5: [0, 3, 5, 6, 8, 10],
    dim7: [0, 2, 3, 5, 6, 8, 9, 11],
  };

  function parseChord(sym) {
    const m = /^([A-G])([b#]?)(maj7|m7b5|dim7|m7|m6|6|7)$/.exec(sym);
    if (!m) throw new Error(`Непонятный аккорд: ${sym}`);
    const root = (NOTE[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0) + 12) % 12;
    return { sym, root, quality: m[3], tones: QUALITIES[m[3]], scale: SCALES[m[3]] };
  }

  // "F7 | Bb7 | Cm7 F7" -> [[{chord, beat:0, beats:4}], [...], [{..beat:0,beats:2},{..beat:2,beats:2}]]
  function parseProgression(text) {
    return text.split('|').map((bar) => {
      const syms = bar.trim().split(/\s+/).filter(Boolean);
      if (!syms.length || 4 % syms.length !== 0) throw new Error(`Такт «${bar}»: 1, 2 или 4 аккорда`);
      const beats = 4 / syms.length;
      return syms.map((s, i) => ({ chord: parseChord(s), beat: i * beats, beats }));
    });
  }

  const chordAt = (bar, beat) => bar.filter((c) => c.beat <= beat).pop();

  // Высота с нужным классом высоты, ближайшая к target.
  function nearest(pc, target) {
    let n = target - ((target - pc) % 12 + 12) % 12;
    if (target - n > 6) n += 12;
    return n;
  }
  // Держим ноту в диапазоне [lo, hi] перекладыванием по октавам.
  function fold(n, lo, hi) {
    while (n < lo) n += 12;
    while (n > hi) n -= 12;
    return n;
  }

  const BASS_LO = 28;  // E1
  const BASS_HI = 50;  // D3

  // Шагающий бас на такт: 4 четверти. Корень на «раз», аккордовые на 2 и 3, на 4 подход к следующему корню.
  function walkingBar(bar, nextBar, prev, rnd) {
    const notes = [];
    let last = prev;
    for (let beat = 0; beat < 4; beat++) {
      const c = chordAt(bar, beat).chord;
      let n;
      if (beat === chordAt(bar, beat).beat) {
        n = nearest(c.root, last);
      } else if (beat === 3) {
        const nextRoot = chordAt(nextBar, 0).chord.root;
        const target = nearest(nextRoot, last);
        n = target + (rnd() < 0.5 ? 1 : -1);  // хроматический подход
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

  // Безкорневая джазовая раскладка: терция, септима, нона (и квинта), в середине клавиатуры.
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

  // Ноты лада аккорда в диапазоне.
  function scaleNotes(chord, lo, hi) {
    const out = [];
    for (let n = lo; n <= hi; n++) {
      if (chord.scale.includes(((n - chord.root) % 12 + 12) % 12)) out.push(n);
    }
    return out;
  }

  // ---------- Партитуры ----------

  // feel: swing | shuffle | bossa | ballad. comp: rhodes | piano | guitar. lead: vibes | sax | trumpet | piano | null.
  const TRACKS = [
    { name: 'Зелёное сукно', bpm: 118, feel: 'swing', comp: 'rhodes', lead: 'vibes', density: 0.55,
      changes: 'F7 | Bb7 | F7 | Cm7 F7 | Bb7 | Bdim7 | F7 | Am7 D7 | Gm7 | C7 | F7 D7 | Gm7 C7' },
    { name: 'Полночь в Вегасе', bpm: 132, feel: 'bossa', comp: 'guitar', lead: 'sax', density: 0.5,
      changes: 'Cm6 | Cm6 | Fm7 | Fm7 | Dm7b5 | G7 | Cm6 | Cm6 | Ebm7 | Ab7 | Dbmaj7 | Dbmaj7 | Dm7b5 | G7 | Cm6 | Dm7b5 G7' },
    { name: 'Последняя ставка', bpm: 68, feel: 'ballad', comp: 'rhodes', lead: 'piano', density: 0.35,
      changes: 'Am7 | Am7 | Am7 | Am7 | Dm7 | Dm7 | Am7 | Am7 | F7 | E7 | Am7 | Bm7b5 E7' },
    { name: 'Фишки на красное', bpm: 150, feel: 'swing', comp: 'piano', lead: 'trumpet', density: 0.5,
      changes: 'Bb6 G7 | Cm7 F7 | Dm7 G7 | Cm7 F7 | Fm7 Bb7 | Ebmaj7 Ab7 | Dm7 G7 | Cm7 F7' },
    { name: 'Дым над рулеткой', bpm: 112, feel: 'swing', comp: 'rhodes', lead: 'vibes', density: 0.4,
      changes: 'Dm7 | Dm7 | Dm7 | Dm7 | Dm7 | Dm7 | Dm7 | Dm7 | Ebm7 | Ebm7 | Ebm7 | Ebm7 | Dm7 | Dm7 | Dm7 | Dm7' },
    { name: 'Шаффл крупье', bpm: 92, feel: 'shuffle', comp: 'piano', lead: 'sax', density: 0.5,
      changes: 'G7 | C7 | G7 | G7 | C7 | C7 | G7 | E7 | Am7 | D7 | G7 E7 | Am7 D7' },
    { name: 'Осенний стол', bpm: 124, feel: 'swing', comp: 'rhodes', lead: 'piano', density: 0.5,
      changes: 'Cm7 | F7 | Bbmaj7 | Ebmaj7 | Am7b5 | D7 | Gm6 | Gm6 | Am7b5 | D7 | Gm6 | Gm6 | Cm7 | F7 | Bbmaj7 | Ebmaj7' },
    { name: 'Тихий джекпот', bpm: 64, feel: 'ballad', comp: 'rhodes', lead: 'vibes', density: 0.3,
      changes: 'Ebmaj7 | Cm7 | Fm7 | Bb7 | Gm7 | C7 | Fm7 | Bb7 | Abmaj7 | Abm7 Db7 | Ebmaj7 Cm7 | Fm7 Bb7' },
    { name: 'Бархатный покер', bpm: 120, feel: 'bossa', comp: 'guitar', lead: 'piano', density: 0.45,
      changes: 'Fmaj7 | Fmaj7 | Gm7 | C7 | Am7 | D7 | Gm7 | C7 | Fmaj7 | Bbmaj7 | Em7b5 | A7 | Dm7 | G7 | Gm7 | C7' },
    { name: 'Удача в рукаве', bpm: 140, feel: 'swing', comp: 'piano', lead: 'trumpet', density: 0.5,
      changes: 'Cmaj7 | Cmaj7 | Fm7 | Bb7 | Cmaj7 | Cmaj7 | Bbm7 | Eb7 | Abmaj7 | Abmaj7 | Am7 | D7 | Dm7 | G7 | Cmaj7 | Dm7 G7' },
    { name: 'Лаундж у бара', bpm: 116, feel: 'bossa', comp: 'guitar', lead: 'vibes', density: 0.45,
      changes: 'Am7 | Dm7 | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7 | Am7 | Am7 | Dm7 | G7 | Cmaj7 | Fmaj7 | Bm7b5 | E7 | Am7' },
    { name: 'Утро после смены', bpm: 70, feel: 'ballad', comp: 'piano', lead: 'sax', density: 0.35,
      changes: 'Bb7 | Eb7 | Bb7 | Bb7 | Eb7 | Edim7 | Bb7 | G7 | Cm7 | F7 | Bb7 G7 | Cm7 F7' },
    { name: 'Блюз для крупье', bpm: 104, feel: 'shuffle', comp: 'rhodes', lead: 'trumpet', density: 0.45,
      changes: 'C7 | F7 | C7 | C7 | F7 | F7 | C7 | A7 | Dm7 | G7 | C7 A7 | Dm7 G7' },
  ];

  // Тесты в Node: только чистые функции.
  if (typeof module !== 'undefined' && module.exports) {
    module.exports = { parseChord, parseProgression, walkingBar, voicing, scaleNotes, nearest, fold, TRACKS, BASS_LO, BASS_HI };
    return;
  }

  // ---------- Звук ----------

  const midiHz = (m) => 440 * 2 ** ((m - 69) / 12);
  const rand = Math.random;
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  let ctx = null;
  let master = null;     // громкость, которую двигает человек
  let duck = null;       // приглушение, когда играет песня из админки
  let reverb = null;
  let noiseBuf = null;

  // context: свой контекст (для офлайн-рендера в проверках), иначе обычный.
  function setupAudio(context) {
    ctx = context || new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18;
    comp.ratio.value = 3;
    comp.connect(ctx.destination);

    master = ctx.createGain();
    master.gain.value = 0;
    duck = ctx.createGain();
    master.connect(duck).connect(comp);

    // Ревербератор: затухающий шум как отклик небольшого зала.
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (rand() * 2 - 1) * (1 - i / len) ** 2.6;
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.28;
    reverb.connect(wet).connect(master);

    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = rand() * 2 - 1;
  }

  // Шина трека: свой уровень (для плавной смены трека) и отправка в ревер.
  function makeBus() {
    const bus = ctx.createGain();
    bus.gain.value = 0;
    bus.connect(master);
    const send = ctx.createGain();
    send.gain.value = 1;
    bus.connect(send).connect(reverb);
    return bus;
  }

  function env(g, t, peak, attack, hold, release) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setTargetAtTime(peak * 0.55, t + attack, hold * 0.6);
    g.gain.setTargetAtTime(0.0001, t + attack + hold, release / 3);
  }

  function osc(type, freq, t, stop, detune = 0) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    o.detune.value = detune;
    o.start(t);
    o.stop(stop);
    return o;
  }

  function noise(t, dur) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    s.start(t, rand() * 0.5);
    s.stop(t + dur);
    return s;
  }

  const INSTR = {
    bass(out, t, midi, dur, vel) {
      const f = midiHz(midi);
      const g = ctx.createGain();
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(380, t + 0.18);
      env(g, t, 0.42 * vel, 0.012, dur * 0.8, 0.12);
      osc('sine', f, t, t + dur + 0.3).connect(g);
      const tri = osc('triangle', f, t, t + dur + 0.3);
      const tg = ctx.createGain();
      tg.gain.value = 0.35;
      tri.connect(tg).connect(g);
      g.connect(lp).connect(out);
    },

    // Электропиано: синус с лёгкой частотной модуляцией и «колокольчиком» октавой выше.
    rhodes(out, t, midi, dur, vel) {
      const f = midiHz(midi);
      const g = ctx.createGain();
      env(g, t, 0.075 * vel, 0.008, dur, 0.4);
      const car = osc('sine', f, t, t + dur + 0.6, (rand() - 0.5) * 6);
      const mod = osc('sine', f, t, t + dur + 0.6);
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * 0.9, t);
      mg.gain.exponentialRampToValueAtTime(f * 0.05, t + 0.35);
      mod.connect(mg).connect(car.frequency);
      car.connect(g);
      const bell = osc('sine', f * 2, t, t + 0.5);
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.02 * vel, t);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.4);
      bell.connect(bg).connect(out);
      g.connect(out);
    },

    piano(out, t, midi, dur, vel) {
      const f = midiHz(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.085 * vel, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.02 * vel, t + 0.6);
      g.gain.setTargetAtTime(0.0001, t + dur, 0.08);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(3200, t);
      lp.frequency.exponentialRampToValueAtTime(900, t + 0.8);
      osc('triangle', f, t, t + dur + 0.5).connect(g);
      const h = osc('sine', f * 2, t, t + dur + 0.5, 3);
      const hg = ctx.createGain();
      hg.gain.value = 0.3;
      h.connect(hg).connect(g);
      g.connect(lp).connect(out);
    },

    // Нейлоновая гитара: короткий щипок, аккорд слегка «разбрасывается» при игре (см. comp).
    guitar(out, t, midi, dur, vel) {
      const f = midiHz(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.07 * vel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + Math.min(1.4, dur + 0.4));
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(2600, t);
      lp.frequency.exponentialRampToValueAtTime(700, t + 0.5);
      osc('triangle', f, t, t + 1.5).connect(g);
      const s = osc('sawtooth', f, t, t + 0.3);
      const sg = ctx.createGain();
      sg.gain.value = 0.15;
      s.connect(sg).connect(g);
      g.connect(lp).connect(out);
    },

    vibes(out, t, midi, dur, vel) {
      const f = midiHz(midi);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.09 * vel, t + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.6 + dur);
      const trem = ctx.createGain();
      trem.gain.value = 0.75;
      const lfo = osc('sine', 5.2, t, t + 2 + dur);
      const lg = ctx.createGain();
      lg.gain.value = 0.25;
      lfo.connect(lg).connect(trem.gain);
      osc('sine', f, t, t + 2 + dur).connect(g);
      const p = osc('sine', f * 4, t, t + 0.3);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(0.03 * vel, t);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      p.connect(pg).connect(out);
      g.connect(trem).connect(out);
    },

    // Саксофон: пила через фильтр с «дыханием» и вибрато.
    sax(out, t, midi, dur, vel) {
      const f = midiHz(midi);
      const g = ctx.createGain();
      env(g, t, 0.06 * vel, 0.05, dur, 0.12);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 1.2;
      lp.frequency.setValueAtTime(700, t);
      lp.frequency.linearRampToValueAtTime(1600, t + 0.08);
      lp.frequency.setTargetAtTime(1100, t + 0.1, 0.2);
      const o = osc('sawtooth', f, t, t + dur + 0.5);
      const vib = osc('sine', 5, t, t + dur + 0.5);
      const vg = ctx.createGain();
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(f * 0.006, t + 0.35);
      vib.connect(vg).connect(o.frequency);
      o.connect(lp).connect(g).connect(out);
      const br = noise(t, 0.12);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2400;
      const bg = ctx.createGain();
      bg.gain.setValueAtTime(0.012 * vel, t);
      bg.gain.exponentialRampToValueAtTime(0.0001, t + 0.1);
      br.connect(bp).connect(bg).connect(out);
    },

    // Труба с сурдиной: квадрат через узкий полосовой фильтр.
    trumpet(out, t, midi, dur, vel) {
      const f = midiHz(midi);
      const g = ctx.createGain();
      env(g, t, 0.05 * vel, 0.03, dur, 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = Math.min(2200, f * 3);
      bp.Q.value = 2.5;
      const o = osc('square', f, t, t + dur + 0.4);
      const vib = osc('sine', 5.5, t, t + dur + 0.4);
      const vg = ctx.createGain();
      vg.gain.setValueAtTime(0, t);
      vg.gain.linearRampToValueAtTime(f * 0.005, t + 0.3);
      vib.connect(vg).connect(o.frequency);
      o.connect(bp).connect(g).connect(out);
    },

    // ---- ударные ----
    ride(out, t, vel) {
      const s = noise(t, 0.6);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 6500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.03 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.45);
      s.connect(hp).connect(g).connect(out);
      const ping = osc('sine', 5100 + rand() * 80, t, t + 0.4);
      const pg = ctx.createGain();
      pg.gain.setValueAtTime(0.004 * vel, t);
      pg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      ping.connect(pg).connect(out);
    },
    hat(out, t, vel) {
      const s = noise(t, 0.08);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 8500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.025 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      s.connect(hp).connect(g).connect(out);
    },
    brush(out, t, vel, len = 0.2) {
      const s = noise(t, len + 0.1);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 2800;
      bp.Q.value = 0.6;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.03 * vel, t + Math.min(0.06, len / 3));
      g.gain.exponentialRampToValueAtTime(0.0001, t + len);
      s.connect(bp).connect(g).connect(out);
    },
    kick(out, t, vel) {
      const o = osc('sine', 100, t, t + 0.3);
      o.frequency.exponentialRampToValueAtTime(48, t + 0.12);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.18 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      o.connect(g).connect(out);
    },
    rim(out, t, vel) {
      const o = osc('triangle', 1700, t, t + 0.05);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.03 * vel, t);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.04);
      o.connect(g).connect(out);
    },
    shaker(out, t, vel) {
      const s = noise(t, 0.07);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 5500;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.012 * vel, t + 0.015);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      s.connect(hp).connect(g).connect(out);
    },
  };

  // ---------- Ансамбль ----------

  const SWING = { swing: 0.66, shuffle: 0.68, bossa: 0.5, ballad: 0.62 };

  // Один такт трека: всё, что в нём звучит, ставится в расписание сразу.
  function playBar(player, barIndex, t0) {
    const tr = player.track;
    const bars = player.bars;
    const bar = bars[barIndex % bars.length];
    const nextBar = bars[(barIndex + 1) % bars.length];
    const beat = 60 / tr.bpm;
    const sw = SWING[tr.feel];
    // Позиция в долях: целая часть = доля, .5 = «и» (со свингом).
    const at = (pos) => t0 + (Math.floor(pos) + (pos % 1 ? sw : 0)) * beat + (rand() - 0.5) * 0.008;
    const out = player.bus;
    const human = () => 0.8 + rand() * 0.35;

    // Бас.
    if (tr.feel === 'swing' || tr.feel === 'shuffle') {
      for (const n of walkingBar(bar, nextBar, player.lastBass, rand)) {
        INSTR.bass(out, at(n.beat), n.midi, beat * n.dur, n.beat === 0 ? 1 : 0.85 * human());
        player.lastBass = n.midi;
      }
    } else {
      for (const c of bar) {
        const r = fold(nearest(c.chord.root, player.lastBass), BASS_LO, BASS_HI);
        const fifth = fold(r + 7, BASS_LO, BASS_HI);
        if (tr.feel === 'bossa') {
          INSTR.bass(out, at(c.beat), r, beat * 1.4, 1);
          INSTR.bass(out, at(c.beat + 1.5), fifth, beat * 0.45, 0.8);
        } else {
          INSTR.bass(out, at(c.beat), r, beat * c.beats * 0.95, 0.9);
        }
        player.lastBass = r;
      }
    }

    // Аккомпанемент.
    const comp = INSTR[tr.comp];
    const hit = (chordEntry, pos, len, vel) => {
      const notes = voicing(chordEntry.chord, tr.comp === 'guitar' ? 50 : 52);
      notes.forEach((n, i) => {
        const strum = tr.comp === 'guitar' ? i * 0.018 : rand() * 0.006;
        comp(out, at(pos) + strum, n, beat * len, vel * human());
      });
    };
    for (const c of bar) {
      if (tr.feel === 'swing') {
        const patterns = c.beats === 4
          ? [[0, 1.5], [1.5, 3.5], [0.5, 2.5], [2.5], [0, 2], [1.5, 3]]
          : [[0], [0.5], [1.5], [0, 1.5]];
        for (const p of pick(patterns)) hit(c, c.beat + p, 0.7, 0.75);
      } else if (tr.feel === 'shuffle') {
        for (const p of c.beats === 4 ? [1, 3] : [1]) hit(c, c.beat + p, 0.35, 0.7);
      } else if (tr.feel === 'bossa') {
        for (const p of c.beats === 4 ? [0, 1.5, 3] : [0, 1.5]) hit(c, c.beat + p, 0.5, 0.65);
      } else {
        hit(c, c.beat, c.beats * 0.95, 0.6);
      }
    }

    // Ударные.
    const D = INSTR;
    if (tr.feel === 'swing') {
      for (const p of [0, 1, 1.5, 2, 3, 3.5]) D.ride(out, at(p), p % 1 ? 0.6 : 0.9 * human());
      for (const p of [1, 3]) D.hat(out, at(p), 0.8);
      for (const p of [0.5, 1.5, 2.5, 3.5]) if (rand() < 0.22) D.brush(out, at(p), 0.5, 0.12);
      D.kick(out, at(0), 0.35);
    } else if (tr.feel === 'shuffle') {
      for (const p of [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5]) D.ride(out, at(p), p % 1 ? 0.5 : 0.85);
      for (const p of [1, 3]) D.brush(out, at(p), 1.1, 0.22);
      for (const p of [0, 2]) D.kick(out, at(p), 0.5);
    } else if (tr.feel === 'bossa') {
      for (let p = 0; p < 4; p += 0.5) D.shaker(out, at(p), p % 1 ? 0.7 : 1);
      const clave = barIndex % 2 === 0 ? [0, 1.5, 3] : [1, 2.5];
      for (const p of clave) D.rim(out, at(p), 0.9);
      for (const p of [0, 1.5, 2, 3.5]) D.kick(out, at(p), p % 1 ? 0.25 : 0.4);
    } else {
      for (const p of [0, 2]) D.brush(out, at(p), 0.8, beat * 1.6);
      for (const p of [0, 1, 2, 3]) D.ride(out, at(p), 0.35);
    }

    // Соло: фразы по 2 такта, потом пауза («вопрос-ответ»).
    if (tr.lead) {
      if (player.phraseLeft <= 0 && player.restLeft <= 0) {
        player.phraseLeft = 2;
        player.restLeft = rand() < tr.density ? 1 : 2;
      }
      if (player.phraseLeft > 0) {
        player.phraseLeft -= 1;
        playPhrase(player, bar, at, beat);
      } else {
        player.restLeft -= 1;
      }
    }
  }

  const LEAD_RANGE = { vibes: [62, 84], sax: [56, 77], trumpet: [60, 81], piano: [64, 86] };

  function playPhrase(player, bar, at, beat) {
    const tr = player.track;
    const [lo, hi] = LEAD_RANGE[tr.lead];
    const slots = tr.feel === 'ballad' ? [0, 1, 1.5, 2, 3, 3.5] : [0, 0.5, 1, 1.5, 2, 2.5, 3, 3.5];
    let i = 0;
    while (i < slots.length) {
      const pos = slots[i];
      if (rand() > tr.density + 0.2) {
        i += 1;
        continue;
      }
      const c = chordAt(bar, Math.floor(pos)).chord;
      const pool = scaleNotes(c, lo, hi);
      // На сильных долях чаще аккордовые ноты; мелодия ходит небольшими шагами.
      const chordPool = pool.filter((n) => c.tones.includes(((n - c.root) % 12 + 12) % 12));
      const from = player.lastLead ?? Math.round((lo + hi) / 2);
      const choices = (pos % 1 === 0 && rand() < 0.6 ? chordPool : pool)
        .filter((n) => Math.abs(n - from) <= 5 && n !== from);
      const n = choices.length ? pick(choices) : pick(pool);
      const len = pick([1, 1, 2, 2, 3]);
      const durBeats = Math.min(len * 0.5, 4 - pos) * (tr.lead === 'vibes' ? 0.6 : 0.9);
      INSTR[tr.lead](player.bus, at(pos), n, beat * Math.max(0.25, durBeats), 0.7 + rand() * 0.3);
      player.lastLead = n;
      i += len;
    }
  }

  // ---------- Плеер ----------

  const STORE = {
    get(k) { try { return localStorage.getItem(k); } catch { return null; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch {} },
  };
  const ON_KEY = 'casino.lounge.on';
  const VOL_KEY = 'casino.lounge.vol';
  const TRACK_MINUTES = 3.5;

  const state = {
    on: STORE.get(ON_KEY) !== 'off',
    vol: Number(STORE.get(VOL_KEY) ?? 30),
    playing: false,
    ducked: false,
    player: null,
    order: [],
    timer: null,
    listeners: [],
  };

  const userGain = () => (state.vol / 100) ** 2 * 0.9;

  function nextIndex() {
    if (!state.order.length) {
      state.order = TRACKS.map((_, i) => i).sort(() => rand() - 0.5);
      // Не повторяем только что игравший трек сразу после перемешивания.
      if (state.player && state.order[0] === state.player.index) state.order.push(state.order.shift());
    }
    return state.order.shift();
  }

  function startTrack(index) {
    const old = state.player;
    if (old) {
      old.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.6);
      setTimeout(() => old.bus.disconnect(), 4000);
    }
    const track = TRACKS[index];
    const bus = makeBus();
    bus.gain.setTargetAtTime(1, ctx.currentTime + 0.3, 0.8);
    state.player = {
      index,
      track,
      bars: parseProgression(track.changes),
      bus,
      bar: 0,
      nextBarAt: ctx.currentTime + 0.4,
      lastBass: 36,
      lastLead: null,
      phraseLeft: 0,
      restLeft: 1,
      endsAt: ctx.currentTime + TRACK_MINUTES * 60,
    };
    emit();
  }

  // Планировщик: тактами, с запасом вперёд.
  function tick() {
    const p = state.player;
    if (!p || !state.playing) return;
    if (ctx.currentTime > p.endsAt) {
      startTrack(nextIndex());
      return;
    }
    while (p.nextBarAt < ctx.currentTime + 0.6) {
      playBar(p, p.bar, p.nextBarAt);
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
    if (!state.player) startTrack(nextIndex());
    else state.player.nextBarAt = Math.max(state.player.nextBarAt, ctx.currentTime + 0.1);
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
    // Даём хвостам затихнуть, потом усыпляем звук целиком.
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
    // Пока играет песня из админки, фон молчит.
    setDucked(on) {
      if (state.ducked === on) return;
      state.ducked = on;
      applyVolume();
      emit();
    },
  };

  // Проверка без ушей: рендерим трек офлайн и меряем пик и среднюю громкость (RMS).
  api._renderTest = async (index, seconds = 12) => {
    const saved = { ctx, master, duck, reverb, noiseBuf };
    const sr = 44100;
    const off = new OfflineAudioContext(2, sr * seconds, sr);
    setupAudio(off);
    master.gain.value = (100 / 100) ** 2 * 0.9;  // самая громкая настройка ползунка
    const track = TRACKS[index];
    const player = {
      index, track, bars: parseProgression(track.changes), bus: makeBus(),
      bar: 0, lastBass: 36, lastLead: null, phraseLeft: 0, restLeft: 1,
    };
    player.bus.gain.value = 1;
    const barDur = (60 / track.bpm) * 4;
    for (let t = 0.1; t < seconds - barDur; t += barDur) playBar(player, player.bar++, t);
    const buf = await off.startRendering();
    ({ ctx, master, duck, reverb, noiseBuf } = saved);
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
    return { name: track.name, peak: +peak.toFixed(3), rmsDb: +(20 * Math.log10(rms)).toFixed(1), bars: player.bar };
  };

  root.Lounge = api;
})(typeof window !== 'undefined' ? window : globalThis);
