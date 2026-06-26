/**
 * 냉장GO 앱 설정
 * 쿠팡 파트너스 연동 시 affiliateId, trackingCode 를 입력하세요.
 */
(function initAppConfig() {
  const isBrowser = typeof window !== 'undefined' && window.location;
  const hostname = isBrowser ? window.location.hostname : 'localhost';
  const origin = isBrowser ? window.location.origin : '';
  const isLocalDev = hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '[::1]';
  const isVercel = !isLocalDev && (hostname.endsWith('.vercel.app') || hostname.includes('vercel.app'));

  /**
   * API 베이스 URL
   * - 로컬: serve.sh (localhost:8765) → 상대 경로 (/api/...)
   * - Vercel/배포: 같은 origin → 상대 경로 (/api/...)
   * - localhost는 배포 환경에서 절대 사용하지 않음
   */
  function resolveApiBaseUrl() {
    const injected = isBrowser ? window.__NAENGJANGGO_API_BASE__ : '';
    if (injected) {
      const base = String(injected).replace(/\/$/, '');
      if (!isLocalDev && /localhost|127\.0\.0\.1/i.test(base)) {
        console.warn('[냉장GO] 배포 환경에서 localhost API URL이 무시됩니다. same-origin을 사용합니다.');
        return '';
      }
      return base;
    }
    return '';
  }

  const apiBaseUrl = resolveApiBaseUrl();

  function buildApiUrl(path) {
    const normalized = path.startsWith('/') ? path : `/${path}`;
    return apiBaseUrl ? `${apiBaseUrl}${normalized}` : normalized;
  }

  window.APP_CONFIG = {
    coupang: {
      enabled: true,
      affiliateId: 'AF9834676',
      trackingCode: '',
      searchUrlTemplate: 'https://www.coupang.com/np/search?q={query}',
      affiliateSearchUrlTemplate:
        'https://link.coupang.com/a/{affiliateId}?lptag={affiliateId}&subid={trackingCode}&pageKey=789&traceName=Search&searchKeyword={query}',
    },
    openai: {
      enabled: false,
      apiKey: '',
      model: 'gpt-4o-mini',
      endpoint: 'https://api.openai.com/v1/chat/completions',
    },
    videoExtract: {
      apiBaseUrl,
      youtubeRecipeApiUrl: buildApiUrl('/api/extract-youtube-recipe'),
      aiUsageApiUrl: buildApiUrl('/api/ai-usage'),
      dailyLimit: 5,
      enableMock: false,
    },
    runtime: {
      isLocalDev,
      isVercel,
      hostname,
      origin,
    },
  };
})();
