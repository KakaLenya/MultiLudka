const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { createStore } = require('../server/players');
const { createAchievements, ACHIEVEMENTS, weekStart, WEEK } = require('../server/achievements');

// Понедельник 12 октября 2026, 00:00 МСК.
const MON = Date.UTC(2026, 9, 11, 21, 0, 0);

function setup(t = MON + 3600_000) {
  const clock = { t };
  const store = createStore({ now: () => clock.t });
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  const unlocked = [];
  const seasons = [];
  const ach = createAchievements({
    store,
    now: () => clock.t,
    onUnlock: (p, def) => unlocked.push(`${p.name}:${def.id}`),
    onSeasonEnd: (e) => seasons.push(e),
  });
  return { clock, store, a, b, ach, unlocked, seasons };
}

test('неделя начинается в понедельник 00:00 по Москве', () => {
  assert.equal(weekStart(MON), MON);
  assert.equal(weekStart(MON - 1), MON - WEEK);
  assert.equal(weekStart(MON + WEEK - 1), MON);
  assert.equal(new Date(MON).getUTCDay(), 0, 'воскресенье 21:00 UTC = понедельник 00:00 МСК');
});

test('у всех достижений есть иконка, имя и описание, id не повторяются', () => {
  assert.equal(new Set(ACHIEVEMENTS.map((x) => x.id)).size, ACHIEVEMENTS.length);
  for (const x of ACHIEVEMENTS) assert.ok(x.icon && x.name && x.desc, x.id);
});

test('первая победа, крупный куш и джекпот — по одному разу', () => {
  const { a, ach, unlocked } = setup();
  ach.record({ game: 'crash', kind: 'lose', player: a, amount: 100 });
  assert.deepEqual(unlocked, []);
  ach.record({ game: 'crash', kind: 'win', player: a, amount: 150_000, meta: { mult: 2 } });
  ach.record({ game: 'crash', kind: 'win', player: a, amount: 20_000, meta: { mult: 2 } });
  assert.deepEqual(unlocked, ['Аня:first_win', 'Аня:big_win', 'Аня:jackpot']);
  assert.equal(ach.count(a.id), 3);
});

test('плинко: крайняя лунка и ×1000', () => {
  const { a, ach, unlocked } = setup();
  ach.record({ game: 'plinko', kind: 'win', player: a, amount: 99, meta: { multiplier: 1000, edge: true } });
  assert.ok(unlocked.includes('Аня:plinko_edge') && unlocked.includes('Аня:plinko_1000'));
});

test('игровые достижения по подробностям события', () => {
  const { a, b, ach, unlocked } = setup();
  ach.record({ game: 'crash', kind: 'win', player: a, amount: 5, meta: { mult: 55.2 } });
  ach.record({ game: 'crash', kind: 'lose', player: b, amount: 5, meta: { crashedAt: 1 } });
  ach.record({ game: 'roulette', kind: 'win', player: a, amount: 350, meta: { straight: true, zero: true } });
  ach.record({ game: 'upgrade', kind: 'win', player: b, amount: 500, meta: { chance: 5 } });
  ach.record({ game: 'bomb', kind: 'lose', player: b, amount: 50, meta: { boom: true } });
  ach.record({ game: 'bomb', kind: 'win', player: a, amount: 50, meta: { last: true } });
  ach.record({ game: 'poker', kind: 'win', player: a, amount: 50, meta: { rank: 9, royal: true, folded: false } });
  ach.record({ game: 'poker', kind: 'win', player: b, amount: 50, meta: { rank: null, folded: true } });
  for (const id of ['crash_x10', 'crash_x50', 'roulette_straight', 'roulette_zero', 'bomb_win', 'bomb_last', 'poker_quads', 'poker_royal']) {
    assert.ok(unlocked.includes(`Аня:${id}`), id);
  }
  for (const id of ['crash_instant', 'upgrade_odds', 'bomb_boom', 'poker_bluff']) assert.ok(unlocked.includes(`Боря:${id}`), id);
  assert.ok(!unlocked.includes('Аня:poker_bluff'));
});

test('Верити: пять раз подряд, серия сбрасывается', () => {
  const { a, ach, unlocked } = setup();
  const v = (good) => ach.record({ game: 'verity', kind: good ? 'win' : 'lose', player: a, amount: 10, meta: { good } });
  [true, true, true, true, false, true, true, true, true].forEach(v);
  assert.ok(!unlocked.includes('Аня:verity_good'), 'серия прервалась');
  v(true);
  assert.ok(unlocked.includes('Аня:verity_good'));
  [false, false, false, false, false].forEach(v);
  assert.ok(unlocked.includes('Аня:verity_evil'));
});

