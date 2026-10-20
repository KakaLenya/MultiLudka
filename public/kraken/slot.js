// «Кракен: сундук глубин» — клиент слота. Исход спина целиком приходит с сервера (kraken_result),
// здесь только его показ: вращение барабанов, линии, щупальца, сундук и фриспины.
// Когда показ закончен, шлём kraken_done — сервер зачисляет выигрыш.
// Пользуется общими штуками зала из client.js: send, state, toast, handlers, storage, $.
(function () {
  'use strict';

  const AUDIO = () => window.KrakenAudio || null;

  // ---------- Как на сервере (server/kraken-math.js) ----------
  const REELS = 5;
  const ROWS = 4;
  const CELLS = REELS * ROWS;
  const LINES = [
    [1, 1, 1, 1, 1], [2, 2, 2, 2, 2], [0, 0, 0, 0, 0], [3, 3, 3, 3, 3],
    [0, 1, 2, 1, 0], [3, 2, 1, 2, 3], [1, 2, 3, 2, 1], [2, 1, 0, 1, 2],
    [0, 0, 1, 0, 0], [3, 3, 2, 3, 3], [1, 0, 0, 0, 1], [2, 3, 3, 3, 2],
    [1, 1, 0, 1, 1], [2, 2, 3, 2, 2], [0, 1, 1, 1, 0], [3, 2, 2, 2, 3],
    [1, 2, 2, 2, 1], [2, 1, 1, 1, 2], [0, 1, 0, 1, 0], [3, 2, 3, 2, 3],
  ];
  const PAYS = {
    anchor: [7, 20, 60], compass: [7, 20, 60], helm: [9, 28, 80], rum: [9, 28, 80],
    jelly: [18, 55, 170], shark: [24, 80, 250], angler: [35, 120, 400], ship: [60, 250, 1000],
  };
  const NAMES = {
    anchor: 'Якорь', compass: 'Компас', helm: 'Штурвал', rum: 'Ром', jelly: 'Медуза', shark: 'Акула', angler: 'Удильщик', ship: 'Галеон', wild: 'Кракен', map: 'Карта сокровищ', pearl: 'Жемчужина',
  };
  const JACKPOTS = { mini: 20, minor: 50, major: 200, grand: 1000 };
  const BUY = { fs: 100, hw: 45 };
  const FS_LEVELS = [1, 2, 3, 5, 10];
  const FILLER = ['anchor', 'compass', 'helm', 'rum', 'anchor', 'compass', 'helm', 'rum', 'jelly', 'shark', 'angler', 'ship', 'pearl', 'wild', 'map'];
  const BET_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
  const BIG_WINS = [[500, 'ЛЕГЕНДАРНЫЙ ВЫИГРЫШ'], [100, 'ЭПИЧЕСКИЙ ВЫИГРЫШ'], [50, 'ОГРОМНЫЙ ВЫИГРЫШ'], [15, 'БОЛЬШОЙ ВЫИГРЫШ']];
  const LINE_COLORS = ['#ffd54a', '#4fe3ff', '#ff6b8b', '#8dff6b', '#c38bff', '#ff9f43', '#4dffc3', '#ff5ce0', '#6bb6ff', '#fff07a',
    '#ff7a59', '#59ffa1', '#ffa6e1', '#7ad7ff', '#ffcf6b', '#b6ff59', '#ff8fb1', '#59d0ff', '#e0a6ff', '#ffe259'];

  // ---------- Геометрия ----------
  const CELL = 116;
  const FR = 26;                       // рамка вокруг окна барабанов
  const W = REELS * CELL + 2 * FR;
  const H = ROWS * CELL + 2 * FR;
  const cx = (r) => FR + r * CELL + CELL / 2;
  const cy = (y) => FR + y * CELL + CELL / 2;
  const cellOf = (r, y) => r * ROWS + y;
  const INK = '#0d1b2a';

  const fmt = (n) => chips(Math.floor(n));   // 60.000.000 — общая функция зала
  const short = (n) => {
    n = Math.floor(n);
    // Дробная часть — через запятую: точка в зале разделяет разряды.
    const d = (x, k) => String(+x.toFixed(k)).replace('.', ',');
    if (n >= 1e9) return `${d(n / 1e9, n >= 1e10 ? 0 : 1)}B`;
    if (n >= 1e6) return `${d(n / 1e6, n >= 1e7 ? 0 : 1)}M`;
    if (n >= 1e4) return `${d(n / 1e3, n >= 1e5 ? 0 : 1)}K`;
    return String(n);
  };
  const ease = {
    out: (t) => 1 - (1 - t) ** 3,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    back: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- Состояние ----------
  const BET_KEY = 'casino.kraken.bet';
  const TURBO_KEY = 'casino.kraken.turbo';
  const G = {
    ready: false,
    img: {},             // символ -> картинка
    blur: {},            // символ -> размытая по вертикали (на скорости)
    rig: {},             // символ -> модель из деталей (kraken/rig.js)
    pearlRig: {},
    bet: Number(storage.get(BET_KEY)) || 100,
    busy: false,
    awaiting: false,
    auto: 0,
    autoStopOnBonus: true,
    turbo: storage.get(TURBO_KEY) === '1',
    clock: 0,            // своё время показа (мс): «быстрее» = часы идут быстрее
    speed: 1,
    skip: false,
    mode: 'base',        // base | hw | fs
    grid: null,          // [reel][row] — что сейчас на поле
    pearls: {},          // клетка -> значение (в ставках) или 'mini'... (сундук)
    reels: [],
    wild: new Set(),     // барабаны, захваченные щупальцами
    hl: new Map(),       // клетка -> с какого момента подсвечена
    lines: null,         // { wins, at, cycle }
    fx: [],
    tentacles: [],
    hw: null,            // { board: {cell: v}, left, locked:Set }
    fs: null,            // { left, level, meter, total }
    winShown: 0,
    winTarget: 0,
    banner: null,
    bigWin: null,
    shake: 0,
    collectLabel: new Map(),   // клетка -> { text, at } — сумма над Кракеном
    bet0: 100,
  };
  if (!BET_STEPS.includes(G.bet)) G.bet = 100;

  // ---------- Время показа ----------
  // Ожидания идут по своим часам: турбо и пропуск просто ускоряют часы.
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
  // Символы нарисованы вручную и собраны из деталей (kraken/rig.js): в кадре они живут —
  // моргают, шевелят щупальцами, крутят стрелками. На скорости барабана — неподвижный кадр с размытием.
  const TITLE_FONT = '"Cormorant SC", Georgia, serif';
  const NUM_FONT = 'Oswald, "Arial Narrow", sans-serif';
  async function loadArt() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(CELL * dpr);
    const A = window.SlotArt;
    const KR = window.KrakenRig;
    const SR = window.SlotRig;
    await Promise.all([document.fonts.load(`700 20px ${TITLE_FONT}`), document.fonts.load(`700 20px ${NUM_FONT}`)]).catch(() => {});
    const jobs = Object.entries(KR.SYMBOLS).map(async ([k, def]) => {
      const rig = await SR.build(def, px);
      G.rig[k] = rig;
      G.img[k] = rig.still;
      G.blur[k] = A.motionBlur(rig.still);
    });
    for (const tone of KR.TONES) jobs.push(SR.build(KR.pearl(tone), px).then((rig) => { G.pearlRig[tone] = rig; }));
    jobs.push(A.loadImage('textures/stone-sea.jpg').then((img) => { G.texStone = img; }));
    jobs.push(A.loadImage('textures/metal-rust.jpg').then((img) => { G.texMetal = img; }));
    await Promise.all(jobs);
    G.img.pearl = G.pearlRig.white.still;
    G.blur.pearl = A.motionBlur(G.img.pearl);
    G.ready = true;
  }


  // ---------- Разметка ----------
  const el = (id) => document.getElementById(id);
  // Окна — прямо в body: у карточек зала есть фильтры, внутри них position: fixed ведёт себя как absolute.
  document.body.append(el('kr-buy-modal'), el('kr-pay-modal'));
  const reelsCv = el('kr-reels');
  const bgCv = el('kr-bg');
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

  // ---------- Начальное поле ----------
  function randomSym(r) {
    let s = FILLER[Math.floor(Math.random() * FILLER.length)];
    if (s === 'wild' && r === 0) s = 'ship';
    return s;
  }
  const CALM = ['anchor', 'compass', 'helm', 'rum', 'jelly', 'shark', 'angler', 'ship'];
  const calmSym = () => CALM[Math.floor(Math.random() * CALM.length)];
  function initGrid() {
    G.grid = Array.from({ length: REELS }, () => Array.from({ length: ROWS }, calmSym));
    G.reels = Array.from({ length: REELS }, () => ({ spinning: false }));
  }
  initGrid();

  // ---------- Вращение барабанов ----------
  // Лента барабана: сверху случайные символы, снизу — итоговые 4. Лента едет вниз до итога.
  function spinReels(grid, pearls, { anticipate = -1 } = {}) {
    const fast = G.turbo;
    const base = fast ? 380 : 700;
    const gap = fast ? 90 : 170;
    const jobs = [];
    G.hl.clear();
    G.lines = null;
    G.collectLabel.clear();
    for (let r = 0; r < REELS; r++) {
      const extra = anticipate >= 0 && r > anticipate ? (r - anticipate) * 900 : 0;
      const dur = base + r * gap + extra;
      const len = 14 + r * 3 + Math.round(extra / 60);
      const strip = [];
      for (let i = 0; i < len; i++) strip.push({ s: randomSym(r), v: null });
      // Лента снизу вверх: [0] — нижний ряд итога, дальше случайные, в конце — то, что стоит сейчас.
      const finalCells = grid[r].map((s, y) => ({ s, v: s === 'pearl' ? pearls[cellOf(r, y)] : null })).reverse();
      const reel = {
        spinning: true, strip: [...finalCells, ...strip], start: G.clock, dur, dist: len, anticipating: extra > 0,
        prev: G.grid[r].map((s, y) => ({ s, v: G.pearls[cellOf(r, y)] ?? null })).reverse(),
      };
      reel.strip.push(...reel.prev);
      reel.dist = reel.strip.length - ROWS;
      G.reels[r] = reel;
      jobs.push(wait(dur).then(() => {
        reel.spinning = false;
        G.grid[r] = grid[r].slice();
        for (let y = 0; y < ROWS; y++) {
          const c = cellOf(r, y);
          if (grid[r][y] === 'pearl') G.pearls[c] = pearls[c];
          else delete G.pearls[c];
        }
        landSound(r, grid[r]);
      }));
    }
    G.wild.clear();
    return Promise.all(jobs);
  }

  function landSound(r, col) {
    const a = AUDIO();
    if (!a) return;
    a.sfx('stop', r);
    if (col.includes('map')) a.sfx('map', r);
    else if (col.includes('wild')) a.sfx('kraken', r);
    else if (col.includes('pearl')) a.sfx('pearl', r);
  }

  // Смещение ленты (в клетках) в момент t от старта: разгон, ход, торможение с отскоком.
  function reelOffset(reel) {
    const t = clamp((G.clock - reel.start) / reel.dur, 0, 1);
    // Сначала лёгкий замах вверх, потом лента едет и встаёт с отскоком.
    if (t < 0.08) return reel.dist + Math.sin((t / 0.08) * Math.PI) * 0.18;
    const p = (t - 0.08) / 0.92;
    return reel.dist * (1 - ease.back(p));
  }

  // ---------- Рисование барабанов ----------
  const LAYER = { img: null };

  function pearlTone(v) {
    if (typeof v === 'string') return v;
    if (v >= 25) return 'black';
    if (v >= 5) return 'gold';
    return 'white';
  }

  function drawPearlValue(ctx, x, y, v, size, alpha = 1) {
    const text = typeof v === 'string' ? v.toUpperCase() : short(v * G.bet);
    ctx.save();
    ctx.globalAlpha *= alpha;
    const fs = typeof v === 'string' ? size * 0.18 : size * (text.length > 4 ? 0.18 : 0.22);
    ctx.font = `700 ${fs}px ${NUM_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    ctx.lineWidth = fs * 0.28;
    ctx.strokeStyle = '#1a0d00';
    ctx.strokeText(text, x, y);
    const g = ctx.createLinearGradient(0, y - fs / 2, 0, y + fs / 2);
    g.addColorStop(0, '#fffbe0');
    g.addColorStop(0.5, '#ffd45c');
    g.addColorStop(1, '#e08a00');
    ctx.fillStyle = g;
    ctx.fillText(text, x, y);
    ctx.restore();
  }

  // Картинки клеток для SlotRig.drawCached: своя у каждой клетки поля и у каждого места ленты.
  const cellSlots = new Map();
  function slotOf(key) {
    let s = cellSlots.get(key);
    if (!s) cellSlots.set(key, (s = {}));
    return s;
  }

  // win — символ в выигрыше (играет свою анимацию), ph — фаза клетки, чтобы соседи двигались не в такт.
  function drawSymbol(ctx, s, v, x, y, { blur = false, scale = 1, alpha = 1, rot = 0, win = 0, ph = 0, slot = null } = {}) {
    const size = CELL * 0.94 * scale;
    const rig = s === 'pearl' ? G.pearlRig[pearlTone(v)] || G.pearlRig.white : G.rig[s];
    if (blur || !rig) {
      const img = s === 'pearl' ? G.blur.pearl : G.blur[s];
      if (!img) return;
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.drawImage(img, x - size / 2, y - size / 2, size, size);
      ctx.restore();
      return;
    }
    ctx.save();
    ctx.translate(x, y);
    if (rot) ctx.rotate(rot);
    if (scale !== 1) ctx.scale(scale, scale);
    const t = performance.now() / 1000;
    if (slot) window.SlotRig.drawCached(ctx, slot, rig, 0, 0, CELL * 0.94, t, win, ph, alpha, win ? 30 : 15);
    else window.SlotRig.draw(ctx, rig, 0, 0, CELL * 0.94, t, win, ph, alpha);
    ctx.restore();
    if (s === 'pearl' && v !== null && v !== undefined && v !== 'kraken') drawPearlValue(ctx, x, y + CELL * 0.26 * scale, v, CELL * scale, alpha);
  }

  function drawReelsBackground(ctx, t) {
    // Окно барабанов: тёмная вода, колонки, лёгкая рябь света.
    for (let r = 0; r < REELS; r++) {
      const x = FR + r * CELL;
      const g = ctx.createLinearGradient(x, FR, x, FR + ROWS * CELL);
      const hw = G.mode === 'hw';
      const fsm = G.mode === 'fs';
      g.addColorStop(0, hw ? 'rgba(26, 16, 48, .82)' : fsm ? 'rgba(42, 8, 24, .82)' : 'rgba(6, 30, 40, .8)');
      g.addColorStop(1, hw ? 'rgba(4, 2, 10, .94)' : fsm ? 'rgba(10, 2, 8, .94)' : 'rgba(2, 8, 12, .94)');
      if (G.texStone) {
        G.patStone ||= ctx.createPattern(G.texStone, 'repeat');
        ctx.fillStyle = G.patStone;
        ctx.fillRect(x, FR, CELL, ROWS * CELL);
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, FR, CELL, ROWS * CELL);
      if (G.wild.has(r)) {
        const wg = ctx.createLinearGradient(x, 0, x + CELL, 0);
        wg.addColorStop(0, 'rgba(192, 35, 74, 0)');
        wg.addColorStop(0.5, `rgba(192, 35, 74, ${0.35 + 0.1 * Math.sin(t / 200)})`);
        wg.addColorStop(1, 'rgba(192, 35, 74, 0)');
        ctx.fillStyle = wg;
        ctx.fillRect(x, FR, CELL, ROWS * CELL);
      }
    }
    // Каустика: светлые волны по воде.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 5; i++) {
      const yy = FR + ((t / 30 + i * 97) % (ROWS * CELL));
      const g = ctx.createLinearGradient(0, yy - 40, 0, yy + 40);
      g.addColorStop(0, 'rgba(120, 220, 255, 0)');
      g.addColorStop(0.5, 'rgba(120, 220, 255, .035)');
      g.addColorStop(1, 'rgba(120, 220, 255, 0)');
      ctx.fillStyle = g;
      ctx.fillRect(FR, yy - 40, REELS * CELL, 80);
    }
    ctx.restore();
    // Разделители колонок.
    for (let r = 1; r < REELS; r++) {
      const x = FR + r * CELL;
      ctx.fillStyle = 'rgba(0, 0, 0, .45)';
      ctx.fillRect(x - 2, FR, 4, ROWS * CELL);
      ctx.fillStyle = 'rgba(201, 161, 74, .22)';
      ctx.fillRect(x - 0.5, FR, 1, ROWS * CELL);
    }
  }

  function drawFrame(ctx, t) {
    // Золотая рама с канатом и заклёпками.
    ctx.save();
    const x0 = FR - 10;
    const y0 = FR - 10;
    const w = REELS * CELL + 20;
    const h = ROWS * CELL + 20;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 22;
    roundRect(ctx, x0, y0, w, h, 18);
    ctx.stroke();
    if (G.texMetal) {
      G.patMetal ||= ctx.createPattern(G.texMetal, 'repeat');
      ctx.strokeStyle = G.patMetal;
      ctx.lineWidth = 15;
      roundRect(ctx, x0, y0, w, h, 18);
      ctx.stroke();
    }
    // Потемневшая латунь поверх ржавчины.
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, 'rgba(214, 178, 96, .55)');
    g.addColorStop(0.3, 'rgba(138, 106, 46, .5)');
    g.addColorStop(0.7, 'rgba(70, 52, 20, .55)');
    g.addColorStop(1, 'rgba(160, 128, 60, .5)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 15;
    roundRect(ctx, x0, y0, w, h, 18);
    ctx.stroke();
    ctx.strokeStyle = 'rgba(255, 236, 190, .18)';
    ctx.lineWidth = 1.5;
    roundRect(ctx, x0 - 6, y0 - 6, w + 12, h + 12, 22);
    ctx.stroke();
    // Насечки по раме.
    ctx.strokeStyle = 'rgba(20, 12, 4, .55)';
    ctx.lineWidth = 2;
    ctx.setLineDash([3, 7]);
    ctx.lineDashOffset = 0;
    roundRect(ctx, x0, y0, w, h, 18);
    ctx.stroke();
    ctx.setLineDash([]);
    // Заклёпки.
    const rivets = [];
    for (let i = 0; i <= 10; i++) rivets.push([x0 + (w * i) / 10, y0], [x0 + (w * i) / 10, y0 + h]);
    for (let i = 1; i < 8; i++) rivets.push([x0, y0 + (h * i) / 8], [x0 + w, y0 + (h * i) / 8]);
    for (const [x, y] of rivets) {
      ctx.beginPath();
      ctx.arc(x, y, 3.2, 0, Math.PI * 2);
      ctx.fillStyle = '#b89a5a';
      ctx.fill();
      ctx.strokeStyle = '#2a1a06';
      ctx.lineWidth = 1;
      ctx.stroke();
    }
    ctx.restore();
    // Щупальца обвивают углы рамы.
    const sway = (k) => Math.sin(t / 900 + k) * 6;
    tentacle(ctx, [[-10, H * 0.75], [10, H * 0.62 + sway(1)], [6, H * 0.48], [28 + sway(2), H * 0.4], [44, H * 0.47 + sway(3)]], 20, 4, t, 0);
    tentacle(ctx, [[W + 10, H * 0.78], [W - 12, H * 0.64 + sway(2)], [W - 6, H * 0.5], [W - 30 + sway(3), H * 0.42], [W - 46, H * 0.5 + sway(4)]], 20, 4, t, 1);
    tentacle(ctx, [[-14, -6], [16, 12 + sway(5)], [44, 4], [58 + sway(1), 26], [46, 40]], 15, 3, t, 2);
    tentacle(ctx, [[W + 14, -6], [W - 16, 12 + sway(6)], [W - 44, 4], [W - 58 + sway(2), 26], [W - 46, 40]], 15, 3, t, 3);
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

  // Щупальце по опорным точкам (от основания к кончику): сужается, присоски с одной стороны.
  function tentacle(ctx, pts, w0, w1, t, seed, color = ['#7a1a2c', '#2a0612']) {
    const N = 36;
    const spine = [];
    for (let i = 0; i <= N; i++) spine.push(catmull(pts, i / N));
    const left = [];
    const right = [];
    for (let i = 0; i <= N; i++) {
      const a = spine[Math.max(0, i - 1)];
      const b = spine[Math.min(N, i + 1)];
      let nx = -(b[1] - a[1]);
      let ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const w = (w0 + (w1 - w0) * (i / N)) / 2;
      left.push([spine[i][0] + nx * w, spine[i][1] + ny * w]);
      right.push([spine[i][0] - nx * w, spine[i][1] - ny * w]);
    }
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(left[0][0], left[0][1]);
    for (const p of left) ctx.lineTo(p[0], p[1]);
    const tip = spine[N];
    ctx.arc(tip[0], tip[1], w1 / 2, 0, Math.PI * 2);
    for (let i = N; i >= 0; i--) ctx.lineTo(right[i][0], right[i][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(pts[0][0], pts[0][1], tip[0], tip[1]);
    g.addColorStop(0, color[1]);
    g.addColorStop(0.6, color[0]);
    g.addColorStop(1, '#a8434f');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    // Блик по спине.
    ctx.beginPath();
    for (let i = 2; i < N - 4; i++) {
      const p = left[i];
      const q = spine[i];
      const x = q[0] + (p[0] - q[0]) * 0.55;
      const y = q[1] + (p[1] - q[1]) * 0.55;
      if (i === 2) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = 'rgba(255, 200, 200, .22)';
    ctx.lineWidth = 2.5;
    ctx.stroke();
    // Присоски.
    for (let i = 3; i < N - 2; i += 3) {
      const p = right[i];
      const q = spine[i];
      const x = q[0] + (p[0] - q[0]) * 0.55;
      const y = q[1] + (p[1] - q[1]) * 0.55;
      const r = ((w0 + (w1 - w0) * (i / N)) / 2) * 0.32;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.2, r), 0, Math.PI * 2);
      ctx.fillStyle = '#b89a8e';
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(13, 27, 42, .6)';
      ctx.stroke();
    }
    ctx.restore();
  }

  function catmull(pts, u) {
    const n = pts.length - 1;
    const f = u * n;
    const i = Math.min(n - 1, Math.floor(f));
    const t = f - i;
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n, i + 2)];
    const k = (a, b, c, d) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - d) * t * t + (-a + 3 * b - 3 * c + d) * t * t * t);
    return [k(p0[0], p1[0], p2[0], p3[0]), k(p0[1], p1[1], p2[1], p3[1])];
  }

  function drawCells(ctx, t) {
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
          const item = reel.strip[idx];
          if (!item) continue;
          const y = FR + (k + frac) * CELL + CELL / 2;
          // Итоговые клетки ленты рисуются в картинки своих клеток поля — после остановки движение не прыгает.
          const c = cellOf(r, ROWS - 1 - idx);
          const fin = idx < ROWS;
          drawSymbol(ctx, item.s, item.v, cx(r), y, { blur, ph: fin ? c * 1.7 : idx * 1.3 + r, slot: slotOf(fin ? c : `s${r}:${idx}`) });
        }
        if (reel.anticipating) {
          const a = 0.55 + 0.35 * Math.sin(t / 90);
          const x = FR + r * CELL;
          const gl = ctx.createLinearGradient(x, 0, x + CELL, 0);
          gl.addColorStop(0, `rgba(255, 200, 60, ${a * 0.6})`);
          gl.addColorStop(0.2, 'rgba(255, 200, 60, 0)');
          gl.addColorStop(0.8, 'rgba(255, 200, 60, 0)');
          gl.addColorStop(1, `rgba(255, 200, 60, ${a * 0.6})`);
          ctx.fillStyle = gl;
          ctx.fillRect(x, FR, CELL, ROWS * CELL);
          ctx.strokeStyle = `rgba(255, 220, 110, ${a})`;
          ctx.lineWidth = 4;
          ctx.strokeRect(x + 3, FR + 3, CELL - 6, ROWS * CELL - 6);
          if (Math.random() < 0.3) spark(x + Math.random() * CELL, FR + Math.random() * ROWS * CELL, 1, '#ffd45c', 0.3);
        }
        continue;
      }
      for (let y = 0; y < ROWS; y++) {
        const c = cellOf(r, y);
        if (G.mode === 'hw') {
          drawHwCell(ctx, r, y, c, t);
          continue;
        }
        const s = G.grid[r][y];
        const hl = G.hl.get(c);
        let scale = 1;
        if (hl !== undefined) {
          // Выигравший символ чуть выходит вперёд и играет свою анимацию.
          scale = 1 + 0.07 * ease.back(clamp((G.clock - hl) / 260, 0, 1));
          const g = ctx.createRadialGradient(cx(r), cy(y), 10, cx(r), cy(y), CELL * 0.6);
          g.addColorStop(0, 'rgba(255, 210, 120, .32)');
          g.addColorStop(1, 'rgba(255, 210, 120, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(FR + r * CELL, FR + y * CELL, CELL, CELL);
        }
        const dim = G.lines && hl === undefined && !G.lines.noDim ? 0.45 : 1;
        drawSymbol(ctx, s, G.pearls[c] ?? null, cx(r), cy(y), { scale, alpha: dim, win: hl !== undefined ? 1 : 0, ph: c * 1.7, slot: slotOf(c) });
        const lab = G.collectLabel.get(c);
        if (lab) drawCollectLabel(ctx, cx(r), cy(y), lab);
      }
    }
    ctx.restore();
  }

  function drawCollectLabel(ctx, x, y, lab) {
    const k = clamp((G.clock - lab.at) / 300, 0, 1);
    ctx.save();
    ctx.translate(x, y + CELL * 0.33);
    ctx.scale(0.6 + 0.4 * ease.back(k), 0.6 + 0.4 * ease.back(k));
    ctx.font = `700 ${CELL * 0.2}px ${NUM_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const w = ctx.measureText(lab.text).width + 18;
    roundRect(ctx, -w / 2, -14, w, 28, 14);
    ctx.fillStyle = 'rgba(40, 6, 20, .85)';
    ctx.fill();
    ctx.strokeStyle = '#ffd45c';
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.fillStyle = '#ffe58a';
    ctx.fillText(lab.text, 0, 1);
    ctx.restore();
  }

  // Клетка сундука: пустая ячейка или жемчужина (липнет).
  function drawHwCell(ctx, r, y, c, t) {
    const x = cx(r);
    const yy = cy(y);
    const v = G.hw.board[c];
    if (v === undefined) {
      ctx.save();
      roundRect(ctx, x - CELL * 0.42, yy - CELL * 0.42, CELL * 0.84, CELL * 0.84, 16);
      ctx.fillStyle = 'rgba(8, 4, 20, .55)';
      ctx.fill();
      ctx.strokeStyle = `rgba(160, 120, 255, ${0.18 + 0.1 * Math.sin(t / 300 + c)})`;
      ctx.lineWidth = 2;
      ctx.stroke();
      ctx.restore();
      return;
    }
    const born = G.hw.born.get(c) ?? -1e9;
    const k = clamp((G.clock - born) / 450, 0, 1);
    const drop = (1 - ease.back(k)) * -CELL * 0.8;
    const g = ctx.createRadialGradient(x, yy, 6, x, yy, CELL * 0.55);
    g.addColorStop(0, 'rgba(180, 140, 255, .35)');
    g.addColorStop(1, 'rgba(180, 140, 255, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - CELL / 2, yy - CELL / 2, CELL, CELL);
    const kind = G.hw.kinds.get(c);
    drawSymbol(ctx, 'pearl', kind === 'kraken' ? 'kraken' : v, x, yy + drop, { alpha: k > 0 ? 1 : 0, ph: c * 1.7, win: k < 1 ? 1 : 0, slot: slotOf(`hw${c}`) });
    if (kind === 'kraken') drawPearlValue(ctx, x, yy + drop + CELL * 0.26, v, CELL);
  }

  function drawLines(ctx) {
    const L = G.lines;
    if (!L || !L.wins.length) return;
    const k = (G.clock - L.at) / 1000;
    // Сначала все линии разом, потом по одной.
    const all = k < 1.6;
    const list = all ? L.wins : [L.wins[Math.floor((k - 1.6) / 1.2) % L.wins.length]];
    const prog = clamp(k / 0.5, 0, 1);
    for (const w of list) {
      const rows = LINES[w.line];
      const pts = rows.map((y, r) => [cx(r), cy(y)]);
      pts.unshift([FR - 6, pts[0][1]]);
      pts.push([FR + REELS * CELL + 6, pts[pts.length - 1][1]]);
      const color = LINE_COLORS[w.line];
      ctx.save();
      ctx.lineJoin = 'round';
      ctx.lineCap = 'round';
      const total = pts.length - 1;
      const upto = all ? prog * total : total;
      const path = () => {
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        for (let i = 1; i <= Math.ceil(upto); i++) {
          const f = Math.min(1, upto - (i - 1));
          ctx.lineTo(pts[i - 1][0] + (pts[i][0] - pts[i - 1][0]) * f, pts[i - 1][1] + (pts[i][1] - pts[i - 1][1]) * f);
        }
      };
      path();
      ctx.strokeStyle = 'rgba(0, 0, 0, .55)';
      ctx.lineWidth = 11;
      ctx.stroke();
      path();
      ctx.strokeStyle = color;
      ctx.globalAlpha = 0.35;
      ctx.lineWidth = 16;
      ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.lineWidth = 5;
      ctx.stroke();
      path();
      ctx.strokeStyle = '#fff';
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.restore();
      if (!all) {
        // Подпись линии у последнего выигравшего символа.
        const r = w.count - 1;
        const x = cx(r);
        const y = cy(rows[r]) - CELL * 0.42;
        const text = `+${fmt(w.pay * G.bet)}`;
        ctx.save();
        ctx.font = `700 18px ${NUM_FONT}`;
        ctx.textAlign = 'center';
        const tw = ctx.measureText(text).width + 18;
        roundRect(ctx, x - tw / 2, y - 14, tw, 26, 13);
        ctx.fillStyle = 'rgba(10, 20, 35, .9)';
        ctx.fill();
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.textBaseline = 'middle';
        ctx.fillText(text, x, y);
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
  function splash(x, y) {
    for (let i = 0; i < 14; i++) {
      const a = -Math.PI / 2 + (Math.random() - 0.5) * 2.2;
      const v = 80 + Math.random() * 160;
      G.fx.push({ kind: 'drop', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 0.7, age: 0, r: 2 + Math.random() * 3 });
    }
    G.fx.push({ kind: 'ring', x, y, life: 0.5, age: 0 });
  }
  // Жемчужина летит к Кракену: светящийся шар со шлейфом.
  function flyOrb(from, to, ms, color = '#ffe58a') {
    const o = { kind: 'orb', from, to, start: G.clock, ms, color, trail: [] };
    G.fx.push(o);
    return wait(ms).then(() => { o.done = true; spark(to[0], to[1], 10, color, 0.7); });
  }
  function coinShower(n) {
    for (let i = 0; i < n; i++) {
      G.fx.push({ kind: 'coin', x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 160, life: 4, age: 0, spin: Math.random() * 6, r: 8 + Math.random() * 6 });
    }
  }

  function drawFx(ctx, dt) {
    const g = 420;
    for (let i = G.fx.length - 1; i >= 0; i--) {
      const p = G.fx[i];
      if (p.kind === 'orb') {
        const k = clamp((G.clock - p.start) / p.ms, 0, 1);
        if (p.done || k >= 1) {
          G.fx.splice(i, 1);
          continue;
        }
        const e = ease.inOut(k);
        const mx = (p.from[0] + p.to[0]) / 2;
        const my = Math.min(p.from[1], p.to[1]) - 80;
        const x = (1 - e) ** 2 * p.from[0] + 2 * e * (1 - e) * mx + e * e * p.to[0];
        const y = (1 - e) ** 2 * p.from[1] + 2 * e * (1 - e) * my + e * e * p.to[1];
        p.trail.push([x, y]);
        if (p.trail.length > 12) p.trail.shift();
        ctx.save();
        ctx.globalCompositeOperation = 'lighter';
        p.trail.forEach(([tx, ty], j) => {
          ctx.beginPath();
          ctx.arc(tx, ty, 2 + j * 0.7, 0, Math.PI * 2);
          ctx.fillStyle = `rgba(255, 220, 120, ${(j / p.trail.length) * 0.4})`;
          ctx.fill();
        });
        const rg = ctx.createRadialGradient(x, y, 0, x, y, 16);
        rg.addColorStop(0, '#fff');
        rg.addColorStop(0.4, p.color);
        rg.addColorStop(1, 'rgba(255, 200, 80, 0)');
        ctx.fillStyle = rg;
        ctx.beginPath();
        ctx.arc(x, y, 16, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
        continue;
      }
      p.age += dt;
      if (p.age >= p.life) {
        G.fx.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;
      if (p.kind === 'ring') {
        ctx.beginPath();
        ctx.arc(p.x, p.y, 10 + k * 60, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(190, 240, 255, ${1 - k})`;
        ctx.lineWidth = 3;
        ctx.stroke();
        continue;
      }
      p.vy += (p.kind === 'coin' ? 60 : g) * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      if (p.kind === 'coin') {
        p.spin += dt * 8;
        const sx = Math.abs(Math.cos(p.spin));
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(Math.max(0.15, sx), 1);
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
      ctx.fillStyle = p.kind === 'drop' ? `rgba(190, 240, 255, ${1 - k})` : p.color;
      ctx.globalAlpha = p.kind === 'drop' ? 1 : 1 - k;
      ctx.fill();
      ctx.globalAlpha = 1;
    }
  }

  // Щупальца «Хватки»: поднимаются из глубины по барабану.
  function drawGrabTentacles(ctx, t) {
    for (const g of G.tentacles) {
      const k = clamp((G.clock - g.start) / g.ms, 0, 1);
      // 0..0.45 — подъём, 0.45..0.75 — держит, 0.75..1 — уходит.
      const up = k < 0.45 ? ease.out(k / 0.45) : k < 0.75 ? 1 : 1 - ease.inOut((k - 0.75) / 0.25);
      const x = cx(g.reel);
      const top = FR + ROWS * CELL * (1 - up) - 10;
      const pts = [];
      for (let i = 0; i <= 5; i++) {
        const f = i / 5;
        const y = H + 30 - (H + 30 - top) * f;
        const wob = Math.sin(t / 160 + i * 1.3 + g.reel) * (12 + 18 * f) * (1 - up * 0.5);
        pts.push([x + wob + (f > 0.8 ? (f - 0.8) * 140 * g.side : 0), y]);
      }
      tentacle(ctx, pts, 52, 10, t, g.reel);
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
    ctx.fillStyle = 'rgba(2, 8, 20, .55)';
    ctx.fillRect(0, H / 2 - 70, W, 140);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${b.kind === 'small' ? 44 : 56}px ${TITLE_FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#2a0610';
    const title = b.title.replace(/ /g, ' ');
    ctx.strokeText(title, 0, b.sub ? -16 : 0);
    const g = ctx.createLinearGradient(0, -40, 0, 20);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.5, '#ffc53d');
    g.addColorStop(1, '#e0700a');
    ctx.fillStyle = g;
    ctx.fillText(title, 0, b.sub ? -16 : 0);
    if (b.sub) {
      ctx.font = `600 24px ${NUM_FONT}`;
      ctx.lineWidth = 6;
      ctx.strokeText(b.sub, 0, 34);
      ctx.fillStyle = '#fff';
      ctx.fillText(b.sub, 0, 34);
    }
    ctx.restore();
  }

  function drawBigWin(ctx, t) {
    const b = G.bigWin;
    if (!b) return;
    const k = clamp((G.clock - b.start) / b.ms, 0, 1);
    const shown = b.amount * ease.out(clamp(k / 0.8, 0, 1));
    ctx.save();
    ctx.fillStyle = `rgba(2, 6, 16, ${0.7 * clamp(k * 6, 0, 1)})`;
    ctx.fillRect(0, 0, W, H);
    // Лучи.
    ctx.translate(W / 2, H / 2 - 10);
    ctx.save();
    ctx.rotate(t / 3000);
    for (let i = 0; i < 18; i++) {
      ctx.rotate((Math.PI * 2) / 18);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(-30, -W);
      ctx.lineTo(30, -W);
      ctx.closePath();
      ctx.fillStyle = 'rgba(255, 210, 90, .07)';
      ctx.fill();
    }
    ctx.restore();
    const pulse = 1 + 0.04 * Math.sin(t / 120);
    ctx.scale(pulse, pulse);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    const tier = BIG_WINS.find(([x]) => shown / G.bet >= x) || BIG_WINS[BIG_WINS.length - 1];
    ctx.font = `700 48px ${TITLE_FONT}`;
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#2a0610';
    const tierText = tier[1].replace(/ /g, ' ');
    ctx.strokeText(tierText, 0, -50);
    const g = ctx.createLinearGradient(0, -80, 0, -20);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.5, '#ffc53d');
    g.addColorStop(1, '#e0700a');
    ctx.fillStyle = g;
    ctx.fillText(tierText, 0, -50);
    ctx.font = `700 66px ${NUM_FONT}`;
    ctx.lineWidth = 12;
    ctx.strokeText(fmt(shown), 0, 30);
    ctx.fillStyle = '#fff';
    ctx.fillText(fmt(shown), 0, 30);
    ctx.font = `400 16px ${NUM_FONT}`;
    ctx.fillStyle = 'rgba(255, 255, 255, .7)';
    if (k >= 0.8) ctx.fillText('нажми, чтобы продолжить', 0, 90);
    ctx.restore();
  }

  // ---------- Главный кадр ----------
  let lastFrame = 0;
  function frame(now) {
    // Следующий кадр — сразу: ошибка в рисовании не должна остановить показ (и часы ожиданий).
    requestAnimationFrame(frame);
    const dt = Math.min(0.05, (now - (lastFrame || now)) / 1000);
    lastFrame = now;
    tickClock(dt * 1000);
    try {
      renderScene(now, dt);
    } catch (err) {
      if (!G.drawError) console.error('Кракен: ошибка рисования', err);
      G.drawError = true;
    }
  }

  let bgDt = 0;
  let bgAt = 0;
  function renderScene(now, dt) {
    const visible = !el('kraken').hidden;
    if (visible) {
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
        drawReelsBackground(ctx, now);
        drawCells(ctx, now);
        drawLines(ctx);
        drawGrabTentacles(ctx, now);
        drawFrame(ctx, now);
        drawFx(ctx, dt * G.speed);
        drawBanner(ctx);
        drawBigWin(ctx, now);
      } else {
        ctx.fillStyle = '#9fd6ff';
        ctx.font = `400 18px ${NUM_FONT}`;
        ctx.textAlign = 'center';
        ctx.fillText('Кракен всплывает…', W / 2, H / 2);
      }
      renderBar(dt);
    }
  }

  // ---------- Фон: подводная сцена ----------
  // Дальние скалы, затонувший галеон, силуэты щупалец и водоросли — всё рисуется кодом.
  const ROCKS = [];
  function rockLayer(seed, n, hMin, hMax) {
    let x = seed;
    const rnd = () => ((x = (x * 9301 + 49297) % 233280) / 233280);
    const pts = [];
    for (let i = 0; i <= n; i++) pts.push([i / n, hMin + rnd() * (hMax - hMin), rnd()]);
    return pts;
  }
  ROCKS.push(rockLayer(7, 22, 0.12, 0.3), rockLayer(31, 14, 0.05, 0.2));
  function drawRocks(ctx, w, h, pts, color, spire) {
    ctx.beginPath();
    ctx.moveTo(0, h);
    for (const [fx, fh, r] of pts) {
      const x = fx * w;
      const y = h - fh * h;
      if (spire && r > 0.8) {
        // Скальный шпиль.
        ctx.lineTo(x - 14, y);
        ctx.lineTo(x - 4, y - h * 0.18 * r);
        ctx.lineTo(x + 6, y - h * 0.14 * r);
        ctx.lineTo(x + 16, y);
      } else ctx.lineTo(x, y);
    }
    ctx.lineTo(w, h);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
  }
  function drawWreck(ctx, x, y, s, now) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s, s);
    ctx.rotate(-0.14);
    ctx.fillStyle = '#020c10';
    ctx.beginPath();
    ctx.moveTo(-150, 0);
    ctx.quadraticCurveTo(-130, 54, 0, 56);
    ctx.quadraticCurveTo(110, 52, 160, -14);
    ctx.lineTo(120, -6);
    ctx.lineTo(90, -22);
    ctx.lineTo(40, -8);
    ctx.lineTo(-150, 0);
    ctx.fill();
    // Сломанные мачты и рваные паруса.
    ctx.fillRect(-64, -150, 8, 150);
    ctx.save();
    ctx.translate(30, 0);
    ctx.rotate(0.5);
    ctx.fillRect(0, -110, 7, 110);
    ctx.restore();
    ctx.beginPath();
    ctx.moveTo(-56, -140);
    ctx.quadraticCurveTo(-10 + 4 * Math.sin(now / 1400), -120, 6, -128);
    ctx.lineTo(-10, -100);
    ctx.lineTo(4, -84);
    ctx.lineTo(-56, -70);
    ctx.fill();
    // Призрачные огни в иллюминаторах.
    for (let i = 0; i < 5; i++) {
      const a = 0.25 + 0.25 * Math.sin(now / 900 + i * 1.7);
      const gx = -110 + i * 46;
      const gl = ctx.createRadialGradient(gx, 22, 0, gx, 22, 14);
      gl.addColorStop(0, `rgba(110, 255, 170, ${a})`);
      gl.addColorStop(1, 'rgba(110, 255, 170, 0)');
      ctx.fillStyle = gl;
      ctx.fillRect(gx - 14, 8, 28, 28);
    }
    ctx.restore();
  }
  function drawDeepTentacle(ctx, x0, h, len, side, now, ph) {
    const pts = [];
    for (let i = 0; i <= 5; i++) {
      const f = i / 5;
      const sway = Math.sin(now / 2600 + ph + f * 2.4) * 40 * f;
      pts.push([x0 + side * (f * len * 0.35 + sway) - side * f * f * 60, h + 20 - f * len]);
    }
    window.SlotRig.tentacle(ctx, pts, 46, 6, { colors: ['#05090c', '#0a1418', '#12242a'], sucker: 'rgba(40, 70, 76, .5)', ink: '#010406', suckerSide: side, line: 2 });
  }
  function drawAbyss(ctx, w, h, now, fsm, hw) {
    drawRocks(ctx, w, h, ROCKS[0], fsm ? 'rgba(20, 4, 10, .8)' : hw ? 'rgba(12, 8, 26, .8)' : 'rgba(4, 22, 28, .85)', true);
    drawWreck(ctx, w * 0.8, h * 0.84, Math.min(1.2, w / 900), now);
    drawDeepTentacle(ctx, w * 0.04, h, h * 0.75, 1, now, 0);
    drawDeepTentacle(ctx, w * 0.96, h, h * 0.65, -1, now, 2.1);
    drawRocks(ctx, w, h, ROCKS[1], '#010507', false);
    // Водоросли по краям.
    for (const [x0, n, dir] of [[14, 5, 1], [w - 14, 5, -1]]) {
      for (let i = 0; i < n; i++) {
        const x = x0 + dir * i * 15;
        const hh = h * (0.16 + (i % 3) * 0.06);
        ctx.beginPath();
        ctx.moveTo(x, h);
        for (let k = 1; k <= 8; k++) {
          const f = k / 8;
          ctx.lineTo(x + Math.sin(now / 1100 + i + f * 3) * 14 * f, h - hh * f);
        }
        ctx.strokeStyle = fsm ? 'rgba(60, 12, 30, .8)' : 'rgba(10, 46, 34, .85)';
        ctx.lineWidth = 7 - i * 0.6;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }
  }
  const BG = { bubbles: [], fish: [], eyeAt: 0, size: [0, 0], motes: [] };
  function drawBackground(now, dt) {
    const box = bgCv.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    const dpr = fitCanvas(bgCv, w, h);
    const ctx = bctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const fsm = G.mode === 'fs';
    const hw = G.mode === 'hw';
    // Толща воды: сверху мутный свет, вниз — чернота. Фриспины — кровь в воде, сундук — фиолетовая тьма.
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, fsm ? '#2a0814' : hw ? '#160c30' : '#0a2a30');
    g.addColorStop(0.5, fsm ? '#12030a' : hw ? '#090518' : '#041418');
    g.addColorStop(1, '#010507');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
    drawAbyss(ctx, w, h, now, fsm, hw);
    // Лучи света сверху.
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = 0; i < 6; i++) {
      const x = w * (0.1 + i * 0.17) + Math.sin(now / 4000 + i) * 40;
      const rg = ctx.createLinearGradient(x, 0, x + 80, h * 0.8);
      const a = fsm ? 0.02 : 0.045;
      rg.addColorStop(0, `rgba(170, 230, 255, ${a + 0.03 * Math.sin(now / 1300 + i * 2)})`);
      rg.addColorStop(1, 'rgba(170, 230, 255, 0)');
      ctx.fillStyle = rg;
      ctx.beginPath();
      ctx.moveTo(x - 30, 0);
      ctx.lineTo(x + 40, 0);
      ctx.lineTo(x + 180, h * 0.85);
      ctx.lineTo(x + 20, h * 0.85);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
    // Глаз Кракена во тьме: иногда открывается.
    if (now > BG.eyeAt + 14000) BG.eyeAt = now;
    const ek = (now - BG.eyeAt) / 3000;
    if (ek < 1 || fsm) {
      const open = fsm ? 0.8 + 0.2 * Math.sin(now / 500) : Math.sin(Math.min(1, ek) * Math.PI);
      const ex = w * 0.12;
      const ey = h * 0.72;
      ctx.save();
      ctx.globalAlpha = 0.55 * open;
      const eg = ctx.createRadialGradient(ex, ey, 2, ex, ey, 70);
      eg.addColorStop(0, 'rgba(255, 210, 60, .9)');
      eg.addColorStop(1, 'rgba(255, 150, 0, 0)');
      ctx.fillStyle = eg;
      ctx.beginPath();
      ctx.ellipse(ex, ey, 60, 60 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffd23a';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 26, 18 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#100';
      ctx.beginPath();
      ctx.ellipse(ex, ey, 4, 15 * open, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
    // Рыбки-силуэты.
    if (BG.fish.length < 4 && Math.random() < dt * 0.3) {
      const dir = Math.random() < 0.5 ? 1 : -1;
      BG.fish.push({ x: dir > 0 ? -40 : w + 40, y: h * (0.15 + Math.random() * 0.6), v: dir * (30 + Math.random() * 40), s: 0.6 + Math.random() * 0.8, ph: Math.random() * 6 });
    }
    ctx.fillStyle = 'rgba(2, 20, 35, .45)';
    BG.fish = BG.fish.filter((f) => f.x > -60 && f.x < w + 60);
    for (const f of BG.fish) {
      f.x += f.v * dt;
      ctx.save();
      ctx.translate(f.x, f.y + Math.sin(now / 600 + f.ph) * 6);
      ctx.scale(Math.sign(f.v) * f.s, f.s);
      ctx.beginPath();
      ctx.ellipse(0, 0, 18, 7, 0, 0, Math.PI * 2);
      ctx.moveTo(-14, 0);
      ctx.lineTo(-28, -8 + Math.sin(now / 120 + f.ph) * 2);
      ctx.lineTo(-28, 8 + Math.sin(now / 120 + f.ph) * 2);
      ctx.fill();
      ctx.restore();
    }
    // Пузырьки.
    if (BG.bubbles.length < 40 && Math.random() < dt * 8) BG.bubbles.push({ x: Math.random() * w, y: h + 10, r: 1.5 + Math.random() * 4, v: 30 + Math.random() * 50, ph: Math.random() * 6 });
    BG.bubbles = BG.bubbles.filter((b) => b.y > -10);
    for (const b of BG.bubbles) {
      b.y -= b.v * dt;
      const x = b.x + Math.sin(now / 500 + b.ph) * 6;
      ctx.beginPath();
      ctx.arc(x, b.y, b.r, 0, Math.PI * 2);
      ctx.strokeStyle = 'rgba(200, 240, 255, .5)';
      ctx.lineWidth = 1;
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x - b.r * 0.3, b.y - b.r * 0.3, b.r * 0.3, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(255, 255, 255, .6)';
      ctx.fill();
    }
  }

  // ---------- Панель ----------
  function renderBar(dt) {
    if (G.winShown !== G.winTarget) {
      const step = Math.max(1, Math.abs(G.winTarget - G.winShown) * dt * 6);
      G.winShown = G.winShown < G.winTarget ? Math.min(G.winTarget, G.winShown + step) : G.winTarget;
      if (Math.random() < 0.3 && G.winShown < G.winTarget) AUDIO()?.sfx('tick');
    }
    el('kr-win').textContent = fmt(G.winShown);
    el('kr-balance').textContent = fmt(state.balance || 0);
    el('kr-bet').textContent = fmt(G.bet);
    el('kr-spin').classList.toggle('busy', G.busy);
    el('kr-auto').textContent = G.auto > 0 ? (G.auto > 1000 ? '∞' : `${G.auto}`) : 'Авто';
    el('kr-auto').classList.toggle('on', G.auto > 0);
    el('kr-turbo').classList.toggle('on', G.turbo);
    for (const [k, m] of Object.entries(JACKPOTS)) el(`kr-jp-${k}`).textContent = short(m * G.bet);
  }

  function setMsg(text) {
    el('kr-msg').textContent = text;
  }

  // ---------- Показ исхода ----------
  async function present(result) {
    const o = result.outcome;
    const bet = result.bet;
    G.bet0 = bet;
    G.busy = true;
    G.skip = false;
    setSpeed();
    G.winTarget = 0;
    G.winShown = 0;
    G.mode = 'base';
    G.hw = null;
    G.fs = null;
    setMsg(result.mode === 'spin' ? 'Удачи!' : 'Бонус куплен!');
    const a = AUDIO();
    a?.sfx('spin');

    // Карты на первых барабанах — остальные крутятся дольше (вдруг будет бонус).
    const b = o.base;
    let mapsBefore = 0;
    let anticipate = -1;
    for (let r = 0; r < REELS - 1; r++) {
      if (b.grid[r].includes('map')) mapsBefore += 1;
      if (mapsBefore >= 2 && anticipate < 0) anticipate = r;
    }
    if (anticipate >= 0) a?.sfx('tease');
    // Хватка: поле до щупалец — без «диких» барабанов.
    const before = b.tentacle ? withoutGrab(b.grid, b.tentacle) : b.grid;
    await spinReels(before, b.pearls, { anticipate });

    let won = 0;
    if (b.tentacle) await grab(b.tentacle, b.grid);
    if (b.collect) won += await collect(b.collect, b.pearls, 1);
    if (b.wins.length) won += await showLines(b.wins);
    if (b.scatter) {
      const cells = [];
      b.grid.forEach((col, r) => col.forEach((s, y) => { if (s === 'map') cells.push(cellOf(r, y)); }));
      cells.forEach((c) => G.hl.set(c, G.clock));
      a?.sfx('scatter');
      won += b.scatter.pay * bet;
      G.winTarget = won;
      await wait(1200);
    }
    if (o.hw) won = await playHoldAndWin(o.hw, won);
    if (o.fs) won = await playFreeSpins(o.fs, won);

    G.winTarget = result.payout;
    G.mode = 'base';
    if (result.payout >= 15 * bet) await bigWin(result.payout);
    else if (result.payout > 0) {
      a?.sfx(result.payout >= 3 * bet ? 'winMid' : 'win');
      setMsg(`Выигрыш ${fmt(result.payout)}`);
    } else {
      setMsg('Кракен ждёт следующей ставки');
    }
    G.winShown = G.winTarget;
    send({ type: 'kraken_done', id: result.id });
    G.busy = false;
    G.skip = false;
    setSpeed();
    if (G.auto > 0) {
      const bonus = o.fs || o.hw;
      if (bonus && G.autoStopOnBonus) G.auto = 0;
      else {
        G.auto -= 1;
        if (G.auto > 0) setTimeout(() => { if (!G.busy && G.auto > 0) doSpin('spin'); }, G.turbo ? 250 : 600);
      }
    }
  }

  function withoutGrab(grid, reels) {
    // Сервер прислал поле после щупалец; что было под ними — неизвестно, рисуем случайное.
    return grid.map((col, r) => (reels.includes(r) ? col.map((s) => (s === 'wild' ? calmSym() : s)) : col.slice()));
  }

  async function grab(reels, grid) {
    const a = AUDIO();
    a?.sfx('tentacle');
    G.shake = 10;
    banner('ХВАТКА КРАКЕНА!', reels.length > 1 ? `${reels.length} барабана становятся дикими` : 'барабан становится диким', 1500);
    const ms = 2200;
    G.tentacles = reels.map((r, i) => ({ reel: r, start: G.clock + i * 160, ms, side: i % 2 ? 1 : -1 }));
    await wait(ms * 0.45 + 200);
    for (const r of reels) {
      G.wild.add(r);
      for (let y = 0; y < ROWS; y++) {
        if (grid[r][y] === 'wild' && G.grid[r][y] !== 'wild') {
          G.grid[r][y] = 'wild';
          splash(cx(r), cy(y));
        }
      }
    }
    G.shake = 6;
    await wait(ms * 0.55);
    G.tentacles = [];
  }

  // Кракены забирают жемчуг: шарики летят к каждому Кракену.
  async function collect(col, pearls, mult) {
    const a = AUDIO();
    const flights = [];
    col.reels.forEach((r, i) => {
      const y = G.grid[r].indexOf('wild');
      const to = [cx(r), cy(y < 0 ? 0 : y)];
      for (const c of col.cells[i]) {
        const pr = Math.floor(c / ROWS);
        const py = c % ROWS;
        G.hl.set(c, G.clock);
        flights.push(wait(i * 120).then(() => flyOrb([cx(pr), cy(py)], to, 650)));
      }
      G.hl.set(cellOf(r, y), G.clock);
    });
    a?.sfx('collect');
    await Promise.all(flights);
    const pay = col.pay * G.bet0;
    col.reels.forEach((r, i) => {
      const y = G.grid[r].indexOf('wild');
      const sum = col.cells[i].reduce((s, c) => s + pearls[c], 0) * mult;
      if (sum > 0) G.collectLabel.set(cellOf(r, y), { text: `+${short(sum * G.bet0)}`, at: G.clock });
      spark(cx(r), cy(y), 18, '#ffd45c', 1.2);
    });
    a?.sfx('coins');
    G.winTarget += pay;
    await wait(900);
    return pay;
  }

  async function showLines(wins) {
    const a = AUDIO();
    const pay = wins.reduce((s, w) => s + w.pay, 0) * G.bet0;
    for (const w of wins) {
      const rows = LINES[w.line];
      for (let r = 0; r < w.count; r++) G.hl.set(cellOf(r, rows[r]), G.clock);
    }
    G.lines = { wins, at: G.clock };
    a?.sfx(pay >= 5 * G.bet0 ? 'winMid' : 'win');
    G.winTarget += pay;
    setMsg(`Линии: +${fmt(pay)}`);
    await wait(Math.min(2600, 1300 + wins.length * 250));
    return pay;
  }

  async function bigWin(amount) {
    const a = AUDIO();
    a?.sfx('bigwin');
    G.bigWin = { amount, start: G.clock, ms: 5200 };
    coinShower(60);
    const end = wait(5200);
    let clicked = false;
    G.onSkip = () => { clicked = true; };
    while (!clicked && G.bigWin && G.clock < G.bigWin.start + 5200) {
      if (Math.random() < 0.4) coinShower(4);
      await wait(200);
    }
    void end;
    G.onSkip = null;
    G.bigWin = null;
    setMsg(`Выигрыш ${fmt(amount)}!`);
  }

  // ---------- Сундук глубин ----------
  async function playHoldAndWin(hw, won) {
    const a = AUDIO();
    await wait(400);
    a?.music('hw');
    await banner('СУНДУК ГЛУБИН', `${Object.keys(hw.start).length} жемчужин · 3 вращения`, 2000);
    G.mode = 'hw';
    G.lines = null;
    G.hl.clear();
    G.collectLabel.clear();
    G.hw = { board: { ...hw.start }, born: new Map(), kinds: new Map(), left: 3 };
    for (const c of Object.keys(hw.start)) G.hw.born.set(Number(c), -1e9);
    renderHwInfo();
    let total = Object.values(hw.start).reduce((s, v) => s + valueOf(v), 0);
    setMsg(`В сундуке: ${fmt(total * G.bet0)}`);
    for (const round of hw.rounds) {
      // Пустые клетки «перекатываются».
      a?.sfx('respin');
      G.hw.shimmer = G.clock;
      await wait(G.turbo ? 500 : 900);
      for (const l of round.landed) {
        if (l.value === 'kraken') continue;
        G.hw.board[l.cell] = l.value;
        G.hw.born.set(l.cell, G.clock);
        a?.sfx(typeof l.value === 'string' ? 'jackpot' : 'pearl');
        await wait(200);
        splash(cx(Math.floor(l.cell / ROWS)), cy(l.cell % ROWS));
        total += valueOf(l.value);
      }
      for (const l of round.landed) {
        if (l.value !== 'kraken') continue;
        // Жемчужина Кракена: щупальца стягивают всё поле в неё.
        G.hw.board[l.cell] = 0;
        G.hw.kinds.set(l.cell, 'kraken');
        G.hw.born.set(l.cell, G.clock);
        a?.sfx('tentacle');
        G.shake = 8;
        await banner('КРАКЕН ЗАБИРАЕТ ВСЁ!', 'вся жемчужина поля — в одну', 1300, 'small');
        const to = [cx(Math.floor(l.cell / ROWS)), cy(l.cell % ROWS)];
        const flights = Object.keys(G.hw.board).map(Number).filter((c) => c !== l.cell)
          .map((c, i) => wait(i * 40).then(() => flyOrb([cx(Math.floor(c / ROWS)), cy(c % ROWS)], to, 600, '#ff9be3')));
        await Promise.all(flights);
        G.hw.board[l.cell] = l.collected;
        total += l.collected;
        spark(to[0], to[1], 30, '#ff9be3', 1.4);
        a?.sfx('coins');
      }
      G.hw.left = round.left;
      renderHwInfo();
      setMsg(`В сундуке: ${fmt(total * G.bet0)}`);
      await wait(round.landed.length ? 500 : 300);
    }
    if (hw.full) {
      a?.sfx('bigwin');
      G.shake = 14;
      await banner('GRAND!', `весь сундук заполнен: +${fmt(JACKPOTS.grand * G.bet0)}`, 2600);
      total += JACKPOTS.grand;
    }
    // Подсчёт: жемчужины по очереди отдают свои суммы.
    const cells = Object.keys(G.hw.board).map(Number).sort((x, y) => x - y);
    for (const c of cells) {
      G.hl.set(c, G.clock);
      won += valueOf(G.hw.board[c]) * G.bet0;
      G.winTarget = won;
      spark(cx(Math.floor(c / ROWS)), cy(c % ROWS), 6, '#ffe58a', 0.6);
      a?.sfx('tick');
      await wait(G.turbo ? 40 : 90);
    }
    if (hw.full) won += JACKPOTS.grand * G.bet0;
    G.winTarget = won;
    await banner('СУНДУК ОТКРЫТ', `+${fmt(hw.pay * G.bet0)}`, 1800);
    G.mode = 'base';
    G.hw = null;
    G.hl.clear();
    renderHwInfo();
    a?.music('base');
    return won;
  }
  const valueOf = (v) => (typeof v === 'number' ? v : JACKPOTS[v]);

  function renderHwInfo() {
    const box = el('kr-hw');
    box.hidden = !G.hw;
    if (!G.hw) return;
    box.replaceChildren(
      Object.assign(document.createElement('span'), { textContent: 'Вращений:' }),
      ...[1, 2, 3].map((i) => Object.assign(document.createElement('i'), { className: i <= G.hw.left ? 'on' : '' })),
    );
  }

  // ---------- Фриспины ----------
  async function playFreeSpins(fs, won) {
    const a = AUDIO();
    await wait(300);
    a?.music('fs');
    G.shake = 12;
    await banner('ПРОБУЖДЕНИЕ КРАКЕНА', `${fs.count} бесплатных вращений`, 2400);
    G.mode = 'fs';
    G.fs = { left: fs.count, level: 0, meter: 0, total: 0 };
    renderMeter();
    let fsWon = 0;
    let n = 0;
    for (const s of fs.spins) {
      G.fs.left -= 1;
      n += 1;
      renderMeter();
      setMsg(`Фриспин ${n} · выиграно ${fmt(fsWon)}`);
      G.pearls = {};
      await spinReels(s.grid, s.pearls);
      if (s.collect) {
        const p = await collect(s.collect, s.pearls, s.collect.mult);
        fsWon += p;
      }
      if (s.wins.length) fsWon += await showLines(s.wins);
      G.fs.meter = s.meter;
      G.fs.total = fsWon;
      renderMeter();
      if (s.levelUp) {
        G.fs.level = s.level;
        G.fs.left = s.left;
        a?.sfx('levelup');
        G.shake = 10;
        await banner(`КРАКЕН ×${FS_LEVELS[s.level]}`, `+5 вращений · жемчуг ×${FS_LEVELS[s.level]}`, 1900);
        renderMeter();
      }
      G.winTarget = won + fsWon;
      await wait(G.turbo ? 200 : 450);
    }
    won += fsWon;
    G.winTarget = won;
    await banner('ФРИСПИНЫ ОКОНЧЕНЫ', `Кракен принёс ${fmt(fs.pay * G.bet0)}`, 2200);
    G.mode = 'base';
    G.fs = null;
    renderMeter();
    a?.music('base');
    return won;
  }

  function renderMeter() {
    const m = el('kr-meter');
    m.hidden = !G.fs;
    if (!G.fs) return;
    const inLevel = G.fs.level >= FS_LEVELS.length - 1 ? 4 : G.fs.meter - G.fs.level * 4;
    el('kr-meter-eyes').replaceChildren(...[0, 1, 2, 3].map((i) => Object.assign(document.createElement('i'), { className: i < inLevel ? 'on' : '' })));
    el('kr-meter-mult').textContent = `×${FS_LEVELS[G.fs.level]}`;
    el('kr-meter-left').textContent = G.fs.left;
  }

  // ---------- Ставки и кнопки ----------
  function doSpin(mode = 'spin') {
    if (G.busy || G.awaiting) return;
    if (!G.ready) return toast('Кракен ещё всплывает…');
    const cost = mode === 'buy-fs' ? G.bet * BUY.fs : mode === 'buy-hw' ? G.bet * BUY.hw : G.bet;
    if (cost > (state.balance || 0)) {
      G.auto = 0;
      return toast(mode === 'spin' ? 'Не хватает фишек на ставку' : `Бонус стоит ${fmt(cost)} — не хватает фишек`);
    }
    window.Lounge?.unlock?.();
    AUDIO()?.unlock();
    G.awaiting = true;
    send({ type: 'kraken_spin', bet: G.bet, mode });
  }

  function onResult(msg) {
    G.awaiting = false;
    present(msg).catch((err) => {
      console.error('Кракен:', err);
      G.busy = false;
      G.mode = 'base';
      send({ type: 'kraken_done', id: msg.id });
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

  el('kr-spin').addEventListener('click', skipOrSpin);
  reelsCv.addEventListener('click', () => { if (G.busy) skipOrSpin(); });
  el('kr-bet-down').addEventListener('click', () => changeBet(-1));
  el('kr-bet-up').addEventListener('click', () => changeBet(1));
  el('kr-bet-max').addEventListener('click', () => {
    if (G.busy) return;
    const affordable = BET_STEPS.filter((b) => b <= (state.balance || 0));
    G.bet = affordable.length ? affordable[affordable.length - 1] : BET_STEPS[0];
    storage.set(BET_KEY, String(G.bet));
  });
  el('kr-turbo').addEventListener('click', () => {
    G.turbo = !G.turbo;
    storage.set(TURBO_KEY, G.turbo ? '1' : '0');
    setSpeed();
  });
  el('kr-auto').addEventListener('click', () => {
    if (G.auto > 0) {
      G.auto = 0;
      return;
    }
    el('kr-auto-menu').hidden = !el('kr-auto-menu').hidden;
  });
  el('kr-auto-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-auto]');
    if (!b) return;
    G.auto = Number(b.dataset.auto);
    G.autoStopOnBonus = el('kr-auto-stop').checked;
    el('kr-auto-menu').hidden = true;
    doSpin('spin');
  });

  // Покупка бонуса.
  el('kr-buy').addEventListener('click', () => {
    if (G.busy) return;
    el('kr-buy-fs-price').textContent = fmt(G.bet * BUY.fs);
    el('kr-buy-hw-price').textContent = fmt(G.bet * BUY.hw);
    el('kr-buy-modal').hidden = false;
  });
  el('kr-buy-modal').addEventListener('click', (e) => {
    if (e.target === el('kr-buy-modal') || e.target.closest('[data-close]')) el('kr-buy-modal').hidden = true;
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    el('kr-buy-modal').hidden = true;
    doSpin(b.dataset.buy);
  });

  // Таблица выплат.
  el('kr-info').addEventListener('click', () => {
    renderPaytable();
    el('kr-pay-modal').hidden = false;
  });
  el('kr-pay-modal').addEventListener('click', (e) => {
    if (e.target === el('kr-pay-modal') || e.target.closest('[data-close]')) el('kr-pay-modal').hidden = true;
  });

  function symImg(s) {
    const img = document.createElement('img');
    const still = s === 'pearl' ? G.pearlRig.gold && G.pearlRig.gold.still : G.img[s];
    if (still) img.src = still.toDataURL();
    img.className = 'painted';
    img.alt = NAMES[s];
    return img;
  }
  function renderPaytable() {
    const grid = el('kr-pays');
    grid.replaceChildren(...Object.keys(PAYS).reverse().map((s) => {
      const d = document.createElement('div');
      d.className = 'kr-pay';
      const list = document.createElement('div');
      PAYS[s].forEach((p, i) => list.append(Object.assign(document.createElement('span'), { innerHTML: `<b>${5 - i}×</b> ${fmt((PAYS[s][2 - i] * G.bet) / 20)}` })));
      d.append(symImg(s), list);
      return d;
    }));
    el('kr-pay-wild').replaceChildren(symImg('wild'));
    el('kr-pay-map').replaceChildren(symImg('map'));
    el('kr-pay-pearl').replaceChildren(symImg('pearl'));
    el('kr-pay-bet').textContent = fmt(G.bet);
    el('kr-lines').replaceChildren(...LINES.map((rows, i) => {
      const box = document.createElement('div');
      box.className = 'kr-line';
      box.title = `Линия ${i + 1}`;
      for (let y = 0; y < ROWS; y++) for (let r = 0; r < REELS; r++) box.append(Object.assign(document.createElement('i'), { className: rows[r] === y ? 'on' : '' }));
      box.style.setProperty('--lc', LINE_COLORS[i]);
      return box;
    }));
  }

  // Пробел: крутить (или ускорить показ), когда открыта вкладка Кракена.
  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || el('kraken').hidden) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button')) return;
    if (!el('kr-buy-modal').hidden || !el('kr-pay-modal').hidden) return;
    e.preventDefault();
    if (!e.repeat) skipOrSpin();
  });

  // ---------- Лента ----------
  function renderFeed(feed) {
    const myId = state.me && state.me.playerId;
    el('kr-feed').replaceChildren(...(feed.length ? feed.map((e) => {
      const li = document.createElement('li');
      const win = e.payout > e.cost;
      li.className = win ? 'win' : 'lose';
      if (e.playerId === myId) li.classList.add('self');
      li.append(avatarEl(e.name));
      li.append(Object.assign(document.createElement('span'), { className: 'name', textContent: e.name }));
      li.append(Object.assign(document.createElement('span'), { className: 'u-what', textContent: win ? `+${fmt(e.payout - e.cost)}` : `−${fmt(e.cost - e.payout)}` }));
      const tag = e.bonus === 'fs' ? '🐙 фриспины' : e.bonus === 'hw' ? '💎 сундук' : e.bonus === 'both' ? '🐙💎 всё сразу' : e.mode !== 'spin' ? 'покупка' : `×${e.mult}`;
      li.append(Object.assign(document.createElement('span'), { className: 'u-ch', textContent: tag }));
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'Кракена ещё никто не будил' })]));
  }

  handlers.kraken_result = onResult;
  handlers.kraken_feed = (msg) => renderFeed(msg.feed);
  window.krakenOnError = onError;
  // Вкладка Кракена: свой саундтрек вместо джаза зала.
  window.krakenTabShown = (on) => {
    AUDIO()?.setActive(on);
  };

  el('kr-sound').addEventListener('click', () => {
    const au = AUDIO();
    if (!au) return;
    au.unlock();
    el('kr-sound').classList.toggle('off', !au.toggle());
  });
  el('kr-sound').classList.toggle('off', !(AUDIO() && AUDIO().isMusicOn()));
  if (!el('kraken').hidden) window.krakenTabShown(true);

  renderFeed([]);
  loadArt();
  requestAnimationFrame(frame);
})();
