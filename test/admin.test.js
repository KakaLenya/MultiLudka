const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const express = require('express');
const { createStore } = require('../server/players');
const { createCrashGame, BETTING_MS } = require('../server/crash');
const { createTable, START_DELAY_MS } = require('../server/dicepoker');
const { createAdminRouter } = require('../server/admin');
const { createRoulette } = require('../server/roulette');

test('краш: подкрутка текущего раунда во время ставок, иначе следующего', () => {
  const clock = { t: 0 };
  const store = createStore();
  const a = store.register('Аня').player;
  const game = createCrashGame({ store, now: () => clock.t, random: () => 0.5 });
  game._reset(0);
  assert.deepEqual(game.rig(5), { ok: true, round: 'current' });
  game.bet(a, 100);
  clock.t = BETTING_MS;
  game.tick();
  assert.deepEqual(game.rig(1), { ok: true, round: 'next' });
  assert.equal(game.adminState().crashPoint, 5);
  assert.equal(game.adminState().rigged, 1);
  assert.ok(game.rig(0.5).error);
  assert.ok(game.rig(1000).error);
});

test('краш: крашнуть сейчас', () => {
  const clock = { t: 0 };
  const store = createStore();
  const a = store.register('Аня').player;
  const game = createCrashGame({ store, now: () => clock.t, random: () => 0.9 }); // x9.90
  game._reset(0);
  assert.ok(game.crashNow().error, 'во время ставок нельзя');
  game.bet(a, 100);
  clock.t = BETTING_MS + 5000;
  game.tick();
  const r = game.crashNow();
  assert.equal(r.at, 1.41);
  assert.equal(game.state().phase, 'crashed');
  assert.ok(game.cashout(a).error);
  assert.equal(a.balance, 900);
});

test('покер: подкрученные кубики на раздачу и на перебросок', () => {
  const clock = { t: 0 };
  const store = createStore();
  const [a, b] = ['Аня', 'Боря'].map((n) => store.register(n).player);
  const queue = [];
  const table = createTable({ store, now: () => clock.t, rollDie: () => queue.shift() });
  table.join(a, 200);
  table.join(b, 200);
  assert.ok(table.rigDice(a, [7, 1, 1, 1, 1]).error);
  assert.deepEqual(table.rigDice(a, [6, 6, 6, 6, 6]), { ok: true });
  queue.push(1, 2, 3, 4, 5);                 // только для Бори
  clock.t = START_DELAY_MS;
  table.tick();
  assert.deepEqual(table.view(a).you.dice, [6, 6, 6, 6, 6]);
  assert.deepEqual(table.view(b).you.dice, [1, 2, 3, 4, 5]);
  assert.equal(table.adminView().seats[1].hand, 'Стрит', 'админ видит все кубики');

  table.rigDice(b, [2, 2, 2, 2, 2]);         // на перебросок
  table.act(b, 'check');
  table.act(a, 'check');
  queue.push(4);
  table.reroll(a, [true, true, true, true, true]);
  table.reroll(b, [true, true, true, true, false]);
  assert.deepEqual(table.view(b).you.dice, [2, 2, 2, 2, 2]);
  assert.deepEqual(table.adminView().rigged, []);
});

// Поднимаем админский роутер на случайном порту и стучимся fetch'ем.
async function withServer(fn) {
  const store = createStore();
  const a = store.register('Аня').player;
  const crash = createCrashGame({ store });
  const table = createTable({ store });
  const chatLog = [];
  const sent = [];
  const app = express();
  app.use('/admin/api', createAdminRouter({
    adminToken: 'secret-token',
    store,
    crash,
    table,
    roulette: createRoulette({ store }),
    chat: { log: () => chatLog, post: (playerId, name, text) => chatLog.push({ playerId, name, text }) },
    mutes: new Map(),
    cleanText: (t) => (typeof t === 'string' && t.trim() ? t.trim() : null),
    onlineIds: () => new Set([a.id]),
    sendToPlayer: (p, msg) => sent.push(msg),
    broadcast: (msg) => sent.push(msg),
    refreshLists: () => {},
  }));
  crash._reset();
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/admin/api`;
  try {
    await fn({ base, a, store, chatLog, sent });
  } finally {
    server.close();
  }
}

const post = (url, body, headers = {}) => fetch(url, {
  method: 'POST',
  headers: { 'content-type': 'application/json', ...headers },
  body: JSON.stringify(body),
});

test('API: локально без токена, через туннель только с токеном', async () => {
  await withServer(async ({ base, a, chatLog }) => {
    assert.equal((await fetch(`${base}/state`)).status, 200, 'локально пускает');

    const tunnel = { 'cf-connecting-ip': '1.2.3.4' };
    assert.equal((await fetch(`${base}/state`, { headers: tunnel })).status, 403);
    assert.equal((await fetch(`${base}/state`, { headers: { ...tunnel, 'x-admin-token': 'wrong' } })).status, 403);
    assert.equal((await fetch(`${base}/state`, { headers: { ...tunnel, 'x-admin-token': 'secret-token' } })).status, 200);

    const r = await post(`${base}/grant`, { target: 'player', playerId: a.id, amount: 500 }, tunnel);
    assert.equal(r.status, 403, 'через туннель без токена не начислить');
    assert.equal(a.balance, 1000);
    assert.equal(chatLog.length, 0);
  });
});

test('API: начислить, забрать больше, чем есть, точный баланс, мут, эффект', async () => {
  await withServer(async ({ base, a, sent, chatLog }) => {
    let r = await (await post(`${base}/grant`, { target: 'player', playerId: a.id, amount: 500 })).json();
    assert.equal(a.balance, 1500);
    assert.equal(r.results[0].delta, 500);

    r = await (await post(`${base}/grant`, { target: 'online', amount: -999999 })).json();
    assert.equal(a.balance, 0, 'забрали всё, но не в минус');
    assert.equal(r.results[0].delta, -1500);

    assert.equal((await post(`${base}/grant`, { target: 'all', amount: 1.5 })).status, 400);
    assert.equal((await post(`${base}/set-balance`, { playerId: a.id, balance: 777 })).status, 200);
    assert.equal(a.balance, 777);

    assert.equal((await post(`${base}/mute`, { playerId: a.id, minutes: 5 })).status, 200);
    assert.equal((await post(`${base}/effect`, { effect: 'confetti', target: 'all' })).status, 200);
    assert.equal((await post(`${base}/effect`, { effect: 'rm -rf', target: 'all' })).status, 400);
    assert.deepEqual(sent.at(-1), { type: 'fx', effect: 'confetti' });
    assert.ok(chatLog.some((m) => m.playerId === null && /помолчит/.test(m.text)));

    assert.equal((await post(`${base}/grant`, { target: 'player', playerId: '999', amount: 5 })).status, 404);

    assert.equal((await post(`${base}/delete-player`, { playerId: a.id })).status, 200);
    const st = await (await fetch(`${base}/state`)).json();
    assert.equal(st.players.length, 0, 'удалённого нет в списке');
    assert.equal((await post(`${base}/delete-player`, { playerId: a.id })).status, 404);
  });
});
