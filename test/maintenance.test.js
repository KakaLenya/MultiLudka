const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const { createMaintenance, DEFAULT_TEXT } = require('../server/maintenance');
const { createAdminRouter } = require('../server/admin');
const { createStore } = require('../server/players');

const tmpFile = () => path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'casino-maint-')), 'maintenance.json');

test('перерыв: блокирует только новые ставки, ходы и чат проходят', () => {
  const sent = [];
  const m = createMaintenance({ broadcast: (msg) => sent.push(msg) });
  const p = { id: 'p1' };
  assert.equal(m.blocks(p, 'crash_bet'), null, 'выключен — всё можно');

  assert.ok(m.set({ on: true }).ok);
  for (const t of ['crash_bet', 'roulette_bet', 'kraken_spin', 'mines_start', 'blackjack_start', 'poker_join', 'plinko_drop']) {
    assert.match(m.blocks(p, t), /Технический перерыв/, t);
  }
  for (const t of ['chat', 'crash_cashout', 'mines_pick', 'mines_cashout', 'blackjack_hit', 'kraken_done', 'poker_action', 'claim_bonus', 'hello']) {
    assert.equal(m.blocks(p, t), null, t);
  }
  assert.deepEqual(sent.at(-1), { type: 'maintenance', on: true, text: DEFAULT_TEXT, until: 0 });

  m.set({ on: false });
  assert.equal(m.blocks(p, 'crash_bet'), null);
  assert.deepEqual(sent.at(-1), { type: 'maintenance', on: false, text: '', until: 0 });
});

test('перерыв: админу из списка можно играть, время возвращения проверяется', () => {
  const clock = { t: 1_000_000 };
  const m = createMaintenance({ now: () => clock.t });
  assert.ok(m.set({ on: true, until: clock.t - 1 }).error, 'в прошлом');
  assert.ok(m.set({ on: true, until: clock.t + 100 * 3600_000 }).error, 'слишком далеко');
  assert.ok(m.set({ on: 'да' }).error);
  assert.ok(m.set({ on: true, text: '  Меняем   сукно ', until: clock.t + 3600_000, allow: ['admin'] }).ok);
  assert.equal(m.blocks({ id: 'admin' }, 'crash_bet'), null);
  assert.ok(m.blocks({ id: 'other' }, 'crash_bet'));
  assert.deepEqual(m.view(), { type: 'maintenance', on: true, text: 'Меняем сукно', until: clock.t + 3600_000 });
  assert.equal(m.view().allow, undefined, 'список не уходит клиентам');
});

test('перерыв: переживает перезапуск', () => {
  const file = tmpFile();
  createMaintenance({ file }).set({ on: true, text: 'Скоро', allow: ['x'] });
  const again = createMaintenance({ file });
  assert.equal(again.isOn(), true);
  assert.deepEqual(again.adminState(), { on: true, text: 'Скоро', until: 0, allow: ['x'] });
  again.set({ on: false });
  assert.equal(createMaintenance({ file }).isOn(), false);
});

test('перерыв: POST /admin/api/maintenance', async () => {
  const store = createStore();
  const a = store.register('Аня').player;
  const sent = [];
  const maintenance = createMaintenance({ broadcast: (msg) => sent.push(msg) });
  const app = express();
  app.use('/admin/api', createAdminRouter({ adminToken: 'secret-token', store, maintenance, broadcast: (msg) => sent.push(msg) }));
  const server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const base = `http://127.0.0.1:${server.address().port}/admin/api`;
  const post = (body, headers = {}) => fetch(`${base}/maintenance`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  try {
    assert.equal((await post({ on: true }, { 'cf-connecting-ip': '1.2.3.4' })).status, 403, 'через туннель без токена нельзя');
    assert.equal((await post({ on: true, allow: ['Нет такого'] })).status, 404);
    const r = await (await post({ on: true, text: 'Обновляем зал', allow: ['аня'] })).json();
    assert.equal(r.ok, true);
    assert.deepEqual(r.maintenance.allow, [a.id]);
    assert.equal(maintenance.blocks(a, 'crash_bet'), null);
    assert.deepEqual(sent.at(-1), { type: 'maintenance', on: true, text: 'Обновляем зал', until: 0 });
    assert.equal((await post({ on: false })).status, 200);
    assert.equal(maintenance.isOn(), false);
  } finally {
    server.close();
  }
});
