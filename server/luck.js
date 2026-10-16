// Режим везения (админ): у игрока с везением N% каждый исход с вероятностью N% подкручивается в его пользу,
// в остальных случаях игра идёт честно. Хранится в data/luck.json, переживает перезапуск.
const fs = require('node:fs');
const { writeAtomic } = require('./players');
const { randomFloat } = require('./rng');

function createLuck({ file = null, random = randomFloat } = {}) {
  let percents = {};   // playerId -> 1..100

  if (file && fs.existsSync(file)) {
    try {
      const data = JSON.parse(fs.readFileSync(file, 'utf8'));
      if (data && typeof data.percents === 'object') percents = data.percents;
    } catch (err) {
      console.error(`${file} не прочитан, везение сброшено:`, err.message);
    }
  }

  function save() {
    if (file) writeAtomic(file, JSON.stringify({ percents }, null, 2));
  }

  // percent: 1..100 — включить, 0 или null — выключить.
  function set(playerId, percent) {
    if (percent === null || percent === 0) {
      delete percents[playerId];
    } else {
      if (!Number.isInteger(percent) || percent < 1 || percent > 100) return { error: 'Везение: от 1 до 100%' };
      percents[playerId] = percent;
    }
    save();
    return { ok: true };
  }

  return {
    set,
    percentOf: (playerId) => percents[playerId] || 0,
    // Повезло ли игроку прямо сейчас (бросок на каждый исход).
    roll: (player) => {
      const p = player ? percents[player.id] : 0;
      return !!p && random() * 100 < p;
    },
    forget: (playerId) => {
      if (percents[playerId]) {
        delete percents[playerId];
        save();
      }
    },
  };
}

module.exports = { createLuck };
