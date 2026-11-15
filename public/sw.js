/* Quick Print Shop — receives phone notifications when the site is closed */
self.addEventListener('install', (event) => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = { title: 'Quick Print Shop', body: 'New order' };
  try { data = event.data ? event.data.json() : data; } catch (e) { /* keep default */ }
  event.waitUntil(self.registration.showNotification(data.title || 'Quick Print Shop', {
    body: data.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    vibrate: [120, 60, 120],
    tag: 'quickprint-order',
    renotify: true,
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: 'window' }).then((list) => {
    for (const client of list) {
      if ('focus' in client) return client.focus();
    }
    return clients.openWindow('/owner');
  }));
});
