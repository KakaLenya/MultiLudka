// «Ночной парад ста демонов» — клиент слота. Исход спина целиком приходит с сервера (yokai_result),
// здесь только его показ: вращение, пути выигрыша, парад лис (шаг влево и бесплатное вращение, пока
// на поле есть лиса) и «Ночь ста демонов», где лисы растят хвосты. Когда показ закончен, шлём
// yokai_done — сервер зачисляет выигрыш.
// Пользуется общими штуками зала из client.js: send, state, toast, handlers, storage, avatarEl.
(function () {
  'use strict';

  const AUDIO = () => window.YokaiAudio || null;

  // ---------- Как на сервере (server/yokai-math.js) ----------
  const REELS = 5;
  const ROWS = 4;
  const UNIT = 44;
  const PAYS = {
    sake: [2, 5, 15], geta: [2, 5, 15], fan: [3, 6, 20], ofuda: [3, 6, 20],
    umbrella: [5, 15, 50], lantern: [6, 20, 70], skeleton: [8, 30, 100], oni: [12, 50, 200], spider: [15, 60, 250],
  };
  const NAMES = {
    sake: 'Чаша сакэ', geta: 'Гэта', fan: 'Веер', ofuda: 'Офуда', umbrella: 'Каса-обакэ', lantern: 'Тётин-обакэ', skeleton: 'Гасадокуро', oni: 'Маска они', spider: 'Цутигумо', fox: 'Кицунэ', torii: 'Тории',
  };
  const BUY = { bonus: 100 };
  const MAX_WIN = 5000;
  const FREE_SPINS = { 3: 8, 4: 12, 5: 20 };
  const FILLER = ['sake', 'geta', 'fan', 'ofuda', 'sake', 'geta', 'fan', 'ofuda', 'umbrella', 'lantern', 'skeleton', 'oni', 'spider', 'fox', 'torii'];
  const CALM = ['sake', 'geta', 'fan', 'ofuda', 'umbrella', 'lantern', 'skeleton', 'oni', 'spider'];
  const BET_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
  const BIG_WINS = [[500, 'ЛЕГЕНДАРНЫЙ ВЫИГРЫШ'], [100, 'ЭПИЧЕСКИЙ ВЫИГРЫШ'], [50, 'ОГРОМНЫЙ ВЫИГРЫШ'], [15, 'БОЛЬШОЙ ВЫИГРЫШ']];
  const WIN_COLORS = {
    sake: '#ffd54a', geta: '#ff9f43', fan: '#7fd0ff', ofuda: '#c8f7a0',
    umbrella: '#ff6a5a', lantern: '#ffb84a', skeleton: '#7fe0d0', oni: '#ff3d2e', spider: '#c58cff',
  };
  const TITLE_FONT = '"Cormorant SC", Georgia, serif';
  const NUM_FONT = 'Oswald, "Arial Narrow", sans-serif';
  const GHOST = '127, 224, 208';

  // ---------- Геометрия ----------
  const CELL = 112;
  const FR = 28;
  const W = REELS * CELL + 2 * FR;
  const H = ROWS * CELL + 2 * FR;
  const cx = (r) => FR + r * CELL + CELL / 2;
  const cy = (y) => FR + y * CELL + CELL / 2;
  const cellOf = (r, y) => r * ROWS + y;
  const reelOf = (c) => Math.floor(c / ROWS);
  const rowOf = (c) => c % ROWS;
  const INK = '#0a0812';

  const fmt = (n) => chips(Math.floor(n));   // 60.000.000 — общая функция зала
  const ease = {
    out: (t) => 1 - (1 - t) ** 3,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    back: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- Состояние ----------
  const BET_KEY = 'casino.yokai.bet';
  const TURBO_KEY = 'casino.yokai.turbo';
  const G = {
    ready: false,
    img: {},
    blur: {},
    rig: {},                 // символ -> модель из деталей (yokai/rig.js)
    foxRig: {},              // хвостов -> модель лисы
    bet: Number(storage.get(BET_KEY)) || 100,
    bet0: 100,
    busy: false,
    awaiting: false,
    auto: 0,
    autoStopOnBonus: true,
    turbo: storage.get(TURBO_KEY) === '1',
    clock: 0,
    speed: 1,
    skip: false,
    mode: 'base',            // base | night
    grid: null,
    reels: [],
    foxes: [],               // лисы парада поверх поля: { id, reel, row, tails, from, to, walkStart, walkMs, leaving, born, grewAt }
    landTails: new Map(),    // клетка -> хвостов у лисы, которая прилетит на неё с барабаном
    hl: new Map(),
    ways: null,
    fx: [],
    banner: null,
    bigWin: null,
    shake: 0,
    night: null,             // { left, total, won }
    winShown: 0,
    winTarget: 0,
    onSkip: null,
  };
  if (!BET_STEPS.includes(G.bet)) G.bet = 100;

  // ---------- Время показа ----------
  const waiters = [];
  function wait(ms) {
    return new Promise((resolve) => waiters.push({ at: G.clock + ms, resolve }));
  }
  function tickClock(dt) {
    G.clock += dt * G.speed;
    for (let i = waiters.length - 1; i >= 0; i--) {
      if (waiters[i].at <= G.clock) {
        waiters[i].resolve();
        waiters.splice(i, 1);
      }
    }
  }
  function setSpeed() {
    G.speed = G.skip ? 5 : G.turbo ? 2 : 1;
  }

  // ---------- Картинки ----------
  // Символы нарисованы вручную и собраны из деталей (yokai/rig.js): в кадре живут — фонарь болтает
  // языком, зонт скачет на ноге, у лисы колышутся хвосты. На скорости — неподвижный кадр с размытием.
  async function loadArt() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(CELL * dpr);
    const A = window.SlotArt;
    const SR = window.SlotRig;
    const YR = window.YokaiRig;
    await Promise.all([document.fonts.load(`700 20px ${NUM_FONT}`), document.fonts.load(`700 20px ${TITLE_FONT}`)]).catch(() => {});
    const jobs = Object.entries(YR.SYMBOLS).map(async ([k, def]) => {
      const rig = await SR.build(def, px);
      G.rig[k] = rig;
      G.img[k] = rig.still;
      G.blur[k] = A.motionBlur(rig.still);
    });
    for (let n = 1; n <= 12; n++) jobs.push(SR.build(YR.fox(n), px).then((rig) => { G.foxRig[n] = rig; }));
    jobs.push(A.loadImage('textures/paper.jpg').then((img) => { G.texPaper = img; }));
    jobs.push(A.loadImage('textures/wood-dark.jpg').then((img) => { G.texWood = img; }));
    await Promise.all(jobs);
    G.rig.fox = G.foxRig[1];
    G.img.fox = G.foxRig[3].still;
    G.blur.fox = A.motionBlur(G.foxRig[1].still);
    G.ready = true;
  }

  // ---------- Разметка ----------
  const el = (id) => document.getElementById(id);
  document.body.append(el('yk-buy-modal'), el('yk-pay-modal'));
  const reelsCv = el('yk-reels');
  const bgCv = el('yk-bg');
  const rctx = reelsCv.getContext('2d');
  const bctx = bgCv.getContext('2d');

  function fitCanvas(cv, w, h) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
    }
    return dpr;
  }

  const calmSym = () => CALM[Math.floor(Math.random() * CALM.length)];
  function randomSym(r) {
    const s = FILLER[Math.floor(Math.random() * FILLER.length)];
    return s === 'fox' && r === 0 ? 'oni' : s;
  }
  G.grid = Array.from({ length: REELS }, () => Array.from({ length: ROWS }, calmSym));
  G.reels = Array.from({ length: REELS }, () => ({ spinning: false }));

  // ---------- Вращение ----------
  function spinReels(grid, { anticipate = -1 } = {}) {
    const fast = G.turbo;
    const base = fast ? 380 : 700;
    const gap = fast ? 90 : 160;
    const jobs = [];
    G.hl.clear();
    G.ways = null;
    for (let r = 0; r < REELS; r++) {
      const extra = anticipate >= 0 && r > anticipate ? (r - anticipate) * 900 : 0;
      const dur = base + r * gap + extra;
      const len = 12 + r * 3 + Math.round(extra / 60);
      const strip = [];
      for (let i = 0; i < len; i++) strip.push(randomSym(r));
      const reel = {
        spinning: true,
        strip: [...grid[r].slice().reverse(), ...strip, ...G.grid[r].map((s) => s || calmSym()).reverse()],
        start: G.clock,
        dur,
        anticipating: extra > 0,
      };
      reel.dist = reel.strip.length - ROWS;
      G.reels[r] = reel;
      jobs.push(wait(dur).then(() => {
        reel.spinning = false;
        G.grid[r] = grid[r].slice();
        landSound(r, grid[r]);
      }));
    }
    return Promise.all(jobs);
  }

  function landSound(r, col) {
    const a = AUDIO();
    if (!a) return;
    a.sfx('stop', r);
    if (col.includes('torii')) a.sfx('torii', r);
    else if (col.includes('fox')) a.sfx('fox', r);
  }

  function reelOffset(reel) {
    const t = clamp((G.clock - reel.start) / reel.dur, 0, 1);
    if (t < 0.08) return reel.dist + Math.sin((t / 0.08) * Math.PI) * 0.18;
    return reel.dist * (1 - ease.back((t - 0.08) / 0.92));
  }

  // ---------- Рисование барабанов ----------
  // Картинки клеток для SlotRig.drawCached: своя у каждой клетки поля, места ленты и лисы.
  const cellSlots = new Map();
  function slotOf(key) {
    let s = cellSlots.get(key);
    if (!s) cellSlots.set(key, (s = {}));
    return s;
  }

  function rigOf(s, tails) {
    if (s === 'fox') return G.foxRig[clamp(tails || 1, 1, 12)];
    return G.rig[s];
  }

  // win — символ в выигрыше (играет свою анимацию), ph — фаза клетки, чтобы соседи двигались не в такт.
  function drawSymbol(ctx, s, x, y, { blur = false, scale = 1, alpha = 1, win = 0, ph = 0, slot = null, tails = 1 } = {}) {
    const size = CELL * 0.94 * scale;
    const rig = rigOf(s, tails);
    if (blur || !rig) {
      const img = G.blur[s];
      if (!img) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    if (scale !== 1) ctx.scale(scale, scale);
    const t = performance.now() / 1000;
    if (slot) window.SlotRig.drawCached(ctx, slot, rig, 0, 0, CELL * 0.94, t, win, ph, alpha, win ? 30 : 15);
    else window.SlotRig.draw(ctx, rig, 0, 0, CELL * 0.94, t, win, ph, alpha);
    ctx.restore();
  }

  // Неподвижные слои барабанов и рамы — в картинках (SlotRig.layer), в кадре только копируются.
  const UNDER = {};
  const FRAME = {};
  const layerDpr = () => Math.min(2, window.devicePixelRatio || 1);
  function paintReelsUnder(ctx, night) {
    for (let r = 0; r < REELS; r++) {
      const x = FR + r * CELL;
      if (G.texPaper) {
        ctx.fillStyle = ctx.createPattern(G.texPaper, 'repeat');
        ctx.fillRect(x, FR, CELL, ROWS * CELL);
      }
      const g = ctx.createLinearGradient(x, FR, x, FR + ROWS * CELL);
      g.addColorStop(0, night ? 'rgba(46, 8, 18, .9)' : 'rgba(14, 20, 50, .88)');
      g.addColorStop(1, night ? 'rgba(10, 2, 6, .96)' : 'rgba(4, 6, 18, .95)');
      ctx.fillStyle = g;
      ctx.fillRect(x, FR, CELL, ROWS * CELL);
    }
    // Тонкие золотые нити между барабанами, как на ширме.
    for (let r = 1; r < REELS; r++) {
      const x = FR + r * CELL;
      ctx.fillStyle = 'rgba(0, 0, 0, .55)';
      ctx.fillRect(x - 2, FR, 4, ROWS * CELL);
      ctx.fillStyle = 'rgba(201, 161, 74, .3)';
      ctx.fillRect(x - 0.5, FR, 1, ROWS * CELL);
    }
  }
  function drawReelsBackground(ctx) {
    const dpr = layerDpr();
    const night = G.mode === 'night';
    ctx.drawImage(window.SlotRig.layer(UNDER, `${dpr}|${night}|${!!G.texPaper}`, W, H, dpr, (c) => paintReelsUnder(c, night)), 0, 0, W, H);
  }

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Рама: чёрный лак, киноварная кромка, золотые уголки-наконечники; по верху висят фонари.
  function drawFrame(ctx, t) {
    const dpr = layerDpr();
    ctx.drawImage(window.SlotRig.layer(FRAME, `${dpr}|${!!G.texWood}`, W, H, dpr, paintFrame), 0, 0, W, H);
    const y0 = FR - 12;
    for (const [lx, ph] of [[FR + 60, 0], [W - FR - 60, 1.7]]) {
      const sway = Math.sin(t / 900 + ph) * 0.06;
      const fl = 0.75 + 0.25 * Math.sin(t / 110 + ph) * Math.sin(t / 47 + ph);
      ctx.save();
      ctx.translate(lx, y0 - 2);
      ctx.rotate(sway);
      window.SlotRig.glowAt(ctx, 0, 24, 66, '255, 170, 70', 0.5 * fl);
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -6);
      ctx.lineTo(0, 6);
      ctx.stroke();
      ctx.fillStyle = INK;
      ctx.fillRect(-9, 4, 18, 5);
      ctx.fillRect(-9, 39, 18, 5);
      ctx.beginPath();
      ctx.ellipse(0, 24, 13, 16, 0, 0, Math.PI * 2);
      const lg = ctx.createRadialGradient(-3, 20, 2, 0, 24, 16);
      lg.addColorStop(0, `rgba(255, 236, 170, ${fl})`);
      lg.addColorStop(0.6, '#e0602a');
      lg.addColorStop(1, '#7a1a0c');
      ctx.fillStyle = lg;
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.strokeStyle = 'rgba(10, 8, 18, .45)';
      ctx.lineWidth = 1;
      for (const yy of [16, 24, 32]) {
        ctx.beginPath();
        ctx.ellipse(0, yy, 13, 3, 0, 0, Math.PI);
        ctx.stroke();
      }
      ctx.restore();
    }
  }
  function paintFrame(ctx) {
    const x0 = FR - 12;
    const y0 = FR - 12;
    const w = REELS * CELL + 24;
    const h = ROWS * CELL + 24;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 26;
    roundRect(ctx, x0, y0, w, h, 8);
    ctx.stroke();
    if (G.texWood) {
      ctx.strokeStyle = ctx.createPattern(G.texWood, 'repeat');
      ctx.lineWidth = 19;
      roundRect(ctx, x0, y0, w, h, 8);
      ctx.stroke();
    }
    // Чёрный лак поверх дерева.
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, 'rgba(40, 30, 40, .75)');
    g.addColorStop(0.5, 'rgba(8, 6, 12, .8)');
    g.addColorStop(1, 'rgba(30, 20, 30, .75)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 19;
    roundRect(ctx, x0, y0, w, h, 8);
    ctx.stroke();
    // Киноварная кромка изнутри и тонкий золотой кант снаружи.
    ctx.strokeStyle = '#a02818';
    ctx.lineWidth = 3;
    roundRect(ctx, x0 + 8, y0 + 8, w - 16, h - 16, 5);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(201, 161, 74, .7)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x0 - 9, y0 - 9, w + 18, h + 18, 12);
    ctx.stroke();
    // Золотые уголки-наконечники.
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x0 + w, y0, -1, 1], [x0, y0 + h, 1, -1], [x0 + w, y0 + h, -1, -1]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      ctx.beginPath();
      ctx.moveTo(-13, -13);
      ctx.lineTo(36, -13);
      ctx.quadraticCurveTo(28, -2, 18, 0);
      ctx.lineTo(4, 4);
      ctx.lineTo(0, 18);
      ctx.quadraticCurveTo(-2, 28, -13, 36);
      ctx.closePath();
      const gg = ctx.createLinearGradient(-13, -13, 36, 36);
      gg.addColorStop(0, '#f5e2a8');
      gg.addColorStop(0.5, '#c9a14a');
      gg.addColorStop(1, '#5a3a10');
      ctx.fillStyle = gg;
      ctx.fill();
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(-3, -3, 3.5, 0, Math.PI * 2);
      ctx.fillStyle = '#a02818';
      ctx.fill();
      ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
  }

  // Клетки, на которых сейчас стоят лисы парада (их рисует слой лис).
  function foxCells() {
    const s = new Set();
    for (const f of G.foxes) if (f.to === undefined) s.add(cellOf(f.reel, f.row));
    return s;
  }

  function drawCells(ctx, t) {
    const covered = foxCells();
    ctx.save();
    ctx.beginPath();
    ctx.rect(FR, FR, REELS * CELL, ROWS * CELL);
    ctx.clip();
    for (let r = 0; r < REELS; r++) {
      const reel = G.reels[r];
      if (reel && reel.spinning) {
        const off = reelOffset(reel);
        const speed = Math.abs(off - (reel.lastOff ?? off));
        reel.lastOff = off;
        const blur = speed > 0.12;
        const first = Math.floor(off);
        const frac = off - first;
        for (let k = -1; k <= ROWS; k++) {
          const idx = first + (ROWS - 1 - k);
          const s = reel.strip[idx];
          if (!s) continue;
          // Итоговые клетки ленты рисуются в картинки своих клеток поля — после остановки движение не прыгает.
          const c = cellOf(r, ROWS - 1 - idx);
          const fin = idx < ROWS;
          drawSymbol(ctx, s, cx(r), FR + (k + frac) * CELL + CELL / 2, { blur, ph: fin ? c * 1.7 : idx * 1.3 + r, slot: slotOf(fin ? c : `s${r}:${idx}`), tails: fin ? G.landTails.get(c) : 1 });
        }
        if (reel.anticipating) {
          const a = 0.55 + 0.35 * Math.sin(t / 90);
          const x = FR + r * CELL;
          ctx.strokeStyle = `rgba(255, 110, 70, ${a})`;
          ctx.lineWidth = 4;
          ctx.strokeRect(x + 3, FR + 3, CELL - 6, ROWS * CELL - 6);
          if (Math.random() < 0.3) spark(x + Math.random() * CELL, FR + Math.random() * ROWS * CELL, 1, '#ff8a5a', 0.3);
        }
        continue;
      }
      for (let y = 0; y < ROWS; y++) {
        const c = cellOf(r, y);
        const s = G.grid[r][y];
        if (!s || covered.has(c)) continue;
        const hl = G.hl.get(c);
        let scale = 1;
        if (hl !== undefined) {
          // Выигравший символ чуть выходит вперёд и играет свою анимацию.
          scale = 1 + 0.07 * ease.back(clamp((G.clock - hl) / 260, 0, 1));
          window.SlotRig.glowAt(ctx, cx(r), cy(y), CELL * 0.62, '255, 190, 110', 0.3);
        }
        const dim = G.ways && hl === undefined ? 0.45 : 1;
        drawSymbol(ctx, s, cx(r), cy(y), { scale, alpha: dim, win: hl !== undefined ? 1 : 0, ph: c * 1.7, slot: slotOf(c), tails: G.landTails.get(c) });
      }
    }
    ctx.restore();
  }

  // Лисы парада: стоят поверх барабанов, шагают влево с прыжком, уходят за край поля.
  function drawFoxes(ctx, t) {
    if (!G.foxes.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(FR - 6, FR, REELS * CELL + 12, ROWS * CELL);
    ctx.clip();
    for (const f of G.foxes) {
      let x = cx(f.reel);
      let y = cy(f.row);
      let alpha = 1;
      if (f.to !== undefined) {
        const k = clamp((G.clock - f.walkStart) / f.walkMs, 0, 1);
        x = cx(f.from) + (cx(f.to) - cx(f.from)) * ease.inOut(k);
        y -= Math.sin(k * Math.PI) * CELL * 0.22;
        if (f.leaving) alpha = 1 - clamp((k - 0.4) / 0.6, 0, 1);
      }
      const c = cellOf(f.reel, f.row);
      const hl = G.hl.get(c);
      // Подложка: призрачный свет под лисой, чтобы она читалась над крутящимися барабанами.
      window.SlotRig.glowAt(ctx, x, y, CELL * 0.62, GHOST, 0.28 * alpha);
      const born = clamp((G.clock - (f.born ?? -1e9)) / 380, 0, 1);
      const grew = clamp((G.clock - (f.grewAt ?? -1e9)) / 420, 0, 1);
      const scale = (0.6 + 0.4 * ease.back(born)) * (1 + 0.12 * Math.sin(grew * Math.PI)) * (hl !== undefined ? 1.06 : 1);
      drawSymbol(ctx, 'fox', x, y, { scale, alpha, win: hl !== undefined || f.to !== undefined ? 1 : 0, ph: f.id * 1.3, slot: slotOf(`fox${f.id}`), tails: f.tails });
    }
    ctx.restore();
  }

  // Пути: светящиеся нити от символа к символу по соседним барабанам.
  function drawWays(ctx) {
    const Wy = G.ways;
    if (!Wy || !Wy.wins.length) return;
    const k = (G.clock - Wy.at) / 1000;
    const all = k < 1.8;
    const list = all ? Wy.wins : [Wy.wins[Math.floor((k - 1.8) / 1.3) % Wy.wins.length]];
    const prog = clamp(k / 0.6, 0, 1);
    for (const w of list) {
      const byReel = [];
      for (const c of w.cells) (byReel[reelOf(c)] ||= []).push(c);
      const color = WIN_COLORS[w.symbol];
      const upto = all ? prog * (w.len - 1) : w.len - 1;
      ctx.save();
      ctx.lineCap = 'round';
      for (let r = 0; r < w.len - 1; r++) {
        const f = clamp(upto - r, 0, 1);
        if (f <= 0) break;
        for (const a of byReel[r]) {
          for (const b of byReel[r + 1]) {
            const x0 = cx(r) + CELL * 0.22;
            const y0 = cy(rowOf(a));
            const x1 = cx(r + 1) - CELL * 0.22;
            const y1 = cy(rowOf(b));
            const xm = (x0 + x1) / 2;
            const path = () => {
              ctx.beginPath();
              ctx.moveTo(x0, y0);
              const steps = 16;
              for (let i = 1; i <= Math.ceil(steps * f); i++) {
                const u = Math.min(f, i / steps);
                const xx = (1 - u) ** 3 * x0 + 3 * (1 - u) ** 2 * u * xm + 3 * (1 - u) * u * u * xm + u ** 3 * x1;
                const yy = (1 - u) ** 3 * y0 + 3 * (1 - u) ** 2 * u * y0 + 3 * (1 - u) * u * u * y1 + u ** 3 * y1;
                ctx.lineTo(xx, yy);
              }
            };
            path();
            ctx.strokeStyle = 'rgba(0, 0, 0, .55)';
            ctx.lineWidth = 9;
            ctx.stroke();
            path();
            ctx.strokeStyle = color;
            ctx.globalAlpha = 0.35;
            ctx.lineWidth = 14;
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.lineWidth = 4;
            ctx.stroke();
            path();
            ctx.strokeStyle = '#fff';
            ctx.globalAlpha = 0.7;
            ctx.lineWidth = 1.3;
            ctx.stroke();
            ctx.globalAlpha = 1;
          }
        }
      }
      ctx.restore();
      if (!all) {
        const last = byReel[w.len - 1][0];
        const x = cx(w.len - 1);
        const y = cy(rowOf(last)) - CELL * 0.42;
        const text = `${NAMES[w.symbol]} · ${w.ways} ${w.ways % 10 === 1 && w.ways % 100 !== 11 ? 'путь' : [2, 3, 4].includes(w.ways % 10) && ![12, 13, 14].includes(w.ways % 100) ? 'пути' : 'путей'} · +${fmt(w.pay * G.bet0)}`;
        ctx.save();
        ctx.font = `700 16px ${NUM_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(text).width + 18;
        const xx = clamp(x, FR + tw / 2, W - FR - tw / 2);
        roundRect(ctx, xx - tw / 2, y - 13, tw, 26, 13);
        ctx.fillStyle = 'rgba(10, 8, 24, .92)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.fillText(text, xx, y + 1);
        ctx.restore();
      }
    }
  }

  // ---------- Частицы ----------
  function spark(x, y, n = 12, color = '#ffd45c', power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (60 + Math.random() * 180) * power;
      G.fx.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.6 + Math.random() * 0.5, age: 0, color, r: 2 + Math.random() * 2.5 });
    }
  }
  function wisps(x, y, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 20 + Math.random() * 70;
      G.fx.push({ kind: 'wisp', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 40, life: 0.9 + Math.random() * 0.7, age: 0, r: 5 + Math.random() * 7 });
    }
  }
  function petals(n) {
    for (let i = 0; i < n; i++) {
      G.fx.push({ kind: 'petal', x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: 20 + Math.random() * 40, vy: 50 + Math.random() * 90, life: 5, age: 0, spin: Math.random() * 6, r: 5 + Math.random() * 4 });
    }
  }
  function coinShower(n) {
    for (let i = 0; i < n; i++) {
      G.fx.push({ kind: 'coin', x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 160, life: 4, age: 0, spin: Math.random() * 6, r: 8 + Math.random() * 6 });
    }
  }

  function drawFx(ctx, dt) {
    for (let i = G.fx.length - 1; i >= 0; i--) {
      const p = G.fx[i];
      p.age += dt;
      if (p.age >= p.life) {
        G.fx.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;
      if (p.kind === 'wisp') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 1.5;
        window.SlotRig.glowAt(ctx, p.x, p.y, p.r * (1 + k), GHOST, 0.7 * (1 - k));
        continue;
      }
      if (p.kind === 'petal') {
        p.spin += dt * 3;
        p.x += (p.vx + Math.sin(p.spin) * 30) * dt;
        p.y += p.vy * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.spin);
        ctx.scale(1, Math.max(0.2, Math.abs(Math.cos(p.spin * 1.3))));
        ctx.fillStyle = `rgba(255, 190, 205, ${0.9 * (1 - k * 0.5)})`;
        ctx.beginPath();
        ctx.ellipse(0, 0, p.r, p.r * 0.55, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      p.vy += (p.kind === 'coin' ? 60 : 420) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'coin') {
        p.spin += dt * 8;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(Math.max(0.15, Math.abs(Math.cos(p.spin))), 1);
        // Монета мон с квадратной дыркой.
        const cg = ctx.createRadialGradient(-p.r * 0.3, -p.r * 0.3, 1, 0, 0, p.r);
        cg.addColorStop(0, '#fff6c0');
        cg.addColorStop(0.5, '#e2ac3a');
        cg.addColorStop(1, '#8a560a');
        ctx.beginPath();
        ctx.arc(0, 0, p.r, 0, Math.PI * 2);
        ctx.fillStyle = cg;
        ctx.fill();
        ctx.strokeStyle = '#5a3406';
        ctx.lineWidth = 1.5;
        ctx.stroke();
        ctx.fillStyle = '#3a1c04';
        ctx.fillRect(-p.r * 0.25, -p.r * 0.25, p.r * 0.5, p.r * 0.5);
        ctx.restore();
        continue;
      }
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.r * (1 - k * 0.6), 0, Math.PI * 2);
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 1 - k;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // ---------- Баннеры ----------
  function banner(title, sub = '', ms = 1600, kind = '') {
    G.banner = { title, sub, start: G.clock, ms, kind };
    return wait(ms).then(() => { if (G.banner && G.banner.title === title) G.banner = null; });
  }
  function drawBanner(ctx) {
    const b = G.banner;
    if (!b) return;
    const k = clamp((G.clock - b.start) / b.ms, 0, 1);
    const inK = clamp(k / 0.15, 0, 1);
    const outK = clamp((k - 0.85) / 0.15, 0, 1);
    const s = ease.back(inK) * (1 - outK * 0.3);
    ctx.save();
    ctx.globalAlpha = 1 - outK;
    const band = ctx.createLinearGradient(0, H / 2 - 70, 0, H / 2 + 70);
    band.addColorStop(0, 'rgba(8, 6, 20, 0)');
    band.addColorStop(0.2, 'rgba(8, 6, 20, .82)');
    band.addColorStop(0.8, 'rgba(8, 6, 20, .82)');
    band.addColorStop(1, 'rgba(8, 6, 20, 0)');
    ctx.fillStyle = band;
    ctx.fillRect(0, H / 2 - 70, W, 140);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${b.kind === 'small' ? 40 : 52}px ${TITLE_FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#140608';
    ctx.strokeText(b.title, 0, b.sub ? -16 : 0);
    const g = ctx.createLinearGradient(0, -40, 0, 20);
    g.addColorStop(0, '#fff6dc');
    g.addColorStop(0.5, '#f0a060');
    g.addColorStop(1, '#c23b22');
    ctx.fillStyle = g;
    ctx.fillText(b.title, 0, b.sub ? -16 : 0);
    if (b.sub) {
      ctx.font = `600 21px ${NUM_FONT}`;
      ctx.lineWidth = 6;
      ctx.strokeText(b.sub, 0, 32);
      ctx.fillStyle = '#fff';
      ctx.fillText(b.sub, 0, 32);
    }
    ctx.restore();
  }

  function drawBigWin(ctx, t) {
    const b = G.bigWin;
    if (!b) return;
    const k = clamp((G.clock - b.start) / b.ms, 0, 1);
    const shown = b.amount * ease.out(clamp(k / 0.8, 0, 1));
    ctx.save();
    ctx.fillStyle = `rgba(6, 4, 16, ${0.75 * clamp(k * 6, 0, 1)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2 - 6);
    // Восходящее солнце за надписью: красный диск и лучи.
    ctx.save();
    ctx.rotate(t / 4000);
    for (let i = 0; i < 16; i++) {
      ctx.rotate((Math.PI * 2) / 16);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-34, -W);
      ctx.lineTo(34, -W);
      ctx.closePath();
      ctx.fillStyle = 'rgba(194, 59, 34, .12)';
      ctx.fill();
    }
    ctx.restore();
    window.SlotRig.glowAt(ctx, 0, 0, 150, '194, 59, 34', 0.45);
    const pulse = 1 + 0.03 * Math.sin(t / 140);
    ctx.scale(pulse, pulse);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const tier = BIG_WINS.find(([x]) => shown / G.bet0 >= x) || BIG_WINS[BIG_WINS.length - 1];
    ctx.font = `700 40px ${TITLE_FONT}`;
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#140608';
    ctx.strokeText(tier[1], 0, -46);
    const g = ctx.createLinearGradient(0, -70, 0, -20);
    g.addColorStop(0, '#fff6dc');
    g.addColorStop(0.5, '#f5c870');
    g.addColorStop(1, '#c9a14a');
    ctx.fillStyle = g;
    ctx.fillText(tier[1], 0, -46);
    ctx.font = `700 60px ${NUM_FONT}`;
    ctx.lineWidth = 12;
    ctx.strokeText(fmt(shown), 0, 26);
    ctx.fillStyle = '#fff';
    ctx.fillText(fmt(shown), 0, 26);
    ctx.font = `400 15px ${NUM_FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, .7)';
    if (k >= 0.8) ctx.fillText('нажми, чтобы продолжить', 0, 80);
    ctx.restore();
  }

  // ---------- Главный кадр ----------
  let lastFrame = 0;
  function frame(now) {
    requestAnimationFrame(frame);
    const raw = now - (lastFrame || now);
    const dt = Math.min(0.05, raw / 1000);
    lastFrame = now;
    tickClock(dt * 1000);
    try {
      const t0 = performance.now();
      renderScene(now, dt);
      if (!el('yokai').hidden) window.SlotRig.frameStats('yokai', raw, performance.now() - t0);
    } catch (err) {
      if (!G.drawError) console.error('Ночной парад: ошибка рисования', err);
      G.drawError = true;
    }
  }

  let bgDt = 0;
  let bgAt = 0;
  function renderScene(now, dt) {
    if (el('yokai').hidden) return;
    window.SlotRig.frameTick(dt * 1000);   // медленные кадры включают экономный режим символов
    // В экономном режиме фон перерисовывается 15 раз в секунду: холст держит картинку сам.
    bgDt += dt;
    if (!window.SlotRig.perf.lite || now - bgAt > 66) {
      drawBackground(now, Math.min(0.1, bgDt));
      bgDt = 0;
      bgAt = now;
    }
    const dpr = fitCanvas(reelsCv, W, H);
    const ctx = rctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    if (G.shake > 0) {
      G.shake = Math.max(0, G.shake - dt * 30);
      ctx.translate((Math.random() - 0.5) * G.shake, (Math.random() - 0.5) * G.shake);
    }
    if (G.ready) {
      drawReelsBackground(ctx);
      drawCells(ctx, now);
      drawWays(ctx);
      drawFoxes(ctx, now);
      drawFrame(ctx, now);
      drawFx(ctx, dt * G.speed);
      drawBanner(ctx);
      drawBigWin(ctx, now);
    } else {
      ctx.fillStyle = '#e8dcc0';
      ctx.font = `400 18px ${NUM_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Фонари зажигаются…', W / 2, H / 2);
    }
    renderBar(dt);
  }

  // ---------- Фон: ночная деревня ----------
  // Индиго неба, огромная луна (в ночи ста демонов — кровавая), горы тушью, пагода, крыши деревни,
  // по дороге тянется процессия силуэтов. Неподвижное — картинкой; поверх в кадре: туман, гирлянда
  // фонарей, лисьи огни и лепестки.
  const VILLAGE = {};
  function paintVillage(ctx, w, h, night) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, night ? '#14040c' : '#060a1e');
    sky.addColorStop(0.55, night ? '#3a0a16' : '#121a40');
    sky.addColorStop(1, night ? '#12040a' : '#070a18');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    for (let i = 0; i < 70; i++) {
      ctx.fillStyle = `rgba(255, 245, 230, ${0.15 + ((i * 37) % 10) / 30})`;
      ctx.fillRect((i * 97.3) % w, (i * 41.7) % (h * 0.5), 1.3, 1.3);
    }
    // Луна.
    const mx = w * 0.72;
    const my = h * 0.2;
    const mr = Math.min(w, h) * 0.11;
    const halo = ctx.createRadialGradient(mx, my, mr * 0.8, mx, my, mr * 4);
    halo.addColorStop(0, night ? 'rgba(255, 90, 60, .35)' : 'rgba(220, 230, 255, .3)');
    halo.addColorStop(1, 'rgba(0, 0, 0, 0)');
    ctx.fillStyle = halo;
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(mx, my, mr, 0, Math.PI * 2);
    const mg = ctx.createRadialGradient(mx - mr * 0.3, my - mr * 0.3, mr * 0.1, mx, my, mr);
    mg.addColorStop(0, night ? '#ffb090' : '#fffaf0');
    mg.addColorStop(1, night ? '#c23b22' : '#c8cce0');
    ctx.fillStyle = mg;
    ctx.fill();
    // Облака-полосы тушью поперёк луны.
    ctx.fillStyle = night ? 'rgba(30, 4, 10, .75)' : 'rgba(8, 12, 30, .7)';
    for (let i = 0; i < 4; i++) {
      ctx.beginPath();
      ctx.ellipse(mx + (i % 2 ? -40 : 30) + i * 10, my - mr * 0.4 + i * mr * 0.35, w * 0.16, 4 + i, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Горы в три слоя — размытой тушью.
    const ridge = (base, amp, color, seed) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      for (let x = 0; x <= w; x += 12) {
        const y = base - amp * (0.5 + 0.5 * Math.sin(x / (w * 0.13) + seed)) * (0.6 + 0.4 * Math.sin(x / (w * 0.05) + seed * 2));
        ctx.lineTo(x, y);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    };
    ridge(h * 0.55, h * 0.16, night ? '#2a0a14' : '#141c3c', 1);
    ridge(h * 0.65, h * 0.12, night ? '#1c0610' : '#0e142c', 3);
    // Пагода на холме.
    ctx.save();
    ctx.translate(w * 0.16, h * 0.62);
    const s = Math.min(1.2, h / 600);
    ctx.scale(s, s);
    ctx.fillStyle = '#05060f';
    for (let i = 0; i < 4; i++) {
      const yy = -i * 38;
      const ww = 70 - i * 12;
      ctx.fillRect(-ww * 0.4, yy - 26, ww * 0.8, 26);
      ctx.beginPath();
      ctx.moveTo(-ww, yy - 22);
      ctx.quadraticCurveTo(0, yy - 40, ww, yy - 22);
      ctx.lineTo(ww * 0.7, yy - 30);
      ctx.quadraticCurveTo(0, yy - 46, -ww * 0.7, yy - 30);
      ctx.closePath();
      ctx.fill();
    }
    ctx.fillRect(-2, -190, 4, 40);
    ctx.restore();
    ridge(h * 0.76, h * 0.05, night ? '#100308' : '#070a1a', 5);
    // Крыши деревни вдоль дороги.
    ctx.fillStyle = '#04050c';
    for (let i = 0; i < 9; i++) {
      const x = (i / 8) * w;
      const y = h * 0.8 + (i % 2) * 10;
      const rw = 46 + (i % 3) * 16;
      ctx.fillRect(x - rw * 0.7, y, rw * 1.4, h - y);
      ctx.beginPath();
      ctx.moveTo(x - rw, y + 4);
      ctx.quadraticCurveTo(x, y - 22, x + rw, y + 4);
      ctx.lineTo(x + rw * 0.8, y - 2);
      ctx.quadraticCurveTo(x, y - 30, x - rw * 0.8, y - 2);
      ctx.closePath();
      ctx.fill();
    }
    // Дорога и процессия силуэтов: зонты, рогатые, фонари на шестах.
    ctx.fillStyle = night ? '#0a0206' : '#03040a';
    ctx.fillRect(0, h * 0.9, w, h * 0.1);
    for (let i = 0; i < 14; i++) {
      const x = w * (0.04 + i * 0.07);
      const y = h * 0.91;
      const kind = i % 4;
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(0.8 + (i % 3) * 0.12, 0.8 + (i % 3) * 0.12);
      ctx.fillStyle = '#020208';
      ctx.beginPath();
      ctx.ellipse(0, -18, 7, 18, 0, 0, Math.PI * 2);
      ctx.fill();
      if (kind === 0) {
        ctx.beginPath();
        ctx.moveTo(-12, -30);
        ctx.lineTo(0, -48);
        ctx.lineTo(12, -30);
        ctx.fill();
      } else if (kind === 1) {
        ctx.beginPath();
        ctx.arc(0, -38, 7, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillRect(-6, -50, 2, 8);
        ctx.fillRect(4, -50, 2, 8);
      } else if (kind === 2) {
        ctx.fillRect(6, -60, 2, 44);
      } else {
        ctx.beginPath();
        ctx.arc(0, -38, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.beginPath();
        ctx.moveTo(-6, -44);
        ctx.lineTo(-10, -58);
        ctx.lineTo(-2, -46);
        ctx.moveTo(6, -44);
        ctx.lineTo(10, -58);
        ctx.lineTo(2, -46);
        ctx.fill();
      }
      ctx.restore();
    }
  }
  const BG = { wisps: [], petals: [] };
  function drawBackground(now, dt) {
    const box = bgCv.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    const dpr = fitCanvas(bgCv, w, h);
    const ctx = bctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const night = G.mode === 'night';
    ctx.drawImage(window.SlotRig.layer(VILLAGE, `${w}x${h}@${dpr}|${night}`, w, h, dpr, (c) => paintVillage(c, w, h, night)), 0, 0, w, h);
    // Туман ползёт по низу.
    for (let i = 0; i < 3; i++) {
      const x = ((now / (60 + i * 25)) % (w + 600)) - 300;
      window.SlotRig.glowAt(bctx, x, h * (0.78 + i * 0.06), 260, night ? '120, 40, 50' : '120, 140, 190', 0.12);
    }
    // Огни процессии на шестах мерцают.
    for (let i = 0; i < 14; i += 4) {
      const x = w * (0.04 + (i + 2) * 0.07) + 7;
      window.SlotRig.glowAt(ctx, x, h * 0.91 - 58 * (0.8 + ((i + 2) % 3) * 0.12), 12, '255, 170, 70', 0.6 + 0.3 * Math.sin(now / 130 + i));
    }
    // Гирлянда бумажных фонарей поперёк сцены.
    const n = 9;
    for (let i = 0; i < n; i++) {
      const f = i / (n - 1);
      const x = w * (0.04 + f * 0.92);
      const y = h * 0.05 + Math.sin(f * Math.PI) * h * 0.08 + Math.sin(now / 1200 + i) * 3;
      const fl = 0.7 + 0.3 * Math.sin(now / 150 + i * 2.1) * Math.sin(now / 61 + i);
      window.SlotRig.glowAt(ctx, x, y + 10, 34, night ? '255, 80, 50' : '255, 170, 70', 0.45 * fl);
      ctx.fillStyle = night ? `rgba(230, 70, 40, ${0.7 + 0.3 * fl})` : `rgba(240, 150, 60, ${0.7 + 0.3 * fl})`;
      ctx.beginPath();
      ctx.ellipse(x, y + 10, 7, 9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = 'rgba(2, 2, 8, .8)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    for (let i = 0; i <= 40; i++) {
      const f = i / 40;
      const x = w * (0.04 + f * 0.92);
      const y = h * 0.05 + Math.sin(f * Math.PI) * h * 0.08;
      ctx[i ? 'lineTo' : 'moveTo'](x, y);
    }
    ctx.stroke();
    // Лисьи огни бродят в темноте.
    if (BG.wisps.length < (night ? 14 : 7) && Math.random() < dt * 2) BG.wisps.push({ x: Math.random() * w, y: h * (0.4 + Math.random() * 0.5), ph: Math.random() * 6, life: 0, max: 5 + Math.random() * 5 });
    BG.wisps = BG.wisps.filter((p) => p.life < p.max);
    for (const p of BG.wisps) {
      p.life += dt;
      p.x += Math.sin(now / 1300 + p.ph) * 12 * dt;
      p.y -= 8 * dt;
      const a = Math.sin((p.life / p.max) * Math.PI);
      window.SlotRig.glowAt(ctx, p.x, p.y, 16, GHOST, 0.5 * a);
      window.SlotRig.glowAt(ctx, p.x, p.y, 4, '230, 255, 250', 0.9 * a);
    }
    // Лепестки сакуры.
    if (BG.petals.length < 24 && Math.random() < dt * 4) BG.petals.push({ x: Math.random() * w * 1.2 - w * 0.2, y: -10, v: 20 + Math.random() * 30, spin: Math.random() * 6, r: 3 + Math.random() * 3 });
    BG.petals = BG.petals.filter((p) => p.y < h + 10);
    ctx.fillStyle = 'rgba(255, 190, 205, .7)';
    for (const p of BG.petals) {
      p.spin += dt * 2;
      p.x += (14 + Math.sin(p.spin) * 18) * dt;
      p.y += p.v * dt;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.spin);
      ctx.beginPath();
      ctx.ellipse(0, 0, p.r, p.r * 0.5, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  // ---------- Панель ----------
  function renderBar(dt) {
    if (G.winShown !== G.winTarget) {
      const step = Math.max(1, Math.abs(G.winTarget - G.winShown) * dt * 6);
      G.winShown = G.winShown < G.winTarget ? Math.min(G.winTarget, G.winShown + step) : G.winTarget;
      if (Math.random() < 0.3 && G.winShown < G.winTarget) AUDIO()?.sfx('tick');
    }
    el('yk-win').textContent = fmt(G.winShown);
    el('yk-balance').textContent = fmt(state.balance || 0);
    el('yk-bet').textContent = fmt(G.bet);
    el('yk-spin').classList.toggle('busy', G.busy);
    el('yk-auto').textContent = G.auto > 0 ? (G.auto > 1000 ? '∞' : `${G.auto}`) : 'Авто';
    el('yk-auto').classList.toggle('on', G.auto > 0);
    el('yk-turbo').classList.toggle('on', G.turbo);
    el('yk-maxwin').textContent = fmt(MAX_WIN * G.bet);
  }
  const setMsg = (text) => { el('yk-msg').textContent = text; };

  function renderNightInfo() {
    const box = el('yk-night');
    box.hidden = !G.night;
    if (!G.night) return;
    el('yk-night-left').textContent = G.night.left > 0 ? G.night.left : 'парад';
    el('yk-night-foxes').textContent = G.foxes.length;
    el('yk-night-tails').textContent = G.foxes.length ? `×${Math.max(...G.foxes.map((f) => f.tails))}` : '—';
  }

  // ---------- Показ исхода ----------
  async function present(result) {
    const o = result.outcome;
    G.bet0 = result.bet;
    G.busy = true;
    G.skip = false;
    setSpeed();
    G.winTarget = 0;
    G.winShown = 0;
    G.mode = 'base';
    G.foxes = [];
    G.night = null;
    renderNightInfo();
    setMsg(result.mode === 'spin' ? 'Фонари качнулись — парад начинается' : 'Ворота тории открыты!');
    AUDIO()?.sfx('spin');

    let won = await playSeries(o.base.steps, false, 0);
    if (o.night) won = await playNight(o.night, won);

    G.winTarget = result.payout;
    G.mode = 'base';
    G.foxes = [];
    if (result.payout >= 15 * result.bet) await bigWin(result.payout);
    else if (result.payout > 0) {
      AUDIO()?.sfx(result.payout >= 3 * result.bet ? 'winMid' : 'win');
      setMsg(`Выигрыш ${fmt(result.payout)}`);
    } else {
      setMsg('Парад прошёл мимо');
    }
    G.winShown = G.winTarget;
    send({ type: 'yokai_done', id: result.id });
    G.busy = false;
    G.skip = false;
    setSpeed();
    if (G.auto > 0) {
      if (o.night && G.autoStopOnBonus) G.auto = 0;
      else {
        G.auto -= 1;
        if (G.auto > 0) setTimeout(() => { if (!G.busy && G.auto > 0) doSpin('spin'); }, G.turbo ? 250 : 600);
      }
    }
  }

  // Серия вращений: первое — обычное, дальше лисы шагают и барабаны крутятся заново.
  // grow — в ночи лиса на каждом шаге отращивает хвост.
  async function playSeries(steps, grow, won) {
    const a = AUDIO();
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      if (G.night) {
        if (!step.extra) G.night.left = Math.max(0, step.left - (step.scatter ? 5 : 0));
        renderNightInfo();
      }
      if (i > 0 || G.foxes.length) await walk(step, grow);
      // Клетки, где стоят лисы парада, накрыты ими; новые лисы прилетают с барабаном.
      const walkers = new Set(G.foxes.map((f) => cellOf(f.reel, f.row)));
      const pre = step.grid.map((col, r) => col.map((s, y) => (walkers.has(cellOf(r, y)) ? calmSym() : s)));
      G.landTails = new Map(step.foxes.filter((f) => step.arrived.includes(f.id)).map((f) => [cellOf(f.reel, f.row), f.tails]));
      let torii = 0;
      let anticipate = -1;
      for (let r = 0; r < REELS - 1; r++) {
        if (pre[r].includes('torii')) torii += 1;
        if (torii >= 2 && anticipate < 0) anticipate = r;
      }
      if (anticipate >= 0) a?.sfx('tease');
      if (i > 0 && !G.night) setMsg(`Парад идёт · шаг ${i}`);
      await spinReels(pre, { anticipate });
      // Новые лисы встают в строй парада.
      const arrived = step.foxes.filter((f) => step.arrived.includes(f.id));
      for (const f of arrived) {
        G.grid[f.reel][f.row] = null;
        G.foxes.push({ ...f, born: G.clock });
        a?.sfx('foxCall');
        wisps(cx(f.reel), cy(f.row), 12);
        G.shake = 4;
        await wait(G.turbo ? 120 : 260);
      }
      if (arrived.length && !G.night) {
        await banner('ПАРАД КИЦУНЭ', arrived.length > 1 ? 'лисы шагают влево — вращения бесплатно' : 'лиса шагает влево — вращения бесплатно', 1300, 'small');
      }
      renderNightInfo();
      if (step.wins.length) won += await showWays(step.wins);
      if (step.scatter) {
        G.grid.forEach((col, r) => col.forEach((s, y) => { if (s === 'torii') G.hl.set(cellOf(r, y), G.clock); }));
        a?.sfx('scatter');
        won += step.scatter.pay * G.bet0;
        G.winTarget = won;
        petals(30);
        if (G.night) await banner('ЕЩЁ ПЯТЬ ВРАЩЕНИЙ', 'тории открылись снова', 1500, 'small');
        else await wait(1300);
      }
      if (G.night) G.night.won = won;
      await wait(G.turbo ? 120 : 280);
    }
    // Последний шаг: все лисы уходят за край.
    if (G.foxes.length) await walk(null, false);
    return won;
  }

  // Шаг парада: лисы из прошлого вращения перебегают на барабан левее (или уходят с поля).
  async function walk(step, grow) {
    if (!G.foxes.length) return;
    const a = AUDIO();
    const ms = G.turbo ? 260 : 480;
    const start = G.clock;
    G.ways = null;
    G.hl.clear();
    for (const f of G.foxes) {
      const next = step ? step.foxes.find((x) => x.id === f.id) : null;
      f.from = f.reel;
      f.to = next ? next.reel : f.reel - 1;
      f.leaving = !next;
      f.next = next;
      f.walkStart = start;
      f.walkMs = ms;
    }
    a?.sfx('step');
    await wait(ms);
    G.foxes = G.foxes.filter((f) => !f.leaving).map((f) => ({ ...f, reel: f.to, tails: f.next.tails, from: undefined, to: undefined, next: undefined, grewAt: grow ? G.clock : f.grewAt }));
    if (grow && G.foxes.length) {
      a?.sfx('grow');
      for (const f of G.foxes) wisps(cx(f.reel), cy(f.row), 6);
    }
    renderNightInfo();
  }

  async function showWays(wins) {
    const a = AUDIO();
    const pay = wins.reduce((s, w) => s + w.pay, 0) * G.bet0;
    for (const w of wins) for (const c of w.cells) G.hl.set(c, G.clock);
    G.ways = { wins, at: G.clock };
    a?.sfx(pay >= 5 * G.bet0 ? 'winMid' : 'win');
    G.winTarget += pay;
    setMsg(`Пути: +${fmt(pay)}`);
    await wait(Math.min(2800, 1500 + wins.length * 300));
    return pay;
  }

  async function bigWin(amount) {
    AUDIO()?.sfx('bigwin');
    G.bigWin = { amount, start: G.clock, ms: 5200 };
    coinShower(50);
    petals(40);
    let clicked = false;
    G.onSkip = () => { clicked = true; };
    while (!clicked && G.bigWin && G.clock < G.bigWin.start + 5200) {
      if (Math.random() < 0.4) coinShower(4);
      await wait(200);
    }
    G.onSkip = null;
    G.bigWin = null;
    setMsg(`Выигрыш ${fmt(amount)}!`);
  }

  // ---------- Ночь ста демонов ----------
  async function playNight(night, won) {
    const a = AUDIO();
    await wait(400);
    a?.music('night');
    G.shake = 10;
    petals(50);
    await banner('НОЧЬ СТА ДЕМОНОВ', `${night.spins} вращений · лисы растят хвосты на каждом шаге`, 2800);
    G.mode = 'night';
    G.ways = null;
    G.hl.clear();
    G.foxes = [];
    G.night = { left: night.spins, total: night.spins, won: 0 };
    renderNightInfo();
    setMsg('Ночь ста демонов');
    const before = won;
    won = await playSeries(night.steps, true, won);
    G.winTarget = won;
    a?.sfx('scatter');
    await banner('РАССВЕТ', `ночь принесла ${fmt(night.pay * G.bet0)}`, 2400);
    G.mode = 'base';
    G.night = null;
    G.foxes = [];
    G.ways = null;
    renderNightInfo();
    a?.music('base');
    return Math.max(won, before);
  }

  // ---------- Ставки и кнопки ----------
  function doSpin(mode = 'spin') {
    if (G.busy || G.awaiting) return;
    if (!G.ready) return toast('Фонари ещё зажигаются…');
    const cost = mode === 'buy-bonus' ? G.bet * BUY.bonus : G.bet;
    if (cost > (state.balance || 0)) {
      G.auto = 0;
      return toast(mode === 'spin' ? 'Не хватает фишек на ставку' : `Ночь стоит ${fmt(cost)} — не хватает фишек`);
    }
    AUDIO()?.unlock();
    G.awaiting = true;
    send({ type: 'yokai_spin', bet: G.bet, mode });
  }

  function onResult(msg) {
    G.awaiting = false;
    present(msg).catch((err) => {
      console.error('Ночной парад:', err);
      G.busy = false;
      G.mode = 'base';
      G.foxes = [];
      G.night = null;
      send({ type: 'yokai_done', id: msg.id });
    });
  }

  function onError() {
    if (!G.awaiting) return;
    G.awaiting = false;
    G.auto = 0;
  }

  function changeBet(dir) {
    if (G.busy) return;
    const i = BET_STEPS.indexOf(G.bet);
    G.bet = BET_STEPS[clamp(i + dir, 0, BET_STEPS.length - 1)];
    storage.set(BET_KEY, String(G.bet));
    AUDIO()?.sfx('click');
  }

  function skipOrSpin() {
    if (G.bigWin && G.onSkip) return G.onSkip();
    if (G.busy) {
      G.skip = true;
      setSpeed();
      return;
    }
    doSpin('spin');
  }

  el('yk-spin').addEventListener('click', skipOrSpin);
  reelsCv.addEventListener('click', () => { if (G.busy) skipOrSpin(); });
  el('yk-bet-down').addEventListener('click', () => changeBet(-1));
  el('yk-bet-up').addEventListener('click', () => changeBet(1));
  el('yk-bet-max').addEventListener('click', () => {
    if (G.busy) return;
    const affordable = BET_STEPS.filter((x) => x <= (state.balance || 0));
    G.bet = affordable.length ? affordable[affordable.length - 1] : BET_STEPS[0];
    storage.set(BET_KEY, String(G.bet));
  });
  el('yk-turbo').addEventListener('click', () => {
    G.turbo = !G.turbo;
    storage.set(TURBO_KEY, G.turbo ? '1' : '0');
    setSpeed();
  });
  el('yk-auto').addEventListener('click', () => {
    if (G.auto > 0) {
      G.auto = 0;
      return;
    }
    el('yk-auto-menu').hidden = !el('yk-auto-menu').hidden;
  });
  el('yk-auto-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-auto]');
    if (!b) return;
    G.auto = Number(b.dataset.auto);
    G.autoStopOnBonus = el('yk-auto-stop').checked;
    el('yk-auto-menu').hidden = true;
    doSpin('spin');
  });
  el('yk-buy').addEventListener('click', () => {
    if (G.busy) return;
    el('yk-buy-price').textContent = fmt(G.bet * BUY.bonus);
    el('yk-buy-modal').hidden = false;
  });
  el('yk-buy-modal').addEventListener('click', (e) => {
    if (e.target === el('yk-buy-modal') || e.target.closest('[data-close]')) el('yk-buy-modal').hidden = true;
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    el('yk-buy-modal').hidden = true;
    doSpin(b.dataset.buy);
  });
  el('yk-info').addEventListener('click', () => {
    renderPaytable();
    el('yk-pay-modal').hidden = false;
  });
  el('yk-pay-modal').addEventListener('click', (e) => {
    if (e.target === el('yk-pay-modal') || e.target.closest('[data-close]')) el('yk-pay-modal').hidden = true;
  });
  el('yk-sound').addEventListener('click', () => {
    const au = AUDIO();
    if (!au) return;
    au.unlock();
    el('yk-sound').classList.toggle('off', !au.toggle());
  });
  el('yk-sound').classList.toggle('off', !(AUDIO() && AUDIO().isMusicOn()));

  function symImg(s) {
    const img = document.createElement('img');
    if (G.img[s]) img.src = G.img[s].toDataURL();
    img.className = 'painted';
    img.alt = NAMES[s];
    return img;
  }
  function renderPaytable() {
    el('yk-pays').replaceChildren(...Object.keys(PAYS).reverse().map((s) => {
      const d = document.createElement('div');
      d.className = 'kr-pay';
      const list = document.createElement('div');
      for (let i = 2; i >= 0; i--) list.append(Object.assign(document.createElement('span'), { innerHTML: `<b>${i + 3}×</b> ${fmt((PAYS[s][i] * G.bet) / UNIT)}` }));
      d.append(symImg(s), list);
      return d;
    }));
    el('yk-pay-fox').replaceChildren(symImg('fox'));
    el('yk-pay-torii').replaceChildren(symImg('torii'));
    el('yk-pay-bet').textContent = fmt(G.bet);
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || el('yokai').hidden) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button')) return;
    if (!el('yk-buy-modal').hidden || !el('yk-pay-modal').hidden) return;
    e.preventDefault();
    if (!e.repeat) skipOrSpin();
  });

  function renderFeed(feed) {
    const myId = state.me && state.me.playerId;
    el('yk-feed').replaceChildren(...(feed.length ? feed.map((e) => {
      const li = document.createElement('li');
      const win = e.payout > e.cost;
      li.className = win ? 'win' : 'lose';
      if (e.playerId === myId) li.classList.add('self');
      li.append(avatarEl(e.name));
      li.append(Object.assign(document.createElement('span'), { className: 'name', textContent: e.name }));
      li.append(Object.assign(document.createElement('span'), { className: 'u-what', textContent: win ? `+${fmt(e.payout - e.cost)}` : `−${fmt(e.cost - e.payout)}` }));
      const tag = e.night ? '⛩️ ночь ста демонов' : e.parade ? `🦊 парад · ${e.parade} шаг.` : `×${e.mult}`;
      li.append(Object.assign(document.createElement('span'), { className: 'u-ch', textContent: tag }));
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Парад ещё не начинался' })]));
  }

  handlers.yokai_result = onResult;
  handlers.yokai_feed = (msg) => renderFeed(msg.feed);
  window.yokaiOnError = onError;
  window.yokaiTabShown = (on) => { AUDIO()?.setActive(on); };
  if (!el('yokai').hidden) window.yokaiTabShown(true);

  renderFeed([]);
  loadArt();
  requestAnimationFrame(frame);
})();
