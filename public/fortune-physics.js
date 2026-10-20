// Физика колеса фортуны. Сектор выбирает сервер; здесь только честно просчитанное вращение:
// колесо раскручено, теряет скорость на трении, а каждый штырёк на ободе упирается в язычок
// и отнимает немного разгона. В самом конце колесу может не хватить сил перевалить через штырёк —
// тогда оно откатывается назад. Все сектора одинаковые, поэтому вращение можно сдвинуть на целое
// число секторов (незаметно, пока колесо крутится быстро), и физика останется той же:
// так колесо встаёт ровно на сектор сервера.
// Случайность берётся из номера раунда: у всех игроков одно и то же вращение.
(function (root) {
  'use strict';

  // Как на сервере (server/wheel.js), по часовой от верхней точки при повороте 0.
  const WHEEL = [60, 3, 2, 2, 3, 10, 2, 2, 3, 2, 2, 3, 2, 0, 3, 10, 2, 3, 2, 2, 3, 2, 2, 3, 2, 10, 3, 2, 0, 3,
    2, 2, 3, 2, 2, 3, 10, 2, 3, 2, 2, 3, 2, 2, 0, 3, 10, 3, 2, 2, 3, 2, 2, 3, 2, 2, 10, 3, 2, 0, 3];
  const N = WHEEL.length;
  const STEP = (2 * Math.PI) / N;
  const TAU = 2 * Math.PI;
  const DT = 1 / 240;
  const REC = 2;                  // кадр каждые два шага
  const SETTLE_SHARE = 0.9;       // в какой момент вращения колесо должно встать
  const MAX_T = 30;
  const CONTACT = 0.22 * STEP;    // насколько далеко от язычка штырёк его уже давит
  const BUMP = 0.015;             // «высота» штырька: сколько разгона нужно, чтобы через него перевалить
  const EDGE_GAP = 0.06;          // колесо не останавливается вплотную к штырьку (не спорим, какой сектор)

  // mulberry32: маленький генератор с зерном.
  function rng(seed) {
    let s = seed >>> 0;
    return () => {
      s = (s + 0x6d2b79f5) >>> 0;
      let t = s;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const mod = (x, m) => ((x % m) + m) % m;
  // Где язычок на колесе (0..1 по сектору) и какой сектор под ним при повороте th.
  const pointerPos = (th) => mod(-th, TAU) / STEP;
  const segmentAt = (th) => Math.floor(pointerPos(th)) % N;
  // Ближайший к язычку штырёк: угол от язычка (минус — штырёк ещё не дошёл при вращении по часовой).
  function pegOffset(th) {
    const p = pointerPos(th);
    const frac = p - Math.floor(p);
    // Штырьки на границах секторов. При повороте по часовой (th растёт) p убывает,
    // т. е. язычок едет к началу сектора: штырёк начала сектора приближается.
    return frac < 0.5 ? -frac * STEP : (1 - frac) * STEP;
  }

  // Сила от язычка: горка высотой BUMP на каждом штырьке (минус — тормозит вращение по часовой).
  function pegForce(th) {
    const d = pegOffset(th);
    if (Math.abs(d) >= CONTACT) return 0;
    return ((BUMP * Math.PI) / (2 * CONTACT)) * Math.sin((Math.PI * d) / CONTACT);
  }

  function run(seed, rotation, friction) {
    const rand = rng(seed);
    const p = {
      w0: 8 + 3.5 * rand(),              // начальная скорость, рад/с (по часовой)
      roll: 0.35 + 0.2 * rand(),          // сухое трение оси
      drag: 0.1 + 0.06 * rand(),          // сопротивление воздуха
      flap: 0.12 + 0.08 * rand(),         // язычок трётся о штырёк
    };
    let th = rotation;
    let w = p.w0;
    let t = 0;
    let step = 0;
    let stoppedAt = null;
    const frames = [];
    const dry = p.roll * friction;
    while (t < MAX_T) {
      const f = pegForce(th);
      if (Math.abs(w) <= 1e-3 && Math.abs(f) <= dry) {
        // Почти стоит, и горка не сдвигает: сухое трение держит колесо.
        w = 0;
      } else {
        const visc = (p.drag + (f !== 0 ? p.flap : 0)) * friction * w;
        const w1 = w + (f - visc - Math.sign(w || f) * dry) * DT;
        // Сухое трение останавливает, но не разворачивает колесо.
        w = w !== 0 && Math.sign(w1) !== Math.sign(w) && Math.abs(f) <= dry ? 0 : w1;
      }
      th += w * DT;
      t += DT;
      step += 1;
      if (step % REC === 0) frames.push(th);
      if (w === 0 && Math.abs(pegForce(th)) <= dry) {
        stoppedAt = t;
        break;
      }
    }
    if (stoppedAt === null) stoppedAt = t;
    return { frames, stoppedAt, end: th };
  }

  // Вращение под раунд: seed — номер раунда, rotation — где сейчас колесо, segment — сектор сервера,
  // spinMs — сколько длится вращение.
  // -> { frames: [поворот колеса], frameDt, scale } ; scale: секунд симуляции на секунду показа.
  function spin({ seed, rotation, segment, spinMs }) {
    const spinS = spinMs / 1000;
    let friction = 1;
    let best = null;
    for (let attempt = 0; attempt < 12; attempt++) {
      const res = run(seed + attempt * 7919, rotation, friction);
      const frac = pointerPos(res.end) % 1;
      const scale = res.stoppedAt / (SETTLE_SHARE * spinS);
      const edgeOk = frac > EDGE_GAP && frac < 1 - EDGE_GAP;
      const score = Math.abs(Math.log(scale)) + (edgeOk ? 0 : 10);
      if (!best || score < best.score) best = { ...res, scale, score };
      if (edgeOk && scale > 0.85 && scale < 1.18) break;
      if (scale < 0.6 || scale > 1.6) friction *= scale;   // долго крутилось — больше трения, и наоборот
    }
    // Сдвиг на целое число секторов, чтобы встать на сектор сервера.
    let k = mod(segmentAt(best.end) - segment, N);
    if (k > N / 2) k -= N;
    const shift = k * STEP;
    // Сдвиг вносим постепенно, пока колесо крутится быстро (первые 40% пути).
    const total = best.end - rotation;
    const frames = best.frames.map((th) => {
      const x = Math.min(1, Math.max(0, (th - rotation) / (0.4 * total)));
      return th + shift * x * x * (3 - 2 * x);
    });
    return { frames, frameDt: DT * REC, scale: best.scale };
  }

  // Куда отогнут язычок (-1..1, плюс — по часовой) при повороте th и направлении вращения dir.
  function flapTarget(th, dir) {
    const d = pegOffset(th);
    if (Math.abs(d) >= CONTACT) return 0;
    // Давит только штырёк, который едет на язычок, а не уходит от него.
    if (dir >= 0 ? d > 0 : d < 0) return 0;
    return Math.sign(dir || 1) * (1 - Math.abs(d) / CONTACT);
  }

  const api = { spin, segmentAt, pointerPos, flapTarget, WHEEL, N, STEP, SETTLE_SHARE };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.FortunePhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
