const test = require('node:test');
const assert = require('node:assert/strict');
const FP = require('../public/fortune-physics');
const { WHEEL } = require('../server/wheel');

const SPIN_MS = 9000;

test('раскладка колеса в браузере та же, что на сервере', () => {
  assert.deepEqual(FP.WHEEL, WHEEL);
});

test('колесо всегда встаёт на сектор сервера и не вплотную к штырьку', () => {
  for (let seed = 1; seed <= 200; seed++) {
    const segment = (seed * 7) % FP.N;
    const s = FP.spin({ seed, rotation: seed * 0.37, segment, spinMs: SPIN_MS });
    const end = s.frames.at(-1);
    assert.equal(FP.segmentAt(end), segment, `раунд ${seed}`);
    const frac = FP.pointerPos(end) % 1;
    assert.ok(frac > 0.05 && frac < 0.95, `раунд ${seed}: язычок у края сектора (${frac.toFixed(3)})`);
  }
});

test('вращение укладывается во время раунда, крутится по-настоящему', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = FP.spin({ seed, rotation: 0, segment: 0, spinMs: SPIN_MS });
    const shown = (s.frames.length * s.frameDt) / s.scale;
    assert.ok(shown < SPIN_MS / 1000, `раунд ${seed}: встало через ${shown.toFixed(2)} с`);
    assert.ok(shown > 0.75 * SPIN_MS / 1000, `раунд ${seed}: встало слишком рано (${shown.toFixed(2)} с)`);
    const turns = (s.frames.at(-1) - 0) / (2 * Math.PI);
    assert.ok(turns > 2, `раунд ${seed}: всего ${turns.toFixed(1)} оборота`);
  }
});

test('одинаковый раунд — одинаковое вращение; бывает и откат назад от штырька', () => {
  const a = FP.spin({ seed: 42, rotation: 1, segment: 5, spinMs: SPIN_MS });
  const b = FP.spin({ seed: 42, rotation: 1, segment: 5, spinMs: SPIN_MS });
  assert.deepEqual(a.frames, b.frames);
  let back = 0;
  for (let seed = 1; seed <= 60; seed++) {
    const { frames } = FP.spin({ seed, rotation: 0, segment: 3, spinMs: SPIN_MS });
    if (frames.some((th, i) => i > 0 && th < frames[i - 1] - 1e-9)) back += 1;
  }
  assert.ok(back > 5 && back < 55, `откатов: ${back} из 60`);
});

test('язычок давит только штырёк, который на него едет', () => {
  // Штырёк чуть не дошёл до язычка (вращение по часовой) — язычок отогнут по ходу.
  const nearPeg = -0.1 * FP.STEP;   // поворот, при котором штырёк в 0.1 сектора от язычка
  assert.ok(FP.flapTarget(nearPeg, 1) > 0);
  assert.equal(FP.flapTarget(-nearPeg, 1), 0, 'проехавший штырёк не давит');
  assert.equal(FP.flapTarget(-0.5 * FP.STEP, 1), 0, 'середина сектора — язычок свободен');
});
