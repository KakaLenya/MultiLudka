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

test('прямой удар по одиночному шару: биток останавливается, шар катится дальше', () => {
  const balls = [{ id: 0, x: 200, y: 250 }, { id: 3, x: 400, y: 250 }];
  const r = P.simulate(balls, { x: 600, y: 0 });
  assert.equal(r.events.firstHit, 3);
  const cue = r.balls.find((b) => b.id === 0);
  const three = r.balls.find((b) => b.id === 3);
  assert.ok(cue.x < 420, `биток почти встал после удара (x=${cue.x})`);
  assert.ok(three.x > 500, `прицельный ушёл вперёд (x=${three.x})`);
  assert.ok(Math.abs(three.y - 250) < 0.01, 'по прямой');
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
