const test = require('node:test');
const assert = require('node:assert/strict');
const P = require('../public/pool-physics');

const ORDER = [1, 9, 2, 10, 8, 3, 11, 4, 12, 5, 13, 6, 14, 7, 15];

test('пирамида: 15 шаров без наложений, восьмёрка в центре', () => {
  const balls = P.rack(ORDER);
  assert.equal(balls.length, 16);
  const eight = balls.find((b) => b.id === 8);
  const spots = P.rackSpots();
  assert.deepEqual([eight.x, eight.y], [spots[4].x, spots[4].y]);
  for (let i = 0; i < balls.length; i++) {
    for (let j = i + 1; j < balls.length; j++) {
      const d = Math.hypot(balls[i].x - balls[j].x, balls[i].y - balls[j].y);
      assert.ok(d >= 2 * P.R, `шары ${balls[i].id} и ${balls[j].id} налезают`);
    }
  }
});

// Где биток в первые 1.2 с после касания прицельного шара: [мин x, макс x, x в момент касания].
function cueAfterHit(gap, power, spin) {
  const r = P.simulate([{ id: 0, x: 200, y: 150 }, { id: 3, x: gap, y: 150 }], { x: power * P.MAX_SPEED, y: 0 }, { spin, record: true, frameEvery: 1 });
  assert.equal(r.events.firstHit, 3);
  const hit = r.frames.findIndex((f) => f[1] && f[1][0] > gap + 0.5);
  const xs = r.frames.slice(hit, hit + 288).map((f) => f[0][0]);
  return { min: Math.min(...xs), max: Math.max(...xs), at: xs[0] };
}

test('прямой удар вплотную без винта: биток встаёт на месте (стоп-удар)', () => {
  const c = cueAfterHit(240, 0.5, 0);
  assert.ok(c.max - c.at < 15, `биток почти не сдвинулся (${(c.max - c.at).toFixed(1)})`);
});

test('накат: биток катится следом за шаром', () => {
  const c = cueAfterHit(400, 0.4, 1);
  assert.ok(c.max - c.at > 150, `ушёл вперёд на ${(c.max - c.at).toFixed(0)}`);
});

test('оттяжка: биток откатывается назад', () => {
  const c = cueAfterHit(400, 0.4, -1);
  assert.ok(c.at - c.min > 80, `откатился на ${(c.at - c.min).toFixed(0)}`);
  assert.ok(c.max - c.at < 5, 'вперёд не поехал');
});

test('издалека без винта шар успевает покатиться и биток немного идёт следом', () => {
  const c = cueAfterHit(500, 0.3, 0);
  assert.ok(c.max - c.at > 40 && c.max - c.at < 200, `накат ${(c.max - c.at).toFixed(0)}`);
});

test('шары катятся далеко и плавно: слабый удар — треть стола, средний — больше длины', () => {
  const run = (power) => {
    const r = P.simulate([{ id: 0, x: 100, y: 150 }], { x: power * P.MAX_SPEED, y: 0 }, { record: true, frameEvery: 1 });
    let dist = 0;
    for (let i = 1; i < r.frames.length; i++) dist += Math.abs(r.frames[i][0][0] - r.frames[i - 1][0][0]);
    return { dist, duration: r.duration };
  };
  const weak = run(0.15);
  const mid = run(0.5);
  assert.ok(weak.dist > 300, `слабый: ${weak.dist.toFixed(0)}`);
  assert.ok(mid.dist > 1400, `средний: ${mid.dist.toFixed(0)}`);
  assert.ok(mid.duration < 10, 'но не катится вечно');
});

test('винт за пределами ±1 обрезается', () => {
  const balls = [{ id: 0, x: 200, y: 150 }, { id: 3, x: 400, y: 150 }];
  assert.deepEqual(P.simulate(balls, { x: 700, y: 0 }, { spin: 5 }).balls, P.simulate(balls, { x: 700, y: 0 }, { spin: 1 }).balls);
});

test('шар в лузу: прямо в угол', () => {
  const balls = [{ id: 0, x: 100, y: 100 }, { id: 5, x: 60, y: 60 }];
  const r = P.simulate(balls, { x: -500, y: -500 });
  assert.deepEqual(r.events.pocketed, [5]);
  assert.equal(r.balls.find((b) => b.id === 5).in, true);
});

test('биток в лузу без касаний: фол-сценарий виден по событиям', () => {
  const r = P.simulate([{ id: 0, x: 500, y: 100 }, { id: 1, x: 900, y: 400 }], { x: 0, y: -900 });
  assert.equal(r.events.firstHit, null);
  assert.deepEqual(r.events.pocketed, [0]);
});

test('отскок от борта и остановка', () => {
  const r = P.simulate([{ id: 0, x: 300, y: 250 }], { x: 0, y: 900 });  // не по центру: там средняя луза
  const cue = r.balls[0];
  assert.ok(!cue.in);
  assert.ok(cue.y < 490 && cue.y >= P.R);
  assert.ok(r.duration > 1 && r.duration < 20);
});

test('разбивка: детерминизм и все шары на столе или в лузах, без наложений', () => {
  const balls = P.rack(ORDER);
  const a = P.simulate(balls, { x: P.MAX_SPEED, y: 3 });
  const b = P.simulate(balls, { x: P.MAX_SPEED, y: 3 });
  assert.deepEqual(a.balls, b.balls, 'одинаковый удар даёт одинаковый результат');
  assert.equal(a.events.firstHit !== null, true);
  const onTable = a.balls.filter((o) => !o.in);
  for (const o of onTable) {
    assert.ok(o.x >= P.R - 0.01 && o.x <= P.W - P.R + 0.01 && o.y >= P.R - 0.01 && o.y <= P.H - P.R + 0.01, `шар ${o.id} за бортом`);
  }
  for (let i = 0; i < onTable.length; i++) {
    for (let j = i + 1; j < onTable.length; j++) {
      const d = Math.hypot(onTable[i].x - onTable[j].x, onTable[i].y - onTable[j].y);
      assert.ok(d >= 2 * P.R - 0.5, `после разбивки ${onTable[i].id} и ${onTable[j].id} налезают (${d.toFixed(2)})`);
    }
  }
});

test('запись кадров для анимации совпадает с итогом', () => {
  const r = P.simulate(P.rack(ORDER), { x: 1500, y: 40 }, { record: true });
  const last = r.frames.at(-1);
  r.balls.forEach((o, i) => {
    if (o.in) assert.equal(last[i], null);
    else assert.ok(Math.abs(last[i][0] - o.x) < 0.01 && Math.abs(last[i][1] - o.y) < 0.01);
  });
});

test('шар с руки: только на свободное место внутри стола', () => {
  const balls = [{ id: 0, x: 100, y: 100, in: true }, { id: 3, x: 300, y: 250, in: false }];
  assert.ok(P.canPlaceCue(balls, 200, 250, false));
  assert.ok(!P.canPlaceCue(balls, 305, 250, false), 'на шар нельзя');
  assert.ok(!P.canPlaceCue(balls, 5, 250, false), 'за борт нельзя');
  assert.ok(!P.canPlaceCue(balls, 20, 20, false), 'в лузу нельзя');
  assert.ok(!P.canPlaceCue(balls, 400, 250, true), 'на разбивке только в доме');
  assert.ok(!P.canPlaceCue(balls, NaN, 250, false));
});
