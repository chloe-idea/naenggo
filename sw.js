/**
 * 냉장GO Service Worker — 오프라인 정적 자산 캐시
 * JS/CSS 요청에는 HTML을 절대 반환하지 않습니다.
 */
const CACHE_NAME = 'naengjanggo-v207';

const RECIPE_IMAGE_SLUGS = [
  'sweet-potato-fries', 'potato-fries', 'sweet-potato-sticks', 'egg-white-omelet', 'potato-pancake', 'potato-cheese-bake', 'egg-in-hell',
  'tuna-rice-ball', 'sesame-seaweed-fried-rice', 'natto-rice-bowl', 'scrambled-eggs', 'tuna-mayo-rice-ball', 'spam-rice-ball',
  'kimchi-rice-ball', 'cheese-rice-ball', 'ramen', 'tofu-salad', 'tuna-salad', 'egg-soup-diet',
  'onion-egg-stir-fry', 'onion-stir-fry', 'onion-egg-rice-bowl', 'cheese-pancake', 'cold-pasta', 'ramen-snack',
];

const ASSETS = [
  'index.html',
  'app-config.js?v=57',
  'style.css?v=159',
  'script.js?v=182',
  'js/firebase.js',
  'js/firebase-config.js',
  'js/firebase-bootstrap.js?v=69',
  'js/services/auth-service.js',
  'js/services/auth-errors.js',
  'js/services/firestore-user-service.js',
  'js/services/firestore-ingredient-service.js',
  'js/services/pantry-local-migration.js',
  'js/services/auth-gate-controller.js',
  'js/ingredient-emoji.js?v=1',
  'js/login-required-modal.js?v=67',
  'nav-icons.js?v=30',
  'recipe-placeholders.js?v=30',
  'recipe-images.js?v=57',
  'js/data/builtin-recipes.js?v=1',
  'manifest.json',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/icon-512-maskable.png',
  'icons/icon-180.png',
  'images/recipes/default-recipe.webp',
  'images/recipes/default-recipe.png',
  ...RECIPE_IMAGE_SLUGS.map((slug) => `images/recipes/${slug}.webp`),
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
