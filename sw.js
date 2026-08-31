const CACHE = 'donezo-shell-v21';
const ASSETS = [
  '/',
  '/index.html',
  '/pwa.js',
  '/tokens.css',
  '/styles.css',
  '/components.css',
  '/social.css',
  '/app.js',
  '/manifest.webmanifest',
  '/icon.svg',
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(
    ASSETS.map((path) => new Request(path, { cache: 'reload' })),
  )));
  // Keep the worker waiting until the page explicitly accepts the update.
});

self.addEventListener('activate', (event) => {
  event.waitUntil(Promise.all([
    caches.keys().then((keys) => Promise.all(
      keys.filter((key) => key !== CACHE).map((key) => caches.delete(key)),
    )),
    self.clients.claim(),
  ]));
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') event.waitUntil(self.skipWaiting());
});

async function networkFirstNavigation(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (await cache.match('/index.html')) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);
  const network = fetch(request).then(async (response) => {
    if (response.ok) await cache.put(request, response.clone());
    return response;
  }).catch(() => null);
  return cached || (await network) || Response.error();
}

async function networkFirstShellAsset(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(new Request(request, { cache: 'no-store' }));
    if (response.ok) await cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || Response.error();
  }
}

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin || requestUrl.pathname.startsWith('/api/')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(networkFirstNavigation(event.request));
    return;
  }

  // App code and styles must be fresh when online. Serving a cached bundle here
  // can pair fresh HTML with stale behavior immediately after an accepted update.
  if (['script', 'style'].includes(event.request.destination)) {
    event.respondWith(networkFirstShellAsset(event.request));
    return;
  }

  if (['image', 'font'].includes(event.request.destination)) {
    event.respondWith(staleWhileRevalidate(event.request));
    return;
  }

  event.respondWith(fetch(event.request).catch(async () => {
    const cached = await caches.match(event.request);
    return cached || Response.error();
  }));
});

self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data?.json() || {};
  } catch {
    payload = { body: event.data?.text() || 'Your squad is calling you out.' };
  }
  event.waitUntil(self.registration.showNotification(payload.title || 'Donezo ⚡', {
    body: payload.body || 'Lock in bro 😭',
    icon: '/icon.svg',
    badge: '/icon.svg',
    tag: payload.tag || 'donezo-push',
    data: { url: payload.url || '/?nudges=1' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = event.notification.data?.url || '/';
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (clients) => {
    const existing = clients.find((client) => 'focus' in client);
    if (existing) {
      if ('navigate' in existing) await existing.navigate(target);
      return existing.focus();
    }
    return self.clients.openWindow(target);
  }));
});
