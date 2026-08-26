self.addEventListener('push', (event) => {
  let data = { title: 'RestoAI', body: 'You have a new update.' };
  try {
    data = event.data.json();
  } catch {
    // ignore malformed payloads
  }
  event.waitUntil(
    self.registration.showNotification(data.title || 'RestoAI', {
      body: data.body || '',
      icon: '/favicon.ico',
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('/'));
});
