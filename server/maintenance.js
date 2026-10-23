// Технический перерыв: пока включён, новые ставки во всех играх отклоняются (одной проверкой в диспетчере),
// начатые раунды и бонусы доигрываются, чат работает. Флаг лежит в data/maintenance.json и переживает перезапуск.
const fs = require('node:fs');

const MAX_TEXT = 200;
const MAX_HOURS = 72;
const DEFAULT_TEXT = 'Чиним и подкручиваем зал. Фишки на месте — скоро вернёмся!';

// Сообщения, которыми начинается новая ставка. Ходы внутри раунда (hit, pick, cashout, *_done) не трогаем.
const BET_TYPES = new Set([
  'crash_bet', 'roulette_bet', 'wheel_bet', 'bomb_join', 'bomb_deposit',
  'pool_invite', 'pool_accept', 'duel_invite', 'duel_accept',
  'upgrade_spin', 'mines_start', 'blackjack_start', 'plinko_drop', 'verity_play', 'poker_join',
  'kraken_spin', 'saloon_spin', 'yokai_spin', 'circus_spin',
]);

function createMaintenance({ file = null, now = Date.now, broadcast = () => {} } = {}) {
  let state = { on: false, text: '', until: 0, allow: [] };

  if (file) {
    try {
      const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
      state = { ...state, ...saved, allow: Array.isArray(saved.allow) ? saved.allow.map(String) : [] };
    } catch {}
  }

  function save() {
    if (!file) return;
    try {
      fs.writeFileSync(`${file}.tmp`, JSON.stringify(state, null, 2));
      fs.renameSync(`${file}.tmp`, file);
    } catch (err) {
      console.error('Не удалось сохранить перерыв:', err.message);
    }
  }

  // Для клиентов: без списка тех, кому можно играть.
  function view() {
    return { type: 'maintenance', on: state.on, text: state.on ? (state.text || DEFAULT_TEXT) : '', until: state.on ? state.until : 0 };
  }

  // { on, text?, until? (мс, 0 — без времени), allow? (id игроков, которым можно играть) }
  function set({ on, text = '', until = 0, allow = [] } = {}) {
    if (typeof on !== 'boolean') return { error: 'Нужно on: true или false' };
    if (on) {
      const t = String(text || '').replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT);
      const u = Number(until) || 0;
      if (u && (u <= now() || u > now() + MAX_HOURS * 3600_000)) return { error: `Время возвращения — в ближайшие ${MAX_HOURS} ч` };
      state = { on: true, text: t, until: u, allow: [...new Set((Array.isArray(allow) ? allow : []).map(String))] };
    } else {
      state = { on: false, text: '', until: 0, allow: [] };
    }
    save();
    broadcast(view());
    return { ok: true, maintenance: adminState() };
  }

  // Текст ошибки, если это сообщение — новая ставка, а зал на перерыве; иначе null.
  function blocks(player, type) {
    if (!state.on || !BET_TYPES.has(type)) return null;
    if (player && state.allow.includes(player.id)) return null;
    return 'Технический перерыв: новые ставки временно не принимаются. Чат работает!';
  }

  function adminState() {
    return { on: state.on, text: state.text, until: state.until, allow: [...state.allow] };
  }

  return { view, set, blocks, adminState, isOn: () => state.on };
}

module.exports = { createMaintenance, BET_TYPES, DEFAULT_TEXT };
