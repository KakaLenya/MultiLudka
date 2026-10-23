const test = require('node:test');
const assert = require('node:assert/strict');
const { createStore } = require('../server/players');
const K = require('../server/kraken-math');
const { createKraken } = require('../server/kraken');

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

const grid = (cols) => cols.map((c) => c.split(' '));

test('линии: слева направо, Кракен заменяет, карты и жемчуг — нет', () => {
  const g = grid([
    'ship anchor rum helm',
    'wild anchor rum helm',
    'ship jelly map helm',
    'ship jelly pearl compass',
    'anchor jelly rum compass',
  ]);
  const wins = K.lineWins(g);
  const top = wins.find((w) => w.line === 2);   // верхний ряд: ship wild ship ship anchor
  assert.deepEqual({ symbol: top.symbol, count: top.count }, { symbol: 'ship', count: 4 });
  assert.equal(top.pay, K.SYMBOLS.ship.pays[1] / 20);
  assert.ok(!wins.some((w) => w.line === 0), 'второй ряд прерывает карта');
  assert.ok(wins.every((w) => w.count >= 3));
});

test('Кракен в основной игре берёт жемчуг своего барабана, в фриспинах — со всего поля', () => {
  const g = grid([
    'anchor pearl rum helm',
    'wild pearl rum helm',
    'ship jelly pearl helm',
    'ship jelly rum compass',
    'anchor jelly rum compass',
  ]);
  const pearls = { 1: 5, 5: 2, 10: 3 };
  assert.equal(K.evaluate(g, pearls).collect.pay, 2);
  const wide = K.evaluate(g, pearls, 3, true).collect;
  assert.equal(wide.pay, 30);
  assert.equal(K.evaluate(grid(['anchor pearl rum helm', 'helm pearl rum helm', 'ship jelly pearl helm', 'ship jelly rum compass', 'anchor jelly rum compass']), pearls).collect, null);
});

test('сундук: новая жемчужина возвращает 3 вращения, Кракен забирает всё поле', () => {
  const r = K.holdAndWin(rng(5), { 0: 1, 1: 2, 2: 3, 3: 0.5, 4: 1, 5: 1 });
  let left = 3;
  for (const round of r.rounds) {
    assert.equal(round.left, round.landed.length ? 3 : left - 1);
    left = round.left;
  }
  assert.ok(r.full || left === 0);
  const sum = Object.values(r.board).reduce((s, v) => s + K.valueOf(v), 0);
  assert.equal(r.pay, sum + (r.full ? K.JACKPOTS.grand : 0));
});

test('фриспины: каждые 4 Кракена — новый уровень, +5 вращений', () => {
  for (let seed = 1; seed < 40; seed++) {
    const fs = K.freeSpins(rng(seed), 8);
    let level = 0;
    let given = 8;
    for (const s of fs.spins) {
      assert.equal(s.level, Math.min(4, Math.floor(s.meter / K.FS_PER_LEVEL)));
      if (s.levelUp) given += K.FS_EXTRA * (s.level - level);
      level = s.level;
    }
    assert.equal(fs.spins.length, given);
  }
});

test('отдача на дистанции около 96%, бонусы выпадают, потолок соблюдается', () => {
  const rand = rng(2024);
  const N = 150_000;
  let total = 0;
  let fs = 0;
  let hw = 0;
  for (let i = 0; i < N; i++) {
    const o = K.play(rand);
    total += o.mult;
    if (o.fs) fs += 1;
    if (o.hw) hw += 1;
  }
  const rtp = total / N;
  assert.ok(rtp > 0.85 && rtp < 1.08, `отдача ${(rtp * 100).toFixed(1)}%`);
  assert.ok(fs > N / 700 && fs < N / 200, `фриспины: ${fs}`);
  assert.ok(hw > N / 350 && hw < N / 100, `сундук: ${hw}`);
});

test('покупка бонуса гарантирует бонус', () => {
  const rand = rng(9);
  for (let i = 0; i < 50; i++) {
    assert.ok(K.play(rand, { mode: 'buy-fs' }).fs);
    assert.ok(K.play(rand, { mode: 'buy-hw' }).hw);
  }
});

test('сервер: ставка в игре до конца показа, выигрыш после done, лента и события', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  const later = [];
  const events = [];
  const feeds = [];
  const k = createKraken({ store, rand: rng(3), schedule: (fn) => later.push(fn), onEvent: (e) => events.push(e), onFeed: (f) => feeds.push(f) });
  store.addReserver(k.reserved);
  assert.ok(k.spin(a, 5).error, 'минимум 10');
  assert.ok(k.spin(a, 100, 'cheat').error);
  assert.match(k.spin(a, 20, 'buy-fs').error, /стоит 2/);
  const r = k.spin(a, 100).result;
  assert.equal(a.balance, 900);
  assert.equal(store.capital(a), 1000, 'ставка в игре');
  assert.match(k.spin(a, 100).error, /крутятся/);
  k.done(a, r.id + 1);
  assert.equal(a.balance, 900, 'чужой id не засчитывается');
  k.done(a, r.id);
  assert.equal(a.balance, 900 + r.payout);
  assert.equal(r.payout, Math.floor(100 * r.outcome.mult));
  assert.equal(feeds.at(-1)[0].payout, r.payout);
  later.forEach((fn) => fn());
  assert.equal(a.balance, 900 + r.payout, 'повторно не платит');
  if (r.payout !== 100) assert.equal(events.at(-1).game, 'kraken');
});

test('админ: подкрутить бонус; везунчик окупает ставку; остановка сервера платит', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  a.balance = 1_000_000;
  const k = createKraken({ store, rand: rng(11), schedule: () => {} });
  assert.ok(k.rig('jackpot').error);
  k.rig('fs');
  let r = k.spin(a, 10).result;
  assert.ok(r.outcome.fs);
  k.done(a, r.id);
  k.rig('lose');
  r = k.spin(a, 10).result;
  assert.equal(r.payout, 0);
  k.done(a, r.id);

  const lucky = createKraken({ store, rand: rng(12), schedule: () => {}, lucky: () => true });
  let wins = 0;
  for (let i = 0; i < 30; i++) {
    r = lucky.spin(a, 10).result;
    if (r.payout > 10) wins += 1;
    lucky.done(a, r.id);
  }
  assert.ok(wins >= 27, `везунчик в плюсе ${wins} из 30`);

  const before = a.balance;
  r = k.spin(a, 10).result;
  k.settleAll();
  assert.equal(a.balance, before - 10 + r.payout);
});

test('клиент показывает те же линии и выплаты, что считает сервер', () => {
  const src = require('node:fs').readFileSync(require('node:path').join(__dirname, '../public/kraken/slot.js'), 'utf8');
  const grab = (name) => {
    const m = new RegExp(`const ${name} = ([\\s\\S]*?);\\n`).exec(src);
    return new Function(`return ${m[1]}`)();
  };
  assert.deepEqual(grab('LINES'), K.LINES);
  const pays = grab('PAYS');
  for (const [s, def] of Object.entries(K.SYMBOLS)) if (def.pays) assert.deepEqual(pays[s], def.pays, s);
  assert.deepEqual(grab('JACKPOTS'), K.JACKPOTS);
  assert.deepEqual(grab('BUY'), K.BUY);
  assert.deepEqual(grab('FS_LEVELS'), K.FS_LEVELS);
});
