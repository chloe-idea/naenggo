/**
 * 냉장GO 앱 설정
 * 쿠팡 파트너스 연동 시 affiliateId, trackingCode 를 입력하세요.
 */
window.APP_CONFIG = {
  coupang: {
    /** false 로 설정하면 구매하기 버튼 숨김 */
    enabled: true,
    /** 쿠팡 파트너스 AF ID (예: AF1234567) */
    affiliateId: 'AF9834676',
    /** 추적용 서브 ID / 캠페인 코드 */
    trackingCode: '',
    /** affiliateId 없을 때 사용하는 일반 검색 URL. {query} = 검색어 */
    searchUrlTemplate: 'https://www.coupang.com/np/search?q={query}',
    /**
     * affiliateId 있을 때 사용하는 제휴 검색 URL
     * {affiliateId}, {trackingCode}, {query} 치환
     */
    affiliateSearchUrlTemplate:
      'https://link.coupang.com/a/{affiliateId}?lptag={affiliateId}&subid={trackingCode}&pageKey=789&traceName=Search&searchKeyword={query}',
  },
  /** OpenAI API — 붙여넣기 텍스트 로컬 분석 fallback (apiKey 없으면 로컬 파서 사용) */
  openai: {
    enabled: false,
    apiKey: '',
    model: 'gpt-4o-mini',
    endpoint: 'https://api.openai.com/v1/chat/completions',
  },
  /** 영상 레시피 추출 — YouTube는 서버 API 사용 */
  videoExtract: {
    /** YouTube 레시피 추출 API (POST { url, userId }) */
    youtubeRecipeApiUrl: '/api/extract-youtube-recipe',
    /** AI 일일 사용량 조회 API */
    aiUsageApiUrl: '/api/ai-usage',
    /** UI 표시용 (서버 AI_DAILY_LIMIT 과 동일하게) */
    dailyLimit: 5,
    /** 개발 테스트용 mock (true일 때만 mock 레시피 반환, UI에 테스트 데이터 표시) */
    enableMock: false,
  },
};
