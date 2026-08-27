const CACHE = 'donezo-shell-v1';
const ASSETS = ['/', '/index.html', '/styles.css', '/src/app.js', '/src/store.js', '/src/domain.js', '/src/demo-data.js', '/src/notifications.js', '/manifest.webmanifest', '/icon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith(fetch(event.request).catch(() => caches.match(event.request).then((r) => r || caches.match('/'))));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clients) => {
    if (clients[0]) return clients[0].focus();
    return self.clients.openWindow('/');
  }));
});
