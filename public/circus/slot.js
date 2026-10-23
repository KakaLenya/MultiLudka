// «Заброшенный цирк» — клиент слота. Исход спина целиком приходит с сервера (circus_result),
// здесь только его показ: барабан распорядителя с модификатором, вращение, линии и метатель ножей.
// Метатель — единственное место, где игрок выбирает: он кликает по сектору щита, но призы и их порядок
// уже посчитаны на сервере — клик решает только, в каком секторе покажется очередной приз.
// Когда показ закончен, шлём circus_done — сервер зачисляет выигрыш.
// Пользуется общими штуками зала из client.js: send, state, toast, handlers, storage, avatarEl.
(function () {
  'use strict';

  const AUDIO = () => window.CircusAudio || null;

  // ---------- Как на сервере (server/circus-math.js) ----------
  const REELS = 5;
  const ROWS = 3;
  const PAY_SCALE = 2.05;
  const LINES = [
    [1, 1, 1, 1, 1], [0, 0, 0, 0, 0], [2, 2, 2, 2, 2], [0, 1, 2, 1, 0], [2, 1, 0, 1, 2],
    [0, 0, 1, 2, 2], [2, 2, 1, 0, 0], [1, 0, 0, 0, 1], [1, 2, 2, 2, 1], [1, 0, 1, 2, 1],
    [1, 2, 1, 0, 1], [0, 1, 0, 1, 0], [2, 1, 2, 1, 2], [1, 1, 0, 1, 1], [1, 1, 2, 1, 1],
    [0, 1, 1, 1, 0], [2, 1, 1, 1, 2], [0, 2, 0, 2, 0], [2, 0, 2, 0, 2], [0, 0, 2, 0, 0],
    [2, 2, 0, 2, 2], [1, 0, 2, 0, 1], [1, 2, 0, 2, 1], [0, 2, 2, 2, 0], [2, 0, 0, 0, 2],
  ];
  const PAYS = {
    ticket: [4, 10, 30], popcorn: [4, 10, 30], pins: [5, 12, 40], tophat: [5, 12, 40],
    bear: [8, 25, 80], strongman: [10, 30, 100], teller: [12, 40, 150], acrobat: [15, 50, 200], clown: [25, 100, 500],
  };
  const NAMES = {
    ticket: 'Билет', popcorn: 'Попкорн', pins: 'Булавы', tophat: 'Цилиндр', bear: 'Медведь', strongman: 'Силач', teller: 'Гадалка', acrobat: 'Акробатка', clown: 'Клоун', hoop: 'Огненный обруч', target: 'Мишень',
  };
  const MOD_NAMES = {
    blank: 'Антракт', clowns: 'Клоуны размножаются', trained: 'Дрессировка', x2: 'Множитель ×2', x3: 'Множитель ×3', x5: 'Множитель ×5', again: 'Вторая попытка', hoops: 'Огненные обручи', target: 'Ещё мишень',
  };
  const MOD_ICONS = { blank: '🎭', clowns: '🤡', trained: '🎩', x2: '✖2', x3: '✖3', x5: '✖5', again: '🔁', hoops: '🔥', target: '🎯' };
  const MOD_ORDER = ['blank', 'clowns', 'x2', 'blank', 'trained', 'x3', 'blank', 'again', 'hoops', 'blank', 'x5', 'target'];
  const BUY = { knives: 82 };
  const SCATTER_PAY = { 3: 2, 4: 10, 5: 50 };
  const FILLER = ['ticket', 'popcorn', 'pins', 'tophat', 'ticket', 'popcorn', 'pins', 'tophat', 'bear', 'strongman', 'teller', 'acrobat', 'clown', 'hoop', 'target'];
  const CALM = ['ticket', 'popcorn', 'pins', 'tophat', 'bear', 'strongman', 'teller', 'acrobat'];
  const BET_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
  const BIG_WINS = [[500, 'ЛЕГЕНДАРНЫЙ ВЫИГРЫШ'], [100, 'ЭПИЧЕСКИЙ ВЫИГРЫШ'], [50, 'ОГРОМНЫЙ ВЫИГРЫШ'], [15, 'БОЛЬШОЙ ВЫИГРЫШ']];
  const LINE_COLORS = ['#ffd45c', '#ff6a5a', '#7fe0c0', '#ff9a3a', '#c88aff', '#5fd0ff', '#ff7ab6', '#b0ff6a', '#ffb0a0', '#6aa8ff',
    '#ffe08a', '#ff5a8a', '#8affd0', '#ffa86a', '#d0a0ff', '#6af0ff', '#ff9ad0', '#d0ff8a', '#ffc0b0', '#8ab8ff',
    '#fff0a0', '#ff8a6a', '#a0ffe0', '#ffc08a', '#e0b0ff'];
  const TITLE_FONT = '"Kelly Slab", Georgia, serif';
  const NUM_FONT = 'Oswald, "Arial Narrow", sans-serif';

  // ---------- Геометрия ----------
  const CELL = 126;
  const FR = 28;
  const TOP = 78;                          // полоса барабана распорядителя над полем
  const W = REELS * CELL + 2 * FR;
  const H = TOP + ROWS * CELL + 2 * FR;
  const RY = TOP + FR;                     // верх поля
  const cx = (r) => FR + r * CELL + CELL / 2;
  const cy = (y) => RY + y * CELL + CELL / 2;
  const cellOf = (r, y) => r * ROWS + y;
  const reelOf = (c) => Math.floor(c / ROWS);
  const rowOf = (c) => c % ROWS;
  const INK = '#120a08';
  // Барабан распорядителя.
  const MW = 330;
  const MH = 54;
  const MX = (W - MW) / 2;
  const MY = 14;

  const fmt = (n) => chips(Math.floor(n));
  const ease = {
    out: (t) => 1 - (1 - t) ** 3,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    back: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- Состояние ----------
  const BET_KEY = 'casino.circus.bet';
  const TURBO_KEY = 'casino.circus.turbo';
  const G = {
    ready: false,
    img: {},
    blur: {},
    rig: {},
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
    grid: null,
    reels: [],
    hl: new Map(),
    lines: null,
    trained: null,           // символ, который в этот ход дикий
    hoopReels: new Set(),
    mod: { type: 'blank', spin: null, shown: 'blank', at: -1e9 },
    mult: 1,
    fx: [],
    banner: null,
    bigWin: null,
    shake: 0,
    knives: null,            // метатель ножей
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
  // Символы нарисованы вручную и собраны из деталей (circus/rig.js): в кадре живут.
  async function loadArt() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(CELL * dpr);
    const A = window.SlotArt;
    const SR = window.SlotRig;
    await Promise.all([document.fonts.load(`700 20px ${NUM_FONT}`), document.fonts.load(`20px ${TITLE_FONT}`)]).catch(() => {});
    const jobs = Object.entries(window.CircusRig.SYMBOLS).map(async ([k, def]) => {
      const rig = await SR.build(def, px);
      G.rig[k] = rig;
      G.img[k] = rig.still;
      G.blur[k] = A.motionBlur(rig.still);
    });
    jobs.push(A.loadImage('textures/wood-old.jpg').then((img) => { G.texWood = img; }));
    jobs.push(A.loadImage('textures/leather.jpg').then((img) => { G.texVelvet = img; }));
    await Promise.all(jobs);
    G.ready = true;
  }

  // ---------- Разметка ----------
  const el = (id) => document.getElementById(id);
  document.body.append(el('cc-buy-modal'), el('cc-pay-modal'));
  const reelsCv = el('cc-reels');
  const bgCv = el('cc-bg');
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
    return s === 'hoop' && (r === 0 || r === 4) ? 'clown' : s;
  }
  G.grid = Array.from({ length: REELS }, () => Array.from({ length: ROWS }, calmSym));
  G.reels = Array.from({ length: REELS }, () => ({ spinning: false }));

  // ---------- Вращение ----------
  function spinReels(grid, { anticipate = -1 } = {}) {
    const fast = G.turbo;
    const base = fast ? 420 : 820;
    const gap = fast ? 90 : 170;
    const jobs = [];
    G.hl.clear();
    G.lines = null;
    for (let r = 0; r < REELS; r++) {
      const extra = anticipate >= 0 && r > anticipate ? (r - anticipate) * 900 : 0;
      const dur = base + r * gap + extra;
      const len = 12 + r * 3 + Math.round(extra / 60);
      const strip = [];
      for (let i = 0; i < len; i++) strip.push(randomSym(r));
      const reel = {
        spinning: true,
        strip: [...grid[r].slice().reverse(), ...strip, ...G.grid[r].slice().reverse()],
        start: G.clock,
        dur,
        anticipating: extra > 0,
      };
      reel.dist = reel.strip.length - ROWS;
      G.reels[r] = reel;
      jobs.push(wait(dur).then(() => {
        reel.spinning = false;
        G.grid[r] = grid[r].slice();
        const a = AUDIO();
        a?.sfx('stop', r);
        if (grid[r].includes('target')) a?.sfx('target', r);
        else if (grid[r].includes('hoop')) a?.sfx('fire', r);
      }));
    }
    return Promise.all(jobs);
  }
  function reelOffset(reel) {
    const t = clamp((G.clock - reel.start) / reel.dur, 0, 1);
    if (t < 0.08) return reel.dist + Math.sin((t / 0.08) * Math.PI) * 0.18;
    return reel.dist * (1 - ease.back((t - 0.08) / 0.92));
  }

  // Барабан распорядителя: лента табличек, останавливается на модификаторе хода.
  function spinMod(type) {
    const fast = G.turbo;
    const dur = fast ? 380 : 700;
    const strip = [type];
    for (let i = 0; i < 9; i++) strip.push(MOD_ORDER[(i * 5 + Math.floor(Math.random() * 12)) % MOD_ORDER.length]);
    strip.push(G.mod.shown);
    G.mod = { type, shown: G.mod.shown, spin: { strip, start: G.clock, dur, dist: strip.length - 1 }, at: -1e9 };
    AUDIO()?.sfx('drum');
    return wait(dur).then(() => {
      G.mod.spin = null;
      G.mod.shown = type;
      G.mod.at = G.clock;
      AUDIO()?.sfx(type === 'blank' ? 'stop' : 'mod', 2);
    });
  }

  // ---------- Рисование ----------
  const cellSlots = new Map();
  function slotOf(key) {
    let s = cellSlots.get(key);
    if (!s) cellSlots.set(key, (s = {}));
    return s;
  }
  function drawSymbol(ctx, s, x, y, { blur = false, scale = 1, alpha = 1, win = 0, ph = 0, slot = null } = {}) {
    const size = CELL * 0.94 * scale;
    const rig = G.rig[s];
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

  function roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // Неподвижные слои — картинками (SlotRig.layer).
  const UNDER = {};
  const FRAME = {};
  const layerDpr = () => Math.min(2, window.devicePixelRatio || 1);
  function paintUnder(ctx) {
    // Поле: старые доски манежа под пыльным бархатом.
    for (let r = 0; r < REELS; r++) {
      const x = FR + r * CELL;
      if (G.texWood) {
        ctx.fillStyle = ctx.createPattern(G.texWood, 'repeat');
        ctx.fillRect(x, RY, CELL, ROWS * CELL);
      }
      const g = ctx.createLinearGradient(x, RY, x, RY + ROWS * CELL);
      g.addColorStop(0, 'rgba(40, 10, 14, .86)');
      g.addColorStop(1, 'rgba(8, 2, 4, .95)');
      ctx.fillStyle = g;
      ctx.fillRect(x, RY, CELL, ROWS * CELL);
    }
    for (let r = 1; r < REELS; r++) {
      const x = FR + r * CELL;
      ctx.fillStyle = 'rgba(0, 0, 0, .5)';
      ctx.fillRect(x - 2, RY, 4, ROWS * CELL);
      ctx.fillStyle = 'rgba(201, 150, 46, .2)';
      ctx.fillRect(x - 0.5, RY, 1, ROWS * CELL);
    }
    // Окошко барабана распорядителя.
    roundRect(ctx, MX - 8, MY - 6, MW + 16, MH + 12, 14);
    ctx.fillStyle = '#0a0406';
    ctx.fill();
  }
  function paintFrame(ctx) {
    // Рама поля: полосатый борт манежа (кармин/крем) с латунными уголками.
    const x0 = FR - 12;
    const y0 = RY - 12;
    const w = REELS * CELL + 24;
    const h = ROWS * CELL + 24;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 26;
    roundRect(ctx, x0, y0, w, h, 14);
    ctx.stroke();
    ctx.save();
    roundRect(ctx, x0, y0, w, h, 14);
    ctx.lineWidth = 18;
    ctx.setLineDash([22, 22]);
    ctx.strokeStyle = '#7a1e22';
    ctx.stroke();
    ctx.lineDashOffset = 22;
    ctx.strokeStyle = '#cdbf9e';
    ctx.stroke();
    ctx.restore();
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, 'rgba(255, 240, 200, .1)');
    g.addColorStop(0.5, 'rgba(0, 0, 0, .35)');
    g.addColorStop(1, 'rgba(0, 0, 0, .15)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 18;
    roundRect(ctx, x0, y0, w, h, 14);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(201, 150, 46, .6)';
    ctx.lineWidth = 2;
    roundRect(ctx, x0 - 10, y0 - 10, w + 20, h + 20, 20);
    ctx.stroke();
    roundRect(ctx, x0 + 10, y0 + 10, w - 20, h - 20, 8);
    ctx.stroke();
    // Рамка барабана распорядителя: латунь и бархат.
    roundRect(ctx, MX - 8, MY - 6, MW + 16, MH + 12, 14);
    ctx.lineWidth = 6;
    ctx.strokeStyle = '#8a6a2e';
    ctx.stroke();
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#e8c87a';
    ctx.stroke();
    ctx.restore();
  }
  function drawReelsBackground(ctx) {
    const dpr = layerDpr();
    ctx.drawImage(window.SlotRig.layer(UNDER, `${dpr}|${!!G.texWood}`, W, H, dpr, paintUnder), 0, 0, W, H);
    // Огненные обручи: барабан в огне.
    for (const r of G.hoopReels) {
      const x = FR + r * CELL;
      const g = ctx.createLinearGradient(x, 0, x + CELL, 0);
      g.addColorStop(0, 'rgba(255, 110, 30, 0)');
      g.addColorStop(0.5, `rgba(255, 110, 30, ${0.35 + 0.1 * Math.sin(G.clock / 120)})`);
      g.addColorStop(1, 'rgba(255, 110, 30, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(x, RY, CELL, ROWS * CELL);
    }
  }
  function drawFrame(ctx, t) {
    const dpr = layerDpr();
    ctx.drawImage(window.SlotRig.layer(FRAME, String(dpr), W, H, dpr, paintFrame), 0, 0, W, H);
    // Лампочки по борту манежа: бегущие огни, на выигрыше — быстрее.
    const x0 = FR - 12;
    const y0 = RY - 12;
    const w = REELS * CELL + 24;
    const h = ROWS * CELL + 24;
    const fast = G.lines || G.knives ? 3 : 1;
    const per = [];
    for (let i = 0; i <= 14; i++) per.push([x0 + (w * i) / 14, y0], [x0 + (w * i) / 14, y0 + h]);
    for (let i = 1; i < 6; i++) per.push([x0, y0 + (h * i) / 6], [x0 + w, y0 + (h * i) / 6]);
    per.forEach(([x, y], i) => {
      const on = 0.25 + 0.75 * Math.max(0, Math.sin(t / (260 / fast) - i * 0.7));
      window.SlotRig.glowAt(ctx, x, y, 10, '255, 200, 110', 0.55 * on);
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(255, ${190 + 50 * on}, ${110 + 80 * on}, ${0.4 + 0.6 * on})`;
      ctx.fill();
    });
  }

  // Табличка модификатора.
  function drawModPlate(ctx, type, x, y, alpha = 1) {
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const name = MOD_NAMES[type];
    const icon = MOD_ICONS[type];
    ctx.font = `22px ${TITLE_FONT}`;
    const tw = ctx.measureText(name).width;
    const total = tw + 40;
    ctx.font = '24px serif';
    ctx.fillText(icon.startsWith('✖') ? '' : icon, x - total / 2 + 14, y + 1);
    if (icon.startsWith('✖')) {
      ctx.font = `700 22px ${NUM_FONT}`;
      ctx.fillStyle = '#ffcf5a';
      ctx.fillText(icon.replace('✖', '×'), x - total / 2 + 14, y + 1);
    }
    ctx.font = `22px ${TITLE_FONT}`;
    ctx.fillStyle = type === 'blank' ? '#a89a88' : '#f6e2b0';
    ctx.fillText(name, x + 18, y + 1);
    ctx.restore();
  }
  function drawMod(ctx, t) {
    ctx.save();
    roundRect(ctx, MX, MY, MW, MH, 10);
    const bg = ctx.createLinearGradient(0, MY, 0, MY + MH);
    bg.addColorStop(0, '#2a0a0e');
    bg.addColorStop(0.5, '#4a1218');
    bg.addColorStop(1, '#1a0608');
    ctx.fillStyle = bg;
    ctx.fill();
    ctx.clip();
    const m = G.mod;
    if (m.spin) {
      const k = clamp((G.clock - m.spin.start) / m.spin.dur, 0, 1);
      const off = m.spin.dist * (1 - ease.back(k));
      const first = Math.floor(off);
      const frac = off - first;
      for (let i = -1; i <= 1; i++) {
        const idx = first + i;
        const type = m.spin.strip[idx];
        if (!type) continue;
        drawModPlate(ctx, type, W / 2, MY + MH / 2 + (frac - i) * MH, 0.9);
      }
    } else {
      drawModPlate(ctx, m.shown, W / 2, MY + MH / 2);
      // Только что выпавший модификатор вспыхивает.
      const k = (G.clock - m.at) / 900;
      if (k >= 0 && k < 1 && m.shown !== 'blank') {
        ctx.fillStyle = `rgba(255, 220, 140, ${0.35 * (1 - k)})`;
        ctx.fillRect(MX, MY, MW, MH);
      }
    }
    // Тени сверху и снизу — объём барабана.
    const sh = ctx.createLinearGradient(0, MY, 0, MY + MH);
    sh.addColorStop(0, 'rgba(0, 0, 0, .6)');
    sh.addColorStop(0.3, 'rgba(0, 0, 0, 0)');
    sh.addColorStop(0.7, 'rgba(0, 0, 0, 0)');
    sh.addColorStop(1, 'rgba(0, 0, 0, .6)');
    ctx.fillStyle = sh;
    ctx.fillRect(MX, MY, MW, MH);
    ctx.restore();
    // Множитель хода — медаль справа от барабана.
    if (G.mult > 1) {
      const x = MX + MW + 46;
      const y = MY + MH / 2;
      window.SlotRig.glowAt(ctx, x, y, 40, '255, 190, 60', 0.4 + 0.15 * Math.sin(t / 150));
      ctx.beginPath();
      ctx.arc(x, y, 24, 0, Math.PI * 2);
      const g = ctx.createRadialGradient(x - 6, y - 7, 2, x, y, 24);
      g.addColorStop(0, '#fff1b0');
      g.addColorStop(0.6, '#d8901f');
      g.addColorStop(1, '#6a3a08');
      ctx.fillStyle = g;
      ctx.fill();
      ctx.lineWidth = 3;
      ctx.strokeStyle = INK;
      ctx.stroke();
      ctx.font = `700 20px ${NUM_FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#2a1404';
      ctx.fillText(`×${G.mult}`, x, y + 1);
    }
  }

  function drawCells(ctx, t) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(FR, RY, REELS * CELL, ROWS * CELL);
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
          const c = cellOf(r, ROWS - 1 - idx);
          const fin = idx < ROWS;
          drawSymbol(ctx, s, cx(r), RY + (k + frac) * CELL + CELL / 2, { blur, ph: fin ? c * 1.7 : idx * 1.3 + r, slot: slotOf(fin ? c : `s${r}:${idx}`) });
        }
        if (reel.anticipating) {
          const a = 0.55 + 0.35 * Math.sin(t / 90);
          ctx.strokeStyle = `rgba(255, 200, 90, ${a})`;
          ctx.lineWidth = 4;
          ctx.strokeRect(FR + r * CELL + 3, RY + 3, CELL - 6, ROWS * CELL - 6);
        }
        continue;
      }
      for (let y = 0; y < ROWS; y++) {
        const c = cellOf(r, y);
        const s = G.grid[r][y];
        const hl = G.hl.get(c);
        let scale = 1;
        if (hl !== undefined) {
          scale = 1 + 0.07 * ease.back(clamp((G.clock - hl) / 260, 0, 1));
          window.SlotRig.glowAt(ctx, cx(r), cy(y), CELL * 0.6, '255, 200, 120', 0.3);
        }
        const dim = G.lines && hl === undefined ? 0.45 : 1;
        drawSymbol(ctx, s, cx(r), cy(y), { scale, alpha: dim, win: hl !== undefined ? 1 : 0, ph: c * 1.7, slot: slotOf(c) });
        // Дрессированный символ: бирка «дикий».
        if (G.trained && s === G.trained) {
          ctx.save();
          ctx.translate(cx(r) + CELL * 0.28, cy(y) - CELL * 0.34);
          ctx.rotate(0.2);
          roundRect(ctx, -26, -11, 52, 22, 6);
          ctx.fillStyle = '#c9962e';
          ctx.fill();
          ctx.lineWidth = 2;
          ctx.strokeStyle = INK;
          ctx.stroke();
          ctx.font = `13px ${TITLE_FONT}`;
          ctx.textAlign = 'center';
          ctx.textBaseline = 'middle';
          ctx.fillStyle = '#2a1404';
          ctx.fillText('WILD', 0, 1);
          ctx.restore();
        }
      }
    }
    ctx.restore();
  }

  // Линии выигрыша.
  function linePoints(line) {
    const rows = LINES[line];
    const pts = rows.map((y, r) => [cx(r), cy(y)]);
    return [[FR - 6, pts[0][1]], ...pts, [FR + REELS * CELL + 6, pts[4][1]]];
  }
  function drawLines(ctx) {
    const L = G.lines;
    if (!L || !L.wins.length) return;
    const k = (G.clock - L.at) / 1000;
    const all = k < 1.6;
    const list = all ? L.wins : [L.wins[Math.floor((k - 1.6) / 1.2) % L.wins.length]];
    const prog = clamp(k / 0.5, 0, 1);
    for (const w of list) {
      const pts = linePoints(w.line);
      const color = LINE_COLORS[w.line];
      const draw = () => {
        ctx.beginPath();
        const n = pts.length - 1;
        const upto = all ? prog * n : n;
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i <= n; i++) {
          const f = clamp(upto - (i - 1), 0, 1);
          if (f <= 0) break;
          ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f);
        }
      };
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      draw();
      ctx.strokeStyle = 'rgba(0, 0, 0, .6)';
      ctx.lineWidth = 9;
      ctx.stroke();
      draw();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 14;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 4;
      ctx.stroke();
      ctx.restore();
      if (!all) {
        const last = w.cells[w.cells.length - 1];
        const x = cx(reelOf(last));
        const y = cy(rowOf(last)) - CELL * 0.42;
        const text = `${NAMES[w.symbol]} × ${w.len} · +${fmt(w.pay * L.mult * G.bet0)}`;
        ctx.save();
        ctx.font = `700 16px ${NUM_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(text).width + 18;
        const xx = clamp(x, FR + tw / 2, W - FR - tw / 2);
        roundRect(ctx, xx - tw / 2, y - 13, tw, 26, 13);
        ctx.fillStyle = 'rgba(30, 6, 10, .92)';
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
  const CONFETTI = ['#ffd45c', '#ff5a5a', '#5fd0ff', '#b0ff6a', '#ff9ad0', '#fff4dc'];
  function confetti(x, y, n = 24, power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (80 + Math.random() * 200) * power;
      G.fx.push({ kind: 'conf', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 120, life: 1.2 + Math.random() * 0.6, age: 0, color: CONFETTI[i % CONFETTI.length], rot: Math.random() * 6, vr: (Math.random() - 0.5) * 14 });
    }
  }
  function spark(x, y, n = 12, color = '#ffd45c', power = 1) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = (60 + Math.random() * 180) * power;
      G.fx.push({ kind: 'spark', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v - 60, life: 0.6 + Math.random() * 0.5, age: 0, color, r: 2 + Math.random() * 2.5 });
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
      if (p.kind === 'conf') {
        p.vy += 260 * dt;
        p.vx *= 1 - dt * 1.2;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.rot += p.vr * dt;
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate(p.rot);
        ctx.scale(1, Math.abs(Math.cos(p.rot * 1.3)) * 0.8 + 0.2);
        ctx.globalAlpha = 1 - k * k;
        ctx.fillStyle = p.color;
        ctx.fillRect(-4, -2.5, 8, 5);
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
        const cg = ctx.createRadialGradient(-p.r * 0.3, -p.r * 0.3, 1, 0, 0, p.r);
        cg.addColorStop(0, '#fff6c0');
        cg.addColorStop(0.5, '#f2b632');
        cg.addColorStop(1, '#9a5d0a');
        ctx.beginPath();
        ctx.arc(0, 0, p.r, 0, Math.PI * 2);
        ctx.fillStyle = cg;
        ctx.fill();
        ctx.strokeStyle = '#6b3d06';
        ctx.lineWidth = 1.5;
        ctx.stroke();
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

  // ---------- Метатель ножей ----------
  // Щит из секторов крутится в центре поля; игрок кликает сектор, нож летит, сектор открывается.
  const BOARD_R = 168;
  const BCX = W / 2;
  const BCY = RY + (ROWS * CELL) / 2;
  function sectorAt(x, y) {
    const K = G.knives;
    const dx = x - BCX;
    const dy = y - BCY;
    const d = Math.hypot(dx, dy);
    if (d > BOARD_R || d < 26) return -1;
    const n = K.size;
    let a = Math.atan2(dy, dx) - K.rot;
    a = ((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    return Math.floor((a / (Math.PI * 2)) * n);
  }
  const prizeText = (v) => (v === 'x2' ? '×2' : v === 'knives' ? '+2 🔪' : v === 'assistant' ? '' : `×${v}`);
  function drawAssistant(ctx, x, y, s, scared) {
    // Силуэт ассистентки в блёстках: руки в стороны.
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.fillStyle = '#e8c8a8';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(0, -16, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = '#e8c8a8';
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(-14, scared ? -22 : -6);
    ctx.lineTo(0, -6);
    ctx.lineTo(14, scared ? -22 : -6);
    ctx.stroke();
    ctx.fillStyle = '#c03848';
    ctx.beginPath();
    ctx.moveTo(-6, -9);
    ctx.lineTo(6, -9);
    ctx.lineTo(8, 8);
    ctx.lineTo(-8, 8);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = '#e8c8a8';
    ctx.beginPath();
    ctx.moveTo(-4, 8);
    ctx.lineTo(-6, 22);
    ctx.moveTo(4, 8);
    ctx.lineTo(6, 22);
    ctx.stroke();
    ctx.restore();
  }
  function drawKnives(ctx, t) {
    const K = G.knives;
    if (!K) return;
    const appear = clamp((G.clock - K.at) / 600, 0, 1);
    ctx.save();
    ctx.fillStyle = `rgba(8, 2, 4, ${0.78 * appear})`;
    ctx.fillRect(FR, RY, REELS * CELL, ROWS * CELL);
    window.SlotRig.glowAt(ctx, BCX, BCY, BOARD_R + 70, '255, 200, 120', 0.18 * appear);
    ctx.translate(BCX, BCY);
    const sc = ease.back(appear);
    ctx.scale(sc, sc);
    const n = K.size;
    // Щит.
    ctx.save();
    ctx.rotate(K.rot);
    for (let i = 0; i < n; i++) {
      const a0 = (i / n) * Math.PI * 2;
      const a1 = ((i + 1) / n) * Math.PI * 2;
      const shown = K.shown.get(i);
      const hover = K.hover === i && K.picking && shown === undefined;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.arc(0, 0, BOARD_R, a0, a1);
      ctx.closePath();
      ctx.fillStyle = shown === 'assistant' ? '#3a0a10' : shown !== undefined ? (i % 2 ? '#5a3a14' : '#6e4a1a') : hover ? '#a8323a' : i % 2 ? '#7a1e22' : '#cdbf9e';
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = INK;
      ctx.stroke();
      const am = (a0 + a1) / 2;
      const tx = Math.cos(am) * BOARD_R * 0.68;
      const ty = Math.sin(am) * BOARD_R * 0.68;
      ctx.save();
      ctx.translate(tx, ty);
      ctx.rotate(-K.rot);
      if (shown === 'assistant') {
        drawAssistant(ctx, 0, 0, 1.1, true);
      } else if (shown !== undefined) {
        ctx.font = `700 ${shown === 'knives' ? 15 : 18}px ${NUM_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.lineWidth = 4;
        ctx.strokeStyle = INK;
        ctx.strokeText(prizeText(shown), 0, 0);
        ctx.fillStyle = shown === 'x2' || shown === 'knives' ? '#7fe0c0' : '#ffd45c';
        ctx.fillText(prizeText(shown), 0, 0);
      } else {
        ctx.font = `20px ${TITLE_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillStyle = i % 2 ? '#e8c8a0' : '#5a1218';
        ctx.fillText('?', 0, 1);
      }
      ctx.restore();
    }
    // Ножи, уже воткнутые в щит.
    for (const s of K.stuck) {
      ctx.save();
      ctx.rotate(s.a);
      ctx.translate(BOARD_R * 0.86, 0);
      ctx.rotate(Math.PI / 2 + 0.15);
      ctx.fillStyle = '#d8dce0';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-4, 16);
      ctx.lineTo(4, 16);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3a2010';
      ctx.fillRect(-4, 16, 8, 16);
      ctx.strokeRect(-4, 16, 8, 16);
      ctx.restore();
    }
    ctx.restore();
    // Обод и ступица.
    ctx.beginPath();
    ctx.arc(0, 0, BOARD_R, 0, Math.PI * 2);
    ctx.lineWidth = 10;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.lineWidth = 5;
    ctx.strokeStyle = '#c9962e';
    ctx.stroke();
    for (let i = 0; i < 20; i++) {
      const a = (i / 20) * Math.PI * 2 + t / 900;
      const on = 0.3 + 0.7 * Math.max(0, Math.sin(t / 200 - i));
      window.SlotRig.glowAt(ctx, Math.cos(a) * BOARD_R, Math.sin(a) * BOARD_R, 9, '255, 200, 110', 0.6 * on);
    }
    ctx.beginPath();
    ctx.arc(0, 0, 24, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1408';
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#c9962e';
    ctx.stroke();
    ctx.font = `700 16px ${NUM_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffd45c';
    ctx.fillText(`${K.left}🔪`, 0, 1);
    ctx.restore();
    // Летящий нож.
    if (K.flight) {
      const f = K.flight;
      const k = clamp((G.clock - f.start) / f.ms, 0, 1);
      const x = f.from[0] + (f.to[0] - f.from[0]) * k;
      const y = f.from[1] + (f.to[1] - f.from[1]) * k;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(Math.atan2(f.to[1] - f.from[1], f.to[0] - f.from[0]) + Math.PI / 2 + k * Math.PI * 4);
      ctx.fillStyle = '#e8ecf0';
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(0, -22);
      ctx.lineTo(-5, 0);
      ctx.lineTo(5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = '#3a2010';
      ctx.fillRect(-4, 0, 8, 18);
      ctx.restore();
    }
    // Табло: сумма и подсказка.
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 22px ${NUM_FONT}`;
    ctx.lineWidth = 5;
    ctx.strokeStyle = INK;
    const total = `${fmt(K.sum * G.bet0)}${K.doubled ? ` ×${2 ** K.doubled}` : ''}`;
    ctx.strokeText(total, BCX, RY + ROWS * CELL - 14);
    ctx.fillStyle = '#ffd45c';
    ctx.fillText(total, BCX, RY + ROWS * CELL - 14);
    if (K.picking) {
      ctx.font = `17px ${TITLE_FONT}`;
      ctx.fillStyle = `rgba(246, 226, 176, ${0.6 + 0.4 * Math.sin(t / 200)})`;
      ctx.fillText('Выбери сектор — бросай нож', BCX, RY + 16);
    }
    ctx.restore();
  }

  function pickSector(i) {
    const K = G.knives;
    if (!K || !K.picking || i < 0 || K.shown.has(i)) return;
    K.picking = false;
    K.resolve(i);
  }
  reelsCv.addEventListener('pointermove', (e) => {
    const K = G.knives;
    if (!K || !K.picking) return;
    const box = reelsCv.getBoundingClientRect();
    K.hover = sectorAt(((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H);
    reelsCv.style.cursor = K.hover >= 0 && !K.shown.has(K.hover) ? 'crosshair' : '';
  });
  reelsCv.addEventListener('pointerdown', (e) => {
    const K = G.knives;
    if (!K || !K.picking) return;
    const box = reelsCv.getBoundingClientRect();
    pickSector(sectorAt(((e.clientX - box.left) / box.width) * W, ((e.clientY - box.top) / box.height) * H));
  });

  async function playKnives(k, won) {
    const a = AUDIO();
    await wait(400);
    a?.music('knives');
    G.shake = 8;
    await banner('МЕТАТЕЛЬ НОЖЕЙ', `${k.knives} ${k.knives === 1 ? 'нож' : k.knives < 5 ? 'ножа' : 'ножей'} — не попади в ассистентку`, 2400);
    G.lines = null;
    G.hl.clear();
    setMsg('Метатель ножей: кликни по щиту — куда бросить нож');
    const size = k.board.length;
    // Призы по броскам — как решил сервер; остальное откроем в конце.
    const prizes = k.throws.map((i) => k.board[i]);
    const rest = k.board.filter((_, i) => !k.throws.includes(i));
    const K = { size, rot: 0, at: G.clock, shown: new Map(), stuck: [], left: k.knives, sum: 0, doubled: 0, picking: false, hover: -1, flight: null, resolve: null };
    G.knives = K;
    const spinner = setInterval(() => { if (G.knives === K) K.rot += 0.004 * G.speed; }, 16);
    for (const prize of prizes) {
      K.picking = true;
      // Игрок выбирает сектор; при автоигре или ускорении — сам, через паузу.
      const chosen = await new Promise((resolve) => {
        K.resolve = resolve;
        const auto = () => {
          if (!K.picking) return;
          const free = [...Array(size).keys()].filter((i) => !K.shown.has(i));
          pickSector(free[Math.floor(Math.random() * free.length)]);
        };
        if (G.auto > 0 || G.skip) wait(500).then(auto);
        else wait(15_000).then(auto);
      });
      K.hover = -1;
      reelsCv.style.cursor = '';
      K.left -= 1;
      // Нож летит в середину выбранного сектора.
      const am = ((chosen + 0.5) / size) * Math.PI * 2 + K.rot;
      const to = [BCX + Math.cos(am) * BOARD_R * 0.86, BCY + Math.sin(am) * BOARD_R * 0.86];
      a?.sfx('throw');
      K.flight = { from: [BCX, RY + ROWS * CELL + 40], to, start: G.clock, ms: 320 };
      await wait(320);
      K.flight = null;
      a?.sfx(prize === 'assistant' ? 'scream' : 'thunk');
      K.stuck.push({ a: am - K.rot });
      K.shown.set(chosen, prize);
      G.shake = prize === 'assistant' ? 12 : 4;
      if (prize === 'assistant') {
        spark(to[0], to[1], 18, '#ff5a5a', 1.2);
        await banner('АССИСТЕНТКА!', 'бонус окончен — она, к счастью, жива', 2000, 'small');
        break;
      }
      confetti(to[0], to[1], 18, 0.8);
      if (prize === 'x2') {
        K.doubled += 1;
        a?.sfx('mod');
      } else if (prize === 'knives') {
        K.left += 2;
        a?.sfx('mod');
      } else {
        K.sum += prize;
        a?.sfx('win');
      }
      G.winTarget = won + K.sum * 2 ** K.doubled * G.bet0;
      await wait(G.turbo ? 350 : 650);
    }
    // Открываем оставшиеся секторы — что было рядом.
    const free = [...Array(size).keys()].filter((i) => !K.shown.has(i));
    rest.sort(() => Math.random() - 0.5).forEach((v, j) => K.shown.set(free[j], v));
    await wait(1400);
    clearInterval(spinner);
    const pay = k.pay * G.bet0;
    a?.sfx('scatter');
    setMsg(`Метатель принёс ${fmt(pay)}`);
    await banner('ПРЕДСТАВЛЕНИЕ ОКОНЧЕНО', `метатель принёс ${fmt(pay)}`, 2200);
    G.knives = null;
    a?.music('base');
    return won + pay;
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
    ctx.fillStyle = 'rgba(20, 4, 8, .65)';
    ctx.fillRect(0, RY + (ROWS * CELL) / 2 - 66, W, 132);
    ctx.translate(W / 2, RY + (ROWS * CELL) / 2);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${b.kind === 'small' ? 40 : 50}px ${TITLE_FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#2a0608';
    ctx.strokeText(b.title, 0, b.sub ? -16 : 0);
    const g = ctx.createLinearGradient(0, -40, 0, 20);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.5, '#ffc53d');
    g.addColorStop(1, '#c0281a');
    ctx.fillStyle = g;
    ctx.fillText(b.title, 0, b.sub ? -16 : 0);
    if (b.sub) {
      ctx.font = `700 21px ${NUM_FONT}`;
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
    ctx.fillStyle = `rgba(20, 4, 8, ${0.72 * clamp(k * 6, 0, 1)})`;
    ctx.fillRect(0, 0, W, H);
    ctx.translate(W / 2, H / 2 - 6);
    ctx.save();
    ctx.rotate(t / 3000);
    for (let i = 0; i < 18; i++) {
      ctx.rotate((Math.PI * 2) / 18);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-30, -W);
      ctx.lineTo(30, -W);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? 'rgba(255, 90, 90, .07)' : 'rgba(255, 220, 140, .08)';
      ctx.fill();
    }
    ctx.restore();
    const pulse = 1 + 0.04 * Math.sin(t / 120);
    ctx.scale(pulse, pulse);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const tier = BIG_WINS.find(([x]) => shown / G.bet0 >= x) || BIG_WINS[BIG_WINS.length - 1];
    ctx.font = `40px ${TITLE_FONT}`;
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#2a0608';
    ctx.strokeText(tier[1], 0, -46);
    const g = ctx.createLinearGradient(0, -70, 0, -20);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.5, '#ffc53d');
    g.addColorStop(1, '#c0281a');
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
      if (!el('circus').hidden) window.SlotRig.frameStats('circus', raw, performance.now() - t0);
    } catch (err) {
      if (!G.drawError) console.error('Цирк: ошибка рисования', err);
      G.drawError = true;
    }
  }
  let bgDt = 0;
  let bgAt = 0;
  function renderScene(now, dt) {
    if (el('circus').hidden) return;
    window.SlotRig.frameTick(dt * 1000);
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
      drawLines(ctx);
      drawMod(ctx, now);
      drawFrame(ctx, now);
      drawKnives(ctx, now);
      drawFx(ctx, dt * G.speed);
      drawBanner(ctx);
      drawBigWin(ctx, now);
    } else {
      ctx.fillStyle = '#f6e2b0';
      ctx.font = `400 18px ${NUM_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Под куполом зажигают лампы…', W / 2, H / 2);
    }
    renderBar(dt);
  }

  // ---------- Фон: заброшенный шатёр ----------
  // Неподвижное — картинкой: полосатый купол, ряды пустых скамеек, арена. Поверх в кадре — гирлянды
  // лампочек (мигают, некоторые перегорели), луч прожектора и пыль в нём.
  const TENT = {};
  const BG = { motes: [] };
  function paintTent(ctx, w, h) {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#12060a');
    g.addColorStop(0.5, '#1e0a0e');
    g.addColorStop(1, '#080304');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    // Полосы купола расходятся от вершины.
    const top = [w / 2, -h * 0.25];
    for (let i = 0; i < 24; i++) {
      const a0 = Math.PI * (0.05 + (i / 24) * 0.9);
      const a1 = Math.PI * (0.05 + ((i + 1) / 24) * 0.9);
      ctx.beginPath();
      ctx.moveTo(top[0], top[1]);
      ctx.lineTo(top[0] + Math.cos(a0) * h * 2, top[1] + Math.sin(a0) * h * 2);
      ctx.lineTo(top[0] + Math.cos(a1) * h * 2, top[1] + Math.sin(a1) * h * 2);
      ctx.closePath();
      ctx.fillStyle = i % 2 ? 'rgba(122, 30, 34, .55)' : 'rgba(200, 180, 150, .12)';
      ctx.fill();
    }
    // Прорехи в куполе.
    for (const [fx, fy, r] of [[0.18, 0.12, 22], [0.74, 0.08, 16], [0.62, 0.22, 10]]) {
      ctx.beginPath();
      ctx.ellipse(w * fx, h * fy, r, r * 0.6, 0.4, 0, Math.PI * 2);
      ctx.fillStyle = '#050204';
      ctx.fill();
    }
    // Ряды пустых скамеек по бокам.
    for (let row = 0; row < 6; row++) {
      const y = h * (0.45 + row * 0.07);
      ctx.fillStyle = `rgba(30, 14, 10, ${0.7 + row * 0.04})`;
      ctx.fillRect(0, y, w * (0.16 + row * 0.02), 10);
      ctx.fillRect(w * (0.84 - row * 0.02), y, w * (0.16 + row * 0.02), 10);
    }
    // Арена: опилки и бортик.
    ctx.beginPath();
    ctx.ellipse(w / 2, h * 1.02, w * 0.62, h * 0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#2a1a10';
    ctx.fill();
    ctx.lineWidth = 14;
    ctx.strokeStyle = '#5a1418';
    ctx.stroke();
    ctx.setLineDash([18, 18]);
    ctx.strokeStyle = 'rgba(205, 191, 158, .35)';
    ctx.stroke();
    ctx.setLineDash([]);
    // Тяжёлая тьма по краям.
    const v = ctx.createRadialGradient(w / 2, h * 0.5, Math.min(w, h) * 0.3, w / 2, h * 0.5, Math.max(w, h) * 0.75);
    v.addColorStop(0, 'rgba(0, 0, 0, 0)');
    v.addColorStop(1, 'rgba(0, 0, 0, .75)');
    ctx.fillStyle = v;
    ctx.fillRect(0, 0, w, h);
  }
  function drawBackground(now, dt) {
    const box = bgCv.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    const dpr = fitCanvas(bgCv, w, h);
    const ctx = bctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.drawImage(window.SlotRig.layer(TENT, `${w}x${h}@${dpr}`, w, h, dpr, (c) => paintTent(c, w, h)), 0, 0, w, h);
    // Луч прожектора медленно бродит по шатру.
    const sx = w * (0.5 + 0.3 * Math.sin(now / 7000));
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    const beam = ctx.createLinearGradient(w / 2, 0, sx, h);
    beam.addColorStop(0, 'rgba(255, 230, 180, .16)');
    beam.addColorStop(1, 'rgba(255, 230, 180, 0)');
    ctx.fillStyle = beam;
    ctx.beginPath();
    ctx.moveTo(w / 2 - 20, 0);
    ctx.lineTo(w / 2 + 20, 0);
    ctx.lineTo(sx + 140, h);
    ctx.lineTo(sx - 140, h);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    // Гирлянды лампочек: провисают дугами, часть перегорела, часть мигает.
    for (let g = 0; g < 3; g++) {
      const y0 = h * (0.06 + g * 0.09);
      const sag = 30 + g * 12;
      for (let i = 0; i <= 18; i++) {
        const f = i / 18;
        const x = f * w;
        const y = y0 + Math.sin(f * Math.PI) * sag + Math.sin(now / 1800 + g) * 3;
        const id = g * 31 + i;
        const dead = id % 7 === 3;
        const flick = id % 5 === 1 ? (Math.sin(now / 90 + id) > 0.6 ? 0.2 : 1) : 1;
        const on = dead ? 0.08 : (0.55 + 0.45 * Math.sin(now / 400 + id * 0.8)) * flick;
        window.SlotRig.glowAt(ctx, x, y, 16, '255, 190, 100', 0.35 * on);
        ctx.beginPath();
        ctx.arc(x, y, 3, 0, Math.PI * 2);
        ctx.fillStyle = `rgba(255, ${170 + 60 * on}, ${90 + 90 * on}, ${0.35 + 0.65 * on})`;
        ctx.fill();
      }
    }
    // Пыль в луче.
    if (BG.motes.length < 40 && Math.random() < dt * 8) BG.motes.push({ x: sx + (Math.random() - 0.5) * 220, y: h * (0.3 + Math.random() * 0.6), v: 6 + Math.random() * 14, life: 0 });
    BG.motes = BG.motes.filter((m) => m.life < 5);
    for (const m of BG.motes) {
      m.life += dt;
      m.y -= m.v * dt;
      m.x += Math.sin(m.life * 2 + m.y) * dt * 6;
      ctx.fillStyle = `rgba(255, 230, 190, ${0.4 * Math.sin((m.life / 5) * Math.PI)})`;
      ctx.fillRect(m.x, m.y, 2, 2);
    }
  }

  // ---------- Панель ----------
  function renderBar(dt) {
    if (G.winShown !== G.winTarget) {
      const step = Math.max(1, Math.abs(G.winTarget - G.winShown) * dt * 6);
      G.winShown = G.winShown < G.winTarget ? Math.min(G.winTarget, G.winShown + step) : G.winTarget;
      if (Math.random() < 0.3 && G.winShown < G.winTarget) AUDIO()?.sfx('tick');
    }
    el('cc-win').textContent = fmt(G.winShown);
    el('cc-balance').textContent = fmt(state.balance || 0);
    el('cc-bet').textContent = fmt(G.bet);
    el('cc-spin').classList.toggle('busy', G.busy);
    el('cc-auto').textContent = G.auto > 0 ? (G.auto > 1000 ? '∞' : `${G.auto}`) : 'Авто';
    el('cc-auto').classList.toggle('on', G.auto > 0);
    el('cc-turbo').classList.toggle('on', G.turbo);
  }
  const setMsg = (text) => { el('cc-msg').textContent = text; };

  // ---------- Показ исхода ----------
  // Сервер присылает поле уже после модификатора; на барабанах показываем, что было до него.
  function beforeMod(step) {
    const pre = step.grid.map((col) => col.slice());
    const m = step.mod;
    if (m.cells) for (const c of m.cells) pre[reelOf(c)][rowOf(c)] = calmSym();
    if (m.reels) for (const r of m.reels) for (let y = 0; y < ROWS; y++) if (pre[r][y] === 'hoop') pre[r][y] = calmSym();
    if (m.cell !== undefined) pre[reelOf(m.cell)][rowOf(m.cell)] = calmSym();
    return pre;
  }

  async function applyMod(step) {
    const a = AUDIO();
    const m = step.mod;
    if (m.type === 'clowns') {
      a?.sfx('honk');
      for (const c of m.cells) {
        await wait(220);
        G.grid[reelOf(c)][rowOf(c)] = 'clown';
        G.hl.set(c, G.clock);
        confetti(cx(reelOf(c)), cy(rowOf(c)), 18);
        a?.sfx('pop');
      }
      await wait(400);
      G.hl.clear();
    } else if (m.type === 'hoops') {
      for (const r of m.reels) {
        a?.sfx('fire');
        G.hoopReels.add(r);
        G.shake = 6;
        for (let y = 0; y < ROWS; y++) {
          await wait(110);
          if (G.grid[r][y] !== 'target') G.grid[r][y] = 'hoop';
          spark(cx(r), cy(y), 12, '#ff9a3a', 0.9);
        }
        await wait(300);
      }
    } else if (m.type === 'trained') {
      a?.sfx('whip');
      G.trained = m.symbol;
      G.shake = 4;
      setMsg(`Дрессировка: ${NAMES[m.symbol].toLowerCase()} — дикий`);
      await wait(700);
    } else if (m.type === 'target' && m.cell !== undefined) {
      a?.sfx('throw');
      await wait(300);
      a?.sfx('thunk');
      G.grid[reelOf(m.cell)][rowOf(m.cell)] = 'target';
      G.hl.set(m.cell, G.clock);
      spark(cx(reelOf(m.cell)), cy(rowOf(m.cell)), 14, '#ffd45c', 1);
      await wait(500);
      G.hl.clear();
    } else if (m.mult) {
      G.mult = m.mult;
    }
  }

  async function playStep(step, first) {
    const a = AUDIO();
    G.trained = null;
    G.hoopReels.clear();
    G.mult = 1;
    const pre = beforeMod(step);
    let targets = 0;
    let anticipate = -1;
    for (let r = 0; r < REELS - 1; r++) {
      if (pre[r].includes('target')) targets += 1;
      if (targets >= 2 && anticipate < 0) anticipate = r;
    }
    if (anticipate >= 0) a?.sfx('tease');
    a?.sfx('spin');
    // Барабан распорядителя и поле крутятся вместе; модификатор встаёт первым.
    await Promise.all([spinMod(first ? step.mod.type : 'blank'), spinReels(pre, { anticipate })]);
    if (step.mod.type !== 'blank') await applyMod(step);
    let won = 0;
    if (step.wins.length) {
      const pay = step.wins.reduce((s, w) => s + w.pay, 0) * step.mult * G.bet0;
      for (const w of step.wins) for (const c of w.cells) G.hl.set(c, G.clock);
      G.lines = { wins: step.wins, at: G.clock, mult: step.mult };
      a?.sfx(pay >= 5 * G.bet0 ? 'winMid' : 'win');
      G.winTarget += pay;
      won += pay;
      setMsg(`Линии: +${fmt(pay)}${step.mult > 1 ? ` (×${step.mult})` : ''}`);
      await wait(Math.min(2800, 1500 + step.wins.length * 300));
    }
    if (step.scatter) {
      G.grid.forEach((col, r) => col.forEach((s, y) => { if (s === 'target') G.hl.set(cellOf(r, y), G.clock); }));
      a?.sfx('scatter');
      won += step.scatter.pay * G.bet0;
      G.winTarget += step.scatter.pay * G.bet0;
      await wait(1300);
    }
    return won;
  }

  async function present(result) {
    const o = result.outcome;
    G.bet0 = result.bet;
    G.busy = true;
    G.skip = false;
    setSpeed();
    G.winTarget = 0;
    G.winShown = 0;
    setMsg(result.mode === 'spin' ? 'Представление начинается!' : 'Метатель ножей куплен!');

    let won = 0;
    for (let i = 0; i < o.steps.length; i++) {
      if (i > 0) {
        await banner('ВТОРАЯ ПОПЫТКА', 'распорядитель даёт ещё один шанс', 1300, 'small');
        G.lines = null;
        G.hl.clear();
      }
      won += await playStep(o.steps[i], i === 0);
    }
    G.lines = null;
    if (o.knives) won = await playKnives(o.knives, won);

    G.winTarget = result.payout;
    G.trained = null;
    G.hoopReels.clear();
    G.mult = 1;
    if (result.payout >= 15 * result.bet) await bigWin(result.payout);
    else if (result.payout > 0) {
      AUDIO()?.sfx(result.payout >= 3 * result.bet ? 'winMid' : 'win');
      setMsg(`Выигрыш ${fmt(result.payout)}`);
    } else {
      setMsg('Публика молчит. Ещё номер?');
    }
    G.winShown = G.winTarget;
    send({ type: 'circus_done', id: result.id });
    G.busy = false;
    G.skip = false;
    setSpeed();
    if (G.auto > 0) {
      if (o.knives && G.autoStopOnBonus) G.auto = 0;
      else {
        G.auto -= 1;
        if (G.auto > 0) setTimeout(() => { if (!G.busy && G.auto > 0) doSpin('spin'); }, G.turbo ? 250 : 600);
      }
    }
  }

  async function bigWin(amount) {
    AUDIO()?.sfx('bigwin');
    G.bigWin = { amount, start: G.clock, ms: 5200 };
    coinShower(50);
    confetti(W / 2, H / 2, 60, 1.6);
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

  // ---------- Ставки и кнопки ----------
  function doSpin(mode = 'spin') {
    if (G.busy || G.awaiting) return;
    if (!G.ready) return toast('Под куполом ещё зажигают лампы…');
    const cost = mode === 'buy-knives' ? G.bet * BUY.knives : G.bet;
    if (cost > (state.balance || 0)) {
      G.auto = 0;
      return toast(mode === 'spin' ? 'Не хватает фишек на ставку' : `Метатель стоит ${fmt(cost)} — не хватает фишек`);
    }
    AUDIO()?.unlock();
    G.awaiting = true;
    send({ type: 'circus_spin', bet: G.bet, mode });
  }
  function onResult(msg) {
    G.awaiting = false;
    present(msg).catch((err) => {
      console.error('Цирк:', err);
      G.busy = false;
      G.knives = null;
      send({ type: 'circus_done', id: msg.id });
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
      if (G.knives && G.knives.picking) return;   // во время выбора сектора кнопка не торопит
      G.skip = true;
      setSpeed();
      return;
    }
    doSpin('spin');
  }

  el('cc-spin').addEventListener('click', skipOrSpin);
  // Клик по полю не ускоряет показ: закрывает окно большого выигрыша, а в бонусе — выбирает сектор.
  reelsCv.addEventListener('click', () => { if (G.bigWin && G.onSkip) G.onSkip(); });
  el('cc-bet-down').addEventListener('click', () => changeBet(-1));
  el('cc-bet-up').addEventListener('click', () => changeBet(1));
  el('cc-bet-max').addEventListener('click', () => {
    if (G.busy) return;
    const affordable = BET_STEPS.filter((x) => x <= (state.balance || 0));
    G.bet = affordable.length ? affordable[affordable.length - 1] : BET_STEPS[0];
    storage.set(BET_KEY, String(G.bet));
  });
  // Ставка долей баланса: самый крупный шаг шкалы, который не больше 1/300 (или 1/100) баланса.
  for (const [id, div] of [['cc-bet-300', 300], ['cc-bet-100', 100]]) {
    el(id).addEventListener('click', () => {
      if (G.busy) return;
      const fit = BET_STEPS.filter((x) => x <= (state.balance || 0) / div);
      G.bet = fit.length ? fit[fit.length - 1] : BET_STEPS[0];
      storage.set(BET_KEY, String(G.bet));
      AUDIO()?.sfx('click');
    });
  }
  el('cc-turbo').addEventListener('click', () => {
    G.turbo = !G.turbo;
    storage.set(TURBO_KEY, G.turbo ? '1' : '0');
    setSpeed();
  });
  el('cc-auto').addEventListener('click', () => {
    if (G.auto > 0) {
      G.auto = 0;
      return;
    }
    el('cc-auto-menu').hidden = !el('cc-auto-menu').hidden;
  });
  el('cc-auto-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-auto]');
    if (!b) return;
    G.auto = Number(b.dataset.auto);
    G.autoStopOnBonus = el('cc-auto-stop').checked;
    el('cc-auto-menu').hidden = true;
    doSpin('spin');
  });
  el('cc-buy').addEventListener('click', () => {
    if (G.busy) return;
    el('cc-buy-price').textContent = fmt(G.bet * BUY.knives);
    el('cc-buy-modal').hidden = false;
  });
  el('cc-buy-modal').addEventListener('click', (e) => {
    if (e.target === el('cc-buy-modal') || e.target.closest('[data-close]')) el('cc-buy-modal').hidden = true;
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    el('cc-buy-modal').hidden = true;
    doSpin(b.dataset.buy);
  });
  el('cc-info').addEventListener('click', () => {
    renderPaytable();
    el('cc-pay-modal').hidden = false;
  });
  el('cc-pay-modal').addEventListener('click', (e) => {
    if (e.target === el('cc-pay-modal') || e.target.closest('[data-close]')) el('cc-pay-modal').hidden = true;
  });
  el('cc-sound').addEventListener('click', () => {
    const au = AUDIO();
    if (!au) return;
    au.unlock();
    el('cc-sound').classList.toggle('off', !au.toggle());
  });
  el('cc-sound').classList.toggle('off', !(AUDIO() && AUDIO().isMusicOn()));

  function symImg(s) {
    const img = document.createElement('img');
    if (G.img[s]) img.src = G.img[s].toDataURL();
    img.className = 'painted';
    img.alt = NAMES[s];
    return img;
  }
  function renderPaytable() {
    el('cc-pays').replaceChildren(...Object.keys(PAYS).reverse().map((s) => {
      const d = document.createElement('div');
      d.className = 'kr-pay';
      const list = document.createElement('div');
      for (let i = 2; i >= 0; i--) list.append(Object.assign(document.createElement('span'), { innerHTML: `<b>${i + 3}×</b> ${fmt((PAYS[s][i] * PAY_SCALE * G.bet) / LINES.length)}` }));
      d.append(symImg(s), list);
      return d;
    }));
    el('cc-pay-hoop').replaceChildren(symImg('hoop'));
    el('cc-pay-target').replaceChildren(symImg('target'));
    el('cc-pay-bet').textContent = fmt(G.bet);
    el('cc-mods').replaceChildren(...Object.keys(MOD_NAMES).filter((k) => k !== 'blank').map((k) => Object.assign(document.createElement('li'), { textContent: `${MOD_ICONS[k].replace('✖', '×')} ${MOD_NAMES[k]}` })));
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || el('circus').hidden) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button')) return;
    if (!el('cc-buy-modal').hidden || !el('cc-pay-modal').hidden) return;
    e.preventDefault();
    if (!e.repeat) skipOrSpin();
  });

  function renderFeed(feed) {
    const myId = state.me && state.me.playerId;
    el('cc-feed').replaceChildren(...(feed.length ? feed.map((e) => {
      const li = document.createElement('li');
      const win = e.payout > e.cost;
      li.className = win ? 'win' : 'lose';
      if (e.playerId === myId) li.classList.add('self');
      li.append(avatarEl(e.name));
      li.append(Object.assign(document.createElement('span'), { className: 'name', textContent: e.name }));
      li.append(Object.assign(document.createElement('span'), { className: 'u-what', textContent: win ? `+${fmt(e.payout - e.cost)}` : `−${fmt(e.cost - e.payout)}` }));
      const tag = e.knives ? '🔪 метатель' : e.mod && e.mod !== 'blank' ? `${MOD_ICONS[e.mod].replace('✖', '×')} ×${e.mult}` : `×${e.mult}`;
      li.append(Object.assign(document.createElement('span'), { className: 'u-ch', textContent: tag }));
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'В шатре пока пусто' })]));
  }

  handlers.circus_result = onResult;
  handlers.circus_feed = (msg) => renderFeed(msg.feed);
  window.circusOnError = onError;
  window.circusTabShown = (on) => { AUDIO()?.setActive(on); };
  if (!el('circus').hidden) window.circusTabShown(true);

  renderFeed([]);
  loadArt();
  requestAnimationFrame(frame);
})();
