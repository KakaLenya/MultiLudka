// «Кракен»: музыка и звуки слота на живых сэмплах (Musyng Kite, см. samples/CREDITS.md).
// Три темы, все написаны по нотам: «Сундук глубин» (пиратская шанти 6/8 в ре миноре: аккордеон,
// скрипка, туба «умпа», бубен и колокол; в припеве хор и валторна), «Пробуждение Кракена»
// (шторм: валторна, тайко и литавры, хор, тремоло струнных, быстрая джига скрипки) и «Сундук»
// (ожидание: арфа-остинато, виолончель, литавры-сердце). Под всем — шум моря.
// window.KrakenAudio: unlock(), setActive(on), music(theme), sfx(name, arg), toggle().
(function (root) {
  'use strict';

  const SAMPLE_DIR = 'samples';
  // Ноты скачаны через малую терцию; gain — подстройка тембра поверх общей нормализации громкости.
  const SETS = {
    accordion: { lo: 48, hi: 84, gain: 0.9, attack: 0.02, release: 0.12, lp: 4200 },
    fiddle: { lo: 57, hi: 96, gain: 0.85, attack: 0.03, release: 0.15, lp: 5200 },
    cello: { lo: 36, hi: 72, gain: 0.8, attack: 0.08, release: 0.3, lp: 2600 },
    contrabass: { lo: 24, hi: 57, gain: 0.8, attack: 0.01, release: 0.15, lp: 1200 },
    tuba: { lo: 24, hi: 60, gain: 1.0, attack: 0.01, release: 0.12, lp: 1400 },
    horn: { lo: 36, hi: 72, gain: 0.85, attack: 0.06, release: 0.3, lp: 3000 },
    choir: { lo: 48, hi: 78, gain: 0.7, attack: 0.25, release: 0.6, lp: 3500 },
    timpani: { lo: 36, hi: 60, gain: 1.1, attack: 0.003, release: 0.8, lp: 2400 },
    taiko: { lo: 36, hi: 48, gain: 1.2, attack: 0.002, release: 0.5, lp: 3000 },
    bells: { lo: 60, hi: 84, gain: 0.8, attack: 0.002, release: 1.6, lp: 6000 },
    flute: { lo: 60, hi: 96, gain: 0.55, attack: 0.03, release: 0.12, lp: 6000 },
    harp: { lo: 36, hi: 96, gain: 0.9, attack: 0.002, release: 0.8, lp: 6000 },
    strings: { lo: 36, hi: 84, gain: 0.7, attack: 0.1, release: 0.4, lp: 4200 },
    glock: { lo: 72, hi: 96, gain: 0.55, attack: 0.001, release: 0.9, lp: 9000 },
  };
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(s) {
    const m = /^([A-G])([b#]?)(\d)$/.exec(s);
    if (!m) throw new Error(`Нота? ${s}`);
    return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
  }
  // Мелодия: «нота:длина» (в шестнадцатых; в такте 6/8 их 12), такты через «|», r — пауза.
  function melody(text) {
    return text.split('|').map((bar, i) => {
      let tick = 0;
      const notes = [];
      for (const tok of bar.trim().split(/\s+/)) {
        const [n, l] = tok.split(':');
        const len = Number(l);
        if (n !== 'r') notes.push({ tick, midi: midi(n), len });
        tick += len;
      }
      if (tick !== 12) throw new Error(`Такт ${i + 1}: ${tick} шестнадцатых вместо 12`);
      return notes;
    });
  }
  const CHORDS = {
    Dm: [2, 5, 9], C: [0, 4, 7], Bb: [10, 2, 5], A: [9, 1, 4], F: [5, 9, 0], Gm: [7, 10, 2], G: [7, 11, 2], D: [2, 6, 9], Am: [9, 0, 4], E: [4, 8, 11],
  };
  // Аккорд в диапазоне [lo, lo+12): ноты по возрастанию.
  function voice(ch, lo) {
    return CHORDS[ch].map((pc) => lo + (((pc - lo) % 12) + 12) % 12).sort((a, b) => a - b);
  }
  const rootOf = (ch, lo) => lo + (((CHORDS[ch][0] - lo) % 12) + 12) % 12;
  const fifthOf = (ch, lo) => lo + (((CHORDS[ch][2] - lo) % 12) + 12) % 12;

  // ---------- Партитуры ----------
  // Основная тема: шанти «Сундук глубин».
  const A_CH = ['Dm', 'C', 'Bb', 'A', 'Dm', 'C', 'Bb', 'Dm'];
  const A_MEL = melody(`
    A4:4 D5:2 D5:2 E5:2 F5:2 | E5:4 C5:2 C5:4 E5:2 | D5:4 Bb4:2 F5:4 D5:2 | C#5:6 A4:6 |
    A4:2 D5:2 F5:2 A5:4 G5:2 | G5:2 F5:2 E5:2 C5:4 E5:2 | F5:2 E5:2 D5:2 C#5:4 E5:2 | D5:6 r:6`);
  const B_CH = ['F', 'C', 'Dm', 'A', 'F', 'C', 'Bb', 'Dm'];
  const B_MEL = melody(`
    A5:6 F5:6 | G5:4 E5:2 C5:6 | F5:4 E5:2 D5:4 F5:2 | E5:12 |
    A5:4 A5:2 Bb5:4 A5:2 | G5:4 E5:2 C5:4 E5:2 | F5:4 D5:2 E5:4 C#5:2 | D5:12`);
  // Ответ скрипки в паузе восьмого такта.
  const FILL = [{ tick: 6, midi: midi('A5'), len: 2 }, { tick: 8, midi: midi('G5'), len: 2 }, { tick: 10, midi: midi('E5'), len: 2 }];

  // Шторм: героическая тема валторны.
  const S_CH = ['Dm', 'Bb', 'C', 'A', 'Dm', 'Bb', 'Gm', 'A'];
  const S_MEL = melody(`
    D5:6 A4:6 | Bb4:4 C5:2 D5:6 | E5:6 C5:6 | C#5:12 |
    D5:4 E5:2 F5:6 | G5:4 F5:2 D5:6 | E5:4 F5:2 G5:4 E5:2 | A5:12`);

  // Сундук: медленная гармония под арфу.
  const H_CH = ['Dm', 'Bb', 'Gm', 'A', 'Dm', 'F', 'Gm', 'A'];

  // Тема = список тактов: { chord, parts } по разделам; повтор с loopFrom.
  function section(chords, opts) {
    return chords.map((chord, i) => ({ chord, i, ...opts, mel: opts.mel ? opts.mel[i] : null }));
  }
  const THEMES = {
    base: {
      step: 60 / 76 / 6,          // шестнадцатая при ♩. = 76
      bars: [
        ...section(['Dm', 'Dm'], { part: 'intro' }),
        ...section(A_CH, { part: 'A', lead: 'accordion', mel: A_MEL }),
        ...section(A_CH, { part: 'A', lead: 'fiddle', mel: A_MEL, double: 'flute' }),
        ...section(B_CH, { part: 'B', lead: 'accordion', mel: B_MEL, double: 'fiddle' }),
        ...section(A_CH, { part: 'A', lead: 'accordion', mel: A_MEL, double: 'flute' }),
        ...section(['Dm', 'A'], { part: 'turn' }),
      ],
      loopFrom: 2,
    },
    fs: {
      step: 60 / 96 / 6,
      bars: [
        ...section(['Dm', 'Dm'], { part: 'storm-in' }),
        ...section(S_CH, { part: 'storm', lead: 'horn', mel: S_MEL }),
        ...section(S_CH, { part: 'jig', lead: 'fiddle' }),
        ...section(S_CH, { part: 'storm', lead: 'horn', mel: S_MEL, double: 'strings' }),
      ],
      loopFrom: 2,
    },
    hw: {
      step: 60 / 62 / 6,
      bars: section(H_CH, { part: 'chest' }),
      loopFrom: 0,
    },
  };

  // ---------- Звуковой граф ----------
  let ctx = null;
  let master = null;
  let musicBus = null;
  let sfxBus = null;
  let reverb = null;
  let noiseBuf = null;
  let sea = null;
  const buffers = {};        // инструмент -> Map(midi -> { buf, norm })
  const loading = {};
  const STORE = {
    get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
    set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* без памяти */ } },
  };
  const MUSIC_KEY = 'casino.kraken.music';
  const S = {
    active: false,
    musicOn: STORE.get(MUSIC_KEY) !== 'off',
    theme: null,
    player: null,
    timer: null,
    lastTick: 0,
  };

  // context: свой контекст (офлайн-рендер в проверках), иначе обычный.
  function setup(context) {
    if (ctx && !context) return;
    ctx = context || new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.01;
    comp.release.value = 0.25;
    comp.connect(ctx.destination);
    master = ctx.createGain();
    master.gain.value = 0;
    master.connect(comp);
    musicBus = ctx.createGain();
    musicBus.gain.value = 0;
    musicBus.connect(master);
    sfxBus = ctx.createGain();
    sfxBus.gain.value = 0.9;
    sfxBus.connect(master);
    // Ревер «трюма»: длинный, тёмный.
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 2.8);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.25;
        d[i] = lp * (1 - i / len) ** 2.4;
      }
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.32;
    reverb.connect(wet).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    startSea();
    applyVolume();
    if (!context && window.Lounge && window.Lounge.onChange) window.Lounge.onChange(applyVolume);
  }

  // Шум моря: медленные волны отфильтрованного шума.
  function startSea() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 500;
    const g = ctx.createGain();
    g.gain.value = 0.02;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 0.018;
    lfo.connect(lfoG).connect(g.gain);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.07;
    const lfo2G = ctx.createGain();
    lfo2G.gain.value = 260;
    lfo2.connect(lfo2G).connect(lp.frequency);
    src.connect(lp).connect(g).connect(musicBus);
    src.start();
    lfo.start();
    lfo2.start();
    sea = { g };
  }

  function userVol() {
    const v = window.Lounge && window.Lounge.status ? window.Lounge.status().vol : 40;
    return Math.max(0.05, (v / 100) ** 2 * 1.1);
  }
  function applyVolume() {
    if (!ctx) return;
    const on = S.active;
    master.gain.setTargetAtTime(on ? userVol() : 0, ctx.currentTime, 0.3);
    musicBus.gain.setTargetAtTime(on && S.musicOn ? 1 : 0, ctx.currentTime, 0.6);
    const sfxOn = typeof soundOn === 'undefined' ? true : soundOn;   // общий звук зала
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
  // Сэмплы записаны с разной громкостью: выравниваем по громкости начала ноты.
  function normOf(buf) {
    const d = buf.getChannelData(0);
    const n = Math.min(d.length, Math.floor(buf.sampleRate * 0.6));
    let sum = 0;
    for (let i = 0; i < n; i++) sum += d[i] * d[i];
    const rms = Math.sqrt(sum / Math.max(1, n));
    return Math.min(12, 0.12 / Math.max(rms, 1e-4));
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
    src.playbackRate.value = 2 ** ((m - best) / 12);
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
      s.gain.value = opts.send ?? 0.5;
      g.connect(s).connect(reverb);
    }
    src.start(t);
    src.stop(t + dur + (opts.release ?? a.release) * 2 + 0.05);
    return src;
  }

  // ---------- Синтез: ударные и шорохи ----------
  function noise(t, dur, out, { type = 'bandpass', freq = 1000, q = 1, gain = 0.3, attack = 0.002, decay = 0.1, sweepTo = null } = {}) {
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
    s.start(t, Math.random() * 1.5);
    s.stop(t + dur + decay * 5);
  }
  function kick(t, out, vel = 1) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(110, t);
    o.frequency.exponentialRampToValueAtTime(42, t + 0.18);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.55 * vel, t + 0.004);
    g.gain.setTargetAtTime(0.0001, t + 0.01, 0.09);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.6);
  }
  // Бубен / рамочный барабан: шлепок с призвуком.
  function frame(t, out, vel = 1) {
    noise(t, 0.12, out, { freq: 900, q: 0.8, gain: 0.22 * vel, decay: 0.05 });
    noise(t, 0.2, out, { type: 'highpass', freq: 7000, gain: 0.07 * vel, decay: 0.08 });
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(140, t + 0.1);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.18 * vel, t + 0.003);
    g.gain.setTargetAtTime(0.0001, t + 0.01, 0.05);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + 0.4);
  }
  function shaker(t, out, vel = 1) {
    noise(t, 0.06, out, { type: 'highpass', freq: 6000, gain: 0.05 * vel, attack: 0.01, decay: 0.03 });
  }

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
    const swing = (tick) => (tick % 4 === 2 ? st * 0.08 : 0);   // чуть «качает»

    if (p.theme === 'base') {
      const quiet = bar.part === 'intro' || bar.part === 'turn';
      // Туба «ум-па»: корень на раз, квинта на четыре.
      playNote('tuba', out, at(0), rootOf(ch, 38), st * 3.5, 0.55, { send: 0.2 });
      playNote('tuba', out, at(6), fifthOf(ch, 33), st * 3, 0.45, { send: 0.2 });
      playNote('contrabass', out, at(0), rootOf(ch, 38), st * 4, 0.35, { send: 0.2 });
      // Аккордеон «па-па» на слабые восьмые.
      const v = voice(ch, 57);
      for (const tk of [2, 4, 8, 10]) for (const n of v) playNote('accordion', out, at(tk) + swing(tk), n, st * 1.4, bar.lead === 'accordion' ? 0.18 : 0.26, { send: 0.3 });
      // Ударные.
      kick(at(0), out, 0.5);
      kick(at(6), out, 0.4);
      if (!quiet || bar.i === 1) {
        frame(at(4), out, 0.9);
        frame(at(10), out, 0.9);
        for (let tk = 0; tk < 12; tk += 2) shaker(at(tk) + swing(tk), out, tk % 6 === 0 ? 1 : 0.6);
      }
      // Колокол: в начале каждого раздела.
      if (bar.i === 0) playNote('bells', out, at(0), bar.part === 'B' ? midi('A5') : midi('D5'), 1.5, 0.35, { send: 0.7 });
      // Арфа переливается во вступлении и в припеве.
      if (bar.part === 'intro' || bar.part === 'B' || bar.part === 'turn') {
        const arp = [...voice(ch, 62), ...voice(ch, 74)];
        [0, 2, 4, 6, 8, 10].forEach((tk, k) => playNote('harp', out, at(tk), arp[k % arp.length], st * 4, 0.28, { send: 0.6 }));
      }
      // Хор и валторна в припеве.
      if (bar.part === 'B') {
        for (const n of voice(ch, 60)) playNote('choir', out, at(0), n, st * 11.5, 0.22, { send: 0.8 });
        playNote('horn', out, at(0), voice(ch, 53)[1], st * 11, 0.25, { send: 0.6 });
      }
      // Мелодия.
      if (bar.mel) {
        for (const n of bar.mel) {
          const accent = n.tick === 0 ? 1.12 : 1;
          playNote(bar.lead, out, at(n.tick) + swing(n.tick), n.midi, n.len * st * 0.92, 0.5 * accent, { send: 0.45 });
          if (bar.double) playNote(bar.double, out, at(n.tick) + swing(n.tick), n.midi + (bar.double === 'flute' ? 12 : 0), n.len * st * 0.9, bar.double === 'flute' ? 0.22 : 0.3, { send: 0.5 });
        }
        if (bar.part === 'A' && bar.i === 7) for (const n of FILL) playNote('fiddle', out, at(n.tick), n.midi, n.len * st * 0.9, 0.35);
      }
    } else if (p.theme === 'fs') {
      const intro = bar.part === 'storm-in';
      // Барабаны шторма: тайко на раз и четыре, литавры на корень, кик бегом.
      playNote('taiko', out, at(0), 41, 0.6, 0.9, { send: 0.5 });
      playNote('taiko', out, at(6), 38, 0.5, 0.75, { send: 0.5 });
      if (!intro) {
        playNote('taiko', out, at(9), 41, 0.3, 0.45, { send: 0.4 });
        kick(at(3), out, 0.5);
        kick(at(10), out, 0.4);
        for (let tk = 0; tk < 12; tk += 2) shaker(at(tk), out, 0.8);
      }
      playNote('timpani', out, at(0), rootOf(ch, 38), 1.2, 0.6, { send: 0.5 });
      if (bar.i % 2 === 1) for (let k = 0; k < 4; k++) playNote('timpani', out, at(8 + k), rootOf(ch, 38), 0.2, 0.25 + k * 0.08);
      // Тремоло струнных: шестнадцатые на корне и квинте.
      for (let tk = 0; tk < 12; tk++) playNote('strings', out, at(tk), tk % 2 ? fifthOf(ch, 50) : rootOf(ch, 50), st * 0.9, 0.18, { attack: 0.01, release: 0.08, send: 0.3 });
      playNote('tuba', out, at(0), rootOf(ch, 36), st * 5, 0.7, { send: 0.2 });
      playNote('tuba', out, at(6), rootOf(ch, 36), st * 5, 0.55, { send: 0.2 });
      if (!intro) for (const n of voice(ch, 60)) playNote('choir', out, at(0), n, st * 11.5, 0.32, { send: 0.8 });
      if (bar.part === 'storm' && bar.mel) {
        for (const n of bar.mel) {
          playNote('horn', out, at(n.tick), n.midi - 12, n.len * st * 0.95, 0.7, { send: 0.55 });
          if (bar.double) playNote('strings', out, at(n.tick), n.midi, n.len * st * 0.95, 0.3, { send: 0.5 });
        }
      }
      if (bar.part === 'jig') {
        // Скрипка: бегущая джига по звукам аккорда с проходящими нотами.
        const v = [...voice(ch, 69), ...voice(ch, 81)];
        const run = [0, 1, 2, 3, 2, 1, 0, 1, 2, 4, 3, 2];
        run.forEach((k, tk) => playNote('fiddle', out, at(tk), v[k % v.length], st * 0.85, tk % 6 === 0 ? 0.42 : 0.3, { send: 0.35 }));
        for (const n of voice(ch, 57)) for (const tk of [2, 4, 8, 10]) playNote('accordion', out, at(tk), n, st * 1.2, 0.2);
        playNote('horn', out, at(0), voice(ch, 53)[1], st * 11, 0.3, { send: 0.6 });
      }
    } else {
      // Сундук: арфа по кругу, виолончель тянет корень, литавры — сердце.
      const arp = [...voice(ch, 62), voice(ch, 62)[0] + 12];
      const order = [0, 1, 2, 3, 2, 1];
      order.forEach((k, j) => playNote('harp', out, at(j * 2), arp[k], st * 6, 1.1, { send: 0.7 }));
      playNote('cello', out, at(0), rootOf(ch, 38), st * 11.5, 1.1, { send: 0.5 });
      playNote('strings', out, at(0), voice(ch, 57)[1], st * 11.5, 0.5, { send: 0.6 });
      playNote('timpani', out, at(0), rootOf(ch, 38), 0.6, 1.2, { send: 0.3 });
      playNote('timpani', out, at(2), rootOf(ch, 38), 0.4, 0.8, { send: 0.3 });
      if (bar.i % 2 === 0) for (const n of voice(ch, 60)) playNote('choir', out, at(0), n, st * 23, 0.4, { send: 0.9 });
      if (Math.random() < 0.6) playNote('glock', out, at(6 + 2 * Math.floor(Math.random() * 3)), voice(ch, 86)[Math.floor(Math.random() * 3)], 0.6, 0.6, { send: 0.9 });
    }
  }

  function startTheme(theme) {
    if (!ctx) return;
    if (S.player && S.player.theme === theme) return;
    const needs = { base: ['tuba', 'contrabass', 'accordion', 'fiddle', 'flute', 'bells', 'harp', 'choir', 'horn'], fs: ['taiko', 'timpani', 'strings', 'tuba', 'choir', 'horn', 'fiddle', 'accordion'], hw: ['harp', 'cello', 'strings', 'timpani', 'choir', 'glock'] }[theme];
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
      bus.gain.setTargetAtTime(1, ctx.currentTime + 0.05, 0.4);
      bus.connect(musicBus);
      S.player = { theme, bus, bar: 0, nextAt: ctx.currentTime + 0.15 };
      S.starting = null;
    });
  }

  function schedule() {
    const p = S.player;
    if (!p || !ctx) return;
    const barDur = THEMES[p.theme].step * 12;
    while (p.nextAt < ctx.currentTime + 0.5) {
      if (S.musicOn && S.active) playBar(p, p.nextAt);
      p.nextAt += barDur;
      p.bar += 1;
    }
  }

  // ---------- Звуки игры ----------
  function sfx(name, arg) {
    if (!ctx || !S.active) return;
    if (ctx.state !== 'running') return;
    const t = ctx.currentTime + 0.01;
    const out = sfxBus;
    const sfxOn = typeof soundOn === 'undefined' ? true : soundOn;
    if (!sfxOn) return;
    switch (name) {
      case 'spin':
        noise(t, 0.4, out, { freq: 400, sweepTo: 2400, q: 0.7, gain: 0.12, attack: 0.08, decay: 0.12 });
        break;
      case 'stop': {
        const o = ctx.createOscillator();
        const g = ctx.createGain();
        o.frequency.setValueAtTime(150 + arg * 12, t);
        o.frequency.exponentialRampToValueAtTime(60, t + 0.12);
        g.gain.setValueAtTime(0.0001, t);
        g.gain.linearRampToValueAtTime(0.35, t + 0.003);
        g.gain.setTargetAtTime(0.0001, t + 0.01, 0.05);
        o.connect(g).connect(out);
        o.start(t);
        o.stop(t + 0.3);
        noise(t, 0.05, out, { freq: 2500, q: 2, gain: 0.08, decay: 0.02 });
        break;
      }
      case 'pearl':
        playNote('glock', out, t, [86, 88, 90, 93, 95][Math.floor(Math.random() * 5)], 0.5, 0.45, { send: 0.6 });
        playNote('harp', out, t + 0.03, 74, 0.6, 0.3, { send: 0.6 });
        break;
      case 'map':
        playNote('bells', out, t, 74 + (arg || 0) * 2, 1.5, 0.55, { send: 0.7 });
        playNote('glock', out, t, 86 + (arg || 0) * 2, 0.8, 0.4);
        break;
      case 'kraken':
        playNote('tuba', out, t, 33, 0.5, 0.7, { lp: 600 });
        playNote('taiko', out, t, 38, 0.5, 0.6);
        break;
      case 'tease':
        playNote('strings', out, t, 50, 3, 0.25, { attack: 1.5, send: 0.7 });
        playNote('strings', out, t, 57, 3, 0.25, { attack: 1.5, send: 0.7 });
        break;
      case 'tentacle':
        playNote('taiko', out, t, 36, 0.8, 1, { send: 0.6 });
        playNote('timpani', out, t + 0.05, 38, 1.5, 0.9, { send: 0.6 });
        playNote('tuba', out, t + 0.1, 26, 1.4, 0.9, { lp: 500 });
        playNote('horn', out, t + 0.1, 38, 1.2, 0.5, { lp: 900 });
        noise(t, 1.2, out, { type: 'lowpass', freq: 300, sweepTo: 1600, gain: 0.25, attack: 0.3, decay: 0.4 });
        break;
      case 'collect':
        [74, 77, 81, 86, 89, 93].forEach((m, k) => playNote('harp', out, t + k * 0.045, m, 0.6, 0.35, { send: 0.6 }));
        break;
      case 'coins':
        [86, 90, 93, 98].forEach((m, k) => playNote('glock', out, t + k * 0.06, m, 0.5, 0.35, { send: 0.5 }));
        break;
      case 'tick':
        if (performance.now() - S.lastTick < 70) return;
        S.lastTick = performance.now();
        playNote('glock', out, t, 93 + Math.floor(Math.random() * 3), 0.15, 0.18, { send: 0.2, release: 0.2 });
        break;
      case 'win':
        [62, 65, 69, 74].forEach((m, k) => playNote('accordion', out, t + k * 0.07, m, 0.25, 0.4, { send: 0.4 }));
        break;
      case 'winMid':
        [69, 72, 74, 77, 81, 86].forEach((m, k) => playNote('fiddle', out, t + k * 0.06, m, 0.2, 0.4));
        for (const m of [62, 65, 69]) playNote('accordion', out, t + 0.38, m, 0.6, 0.35);
        playNote('bells', out, t + 0.38, 74, 1.2, 0.35);
        break;
      case 'scatter':
        playNote('bells', out, t, 74, 2, 0.6, { send: 0.8 });
        playNote('bells', out, t + 0.25, 81, 2, 0.5, { send: 0.8 });
        [74, 78, 81, 86].forEach((m, k) => playNote('harp', out, t + k * 0.08, m, 1, 0.35));
        break;
      case 'levelup':
        for (const m of [62, 66, 69]) playNote('choir', out, t, m, 1.6, 0.4, { attack: 0.15, send: 0.9 });
        playNote('taiko', out, t, 38, 0.6, 1);
        playNote('taiko', out, t + 0.2, 41, 0.6, 0.9);
        playNote('horn', out, t + 0.1, 57, 1.2, 0.6);
        playNote('horn', out, t + 0.1, 62, 1.2, 0.5);
        break;
      case 'respin':
        playNote('timpani', out, t, 38, 0.4, 0.5);
        playNote('timpani', out, t + 0.22, 38, 0.4, 0.35);
        break;
      case 'jackpot':
        for (const m of [74, 78, 81]) playNote('bells', out, t, m, 2, 0.45, { send: 0.8 });
        break;
      case 'bigwin': {
        // Фанфара: ре минор разрешается в ре мажор.
        for (const m of [50, 57, 62, 66]) playNote('horn', out, t, m, 2.4, 0.55, { send: 0.7 });
        for (const m of [62, 66, 69, 74]) playNote('choir', out, t, m, 2.6, 0.4, { attack: 0.1, send: 0.9 });
        for (let k = 0; k < 8; k++) playNote('timpani', out, t + k * 0.06, 38, 0.3, 0.3 + k * 0.06);
        playNote('timpani', out, t + 0.5, 38, 1.5, 1);
        playNote('bells', out, t + 0.5, 74, 2.5, 0.55);
        [74, 78, 81, 86, 90, 93].forEach((m, k) => playNote('glock', out, t + 0.5 + k * 0.07, m, 0.6, 0.35));
        break;
      }
      case 'click':
        noise(t, 0.03, out, { freq: 3000, q: 3, gain: 0.08, decay: 0.01 });
        break;
      default:
    }
  }

  // ---------- Наружу ----------
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
    if (window.Lounge && window.Lounge.setHold) window.Lounge.setHold('kraken', on && S.musicOn);
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
    if (window.Lounge && window.Lounge.setHold) window.Lounge.setHold('kraken', S.active && S.musicOn);
    applyVolume();
    return S.musicOn;
  }

  setInterval(schedule, 60);
  // Браузер даёт звук только после жеста: первый клик на странице будит контекст, если вкладка открыта.
  document.addEventListener('pointerdown', () => { if (S.active) unlock(); }, { passive: true });

  // Проверка без ушей: тема офлайн, пик и громкость (RMS).
  async function renderTest(theme, seconds = 12) {
    const saved = { ctx, master, musicBus, sfxBus, reverb, noiseBuf, sea, active: S.active, musicOn: S.musicOn };
    const sr = 44100;
    const off = new OfflineAudioContext(2, sr * seconds, sr);
    S.active = true;
    S.musicOn = true;
    setup(off);
    master.gain.value = 0.9 ** 2 * 1.1;
    musicBus.gain.value = 1;
    const T = THEMES[theme];
    const bus = ctx.createGain();
    bus.connect(musicBus);
    const p = { theme, bus, bar: 0 };
    const barDur = T.step * 12;
    for (let t = 0.1; t < seconds - barDur; t += barDur) {
      playBar(p, t);
      p.bar += 1;
    }
    const buf = await off.startRendering();
    ({ ctx, master, musicBus, sfxBus, reverb, noiseBuf, sea } = saved);
    S.active = saved.active;
    S.musicOn = saved.musicOn;
    let peak = 0;
    let sum = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > peak) peak = v;
        sum += d[i] * d[i];
      }
    }
    return { theme, peak: +peak.toFixed(3), rmsDb: +(20 * Math.log10(Math.sqrt(sum / (buf.length * 2)))).toFixed(1), buffer: buf };
  }

  root.KrakenAudio = { _renderTest: renderTest, _load: (insts) => Promise.all(insts.map(loadInstrument)), _setup: () => setup(), unlock, setActive, music, sfx, toggle, isMusicOn: () => S.musicOn, _themes: THEMES, _melody: melody };
})(typeof window !== 'undefined' ? window : globalThis);
