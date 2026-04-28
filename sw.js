const CACHE = 'splitpay-v1';
const ASSETS = [
  '/splitpay/',
  '/splitpay/index.html',
  '/splitpay/style.css',
  '/splitpay/app.js',
  '/splitpay/manifest.json',
  'https://fonts.googleapis.com/css2?family=DM+Sans:wght@400;500;600&family=DM+Mono:wght@400;500&display=swap',
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});

self.addEventListener('fetch', e => {
  // Let Drive API requests go through always
  if (e.request.url.includes('googleapis.com') || e.request.url.includes('accounts.google.com') || e.request.url.includes('anthropic.com')) {
    return;
  }
  e.respondWith(caches.match(e.request).then(cached => cached || fetch(e.request)));
});
