const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { stampHtml } = require('../server/pages');

test('страница: свои скрипты и стили с меткой версии, внешние и чужие ссылки без изменений', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pages-'));
  fs.writeFileSync(path.join(dir, 'client.js'), 'x');
  fs.mkdirSync(path.join(dir, 'kraken'));
  fs.writeFileSync(path.join(dir, 'kraken', 'kraken.css'), 'x');
  const html = [
    '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope">',
    '<link rel="stylesheet" href="kraken/kraken.css">',
    '<link rel="manifest" href="/manifest.webmanifest">',
    '<script src="client.js"></script>',
    '<script src="missing.js"></script>',
    '<script src="done.js?v=1"></script>',
  ].join('\n');
  const out = stampHtml(html, dir);
  const v = (f) => Math.round(fs.statSync(path.join(dir, f)).mtimeMs).toString(36);
  assert.match(out, new RegExp(`href="kraken/kraken.css\\?v=${v('kraken/kraken.css')}"`));
  assert.match(out, new RegExp(`src="client.js\\?v=${v('client.js')}"`));
  assert.ok(out.includes('href="https://fonts.googleapis.com/css2?family=Manrope"'));
  assert.ok(out.includes('href="/manifest.webmanifest"'));
  assert.ok(out.includes('src="missing.js"'), 'нет файла — как было');
  assert.ok(out.includes('src="done.js?v=1"'));
  // Файл изменился — метка другая.
  const before = v('client.js');
  const t = new Date(Date.now() + 5000);
  fs.utimesSync(path.join(dir, 'client.js'), t, t);
  assert.notEqual(stampHtml(html, dir).match(/client\.js\?v=([^"]+)/)[1], before);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('настоящие страницы зала: все свои скрипты получают метку', () => {
  const pub = path.join(__dirname, '../public');
  for (const page of ['index.html', 'admin.html']) {
    const out = stampHtml(fs.readFileSync(path.join(pub, page), 'utf8'), pub);
    const bare = [...out.matchAll(/(?:src|href)="([^":?#]+\.(?:js|css))"/g)].map((m) => m[1]);
    assert.deepEqual(bare, [], `${page}: без метки ${bare.join(', ')}`);
  }
});
