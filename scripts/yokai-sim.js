// Подбор математики «Ночного парада»: прогоняет миллионы спинов и показывает, откуда берётся отдача.
// node scripts/yokai-sim.js [спинов] [зерно]
const Y = require('../server/yokai-math');

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

const N = Number(process.argv[2]) || 1_000_000;
const rand = rng(Number(process.argv[3]) || 12345);
const acc = { base: 0, parade: 0, night: 0, total: 0, hits: 0, nights: 0, nightSpins: 0, parades: 0, steps: 0, max: 0, big: [0, 0, 0, 0] };
for (let i = 0; i < N; i++) {
  const o = Y.play(rand);
  const b = o.base;
  acc.base += b.steps[0].pay;
  acc.parade += b.pay - b.steps[0].pay;
  if (b.steps.length > 1) { acc.parades += 1; acc.steps += b.steps.length - 1; }
  if (o.night) { acc.night += o.night.pay; acc.nights += 1; acc.nightSpins += o.night.steps.length; }
  acc.total += o.mult;
  if (o.mult > 0) acc.hits += 1;
  acc.max = Math.max(acc.max, o.mult);
  [10, 50, 100, 1000].forEach((x, k) => { if (o.mult >= x) acc.big[k] += 1; });
}
const pct = (x) => `${((x / N) * 100).toFixed(2)}%`;
const every = (n) => (n ? `1 из ${Math.round(N / n)}` : '—');
console.log(`Спинов: ${N}`);
console.log(`Отдача: ${pct(acc.total)}  (первое вращение ${pct(acc.base)}, шаги парада ${pct(acc.parade)}, ночь ${pct(acc.night)})`);
console.log(`Выигрышных спинов: ${pct(acc.hits)}`);
console.log(`Парад: ${every(acc.parades)}, шагов в среднем ${(acc.steps / acc.parades).toFixed(1)}`);
console.log(`Ночь ста демонов: ${every(acc.nights)}, средняя ${(acc.night / acc.nights).toFixed(1)}×, вращений в среднем ${(acc.nightSpins / acc.nights).toFixed(1)}`);
console.log(`×10+: ${every(acc.big[0])}, ×50+: ${every(acc.big[1])}, ×100+: ${every(acc.big[2])}, ×1000+: ${every(acc.big[3])}, максимум ×${acc.max}`);

const M = Math.round(N / 20);
let sum = 0;
for (let i = 0; i < M; i++) sum += Y.play(rand, { mode: 'buy-bonus' }).mult;
console.log(`buy-bonus: в среднем ${(sum / M).toFixed(1)}× при цене ${Y.BUY.bonus}× → отдача ${((sum / M / Y.BUY.bonus) * 100).toFixed(1)}%`);
