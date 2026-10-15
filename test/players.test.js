const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const {
  createStore, cleanName, START_BALANCE, BONUS_AMOUNT, BONUS_COOLDOWN_MS,
} = require('../server/players');

function tmpFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'casino-'));
  return path.join(dir, 'players.json');
}

test('cleanName: обрезает, чистит, отклоняет пустое', () => {
  assert.equal(cleanName('  Аня  '), 'Аня');
  assert.equal(cleanName('a\u0000b\nc'), 'abc');
  assert.equal(cleanName('x'.repeat(50)).length, 20);
  assert.equal(cleanName('   '), null);
  assert.equal(cleanName(42), null);
});

test('register: стартовый баланс, занятое имя без учёта регистра', () => {
  const store = createStore();
  const { player } = store.register('Аня');
  assert.equal(player.balance, START_BALANCE);
  assert.ok(store.register('аня').error);
  assert.ok(store.register('').error);
  assert.equal(store.findByToken(player.token), player);
  assert.equal(store.findByToken('nope'), null);
  assert.equal(store.findByToken({}), null);
});

test('adjust: целые суммы, не уходит в минус', () => {
  const store = createStore();
  const { player } = store.register('Боря');
  store.adjust(player, -START_BALANCE);
  assert.equal(player.balance, 0);
  assert.throws(() => store.adjust(player, -1));
  assert.throws(() => store.adjust(player, 0.5));
  assert.throws(() => store.adjust(player, NaN));
  assert.equal(player.balance, 0);
});

test('onChange срабатывает при изменении баланса', () => {
  const store = createStore();
  const seen = [];
  store.onChange((p) => seen.push(p.balance));
  const { player } = store.register('Вика');
  store.adjust(player, 5);
  assert.deepEqual(seen, [START_BALANCE, START_BALANCE + 5]);
});

test('пособие: только при капитале < 10 и раз в сутки', () => {
  let t = 1_000_000;
  const store = createStore({ now: () => t });
  const { player } = store.register('Гоша');

  assert.ok(store.claimBonus(player).error, 'при полном балансе нельзя');

  store.adjust(player, -(START_BALANCE - 9));
  assert.deepEqual(store.claimBonus(player), { ok: true });
  assert.equal(player.balance, 9 + BONUS_AMOUNT);

  store.adjust(player, -player.balance);
  assert.ok(store.claimBonus(player).error, 'второй раз в те же сутки нельзя');
  assert.equal(store.bonusStatus(player).availableIn, BONUS_COOLDOWN_MS);

  t += BONUS_COOLDOWN_MS;
  assert.deepEqual(store.claimBonus(player), { ok: true });
  assert.equal(player.balance, BONUS_AMOUNT);
});

test('пособие учитывает фишки, лежащие в играх', () => {
  const store = createStore();
  const { player } = store.register('Даша');
  const atTable = new Map([[player.id, 500]]);
  store.addReserver((p) => atTable.get(p.id) || 0);

  store.adjust(player, -START_BALANCE);
  assert.equal(store.capital(player), 500);
  assert.ok(store.claimBonus(player).error);
});

test('лидерборд по капиталу, без токенов', () => {
  const store = createStore();
  const a = store.register('Аня').player;
  const b = store.register('Боря').player;
  store.adjust(a, -100);
  store.adjust(b, 50);
  const board = store.leaderboard();
  assert.deepEqual(board.map((p) => p.name), ['Боря', 'Аня']);
  assert.equal(board[0].capital, START_BALANCE + 50);
  assert.ok(!('token' in board[0]));
});

test('сохранение и загрузка: балансы переживают перезапуск', () => {
  const file = tmpFile();
  const store1 = createStore({ file });
  const { player } = store1.register('Ева');
  store1.adjust(player, -123);
  store1.flush();
  assert.ok(!fs.existsSync(`${file}.tmp`), 'временный файл переименован');

  const store2 = createStore({ file });
  const loaded = store2.findByToken(player.token);
  assert.equal(loaded.balance, START_BALANCE - 123);
  assert.equal(loaded.name, 'Ева');
  assert.ok(store2.register('ева').error, 'имя занято и после загрузки');
  assert.notEqual(store2.register('Жора').player.id, player.id, 'id не повторяются');
});

test('дебаунс: несколько изменений дают одну запись', async () => {
  const file = tmpFile();
  const store = createStore({ file, saveDelayMs: 20 });
  const { player } = store.register('Зоя');
  for (let i = 0; i < 10; i++) store.adjust(player, 1);
  assert.ok(!fs.existsSync(file), 'сразу не пишет');
  await new Promise((r) => setTimeout(r, 60));
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.equal(data.players[0].balance, START_BALANCE + 10);
});

test('повреждённый файл: понятная ошибка, а не тихий сброс', () => {
  const file = tmpFile();
  fs.writeFileSync(file, '{ сломано');
  assert.throws(() => createStore({ file }), /повреждён/);
});
