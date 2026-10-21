// Анимированные символы слотов: символ собран из деталей (как в Spine/cutout-анимации).
// Каждая деталь — свой SVG 200×200, точка вращения и функция движения от времени.
// Детали рисуются один раз в картинки нужного размера, а в кадре только двигаются —
// это дёшево и выглядит живо: моргают глаза, щёлкают челюсти, крутятся стрелки.
//
// Описание символа: {
//   parts: [{ svg, pivot: [x, y], anim(t, w, k) -> { rot, dx, dy, sx, sy, a } }],
//   fx(ctx, t, w, k) — процедурные эффекты поверх (дым, пузыри, искры), координаты 0..200,
// }
// t — секунды, w — сила выигрыша 0..1 (подсвечен ли символ), k — фаза клетки (чтобы не синхронно).
// window.SlotRig: build(def, px) -> Promise<rig>, draw(ctx, rig, x, y, size, t, w, k, alpha).
(function (root) {
  'use strict';

  function svgImage(svgText, px) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        const cv = document.createElement('canvas');
        cv.width = px;
        cv.height = px;
        const c = cv.getContext('2d');
        c.drawImage(img, 0, 0, px, px);
        resolve(trim(cv, c, px));
      };
      img.onerror = () => resolve(null);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    });
  }

  // Деталь обрезается до своих границ: глаз или гвоздь не тащит за собой пустой квадрат во всю клетку —
  // на слабой видеокарте каждый лишний прозрачный пиксель стоит времени.
  function trim(cv, c, px) {
    const d = c.getImageData(0, 0, px, px).data;
    let x0 = px;
    let y0 = px;
    let x1 = -1;
    let y1 = -1;
    for (let y = 0; y < px; y++) {
      for (let x = 0; x < px; x++) {
        if (d[(y * px + x) * 4 + 3] < 3) continue;
        if (x < x0) x0 = x;
        if (x > x1) x1 = x;
        if (y < y0) y0 = y;
        if (y > y1) y1 = y;
      }
    }
    if (x1 < 0) return null;
    x0 = Math.max(0, x0 - 1);
    y0 = Math.max(0, y0 - 1);
    const w = Math.min(px, x1 + 2) - x0;
    const h = Math.min(px, y1 + 2) - y0;
    const out = document.createElement('canvas');
    out.width = w;
    out.height = h;
    out.getContext('2d').drawImage(cv, x0, y0, w, h, 0, 0, w, h);
    const k = 200 / px;
    return { cv: out, x: x0 * k, y: y0 * k, w: w * k, h: h * k };
  }

  async function build(def, px) {
    // Деталь — либо SVG (рисуется в картинку один раз), либо draw(ctx, t, w, k) — рисуется кодом в кадре.
    const parts = await Promise.all(def.parts.map(async (p) => (p.svg ? { ...p, img: await svgImage(p.svg, px) } : p)));
    const rig = { def, parts: parts.filter((p) => p.img || p.draw), px };
    // Неподвижный кадр — для быстро крутящихся барабанов и таблицы выплат.
    const still = document.createElement('canvas');
    still.width = px;
    still.height = px;
    draw(still.getContext('2d'), rig, px / 2, px / 2, px, 0, 0, 0, 1);
    rig.still = still;
    return rig;
  }

  const NONE = { rot: 0, dx: 0, dy: 0, sx: 1, sy: 1, a: 1 };

  // Рисует символ с центром (x, y) и стороной size. noFx — без процедурных эффектов.
  function draw(ctx, rig, x, y, size, t, w = 0, k = 0, alpha = 1, noFx = false) {
    const s = size / 200;
    ctx.save();
    ctx.translate(x - size / 2, y - size / 2);
    ctx.scale(s, s);
    for (const p of rig.parts) {
      const m = p.anim ? { ...NONE, ...p.anim(t, w, k) } : NONE;
      if (m.a <= 0) continue;
      const [px, py] = p.pivot || [100, 100];
      ctx.save();
      ctx.globalAlpha = alpha * m.a;
      ctx.translate(px + m.dx, py + m.dy);
      if (m.rot) ctx.rotate(m.rot);
      if (m.sx !== 1 || m.sy !== 1) ctx.scale(m.sx, m.sy);
      ctx.translate(-px, -py);
      if (p.blend) ctx.globalCompositeOperation = p.blend;
      if (p.img) ctx.drawImage(p.img.cv, p.img.x, p.img.y, p.img.w, p.img.h);
      else p.draw(ctx, t, w, k);
      ctx.restore();
    }
    if (!noFx && rig.def.fx) {
      ctx.save();
      ctx.globalAlpha = alpha;
      rig.def.fx(ctx, t, w, k);
      ctx.restore();
    }
    ctx.restore();
  }

  // Символ на поле: рисуется в свою картинку с частотой fps, а в каждом кадре только переносится.
  // Спокойные движения медленные — 15 кадров в секунду им хватает, выигрыш обновляется чаще.
  // Клетки обновляются вразнобой (по фазе k), так что нагрузка ровная, без рывков.
  // slot — объект клетки, в котором хранится её картинка. Размер картинки — с запасом по краям:
  // щупальца и свечение выходят за клетку.
  // Кэш нужен только слабым машинам: с видеокартой прямое рисование быстрее, а картинки клеток мешают.
  // Поэтому слот сообщает время каждого кадра (frameTick), и если кадры дольше ~24 мс полторы секунды
  // подряд, включается экономный режим. Принудительно: localStorage 'casino.slots.lite' = '1' или '0'.
  const PAD = 0.12;
  const perf = { ema: 16, slow: 0, lite: false, forced: false };
  try {
    const v = root.localStorage.getItem('casino.slots.lite');
    if (v === '1' || v === '0') Object.assign(perf, { lite: v === '1', forced: true });
  } catch (e) { /* хранилище недоступно — решим по замеру */ }
  // Первые 3 секунды после показа вкладки не считаем: браузер впервые распаковывает картинки деталей.
  // Экономный режим включается, только если кадры тормозят 4 секунды подряд (короткие рывки — не повод),
  // и не навсегда: через 20 секунд, если всё идёт ровно, пробуем полную анимацию снова. Если машина
  // опять не тянет — после трёх попыток остаёмся в экономном до перезагрузки страницы.
  let lastTick = 0;
  let warm = 0;
  let liteFor = 0;
  let fast = 0;
  let tries = 0;
  function frameTick(dt) {
    const now = performance.now();
    if (now - lastTick > 250) warm = 0;
    lastTick = now;
    if (perf.forced || !(dt > 0) || dt > 250) return;
    warm += dt;
    if (warm < 3000) return;
    perf.ema += (dt - perf.ema) * 0.05;
    if (!perf.lite) {
      perf.slow = perf.ema > 26 ? perf.slow + dt : 0;
      if (perf.slow > 4000) {
        perf.lite = true;
        tries += 1;
        liteFor = 0;
        fast = 0;
      }
      return;
    }
    liteFor += dt;
    fast = perf.ema < 15 ? fast + dt : 0;
    if (tries < 3 && liteFor > 20_000 && fast > 10_000) {
      perf.lite = false;
      perf.slow = 0;
      perf.ema = 16;
    }
  }
  // Статистика кадров слота: раз в 10 секунд уходит на сервер (slot_perf), чтобы видеть лаги
  // на настоящих машинах игроков, а не гадать. dt — между кадрами, ms — сколько рисовали сами.
  const stats = { game: '', dts: [], ms: [], long: 0, longN: 0 };
  let gpu = null;
  function gpuName() {
    if (gpu !== null) return gpu;
    try {
      const gl = document.createElement('canvas').getContext('webgl');
      const ext = gl && gl.getExtension('WEBGL_debug_renderer_info');
      gpu = gl ? String(gl.getParameter(ext ? ext.UNMASKED_RENDERER_WEBGL : gl.RENDERER)).slice(0, 120) : 'no webgl';
    } catch (e) {
      gpu = 'unknown';
    }
    return gpu;
  }
  try {
    new PerformanceObserver((list) => {
      if (!stats.game) return;
      for (const e of list.getEntries()) {
        stats.long += e.duration;
        stats.longN += 1;
      }
    }).observe({ type: 'longtask', buffered: false });
  } catch (e) { /* браузер не умеет — обойдёмся */ }
  function frameStats(game, dt, ms) {
    if (!(dt > 0) || dt > 1000) return;
    stats.game = game;
    stats.dts.push(dt);
    stats.ms.push(ms);
  }
  const pct = (a, p) => a[Math.min(a.length - 1, Math.floor(a.length * p))];
  setInterval(() => {
    const n = stats.dts.length;
    if (n < 30 || typeof root.send !== 'function') {
      Object.assign(stats, { game: '', dts: [], ms: [], long: 0, longN: 0 });
      return;
    }
    const d = stats.dts.slice().sort((a, b) => a - b);
    const m = stats.ms.slice().sort((a, b) => a - b);
    const sum = d.reduce((s, x) => s + x, 0);
    root.send({
      type: 'slot_perf',
      game: stats.game,
      fps: Math.round((n / sum) * 1000),
      dt50: Math.round(pct(d, 0.5)),
      dt95: Math.round(pct(d, 0.95)),
      dtMax: Math.round(d[n - 1]),
      slow: d.filter((x) => x > 34).length,
      frames: n,
      ms50: +pct(m, 0.5).toFixed(1),
      ms95: +pct(m, 0.95).toFixed(1),
      long: Math.round(stats.long),
      longN: stats.longN,
      lite: perf.lite,
      dpr: root.devicePixelRatio || 1,
      gpu: gpuName(),
      ua: navigator.userAgent.slice(0, 160),
    });
    Object.assign(stats, { game: '', dts: [], ms: [], long: 0, longN: 0 });
  }, 10000);

  function drawCached(ctx, slot, rig, x, y, size, t, w = 0, k = 0, alpha = 1, fps = 15) {
    if (!perf.lite) {
      draw(ctx, rig, x, y, size, t, w, k, alpha);
      return;
    }
    fps = Math.min(fps, w ? 24 : 10);
    const dpr = Math.min(2, root.devicePixelRatio || 1);
    const full = size * (1 + 2 * PAD);
    const px = Math.round(full * dpr);
    let cv = slot.cv;
    if (!cv || cv.width !== px) {
      cv = slot.cv = document.createElement('canvas');
      cv.width = px;
      cv.height = px;
      slot.frame = null;
    }
    const frame = Math.floor(t * fps + ((k * 0.618) % 1));
    if (slot.rig !== rig || slot.w !== w || slot.frame !== frame) {
      const c = cv.getContext('2d');
      c.setTransform(1, 0, 0, 1, 0, 0);
      c.clearRect(0, 0, px, px);
      draw(c, rig, px / 2, px / 2, px / (1 + 2 * PAD), t, w, k, 1);
      slot.rig = rig;
      slot.w = w;
      slot.frame = frame;
    }
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * alpha;
    ctx.drawImage(cv, x - full / 2, y - full / 2, full, full);
    ctx.globalAlpha = prev;
  }

  // Неподвижный слой сцены (небо, горы, подложка барабанов, рама): рисуется один раз в картинку,
  // пока не сменится key (размер, режим), и дальше только копируется. Без видеоускорения перерисовка
  // всего фона каждый кадр стоила десятки миллисекунд. store — объект, где слой живёт.
  function layer(store, key, w, h, dpr, paint) {
    if (store.key !== key || !store.cv) {
      const cv = store.cv || document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      paint(c);
      store.cv = cv;
      store.key = key;
    }
    return store.cv;
  }

  // Помощники для движений.
  const wave = (t, f, ph = 0) => Math.sin(t * f * Math.PI * 2 + ph);
  // Короткий «рывок» раз в период: 0 почти всегда, 1 на мгновение (моргание, щелчок).
  const blip = (t, period, len, ph = 0) => {
    const u = ((t + ph) % period) / period;
    const d = len / period;
    return u < d ? Math.sin((u / d) * Math.PI) : 0;
  };
  const ease = (x) => x * x * (3 - 2 * x);

  // Круглое пятно света нужного цвета рисуется один раз и дальше только штампуется:
  // новый градиент в каждом кадре на каждой клетке — главный пожиратель времени.
  const sprites = new Map();
  function sprite(color) {
    let cv = sprites.get(color);
    if (!cv) {
      cv = document.createElement('canvas');
      cv.width = 64;
      cv.height = 64;
      const c = cv.getContext('2d');
      const g = c.createRadialGradient(32, 32, 0, 32, 32, 32);
      g.addColorStop(0, `rgba(${color}, 1)`);
      g.addColorStop(1, `rgba(${color}, 0)`);
      c.fillStyle = g;
      c.fillRect(0, 0, 64, 64);
      sprites.set(color, cv);
    }
    return cv;
  }
  function stamp(ctx, x, y, r, color, a) {
    if (a <= 0 || r <= 0) return;
    const prev = ctx.globalAlpha;
    ctx.globalAlpha = prev * Math.min(1, a);
    ctx.drawImage(sprite(color), x - r, y - r, r * 2, r * 2);
    ctx.globalAlpha = prev;
  }

  // Дымок: несколько полупрозрачных клубов, поднимающихся из точки.
  function smoke(ctx, t, x, y, { n = 5, rise = 70, drift = 18, size = 9, color = '200, 190, 180', a = 0.35, speed = 0.35 } = {}) {
    for (let i = 0; i < n; i++) {
      const u = (t * speed + i / n) % 1;
      stamp(ctx, x + Math.sin(u * 5 + i) * drift * u, y - u * rise, size * (0.6 + u * 1.6), color, a * (1 - u));
    }
  }
  // Свечение в точке (глаза, приманка, угли).
  function glowAt(ctx, x, y, r, color, a) {
    stamp(ctx, x, y, r, color.replace(/\s+/g, ' '), a);
  }
  // Пузырьки, поднимающиеся вверх.
  function bubbles(ctx, t, x, y, { n = 4, rise = 80, spread = 30, a = 0.5 } = {}) {
    ctx.strokeStyle = `rgba(190, 240, 235, ${a})`;
    ctx.lineWidth = 1.2;
    for (let i = 0; i < n; i++) {
      const u = (t * 0.4 + i / n) % 1;
      const xx = x + Math.sin(u * 7 + i * 2) * spread * 0.3 + (i - n / 2) * (spread / n);
      const yy = y - u * rise;
      ctx.globalAlpha = 1 - u;
      ctx.beginPath();
      ctx.arc(xx, yy, 1.5 + (i % 3), 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
  // Блик, пробегающий по символу при выигрыше (полоса света).
  function sweep(ctx, t, w, { color = '255, 240, 200', a = 0.35 } = {}) {
    if (w <= 0) return;
    const u = (t * 0.8) % 1.6 - 0.3;
    const x = u * 260 - 30;
    ctx.save();
    ctx.beginPath();
    ctx.arc(100, 100, 84, 0, Math.PI * 2);
    ctx.clip();
    ctx.globalCompositeOperation = 'lighter';
    const g = ctx.createLinearGradient(x - 30, 0, x + 30, 0);
    g.addColorStop(0, `rgba(${color}, 0)`);
    g.addColorStop(0.5, `rgba(${color}, ${a * w})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = g;
    ctx.translate(100, 100);
    ctx.rotate(-0.5);
    ctx.translate(-100, -100);
    ctx.fillRect(x - 30, -60, 60, 320);
    ctx.restore();
  }

  function catmull(pts, u) {
    const n = pts.length - 1;
    const f = u * n;
    const i = Math.min(n - 1, Math.floor(f));
    const q = f - i;
    const p0 = pts[Math.max(0, i - 1)];
    const p1 = pts[i];
    const p2 = pts[i + 1];
    const p3 = pts[Math.min(n, i + 2)];
    const c = (a, b, cc, d) => 0.5 * (2 * b + (-a + cc) * q + (2 * a - 5 * b + 4 * cc - d) * q * q + (-a + 3 * b - 3 * cc + d) * q * q * q);
    return [c(p0[0], p1[0], p2[0], p3[0]), c(p0[1], p1[1], p2[1], p3[1])];
  }
  // opts: { colors: [тёмный, средний, светлый], sucker, ink, suckerSide: 1 | -1, line }
  function tentacle(ctx, pts, w0, w1, opts = {}) {
    const { colors = ['#2a0612', '#6e1426', '#a8434f'], sucker = '#b9a08f', ink = '#05080a', suckerSide = 1, line = 3 } = opts;
    const N = 22;
    const spine = [];
    for (let i = 0; i <= N; i++) spine.push(catmull(pts, i / N));
    const L = [];
    const R = [];
    for (let i = 0; i <= N; i++) {
      const a = spine[Math.max(0, i - 1)];
      const b = spine[Math.min(N, i + 1)];
      let nx = -(b[1] - a[1]);
      let ny = b[0] - a[0];
      const l = Math.hypot(nx, ny) || 1;
      nx /= l;
      ny /= l;
      const hw = (w0 + (w1 - w0) * (i / N) ** 0.9) / 2;
      L.push([spine[i][0] + nx * hw, spine[i][1] + ny * hw]);
      R.push([spine[i][0] - nx * hw, spine[i][1] - ny * hw]);
    }
    const tip = spine[N];
    ctx.beginPath();
    ctx.moveTo(L[0][0], L[0][1]);
    for (const p of L) ctx.lineTo(p[0], p[1]);
    ctx.arc(tip[0], tip[1], Math.max(0.5, w1 / 2), 0, Math.PI * 2);
    for (let i = N; i >= 0; i--) ctx.lineTo(R[i][0], R[i][1]);
    ctx.closePath();
    const g = ctx.createLinearGradient(pts[0][0], pts[0][1], tip[0], tip[1]);
    g.addColorStop(0, colors[0]);
    g.addColorStop(0.55, colors[1]);
    g.addColorStop(1, colors[2]);
    ctx.fillStyle = g;
    ctx.fill();
    ctx.lineWidth = line;
    ctx.lineJoin = 'round';
    ctx.strokeStyle = ink;
    ctx.stroke();
    // Тень по нижнему краю и блик по верхнему — объём.
    const edge = (arr, k2, style, width) => {
      ctx.beginPath();
      for (let i = 2; i < N - 3; i++) {
        const p = arr[i];
        const q = spine[i];
        const x = q[0] + (p[0] - q[0]) * k2;
        const y = q[1] + (p[1] - q[1]) * k2;
        if (i === 2) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = style;
      ctx.lineWidth = width;
      ctx.stroke();
    };
    edge(suckerSide > 0 ? L : R, 0.55, 'rgba(255, 220, 220, .18)', 2);
    // Присоски.
    const side = suckerSide > 0 ? R : L;
    for (let i = 3; i < N - 2; i += 2) {
      const p = side[i];
      const q = spine[i];
      const x = q[0] + (p[0] - q[0]) * 0.6;
      const y = q[1] + (p[1] - q[1]) * 0.6;
      const r = Math.max(1, ((w0 + (w1 - w0) * (i / N)) / 2) * 0.32);
      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = sucker;
      ctx.fill();
      ctx.lineWidth = 1;
      ctx.strokeStyle = 'rgba(5, 8, 10, .7)';
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(x, y, r * 0.45, 0, Math.PI * 2);
      ctx.fillStyle = 'rgba(40, 10, 16, .7)';
      ctx.fill();
    }
  }

  root.SlotRig = { build, draw, drawCached, layer, frameTick, frameStats, perf, wave, blip, ease, smoke, glowAt, bubbles, sweep, tentacle, catmull };
})(window);
