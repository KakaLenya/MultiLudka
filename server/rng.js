// Единая точка случайности. Только crypto, никакого Math.random.
const crypto = require('node:crypto');

// Целое в [min, max] включительно.
function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

// Число в [0, 1) с 48 битами точности.
function randomFloat() {
  return crypto.randomBytes(6).readUIntBE(0, 6) / 2 ** 48;
}

function randomToken(bytes = 24) {
  return crypto.randomBytes(bytes).toString('base64url');
}

module.exports = { randomInt, randomFloat, randomToken };
