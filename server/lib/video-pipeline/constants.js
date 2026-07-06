/** 영상 레시피 추출 — 공통 UI/오류 문구 (Recime-style 확장 구조) */

export const VideoPlatform = {
  YOUTUBE: 'youtube',
  YOUTUBE_SHORTS: 'youtube_shorts',
  INSTAGRAM_REELS: 'instagram_reels',
  TIKTOK: 'tiktok',
  UNKNOWN: 'unknown',
};

export const PLATFORM_LABELS = {
  [VideoPlatform.YOUTUBE]: 'YouTube',
  [VideoPlatform.YOUTUBE_SHORTS]: 'YouTube Shorts',
  [VideoPlatform.INSTAGRAM_REELS]: 'Instagram Reels',
  [VideoPlatform.TIKTOK]: 'TikTok',
  [VideoPlatform.UNKNOWN]: '영상',
};

export const VIDEO_EXTRACT_UI = {
  FALLBACK_MSG:
    '자동 추출이 어려운 영상이에요. 영상 설명글, 자막, 고정 댓글을 붙여넣으면 정리해드릴게요.',
  YOUTUBE_AUTO_HINT: 'YouTube·Shorts는 링크만으로 자동 추출을 시도합니다.',
  INSTAGRAM_HINT:
    'Instagram Reels는 링크만으로는 캡션을 가져오기 어려울 수 있어요. 캡션을 함께 붙여넣으면 정확합니다.',
  TIKTOK_HINT:
    'TikTok은 링크만으로는 추출이 어려울 수 있어요. 캡션·설명을 붙여넣어 주세요.',
  PARTIAL_CAPTION_HINT: '영상 설명글, 자막, 고정 댓글을 함께 붙여넣으면 더 정확합니다.',
  AUTO_EXTRACT_FAILED: '영상 정보를 자동으로 읽지 못해 입력된 텍스트 기준으로 분석했습니다.',
  PARTIAL_INGREDIENTS: '재료를 자동으로 추출하지 못했어요. 검토 화면에서 직접 추가해 주세요.',
  PARTIAL_STEPS: '조리 순서를 자동으로 추출하지 못했어요. 검토 화면에서 직접 추가해 주세요.',
};

/** API 라우팅용 — youtube / youtube_shorts → youtube 백엔드 */
export function resolveBackendPlatform(platform) {
  if (platform === VideoPlatform.YOUTUBE_SHORTS) return VideoPlatform.YOUTUBE;
  if (platform === VideoPlatform.INSTAGRAM_REELS) return 'instagram';
  return platform;
}

export function supportsAutoExtract(platform) {
  return platform === VideoPlatform.YOUTUBE || platform === VideoPlatform.YOUTUBE_SHORTS;
}

export function getPlatformHint(platform) {
  if (platform === VideoPlatform.YOUTUBE || platform === VideoPlatform.YOUTUBE_SHORTS) {
    return VIDEO_EXTRACT_UI.YOUTUBE_AUTO_HINT;
  }
  if (platform === VideoPlatform.INSTAGRAM_REELS) return VIDEO_EXTRACT_UI.INSTAGRAM_HINT;
  if (platform === VideoPlatform.TIKTOK) return VIDEO_EXTRACT_UI.TIKTOK_HINT;
  return VIDEO_EXTRACT_UI.PARTIAL_CAPTION_HINT;
}
