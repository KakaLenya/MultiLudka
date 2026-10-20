// «Ночной парад ста демонов»: музыка и звуки на живых сэмплах (Musyng Kite, см. samples/CREDITS.md).
// Две темы, обе написаны по нотам: «Парад» — медленное ночное шествие в ладу мияко-бусі от ре
// (флейта сякухати и сямисэн ведут мелодию, кото перебирает аккорды, тайко — сердце, храмовый колокол,
// струнные и хор — туман), и «Ночь ста демонов» — праздничный мацури в ладу ё (флейта, быстрый
// сямисэн, тайко «дон-дон-кара», тарелочки). Под всем — ночной ветер и сверчки.
// Звуки: деревянные колотушки хёсиги, храмовый колокол, лисий зов, кото.
// window.YokaiAudio: unlock(), setActive(on), music(theme), sfx(name, arg), toggle().
(function (root) {
  'use strict';

  const SAMPLE_DIR = 'samples';
  // Ноты скачаны через малую терцию; gain — подстройка тембра поверх общей нормализации громкости.
  const SETS = {
    koto: { lo: 48, hi: 90, gain: 0.85, attack: 0.002, release: 0.6, lp: 6500 },
    shamisen: { lo: 48, hi: 84, gain: 0.85, attack: 0.002, release: 0.25, lp: 5600 },
    shakuhachi: { lo: 60, hi: 90, gain: 0.62, attack: 0.09, release: 0.3, lp: 5200 },
    flute: { lo: 60, hi: 96, gain: 0.55, attack: 0.03, release: 0.12, lp: 6500 },
    taiko: { lo: 36, hi: 48, gain: 1.2, attack: 0.002, release: 0.5, lp: 3000 },
    timpani: { lo: 36, hi: 60, gain: 1.0, attack: 0.003, release: 0.8, lp: 2400 },
    bells: { lo: 60, hi: 84, gain: 0.8, attack: 0.002, release: 2.2, lp: 5000 },
    choir: { lo: 48, hi: 78, gain: 0.7, attack: 0.3, release: 0.7, lp: 3200 },
    strings: { lo: 36, hi: 84, gain: 0.65, attack: 0.2, release: 0.5, lp: 3400 },
    glock: { lo: 72, hi: 96, gain: 0.5, attack: 0.001, release: 0.9, lp: 9000 },
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
  // Созвучия лада: пустые квинты и кварты, без привычных мажора и минора.
  const CHORDS = {
    D5: [2, 7, 9], Eb: [3, 7, 10], Gm: [7, 10, 2], Bb: [10, 2, 7], As: [9, 2, 3],   // мияко-бусі
    Dy: [2, 9, 4], Gy: [7, 2, 11], Ay: [9, 4, 11], Ey: [4, 7, 11],                     // ё (праздник)
  };
  const voice = (ch, lo) => CHORDS[ch].map((pc) => lo + (((pc - lo) % 12) + 12) % 12).sort((a, b) => a - b);
  const rootOf = (ch, lo) => lo + (((CHORDS[ch][0] - lo) % 12) + 12) % 12;
  const fifthOf = (ch, lo) => lo + (((CHORDS[ch][2] - lo) % 12) + 12) % 12;

  // ---------- Партитуры ----------
  const A_CH = ['D5', 'D5', 'Eb', 'Eb', 'Gm', 'Gm', 'As', 'D5'];
  const A_MEL = melody(`
    A4:8 Bb4:4 A4:4 | G4:6 A4:2 D4:8 | Eb5:8 D5:4 Bb4:4 | A4:12 r:4 |
    D5:6 Eb5:2 G5:8 | A5:4 G5:4 Eb5:8 | D5:4 Bb4:4 A4:4 Eb4:4 | D4:12 r:4`);
  const B_CH = ['Gm', 'Eb', 'Gm', 'As', 'Bb', 'Eb', 'As', 'D5'];
  const B_MEL = melody(`
    G4:2 Bb4:2 D5:4 Eb5:2 D5:2 Bb4:4 | G4:4 A4:2 Bb4:2 G4:8 | D5:2 Eb5:2 G5:4 A5:4 G5:4 | Eb5:4 D5:4 A4:8 |
    Bb4:2 D5:2 G5:4 A5:2 Bb5:2 A5:4 | G5:4 Eb5:4 G5:8 | A5:4 G5:2 Eb5:2 D5:4 A4:4 | D5:12 r:4`);
  const N_CH = ['Dy', 'Dy', 'Gy', 'Dy', 'Ey', 'Gy', 'Ay', 'Dy'];
  const N_MEL = melody(`
    D5:2 E5:2 G5:2 A5:2 B5:4 A5:4 | G5:2 A5:2 G5:2 E5:2 D5:8 | G5:2 A5:2 B5:2 D6:2 B5:4 A5:4 | G5:4 E5:4 D5:8 |
    E5:2 G5:2 A5:4 B5:2 A5:2 G5:4 | A5:2 B5:2 D6:4 B5:4 A5:4 | B5:4 A5:2 G5:2 E5:4 A5:4 | D5:12 r:4`);

  function section(chords, opts) {
    return chords.map((ch, i) => ({ ch, i, ...opts, mel: opts.mel ? opts.mel[i] : null }));
  }
  // Громкость темы: выравнивает темы между собой и с джазом зала (~−25 дБ).
  const THEME_GAIN = { base: 2.5, night: 2.25 };
  const THEMES = {
    base: {
      step: 60 / 84 / 4,
      bars: [
        ...section(['D5', 'D5'], { part: 'intro' }),
        ...section(A_CH, { part: 'A', lead: 'shakuhachi', mel: A_MEL }),
        ...section(A_CH, { part: 'A', lead: 'shamisen', mel: A_MEL, double: 'flute' }),
        ...section(B_CH, { part: 'B', lead: 'shamisen', mel: B_MEL, double: 'koto' }),
        ...section(A_CH, { part: 'A', lead: 'shakuhachi', mel: A_MEL, choir: true }),
      ],
      loopFrom: 2,
    },
    night: {
      step: 60 / 118 / 4,
      bars: [
        ...section(['Dy', 'Dy'], { part: 'drums' }),
        ...section(N_CH, { part: 'N', lead: 'flute', mel: N_MEL }),
        ...section(N_CH, { part: 'N', lead: 'shamisen', mel: N_MEL, double: 'flute', octave: -12 }),
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
  const MUSIC_KEY = 'casino.yokai.music';
  const S = { active: false, musicOn: STORE.get(MUSIC_KEY) !== 'off', theme: null, player: null, starting: null, lastTick: 0 };

  function setup(context) {
    if (ctx && !context) return;
    ctx = context || new (window.AudioContext || window.webkitAudioContext)();
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 3;
    comp.attack.value = 0.005;
    comp.release.value = 0.25;
    // Мягкое ограничение на выходе: до 0,8 звук не трогаем, выше плавно сжимаем к 1.
    // Компрессор как лимитер не годится: он сам добавляет громкости.
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
    // Ревер «храмового двора»: длинный и мягкий, колокол тонет в тумане.
    reverb = ctx.createConvolver();
    const len = Math.floor(ctx.sampleRate * 3.4);
    const ir = ctx.createBuffer(2, len, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < len; i++) {
        lp += ((Math.random() * 2 - 1) - lp) * 0.22;
        d[i] = lp * (1 - i / len) ** 2.2;
      }
    }
    reverb.buffer = ir;
    const wet = ctx.createGain();
    wet.gain.value = 0.34;
    reverb.connect(wet).connect(master);
    noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
    const nd = noiseBuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    startWind();
    applyVolume();
    if (!context && window.Lounge && window.Lounge.onChange) window.Lounge.onChange(applyVolume);
  }

  // Ночной ветер: шум с медленно гуляющим фильтром.
  function startWind() {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 520;
    bp.Q.value = 1.6;
    const g = ctx.createGain();
    g.gain.value = 0.01;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.06;
    const lfoG = ctx.createGain();
    lfoG.gain.value = 300;
    lfo.connect(lfoG).connect(bp.frequency);
    const lfo2 = ctx.createOscillator();
    lfo2.frequency.value = 0.11;
    const lfo2G = ctx.createGain();
    lfo2G.gain.value = 0.007;
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
  // Выравниваем громкость сэмплов по началу ноты, но не даём щипковым (кото, сямисэн) стрелять пиком.
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
    const rate = 2 ** ((m - best) / 12);
    src.playbackRate.value = rate;
    // Сякухати подъезжает к ноте снизу — «мери-кари», характерный выдох флейты.
    if (inst === 'shakuhachi' && opts.bend !== false && dur > 0.3) {
      src.playbackRate.setValueAtTime(rate * 2 ** (-1.2 / 12), t);
      src.playbackRate.linearRampToValueAtTime(rate, t + 0.14);
    }
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
  // Хёсиги — две деревянные колотушки: сухой звонкий щелчок.
  function clack(t, out, vel = 1) {
    noise(t, 0.04, out, { freq: 2400, q: 7, gain: 0.22 * vel, decay: 0.018, send: 0.3 });
    thump(t, out, 900, 600, 0.12 * vel, 0.02);
  }
  // Цудзуми — ручной барабанчик «пон»: высокий упругий удар.
  function tsuzumi(t, out, vel = 1) {
    thump(t, out, 420, 260, 0.35 * vel, 0.07);
    noise(t, 0.05, out, { freq: 1600, q: 2, gain: 0.06 * vel, decay: 0.03 });
  }
  // Тарелочки тяппа на празднике.
  function chappa(t, out, vel = 1) {
    noise(t, 0.2, out, { type: 'highpass', freq: 5200, gain: 0.07 * vel, attack: 0.002, decay: 0.08, send: 0.2 });
    noise(t, 0.08, out, { freq: 3400, q: 5, gain: 0.05 * vel, decay: 0.03 });
  }
  // Сверчки в траве: короткие пачки высокого писка.
  function cricket(t, out) {
    const f = 4200 + Math.random() * 600;
    for (let i = 0; i < 3; i++) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.frequency.value = f;
      const tt = t + i * 0.045;
      g.gain.setValueAtTime(0.0001, tt);
      g.gain.linearRampToValueAtTime(0.012, tt + 0.008);
      g.gain.setTargetAtTime(0.0001, tt + 0.02, 0.01);
      o.connect(g).connect(out);
      o.start(tt);
      o.stop(tt + 0.08);
    }
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
    const ch = bar.ch;
    const phraseEnd = bar.i === 3 || bar.i === 7;

    if (p.theme === 'base') {
      const intro = bar.part === 'intro';
      const chorus = bar.part === 'B';
      // Кото: перебор восьмыми по созвучию, вверх и обратно — течёт, как вода у ворот.
      const arp = [...voice(ch, 62), ...voice(ch, 74)];
      [0, 1, 2, 3, 4, 3, 2, 1].forEach((k, j) => playNote('koto', out, at(j * 2), arp[k % arp.length], st * 3, (j === 0 ? 0.34 : 0.24) * (intro ? 0.8 : 1), { send: 0.5 }));
      // Сямисэн-бас: «тон» на раз, квинта на «и» третьей, октава в конце.
      if (!intro || bar.i === 1) {
        playNote('shamisen', out, at(0), rootOf(ch, 50), st * 3, 0.42, { send: 0.3 });
        playNote('shamisen', out, at(6), fifthOf(ch, 50), st * 2, 0.3, { send: 0.3 });
        playNote('shamisen', out, at(10), rootOf(ch, 50) + 12, st * 2, 0.32, { send: 0.3 });
        if (chorus) playNote('shamisen', out, at(14), fifthOf(ch, 50), st * 1.5, 0.26, { send: 0.3 });
      }
      // Струнные и низкий хор — ночной туман.
      for (const n of voice(ch, 50)) playNote('strings', out, at(0), n, st * 15.5, intro ? 0.12 : 0.15, { send: 0.6 });
      if (chorus || bar.choir) {
        if (bar.i % 2 === 0) for (const n of voice(ch, 55)) playNote('choir', out, at(0), n, st * 31, chorus ? 0.2 : 0.14, { send: 0.9 });
      }
      // Тайко — сердце процессии; цудзуми отвечает на слабые доли.
      playNote('taiko', out, at(0), 41, 0.6, intro ? 0.5 : 0.7, { send: 0.5 });
      if (!intro) {
        playNote('taiko', out, at(8), 38, 0.5, 0.45, { send: 0.45 });
        tsuzumi(at(4), out, 0.8);
        tsuzumi(at(12), out, chorus ? 1 : 0.7);
        if (chorus) playNote('taiko', out, at(14), 41, 0.3, 0.3, { send: 0.4 });
      }
      if (phraseEnd && !intro) {
        clack(at(12), out, 0.9);
        clack(at(14), out, 1);
        playNote('glock', out, at(14), voice(ch, 86)[bar.i === 3 ? 1 : 0], 0.8, 0.28, { send: 0.9 });
      }
      // Храмовый колокол — в начале каждого раздела.
      if (bar.i === 0) playNote('bells', out, at(0), chorus ? midi('G4') : midi('D4') + 12, 3, 0.45, { send: 0.9 });
      // Мелодия.
      if (bar.mel) {
        for (const n of bar.mel) {
          const accent = n.tick === 0 ? 1.1 : 1;
          playNote(bar.lead, out, at(n.tick), n.midi, n.len * st * 0.95, (bar.lead === 'shakuhachi' ? 0.55 : 0.5) * accent, { send: 0.55 });
          if (bar.double === 'flute') playNote('flute', out, at(n.tick), n.midi + 12, n.len * st * 0.9, 0.16, { send: 0.6 });
          if (bar.double === 'koto' && n.len >= 4) playNote('koto', out, at(n.tick), n.midi + 12, n.len * st, 0.22, { send: 0.6 });
        }
      }
    } else {
      // Праздник: тайко «дон-дон-кара», тарелочки, быстрый сямисэн, флейта ведёт.
      const drums = bar.part === 'drums';
      for (const tk of [0, 4, 8]) playNote('taiko', out, at(tk), tk === 8 ? 38 : 41, 0.5, tk === 0 ? 0.8 : 0.55, { send: 0.45 });
      clack(at(12), out, 0.7);
      clack(at(13), out, 0.5);
      playNote('taiko', out, at(14), 41, 0.3, 0.45, { send: 0.4 });
      for (const tk of [2, 6, 10, 14]) chappa(at(tk), out, tk === 6 ? 1 : 0.7);
      if (bar.i === 7) for (let k = 0; k < 4; k++) playNote('timpani', out, at(12 + k), rootOf(ch, 38), 0.2, 0.25 + k * 0.08);
      if (!drums) {
        // Сямисэн бьёт восьмыми по созвучию.
        const v = voice(ch, 55);
        for (let tk = 0; tk < 16; tk += 2) {
          v.forEach((n, k) => playNote('shamisen', out, at(tk) + k * 0.01, n, st * 1.4, tk % 4 === 0 ? 0.24 : 0.17, { send: 0.3 }));
        }
        playNote('shamisen', out, at(0), rootOf(ch, 43), st * 3, 0.4, { send: 0.3 });
        for (const n of voice(ch, 55)) playNote('strings', out, at(0), n, st * 15.5, 0.13, { send: 0.6 });
        if (bar.i % 4 === 0) {
          for (const n of voice(ch, 57)) playNote('choir', out, at(0), n, st * 31, 0.16, { send: 0.9 });
          playNote('bells', out, at(0), midi('D5'), 2, 0.35, { send: 0.8 });
        }
        if (bar.mel) {
          for (const n of bar.mel) {
            const m = n.midi + (bar.octave || 0);
            playNote(bar.lead, out, at(n.tick), m, n.len * st * 0.9, bar.lead === 'flute' ? 0.5 : 0.48, { send: 0.45 });
            if (bar.double === 'flute') playNote('flute', out, at(n.tick), n.midi, n.len * st * 0.85, 0.22, { send: 0.5 });
          }
        }
      }
    }
  }

  function startTheme(theme) {
    if (!ctx) return;
    if (S.player && S.player.theme === theme) return;
    const needs = {
      base: ['koto', 'shamisen', 'shakuhachi', 'flute', 'taiko', 'bells', 'choir', 'strings', 'glock'],
      night: ['taiko', 'shamisen', 'flute', 'strings', 'choir', 'bells', 'timpani'],
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
      if (S.musicOn && S.active) {
        playBar(p, p.nextAt);
        // Сверчки — только в спокойной теме и не на каждом такте.
        if (p.theme === 'base' && Math.random() < 0.5) cricket(p.nextAt + Math.random() * barDur, musicBus);
      }
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
        noise(t, 0.4, out, { freq: 300, sweepTo: 1800, q: 0.7, gain: 0.09, attack: 0.08, decay: 0.12 });
        playNote('koto', out, t, midi('D5'), 0.3, 0.2);
        break;
      case 'stop':
        thump(t, out, 130 + arg * 10, 60, 0.45, 0.05);
        clack(t, out, 0.4);
        break;
      case 'fox':
        ['D5', 'G5', 'A5', 'D6'].forEach((n, k) => playNote('koto', out, t + k * 0.04, midi(n), 0.5, 0.35, { send: 0.6 }));
        break;
      case 'foxCall':
        playNote('shakuhachi', out, t, midi('A5'), 0.5, 0.45, { send: 0.8 });
        playNote('glock', out, t + 0.05, midi('D6') + 12, 0.6, 0.3, { send: 0.9 });
        break;
      case 'torii':
        playNote('bells', out, t, midi('D5') + (arg || 0) * 2, 2.4, 0.55, { send: 0.9 });
        playNote('koto', out, t, midi('A4'), 0.6, 0.35);
        break;
      case 'tease':
        playNote('strings', out, t, midi('D3'), 3, 0.25, { attack: 1.5, send: 0.7 });
        playNote('strings', out, t, midi('Eb3'), 3, 0.2, { attack: 1.5, send: 0.7 });
        playNote('shakuhachi', out, t + 0.4, midi('A4'), 2, 0.3, { send: 0.9 });
        break;
      case 'step':
        clack(t, out, 1);
        clack(t + 0.11, out, 0.8);
        break;
      case 'grow':
        ['D6', 'G6', 'A6'].forEach((n, k) => playNote('glock', out, t + k * 0.07, midi(n), 0.5, 0.3, { send: 0.8 }));
        playNote('koto', out, t, midi('D5'), 0.5, 0.3);
        break;
      case 'tick':
        if (performance.now() - S.lastTick < 70) return;
        S.lastTick = performance.now();
        playNote('glock', out, t, 91 + Math.floor(Math.random() * 3), 0.15, 0.16, { send: 0.2, release: 0.2 });
        break;
      case 'win':
        ['D5', 'Eb5', 'G5', 'A5', 'D6'].forEach((n, k) => playNote('koto', out, t + k * 0.06, midi(n), 0.4, 0.4));
        break;
      case 'winMid':
        ['D5', 'G5', 'A5', 'D6'].forEach((n, k) => playNote('shamisen', out, t + k * 0.08, midi(n), 0.3, 0.45));
        voice('Gm', 62).forEach((m) => playNote('koto', out, t + 0.34, m, 0.8, 0.4));
        playNote('bells', out, t + 0.34, midi('D5'), 1.6, 0.35);
        break;
      case 'scatter':
        playNote('bells', out, t, midi('D4') + 12, 3, 0.65, { send: 0.9 });
        playNote('bells', out, t + 0.6, midi('A4'), 3, 0.45, { send: 0.9 });
        for (const n of ['D4', 'A4', 'D5']) playNote('choir', out, t + 0.2, midi(n), 2.4, 0.35, { attack: 0.3, send: 0.9 });
        break;
      case 'bigwin': {
        for (let k = 0; k < 10; k++) playNote('taiko', out, t + k * 0.06, k % 2 ? 38 : 41, 0.3, 0.35 + k * 0.05, { send: 0.4 });
        ['D5', 'E5', 'G5', 'A5', 'D6'].forEach((n, k) => playNote('flute', out, t + 0.6 + k * 0.12, midi(n), k === 4 ? 1.6 : 0.3, 0.55, { send: 0.7 }));
        for (const n of ['D4', 'A4', 'E5']) playNote('choir', out, t + 0.6, midi(n), 2.6, 0.4, { attack: 0.1, send: 0.9 });
        playNote('bells', out, t + 0.6, midi('D5'), 3, 0.6, { send: 0.9 });
        break;
      }
      case 'click':
        clack(t, out, 0.4);
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
    if (window.Lounge && window.Lounge.setHold) window.Lounge.setHold('yokai', on && S.musicOn);
    if (window.setMusicHold) window.setMusicHold('yokai', on && S.musicOn);   // и песню зала
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
    if (window.Lounge && window.Lounge.setHold) window.Lounge.setHold('yokai', S.active && S.musicOn);
    if (window.setMusicHold) window.setMusicHold('yokai', S.active && S.musicOn);   // и песню зала
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

  root.YokaiAudio = {
    unlock, setActive, music, sfx, toggle, isMusicOn: () => S.musicOn,
    _themes: THEMES, _renderTest: renderTest, _load: (insts) => Promise.all(insts.map(loadInstrument)), _setup: () => setup(),
  };
})(typeof window !== 'undefined' ? window : globalThis);
