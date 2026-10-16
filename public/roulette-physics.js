// Физика шарика рулетки. Номер выбирает сервер; здесь только случайный, но честно просчитанный
// бросок: шарик бежит по дорожке, теряет скорость, скатывается, бьётся об отбойники и перегородки.
// Все карманы одинаковые, поэтому траекторию можно повернуть на целое число карманов, и физика
// не изменится: так шарик ложится ровно в выпавший номер.
// Случайность берётся из номера раунда: у всех игроков один и тот же бросок.
(function (root) {
  'use strict';

  const N = 37;
  const STEP = (2 * Math.PI) / N;
  const HALF_PI = Math.PI / 2;
  const R_TRACK = 126;     // дорожка на чаше
  const R_DISK = 116;      // край вращающегося диска
  const R_WELL = 96;       // начало карманов
  const R_POCKET = 88;     // шарик на дне кармана
  const FRET_TOP = R_WELL + 2;  // выше этого шарик перелетает перегородки
  const DIAMOND = Math.PI / 4;  // восемь отбойников в чаше
  const DT = 1 / 240;
  const REC = 2;                // кадр каждые два шага
  const SETTLE_SHARE = 0.86;    // в какой момент вращения шарик должен лечь в карман
  const MAX_T = 16;

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

  // Карман (индекс в порядке колеса), в котором находится угол d в системе колеса.
  const rawSlot = (d) => Math.floor((d + HALF_PI + STEP / 2) / STEP);
  const slotIndex = (d) => ((rawSlot(d) % N) + N) % N;

  // Один бросок. friction — множитель трения, им подгоняем длительность под время раунда.
  function run(seed, rotation, friction, stopShare) {
    const rand = rng(seed);
    const p = {
      w0: -(15 + 6 * rand()),                 // шарик против часовой
      ww0: 1.8 + 1.4 * rand(),                // колесо по часовой
      a0: 2 * Math.PI * rand(),
      g: 3300 * (0.9 + 0.2 * rand()),         // наклон чаши
      diamondChance: 0.3 + 0.3 * rand(),
    };
    let a = p.a0;
    let w = p.w0;
    let r = R_TRACK;
    let vr = 0;
    let th = rotation;
    let ww = p.ww0;
    let phase = 'track';
    let settledAt = null;
    let settleSlot = 0;
    let dSettled = 0;            // угол шарика в системе колеса, когда он в кармане
    let stopAt = MAX_T;
    const frames = [];
    const clicks = [];
    let t = 0;
    let step = 0;

    while (t < stopAt) {
      ww -= ww * 0.035 * DT;
      th += ww * DT;

      if (phase === 'track') {
        // Катится по дорожке, прижатый центробежной силой; трение воздуха и дорожки.
        const sp = -w;
        w = -(sp - (1 + 0.32 * sp) * friction * DT);
        a += w * DT;
        if (w * w * R_TRACK < p.g) phase = 'free';
      } else if (phase === 'free') {
        const prevD = a - th;
        if (r > R_DISK) {
          // Чаша: скатывается по спирали, по дороге может зацепить отбойник.
          const sp = -w;
          w = -(sp - (0.5 + 0.08 * sp) * friction * DT);
          vr += (w * w * r - p.g) * 0.06 * DT;
          const before = Math.floor(a / DIAMOND);
          a += w * DT;
          if (Math.floor(a / DIAMOND) !== before && rand() < p.diamondChance) {
            vr = Math.abs(vr) * 0.4 + 25 + 70 * rand();
            w *= 0.55 + 0.35 * rand();
          }
        } else {
          // На диске: трение тянет шарик вместе с колесом.
          let rel = w - ww;
          rel -= rel * (r > R_WELL ? 0.6 : 1.6) * DT;
          w = ww + rel;
          vr += (w * w * r - p.g) * (r > R_WELL ? 0.3 : 0.2) * DT;
          a += w * DT;
          // Перегородка между карманами: отскок назад и вверх.
          const s0 = rawSlot(prevD);
          const s1 = rawSlot(a - th);
          if (r < FRET_TOP && s1 !== s0) {
            const edge = (s1 > s0 ? s0 + 1 : s0) * STEP - HALF_PI - STEP / 2;
            a = th + edge + (s1 > s0 ? -1e-4 : 1e-4);
            const hit = w - ww;
            w = ww - hit * (0.45 + 0.3 * rand());
            vr += Math.abs(hit) * r * (0.25 + 0.35 * rand());
            clicks.push(t);
          }
        }
        r += vr * DT;
        if (r > R_TRACK) {
          r = R_TRACK;
          vr = -Math.abs(vr) * 0.3;
        }
        if (r < R_POCKET) {
          r = R_POCKET;
          vr = Math.abs(vr) * 0.35;
          if (vr < 6) vr = 0;
        }
        const calm = r <= R_POCKET + 0.5 && vr < 20 && Math.abs(w - ww) < 0.2;
        if (calm || (t > MAX_T - 3 && r < FRET_TOP)) {
          phase = 'settled';
          settledAt = t;
          settleSlot = rawSlot(a - th);
          dSettled = a - th;
          stopAt = Math.min(MAX_T, t / stopShare);
        }
      } else {
        // В кармане: доезжает до середины и крутится вместе с колесом.
        const center = settleSlot * STEP - HALF_PI;
        dSettled += (center - dSettled) * 6 * DT;
        a = th + dSettled;
        r = R_POCKET;
      }

      t += DT;
      step += 1;
      if (step % REC === 0) frames.push([a, r, th]);
    }
    if (settledAt === null) {
      settledAt = t;
      settleSlot = rawSlot(a - th);
    }
    return { frames, clicks, settledAt, slot: ((settleSlot % N) + N) % N, wheelSpeed: ww, duration: t };
  }

  // Бросок под раунд: seed — номер раунда, rotation — где сейчас колесо, slot — индекс выпавшего
  // номера в порядке колеса, spinMs — сколько длится вращение.
  // -> { frames: [[угол шарика, радиус, поворот колеса]], frameDt, scale, clicks, wheelSpeed }
  // scale: сколько секунд симуляции приходится на секунду показа.
  function spin({ seed, rotation, slot, spinMs }) {
    const spinS = spinMs / 1000;
    let friction = 1;
    let best = null;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = run(seed + attempt * 7919, rotation, friction, SETTLE_SHARE);
      const scale = res.settledAt / (SETTLE_SHARE * spinS);
      if (!best || Math.abs(Math.log(scale)) < Math.abs(Math.log(best.scale))) best = { ...res, scale };
      if (scale > 0.85 && scale < 1.18) break;
      friction *= scale;     // долго катился — больше трения, и наоборот
    }
    // Поворачиваем бросок на целое число карманов, чтобы шарик лёг в нужный номер.
    const shift = (((slot - best.slot) % N) + N) % N * STEP;
    return {
      frames: best.frames.map(([a, r, th]) => [a + shift, r, th]),
      frameDt: DT * REC,
      scale: best.scale,
      clicks: best.clicks,
      wheelSpeed: best.wheelSpeed,
    };
  }

  const api = { spin, slotIndex, STEP, R_POCKET, R_TRACK };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.RoulettePhysics = api;
})(typeof window !== 'undefined' ? window : globalThis);
