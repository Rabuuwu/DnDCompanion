const CACHE_NAME = 'dnd-mobile-cache-v26';
const SCOPE_PATH = new URL(self.registration.scope).pathname;
const scopedPath = (file = '') => `${SCOPE_PATH}${file}`;
const APP_SHELL = [
  scopedPath(),
  scopedPath('index.html'),
  scopedPath('manifest.webmanifest'),
  scopedPath('app-icon-192.png'),
  scopedPath('app-icon-512.png'),
  scopedPath('app-icon-maskable-512.png'),
  scopedPath('app-icon-1024.png'),
  scopedPath('apple-touch-icon.png'),
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)));
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))))
  );
  self.clients.claim();
});

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const route = {
    ...(event.notification.data || {}),
    action: event.action || undefined,
  };

  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    const appWindow = windows.find((client) => new URL(client.url).pathname.startsWith(SCOPE_PATH));
    if (appWindow) {
      appWindow.postMessage({ type: 'OPEN_NOTIFICATION', route });
      return appWindow.focus();
    }

    const params = new URLSearchParams();
    params.set('notification', route.type || '');
    if (route.friendId) params.set('friendId', route.friendId);
    if (route.username) params.set('username', route.username);
    if (route.invitationId) params.set('invitationId', route.invitationId);
    if (route.campaignName) params.set('campaignName', route.campaignName);
    if (route.inviterUsername) params.set('inviterUsername', route.inviterUsername);
    if (route.action) params.set('action', route.action);
    return clients.openWindow(`${scopedPath()}?${params.toString()}`);
  })());
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const requestUrl = new URL(event.request.url);
  if (requestUrl.origin !== self.location.origin) return;
  if (
    requestUrl.pathname.startsWith('/api/')
    || requestUrl.pathname === '/health'
    || requestUrl.pathname === '/ready'
  ) return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy)));
        }
        return response;
      })
      .catch(async () => {
        const cached = await caches.match(event.request);
        if (cached) return cached;
        if (event.request.mode === 'navigate') {
          return caches.match(scopedPath('index.html'));
        }
        return Response.error();
      })
  );
});
