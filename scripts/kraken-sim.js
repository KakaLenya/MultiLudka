// Подбор математики «Кракена»: прогоняет миллионы спинов и показывает, откуда берётся отдача.
// node scripts/kraken-sim.js [спинов] [зерно]
const K = require('../server/kraken-math');

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
const acc = { lines: 0, collect: 0, scatter: 0, hw: 0, fs: 0, total: 0, hits: 0, fsN: 0, hwN: 0, tent: 0, max: 0, big: [0, 0, 0, 0] };
for (let i = 0; i < N; i++) {
  const o = K.play(rand);
  const b = o.base;
  acc.lines += b.wins.reduce((s, w) => s + w.pay, 0);
  acc.collect += b.collect ? b.collect.pay : 0;
  acc.scatter += b.scatter ? b.scatter.pay : 0;
  if (o.hw) { acc.hw += o.hw.pay; acc.hwN += 1; }
  if (o.fs) { acc.fs += o.fs.pay; acc.fsN += 1; }
  if (b.tentacle) acc.tent += 1;
  acc.total += o.mult;
  if (o.mult > 0) acc.hits += 1;
  acc.max = Math.max(acc.max, o.mult);
  [10, 50, 100, 1000].forEach((x, k) => { if (o.mult >= x) acc.big[k] += 1; });
}
const pct = (x) => `${((x / N) * 100).toFixed(2)}%`;
const every = (n) => (n ? `1 из ${Math.round(N / n)}` : '—');
console.log(`Спинов: ${N}`);
console.log(`Отдача: ${pct(acc.total)}  (линии ${pct(acc.lines)}, сбор ${pct(acc.collect)}, скаттеры ${pct(acc.scatter)}, сундук ${pct(acc.hw)}, фриспины ${pct(acc.fs)})`);
console.log(`Выигрышных спинов: ${pct(acc.hits)}`);
console.log(`Фриспины: ${every(acc.fsN)}, средний ${(acc.fs / acc.fsN).toFixed(1)}×`);
console.log(`Сундук: ${every(acc.hwN)}, средний ${(acc.hw / acc.hwN).toFixed(1)}×`);
console.log(`Хватка Кракена: ${every(acc.tent)}`);
console.log(`×10+: ${every(acc.big[0])}, ×50+: ${every(acc.big[1])}, ×100+: ${every(acc.big[2])}, ×1000+: ${every(acc.big[3])}, максимум ×${acc.max}`);

// Покупка бонуса.
for (const mode of ['buy-fs', 'buy-hw']) {
  const M = Math.round(N / 20);
  let sum = 0;
  for (let i = 0; i < M; i++) sum += K.play(rand, { mode }).mult;
  const price = mode === 'buy-fs' ? K.BUY.fs : K.BUY.hw;
  console.log(`${mode}: в среднем ${(sum / M).toFixed(1)}× при цене ${price}× → отдача ${((sum / M / price) * 100).toFixed(1)}%`);
}
