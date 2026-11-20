const CACHE_PREFIX = 'keuanganku:' + self.registration.scope + ':';
const CACHE_NAME = CACHE_PREFIX + '1';
const APP_URL = new URL('index.html', self.registration.scope).href;
const CORE_ASSETS = [
  'index.html',
  'style.css',
  'app.js',
  'manifest.webmanifest',
  'icons/apple-touch-icon.png',
  'icons/favicon.png',
  'icons/icon-128.png',
  'icons/icon-144.png',
  'icons/icon-152.png',
  'icons/icon-180.png',
  'icons/icon-192.png',
  'icons/icon-384.png',
  'icons/icon-512.png',
  'icons/icon-72.png',
  'icons/icon-96.png',
  'icons/icon-maskable-192.png',
  'icons/icon-maskable-512.png',
  'icons/icon.svg',
  'js/charts.js',
  'js/data.js',
  'js/export.js',
  'js/format.js',
  'js/ui.js',
  'vendor/chartjs/chart.umd.min.js',
  'vendor/fontawesome/css/all.min.css',
  'vendor/fontawesome/webfonts/fa-brands-400.woff2',
  'vendor/fontawesome/webfonts/fa-regular-400.woff2',
  'vendor/fontawesome/webfonts/fa-solid-900.woff2',
  'vendor/fontawesome/webfonts/fa-v4compatibility.woff2',
  'vendor/fonts/plus-jakarta-sans-cyrillic-ext.woff2',
  'vendor/fonts/plus-jakarta-sans-latin-ext.woff2',
  'vendor/fonts/plus-jakarta-sans-latin.woff2',
  'vendor/fonts/plus-jakarta-sans-vietnamese.woff2',
  'vendor/fonts/plus-jakarta-sans.css',
  'vendor/jspdf.plugin.autotable.min.js',
  'vendor/jspdf.umd.min.js',
].map(path => new URL(path, self.registration.scope).href);
const coreAssets = new Set(CORE_ASSETS);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(CORE_ASSETS)));
});

self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(names => Promise.all(
    names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
      .map(name => caches.delete(name))
  )));
});

self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  url.search = '';
  const isAppPage = request.mode === 'navigate'
    && (url.href === self.registration.scope || url.href === APP_URL);
  if (!isAppPage && !coreAssets.has(request.url)) return;

  const key = isAppPage ? APP_URL : request;
  event.respondWith(caches.open(CACHE_NAME).then(async cache => {
    let response;
    try {
      response = await fetch(request);
    } catch (error) {
      const cached = await cache.match(key);
      if (cached) return cached;
      throw error;
    }
    if (response.ok && !response.redirected) {
      await cache.put(key, response.clone()).catch(error => {
        console.warn('Gagal memperbarui cache offline:', error);
      });
    }
    return response;
  }));
});