test('пул: пять побед — акула, все двенадцать игр — завсегдатай, большая ставка — хайроллер', () => {
  const { a, ach, unlocked } = setup();
  for (let i = 0; i < 5; i++) ach.record({ game: 'pool', kind: 'win', player: a, amount: 100, meta: { byEight: i === 2 } });
  assert.ok(unlocked.includes('Аня:pool_shark') && unlocked.includes('Аня:pool_clean'));
  for (const game of ['crash', 'roulette', 'wheel', 'upgrade', 'verity', 'plinko', 'mines', 'kraken', 'saloon', 'bomb', 'poker']) {
    ach.record({ game, kind: 'bet', player: a, amount: 10, meta: { stake: game === 'roulette' ? 50_000 : 10 } });
  }
  assert.ok(unlocked.includes('Аня:regular'));
  assert.ok(unlocked.includes('Аня:high_roller'));
});

test('капитал: миллионер и «из грязи в князи» только после пособия', () => {
  const { a, b, ach, unlocked } = setup();
  ach.checkCapital(a, 20_000);
  assert.ok(!unlocked.includes('Аня:comeback'));
  ach.bonusClaimed(b);
  ach.checkCapital(b, 9_999);
  ach.checkCapital(b, 10_000);
  ach.checkCapital(a, 1_000_000);
  assert.deepEqual(unlocked, ['Боря:comeback', 'Аня:millionaire']);
});

test('сезон: очки — чистый выигрыш за неделю, в понедельник итоги в зал славы', () => {
  const { clock, a, b, ach, unlocked, seasons } = setup();
  ach.record({ game: 'crash', kind: 'win', player: a, amount: 500 });
  ach.record({ game: 'crash', kind: 'lose', player: a, amount: 200 });
  ach.record({ game: 'roulette', kind: 'win', player: b, amount: 100 });
  ach.record({ game: 'roulette', kind: 'bet', player: b, amount: 9999 });
  let s = ach.season();
  assert.equal(s.startedAt, MON);
  assert.deepEqual(s.top.map((p) => `${p.name}:${p.net}`), ['Аня:300', 'Боря:100']);

  clock.t = MON + WEEK + 10;
  ach.tick();
  assert.equal(seasons.length, 1);
  assert.deepEqual(seasons[0].top.map((p) => p.name), ['Аня', 'Боря']);
  assert.ok(unlocked.includes('Аня:season_champ') && unlocked.includes('Аня:season_podium'));
  assert.ok(unlocked.includes('Боря:season_podium') && !unlocked.includes('Боря:season_champ'));
  s = ach.season();
  assert.equal(s.startedAt, MON + WEEK);
  assert.deepEqual(s.top, []);
  assert.equal(s.hall.length, 1);
});

test('пустая неделя в зал славы не попадает; админ может закрыть неделю досрочно', () => {
  const { clock, a, ach, seasons } = setup();
  clock.t = MON + WEEK + 5;
  ach.tick();
  assert.equal(seasons.length, 0);
  ach.record({ game: 'pool', kind: 'win', player: a, amount: 100 });
  ach.endSeasonNow();
  assert.equal(seasons.length, 1);
  assert.equal(ach.season().top.length, 0);
});

test('удалённый игрок пропадает из сезона; данные переживают перезапуск', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ach-'));
  const file = path.join(dir, 'achievements.json');
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  const clock = { t: MON + 100 };
  let ach = createAchievements({ file, store, now: () => clock.t });
  ach.record({ game: 'crash', kind: 'win', player: a, amount: 77, meta: { mult: 12 } });
  ach.record({ game: 'crash', kind: 'win', player: b, amount: 5 });
  ach.forget(b.id);
  ach.flush();
  ach = createAchievements({ file, store, now: () => clock.t });
  assert.deepEqual(Object.keys(ach.unlockedOf(a.id)).sort(), ['crash_x10', 'first_win']);
  assert.deepEqual(ach.season().top.map((p) => p.name), ['Аня']);
  assert.equal(ach.count(b.id), 0);
  fs.rmSync(dir, { recursive: true, force: true });
});
