// Физика пула: общий код для сервера (результат удара) и браузера (анимация того же удара).
// Только + - * / и sqrt, фиксированный шаг и порядок: в Node и в браузерах результат совпадает.
(function (root) {
  'use strict';

  const W = 1000;              // игровое поле (внутри бортов)
  const H = 500;
  const R = 11;                // радиус шара
  const HEAD_X = 250;          // линия дома: отсюда разбивают
  const FOOT = { x: 750, y: 250 };
  const POCKETS = [
    { x: 0, y: 0, r: 26 }, { x: W / 2, y: -6, r: 22 }, { x: W, y: 0, r: 26 },
    { x: 0, y: H, r: 26 }, { x: W / 2, y: H + 6, r: 22 }, { x: W, y: H, r: 26 },
  ];
  const DT = 1 / 240;
  // Шар после удара сначала скользит по сукну (сильное трение), потом катится (слабое).
  // u — скорость, которую дало бы шару его вращение; пока v != u, шар проскальзывает.
  const SLIDE_DEC = 480;       // трение скольжения, ед/с²
  const ROLL_DEC = 30;         // сопротивление качению, ед/с²
  const ROLL_DRAG = 0.24;      // плюс торможение сукна, пропорциональное скорости, 1/с
  const BALL_E = 0.95;         // упругость шар-шар
  const RAIL_E = 0.78;         // упругость борта
  const RAIL_GRIP = 0.94;      // борт гасит скорость вдоль себя
  const RAIL_SPIN = 0.4;       // какая часть вращения остаётся после борта
  const SPIN_MAX = 1.25;       // винт ±1 → вращение ±1.25 скорости удара (удар на полрадиуса от центра)
  const STOP_SPEED = 3;
  const MAX_SPEED = 1800;
  const MAX_TIME = 30;

  // Позиции пирамиды: 5 рядов от вершины на точке FOOT вправо. Индекс 4 — центр, туда ставят восьмёрку.
  function rackSpots() {
    const spots = [];
    const dx = 2 * R * 0.8661 + 0.1;
    for (let row = 0; row < 5; row++) {
      for (let k = 0; k <= row; k++) {
        spots.push({ x: FOOT.x + row * dx, y: FOOT.y + (k - row / 2) * (2 * R + 0.2) });
      }
    }
    return spots;
  }

  // order: 15 номеров шаров по позициям пирамиды. Биток на точке дома.
  function rack(order) {
    const spots = rackSpots();
    const balls = [{ id: 0, x: HEAD_X - 60, y: H / 2, in: false }];
    order.forEach((id, i) => balls.push({ id, x: spots[i].x, y: spots[i].y, in: false }));
    return balls;
  }

  // Удар: balls — расстановка до удара, vel — скорость битка, spin — винт от -1 (оттяжка) до 1 (накат).
  // -> { balls (итог), events: { firstHit, pocketed: [номера по порядку] }, frames, duration }
  // frames (если record): положения каждые frameEvery шагов, [x, y] или null для забитого.
  function simulate(balls, vel, { record = false, frameEvery = 4, spin = 0 } = {}) {
    const b = balls.map((o) => ({ id: o.id, x: o.x, y: o.y, vx: 0, vy: 0, ux: 0, uy: 0, in: !!o.in }));
    const cue = b.find((o) => o.id === 0);
    const sp = spin > 1 ? 1 : spin < -1 ? -1 : spin || 0;
    cue.vx = vel.x;
    cue.vy = vel.y;
    cue.ux = vel.x * sp * SPIN_MAX;
    cue.uy = vel.y * sp * SPIN_MAX;
    const events = { firstHit: null, pocketed: [] };
    const frames = record ? [] : null;
    const snap = () => frames.push(b.map((o) => (o.in ? null : [o.x, o.y])));
    if (record) snap();

    const slideStep = SLIDE_DEC * DT;
    let t = 0;
    let step = 0;
    while (t < MAX_TIME) {
      let moving = false;

      // Трение о сукно: скольжение или качение.
      for (const o of b) {
        if (o.in) continue;
        const sx = o.vx - o.ux;
        const sy = o.vy - o.uy;
        const slip = Math.sqrt(sx * sx + sy * sy);
        if (slip > 0.5) {
          // Трение тормозит центр и раскручивает шар, пока точка касания не перестанет скользить.
          if (slip <= 3.5 * slideStep) {
            o.vx -= sx / 3.5;
            o.vy -= sy / 3.5;
            o.ux = o.vx;
            o.uy = o.vy;
          } else {
            const k = slideStep / slip;
            o.vx -= sx * k;
            o.vy -= sy * k;
            o.ux += 2.5 * sx * k;
            o.uy += 2.5 * sy * k;
          }
        } else {
          const speed = Math.sqrt(o.vx * o.vx + o.vy * o.vy);
          if (speed === 0) continue;
          const dec = (ROLL_DEC + ROLL_DRAG * speed) * DT;
          if (speed <= dec || speed < STOP_SPEED) {
            o.vx = 0;
            o.vy = 0;
            o.ux = 0;
            o.uy = 0;
            continue;
          }
          const k = (speed - dec) / speed;
          o.vx *= k;
          o.vy *= k;
          o.ux = o.vx;
          o.uy = o.vy;
        }
        o.x += o.vx * DT;
        o.y += o.vy * DT;
        moving = true;
      }

      // Лузы.
      for (const o of b) {
        if (o.in) continue;
        for (const p of POCKETS) {
          const dx = o.x - p.x;
          const dy = o.y - p.y;
          if (dx * dx + dy * dy < p.r * p.r) {
            o.in = true;
            o.vx = 0;
            o.vy = 0;
            o.ux = 0;
            o.uy = 0;
            events.pocketed.push(o.id);
            break;
          }
        }
      }

      // Борта: отскок, потеря скорости вдоль борта и большей части вращения.
      for (const o of b) {
        if (o.in) continue;
        if ((o.x < R && o.vx < 0) || (o.x > W - R && o.vx > 0)) {
          o.vx = -o.vx * RAIL_E;
          o.vy *= RAIL_GRIP;
          o.ux = -o.ux * RAIL_SPIN;
          o.uy *= RAIL_GRIP;
        }
        if ((o.y < R && o.vy < 0) || (o.y > H - R && o.vy > 0)) {
          o.vy = -o.vy * RAIL_E;
          o.vx *= RAIL_GRIP;
          o.uy = -o.uy * RAIL_SPIN;
          o.ux *= RAIL_GRIP;
        }
        if (o.x < R) o.x = R;
        if (o.x > W - R) o.x = W - R;
        if (o.y < R) o.y = R;
        if (o.y > H - R) o.y = H - R;
      }

      // Столкновения шаров: скорости обмениваются по линии центров, вращение остаётся у каждого своё.
      for (let i = 0; i < b.length; i++) {
        const p = b[i];
        if (p.in) continue;
        for (let j = i + 1; j < b.length; j++) {
          const q = b[j];
          if (q.in) continue;
          const dx = q.x - p.x;
          const dy = q.y - p.y;
          const d2 = dx * dx + dy * dy;
          if (d2 >= 4 * R * R || d2 === 0) continue;
          const d = Math.sqrt(d2);
          const nx = dx / d;
          const ny = dy / d;
          const rv = (q.vx - p.vx) * nx + (q.vy - p.vy) * ny;
          if (rv < 0) {
            const imp = (-(1 + BALL_E) * rv) / 2;
            p.vx -= imp * nx;
            p.vy -= imp * ny;
            q.vx += imp * nx;
            q.vy += imp * ny;
            if (events.firstHit === null && (p.id === 0 || q.id === 0)) events.firstHit = p.id === 0 ? q.id : p.id;
          }
          const push = (2 * R - d) / 2;
          p.x -= nx * push;
          p.y -= ny * push;
          q.x += nx * push;
          q.y += ny * push;
        }
      }

      t += DT;
      step += 1;
      if (record && step % frameEvery === 0) snap();
      if (!moving) break;
    }
    if (record) snap();

    const round = (v) => Math.round(v * 100) / 100;
    return {
      balls: b.map((o) => ({ id: o.id, x: round(o.x), y: round(o.y), in: o.in })),
      events,
      frames,
      frameDt: DT * frameEvery,
      duration: t,
    };
  }

  // Можно ли поставить биток сюда (шар с руки): внутри стола, не на другом шаре, не в лузе.
  function canPlaceCue(balls, x, y, kitchen) {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return false;
    if (x < R || x > W - R || y < R || y > H - R) return false;
    if (kitchen && x > HEAD_X) return false;
    for (const p of POCKETS) {
      const dx = x - p.x;
      const dy = y - p.y;
      if (dx * dx + dy * dy < (p.r + R) * (p.r + R)) return false;
    }
    return balls.every((o) => o.in || o.id === 0 || (o.x - x) * (o.x - x) + (o.y - y) * (o.y - y) >= 4 * R * R);
  }

  const api = {
    W, H, R, HEAD_X, FOOT, POCKETS, MAX_SPEED, rack, rackSpots, simulate, canPlaceCue,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.PoolPhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
