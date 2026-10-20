// «Салун мертвецов»: музыка и звуки на живых сэмплах (Musyng Kite, см. samples/CREDITS.md).
// Две темы, обе написаны по нотам: «Салун» — жутковато-весёлый рэгтайм в ми миноре
// (расстроенное пианино страйдом, банджо, губная гармошка, в припеве — соль мажор) и
// «Дуэль» — в духе вестернов Морриконе (свист, твэнг-гитара, хор, колокол, литавры,
// во второй половине — труба марьячи). Звуки: выстрелы, рикошеты, щелчок курка, шпоры.
// window.SaloonAudio: unlock(), setActive(on), music(theme), sfx(name, arg), toggle().
(function (root) {
  'use strict';

  const SAMPLE_DIR = 'samples';
  const SETS = {
    honkytonk: { lo: 36, hi: 90, gain: 0.9, attack: 0.003, release: 0.35, lp: 5200 },
    banjo: { lo: 48, hi: 84, gain: 0.8, attack: 0.002, release: 0.25, lp: 6000 },
    harmonica: { lo: 54, hi: 84, gain: 0.7, attack: 0.03, release: 0.12, lp: 4800 },
    whistle: { lo: 60, hi: 96, gain: 0.65, attack: 0.06, release: 0.2, lp: 7000 },
    twang: { lo: 40, hi: 82, gain: 0.8, attack: 0.003, release: 0.4, lp: 4200 },
    steelgtr: { lo: 40, hi: 82, gain: 0.8, attack: 0.003, release: 0.4, lp: 5200 },
    opentrumpet: { lo: 54, hi: 84, gain: 0.75, attack: 0.03, release: 0.15, lp: 5000 },
    contrabass: { lo: 24, hi: 57, gain: 0.8, attack: 0.01, release: 0.15, lp: 1200 },
    choir: { lo: 48, hi: 78, gain: 0.7, attack: 0.25, release: 0.6, lp: 3500 },
    bells: { lo: 60, hi: 84, gain: 0.8, attack: 0.002, release: 1.6, lp: 6000 },
    timpani: { lo: 36, hi: 60, gain: 1.1, attack: 0.003, release: 0.8, lp: 2400 },
    strings: { lo: 36, hi: 84, gain: 0.7, attack: 0.1, release: 0.4, lp: 4200 },
    glock: { lo: 72, hi: 96, gain: 0.55, attack: 0.001, release: 0.9, lp: 9000 },
  };
  const NOTE = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  function midi(s) {
    const m = /^([A-G])([b#]?)(\d)$/.exec(s);
    if (!m) throw new Error(`Нота? ${s}`);
    return 12 * (Number(m[3]) + 1) + NOTE[m[1]] + (m[2] === 'b' ? -1 : m[2] === '#' ? 1 : 0);
  }
  // Мелодия: «нота:длина» в шестнадцатых (16 на такт 4/4), такты через «|», r — пауза.
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
      if (tick !== 16) throw new Error(`Такт ${i + 1}: ${tick} шестнадцатых вместо 16`);
      return notes;
    });
  }
  const CHORDS = {
    Em: [4, 7, 11], Am: [9, 0, 4], B7: [11, 3, 6, 9], G: [7, 11, 2], D: [2, 6, 9], C: [0, 4, 7],
    F: [5, 9, 0], E: [4, 8, 11], Dm: [2, 5, 9],
  };
  const voice = (ch, lo) => CHORDS[ch].map((pc) => lo + (((pc - lo) % 12) + 12) % 12).sort((a, b) => a - b);
  const rootOf = (ch, lo) => lo + (((CHORDS[ch][0] - lo) % 12) + 12) % 12;
  const fifthOf = (ch, lo) => lo + (((CHORDS[ch][2] - lo) % 12) + 12) % 12;

  // ---------- Партитуры ----------
  const A_CH = [['Em'], ['Em'], ['Am'], ['Em'], ['B7'], ['B7'], ['Em', 'B7'], ['Em']];
  const A_MEL = melody(`
    E4:2 G4:2 B4:4 A4:2 G4:2 E4:4 | G4:2 A4:2 B4:2 D5:2 B4:8 | C5:4 B4:2 A4:2 E5:4 C5:4 | B4:6 G4:2 E4:8 |
    D#4:2 F#4:2 A4:4 B4:4 A4:4 | F#4:2 A4:2 C5:2 B4:2 A4:4 F#4:4 | G4:2 B4:2 E5:4 D#5:4 F#4:4 | E4:8 r:8`);
  const B_CH = [['G'], ['D'], ['Em'], ['B7'], ['C'], ['G'], ['Am', 'B7'], ['Em']];
  const B_MEL = melody(`
    D5:4 B4:2 D5:2 G5:8 | F#5:4 E5:2 D5:2 A4:8 | E5:4 D5:2 B4:2 G4:4 B4:4 | A4:4 B4:4 D#5:8 |
    E5:4 G5:4 E5:2 C5:2 E5:4 | D5:4 B4:4 G4:8 | C5:4 A4:4 B4:4 D#5:4 | E5:12 r:4`);

  const D_CH = [['Am'], ['Am'], ['G'], ['G'], ['F'], ['F'], ['E'], ['E']];
  const D_MEL = melody(`
    A4:8 E5:8 | D5:4 C5:4 B4:8 | G4:8 D5:8 | C5:4 B4:4 A4:8 |
    F4:8 C5:8 | A4:4 G4:4 F4:8 | E4:4 G#4:4 B4:4 D5:4 | E5:16`);
  const T_CH = [['Dm'], ['Am'], ['Dm'], ['E'], ['Am'], ['F'], ['E'], ['E']];
  const T_MEL = melody(`
    A4:6 D5:2 F5:8 | E5:6 C5:2 A4:8 | D5:4 F5:4 A5:8 | G#5:8 E5:8 |
    A5:6 G5:2 E5:8 | F5:6 E5:2 C5:8 | B4:4 D5:4 G#4:4 B4:4 | E5:16`);

  function section(chords, opts) {
    return chords.map((ch, i) => ({ chords: ch, i, ...opts, mel: opts.mel ? opts.mel[i] : null }));
  }
  // Громкость темы: выравнивает темы между собой и с джазом зала (~−25 дБ).
  const THEME_GAIN = { base: 2.4, duel: 2.3 };
  const THEMES = {
    base: {
      step: 60 / 112 / 4,
      bars: [
        ...section([['Em'], ['B7']], { part: 'intro' }),
        ...section(A_CH, { part: 'A', lead: 'harmonica', mel: A_MEL }),
        ...section(A_CH, { part: 'A', lead: 'steelgtr', mel: A_MEL }),
        ...section(B_CH, { part: 'B', lead: 'honkytonk', mel: B_MEL, double: 'banjo' }),
        ...section(A_CH, { part: 'A', lead: 'harmonica', mel: A_MEL, double: 'honkytonk' }),
      ],
      loopFrom: 2,
    },
    duel: {
      step: 60 / 84 / 4,
      bars: [
        ...section([['Am'], ['Am']], { part: 'intro' }),
        ...section(D_CH, { part: 'whistle', lead: 'whistle', mel: D_MEL }),
        ...section(T_CH, { part: 'trumpet', lead: 'opentrumpet', mel: T_MEL }),
        ...section(D_CH, { part: 'whistle', lead: 'whistle', mel: D_MEL, double: 'choir' }),
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
  const MUSIC_KEY = 'casino.saloon.music';
  const S = { active: false, musicOn: STORE.get(MUSIC_KEY) !== 'off', theme: null, player: null, starting: null, lastTick: 0 };

  function setup(context) {
    if (ctx && !context) return;
    ctx = context || new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
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
    // Ревер «каньона»: длинный, с ранним отражением — эхо выстрелов.
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.3;
        const echo = i > ctx.sampleRate * 0.28 && i < ctx.sampleRate * 0.33 ? 2.2 : 1;
        d[i] = lp * echo * (1 - i / len) ** 2.6;
      }
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.3;
    reverb.connect(wet).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    startWind();
    applyVolume();
    if (!context && window.Lounge && window.Lounge.onChange) window.Lounge.onChange(applyVolume);
  }

  // Ветер пустыни: шум с медленно гуляющим фильтром.
  function startWind() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 700;
    bp.Q.value = 2.5;
    const g = ctx.createGain();
    g.gain.value = 0.012;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.08;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 420;
    lfo.connect(lfoG).connect(bp.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.13;
    const lfo2G = ctx.createGain();
    lfo2G.gain.value = 0.009;
    lfo2.connect(lfo2G).connect(g.gain);
    src.connect(bp).connect(g).connect(musicBus);
    src.start();
    lfo.start();
    lfo2.start();
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
  // Выравниваем громкость сэмплов по началу ноты, но не даём щипковым (пианино, банджо) стрелять пиком.
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
    // Расстроенное пианино салуна: каждая нота чуть мимо.
    const detune = inst === 'honkytonk' ? (Math.random() - 0.5) * 18 : 0;
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
    // Тремоло твэнг-гитары, как у вестернов.
    if (inst === 'twang' && opts.tremolo) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 7;
      const lg = ctx.createGain();
      lg.gain.value = peak * 0.45;
      lfo.connect(lg).connect(g.gain);
      lfo.start(t);
      lfo.stop(t + dur + 0.5);
    }
    src.start(t);
    src.stop(t + dur + (opts.release ?? a.release) * 2 + 0.05);
    return src;
  }

  // ---------- Синтез ----------
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
  // Ложки / деревяшка — сухой щелчок.
  function spoons(t, out, vel = 1) {
    noise(t, 0.04, out, { freq: 2200, q: 4, gain: 0.07 * vel, decay: 0.015 });
  }
  function brush(t, out, vel = 1) {
    noise(t, 0.12, out, { type: 'highpass', freq: 3500, gain: 0.06 * vel, attack: 0.01, decay: 0.05 });
  }
  function gunshot(t, out, vel = 1) {
    noise(t, 0.05, out, { type: 'highpass', freq: 1200, gain: 0.9 * vel, attack: 0.001, decay: 0.03, send: 0.9 });
    noise(t, 0.3, out, { type: 'lowpass', freq: 1800, sweepTo: 300, gain: 0.7 * vel, attack: 0.001, decay: 0.08, send: 0.8 });
    thump(t, out, 160, 38, 1.1 * vel, 0.12);
  }
  function ricochet(t, out) {
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = 'sine';
    o.frequency.setValueAtTime(2600 + Math.random() * 600, t);
    o.frequency.exponentialRampToValueAtTime(700, t + 0.45);
    const vib = ctx.createOscillator();
    vib.frequency.value = 38;
    const vg = ctx.createGain();
    vg.gain.value = 60;
    vib.connect(vg).connect(o.frequency);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(0.12, t + 0.01);
    g.gain.setTargetAtTime(0.0001, t + 0.15, 0.12);
    const s = ctx.createGain();
    s.gain.value = 0.5;
    o.connect(g).connect(out);
    g.connect(s).connect(reverb);
    o.start(t);
    vib.start(t);
    o.stop(t + 0.8);
    vib.stop(t + 0.8);
  }

  // ---------- Проигрыватель тем ----------
  function barOf(theme, index) {
    const T = THEMES[theme];
    if (index < T.bars.length) return T.bars[index];
    const loopLen = T.bars.length - T.loopFrom;
    return T.bars[T.loopFrom + ((index - T.loopFrom) % loopLen)];
  }
  // Аккорд на долю такта (в такте один или два аккорда).
  const chordAt = (bar, tick) => (bar.chords.length > 1 && tick >= 8 ? bar.chords[1] : bar.chords[0]);

  function playBar(p, t0) {
    const T = THEMES[p.theme];
    const st = T.step;
    const bar = barOf(p.theme, p.bar);
    const at = (tick) => t0 + tick * st;
    const out = p.bus;
    const swing = (tick) => (tick % 4 === 2 ? st * 0.22 : 0);   // рэгтайм качает

    if (p.theme === 'base') {
      // Страйд: бас на 1 и 3, аккорд на 2 и 4.
      for (const [tk, low] of [[0, true], [4, false], [8, true], [12, false]]) {
        const ch = chordAt(bar, tk);
        if (low) {
          const n = tk === 0 ? rootOf(ch, 40) : fifthOf(ch, 36);
          playNote('honkytonk', out, at(tk), n, st * 3, 0.55, { send: 0.25 });
          playNote('contrabass', out, at(tk), n, st * 3, 0.35, { send: 0.2 });
          spoons(at(tk), out, 0.5);
        } else {
          for (const n of voice(ch, 55)) playNote('honkytonk', out, at(tk), n, st * 1.6, 0.32, { send: 0.25 });
          brush(at(tk), out, 0.9);
          spoons(at(tk), out, 1);
        }
      }
      thump(at(0), out, 90, 45, 0.18);
      thump(at(8), out, 90, 45, 0.15);
      // Банджо бренчит на слабые восьмые.
      for (const tk of [2, 6, 10, 14]) {
        const v = voice(chordAt(bar, tk), 60);
        v.forEach((n, k) => playNote('banjo', out, at(tk) + swing(tk) + k * 0.012, n, st * 1.4, 0.18, { send: 0.3 }));
      }
      if (bar.part === 'intro' && bar.i === 0) playNote('bells', out, at(0), midi('E5'), 1.4, 0.3, { send: 0.6 });
      if (bar.mel) {
        for (const n of bar.mel) {
          const accent = n.tick === 0 ? 1.12 : 1;
          playNote(bar.lead, out, at(n.tick) + swing(n.tick), n.midi, n.len * st * 0.9, (bar.lead === 'honkytonk' ? 0.5 : 0.48) * accent, { send: 0.4 });
          if (bar.double) playNote(bar.double, out, at(n.tick) + swing(n.tick), n.midi + (bar.double === 'honkytonk' ? 12 : 0), n.len * st * 0.8, bar.double === 'banjo' ? 0.28 : 0.22, { send: 0.35 });
        }
        if (bar.part === 'A' && bar.i === 7) {
          // Ответ пианино в паузе: сползающая хроматика вниз.
          ['B4', 'A#4', 'A4', 'G#4'].forEach((n, k) => playNote('honkytonk', out, at(8 + k * 2) + swing(8 + k * 2), midi(n), st * 1.6, 0.35));
        }
      }
    } else {
      const intro = bar.part === 'intro';
      // Твэнг-гитара с тремоло: корень — квинта — октава.
      const ch = bar.chords[0];
      const r = rootOf(ch, 40);
      const pattern = [[0, r], [2, r], [4, fifthOf(ch, 40)], [6, r + 12], [8, r], [10, fifthOf(ch, 40)], [12, r + 12], [14, fifthOf(ch, 40)]];
      for (const [tk, n] of pattern) playNote('twang', out, at(tk), n, st * 1.8, tk % 8 === 0 ? 0.42 : 0.3, { send: 0.55, tremolo: tk === 0 });
      // Сердце: литавры на раз и «и», бочка — тише.
      playNote('timpani', out, at(0), rootOf(ch, 40), 0.6, 0.5, { send: 0.4 });
      playNote('timpani', out, at(3), rootOf(ch, 40), 0.4, 0.3, { send: 0.4 });
      thump(at(0), out, 70, 38, 0.4, 0.12);
      if (!intro) {
        for (const n of voice(ch, 57)) playNote('choir', out, at(0), n, st * 15.5, 0.24, { send: 0.9 });
        for (const tk of [6, 14]) noise(at(tk), 0.05, out, { freq: 3200, q: 6, gain: 0.1, decay: 0.02 });   // кастаньеты
      }
      if (bar.i === 0 || bar.i === 4) playNote('bells', out, at(0), midi('A4'), 2.5, 0.35, { send: 0.8 });
      if (bar.i === 7) for (let k = 0; k < 6; k++) playNote('timpani', out, at(8 + k), rootOf(ch, 40), 0.2, 0.2 + k * 0.07);
      if (bar.mel) {
        for (const n of bar.mel) {
          playNote(bar.lead, out, at(n.tick), n.midi, n.len * st * 0.95, bar.lead === 'whistle' ? 0.5 : 0.55, { send: 0.7 });
          if (bar.double) playNote(bar.double, out, at(n.tick), n.midi - 12, n.len * st * 0.95, 0.2, { send: 0.9 });
        }
        if (bar.part === 'trumpet') playNote('strings', out, at(0), voice(ch, 52)[1], st * 15, 0.25, { send: 0.6 });
      }
    }
  }

  function startTheme(theme) {
    if (!ctx) return;
    if (S.player && S.player.theme === theme) return;
    const needs = {
      base: ['honkytonk', 'contrabass', 'banjo', 'harmonica', 'steelgtr', 'bells'],
      duel: ['twang', 'timpani', 'choir', 'bells', 'whistle', 'opentrumpet', 'strings'],
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
    const barDur = THEMES[p.theme].step * 16;
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
        thump(t, out, 130 + arg * 10, 55, 0.5, 0.05);
        noise(t, 0.04, out, { freq: 1800, q: 3, gain: 0.08, decay: 0.02 });
        break;
      case 'cock':
        noise(t, 0.03, out, { freq: 3500, q: 8, gain: 0.25, decay: 0.01 });
        noise(t + 0.08, 0.03, out, { freq: 2600, q: 8, gain: 0.3, decay: 0.012 });
        break;
      case 'wanted':
        playNote('bells', out, t, midi('E5') + (arg || 0) * 2, 1.5, 0.5, { send: 0.7 });
        playNote('harmonica', out, t, midi('B4'), 0.4, 0.4);
        break;
      case 'tease':
        playNote('strings', out, t, midi('E3'), 3, 0.25, { attack: 1.5, send: 0.7 });
        playNote('strings', out, t, midi('B3'), 3, 0.25, { attack: 1.5, send: 0.7 });
        break;
      case 'gunshot':
        gunshot(t, out, 1);
        break;
      case 'aim':
        playNote('glock', out, t, 96, 0.2, 0.25);
        break;
      case 'hit':
        noise(t, 0.08, out, { freq: 1400, q: 1.5, gain: 0.5, decay: 0.04 });
        thump(t, out, 200, 70, 0.6, 0.05);
        playNote('glock', out, t + 0.02, 91, 0.4, 0.3);
        break;
      case 'ricochet':
        ricochet(t, out);
        break;
      case 'hatOff':
        noise(t, 0.4, out, { freq: 600, sweepTo: 2400, q: 1, gain: 0.18, attack: 0.05, decay: 0.12 });
        playNote('honkytonk', out, t + 0.1, midi('E3'), 0.5, 0.4);
        playNote('honkytonk', out, t + 0.25, midi('D#3'), 0.6, 0.4);
        break;
      case 'count':
        noise(t, 0.05, out, { freq: 1000, q: 5, gain: 0.25, decay: 0.03 });
        thump(t, out, 80, 50, 0.4, 0.06);
        break;
      case 'tick':
        if (performance.now() - S.lastTick < 70) return;
        S.lastTick = performance.now();
        playNote('glock', out, t, 91 + Math.floor(Math.random() * 3), 0.15, 0.18, { send: 0.2, release: 0.2 });
        break;
      case 'win':
        voice('Em', 64).concat(76).forEach((m, k) => playNote('banjo', out, t + k * 0.06, m, 0.3, 0.45));
        break;
      case 'winMid':
        ['E5', 'G5', 'B5', 'E6'].forEach((n, k) => playNote('honkytonk', out, t + k * 0.08, midi(n), 0.3, 0.45));
        voice('Em', 60).forEach((m) => playNote('banjo', out, t + 0.34, m, 0.5, 0.4));
        playNote('bells', out, t + 0.34, midi('E5'), 1.2, 0.35);
        break;
      case 'scatter':
        playNote('bells', out, t, midi('E5'), 2, 0.6, { send: 0.8 });
        playNote('whistle', out, t + 0.1, midi('B5'), 0.9, 0.5, { send: 0.8 });
        playNote('whistle', out, t + 0.5, midi('E5'), 1.2, 0.5, { send: 0.8 });
        break;
      case 'bigwin': {
        ['E4', 'G#4', 'B4', 'E5'].forEach((n, k) => playNote('opentrumpet', out, t + k * 0.14, midi(n), k === 3 ? 1.6 : 0.3, 0.6, { send: 0.7 }));
        for (const n of ['E4', 'G#4', 'B4']) playNote('choir', out, t + 0.42, midi(n), 2.4, 0.4, { attack: 0.1, send: 0.9 });
        for (let k = 0; k < 8; k++) playNote('timpani', out, t + k * 0.05, midi('E2'), 0.3, 0.3 + k * 0.06);
        playNote('timpani', out, t + 0.45, midi('E2'), 1.5, 1);
        playNote('bells', out, t + 0.45, midi('E5'), 2.5, 0.55);
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
    if (window.Lounge && window.Lounge.setHold) window.Lounge.setHold('saloon', on && S.musicOn);
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
    if (window.Lounge && window.Lounge.setHold) window.Lounge.setHold('saloon', S.active && S.musicOn);
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
    const barDur = THEMES[theme].step * 16;
    for (let t = 0.1; t < seconds - barDur; t += barDur) {
      playBar(p, t);
      p.bar += 1;
    }
    const buf = await off.startRendering();
    ({ ctx, master, musicBus, sfxBus, reverb, noiseBuf } = saved);
    S.active = saved.active;
    S.musicOn = saved.musicOn;
    let peak = 0;
    let peakAt = 0;
    let sum = 0;
    for (let ch = 0; ch < 2; ch++) {
      const d = buf.getChannelData(ch);
      for (let i = 0; i < d.length; i++) {
        const v = Math.abs(d[i]);
        if (v > peak) {
          peak = v;
          peakAt = i / sr;
        }
        sum += d[i] * d[i];
      }
    }
    return { theme, peak: +peak.toFixed(3), peakAt: +peakAt.toFixed(3), rmsDb: +(20 * Math.log10(Math.sqrt(sum / (buf.length * 2)))).toFixed(1) };
  }

  setInterval(schedule, 60);
  document.addEventListener('pointerdown', () => { if (S.active) unlock(); }, { passive: true });

  root.SaloonAudio = {
    unlock, setActive, music, sfx, toggle, isMusicOn: () => S.musicOn,
    _themes: THEMES, _renderTest: renderTest, _load: (insts) => Promise.all(insts.map(loadInstrument)), _setup: () => setup(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
