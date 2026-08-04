// ────────────────────────────────────────────────────────────
//  서비스워커 — 오프라인 지원
//
//  예전엔 이 코드를 index.html 안에서 blob: 주소로 등록하려 했는데,
//  브라우저가 blob: 로는 서비스워커 등록을 거부해서 한 번도 동작한 적이 없어요.
//  그래서 진짜 파일로 분리했습니다.
//
//  전략이 두 가지예요:
//   - 앱 화면(HTML): 네트워크 우선. 그래야 새로 배포한 버전이 바로 보여요.
//                    인터넷이 없으면 캐시에 둔 마지막 버전을 보여줍니다.
//   - 라이브러리/폰트(CDN): 캐시 우선. 잘 안 바뀌는 것들이라 빠르게 띄우는 게 이득.
//
//  API 호출(AI 서버, Firebase)은 캐시하지 않아요. 오래된 답을 돌려주면
//  안 되고, POST 요청은 Cache API 가 아예 저장하지 못합니다.
// ────────────────────────────────────────────────────────────
const CACHE = 'ht-v2';

// 설치할 때 미리 받아둘 것들. 하나라도 실패해도 설치는 계속돼요.
const PRECACHE = [
  './',
  './index.html',
  'https://cdn.jsdelivr.net/npm/chart.js@4.4.0/dist/chart.umd.min.js',
  'https://unpkg.com/lucide@latest',
  'https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard-dynamic-subset.css',
];

// 캐시하면 안 되는 곳 (실시간 데이터라 오래된 답이 해로움)
const NEVER_CACHE = [
  'firestore.googleapis.com',
  'identitytoolkit.googleapis.com',
  'securetoken.googleapis.com',
  'googleapis.com/identitytoolkit',
  '/api/',                      // AI 중계 서버
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      // addAll 은 하나만 실패해도 전부 실패해서, 각각 따로 담아요
      .then(c => Promise.all(PRECACHE.map(u =>
        c.add(new Request(u, { mode: 'no-cors' })).catch(() => {})
      )))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;

  // GET 이 아닌 요청(POST 등)은 손대지 않아요. Cache API 가 저장하지 못해서
  // 예전 코드는 여기서 조용히 에러를 냈습니다.
  if (req.method !== 'GET') return;

  const url = req.url;
  if (NEVER_CACHE.some(bad => url.includes(bad))) return;

  // 앱 화면은 네트워크 우선 — 새 배포를 놓치지 않기 위해
  const isPage = req.mode === 'navigate' ||
                 (req.destination === 'document') ||
                 url.endsWith('/index.html');
  if (isPage) {
    e.respondWith(
      fetch(req)
        .then(res => {
          const clone = res.clone();
          caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
          return res;
        })
        .catch(() => caches.match(req).then(r => r || caches.match('./index.html')))
    );
    return;
  }

  // 나머지(라이브러리·폰트·이미지)는 캐시 우선
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const clone = res.clone();
      caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
      return res;
    }).catch(() => hit))
  );
});
