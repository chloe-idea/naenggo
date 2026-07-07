/**
 * 냉장GO Service Worker — 오프라인 정적 자산 캐시
 * JS/CSS 요청에는 HTML을 절대 반환하지 않습니다.
 */
const CACHE_NAME = 'naengjanggo-v67';

const ASSETS = [
  'index.html',
  'app-config.js?v=47',
  'style.css?v=85',
  'script.js?v=81',
  'js/firebase.js',
  'js/firebase-config.js',
  'js/firebase-bootstrap.js?v=50',
  'js/services/auth-service.js',
  'js/services/auth-errors.js',
  'js/services/firestore-user-service.js',
  'js/services/firestore-ingredient-service.js',
  'js/services/pantry-local-migration.js',
  'js/services/auth-gate-controller.js',
  'js/services/analysis-quota-service.js',
  'nav-icons.js?v=30',
  'recipe-placeholders.js?v=30',
  'recipe-images.js?v=49',
  'recipes-builtin.js?v=30',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/icon-180.png',
  'src/assets/recipe-images/default.png',
  'src/assets/recipe-images/egg.png',
  'src/assets/recipe-images/tomato-egg.png',
  'src/assets/recipe-images/pasta.png',
  'src/assets/recipe-images/stew.png',
  'src/assets/recipe-images/rice.png',
  'src/assets/recipe-images/potato.png',
  'src/assets/recipe-images/noodle.png',
  'src/assets/recipe-images/soup.png',
  'src/assets/recipe-images/stir-fry.png',
];

function assetUrl(path) {
  return new URL(path, self.location).href;
}

function isFirebaseOrModuleRequest(url) {
  return url.pathname.startsWith('/js/')
    || url.pathname.includes('firebase-config')
    || url.hostname.includes('gstatic.com')
    || url.hostname.includes('googleapis.com');
}

self.addEventListener('message', (event) => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => Promise.allSettled(ASSETS.map((path) => cache.add(assetUrl(path)))))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;

  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin && !url.hostname.includes('gstatic.com')) return;

  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          if (response.ok) {
            const copy = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
          }
          return response;
        })
        .catch(() => caches.match(assetUrl('index.html'))),
    );
    return;
  }

  // Firebase/JS 모듈: 네트워크 우선 (캐시 stale 방지)
  if (isFirebaseOrModuleRequest(url)) {
    event.respondWith(
      fetch(event.request).catch(() => caches.match(event.request)),
    );
    return;
  }

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, copy));
        }
        return response;
      })
      .catch(() => caches.match(event.request)),
  );
});
