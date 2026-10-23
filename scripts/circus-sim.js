// Подбор математики «Заброшенного цирка»: прогоняет миллионы спинов и показывает, откуда берётся отдача.
// node scripts/circus-sim.js [спинов] [зерно]
const C = require('../server/circus-math');

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
const acc = { lines: 0, scatter: 0, knives: 0, total: 0, hits: 0, bonuses: 0, assistant: 0, max: 0, big: [0, 0, 0, 0], mods: {} };
for (let i = 0; i < N; i++) {
  const o = C.play(rand);
  for (const s of o.steps) {
    acc.scatter += s.scatter ? s.scatter.pay : 0;
    acc.lines += s.pay - (s.scatter ? s.scatter.pay : 0);
  }
  const m = o.steps[0].mod.type;
  acc.mods[m] = acc.mods[m] || { n: 0, pay: 0 };
  acc.mods[m].n += 1;
  acc.mods[m].pay += o.steps.reduce((t, s) => t + s.pay, 0);
  if (o.knives) {
    acc.knives += o.knives.pay;
    acc.bonuses += 1;
    if (o.knives.assistant) acc.assistant += 1;
  }
  acc.total += o.mult;
  if (o.mult > 0) acc.hits += 1;
  acc.max = Math.max(acc.max, o.mult);
  [10, 50, 100, 1000].forEach((x, k) => { if (o.mult >= x) acc.big[k] += 1; });
}
const pct = (x) => `${((x / N) * 100).toFixed(2)}%`;
const every = (n) => (n ? `1 из ${Math.round(N / n)}` : '—');
console.log(`Спинов: ${N}`);
console.log(`Отдача: ${pct(acc.total)}  (линии ${pct(acc.lines)}, мишени ${pct(acc.scatter)}, метатель ${pct(acc.knives)})`);
console.log(`Выигрышных спинов: ${pct(acc.hits)}`);
console.log(`Метатель ножей: ${every(acc.bonuses)}, средний ${(acc.knives / acc.bonuses).toFixed(1)}×, кончился на ассистентке ${((acc.assistant / acc.bonuses) * 100).toFixed(0)}%`);
console.log('Модификаторы (доля ходов / отдача хода):');
for (const [k, v] of Object.entries(acc.mods)) console.log(`  ${C.MOD_NAMES[k].padEnd(22)} ${((v.n / N) * 100).toFixed(1)}%  ${(v.pay / v.n).toFixed(2)}×`);
console.log(`×10+: ${every(acc.big[0])}, ×50+: ${every(acc.big[1])}, ×100+: ${every(acc.big[2])}, ×1000+: ${every(acc.big[3])}, максимум ×${acc.max}`);

const M = Math.round(N / 20);
let sum = 0;
for (let i = 0; i < M; i++) sum += C.play(rand, { mode: 'buy-knives' }).mult;
console.log(`buy-knives: в среднем ${(sum / M).toFixed(1)}× при цене ${C.BUY.knives}× → отдача ${((sum / M / C.BUY.knives) * 100).toFixed(1)}%`);
