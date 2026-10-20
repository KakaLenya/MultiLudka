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
        cv.getContext('2d').drawImage(img, 0, 0, px, px);
        resolve(cv);
      };
      img.onerror = () => resolve(null);
      img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svgText)}`;
    });
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
      if (p.img) ctx.drawImage(p.img, 0, 0, 200, 200);
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

  // Помощники для движений.
  const wave = (t, f, ph = 0) => Math.sin(t * f * Math.PI * 2 + ph);
  // Короткий «рывок» раз в период: 0 почти всегда, 1 на мгновение (моргание, щелчок).
  const blip = (t, period, len, ph = 0) => {
    const u = ((t + ph) % period) / period;
    const d = len / period;
    return u < d ? Math.sin((u / d) * Math.PI) : 0;
  };
  const ease = (x) => x * x * (3 - 2 * x);

  // Дымок: несколько полупрозрачных клубов, поднимающихся из точки.
  function smoke(ctx, t, x, y, { n = 5, rise = 70, drift = 18, size = 9, color = '200, 190, 180', a = 0.35, speed = 0.35 } = {}) {
    for (let i = 0; i < n; i++) {
      const u = (t * speed + i / n) % 1;
      const yy = y - u * rise;
      const xx = x + Math.sin(u * 5 + i) * drift * u;
      const r = size * (0.6 + u * 1.6);
      const g = ctx.createRadialGradient(xx, yy, 0, xx, yy, r);
      g.addColorStop(0, `rgba(${color}, ${a * (1 - u)})`);
      g.addColorStop(1, `rgba(${color}, 0)`);
      ctx.fillStyle = g;
      ctx.beginPath();
      ctx.arc(xx, yy, r, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  // Свечение в точке (глаза, приманка, угли).
  function glowAt(ctx, x, y, r, color, a) {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, `rgba(${color}, ${a})`);
    g.addColorStop(1, `rgba(${color}, 0)`);
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
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
    const N = 40;
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
    for (let i = 3; i < N - 3; i += 3) {
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

  root.SlotRig = { build, draw, wave, blip, ease, smoke, glowAt, bubbles, sweep, tentacle, catmull };
})(window);
