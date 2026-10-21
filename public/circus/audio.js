// «Заброшенный цирк»: музыка и звуки на живых сэмплах (Musyng Kite, см. samples/CREDITS.md).
// Две темы, обе написаны по нотам: «Шатёр» — жутковатый цирковой вальс в ре миноре (туба на «раз»,
// расстроенное пианино и аккордеон на «два-три», «каллиопа» — флейта со свистом в октаву, музыкальная
// шкатулка колокольчиков, во втором куплете скрипка, в припеве хор шёпотом) и «Номер с ножами» —
// нервное танго (контрабас хабанерой, отрывистый аккордеон, скрипка, нарастающая дробь литавр).
// window.CircusAudio: unlock(), setActive(on), music(theme), sfx(name, arg), toggle().
(function (root) {
  'use strict';

  const SAMPLE_DIR = 'samples';
  const SETS = {
    tuba: { lo: 24, hi: 60, gain: 1.0, attack: 0.01, release: 0.12, lp: 1400 },
    contrabass: { lo: 24, hi: 57, gain: 0.8, attack: 0.01, release: 0.15, lp: 1200 },
    accordion: { lo: 48, hi: 84, gain: 0.9, attack: 0.02, release: 0.12, lp: 4200 },
    honkytonk: { lo: 36, hi: 90, gain: 0.9, attack: 0.003, release: 0.35, lp: 5200 },
    flute: { lo: 60, hi: 96, gain: 0.55, attack: 0.03, release: 0.12, lp: 6000 },
    whistle: { lo: 60, hi: 96, gain: 0.65, attack: 0.06, release: 0.2, lp: 7000 },
    glock: { lo: 72, hi: 96, gain: 0.55, attack: 0.001, release: 0.9, lp: 9000 },
    vibes: { lo: 48, hi: 96, gain: 0.7, attack: 0.002, release: 1.2, lp: 7000 },
    fiddle: { lo: 57, hi: 96, gain: 0.85, attack: 0.03, release: 0.15, lp: 5200 },
    strings: { lo: 36, hi: 84, gain: 0.7, attack: 0.1, release: 0.4, lp: 4200 },
    choir: { lo: 48, hi: 78, gain: 0.7, attack: 0.25, release: 0.6, lp: 3500 },
    bells: { lo: 60, hi: 84, gain: 0.8, attack: 0.002, release: 1.6, lp: 6000 },
    timpani: { lo: 36, hi: 60, gain: 1.1, attack: 0.003, release: 0.8, lp: 2400 },
  };
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(s) {
    const m = /^([A-G])([b#]?)(\d)$/.exec(s);
    if (!m) throw new Error(`Нота? ${s}`);
    return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
  }
  // Мелодия: «нота:длина» в шестнадцатых, такты через «|», r — пауза. ticks — шестнадцатых в такте.
  function melody(text, ticks) {
    return text.split('|').map((bar, i) => {
      let tick = 0;
      const notes = [];
      for (const tok of bar.trim().split(/\s+/)) {
        const [n, l] = tok.split(':');
        const len = Number(l);
        if (n !== 'r') notes.push({ tick, midi: midi(n), len });
        tick += len;
      }
      if (tick !== ticks) throw new Error(`Такт ${i + 1}: ${tick} шестнадцатых вместо ${ticks}`);
      return notes;
    });
  }
  const CHORDS = {
    Dm: [2, 5, 9], A7: [9, 1, 4, 7], A: [9, 1, 4], Gm: [7, 10, 2], F: [5, 9, 0], C7: [0, 4, 7, 10], Bb: [10, 2, 5], Edim: [4, 7, 10],
  };
  const voice = (ch, lo) => CHORDS[ch].slice(0, 3).map((pc) => lo + (((pc - lo) % 12) + 12) % 12).sort((a, b) => a - b);
  const rootOf = (ch, lo) => lo + (((CHORDS[ch][0] - lo) % 12) + 12) % 12;
  const fifthOf = (ch, lo) => lo + (((CHORDS[ch][2] - lo) % 12) + 12) % 12;

  // ---------- Партитуры ----------
  // «Шатёр»: вальс 3/4, 12 шестнадцатых в такте.
  const A_CH = ['Dm', 'Dm', 'A7', 'A7', 'Gm', 'Dm', 'A7', 'Dm'];
  const A_MEL = melody(`
    D5:3 E5:1 F5:4 A5:4 | G#5:2 A5:2 F5:4 D5:4 | C#5:3 D5:1 E5:4 G5:4 | F5:2 E5:2 C#5:4 A4:4 |
    Bb4:3 C5:1 D5:4 G5:4 | F5:2 E5:2 D5:4 A4:4 | C#5:2 E5:2 G5:4 Bb5:4 | A5:4 D5:8`, 12);
  const B_CH = ['F', 'C7', 'F', 'Dm', 'Gm', 'Dm', 'A', 'Dm'];
  const B_MEL = melody(`
    C6:6 A5:6 | Bb5:4 G5:2 E5:6 | A5:4 F5:2 C5:6 | D5:3 F5:1 A5:8 |
    G5:4 Bb5:2 D6:6 | D6:3 C6:1 A5:4 F5:4 | E5:4 G5:2 C#6:6 | D6:12`, 12);
  // Ответ шкатулки в конце куплета: хроматика вниз.
  const FILL = ['A5', 'G#5', 'G5', 'F#5'].map((n, k) => ({ tick: 4 + k * 2, midi: midi(n), len: 2 }));
  // «Номер с ножами»: танго 4/4, 16 шестнадцатых в такте.
  const K_CH = ['Dm', 'Dm', 'Gm', 'Gm', 'A', 'A', 'Dm', 'A'];
  const K_MEL = melody(`
    A4:6 Bb4:2 A4:4 F4:4 | D5:6 E5:2 F5:4 D5:4 | G5:6 F5:2 E5:4 D5:4 | Bb4:12 r:4 |
    C#5:6 D5:2 E5:4 G5:4 | F5:6 E5:2 D5:4 C#5:4 | D5:4 F5:4 A5:4 D6:4 | C#6:12 r:4`, 16);

  function section(chords, opts) {
    return chords.map((ch, i) => ({ chord: ch, i, ...opts, mel: opts.mel ? opts.mel[i] : null }));
  }
  // Громкость темы: выравнивает темы между собой и с джазом зала (~−25 дБ). Подобрано _renderTest.
  const THEME_GAIN = { base: 2.1, knives: 2.9 };
  const THEMES = {
    base: {
      step: 60 / 138 / 4,
      ticks: 12,
      bars: [
        ...section(['Dm', 'A7'], { part: 'intro' }),
        ...section(A_CH, { part: 'A', lead: 'calliope', mel: A_MEL }),
        ...section(A_CH, { part: 'A', lead: 'fiddle', mel: A_MEL, box: true }),
        ...section(B_CH, { part: 'B', lead: 'calliope', mel: B_MEL, box: true }),
        ...section(A_CH, { part: 'A', lead: 'calliope', mel: A_MEL, fiddle: true }),
      ],
      loopFrom: 2,
    },
    knives: {
      step: 60 / 104 / 4,
      ticks: 16,
      bars: [
        ...section(['Dm', 'Dm'], { part: 'roll' }),
        ...section(K_CH, { part: 'tango', mel: K_MEL }),
        ...section(K_CH, { part: 'tango', mel: K_MEL, high: true }),
      ],
      loopFrom: 2,
    },
  };

  // ---------- Звуковой граф ----------
  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let reverb = null;
  let noiseBuf = null;
  const buffers = {};
  const loading = {};
  const STORE = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* без памяти */ } },
  };
  const MUSIC_KEY = 'casino.circus.music';
  const S = { active: false, musicOn: STORE.get(MUSIC_KEY) !== 'off', theme: null, player: null, starting: null, lastTick: 0 };

  function setup(context) {
    if (ctx && !context) return;
    ctx = context || new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    // Мягкое ограничение на выходе (не компрессор: тот сам добавляет громкости).
    const clip = ctx.createWaveShaper();
    const curve = new Float32Array(2049);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / 1024) - 1;
      const a = Math.abs(x);
      curve[i] = Math.sign(x) * (a <= 0.8 ? a : 0.8 + 0.2 * Math.tanh((a - 0.8) / 0.2));
    }
    clip.curve = curve;
    comp.connect(clip).connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(comp);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    // Ревер пустого шатра: гулкий, с ранним отражением от купола.
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.2);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.22;
        const echo = i > ctx.sampleRate * 0.12 && i < ctx.sampleRate * 0.15 ? 1.8 : 1;
        d[i] = lp * echo * (1 - i / len) ** 2.2;
      }
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.34;
    reverb.connect(wet).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    startCanvas();
    applyVolume();
    if (!context && window.Lounge && window.Lounge.onChange) window.Lounge.onChange(applyVolume);
  }

  // Ветер треплет брезент шатра: низкий шум с медленными порывами.
  function startCanvas() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 380;
    const g = ctx.createGain();
    g.gain.value = 0.014;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.011;
    lfo.connect(lfoG).connect(g.gain);
    src.connect(lp).connect(g).connect(musicBus);
    src.start();
    lfo.start();
  }

  function userVol() {
    const v = window.Lounge && window.Lounge.status ? window.Lounge.status().vol : 40;
    return Math.max(0.05, (v / 100) ** 2 * 1.1);
  }
  function applyVolume() {
    if (!ctx) return;
    master.gain.setTargetAtTime(S.active ? userVol() : 0, ctx.currentTime, 0.3);
    musicBus.gain.setTargetAtTime(S.active && S.musicOn ? 1 : 0, ctx.currentTime, 0.6);
    const sfxOn = typeof soundOn === 'undefined' ? true : soundOn;
    sfxBus.gain.setTargetAtTime(sfxOn ? 0.9 : 0, ctx.currentTime, 0.1);
  }

  function loadInstrument(inst) {
    if (loading[inst]) return loading[inst];
    const set = SETS[inst];
    const map = new Map();
    const jobs = [];
    for (let m = set.lo; m <= set.hi; m += 3) {
      jobs.push(fetch(`${SAMPLE_DIR}/${inst}/${m}.mp3`)
        .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(r.status))))
        .then((data) => ctx.decodeAudioData(data))
        .then((buf) => map.set(m, { buf, norm: normOf(buf) }))
        .catch(() => {}));
    }
    loading[inst] = Promise.all(jobs).then(() => { buffers[inst] = map; });
    return loading[inst];
  }
  function normOf(buf) {
    const d = buf.getChannelData(0);
    const n = Math.min(d.length, Math.floor(buf.sampleRate * 0.6));
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < n; i++) {
      sum += d[i] * d[i];
      peak = Math.max(peak, Math.abs(d[i]));
    }
    return Math.min(12, 0.12 / Math.max(Math.sqrt(sum / Math.max(1, n)), 1e-4), 1.1 / Math.max(peak, 1e-4));
  }

  function playNote(inst, out, t, m, dur, vel, opts = {}) {
    const map = buffers[inst];
    if (!map || !map.size) return null;
    let best = null;
    for (const k of map.keys()) if (best === null || Math.abs(k - m) < Math.abs(best - m)) best = k;
    const a = SETS[inst];
    const { buf, norm } = map.get(best);
    const src = ctx.createBufferSource();
    src.buffer = buf;
    // Старый цирк: пианино расстроено, шкатулка чуть плывёт.
    const detune = inst === 'honkytonk' ? (Math.random() - 0.5) * 22 : inst === 'glock' || inst === 'vibes' ? (Math.random() - 0.5) * 10 : 0;
    src.playbackRate.value = 2 ** ((m - best) / 12 + detune / 1200);
    const g = ctx.createGain();
    const peak = vel * norm * a.gain * 0.22;
    const attack = opts.attack ?? a.attack;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.setValueAtTime(peak, t + Math.max(attack, dur));
    g.gain.setTargetAtTime(0.0001, t + Math.max(attack, dur), (opts.release ?? a.release) / 3);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = opts.lp ?? a.lp;
    src.connect(lp).connect(g).connect(out);
    if (opts.send !== false) {
      const s = ctx.createGain();
      s.gain.value = opts.send ?? 0.45;
      g.connect(s).connect(reverb);
    }
    src.start(t);
    src.stop(t + dur + (opts.release ?? a.release) * 2 + 0.05);
    return src;
  }

  // ---------- Синтез: ударные ----------
  function noise(t, dur, out, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.002, decay = 0.1, sweepTo = null, send = 0 } = {}) {
    const s = ctx.createBufferSource();
    s.buffer = noiseBuf;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.setTargetAtTime(0.0001, t + attack, decay);
    s.connect(f).connect(g).connect(out);
    if (send) {
      const sg = ctx.createGain();
      sg.gain.value = send;
      g.connect(sg).connect(reverb);
    }
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + decay * 6);
  }
  function thump(t, out, f0 = 110, f1 = 42, vel = 1, decay = 0.09) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55 * vel, t + 0.004);
    g.gain.setTargetAtTime(0.0001, t + 0.01, decay);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.8);
  }
  const snare = (t, out, vel = 1) => noise(t, 0.08, out, { freq: 2600, q: 0.8, gain: 0.12 * vel, decay: 0.04 });
  const cymbal = (t, out, vel = 1) => noise(t, 1.2, out, { type: 'highpass', freq: 6000, gain: 0.08 * vel, attack: 0.002, decay: 0.45, send: 0.4 });

  // ---------- Проигрыватель тем ----------
  function barOf(theme, index) {
    const T = THEMES[theme];
    if (index < T.bars.length) return T.bars[index];
    const loopLen = T.bars.length - T.loopFrom;
    return T.bars[T.loopFrom + ((index - T.loopFrom) % loopLen)];
  }

  function playBar(p, t0) {
    const T = THEMES[p.theme];
    const st = T.step;
    const bar = barOf(p.theme, p.bar);
    const at = (tick) => t0 + tick * st;
    const out = p.bus;
    const ch = bar.chord;

    if (p.theme === 'base') {
      const intro = bar.part === 'intro';
      const chorus = bar.part === 'B';
      // «Ум-па-па»: туба на раз, пианино и аккордеон на два и три.
      playNote('tuba', out, at(0), rootOf(ch, 36), st * 3.5, intro ? 0.4 : 0.6, { send: 0.2 });
      if (!intro) playNote('contrabass', out, at(0), rootOf(ch, 36), st * 4, 0.3, { send: 0.2 });
      for (const tk of [4, 8]) {
        for (const n of voice(ch, 57)) playNote('honkytonk', out, at(tk), n, st * 2.2, intro ? 0.18 : 0.26, { send: 0.3 });
        if (!intro) for (const n of voice(ch, 60)) playNote('accordion', out, at(tk), n, st * 2, 0.14, { send: 0.3 });
      }
      // Тарелочка и барабан марша на сильную долю.
      if (!intro) {
        thump(at(0), out, 90, 45, 0.3);
        snare(at(4), out, 0.6);
        snare(at(8), out, 0.6);
      }
      // Тёмные струнные под всем, в припеве — хор шёпотом.
      for (const n of voice(ch, chorus ? 55 : 50)) playNote('strings', out, at(0), n, st * 11.8, intro ? 0.12 : 0.14, { send: 0.6 });
      if (chorus && bar.i % 2 === 0) for (const n of voice(ch, 57)) playNote('choir', out, at(0), n, st * 23, 0.16, { send: 0.9 });
      if (bar.i === 0 && !intro) playNote('bells', out, at(0), chorus ? midi('F5') : midi('D5'), 1.6, 0.32, { send: 0.8 });
      // Вступление — шкатулка одна.
      if (intro) {
        const box = bar.i === 0 ? ['D6', 'F6', 'A6', 'G#6'] : ['C#6', 'E6', 'G6', 'A6'];
        box.forEach((n, k) => playNote('glock', out, at(k * 3), midi(n), st * 3, 0.4, { send: 0.7 }));
      }
      if (bar.mel) {
        for (const n of bar.mel) {
          const len = n.len * st * 0.92;
          const accent = n.tick === 0 ? 1.12 : 1;
          if (bar.lead === 'calliope') {
            // «Каллиопа»: флейта и свист в октаву — пронзительно и чуть фальшиво.
            playNote('flute', out, at(n.tick), n.midi, len, 0.42 * accent, { send: 0.45 });
            playNote('whistle', out, at(n.tick), n.midi + 12 > 96 ? n.midi : n.midi + 12, len, 0.18 * accent, { send: 0.5 });
          } else {
            playNote('fiddle', out, at(n.tick), n.midi, len, 0.46 * accent, { send: 0.45 });
          }
          if (bar.box && n.len >= 4) playNote('glock', out, at(n.tick), n.midi + 12 > 96 ? n.midi : n.midi + 12, 0.8, 0.26, { send: 0.7 });
          if (bar.fiddle && n.len >= 4) playNote('fiddle', out, at(n.tick), n.midi - 12, len, 0.22, { send: 0.5 });
        }
        if (bar.part === 'A' && bar.i === 7) for (const n of FILL) playNote('vibes', out, at(n.tick), n.midi, n.len * st * 1.4, 0.3, { send: 0.7 });
      }
    } else {
      const roll = bar.part === 'roll';
      // Хабанера контрабаса: раз-и, три, четыре.
      const r = rootOf(ch, 38);
      [[0, r, 3], [3, r, 1], [4, fifthOf(ch, 38), 4], [8, r, 4], [12, fifthOf(ch, 38), 4]].forEach(([tk, n, l]) => playNote('contrabass', out, at(tk), n, l * st * 0.9, tk === 0 ? 0.6 : 0.42, { send: 0.2 }));
      if (!roll) {
        // Отрывистый аккордеон на слабые доли.
        for (const tk of [2, 6, 10, 14]) for (const n of voice(ch, 57)) playNote('accordion', out, at(tk), n, st * 0.9, 0.2, { send: 0.25 });
        for (const n of voice(ch, bar.high ? 60 : 52)) playNote('strings', out, at(0), n, st * 15.5, 0.14, { send: 0.6 });
        snare(at(4), out, 0.5);
        snare(at(12), out, 0.7);
      }
      // Дробь литавр: нарастает к концу каждой четвёрки тактов.
      const rollUp = bar.i % 4 === 3 || roll;
      if (rollUp) for (let k = 0; k < 16; k++) playNote('timpani', out, at(k), rootOf(ch, 38), 0.18, 0.12 + (k / 16) * 0.4);
      else playNote('timpani', out, at(0), rootOf(ch, 38), 0.6, 0.35, { send: 0.4 });
      if (bar.i === 0 && !roll) cymbal(at(0), out, 1);
      if (bar.mel) {
        for (const n of bar.mel) {
          const m = bar.high ? n.midi + 12 : n.midi;
          playNote('fiddle', out, at(n.tick), m > 96 ? n.midi : m, n.len * st * 0.95, 0.5, { send: 0.45 });
          if (bar.high && n.len >= 6) playNote('honkytonk', out, at(n.tick), n.midi, n.len * st * 0.6, 0.26);
        }
      }
    }
  }

  function startTheme(theme) {
    if (!ctx) return;
    if (S.player && S.player.theme === theme) return;
    const needs = {
      base: ['tuba', 'contrabass', 'honkytonk', 'accordion', 'flute', 'whistle', 'glock', 'vibes', 'fiddle', 'strings', 'choir', 'bells'],
      knives: ['contrabass', 'accordion', 'strings', 'timpani', 'fiddle', 'honkytonk'],
    }[theme];
    const token = {};
    S.starting = token;
    Promise.all(needs.map(loadInstrument)).then(() => {
      if (S.starting !== token) return;
      const old = S.player;
      if (old) {
        old.bus.gain.setTargetAtTime(0, ctx.currentTime, 0.5);
        setTimeout(() => old.bus.disconnect(), 4000);
      }
      const bus = ctx.createGain();
      bus.gain.value = 0;
      bus.gain.setTargetAtTime(THEME_GAIN[theme], ctx.currentTime + 0.05, 0.4);
      bus.connect(musicBus);
      S.player = { theme, bus, bar: 0, nextAt: ctx.currentTime + 0.15 };
      S.starting = null;
    });
  }

  function schedule() {
    const p = S.player;
    if (!p || !ctx) return;
    const barDur = THEMES[p.theme].step * THEMES[p.theme].ticks;
    while (p.nextAt < ctx.currentTime + 0.5) {
      if (S.musicOn && S.active) playBar(p, p.nextAt);
      p.nextAt += barDur;
      p.bar += 1;
    }
  }

  // ---------- Звуки игры ----------
  function sfx(name, arg) {
    if (!ctx || !S.active || ctx.state !== 'running') return;
    const sfxOn = typeof soundOn === 'undefined' ? true : soundOn;
    if (!sfxOn) return;
    const t = ctx.currentTime + 0.01;
    const out = sfxBus;
    switch (name) {
      case 'spin':
        noise(t, 0.4, out, { freq: 300, sweepTo: 1800, q: 0.7, gain: 0.1, attack: 0.08, decay: 0.12 });
        break;
      case 'stop':
        thump(t, out, 130 + (arg || 0) * 10, 55, 0.5, 0.05);
        noise(t, 0.04, out, { freq: 1800, q: 3, gain: 0.08, decay: 0.02 });
        break;
      case 'drum':
        // Барабанная дробь распорядителя.
        for (let k = 0; k < 10; k++) snare(t + k * 0.05, out, 0.5 + k * 0.05);
        break;
      case 'mod':
        cymbal(t, out, 0.8);
        ['D5', 'F#5', 'A5', 'D6'].forEach((n, k) => playNote('flute', out, t + k * 0.06, midi(n), 0.3, 0.4, { send: 0.5 }));
        playNote('bells', out, t + 0.24, midi('D5'), 1.2, 0.35);
        break;
      case 'honk':
        // Клаксон клоуна: два гнусавых гудка.
        for (const k of [0, 0.18]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.setValueAtTime(330, t + k);
          o.frequency.exponentialRampToValueAtTime(300, t + k + 0.14);
          const f = ctx.createBiquadFilter();
          f.type = 'bandpass';
          f.frequency.value = 900;
          f.Q.value = 3;
          const g = ctx.createGain();
          g.gain.setValueAtTime(0.0001, t + k);
          g.gain.linearRampToValueAtTime(0.25, t + k + 0.01);
          g.gain.setTargetAtTime(0.0001, t + k + 0.1, 0.03);
          o.connect(f).connect(g).connect(out);
          o.start(t + k);
          o.stop(t + k + 0.3);
        }
        break;
      case 'pop':
        noise(t, 0.05, out, { freq: 1500 + Math.random() * 800, q: 4, gain: 0.25, decay: 0.02 });
        playNote('glock', out, t, 84 + Math.floor(Math.random() * 8), 0.2, 0.2);
        break;
      case 'whip':
        noise(t, 0.12, out, { type: 'highpass', freq: 1800, sweepTo: 6000, gain: 0.5, attack: 0.02, decay: 0.03, send: 0.5 });
        noise(t + 0.1, 0.03, out, { freq: 3000, q: 2, gain: 0.6, decay: 0.01, send: 0.6 });
        break;
      case 'fire':
        noise(t, 0.6, out, { type: 'lowpass', freq: 500, sweepTo: 2200, gain: 0.25, attack: 0.05, decay: 0.2 });
        thump(t, out, 70, 40, 0.4, 0.15);
        break;
      case 'target':
        playNote('bells', out, t, midi('A5') + (arg || 0) * 2, 1.4, 0.5, { send: 0.7 });
        snare(t, out, 1);
        break;
      case 'tease':
        playNote('strings', out, t, midi('D3'), 3, 0.25, { attack: 1.5, send: 0.7 });
        playNote('strings', out, t, midi('G#3'), 3, 0.25, { attack: 1.5, send: 0.7 });
        for (let k = 0; k < 20; k++) snare(t + k * 0.08, out, 0.2 + k * 0.03);
        break;
      case 'throw':
        noise(t, 0.25, out, { freq: 900, sweepTo: 4000, q: 1.5, gain: 0.2, attack: 0.03, decay: 0.08 });
        break;
      case 'thunk':
        thump(t, out, 220, 90, 0.8, 0.04);
        noise(t, 0.05, out, { freq: 1200, q: 2, gain: 0.4, decay: 0.02 });
        playNote('timpani', out, t, midi('D3'), 0.3, 0.3);
        break;
      case 'scream':
        // Ассистентка ахает: короткий хор вниз и кластер пианино.
        playNote('choir', out, t, midi('A5'), 0.5, 0.5, { attack: 0.02, send: 0.8 });
        playNote('choir', out, t + 0.2, midi('E5'), 0.6, 0.4, { attack: 0.02, send: 0.8 });
        for (const n of ['D3', 'D#3', 'E3', 'F3']) playNote('honkytonk', out, t, midi(n), 0.8, 0.45);
        cymbal(t, out, 1.2);
        break;
      case 'tick':
        if (performance.now() - S.lastTick < 70) return;
        S.lastTick = performance.now();
        playNote('glock', out, t, 91 + Math.floor(Math.random() * 3), 0.15, 0.18, { send: 0.2, release: 0.2 });
        break;
      case 'win':
        voice('Dm', 74).concat(86).forEach((m, k) => playNote('glock', out, t + k * 0.07, m, 0.4, 0.45));
        break;
      case 'winMid':
        ['D5', 'F5', 'A5', 'D6'].forEach((n, k) => playNote('flute', out, t + k * 0.08, midi(n), 0.3, 0.45));
        voice('Dm', 60).forEach((m) => playNote('accordion', out, t + 0.34, m, 0.5, 0.35));
        playNote('bells', out, t + 0.34, midi('D5'), 1.2, 0.35);
        break;
      case 'scatter':
        cymbal(t, out, 1);
        playNote('bells', out, t, midi('D5'), 2, 0.6, { send: 0.8 });
        ['A5', 'D6'].forEach((n, k) => playNote('whistle', out, t + 0.1 + k * 0.35, midi(n), 0.9, 0.45, { send: 0.8 }));
        break;
      case 'bigwin': {
        ['D5', 'F#5', 'A5', 'D6'].forEach((n, k) => playNote('flute', out, t + k * 0.14, midi(n), k === 3 ? 1.6 : 0.3, 0.6, { send: 0.7 }));
        for (const n of ['D4', 'F#4', 'A4']) playNote('choir', out, t + 0.42, midi(n), 2.4, 0.4, { attack: 0.1, send: 0.9 });
        for (let k = 0; k < 12; k++) snare(t + k * 0.035, out, 0.4 + k * 0.05);
        playNote('timpani', out, t + 0.45, midi('D3'), 1.5, 1);
        cymbal(t + 0.45, out, 1.4);
        playNote('bells', out, t + 0.45, midi('D5'), 2.5, 0.55);
        break;
      }
      case 'click':
        noise(t, 0.03, out, { freq: 3000, q: 3, gain: 0.08, decay: 0.01 });
        break;
      default:
    }
  }

  function preload() {
    for (const inst of Object.keys(SETS)) loadInstrument(inst);
  }
  function unlock() {
    setup();
    if (ctx.state !== 'running') ctx.resume();
    if (S.active) {
      preload();
      if (!S.player && !S.starting) startTheme(S.theme || 'base');
    }
    applyVolume();
  }
  function setActive(on) {
    S.active = on;
    if (window.Lounge && window.Lounge.setHold) window.Lounge.setHold('circus', on && S.musicOn);
    if (window.setMusicHold) window.setMusicHold('circus', on && S.musicOn);   // и песню зала
    if (!ctx) return;
    if (on) {
      if (ctx.state !== 'running') ctx.resume();
      preload();
      if (!S.player) startTheme(S.theme || 'base');
    }
    applyVolume();
  }
  function music(theme) {
    S.theme = theme;
    if (ctx && S.active) startTheme(theme);
  }
  function toggle() {
    S.musicOn = !S.musicOn;
    STORE.set(MUSIC_KEY, S.musicOn ? 'on' : 'off');
    if (window.Lounge && window.Lounge.setHold) window.Lounge.setHold('circus', S.active && S.musicOn);
    if (window.setMusicHold) window.setMusicHold('circus', S.active && S.musicOn);   // и песню зала
    applyVolume();
    return S.musicOn;
  }

  // Проверка без ушей: тема офлайн, пик и громкость (RMS).
  async function renderTest(theme, seconds = 12) {
    const saved = { ctx, master, musicBus, sfxBus, reverb, noiseBuf, active: S.active, musicOn: S.musicOn };
    const sr = 44100;
    const off = new OfflineAudioContext(2, sr * seconds, sr);
    S.active = true;
    S.musicOn = true;
    setup(off);
    master.gain.value = 0.9 ** 2 * 1.1;
    musicBus.gain.value = 1;
    const bus = ctx.createGain();
    bus.gain.value = THEME_GAIN[theme];
    bus.connect(musicBus);
    const p = { theme, bus, bar: 0 };
    const barDur = THEMES[theme].step * THEMES[theme].ticks;
    for (let t = 0.1; t < seconds - barDur; t += barDur) {
      playBar(p, t);
      p.bar += 1;
    }
    const buf = await off.startRendering();
    ({ ctx, master, musicBus, sfxBus, reverb, noiseBuf } = saved);
    S.active = saved.active;
    S.musicOn = saved.musicOn;
    let peak = 0;
    let sum = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        peak = Math.max(peak, Math.abs(d[i]));
        sum += d[i] * d[i];
      }
    }
    return { theme, peak: +peak.toFixed(3), rmsDb: +(20 * Math.log10(Math.sqrt(sum / (buf.length * 2)))).toFixed(1) };
  }

  setInterval(schedule, 60);
  document.addEventListener('pointerdown', () => { if (S.active) unlock(); }, { passive: true });

  root.CircusAudio = {
    unlock, setActive, music, sfx, toggle, isMusicOn: () => S.musicOn,
    _themes: THEMES, _renderTest: renderTest, _load: (insts) => Promise.all(insts.map(loadInstrument)), _setup: () => setup(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
