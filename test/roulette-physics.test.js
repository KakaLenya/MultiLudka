const test = require('node:test');
const assert = require('node:assert/strict');
const RP = require('../public/roulette-physics');

const SPIN_MS = 7000;

test('шарик всегда ложится в номер, который выбрал сервер', () => {
  for (let seed = 1; seed <= 150; seed++) {
    const slot = (seed * 7) % 37;
    const s = RP.spin({ seed, rotation: seed * 0.37, slot, spinMs: SPIN_MS });
    const [a, r, th] = s.frames.at(-1);
    assert.equal(RP.slotIndex(a - th), slot, `раунд ${seed}`);
    assert.equal(r, RP.R_POCKET);
  }
});

test('бросок укладывается во время вращения и успевает улечься', () => {
  for (let seed = 1; seed <= 100; seed++) {
    const s = RP.spin({ seed, rotation: 0, slot: 0, spinMs: SPIN_MS });
    const shown = (s.frames.length * s.frameDt) / s.scale;
    assert.ok(Math.abs(shown - SPIN_MS / 1000) < 0.05, `раунд ${seed}: ${shown.toFixed(2)} с`);
    assert.ok(s.scale > 0.6 && s.scale < 1.6, `раунд ${seed}: масштаб времени ${s.scale}`);
  }
});

test('одинаковый раунд — одинаковый бросок, разные раунды — разные', () => {
  const a = RP.spin({ seed: 42, rotation: 1, slot: 5, spinMs: SPIN_MS });
  const b = RP.spin({ seed: 42, rotation: 1, slot: 5, spinMs: SPIN_MS });
  assert.deepEqual(a.frames, b.frames);
  const drops = new Set();
  for (let seed = 1; seed <= 20; seed++) {
    const s = RP.spin({ seed, rotation: 1, slot: 5, spinMs: SPIN_MS });
    const i = s.frames.findIndex((f) => f[1] < RP.R_TRACK - 0.01);
    drops.add(Math.round((i * s.frameDt) / s.scale * 10));
  }
  assert.ok(drops.size >= 8, `шарик слетает с дорожки в разное время (${drops.size} вариантов)`);
});

test('шарик бежит против колеса и не вылетает за обод', () => {
  const s = RP.spin({ seed: 7, rotation: 0, slot: 12, spinMs: SPIN_MS });
  assert.ok(s.frames[10][0] < s.frames[0][0], 'шарик против часовой');
  assert.ok(s.frames[10][2] > s.frames[0][2], 'колесо по часовой');
  for (const [, r] of s.frames) assert.ok(r <= RP.R_TRACK && r >= RP.R_POCKET);
});
