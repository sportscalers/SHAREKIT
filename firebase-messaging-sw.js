// firebase-messaging-sw.js
// Must live at the site root (not /api or /lib) — browsers require the
// service worker scope to cover the pages it protects.
//
// Config is passed as URL query params at registration time, e.g.:
//   navigator.serviceWorker.register(
//     `/firebase-messaging-sw.js?apiKey=${cfg.apiKey}&projectId=${cfg.projectId}&messagingSenderId=${cfg.messagingSenderId}&appId=${cfg.appId}`
//   );
// This avoids hardcoding values into a static file with no build step.

importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.13.0/firebase-messaging-compat.js');

const params = new URLSearchParams(self.location.search);

firebase.initializeApp({
  apiKey: params.get('apiKey'),
  projectId: params.get('projectId'),
  messagingSenderId: params.get('messagingSenderId'),
  appId: params.get('appId'),
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage((payload) => {
  const title = payload.notification?.title || 'ShareKit';
  const options = {
    body: payload.notification?.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
  };
  self.registration.showNotification(title, options);
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(clients.openWindow('https://sharekit.in/'));
});
