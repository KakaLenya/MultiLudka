// Воркер Cloudflare перед залом: всё пропускает к ноутбуку (через туннель casino) как есть, включая WebSocket.
// Если зал не отвечает (ноутбук выключен, туннель или node лежат) — вместо серой ошибки Cloudflare
// отдаёт страницу «Технический перерыв» (та же public/offline.html), которая сама проверяет /healthz и перезагружается.
import PAGE from '../../public/offline.html';

// 502/503/504 — node не отвечает за туннелем; 520–527 — ошибки соединения; 530 (1033) — туннель не подключён.
const DOWN = new Set([502, 503, 504, 520, 521, 522, 523, 524, 525, 526, 527, 530]);

function maintenance(request) {
  const wantsHtml = request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html');
  const headers = { 'Cache-Control': 'no-store', 'Retry-After': '10' };
  if (wantsHtml) return new Response(PAGE, { status: 503, headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' } });
  return new Response(JSON.stringify({ ok: false, error: 'Технический перерыв' }), {
    status: 503,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  });
}

export default {
  async fetch(request) {
    // WebSocket: отдаём ответ origin как есть (101 + сокет). Клиент сам переподключается с паузой.
    if ((request.headers.get('upgrade') || '').toLowerCase() === 'websocket') {
      try {
        return await fetch(request);
      } catch {
        return new Response('Технический перерыв', { status: 503 });
      }
    }
    let res;
    try {
      res = await fetch(request);
    } catch {
      return maintenance(request);
    }
    return DOWN.has(res.status) ? maintenance(request) : res;
  },
};
