// Страницы зала с метками версий у своих скриптов и стилей: client.js → client.js?v=<время изменения>.
// Cloudflare отдаёт статику с кэшем браузера на 4 часа, а страницу — без кэша. Без меток телефон брал
// новую страницу со старым client.js, и новые вкладки не открывались. С метками новый файл — новый адрес.
const fs = require('node:fs');
const path = require('node:path');

// Только свои .js и .css без запроса: внешние адреса (https:) и уже помеченные не трогаем.
const ASSET = /(src|href)="([^":?#]+\.(?:js|css))"/g;

function stampHtml(html, publicDir) {
  return html.replace(ASSET, (whole, attr, url) => {
    try {
      const { mtimeMs } = fs.statSync(path.join(publicDir, url));
      return `${attr}="${url}?v=${Math.round(mtimeMs).toString(36)}"`;
    } catch {
      return whole;
    }
  });
}

// Обработчик express для одной страницы из publicDir.
function stampedPage(publicDir, name) {
  return (req, res, next) => {
    let html;
    try {
      html = fs.readFileSync(path.join(publicDir, name), 'utf8');
    } catch {
      return next();
    }
    res.set('Cache-Control', 'no-cache');
    res.type('html').send(stampHtml(html, publicDir));
  };
}

module.exports = { stampHtml, stampedPage };
