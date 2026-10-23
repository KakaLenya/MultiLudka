// Service worker зала. Код (страница, js, css) — всегда из сети, кэш только запасной:
// так новая версия client.js доходит до игрока сразу, без «застрявших» файлов.
// Картинки и шрифты — stale-while-revalidate, сэмплы музыки — cache-first (они не меняются).
// WebSocket сюда не попадает; /admin*, /music-files, /healthz и сам sw.js не трогаем.
'use strict';

const VERSION = 'v4'; // поднять при изменении логики этого файла
const SHELL = `shell-${VERSION}`;
const STATIC = `static-${VERSION}`;
const SAMPLES = 'samples-v1'; // переживает смену VERSION: 12 МБ сэмплов не качаем заново
const SAMPLES_MAX = 600;
const OFFLINE = '/offline.html';
const PRECACHE = [OFFLINE, '/manifest.webmanifest', '/icons/icon-192.png', '/favicon.ico'];

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL);
    await cache.addAll(PRECACHE.map((u) => new Request(u, { cache: 'reload' })));
    // Оболочка: страница и все её скрипты и стили — чтобы при обрыве сети было что показать.
    try {
      const res = await fetch('/', { cache: 'no-cache' });
      if (res.ok) {
        const html = await res.clone().text();
        await cache.put('/', res);
        // Скрипты и стили на странице с метками версий (client.js?v=…, см. server/pages.js).
        const urls = [...html.matchAll(/(?:src|href)="([^":?#]+\.(?:js|css)(?:\?v=[^"#]*)?)"/g)].map((m) => new URL(m[1], self.location.origin).href);
        const stat = await caches.open(STATIC);
        await Promise.all([...new Set(urls)].map((u) => fetch(u, { cache: 'no-cache' }).then((r) => r.ok && stat.put(u, r)).catch(() => {})));
      }
    } catch {}
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keep = new Set([SHELL, STATIC, SAMPLES]);
    for (const key of await caches.keys()) if (!keep.has(key)) await caches.delete(key);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET' || req.headers.has('range')) return;
  const url = new URL(req.url);

  if (url.origin === self.location.origin) {
    const p = url.pathname;
    if (p.startsWith('/admin') || p.startsWith('/music-files') || p === '/sw.js' || p === '/healthz') return;
    if (req.mode === 'navigate') return event.respondWith(page(req));
    if (p.startsWith('/samples/')) return event.respondWith(cacheFirst(req, SAMPLES, SAMPLES_MAX));
    if (/\.(?:js|css|html|webmanifest|json)$/.test(p) || p === '/') return event.respondWith(networkFirst(req, STATIC));
    return event.respondWith(staleWhileRevalidate(req, STATIC, event));
  }
  if (url.hostname === 'fonts.gstatic.com') return event.respondWith(cacheFirst(req, STATIC));
  if (url.hostname === 'fonts.googleapis.com') return event.respondWith(staleWhileRevalidate(req, STATIC, event));
});

// Страница: сеть; если сети нет или сервер зала лежит (502/530/1033 от Cloudflare) — экран «Технический перерыв».
async function page(req) {
  try {
    const res = await fetch(req);
    if (res.status < 500) {
      if (res.ok && new URL(req.url).pathname === '/') caches.open(SHELL).then((c) => c.put('/', res.clone()));
      return res;
    }
  } catch {}
  return (await caches.match(OFFLINE)) || new Response('Нет связи с залом', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}

async function networkFirst(req, name) {
  const cache = await caches.open(name);
  try {
    const res = await fetch(req, { cache: 'no-cache' });
    if (res.ok) cache.put(req, res.clone());
    if (res.status >= 500) {
      // Зал лежит: отдаём последнюю рабочую версию файла, а не ошибку Cloudflare.
      const hit = await cache.match(req, { ignoreSearch: true });
      if (hit) return hit;
    }
    return res;
  } catch (err) {
    const hit = (await cache.match(req, { ignoreSearch: true })) || (await caches.match(req, { ignoreSearch: true }));
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, name, max) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok || res.type === 'opaque') {
    await cache.put(req, res.clone());
    if (max) trim(cache, max);
  }
  return res;
}

async function staleWhileRevalidate(req, name, event) {
  const cache = await caches.open(name);
  const hit = await cache.match(req);
  const fresh = fetch(req).then((res) => {
    if (res.ok || res.type === 'opaque') return cache.put(req, res.clone()).then(() => res);
    return res;
  });
  if (hit) {
    event.waitUntil(fresh.catch(() => {}));
    return hit;
  }
  return fresh;
}

async function trim(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}
