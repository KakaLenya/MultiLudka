// Подбор математики «Салуна»: прогоняет миллионы спинов и показывает, откуда берётся отдача.
// node scripts/kraken-sim.js [спинов] [зерно]
const K = require('../server/saloon-math');

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

const N = Number(process.argv[2]) || 2_000_000;
const rand = rng(Number(process.argv[3]) || 12345);
const acc = { ways: 0, scatter: 0, duel: 0, total: 0, hits: 0, duelN: 0, bullets: 0, max: 0, capped: 0, big: [0, 0, 0, 0], spins: 0, lives: 0 };
for (let i = 0; i < N; i++) {
  const o = K.play(rand);
  const b = o.base;
  acc.ways += b.wins.reduce((s, w) => s + w.pay, 0);
  acc.scatter += b.scatter ? b.scatter.pay : 0;
  if (o.duel) { acc.duel += o.duel.pay; acc.duelN += 1; acc.spins += o.duel.rounds.length; }
  if (b.bullets) acc.bullets += 1;
  acc.total += o.mult;
  if (o.mult > 0) acc.hits += 1;
  if (o.capped) acc.capped += 1;
  acc.max = Math.max(acc.max, o.mult);
  [10, 50, 100, 1000].forEach((x, k) => { if (o.mult >= x) acc.big[k] += 1; });
}
const pct = (x) => `${((x / N) * 100).toFixed(2)}%`;
const every = (n) => (n ? `1 из ${Math.round(N / n)}` : '—');
console.log(`Спинов: ${N}`);
console.log(`Отдача: ${pct(acc.total)}  (пути ${pct(acc.ways)}, скаттеры ${pct(acc.scatter)}, дуэль ${pct(acc.duel)})`);
console.log(`Выигрышных спинов: ${pct(acc.hits)}`);
console.log(`Дуэль: ${every(acc.duelN)}, средняя ${(acc.duel / acc.duelN).toFixed(1)}×, вращений в среднем ${(acc.spins / acc.duelN).toFixed(1)}`);
console.log(`Шальная пуля: ${every(acc.bullets)}`);
console.log(`×10+: ${every(acc.big[0])}, ×50+: ${every(acc.big[1])}, ×100+: ${every(acc.big[2])}, ×1000+: ${every(acc.big[3])}, потолок: ${acc.capped}, максимум ×${acc.max}`);

// Покупка бонуса.
for (const mode of ['buy-duel', 'buy-super']) {
  const M = Math.round(N / 20);
  let sum = 0;
  for (let i = 0; i < M; i++) sum += K.play(rand, { mode }).mult;
  const price = mode === 'buy-duel' ? K.BUY.duel : K.BUY.super;
  console.log(`${mode}: в среднем ${(sum / M).toFixed(1)}× при цене ${price}× → отдача ${((sum / M / price) * 100).toFixed(1)}%`);
}
