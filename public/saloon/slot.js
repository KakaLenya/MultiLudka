// «Салун мертвецов» — клиент слота. Исход спина целиком приходит с сервера (saloon_result),
// здесь только его показ: вращение, пути выигрыша, раскрытые Кольты, шальные пули и дуэль на закате.
// Когда показ закончен, шлём saloon_done — сервер зачисляет выигрыш.
// Пользуется общими штуками зала из client.js: send, state, toast, handlers, storage, avatarEl.
(function () {
  'use strict';

  const ART = window.SaloonArt;
  const AUDIO = () => window.SaloonAudio || null;

  // ---------- Как на сервере (server/saloon-math.js) ----------
  const REELS = 5;
  const ROWS = 3;
  const UNIT = 20;
  const PAYS = {
    horseshoe: [2, 6, 16], whiskey: [2, 6, 16], hat: [3, 7, 22], boot: [3, 7, 22],
    vulture: [5, 15, 50], skull: [6, 20, 70], barman: [8, 30, 100], sheriff: [12, 50, 200],
  };
  const NAMES = {
    horseshoe: 'Подкова', whiskey: 'Виски', hat: 'Шляпа', boot: 'Сапог', vulture: 'Стервятник', skull: 'Бычий череп', barman: 'Бармен', sheriff: 'Шериф', colt: 'Кольт', wanted: 'Розыск',
  };
  const BUY = { duel: 115, super: 500 };
  const LIVES = { 3: 3, 4: 4, 5: 5 };
  const FILLER = ['horseshoe', 'whiskey', 'hat', 'boot', 'horseshoe', 'whiskey', 'hat', 'boot', 'vulture', 'skull', 'barman', 'sheriff', 'colt', 'wanted'];
  const CALM = ['horseshoe', 'whiskey', 'hat', 'boot', 'vulture', 'skull', 'barman', 'sheriff'];
  const BET_STEPS = [10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000, 200_000, 500_000, 1_000_000];
  const BIG_WINS = [[500, 'ЛЕГЕНДАРНЫЙ ВЫИГРЫШ'], [100, 'ЭПИЧЕСКИЙ ВЫИГРЫШ'], [50, 'ОГРОМНЫЙ ВЫИГРЫШ'], [15, 'БОЛЬШОЙ ВЫИГРЫШ']];
  const WIN_COLORS = {
    horseshoe: '#ffd54a', whiskey: '#ff9f43', hat: '#e0b07a', boot: '#ff7a59',
    vulture: '#ff8fb1', skull: '#59ffe0', barman: '#c38bff', sheriff: '#fff07a',
  };
  const TITLE_FONT = '"Ruslan Display", Georgia, serif';
  const NUM_FONT = 'Oswald, "Arial Narrow", sans-serif';

  // ---------- Геометрия ----------
  const CELL = 126;
  const FR = 28;
  const W = REELS * CELL + 2 * FR;
  const H = ROWS * CELL + 2 * FR;
  const cx = (r) => FR + r * CELL + CELL / 2;
  const cy = (y) => FR + y * CELL + CELL / 2;
  const cellOf = (r, y) => r * ROWS + y;
  const reelOf = (c) => Math.floor(c / ROWS);
  const rowOf = (c) => c % ROWS;
  const INK = '#1f0e07';

  const fmt = (n) => chips(Math.floor(n));   // 60.000.000 — общая функция зала
  const ease = {
    out: (t) => 1 - (1 - t) ** 3,
    inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2),
    back: (t) => 1 + 2.4 * (t - 1) ** 3 + 1.4 * (t - 1) ** 2,
  };
  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

  // ---------- Состояние ----------
  const BET_KEY = 'casino.saloon.bet';
  const TURBO_KEY = 'casino.saloon.turbo';
  const G = {
    ready: false,
    img: {},
    blur: {},
    hole: null,
    rig: {},                 // символ -> модель из деталей (saloon/rig.js)
    hatUrl: '',
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
    mode: 'base',            // base | duel
    grid: null,
    reels: [],
    expanded: new Set(),     // раскрытые Кольты (барабаны)
    holes: new Set(),        // клетки с дырой от пули
    sticky: new Map(),       // дуэль: клетка -> множитель
    hl: new Map(),
    ways: null,
    fx: [],
    banner: null,
    bigWin: null,
    shake: 0,
    duel: null,              // { lives, max, spins, won }
    scene: null,             // сцена дуэли поверх барабанов
    aim: null,               // прицел шальной пули { cell, at }
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
  // Символы нарисованы вручную и собраны из деталей (saloon/rig.js): в кадре живут —
  // крутится барабан Кольта, тлеют глазницы, дымит сигара. На скорости — неподвижный кадр с размытием.
  async function loadArt() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const px = Math.round(CELL * dpr);
    const A = window.SlotArt;
    const SR = window.SlotRig;
    await Promise.all([document.fonts.load(`700 20px ${NUM_FONT}`), document.fonts.load('20px "Ruslan Display"')]).catch(() => {});
    const jobs = Object.entries(window.SaloonRig.SYMBOLS).map(async ([k, def]) => {
      const rig = await SR.build(def, px);
      G.rig[k] = rig;
      G.img[k] = rig.still;
      G.blur[k] = A.motionBlur(rig.still);
    });
    jobs.push(ART.render(ART.EXTRA_SVG.bulletHole, px).then((cv) => { G.hole = cv; }));
    jobs.push(A.loadImage('textures/wood-old.jpg').then((img) => { G.texReel = img; }));
    jobs.push(A.loadImage('textures/wood-dark.jpg').then((img) => { G.texWood = img; }));
    jobs.push(A.loadImage('textures/metal-rust.jpg').then((img) => { G.texIron = img; }));
    await Promise.all(jobs);
    G.hatUrl = G.img.hat ? G.img.hat.toDataURL() : '';
    G.ready = true;
    if (G.duel) renderDuelInfo();
  }


  // ---------- Разметка ----------
  const el = (id) => document.getElementById(id);
  document.body.append(el('sl-buy-modal'), el('sl-pay-modal'));
  const reelsCv = el('sl-reels');
  const bgCv = el('sl-bg');
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
    return s === 'colt' && (r === 0 || r === 4) ? 'sheriff' : s;
  }
  G.grid = Array.from({ length: REELS }, () => Array.from({ length: ROWS }, calmSym));
  G.reels = Array.from({ length: REELS }, () => ({ spinning: false }));

  // ---------- Вращение ----------
  function spinReels(grid, { anticipate = -1 } = {}) {
    const fast = G.turbo;
    const base = fast ? 380 : 700;
    const gap = fast ? 90 : 170;
    const jobs = [];
    G.hl.clear();
    G.ways = null;
    G.expanded.clear();
    G.holes.clear();
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
        landSound(r, grid[r]);
      }));
    }
    return Promise.all(jobs);
  }

  function landSound(r, col) {
    const a = AUDIO();
    if (!a) return;
    a.sfx('stop', r);
    if (col.includes('wanted')) a.sfx('wanted', r);
    else if (col.includes('colt')) a.sfx('cock', r);
  }

  function reelOffset(reel) {
    const t = clamp((G.clock - reel.start) / reel.dur, 0, 1);
    if (t < 0.08) return reel.dist + Math.sin((t / 0.08) * Math.PI) * 0.18;
    return reel.dist * (1 - ease.back((t - 0.08) / 0.92));
  }

  // ---------- Рисование барабанов ----------
  // Картинки клеток для SlotRig.drawCached: своя у каждой клетки поля и у каждого места ленты.
  const cellSlots = new Map();
  function slotOf(key) {
    let s = cellSlots.get(key);
    if (!s) cellSlots.set(key, (s = {}));
    return s;
  }

  // win — символ в выигрыше (играет свою анимацию), ph — фаза клетки, чтобы соседи двигались не в такт.
  function drawSymbol(ctx, s, x, y, { blur = false, scale = 1, alpha = 1, rot = 0, win = 0, ph = 0, slot = null } = {}) {
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
    if (rot) ctx.rotate(rot);
    if (scale !== 1) ctx.scale(scale, scale);
    const t = performance.now() / 1000;
    if (slot) window.SlotRig.drawCached(ctx, slot, rig, 0, 0, CELL * 0.94, t, win, ph, alpha, win ? 30 : 15);
    else window.SlotRig.draw(ctx, rig, 0, 0, CELL * 0.94, t, win, ph, alpha);
    ctx.restore();
  }

  function drawMultBadge(ctx, x, y, m, born) {
    const k = clamp((G.clock - born) / 350, 0, 1);
    const s = 0.4 + 0.6 * ease.back(k);
    ctx.save();
    ctx.translate(x + CELL * 0.3, y - CELL * 0.3);
    ctx.scale(s, s);
    ctx.beginPath();
    ctx.arc(0, 0, 19, 0, Math.PI * 2);
    const g = ctx.createRadialGradient(-5, -6, 2, 0, 0, 19);
    g.addColorStop(0, '#fff1b0');
    g.addColorStop(0.6, '#e8501f');
    g.addColorStop(1, '#7a1408');
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = 3;
    ctx.strokeStyle = INK;
    ctx.stroke();
    ctx.font = `700 17px ${NUM_FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#fff';
    ctx.fillText(`×${m}`, 0, 1);
    ctx.restore();
  }

  function drawStickyCell(ctx, c, t) {
    const x = cx(reelOf(c));
    const y = cy(rowOf(c));
    const st = G.stickyBorn?.get(c) ?? -1e9;
    ctx.save();
    const g = ctx.createRadialGradient(x, y, 8, x, y, CELL * 0.6);
    g.addColorStop(0, `rgba(255, 120, 40, ${0.35 + 0.1 * Math.sin(t / 180 + c)})`);
    g.addColorStop(1, 'rgba(255, 120, 40, 0)');
    ctx.fillStyle = g;
    ctx.fillRect(x - CELL / 2, y - CELL / 2, CELL, CELL);
    ctx.restore();
    drawSymbol(ctx, 'colt', x, y, { win: 1, ph: c * 1.7, slot: slotOf(c) });
    if (G.hole) ctx.drawImage(G.hole, x - CELL * 0.48, y - CELL * 0.5, CELL * 0.5, CELL * 0.5);
    const m = G.sticky.get(c);
    if (m > 1) drawMultBadge(ctx, x, y, m, st);
  }

  // Неподвижные слои барабанов и рамы — в картинках (SlotRig.layer), в кадре только копируются.
  const UNDER = {};
  const FRAME = {};
  const layerDpr = () => Math.min(2, window.devicePixelRatio || 1);
  function paintReelsUnder(ctx, duel) {
    for (let r = 0; r < REELS; r++) {
      const x = FR + r * CELL;
      const g = ctx.createLinearGradient(x, FR, x, FR + ROWS * CELL);
      g.addColorStop(0, duel ? 'rgba(40, 6, 8, .84)' : 'rgba(24, 12, 6, .8)');
      g.addColorStop(1, duel ? 'rgba(8, 1, 2, .95)' : 'rgba(6, 3, 2, .94)');
      if (G.texReel) {
        ctx.fillStyle = ctx.createPattern(G.texReel, 'repeat');
        ctx.fillRect(x, FR, CELL, ROWS * CELL);
      }
      ctx.fillStyle = g;
      ctx.fillRect(x, FR, CELL, ROWS * CELL);
    }
    for (let r = 1; r < REELS; r++) {
      const x = FR + r * CELL;
      ctx.fillStyle = 'rgba(0, 0, 0, .5)';
      ctx.fillRect(x - 2, FR, 4, ROWS * CELL);
      ctx.fillStyle = 'rgba(190, 150, 100, .16)';
      ctx.fillRect(x - 0.5, FR, 1, ROWS * CELL);
    }
  }
  function drawReelsBackground(ctx, t) {
    const dpr = layerDpr();
    const duel = G.mode === 'duel';
    ctx.drawImage(window.SlotRig.layer(UNDER, `${dpr}|${duel}|${!!G.texReel}`, W, H, dpr, (c) => paintReelsUnder(c, duel)), 0, 0, W, H);
    for (let r = 0; r < REELS; r++) {
      const x = FR + r * CELL;
      if (G.expanded.has(r)) {
        const wg = ctx.createLinearGradient(x, 0, x + CELL, 0);
        wg.addColorStop(0, 'rgba(255, 120, 30, 0)');
        wg.addColorStop(0.5, `rgba(255, 120, 30, ${0.35 + 0.12 * Math.sin(t / 200)})`);
        wg.addColorStop(1, 'rgba(255, 120, 30, 0)');
        ctx.fillStyle = wg;
        ctx.fillRect(x, FR, CELL, ROWS * CELL);
      }
    }
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

  // Рама: доски салуна, железные уголки, фонари.
  function drawFrame(ctx, t) {
    const dpr = layerDpr();
    ctx.drawImage(window.SlotRig.layer(FRAME, `${dpr}|${!!G.texWood}|${!!G.texIron}`, W, H, dpr, paintFrame), 0, 0, W, H);
    const x0 = FR - 12;
    const y0 = FR - 12;
    const w = REELS * CELL + 24;
    // Фонари по верхним углам: тёплый мерцающий свет.
    for (const lx of [x0 + 70, x0 + w - 70]) {
      const fl = 0.75 + 0.25 * Math.sin(t / 90 + lx) * Math.sin(t / 37 + lx);
      window.SlotRig.glowAt(ctx, lx, y0 + 4, 70, '255, 190, 80', 0.55 * fl);
      ctx.fillStyle = INK;
      ctx.fillRect(lx - 9, y0 - 8, 18, 22);
      ctx.fillStyle = `rgba(255, 210, 110, ${fl})`;
      ctx.fillRect(lx - 6, y0 - 4, 12, 15);
    }
  }

  // Рама без фонарей — неподвижный слой.
  function paintFrame(ctx) {
    const x0 = FR - 12;
    const y0 = FR - 12;
    const w = REELS * CELL + 24;
    const h = ROWS * CELL + 24;
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = INK;
    ctx.lineWidth = 26;
    roundRect(ctx, x0, y0, w, h, 12);
    ctx.stroke();
    if (G.texWood) {
      ctx.strokeStyle = ctx.createPattern(G.texWood, 'repeat');
      ctx.lineWidth = 19;
      roundRect(ctx, x0, y0, w, h, 12);
      ctx.stroke();
    }
    const g = ctx.createLinearGradient(0, y0, 0, y0 + h);
    g.addColorStop(0, 'rgba(120, 60, 24, .35)');
    g.addColorStop(0.5, 'rgba(20, 8, 2, .45)');
    g.addColorStop(1, 'rgba(90, 40, 14, .35)');
    ctx.strokeStyle = g;
    ctx.lineWidth = 19;
    roundRect(ctx, x0, y0, w, h, 12);
    ctx.stroke();
    // Волокна досок.
    ctx.strokeStyle = 'rgba(10, 4, 1, .4)';
    ctx.lineWidth = 1.2;
    for (const off of [-5, 0, 5]) {
      roundRect(ctx, x0 + off, y0 + off, w - 2 * off, h - 2 * off, 12);
      ctx.setLineDash([18 + off * 2, 9, 4, 9]);
      ctx.stroke();
    }
    ctx.setLineDash([]);
    // Железные уголки с заклёпками.
    for (const [x, y, sx, sy] of [[x0, y0, 1, 1], [x0 + w, y0, -1, 1], [x0, y0 + h, 1, -1], [x0 + w, y0 + h, -1, -1]]) {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(sx, sy);
      ctx.beginPath();
      ctx.moveTo(-12, -12);
      ctx.lineTo(42, -12);
      ctx.lineTo(42, 4);
      ctx.lineTo(4, 4);
      ctx.lineTo(4, 42);
      ctx.lineTo(-12, 42);
      ctx.closePath();
      const ig = ctx.createLinearGradient(-12, -12, 42, 42);
      ig.addColorStop(0, '#5a5550');
      ig.addColorStop(1, '#16120e');
      ctx.fillStyle = ig;
      ctx.fill();
      if (G.texIron) {
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = ctx.createPattern(G.texIron, 'repeat');
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.strokeStyle = INK;
      ctx.lineWidth = 2.5;
      ctx.stroke();
      for (const [rx, ry] of [[-4, -4], [26, -4], [-4, 26]]) {
        ctx.beginPath();
        ctx.arc(rx, ry, 3, 0, Math.PI * 2);
        ctx.fillStyle = '#8a8378';
        ctx.fill();
      }
      ctx.restore();
    }
    ctx.restore();
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
          const s = reel.strip[idx];
          if (!s) continue;
          // Итоговые клетки ленты рисуются в картинки своих клеток поля — после остановки движение не прыгает.
          const c = cellOf(r, ROWS - 1 - idx);
          const fin = idx < ROWS;
          drawSymbol(ctx, s, cx(r), FR + (k + frac) * CELL + CELL / 2, { blur, ph: fin ? c * 1.7 : idx * 1.3 + r, slot: slotOf(fin ? c : `s${r}:${idx}`) });
        }
        if (reel.anticipating) {
          const a = 0.55 + 0.35 * Math.sin(t / 90);
          const x = FR + r * CELL;
          ctx.strokeStyle = `rgba(255, 200, 90, ${a})`;
          ctx.lineWidth = 4;
          ctx.strokeRect(x + 3, FR + 3, CELL - 6, ROWS * CELL - 6);
          if (Math.random() < 0.3) spark(x + Math.random() * CELL, FR + Math.random() * ROWS * CELL, 1, '#ffd45c', 0.3);
        }
        // Липкие вайлды дуэли не крутятся.
        for (let y = 0; y < ROWS; y++) {
          const c = cellOf(r, y);
          if (!G.sticky.has(c)) continue;
          ctx.fillStyle = '#1e0807';
          ctx.fillRect(FR + r * CELL, FR + y * CELL, CELL, CELL);
          drawStickyCell(ctx, c, t);
        }
        continue;
      }
      for (let y = 0; y < ROWS; y++) {
        const c = cellOf(r, y);
        if (G.sticky.has(c)) {
          drawStickyCell(ctx, c, t);
          continue;
        }
        const s = G.grid[r][y];
        const hl = G.hl.get(c);
        let scale = 1;
        if (hl !== undefined) {
          // Выигравший символ чуть выходит вперёд и играет свою анимацию.
          scale = 1 + 0.07 * ease.back(clamp((G.clock - hl) / 260, 0, 1));
          const g = ctx.createRadialGradient(cx(r), cy(y), 10, cx(r), cy(y), CELL * 0.6);
          g.addColorStop(0, 'rgba(255, 170, 90, .3)');
          g.addColorStop(1, 'rgba(255, 210, 120, 0)');
          ctx.fillStyle = g;
          ctx.fillRect(FR + r * CELL, FR + y * CELL, CELL, CELL);
        }
        const dim = G.ways && hl === undefined ? 0.45 : 1;
        drawSymbol(ctx, s, cx(r), cy(y), { scale, alpha: dim, win: hl !== undefined ? 1 : 0, ph: c * 1.7, slot: slotOf(c) });
        if (G.holes.has(c) && G.hole) ctx.drawImage(G.hole, cx(r) - CELL * 0.48, cy(y) - CELL * 0.5, CELL * 0.5, CELL * 0.5);
      }
    }
    ctx.restore();
  }

  // Пути: «верёвки» от символа к символу по соседним барабанам.
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
              // Часть кривой до f.
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
        const text = `${NAMES[w.symbol]} · ${w.ways} ${w.ways === 1 ? 'путь' : w.ways < 5 ? 'пути' : 'путей'} · +${fmt(w.pay * G.bet0)}`;
        ctx.save();
        ctx.font = `700 16px ${NUM_FONT}`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        const tw = ctx.measureText(text).width + 18;
        const xx = clamp(x, FR + tw / 2, W - FR - tw / 2);
        roundRect(ctx, xx - tw / 2, y - 13, tw, 26, 13);
        ctx.fillStyle = 'rgba(30, 12, 4, .92)';
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
  function dust(x, y, n = 14) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const v = 30 + Math.random() * 90;
      G.fx.push({ kind: 'dust', x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v * 0.5 - 20, life: 0.9 + Math.random() * 0.6, age: 0, r: 6 + Math.random() * 10 });
    }
  }
  function muzzle(x, y, dir) {
    G.fx.push({ kind: 'flash', x, y, dir, life: 0.18, age: 0 });
    spark(x, y, 10, '#ffcf5a', 0.9);
  }
  function tracer(from, to, ms) {
    const o = { kind: 'tracer', from, to, start: G.clock, ms };
    G.fx.push(o);
    return wait(ms).then(() => { o.done = true; });
  }
  function coinShower(n) {
    for (let i = 0; i < n; i++) {
      G.fx.push({ kind: 'coin', x: Math.random() * W, y: -20 - Math.random() * H * 0.6, vx: (Math.random() - 0.5) * 60, vy: 120 + Math.random() * 160, life: 4, age: 0, spin: Math.random() * 6, r: 8 + Math.random() * 6 });
    }
  }

  function drawFx(ctx, dt) {
    for (let i = G.fx.length - 1; i >= 0; i--) {
      const p = G.fx[i];
      if (p.kind === 'tracer') {
        const k = clamp((G.clock - p.start) / p.ms, 0, 1);
        if (p.done || k >= 1) {
          G.fx.splice(i, 1);
          continue;
        }
        const x = p.from[0] + (p.to[0] - p.from[0]) * k;
        const y = p.from[1] + (p.to[1] - p.from[1]) * k;
        const bx = p.from[0] + (p.to[0] - p.from[0]) * Math.max(0, k - 0.25);
        const by = p.from[1] + (p.to[1] - p.from[1]) * Math.max(0, k - 0.25);
        ctx.save();
        const g = ctx.createLinearGradient(bx, by, x, y);
        g.addColorStop(0, 'rgba(255, 220, 120, 0)');
        g.addColorStop(1, 'rgba(255, 245, 200, 1)');
        ctx.strokeStyle = g;
        ctx.lineWidth = 4;
        ctx.lineCap = 'round';
        ctx.beginPath();
        ctx.moveTo(bx, by);
        ctx.lineTo(x, y);
        ctx.stroke();
        ctx.restore();
        continue;
      }
      p.age += dt;
      if (p.age >= p.life) {
        G.fx.splice(i, 1);
        continue;
      }
      const k = p.age / p.life;
      if (p.kind === 'flash') {
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.scale(p.dir, 1);
        const r = 40 * (1 - k * 0.5);
        const g = ctx.createRadialGradient(0, 0, 2, 0, 0, r);
        g.addColorStop(0, `rgba(255, 255, 220, ${1 - k})`);
        g.addColorStop(0.4, `rgba(255, 190, 60, ${0.9 * (1 - k)})`);
        g.addColorStop(1, 'rgba(255, 120, 20, 0)');
        ctx.fillStyle = g;
        ctx.beginPath();
        for (let j = 0; j < 8; j++) {
          const a = (j / 8) * Math.PI * 2;
          const rr = j % 2 ? r * 0.45 : r * (j === 0 ? 1.6 : 1);
          ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
        }
        ctx.closePath();
        ctx.fill();
        ctx.restore();
        continue;
      }
      if (p.kind === 'dust') {
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.vx *= 1 - dt * 1.5;
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.r * (0.6 + k), 0, Math.PI * 2);
        ctx.fillStyle = `rgba(210, 170, 120, ${0.4 * (1 - k)})`;
        ctx.fill();
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

  // Прицел шальной пули.
  function drawAim(ctx, t) {
    const a = G.aim;
    if (!a) return;
    const x = cx(reelOf(a.cell));
    const y = cy(rowOf(a.cell));
    const k = clamp((G.clock - a.at) / 380, 0, 1);
    const r = CELL * (0.7 - 0.3 * ease.out(k));
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate((1 - k) * 1.2);
    ctx.strokeStyle = `rgba(255, 60, 40, ${0.6 + 0.4 * Math.sin(t / 60)})`;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    for (let i = 0; i < 4; i++) {
      ctx.rotate(Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(r - 10, 0);
      ctx.lineTo(r + 10, 0);
      ctx.stroke();
    }
    ctx.restore();
  }

  // ---------- Сцена дуэли ----------
  // Силуэт: ковбой (слева) или шериф-скелет (справа). draw — стрелок держит револьвер, recoil — отдача.
  function gunslinger(ctx, x, y, s, side, { recoil = 0, hatOff = 0, eyes = false } = {}) {
    ctx.save();
    ctx.translate(x, y);
    ctx.scale(s * side, s);
    const body = '#120604';
    ctx.fillStyle = body;
    // Ноги, плащ, тело.
    ctx.beginPath();
    ctx.moveTo(-18, 0);
    ctx.lineTo(-12, -70);
    ctx.lineTo(-26, -76);
    ctx.lineTo(-22, -128);
    ctx.quadraticCurveTo(0, -150, 22, -128);
    ctx.lineTo(26, -76);
    ctx.lineTo(12, -70);
    ctx.lineTo(18, 0);
    ctx.lineTo(4, 0);
    ctx.lineTo(0, -54);
    ctx.lineTo(-4, 0);
    ctx.closePath();
    ctx.fill();
    // Рука с револьвером, вытянута к противнику.
    ctx.save();
    ctx.translate(16, -112);
    ctx.rotate(-0.08 - recoil * 0.5);
    ctx.fillRect(0, -6, 46, 12);
    ctx.fillRect(40, -10, 26, 9);
    ctx.fillRect(44, -2, 7, 12);
    ctx.restore();
    // Голова.
    ctx.beginPath();
    ctx.arc(0, -150, 15, 0, Math.PI * 2);
    ctx.fill();
    if (eyes) {
      ctx.fillStyle = '#ff3b1f';
      ctx.shadowColor = '#ff3b1f';
      ctx.shadowBlur = 10;
      ctx.beginPath();
      ctx.arc(4, -152, 3, 0, Math.PI * 2);
      ctx.arc(11, -152, 3, 0, Math.PI * 2);
      ctx.fill();
      ctx.shadowBlur = 0;
      ctx.fillStyle = body;
    }
    // Шляпа (может слететь).
    ctx.save();
    ctx.translate(-hatOff * 40, -164 - hatOff * 90);
    ctx.rotate(-hatOff * 3);
    ctx.beginPath();
    ctx.ellipse(0, 0, 30, 6, 0, 0, Math.PI * 2);
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(-14, 0);
    ctx.quadraticCurveTo(-14, -24, 0, -22);
    ctx.quadraticCurveTo(14, -24, 14, 0);
    ctx.fill();
    ctx.restore();
    // Контровой свет заката.
    ctx.strokeStyle = 'rgba(255, 140, 60, .55)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(-22, -128);
    ctx.quadraticCurveTo(0, -150, 22, -128);
    ctx.stroke();
    ctx.restore();
  }

  function drawScene(ctx, t) {
    const sc = G.scene;
    if (!sc) return;
    const k = clamp((G.clock - sc.start) / 300, 0, 1);
    const out = sc.fadeAt ? clamp((G.clock - sc.fadeAt) / 300, 0, 1) : 0;
    const a = k * (1 - out);
    ctx.save();
    ctx.globalAlpha = a;
    // Закатное небо поверх барабанов.
    const g = ctx.createLinearGradient(0, FR, 0, H - FR);
    g.addColorStop(0, 'rgba(40, 6, 20, .82)');
    g.addColorStop(0.6, 'rgba(140, 30, 20, .78)');
    g.addColorStop(1, 'rgba(255, 110, 40, .8)');
    ctx.fillStyle = g;
    ctx.fillRect(FR, FR, REELS * CELL, ROWS * CELL);
    const sun = ctx.createRadialGradient(W / 2, H - FR - 20, 10, W / 2, H - FR - 20, 150);
    sun.addColorStop(0, 'rgba(255, 230, 150, .95)');
    sun.addColorStop(0.35, 'rgba(255, 150, 60, .6)');
    sun.addColorStop(1, 'rgba(255, 90, 40, 0)');
    ctx.fillStyle = sun;
    ctx.fillRect(FR, FR, REELS * CELL, ROWS * CELL);
    ctx.fillStyle = '#1a0805';
    ctx.fillRect(FR, H - FR - 22, REELS * CELL, 22);
    const slide = 1 - ease.out(k);
    gunslinger(ctx, FR + 70 - slide * 120, H - FR - 8, 1, 1, { recoil: sc.recoilL || 0, hatOff: sc.hatOff || 0 });
    gunslinger(ctx, W - FR - 70 + slide * 120, H - FR - 8, 1, -1, { recoil: sc.recoilR || 0, eyes: true });
    // Перекати-поле катится между ними.
    const tw = ((G.clock - sc.start) / 2600) % 1;
    ctx.save();
    ctx.translate(FR + tw * REELS * CELL, H - FR - 34 - Math.abs(Math.sin(tw * 18)) * 14);
    ctx.rotate(tw * 20);
    ctx.strokeStyle = 'rgba(120, 70, 30, .9)';
    ctx.lineWidth = 2;
    for (let i = 0; i < 6; i++) {
      ctx.beginPath();
      ctx.arc(0, 0, 12, i, i + 2.5);
      ctx.stroke();
    }
    ctx.restore();
    // Надписи.
    if (sc.text) {
      const tk = clamp((G.clock - sc.textAt) / 220, 0, 1);
      ctx.save();
      ctx.translate(W / 2, FR + 70);
      const s = 0.6 + 0.4 * ease.back(tk);
      ctx.scale(s, s);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.font = `${sc.big ? 64 : 34}px ${TITLE_FONT}`;
      ctx.lineJoin = 'round';
      ctx.lineWidth = 9;
      ctx.strokeStyle = '#1a0503';
      ctx.strokeText(sc.text, 0, 0);
      ctx.fillStyle = sc.color || '#ffd45c';
      ctx.fillText(sc.text, 0, 0);
      if (sc.sub) {
        ctx.font = `700 20px ${NUM_FONT}`;
        ctx.lineWidth = 6;
        ctx.strokeText(sc.sub, 0, 46);
        ctx.fillStyle = '#fff';
        ctx.fillText(sc.sub, 0, 46);
      }
      ctx.restore();
    }
    ctx.restore();
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
    ctx.fillStyle = 'rgba(20, 6, 2, .6)';
    ctx.fillRect(0, H / 2 - 66, W, 132);
    ctx.translate(W / 2, H / 2);
    ctx.scale(s, s);
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${b.kind === 'small' ? 40 : 52}px ${TITLE_FONT}`;
    ctx.lineJoin = 'round';
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#2a0805';
    ctx.strokeText(b.title, 0, b.sub ? -16 : 0);
    const g = ctx.createLinearGradient(0, -40, 0, 20);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.5, '#ffc53d');
    g.addColorStop(1, '#e0500a');
    ctx.fillStyle = g;
    ctx.fillText(b.title, 0, b.sub ? -16 : 0);
    if (b.sub) {
      ctx.font = `700 22px ${NUM_FONT}`;
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
    ctx.fillStyle = `rgba(20, 6, 2, ${0.72 * clamp(k * 6, 0, 1)})`;
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
      ctx.fillStyle = 'rgba(255, 170, 70, .08)';
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
    ctx.strokeStyle = '#2a0805';
    ctx.strokeText(tier[1], 0, -46);
    const g = ctx.createLinearGradient(0, -70, 0, -20);
    g.addColorStop(0, '#fff6c8');
    g.addColorStop(0.5, '#ffc53d');
    g.addColorStop(1, '#e0500a');
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
      if (!el('saloon').hidden) window.SlotRig.frameStats('saloon', raw, performance.now() - t0);
    } catch (err) {
      if (!G.drawError) console.error('Салун: ошибка рисования', err);
      G.drawError = true;
    }
  }

  let bgDt = 0;
  let bgAt = 0;
  function renderScene(now, dt) {
    if (el('saloon').hidden) return;
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
      drawWays(ctx);
      drawAim(ctx, now);
      drawScene(ctx, now);
      drawFrame(ctx, now);
      drawFx(ctx, dt * G.speed);
      drawBanner(ctx);
      drawBigWin(ctx, now);
    } else {
      ctx.fillStyle = '#ffd9a6';
      ctx.font = `400 18px ${NUM_FONT}`;
      ctx.textAlign = 'center';
      ctx.fillText('Двери салуна скрипят…', W / 2, H / 2);
    }
    renderBar(dt);
  }

  // ---------- Фон: закат в пустыне ----------
  // Небо цвета запёкшейся крови, низкое солнце в полосах облаков, столовые горы, кладбище с покосившимися
  // крестами, мёртвое дерево с петлёй и стервятники — всё рисуется кодом.
  const CROSSES = [[0.03, 0.95, 1, -0.12], [0.11, 0.93, 0.7, 0.08], [0.2, 0.96, 0.85, -0.05], [0.82, 0.94, 0.75, 0.1], [0.9, 0.96, 1, -0.07], [0.97, 0.93, 0.6, 0.15]];
  // Неподвижная часть заката — картинкой; поверх в кадре только звёзды, петля и стервятники.
  const DUSK = {};
  const treeScale = (h) => Math.min(1.3, h / 500);
  function drawDusk(ctx, w, h, now, duel, dpr) {
    ctx.drawImage(window.SlotRig.layer(DUSK, `${w}x${h}@${dpr}|${duel}`, w, h, dpr, (c) => paintDusk(c, w, h, duel)), 0, 0, w, h);
    for (let i = 0; i < 40; i++) {
      const x = (i * 97.3) % w;
      const y = (i * 41.7) % (h * 0.35);
      ctx.fillStyle = `rgba(255, 235, 215, ${0.15 + 0.2 * Math.sin(now / 900 + i * 1.3)})`;
      ctx.fillRect(x, y, 1.4, 1.4);
    }
    // Петля качается на ветке.
    ctx.save();
    ctx.translate(w * 0.93, h * 0.94);
    ctx.scale(treeScale(h), treeScale(h));
    ctx.translate(-58, -152);
    ctx.rotate(Math.sin(now / 1700) * 0.08);
    ctx.strokeStyle = '#080302';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 46);
    ctx.stroke();
    ctx.beginPath();
    ctx.ellipse(0, 54, 6, 9, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    // Стервятники кружат.
    ctx.strokeStyle = 'rgba(8, 2, 2, .85)';
    ctx.lineWidth = 2.5;
    for (const b of BG.birds) {
      const a = now / 2600 + b.ph;
      const x = w * b.x + Math.cos(a) * b.r * 2;
      const y = h * 0.2 + Math.sin(a) * b.r * 0.6;
      const flap = Math.sin(now / 160 + b.ph) * 4;
      ctx.beginPath();
      ctx.moveTo(x - 12, y - flap);
      ctx.quadraticCurveTo(x - 6, y - 6, x, y);
      ctx.quadraticCurveTo(x + 6, y - 6, x + 12, y - flap);
      ctx.stroke();
    }
  }
  function paintDusk(ctx, w, h, duel) {
    const sky = ctx.createLinearGradient(0, 0, 0, h);
    sky.addColorStop(0, duel ? '#0a0204' : '#0e0612');
    sky.addColorStop(0.45, duel ? '#3a0610' : '#3a1214');
    sky.addColorStop(0.72, duel ? '#8a1a10' : '#8a3a18');
    sky.addColorStop(1, duel ? '#200406' : '#24100a');
    ctx.fillStyle = sky;
    ctx.fillRect(0, 0, w, h);
    // Низкое солнце в полосах облаков.
    const sx = w * 0.5;
    const sy = h * 0.74;
    const sr = Math.min(w, h) * 0.17;
    const sg = ctx.createRadialGradient(sx, sy, sr * 0.3, sx, sy, sr * 3);
    sg.addColorStop(0, duel ? 'rgba(255, 90, 40, .55)' : 'rgba(255, 170, 90, .5)');
    sg.addColorStop(0.35, duel ? 'rgba(160, 20, 10, .3)' : 'rgba(200, 80, 30, .25)');
    sg.addColorStop(1, 'rgba(120, 30, 10, 0)');
    ctx.fillStyle = sg;
    ctx.fillRect(0, 0, w, h);
    ctx.beginPath();
    ctx.arc(sx, sy, sr, 0, Math.PI * 2);
    const sun = ctx.createLinearGradient(0, sy - sr, 0, sy + sr);
    sun.addColorStop(0, duel ? '#ff6a3a' : '#ffc070');
    sun.addColorStop(1, duel ? '#8a1408' : '#d0501a');
    ctx.fillStyle = sun;
    ctx.fill();
    for (let i = 0; i < 5; i++) {
      const y = sy - sr * 0.6 + i * sr * 0.3;
      const off = Math.sin(i) * 30;
      ctx.fillStyle = duel ? 'rgba(40, 4, 8, .7)' : 'rgba(58, 18, 20, .65)';
      ctx.beginPath();
      ctx.ellipse(sx + off + (i % 2 ? -60 : 50), y, w * 0.32, sr * 0.05 + i * 1.5, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    // Столовые горы в два слоя.
    const mesa = (base, color, seed, height) => {
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, h);
      const steps = 9;
      for (let i = 0; i <= steps; i++) {
        const x = (i / steps) * w;
        const top = base - (Math.sin(i * 1.7 + seed) > 0.2 ? height : height * 0.35) - Math.sin(i * 3.1 + seed) * 8;
        ctx.lineTo(x - (w / steps) * 0.3, base);
        ctx.lineTo(x - (w / steps) * 0.2, top);
        ctx.lineTo(x + (w / steps) * 0.2, top);
        ctx.lineTo(x + (w / steps) * 0.3, base);
      }
      ctx.lineTo(w, h);
      ctx.closePath();
      ctx.fill();
    };
    mesa(h * 0.8, duel ? '#24040a' : '#2e1210', 1, h * 0.12);
    mesa(h * 0.9, duel ? '#120204' : '#180806', 4, h * 0.07);
    ctx.fillStyle = duel ? '#0a0102' : '#0e0504';
    ctx.fillRect(0, h * 0.92, w, h * 0.08);
    // Мёртвое дерево с петлёй.
    ctx.save();
    ctx.translate(w * 0.93, h * 0.94);
    ctx.scale(treeScale(h), treeScale(h));
    ctx.strokeStyle = '#080302';
    ctx.lineCap = 'round';
    const branch = (x0, y0, x1, y1, lw) => {
      ctx.lineWidth = lw;
      ctx.beginPath();
      ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo((x0 + x1) / 2 + 8, (y0 + y1) / 2, x1, y1);
      ctx.stroke();
    };
    branch(0, 0, -6, -150, 12);
    branch(-6, -110, -70, -160, 6);
    branch(-40, -140, -54, -184, 3);
    branch(-4, -140, 30, -196, 5);
    branch(-6, -150, -20, -210, 4);
    ctx.restore();
    // Кладбище: покосившиеся кресты.
    for (const [fx, fy, s, rot] of CROSSES) {
      ctx.save();
      ctx.translate(w * fx, h * fy);
      ctx.rotate(rot);
      ctx.scale(s, s);
      ctx.fillStyle = '#070202';
      ctx.fillRect(-4, -54, 8, 58);
      ctx.fillRect(-18, -42, 36, 7);
      ctx.restore();
    }
    // Кактусы-сагуаро.
    const cactus = (x, y, s) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.scale(s, s);
      ctx.fillStyle = duel ? '#070102' : '#0c0403';
      ctx.fillRect(-8, -110, 16, 110);
      ctx.beginPath();
      ctx.arc(0, -110, 8, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(-30, -70, 10, 34);
      ctx.fillRect(-30, -40, 24, 10);
      ctx.beginPath();
      ctx.arc(-25, -70, 5, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(20, -86, 10, 40);
      ctx.fillRect(6, -50, 24, 10);
      ctx.beginPath();
      ctx.arc(25, -86, 5, Math.PI, 0);
      ctx.fill();
      ctx.restore();
    };
    cactus(w * 0.07, h * 0.97, 1.1);
    cactus(w * 0.27, h * 0.93, 0.5);
    cactus(w * 0.76, h * 0.94, 0.6);
    // Вечерняя дымка у земли.
    const haze = ctx.createLinearGradient(0, h * 0.7, 0, h);
    haze.addColorStop(0, 'rgba(120, 40, 20, 0)');
    haze.addColorStop(1, duel ? 'rgba(40, 0, 0, .5)' : 'rgba(30, 8, 4, .5)');
    ctx.fillStyle = haze;
    ctx.fillRect(0, h * 0.7, w, h * 0.3);
  }
  const BG = { weeds: [], birds: Array.from({ length: 3 }, (_, i) => ({ ph: i * 2.1, r: 30 + i * 18, x: 0.2 + i * 0.3 })), motes: [] };
  function drawBackground(now, dt) {
    const box = bgCv.getBoundingClientRect();
    const w = Math.max(1, Math.round(box.width));
    const h = Math.max(1, Math.round(box.height));
    const dpr = fitCanvas(bgCv, w, h);
    const ctx = bctx;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const duel = G.mode === 'duel';
    drawDusk(ctx, w, h, now, duel, dpr);
    // Перекати-поле.
    if (BG.weeds.length < 1 && Math.random() < dt * 0.15) BG.weeds.push({ x: -40, v: 50 + Math.random() * 60, r: 10 + Math.random() * 12, ph: Math.random() * 6 });
    BG.weeds = BG.weeds.filter((t) => t.x < w + 60);
    for (const t of BG.weeds) {
      t.x += t.v * dt;
      t.ph += dt * t.v / t.r;
      const y = h * 0.95 - t.r - Math.abs(Math.sin(t.ph * 0.5)) * 18;
      ctx.save();
      ctx.translate(t.x, y);
      ctx.rotate(t.ph);
      ctx.strokeStyle = 'rgba(10, 4, 2, .85)';
      ctx.lineWidth = 1.6;
      for (let i = 0; i < 7; i++) {
        ctx.beginPath();
        ctx.arc(Math.cos(i) * 2, Math.sin(i) * 2, t.r * (0.6 + (i % 3) * 0.2), i, i + 2.6);
        ctx.stroke();
      }
      ctx.restore();
    }
    // Пыль в воздухе.
    if (BG.motes.length < 30 && Math.random() < dt * 6) BG.motes.push({ x: Math.random() * w, y: h * (0.5 + Math.random() * 0.5), v: 10 + Math.random() * 30, life: 0 });
    BG.motes = BG.motes.filter((m) => m.life < 6);
    for (const m of BG.motes) {
      m.life += dt;
      m.x += m.v * dt;
      m.y -= m.v * dt * 0.2;
      ctx.fillStyle = `rgba(255, 210, 150, ${0.35 * Math.sin((m.life / 6) * Math.PI)})`;
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
    el('sl-win').textContent = fmt(G.winShown);
    el('sl-balance').textContent = fmt(state.balance || 0);
    el('sl-bet').textContent = fmt(G.bet);
    el('sl-spin').classList.toggle('busy', G.busy);
    el('sl-auto').textContent = G.auto > 0 ? (G.auto > 1000 ? '∞' : `${G.auto}`) : 'Авто';
    el('sl-auto').classList.toggle('on', G.auto > 0);
    el('sl-turbo').classList.toggle('on', G.turbo);
  }
  const setMsg = (text) => { el('sl-msg').textContent = text; };

  function renderDuelInfo() {
    const box = el('sl-duel');
    box.hidden = !G.duel;
    if (!G.duel) return;
    const hats = el('sl-hats');
    hats.replaceChildren(...Array.from({ length: G.duel.max }, (_, i) => {
      const img = document.createElement('img');
      img.src = G.hatUrl;
      img.alt = '';
      if (i >= G.duel.lives) img.className = 'lost';
      return img;
    }));
    el('sl-duel-spins').textContent = G.duel.spins;
    el('sl-duel-wilds').textContent = G.sticky.size;
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
    G.sticky = new Map();
    G.duel = null;
    renderDuelInfo();
    setMsg(result.mode === 'spin' ? 'Удачи, ковбой!' : 'Дуэль куплена!');
    const a = AUDIO();
    a?.sfx('spin');

    const b = o.base;
    const pre = beforeEffects(b.grid, b.expanded, b.bullets);
    let maps = 0;
    let anticipate = -1;
    for (let r = 0; r < REELS - 1; r++) {
      if (pre[r].includes('wanted')) maps += 1;
      if (maps >= 2 && anticipate < 0) anticipate = r;
    }
    if (anticipate >= 0) a?.sfx('tease');
    await spinReels(pre, { anticipate });

    let won = 0;
    if (b.expanded.length) await expand(b.expanded);
    if (b.bullets) await strayBullets(b.bullets);
    if (b.wins.length) won += await showWays(b.wins);
    if (b.scatter) {
      G.grid.forEach((col, r) => col.forEach((s, y) => { if (s === 'wanted') G.hl.set(cellOf(r, y), G.clock); }));
      a?.sfx('scatter');
      won += b.scatter.pay * G.bet0;
      G.winTarget = won;
      await wait(1300);
    }
    if (o.duel) won = await playDuel(o.duel, won);

    G.winTarget = result.payout;
    G.mode = 'base';
    if (result.payout >= 15 * result.bet) await bigWin(result.payout);
    else if (result.payout > 0) {
      a?.sfx(result.payout >= 3 * result.bet ? 'winMid' : 'win');
      setMsg(`Выигрыш ${fmt(result.payout)}`);
    } else {
      setMsg('Бармен наливает ещё одну');
    }
    G.winShown = G.winTarget;
    send({ type: 'saloon_done', id: result.id });
    G.busy = false;
    G.skip = false;
    setSpeed();
    if (G.auto > 0) {
      if (o.duel && G.autoStopOnBonus) G.auto = 0;
      else {
        G.auto -= 1;
        if (G.auto > 0) setTimeout(() => { if (!G.busy && G.auto > 0) doSpin('spin'); }, G.turbo ? 250 : 600);
      }
    }
  }

  // Сервер присылает поле после пуль и раскрытых Кольтов; на барабанах показываем, что было до них.
  function beforeEffects(grid, expanded, bullets) {
    const pre = grid.map((col) => col.slice());
    for (const c of bullets || []) pre[reelOf(c)][rowOf(c)] = calmSym();
    for (const r of expanded) {
      // На раскрытом барабане выпал один Кольт: на случайной (не липкой) клетке, остальное — обычное.
      const free = [0, 1, 2].filter((y) => !G.sticky.has(cellOf(r, y)) && pre[r][y] !== 'wanted');
      const keep = free.length ? free[Math.floor(Math.random() * free.length)] : -1;
      for (const y of free) pre[r][y] = y === keep ? 'colt' : calmSym();
    }
    return pre;
  }

  // Кольт раскрывается на весь барабан: выстрел и пыль.
  async function expand(reels) {
    const a = AUDIO();
    for (const r of reels) {
      a?.sfx('gunshot');
      G.shake = 7;
      muzzle(cx(r), cy(1), 1);
      dust(cx(r), cy(2), 16);
      G.expanded.add(r);
      for (let y = 0; y < ROWS; y++) {
        await wait(90);
        if (G.grid[r][y] !== 'wanted' && !G.sticky.has(cellOf(r, y))) G.grid[r][y] = 'colt';
        G.hl.set(cellOf(r, y), G.clock);
        spark(cx(r), cy(y), 8, '#ffb347', 0.8);
      }
      await wait(350);
    }
    G.hl.clear();
  }

  // Шальные пули: прицел, выстрел, клетка становится дикой.
  async function strayBullets(cells) {
    const a = AUDIO();
    await banner('ШАЛЬНАЯ ПУЛЯ!', cells.length > 1 ? `${cells.length} выстрела по барабанам` : 'выстрел по барабану', 1200, 'small');
    for (const c of cells) {
      G.aim = { cell: c, at: G.clock };
      a?.sfx('aim');
      await wait(420);
      a?.sfx('gunshot');
      G.aim = null;
      G.shake = 9;
      muzzle(cx(reelOf(c)), cy(rowOf(c)), 1);
      dust(cx(reelOf(c)), cy(rowOf(c)), 10);
      G.grid[reelOf(c)][rowOf(c)] = 'colt';
      G.holes.add(c);
      await wait(260);
    }
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
    coinShower(60);
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

  // ---------- Дуэль на закате ----------
  async function playDuel(duel, won) {
    const a = AUDIO();
    await wait(400);
    a?.music('duel');
    G.shake = 10;
    await banner('ДУЭЛЬ НА ЗАКАТЕ', `${duel.lives} ${duel.lives === 1 ? 'шляпа' : duel.lives < 5 ? 'шляпы' : 'шляп'} — пока они на голове, стреляешь`, 2600);
    G.mode = 'duel';
    G.ways = null;
    G.hl.clear();
    G.expanded.clear();
    G.holes.clear();
    G.sticky = new Map(Object.entries(duel.start || {}).map(([c, m]) => [Number(c), m]));
    G.stickyBorn = new Map([...G.sticky.keys()].map((c) => [c, G.clock]));
    G.duel = { lives: duel.lives, max: duel.lives, spins: 0, won: 0 };
    renderDuelInfo();
    let duelWon = 0;
    for (const round of duel.rounds) {
      G.duel.spins += 1;
      renderDuelInfo();
      setMsg(`Дуэль · раунд ${G.duel.spins} · выиграно ${fmt(duelWon)}`);
      await duelRound(round);
      G.duel.lives = round.lives;
      renderDuelInfo();
      await spinReels(beforeEffects(round.grid, round.expanded, null));
      if (round.expanded.length) await expand(round.expanded);
      if (round.wins.length) duelWon += await showWays(round.wins);
      G.duel.won = duelWon;
      G.winTarget = won + duelWon;
      if (round.lives === 0) break;
      await wait(G.turbo ? 200 : 500);
    }
    won += duelWon;
    G.winTarget = won;
    a?.sfx('scatter');
    await banner('ДУЭЛЬ ОКОНЧЕНА', `шериф унёс шляпы, а ты — ${fmt(duel.pay * G.bet0)}`, 2400);
    G.mode = 'base';
    G.sticky = new Map();
    G.duel = null;
    G.ways = null;
    renderDuelInfo();
    a?.music('base');
    return won;
  }

  // Один обмен выстрелами: отсчёт, «Огонь!», твоя пуля в поле, пуля шерифа в тебя.
  async function duelRound(round) {
    const a = AUDIO();
    G.ways = null;
    G.hl.clear();
    G.scene = { start: G.clock, text: null };
    const say = (text, opts = {}) => Object.assign(G.scene, { text, textAt: G.clock, big: false, sub: '', color: null, ...opts });
    await wait(300);
    for (const n of ['3', '2', '1']) {
      say(n, { big: true });
      a?.sfx('count');
      await wait(G.turbo ? 220 : 380);
    }
    say('ОГОНЬ!', { big: true, color: '#ff6a3d' });
    a?.sfx('gunshot');
    setTimeout(() => AUDIO()?.sfx('gunshot'), 70);
    G.shake = 12;
    G.scene.recoilL = 1;
    G.scene.recoilR = 1;
    muzzle(FR + 140, H - FR - 128, 1);
    muzzle(W - FR - 140, H - FR - 128, -1);
    const shot = round.shot;
    if (shot.hit) {
      const to = [cx(reelOf(shot.cell)), cy(rowOf(shot.cell))];
      await tracer([FR + 140, H - FR - 128], to, 260);
      a?.sfx('hit');
      dust(to[0], to[1], 14);
      spark(to[0], to[1], 16, '#ffcf5a', 1.2);
      G.sticky.set(shot.cell, shot.mult);
      G.stickyBorn.set(shot.cell, G.clock);
      say(shot.upgraded ? `В ТУ ЖЕ ДЫРУ! ×${shot.mult}` : 'ПОПАЛ!', { sub: shot.upgraded ? 'множитель вайлда растёт' : 'липкий вайлд до конца дуэли', color: '#ffd45c' });
    } else {
      await wait(260);
      a?.sfx('ricochet');
      say('МИМО!', { sub: 'пуля ушла в закат', color: '#ffb3a0' });
    }
    G.scene.recoilL = 0;
    G.scene.recoilR = 0;
    renderDuelInfo();
    await wait(G.turbo ? 500 : 900);
    if (round.sheriff) {
      a?.sfx('hatOff');
      G.shake = 8;
      const start = G.clock;
      say('ШЕРИФ ПОПАЛ!', { sub: round.lives > 0 ? `слетела шляпа — осталось ${round.lives}` : 'последняя шляпа — последний раунд', color: '#ff5a4a' });
      while (G.clock - start < 700) {
        G.scene.hatOff = clamp((G.clock - start) / 700, 0, 1);
        await wait(16);
      }
    } else {
      a?.sfx('ricochet');
      say('ШЕРИФ ПРОМАХНУЛСЯ', { sub: 'шляпа на месте', color: '#9fe6a0' });
      await wait(G.turbo ? 300 : 600);
    }
    G.scene.fadeAt = G.clock;
    await wait(300);
    G.scene = null;
  }

  // ---------- Ставки и кнопки ----------
  function doSpin(mode = 'spin') {
    if (G.busy || G.awaiting) return;
    if (!G.ready) return toast('Двери салуна ещё скрипят…');
    const cost = mode === 'buy-duel' ? G.bet * BUY.duel : mode === 'buy-super' ? G.bet * BUY.super : G.bet;
    if (cost > (state.balance || 0)) {
      G.auto = 0;
      return toast(mode === 'spin' ? 'Не хватает фишек на ставку' : `Дуэль стоит ${fmt(cost)} — не хватает фишек`);
    }
    AUDIO()?.unlock();
    G.awaiting = true;
    send({ type: 'saloon_spin', bet: G.bet, mode });
  }

  function onResult(msg) {
    G.awaiting = false;
    present(msg).catch((err) => {
      console.error('Салун:', err);
      G.busy = false;
      G.mode = 'base';
      G.scene = null;
      send({ type: 'saloon_done', id: msg.id });
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

  el('sl-spin').addEventListener('click', skipOrSpin);
  // Клик по барабанам не ускоряет показ — только закрывает окно большого выигрыша.
  reelsCv.addEventListener('click', () => { if (G.bigWin && G.onSkip) G.onSkip(); });
  el('sl-bet-down').addEventListener('click', () => changeBet(-1));
  el('sl-bet-up').addEventListener('click', () => changeBet(1));
  el('sl-bet-max').addEventListener('click', () => {
    if (G.busy) return;
    const affordable = BET_STEPS.filter((x) => x <= (state.balance || 0));
    G.bet = affordable.length ? affordable[affordable.length - 1] : BET_STEPS[0];
    storage.set(BET_KEY, String(G.bet));
  });
  // Ставка долей баланса: самый крупный шаг шкалы, который не больше 1/300 (или 1/100) баланса.
  for (const [id, div] of [['sl-bet-300', 300], ['sl-bet-100', 100]]) {
    el(id).addEventListener('click', () => {
      if (G.busy) return;
      const fit = BET_STEPS.filter((x) => x <= (state.balance || 0) / div);
      G.bet = fit.length ? fit[fit.length - 1] : BET_STEPS[0];
      storage.set(BET_KEY, String(G.bet));
      AUDIO()?.sfx('click');
    });
  }
  el('sl-turbo').addEventListener('click', () => {
    G.turbo = !G.turbo;
    storage.set(TURBO_KEY, G.turbo ? '1' : '0');
    setSpeed();
  });
  el('sl-auto').addEventListener('click', () => {
    if (G.auto > 0) {
      G.auto = 0;
      return;
    }
    el('sl-auto-menu').hidden = !el('sl-auto-menu').hidden;
  });
  el('sl-auto-menu').addEventListener('click', (e) => {
    const b = e.target.closest('[data-auto]');
    if (!b) return;
    G.auto = Number(b.dataset.auto);
    G.autoStopOnBonus = el('sl-auto-stop').checked;
    el('sl-auto-menu').hidden = true;
    doSpin('spin');
  });
  el('sl-buy').addEventListener('click', () => {
    if (G.busy) return;
    el('sl-buy-duel-price').textContent = fmt(G.bet * BUY.duel);
    el('sl-buy-super-price').textContent = fmt(G.bet * BUY.super);
    el('sl-buy-modal').hidden = false;
  });
  el('sl-buy-modal').addEventListener('click', (e) => {
    if (e.target === el('sl-buy-modal') || e.target.closest('[data-close]')) el('sl-buy-modal').hidden = true;
    const b = e.target.closest('[data-buy]');
    if (!b) return;
    el('sl-buy-modal').hidden = true;
    doSpin(b.dataset.buy);
  });
  el('sl-info').addEventListener('click', () => {
    renderPaytable();
    el('sl-pay-modal').hidden = false;
  });
  el('sl-pay-modal').addEventListener('click', (e) => {
    if (e.target === el('sl-pay-modal') || e.target.closest('[data-close]')) el('sl-pay-modal').hidden = true;
  });
  el('sl-sound').addEventListener('click', () => {
    const au = AUDIO();
    if (!au) return;
    au.unlock();
    el('sl-sound').classList.toggle('off', !au.toggle());
  });
  el('sl-sound').classList.toggle('off', !(AUDIO() && AUDIO().isMusicOn()));

  function symImg(s) {
    const img = document.createElement('img');
    if (G.img[s]) img.src = G.img[s].toDataURL();
    img.className = 'painted';
    img.alt = NAMES[s];
    return img;
  }
  function renderPaytable() {
    el('sl-pays').replaceChildren(...Object.keys(PAYS).reverse().map((s) => {
      const d = document.createElement('div');
      d.className = 'kr-pay';
      const list = document.createElement('div');
      for (let i = 2; i >= 0; i--) list.append(Object.assign(document.createElement('span'), { innerHTML: `<b>${i + 3}×</b> ${fmt((PAYS[s][i] * G.bet) / UNIT)}` }));
      d.append(symImg(s), list);
      return d;
    }));
    el('sl-pay-colt').replaceChildren(symImg('colt'));
    el('sl-pay-wanted').replaceChildren(symImg('wanted'));
    el('sl-pay-bet').textContent = fmt(G.bet);
  }

  document.addEventListener('keydown', (e) => {
    if (e.code !== 'Space' || el('saloon').hidden) return;
    if (e.target.closest && e.target.closest('input, textarea, select, button')) return;
    if (!el('sl-buy-modal').hidden || !el('sl-pay-modal').hidden) return;
    e.preventDefault();
    if (!e.repeat) skipOrSpin();
  });

  function renderFeed(feed) {
    const myId = state.me && state.me.playerId;
    el('sl-feed').replaceChildren(...(feed.length ? feed.map((e) => {
      const li = document.createElement('li');
      const win = e.payout > e.cost;
      li.className = win ? 'win' : 'lose';
      if (e.playerId === myId) li.classList.add('self');
      li.append(avatarEl(e.name));
      li.append(Object.assign(document.createElement('span'), { className: 'name', textContent: e.name }));
      li.append(Object.assign(document.createElement('span'), { className: 'u-what', textContent: win ? `+${fmt(e.payout - e.cost)}` : `−${fmt(e.cost - e.payout)}` }));
      const tag = e.duel ? `🤠 дуэль · ${e.spins} раунд.` : `×${e.mult}`;
      li.append(Object.assign(document.createElement('span'), { className: 'u-ch', textContent: tag }));
      return li;
    }) : [Object.assign(document.createElement('li'), { className: 'muted', textContent: 'В салуне пока тихо' })]));
  }

  handlers.saloon_result = onResult;
  handlers.saloon_feed = (msg) => renderFeed(msg.feed);
  window.saloonOnError = onError;
  window.saloonTabShown = (on) => { AUDIO()?.setActive(on); };
  if (!el('saloon').hidden) window.saloonTabShown(true);

  renderFeed([]);
  loadArt();
  requestAnimationFrame(frame);
})();
