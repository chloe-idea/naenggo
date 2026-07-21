/**
 * 냉장GO v2 — 커뮤니티 확장 가능 구조
 *
 * 데이터 계층 (향후 Supabase/Firebase 교체 지점):
 *   StorageAdapter → PantryRepository / RecipeRepository / SavedRecipeRepository
 *
 * Recipe 스키마:
 *   id, name, ingredients[], steps[], cookTime, difficulty, category, cuisine, tags[], dietTags[],
 *   image, calories, memo, authorId, authorName, visibility('public'|'private'), source('builtin'|'user'),
 *   parentRecipeId, createdFrom, dishType, sourceUrl, sourcePlatform, thumbnailUrl,
 *   ingredientSubstitutes[], optionalIngredients[],
 *   createdAt, updatedAt
 */

// ===== 설정 =====
const CONFIG = {
  LOCAL_USER_ID: 'local-user',
  LOCAL_USER_NAME: '나',
  EXPIRY_SOON_DAYS: 3,
  STORAGE: {
    PANTRY: 'naengjanggo_v2_pantry',
    LEGACY_PANTRY: 'naengjanggo_pantry_ingredients',
    RECIPES: 'naengjanggo_v2_recipes',
    SAVED: 'naengjanggo_v2_saved',
    SAVE_COUNTS: 'naengjanggo_v2_save_counts',
    SAVE_COUNTS_USER_SYNC: 'naengjanggo_v2_save_counts_user_sync',
    MEALS: 'naengjanggo_v2_meals',
    SHOPPING: 'naengjanggo_v2_shopping',
    CURRENCY: 'naengjanggo_v2_currency',
    MONTHLY_FOOD_BUDGET: 'naengjanggo_v2_monthly_food_budget',
    MEAL_PLAN: 'naengjanggo_v2_meal_plan',
    GROCERY: 'naengjanggo_v2_grocery',
    HOME_PANTRY_EXPANDED: 'naengjanggo_v2_home_pantry_expanded',
    CLIENT_USER_ID: 'naengjanggo_v2_client_user_id',
    LEGACY_RECIPES: 'naengjanggo_user_recipes',
  },
};

const CURRENCY_OPTIONS = {
  KRW: { symbol: '₩', fractionDigits: 0 },
  USD: { symbol: '$', fractionDigits: 2 },
  JPY: { symbol: '¥', fractionDigits: 0 },
  AUD: { symbol: 'A$', fractionDigits: 2 },
  EUR: { symbol: '€', fractionDigits: 2 },
  GBP: { symbol: '£', fractionDigits: 2 },
};

const DEFAULT_CURRENCY = 'KRW';

const CATEGORY_MAP = {
  korean: { cuisine: 'korean', tags: ['한식'], dietTags: [] },
  western: { cuisine: 'western', tags: ['양식'], dietTags: [] },
  japanese: { cuisine: 'japanese', tags: ['일식'], dietTags: [] },
  chinese: { cuisine: 'chinese', tags: ['중식'], dietTags: [] },
  diet: { cuisine: 'korean', tags: ['다이어트'], dietTags: ['diet'] },
  'high-protein': { cuisine: 'korean', tags: ['고단백'], dietTags: ['high-protein'] },
};

const FILTERS = [
  { id: 'available', label: '🔥 바로 가능' },
  { id: 'expiring', label: '⚠️ 임박 재료 활용' },
  { id: 'one-missing', label: '🛒 1개만 사면 가능' },
  { id: 'high-protein', label: '💪 고단백' },
  { id: 'diet', label: '🥗 다이어트' },
  { id: 'snack', label: '🍪 간식' },
  { id: 'quick', label: '⏱️ 15분 이하' },
];

/** 홈 레시피 탐색에 항상 노출하는 필터 칩 (기존 FILTERS id 재사용) */
const HOME_EXPLORE_FILTERS = [
  { id: 'recommend', label: '추천' },
  { id: 'available', label: '바로 가능' },
  { id: 'one-missing', label: '1개만 더 필요' },
  { id: 'saved', label: '찜한 레시피' },
];

const HOME_BRIEFING_ICONS = {
  due: `<svg class="home-briefing__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M7 4v2M17 4v2M5 8h14v11a2 2 0 01-2 2H7a2 2 0 01-2-2V8z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><path d="M5 12h14" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
  ready: `<svg class="home-briefing__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M8 10V7a4 4 0 118 0v3M6 10h12l-1 9a2 2 0 01-2 1.5H9A2 2 0 017 19l-1-9z" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
  missing: `<svg class="home-briefing__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M3 5h2l1.4 8.4A2 2 0 008.4 15h8.3a2 2 0 001.96-1.6L20 7H6" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9" cy="19" r="1.25" fill="currentColor"/><circle cx="17" cy="19" r="1.25" fill="currentColor"/></svg>`,
  budget: `<svg class="home-briefing__svg" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 8.5A2.5 2.5 0 016.5 6h11A2.5 2.5 0 0120 8.5v7A2.5 2.5 0 0117.5 18h-11A2.5 2.5 0 014 15.5v-7z" stroke="currentColor" stroke-width="1.7"/><path d="M4 10h16M16 14h.01" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>`,
};

function pantryItemEmoji(name) {
  if (typeof IngredientEmojiUtil !== 'undefined') {
    return IngredientEmojiUtil.getIngredientEmoji(name);
  }
  return '🥬';
}

const VIEW_TITLES = {
  main: '집에 있는 재료로 만들 수 있는 요리를 찾아보세요',
  'my-recipes': '나만의 레시피를 관리하세요',
  pantry: '보유 재료를 상세 관리하세요',
  planner: '일주일 식단과 장보기 리스트를 준비하세요',
  calendar: '해먹은 음식을 기록하고 확인하세요',
  'author-profile': '작성자 프로필',
};

const MEAL_TYPES = [
  { id: 'home-cook', label: '직접 요리', emoji: '🍳' },
  { id: 'eat-out', label: '외식', emoji: '🍽️' },
  { id: 'delivery', label: '배달', emoji: '🛵' },
  { id: 'snack', label: '간식', emoji: '🍪' },
];

const PLANNER_SLOTS = [
  { id: 'breakfast', label: '아침', emoji: '🍳', menuEmoji: '🍳' },
  { id: 'lunch', label: '점심', emoji: '🍱', menuEmoji: '🍱' },
  { id: 'dinner', label: '저녁', emoji: '🍜', menuEmoji: '🌙' },
  { id: 'snack', label: '간식', emoji: '🍪', menuEmoji: '🍪' },
];

function normalizeMealType(type) {
  return MEAL_TYPES.some((t) => t.id === type) ? type : 'home-cook';
}


function isHomeCookMealType(type) {
  const raw = String(type || '').toLowerCase();
  if (raw === 'home-cooked' || raw === 'cooking') return true;
  return normalizeMealType(type) === 'home-cook';
}

function mealTypeInfo(type) {
  return MEAL_TYPES.find((t) => t.id === normalizeMealType(type)) || MEAL_TYPES[0];
}

const DEFAULT_IMAGE = 'data:image/svg+xml,' + encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300"><rect fill="#fff4ef" width="400" height="300"/><text x="200" y="165" text-anchor="middle" font-size="64">🍽️</text></svg>'
);

function normalizeIngredientName(name) {
  return String(name || '').trim().toLowerCase().replace(/\s/g, '');
}

/** @deprecated use normalizeIngredientName */
function normalizeIngredient(s) {
  return normalizeIngredientName(s);
}

const INGREDIENT_UNITS = [
  '큰술', '작은술', '숟가락', '티스푼', '스푼',
  '적당량', '약간', '꼬집',
  'kg', 'g', 'ml', 'L',
  '개', '대', '근', '컵', '줌', '장', '봉', '캔', '팩', '통', '알', '쪽', '조각',
];

const QUALITATIVE_AMOUNTS = new Set(['약간', '적당량', '꼬집']);

let _ingredientUnitPattern = null;
function getIngredientUnitPattern() {
  if (!_ingredientUnitPattern) {
    _ingredientUnitPattern = INGREDIENT_UNITS
      .map((u) => u.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))
      .join('|');
  }
  return _ingredientUnitPattern;
}

function formatIngredientDisplay(ing) {
  if (ing == null || ing === '') return '';
  if (typeof ing === 'string') return ing.trim();
  if (ing.originalText) {
    if (ing.optional && !/\(선택\)/.test(ing.originalText)) return `${ing.originalText} (선택)`;
    return ing.originalText;
  }
  const amountPart = ing.amount
    ? (ing.unit ? `${ing.amount}${ing.unit}` : String(ing.amount))
    : (ing.unit || '');
  const text = [ing.name, amountPart].filter(Boolean).join(' ').trim();
  if (!text) return '';
  return ing.optional ? `${text} (선택)` : text;
}

function isOptionalIngredient(ing) {
  if (ing && typeof ing === 'object' && ing.optional) return true;
  return /\s*\(선택\)\s*$/.test(formatIngredientDisplay(ing));
}

function getIngredientMatchName(ing) {
  return normalizeIngredientItem(ing).name || '';
}

function parseRecipeIngredientText(text) {
  const originalText = String(text || '').trim();
  if (!originalText) {
    return { name: '', amount: '', unit: '', originalText: '' };
  }

  const unitPattern = getIngredientUnitPattern();
  const amountPattern = '([\\d]+(?:/[\\d]+)?(?:\\.[\\d]+)?|약간|적당량|꼬집)';
  const trailingRe = new RegExp(`^(.+?)\\s+${amountPattern}\\s*(${unitPattern})?$`, 'i');
  const match = originalText.match(trailingRe);

  if (match) {
    const name = match[1].trim();
    const amount = match[2];
    const unit = QUALITATIVE_AMOUNTS.has(amount) ? '' : (match[3] || '');
    const normalizedAmount = QUALITATIVE_AMOUNTS.has(amount) ? amount : amount;
    return {
      name,
      amount: normalizedAmount,
      unit,
      originalText,
    };
  }

  return { name: originalText, amount: '', unit: '', originalText };
}

function parseRecipeIngredient(raw) {
  if (raw && typeof raw === 'object' && raw.name != null) {
    const item = {
      name: String(raw.name).trim(),
      amount: raw.amount != null ? String(raw.amount) : '',
      unit: raw.unit != null ? String(raw.unit) : '',
      originalText: raw.originalText || formatIngredientDisplay(raw),
      optional: Boolean(raw.optional),
    };
    return { ...item, raw: item.originalText };
  }

  let text = String(raw || '').trim();
  const optional = /\s*\(선택\)\s*$/.test(text);
  text = text.replace(/\s*\(선택\)\s*$/, '').trim();
  const parsed = parseRecipeIngredientText(text);
  return {
    ...parsed,
    optional,
    raw: String(raw || '').trim(),
  };
}

function normalizeIngredientItem(raw) {
  let optional = false;
  let sourceText = '';

  if (raw && typeof raw === 'object') {
    optional = Boolean(raw.optional);
    sourceText = raw.originalText || formatIngredientDisplay(raw);
    if (raw.name && raw.originalText && (raw.amount || raw.unit) && raw.name !== raw.originalText) {
      return {
        name: String(raw.name).trim(),
        amount: String(raw.amount || ''),
        unit: String(raw.unit || ''),
        originalText: raw.originalText,
        optional,
      };
    }
  } else {
    sourceText = String(raw || '').trim();
    optional = /\s*\(선택\)\s*$/.test(sourceText);
    sourceText = sourceText.replace(/\s*\(선택\)\s*$/, '').trim();
  }

  const parsed = parseRecipeIngredientText(sourceText);
  return {
    name: parsed.name,
    amount: parsed.amount,
    unit: parsed.unit,
    originalText: parsed.originalText || sourceText,
    optional,
  };
}

function normalizeIngredientList(list) {
  if (!Array.isArray(list)) return [];
  return list.map(normalizeIngredientItem).filter((item) => item.name || item.originalText);
}

// ===== Ingredient Groups (추천 전용 — 보유 재료명은 원본 유지) =====
// substituteScore: 0.9 = 같은 그룹, 0.75 = 대체 가능
const INGREDIENT_GROUP_DEFINITIONS = [
  { id: 'scallion', label: '파류', substituteScore: 0.9, members: ['대파', '쪽파', '실파'] },
  { id: 'mushroom', label: '버섯류', substituteScore: 0.9, members: ['표고버섯', '새송이버섯', '느타리버섯'] },
  { id: 'pepper', label: '고추류', substituteScore: 0.9, members: ['청양고추', '홍고추', '풋고추'] },
  { id: 'dairy', label: '유제품', substituteScore: 0.75, members: ['우유', '두유', '아몬드밀크'] },
  { id: 'onion', label: '양파류', substituteScore: 0.9, members: ['양파', '적양파', '샬롯'] },
  { id: 'potato', label: '감자/고구마류', substituteScore: 0.9, members: ['감자', '고구마'] },
  { id: 'leafy', label: '잎채소류', substituteScore: 0.9, members: ['상추', '깻잎', '청상추', '로메인'] },
];

const IngredientGroupService = {
  _memberIndex: new Map(),
  _buildIndex() {
    if (this._memberIndex.size) return;
    for (const group of INGREDIENT_GROUP_DEFINITIONS) {
      for (const member of group.members) {
        this._memberIndex.set(normalizeIngredient(member), {
          groupId: group.id,
          label: group.label,
          substituteScore: group.substituteScore,
        });
      }
    }
  },
  getMemberInfo(name) {
    this._buildIndex();
    return this._memberIndex.get(normalizeIngredient(name)) || null;
  },
  findSubstitute(recipeIngredient, pantryNames) {
    this._buildIndex();
    const requiredInfo = this.getMemberInfo(recipeIngredient);
    if (!requiredInfo) return null;
    const requiredNorm = normalizeIngredientName(recipeIngredient);
    for (const owned of pantryNames) {
      if (normalizeIngredientName(owned) === requiredNorm) continue;
      const ownedInfo = this.getMemberInfo(owned);
      if (ownedInfo && ownedInfo.groupId === requiredInfo.groupId) {
        return {
          required: recipeIngredient,
          owned,
          groupLabel: requiredInfo.label,
          substituteScore: requiredInfo.substituteScore,
          tier: requiredInfo.substituteScore >= 0.9 ? 'group' : 'flexible',
        };
      }
    }
    return null;
  },
  getGroups() { return INGREDIENT_GROUP_DEFINITIONS; },
};

const IngredientAliasService = {
  _aliases: new Map([
    ['피넛버터', 'syn-peanut'],
    ['땅콩버터', 'syn-peanut'],
    ['계란', 'syn-egg'],
    ['달걀', 'syn-egg'],
    ['밀가루', 'syn-flour'],
    ['중력분', 'syn-flour'],
    ['올리고당', 'syn-sweetener-alt'],
    ['알룰로스', 'syn-sweetener-alt'],
    ['설탕', 'syn-sugar-alt'],
    ['스테비아', 'syn-sugar-alt'],
  ]),
  canonical(name) {
    const norm = normalizeIngredientName(name);
    return this._aliases.get(norm) || norm;
  },
  matches(required, owned) {
    const reqNorm = normalizeIngredientName(required);
    const ownNorm = normalizeIngredientName(owned);
    if (reqNorm === ownNorm) return true;
    const reqCanon = this.canonical(required);
    const ownCanon = this.canonical(owned);
    return reqCanon === ownCanon && (this._aliases.has(reqNorm) || this._aliases.has(ownNorm));
  },
  findOwned(required, pantryNames) {
    return pantryNames.find((owned) => this.matches(required, owned)) || null;
  },
};

const SUBSTITUTION_GUIDES = [
  { keys: ['설탕'], alternatives: ['스테비아'], message: '스테비아로 대체 가능합니다' },
  { keys: ['올리고당'], alternatives: ['알룰로스'], message: '알룰로스로 대체 가능합니다' },
  { keys: ['알룰로스'], alternatives: ['올리고당'], message: '올리고당으로 대체 가능합니다' },
  { keys: ['미림'], alternatives: ['소주', '식초+설탕'], message: '소주 또는 식초+설탕 조합으로 대체 가능합니다' },
];

// ===== 제휴 / 구매 링크 (app-config.js) =====
const AffiliateService = {
  getConfig() {
    return (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.coupang) ? APP_CONFIG.coupang : { enabled: true };
  },
  isEnabled() {
    const cfg = this.getConfig();
    return cfg.enabled !== false;
  },
  /** 수량·단위를 제거한 재료명만 keyword로 사용 */
  keywordFromIngredient(ingredientName) {
    const { name } = parseRecipeIngredient(String(ingredientName || ''));
    return String(name || ingredientName || '').trim();
  },
  buildSearchUrl(query) {
    const cfg = this.getConfig();
    const name = this.keywordFromIngredient(query);
    const encoded = encodeURIComponent(name);
    if (cfg.affiliateId) {
      const template = cfg.affiliateSearchUrlTemplate
        || 'https://link.coupang.com/a/{affiliateId}?lptag={affiliateId}&subid={trackingCode}&pageKey=789&traceName=Search&searchKeyword={query}';
      return template
        .replace(/\{affiliateId\}/g, encodeURIComponent(cfg.affiliateId))
        .replace(/\{trackingCode\}/g, encodeURIComponent(cfg.trackingCode || ''))
        .replace(/\{query\}/g, encoded);
    }
    const fallback = cfg.searchUrlTemplate || 'https://www.coupang.com/np/search?q={query}';
    return fallback.replace(/\{query\}/g, encoded);
  },
  getSearchApiUrl(keyword) {
    const base = (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.videoExtract?.coupangSearchApiUrl)
      || '/api/coupang-search';
    const sep = base.includes('?') ? '&' : '?';
    return `${base}${sep}keyword=${encodeURIComponent(keyword)}`;
  },
  async resolveAffiliateUrl(ingredientName) {
    const keyword = this.keywordFromIngredient(ingredientName);
    const fallbackUrl = this.buildSearchUrl(keyword);
    if (!keyword) return fallbackUrl;
    try {
      const res = await fetch(this.getSearchApiUrl(keyword), { method: 'GET' });
      const data = await res.json().catch(() => null);
      if (res.ok && data?.success && data?.url) return String(data.url);
    } catch (err) {
      console.warn('[AffiliateService] coupang-search failed, using deeplink fallback', err);
    }
    return fallbackUrl;
  },
  buyButtonHTML(ingredientName, { compact = false } = {}) {
    if (!this.isEnabled()) return '';
    const keyword = this.keywordFromIngredient(ingredientName);
    if (!keyword) return '';
    const fallbackUrl = this.buildSearchUrl(keyword);
    const cls = compact ? 'btn-buy btn-buy--sm' : 'btn-buy';
    return `<a href="${esc(fallbackUrl)}" target="_blank" rel="noopener noreferrer sponsored" class="${cls}" data-coupang-keyword="${esc(keyword)}" onclick="event.preventDefault();event.stopPropagation();if(window.AppServices&&window.AppServices.AffiliateService){window.AppServices.AffiliateService.openSearch(this.getAttribute('data-coupang-keyword'));}return false;">구매하기</a>`;
  },
  async openSearch(ingredientName) {
    if (!this.isEnabled()) return;
    const url = await this.resolveAffiliateUrl(ingredientName);
    window.open(url, '_blank', 'noopener,noreferrer');
  },
};

/** 쿠팡파트너스 구매하기 고지 (레시피 모달 부족 재료 목록 하단) */
function affiliateDisclosureHTML() {
  return `<p class="affiliate-disclosure" role="note" data-affiliate-disclosure>ⓘ 구매하기 버튼은 쿠팡파트너스 활동의 일환으로, 구매 시 이에 따른 일정액의 수수료를 제공받습니다.</p>`;
}

// ===== 영상 레시피 추출 (Recime-style pipeline — js/video-extract-platform.js) =====
const VEP = () => window.VideoExtractPlatform || {};
const VIDEO_EXTRACT_FALLBACK_MSG = '이 영상에서는 레시피 정보를 충분히 추출하지 못했어요. 캡션이나 재료 설명을 함께 붙여넣어 주세요.';
const VIDEO_EXTRACT_YOUTUBE_NO_CAPTION_MSG = VIDEO_EXTRACT_FALLBACK_MSG;
const VIDEO_EXTRACT_PARTIAL_WARNING = '영상 설명글, 자막, 고정 댓글을 함께 붙여넣으면 더 정확합니다';
const INSTAGRAM_REELS_EXTRACT_HINT = 'Instagram Reels는 링크만으로는 캡션을 가져오기 어려울 수 있어요. 캡션을 함께 붙여넣으면 정확합니다.';
const TIKTOK_EXTRACT_HINT = 'TikTok은 링크만으로는 추출이 어려울 수 있어요. 캡션·설명을 붙여넣어 주세요.';
const VIDEO_AUTO_EXTRACT_FAILED_WARNING = '영상 정보를 자동으로 읽지 못해 입력된 텍스트 기준으로 분석했습니다';

class VideoExtractFallbackError extends Error {
  constructor(message = VIDEO_EXTRACT_FALLBACK_MSG) {
    super(message);
    this.code = 'FALLBACK';
  }
}

function logVideoExtractDebug(phase, data = {}) {
  console.log('[VideoExtract]', phase, data);
}

function normalizeDishNameToken(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/\s+/g, '')
    .replace(/[^\w\uac00-\ud7a3]/g, '')
    .replace(/레시피|만들기|요리|조리법|먹방|mukbang|asmr|shorts|쇼츠/gi, '');
}

/** 출처 음식명과 AI 결과명이 현저히 다르면 true */
function dishNamesLikelyMismatch(sourceDish, recipeName) {
  const a = normalizeDishNameToken(sourceDish);
  const b = normalizeDishNameToken(recipeName);
  if (!a || !b || a.length < 2 || b.length < 2) return false;
  if (a.includes(b) || b.includes(a)) return false;
  let maxCommon = 0;
  for (let len = Math.min(a.length, b.length); len >= 2; len -= 1) {
    for (let i = 0; i <= a.length - len; i += 1) {
      const sub = a.slice(i, i + len);
      if (b.includes(sub)) {
        maxCommon = len;
        break;
      }
    }
    if (maxCommon >= 2) break;
  }
  return maxCommon < 2;
}

const VIDEO_DUPLICATE_TOAST = '이미 등록된 영상입니다.';

function clearVideoExtractResultState() {
  state.videoReviewDraft = null;
  state.videoDishMismatchAcknowledged = false;
  if (dom.videoReviewError) dom.videoReviewError.hidden = true;
  if (dom.videoReviewMockNotice) dom.videoReviewMockNotice.hidden = true;
  if (dom.videoReviewPartialNotice) dom.videoReviewPartialNotice.hidden = true;
  if (dom.videoReviewName) dom.videoReviewName.value = '';
  if (dom.videoReviewIngredients) dom.videoReviewIngredients.value = '';
  if (dom.videoReviewOptional) dom.videoReviewOptional.value = '';
  if (dom.videoReviewSubstitutes) dom.videoReviewSubstitutes.value = '';
  if (dom.videoReviewSteps) dom.videoReviewSteps.value = '';
}

function clearVideoExtractStateBeforeExtract(sourceUrl) {
  clearVideoExtractResultState();
  state.videoExtractNeedsFallback = false;
  if (dom.videoFormError) dom.videoFormError.hidden = true;
  state.videoExtractSessionUrl = sourceUrl;
  logVideoExtractDebug('state-cleared', { inputUrl: sourceUrl });
}

function syncVideoUrlSession(rawUrl) {
  const normalized = String(rawUrl || '').trim();
  const prev = state.videoExtractSessionUrl;
  if (prev && normalized && prev !== normalized) {
    if (dom.videoUserText) dom.videoUserText.value = '';
    if (dom.videoPasteText) dom.videoPasteText.value = '';
    clearVideoExtractResultState();
    hideVideoFallback();
    logVideoExtractDebug('url-changed', { previousUrl: prev, newUrl: normalized });
  }
  state.videoExtractSessionUrl = normalized || null;
}

function logVideoExtractResult(result, sourceUrl, textPayload = {}) {
  logVideoExtractDebug('extract-result', {
    inputUrl: sourceUrl,
    sourceTitle: result.sourceTitle || result.videoTitle || '',
    sourceCaption: String(textPayload.caption || textPayload.pastedText || '').slice(0, 300),
    transcriptLength: result._transcriptLength ?? null,
    detectedDishName: result.sourceDetectedDishName || result.detectedDishName || result.videoTitle || '',
    aiRecipeName: result.name,
    confidence: result.confidence,
    sourceValidation: result.sourceValidation,
    dishNameMismatch: result.dishNameMismatch,
  });
}

function resolveVideoDishMismatch(result) {
  const detected = result.sourceDetectedDishName
    || result.detectedDishName
    || result.videoTitle
    || state.videoLinkMeta?.title
    || '';
  const recipeName = result.name || '';
  const mismatch = result.dishNameMismatch || dishNamesLikelyMismatch(detected, recipeName);
  if (!mismatch) return { retry: false };

  const detectedLabel = String(detected).replace(/\s*[-|｜].*$/, '').trim().slice(0, 40) || '다른 요리';
  const recipeLabel = String(recipeName).slice(0, 40) || '다른 레시피';
  const retry = window.confirm(
    `영상은 "${detectedLabel}"(으)로 보이는데, 추출 결과는 "${recipeLabel}" 레시피입니다. 다시 추출할까요?`
  );
  if (retry) return { retry: true };

  result._dishMismatchAcknowledged = true;
  result.dishNameMismatch = true;
  return {
    retry: false,
    warning: result.extractionWarning
      || `영상(${detectedLabel})과 추출 결과(${recipeLabel})가 다를 수 있어요. 저장 전에 내용을 확인해 주세요.`,
  };
}

async function proceedWithVideoExtractResult(result, sourceUrl, textPayload) {
  logVideoExtractResult(result, sourceUrl, textPayload);

  const mismatchCheck = resolveVideoDishMismatch(result);
  if (mismatchCheck.retry) return false;

  fillVideoReviewForm(result);
  const warning = result._warning || mismatchCheck.warning;
  if (warning) showRecipeWarning(warning);
  setRecipeFormTab('review');
  if (result._isMockData) {
    showToast('현재는 테스트 데이터입니다. 내용을 확인해 주세요.');
  } else if (warning) {
    showToast('레시피를 정리했어요. 안내 문구를 확인해 주세요.');
  } else {
    showToast('레시피 추출이 완료됐어요. 내용을 확인해 주세요.');
  }
  return true;
}

function logVideoExtractError(phase, err, extra = {}) {
  const apiResponse = extra?.apiResponse ?? err?.apiResponse ?? null;
  const payload = {
    code: err?.code || extra?.errorCode || apiResponse?.error || null,
    failureReason: apiResponse?.failureReason ?? err?.failureReason ?? null,
    failureReasonLabel: apiResponse?.failureReasonLabel ?? err?.failureReasonLabel ?? null,
    message: err?.message || String(err),
    stack: err?.stack || null,
    apiUrl: extra?.apiUrl || null,
    status: extra?.status ?? apiResponse?.openaiStatus ?? null,
    openaiStatus: apiResponse?.openaiStatus ?? err?.openaiStatus ?? null,
    openaiCode: apiResponse?.openaiCode ?? err?.openaiCode ?? null,
    openaiMessage: apiResponse?.openaiMessage ?? err?.openaiMessage ?? null,
    responseBody: apiResponse?.responseBody ?? err?.responseBody ?? null,
    debug: apiResponse?.debug ?? null,
    apiResponse,
    ...extra,
  };
  console.error('[VideoExtract]', phase, payload);
  if (apiResponse?.debug) {
    console.warn('[VideoExtract] server debug detail', apiResponse.debug);
  }
  console.error(err);
}

function mapOpenAiStatusUserMessage(apiData, err) {
  const status = Number(apiData?.openaiStatus ?? err?.openaiStatus);
  const openaiMessage = apiData?.openaiMessage || err?.openaiMessage;
  const detail = openaiMessage ? ` (${openaiMessage})` : '';

  if (apiData?.message && !String(apiData.message).includes('레시피 추출 중 오류가 발생했습니다')) {
    return apiData.message;
  }
  if (err?.message && String(err.message).startsWith('OpenAI')) {
    return err.message;
  }

  switch (status) {
    case 401:
      return `OpenAI API Key 오류입니다. OPENAI_API_KEY를 확인해 주세요.${detail}`;
    case 403:
      return `OpenAI 접근이 거부되었습니다.${detail}`;
    case 404:
      return `OpenAI 모델을 찾을 수 없습니다. OPENAI_MODEL 설정을 확인해 주세요.${detail}`;
    case 429:
      return `OpenAI 사용량 한도를 초과했습니다. 잠시 후 다시 시도하거나 quota를 확인해 주세요.${detail}`;
    case 500:
    case 502:
    case 503:
      return `OpenAI 서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.${detail}`;
    default:
      return apiData?.message || err?.message || 'AI 레시피 분석에 실패했습니다.';
  }
}

function mapVideoExtractUserError(err, apiData = null) {
  const code = apiData?.failureReason || apiData?.error || err?.code || '';
  if (code === 'DUPLICATE_VIDEO_SOURCE') {
    return { message: VIDEO_DUPLICATE_TOAST, showFallback: false };
  }
  if (code === 'AUTH_REQUIRED' || code === 'AUTH_TOKEN_UNAVAILABLE' || code === 'AUTH_NOT_INITIALIZED') {
    return { message: '로그인이 필요해요.', showFallback: false, requireLogin: true };
  }
  if (code === 'INVALID_ID_TOKEN') {
    const firebaseCode = apiData?.firebaseCode || err?.firebaseCode || null;
    const message = firebaseCode === 'auth/id-token-expired'
      ? '로그인 세션이 만료되었어요. 다시 로그인해 주세요.'
      : '로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요.';
    return { message, showFallback: false, requireLogin: true };
  }
  const genericServerMsg = '레시피 추출 중 오류가 발생했습니다';
  const openAiCodes = new Set([
    'MISSING_OPENAI_KEY',
    'OPENAI_AUTH_ERROR',
    'OPENAI_FORBIDDEN',
    'OPENAI_MODEL_NOT_FOUND',
    'OPENAI_RATE_LIMIT',
    'OPENAI_SERVER_ERROR',
    'OPENAI_ERROR',
    'OPENAI_EMPTY',
    'OPENAI_PARSE',
    'OPENAI_RESPONSE_FAILED',
    'AI_ANALYSIS_FAILED',
  ]);
  const contentFailureCodes = new Set([
    'NO_VIDEO_METADATA',
    'NO_DESCRIPTION',
    'NO_TRANSCRIPT',
    'MISSING_CAPTION_TEXT',
    'NOT_A_RECIPE',
    'OPENAI_NOT_A_RECIPE',
    'INCOMPLETE_RECIPE',
  ]);

  if (code === 'INVALID_URL' || code === 'INVALID_VIDEO_ID' || code === 'INVALID_SHORTCODE') {
    return {
      message: apiData?.message || '올바른 YouTube·Instagram·TikTok 링크 형식이 아닙니다. (youtube.com/watch?v=, youtu.be/, shorts/ 등)',
      showFallback: false,
    };
  }
  if (contentFailureCodes.has(code)) {
    return {
      message: apiData?.message || VIDEO_EXTRACT_FALLBACK_MSG,
      showFallback: true,
      failureReason: code,
      failureReasonLabel: apiData?.failureReasonLabel || null,
    };
  }
  if (openAiCodes.has(code)) {
    const showFallback = !['MISSING_OPENAI_KEY', 'OPENAI_AUTH_ERROR', 'OPENAI_FORBIDDEN', 'OPENAI_MODEL_NOT_FOUND', 'OPENAI_RATE_LIMIT', 'OPENAI_SERVER_ERROR'].includes(code);
    return {
      message: mapOpenAiStatusUserMessage(apiData, err),
      showFallback,
      failureReason: apiData?.failureReason || code,
      failureReasonLabel: apiData?.failureReasonLabel || 'OpenAI 응답 실패',
    };
  }
  if (err?.code === 'FALLBACK') {
    return {
      message: err?.message || '영상 설명글이나 캡션을 붙여넣어 주세요.',
      showFallback: true,
    };
  }
  if (code === 'NETWORK_ERROR' || code === 'API_NOT_FOUND' || code === 'INVALID_RESPONSE') {
    return {
      message: err?.message || '레시피 추출 서버에 연결할 수 없습니다. 서버가 실행 중인지 확인해 주세요.',
      showFallback: false,
    };
  }
  if (code === 'ANALYSIS_LIMIT_EXCEEDED' || code === 'DAILY_LIMIT_EXCEEDED') {
    return { message: apiData?.message || err?.message, showFallback: false, limit: true };
  }
  if (code === 'API_NOT_CONFIGURED') {
    return {
      message: '레시피 추출 API가 설정되지 않았습니다. app-config.js의 API URL을 확인해 주세요.',
      showFallback: false,
    };
  }
  const apiMessage = apiData?.message && !String(apiData.message).includes(genericServerMsg)
    ? apiData.message
    : null;
  return {
    message: apiMessage || err?.message || '레시피 추출에 실패했습니다.',
    showFallback: Boolean(apiData?.fallback),
  };
}

/** 개발·콘솔 테스트 전용 — 실제 사용자 플로우(extractFromUrl)에서는 사용하지 않음 */
function mockExtractRecipeFromVideoUrl(url, meta = {}) {
  const templates = [
    {
      name: '에그인헬',
      category: 'western',
      cookTime: 20,
      difficulty: '쉬움',
      ingredients: ['계란', '토마토', '양파', '마늘', '올리브오일', '소금', '후추'],
      optionalIngredients: ['파슬리'],
      substitutes: ['토마토 → 토마토소스'],
      steps: [
        '양파와 마늘을 다져 올리브오일에 볶습니다.',
        '토마토를 넣고 으깨며 끓입니다.',
        '계란을 넣고 뚜껑을 덮어 반숙으로 익힙니다.',
      ],
    },
    {
      name: '김치볶음밥',
      category: 'korean',
      cookTime: 15,
      difficulty: '쉬움',
      ingredients: ['밥', '김치', '계란', '대파', '참기름', '간장'],
      optionalIngredients: ['김'],
      substitutes: ['대파 → 쪽파'],
      steps: [
        '김치를 잘게 다져 볶습니다.',
        '밥과 간장을 넣고 볶습니다.',
        '계란 프라이를 올려 완성합니다.',
      ],
    },
    {
      name: '크림 파스타',
      category: 'western',
      cookTime: 25,
      difficulty: '보통',
      ingredients: ['파스타', '베이컨', '양파', '마늘', '생크림', '우유', '소금', '후추'],
      optionalIngredients: ['파마산 치즈'],
      substitutes: ['생크림 → 우유+버터'],
      steps: [
        '파스타를 삶습니다.',
        '베이컨과 양파, 마늘을 볶습니다.',
        '생크림과 우유를 넣고 파스타와 섞어 마무리합니다.',
      ],
    },
  ];
  let idx = 0;
  try {
    const seed = meta.videoId || url;
    idx = Math.abs(String(seed).split('').reduce((a, c) => a + c.charCodeAt(0), 0)) % templates.length;
  } catch {
    idx = 0;
  }
  const t = { ...templates[idx] };
  if (meta.title) t.name = String(meta.title).replace(/\s*[-|].*$/, '').trim().slice(0, 60) || t.name;
  return t;
}

const VideoRecipeAnalysisService = {
  detectVideoPlatform(url) {
    return VEP().detectVideoPlatform?.(url) || 'unknown';
  },

  extractVideoId(url, platform) {
    return VEP().extractVideoId?.(url, platform) || null;
  },

  getVideoExtractConfig() {
    return (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.videoExtract) ? APP_CONFIG.videoExtract : {};
  },

  isYouTubeHost(hostname) {
    return VEP().isYouTubeHost?.(hostname) || false;
  },

  isValidYouTubeVideoId(id) {
    return VEP().isValidYouTubeVideoId?.(id) || false;
  },

  getPlatformLabel(platform) {
    return VEP().PLATFORM_LABELS?.[platform] || platform || '영상';
  },

  getFallbackMessage(platform) {
    if (platform === 'tiktok') return TIKTOK_EXTRACT_HINT;
    if (platform === 'instagram_reels') return INSTAGRAM_REELS_EXTRACT_HINT;
    return VIDEO_EXTRACT_FALLBACK_MSG;
  },

  getPlatformExtractHint(platform) {
    return VEP().getPlatformHint?.(platform) || VIDEO_EXTRACT_PARTIAL_WARNING;
  },

  getRecipeApiUrl(platform) {
    const cfg = this.getVideoExtractConfig();
    if (platform === 'instagram_reels') {
      return cfg.instagramRecipeApiUrl || cfg.videoRecipeApiUrl || null;
    }
    if (platform === 'youtube' || platform === 'youtube_shorts') {
      return cfg.youtubeRecipeApiUrl || cfg.videoRecipeApiUrl || null;
    }
    return cfg.videoRecipeApiUrl || cfg.youtubeRecipeApiUrl || cfg.instagramRecipeApiUrl || null;
  },

  getRecipeApiFallbackUrls(platform, primaryUrl) {
    const cfg = this.getVideoExtractConfig();
    const candidates = platform === 'instagram_reels'
      ? [cfg.instagramRecipeApiUrl, cfg.videoRecipeApiUrl, cfg.youtubeRecipeApiUrl]
      : [cfg.youtubeRecipeApiUrl, cfg.videoRecipeApiUrl, cfg.instagramRecipeApiUrl];
    return candidates.filter((u) => u && u !== primaryUrl);
  },

  extractInstagramShortcode(url) {
    return VEP().extractInstagramShortcode?.(url) || null;
  },

  async fetchInstagramOEmbed(url) {
    try {
      const res = await fetch(
        `https://api.instagram.com/oembed?url=${encodeURIComponent(url)}&omitscript=true`
      );
      if (!res.ok) return null;
      const data = await res.json();
      return {
        title: data.title || data.author_name || '',
        thumbnailUrl: data.thumbnail_url || null,
      };
    } catch {
      return null;
    }
  },

  validateUrl(rawUrl) {
    const result = VEP().validateVideoUrl?.(rawUrl);
    if (result) return result;
    return { ok: false, error: '영상 링크를 확인할 수 없습니다.' };
  },

  normalizeVideoSource(rawUrl) {
    return VEP().normalizeVideoSource?.(rawUrl) || null;
  },

  findDuplicateRecipe(sourceUrl, excludeRecipeId = null) {
    return findDuplicateVideoRecipe(sourceUrl, excludeRecipeId);
  },

  extractYouTubeVideoId(url) {
    return VEP().extractYouTubeVideoId?.(url) || null;
  },

  getYouTubeThumbnail(videoId) {
    return VEP().getYouTubeThumbnail?.(videoId) || null;
  },

  async fetchVideoMetadata(url, platform) {
    const resolvedPlatform = platform || this.detectVideoPlatform(url);
    const videoId = this.extractVideoId(url, resolvedPlatform);
    const base = {
      title: '',
      thumbnailUrl: null,
      videoId,
      platform: resolvedPlatform,
    };

    if (resolvedPlatform === 'youtube' || resolvedPlatform === 'youtube_shorts') {
      return {
        ...base,
        thumbnailUrl: this.getYouTubeThumbnail(videoId),
        title: resolvedPlatform === 'youtube_shorts' ? 'YouTube Shorts' : 'YouTube 영상',
      };
    }
    if (resolvedPlatform === 'instagram_reels') {
      const shortcode = this.extractInstagramShortcode(url);
      try {
        const oembed = await this.fetchInstagramOEmbed(url);
        if (oembed) {
          return {
            ...base,
            ...oembed,
            shortcode,
            title: oembed.title || (shortcode ? `Instagram Reels (${shortcode})` : 'Instagram Reels'),
            platform: resolvedPlatform,
          };
        }
      } catch {
        /* ignore */
      }
      return {
        ...base,
        shortcode,
        title: shortcode ? `Instagram Reels (${shortcode})` : 'Instagram Reels',
        platform: resolvedPlatform,
      };
    }
    return {
      ...base,
      title: resolvedPlatform === 'tiktok' ? 'TikTok 영상' : '영상',
    };
  },

  async fetchCaptionText(url) {
    const cfg = this.getVideoExtractConfig();
    if (!cfg.captionApiUrl) return null;
    const res = await fetch(cfg.captionApiUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ url }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.text || data.caption || data.description || null;
  },

  normalizeApiRecipe(data, fallbackUrl) {
    const categoryKeys = Object.keys(CATEGORY_MAP);
    const category = categoryKeys.includes(data.category) ? data.category : 'korean';
    const sourceUrl = data.sourceUrl || fallbackUrl;
    const videoNorm = this.normalizeVideoSource(sourceUrl);
    return {
      sourceUrl,
      sourcePlatform: data.sourcePlatform || 'youtube',
      thumbnailUrl: data.thumbnailUrl || null,
      normalizedVideoId: videoNorm?.normalizedVideoId || null,
      normalizedSourceUrl: videoNorm?.normalizedSourceUrl || null,
      videoTitle: data.sourceTitle || data.title || '',
      name: String(data.title || '영상 레시피').trim().slice(0, 60),
      ingredients: (data.ingredients || []).map((s) => String(s).trim()).filter(Boolean),
      optionalIngredients: (data.optionalIngredients || []).map((s) => String(s).trim()).filter(Boolean),
      substitutes: (data.substituteIngredients || []).map((s) => String(s).trim()).filter(Boolean),
      steps: (data.steps || []).map((s) => String(s).trim()).filter(Boolean),
      cookTime: Math.max(1, Number(data.cookingTime) || 20),
      difficulty: ['쉬움', '보통', '어려움'].includes(data.difficulty) ? data.difficulty : '보통',
      category,
      sourceTitle: data.sourceTitle || data.title || '',
      detectedDishName: data.detectedDishName || '',
      sourceDetectedDishName: data.sourceDetectedDishName || data.detectedDishName || '',
      confidence: typeof data.confidence === 'number' ? data.confidence : (Number(data.confidence) || null),
      sourceValidation: data.sourceValidation || '',
      sourceValidationReason: data.sourceValidationReason || data.reason || '',
      dishNameMismatch: Boolean(data.dishNameMismatch),
      extractionWarning: data.extractionWarning || null,
    };
  },

  collectVideoTextPayload(sourceUrl) {
    const currentUrl = String(sourceUrl || dom.videoSourceUrl?.value || '').trim();
    const sessionUrl = String(state.videoExtractSessionUrl || currentUrl).trim();
    if (currentUrl && sessionUrl && currentUrl !== sessionUrl) {
      logVideoExtractDebug('text-payload-skipped', { currentUrl, sessionUrl });
      return {
        userText: '',
        caption: '',
        description: '',
        pastedText: '',
        hasUserText: false,
      };
    }
    const userText = dom.videoUserText?.value?.trim() || '';
    const pastedText = dom.videoPasteText?.value?.trim() || '';
    const primaryText = pastedText || userText;
    return {
      userText: primaryText,
      caption: primaryText,
      description: primaryText,
      pastedText: primaryText,
      hasUserText: primaryText.length >= 20,
    };
  },

  async callVideoRecipeApi(apiUrl, url, textPayload = {}, options = {}) {
    if (!apiUrl) {
      const err = new Error('레시피 추출 API URL이 설정되지 않았습니다.');
      err.code = 'API_NOT_CONFIGURED';
      throw err;
    }

    if (/localhost|127\.0\.0\.1/i.test(apiUrl) && typeof location !== 'undefined') {
      const isLocal = ['localhost', '127.0.0.1', '[::1]'].includes(location.hostname);
      if (!isLocal) {
        throw new Error('배포 환경에서는 localhost API를 사용할 수 없습니다.');
      }
    }

    const payload = {
      url,
      userId: ClientUserService.getUserId(),
      userText: textPayload.userText || '',
      caption: textPayload.caption || '',
      description: textPayload.description || '',
      pastedText: textPayload.pastedText || '',
    };

    logVideoExtractDebug('api-request', {
      inputUrl: url,
      userTextLength: payload.userText.length,
      captionLength: payload.caption.length,
    });

    const buildAuthHeaders = async (forceRefresh = false) => {
      const headers = { 'Content-Type': 'application/json' };
      if (!isLoggedInAppUser()) return headers;
      const quotaSvc = window.FirebaseServices?.AnalysisQuotaService;
      const idToken = await quotaSvc?.getIdTokenForApi?.({ forceRefresh });
      if (!idToken) {
        const err = new Error('AUTH_TOKEN_UNAVAILABLE');
        err.code = 'AUTH_TOKEN_UNAVAILABLE';
        throw err;
      }
      headers.Authorization = `Bearer ${idToken}`;
      return headers;
    };

    const platform = this.detectVideoPlatform(url);
    const apiUrls = [apiUrl, ...this.getRecipeApiFallbackUrls(platform, apiUrl)];
    let lastNotFoundErr = null;
    const forceRefresh = Boolean(options.forceRefresh);

    for (let i = 0; i < apiUrls.length; i += 1) {
      const currentApiUrl = apiUrls[i];
      if (i > 0) {
        console.warn('[VideoExtract] API 404 — fallback 시도:', currentApiUrl);
      }

      let res;
      try {
        const headers = await buildAuthHeaders(forceRefresh);
        console.log('[VideoAuth] request sent', {
          apiUrl: currentApiUrl,
          hasAuthorization: Boolean(headers.Authorization),
        });
        res = await fetch(currentApiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
        console.log('[VideoAuth] response status', {
          apiUrl: currentApiUrl,
          status: res.status,
        });
      } catch (networkErr) {
        if (networkErr?.code === 'AUTH_REQUIRED' || networkErr?.code === 'AUTH_TOKEN_UNAVAILABLE') {
          throw networkErr;
        }
        logVideoExtractError('callVideoRecipeApi:network', networkErr, { apiUrl: currentApiUrl, url });
        const isLocalDev = APP_CONFIG?.runtime?.isLocalDev;
        const hint = isLocalDev
          ? '로컬에서는 ./serve.sh 로 서버를 실행해 주세요.'
          : 'Vercel에 API 함수가 배포되어 있는지 확인해 주세요.';
        const err = new Error(`레시피 추출 서버에 연결할 수 없습니다. ${hint}`);
        err.code = 'NETWORK_ERROR';
        throw err;
      }

      if (res.status === 401 && isLoggedInAppUser() && !forceRefresh) {
        console.warn('[VideoAuth] 401 — refreshing token and retrying once');
        return this.callVideoRecipeApi(apiUrl, url, textPayload, { forceRefresh: true });
      }

      if (res.status === 404) {
        lastNotFoundErr = new Error(`레시피 추출 API(${currentApiUrl})를 찾을 수 없습니다.`);
        lastNotFoundErr.code = 'API_NOT_FOUND';
        continue;
      }

      let data;
      try {
        data = await res.json();
      } catch (parseErr) {
        logVideoExtractError('callVideoRecipeApi:parse', parseErr, { apiUrl: currentApiUrl, status: res.status });
        const err = new Error('서버 응답을 처리할 수 없습니다.');
        err.code = 'INVALID_RESPONSE';
        throw err;
      }

      if (!res.ok) {
        logVideoExtractError('callVideoRecipeApi:api-error', new Error(data.message || data.error), {
          apiUrl: currentApiUrl,
          status: res.status,
          apiResponse: data,
          errorCode: data.error,
        });
        if (data.error === 'DAILY_LIMIT_EXCEEDED' || data.error === 'ANALYSIS_LIMIT_EXCEEDED') {
          const err = new Error(data.message || '무료 AI 분석 횟수를 모두 사용했습니다.');
          err.code = data.error;
          err.aiUsage = data.aiUsage;
          throw err;
        }
        if (data.error === 'DUPLICATE_VIDEO_SOURCE' || res.status === 409) {
          const err = new Error(data.message || VIDEO_DUPLICATE_TOAST);
          err.code = 'DUPLICATE_VIDEO_SOURCE';
          err.apiResponse = data;
          throw err;
        }
        if (data.error === 'INVALID_ID_TOKEN' || res.status === 401) {
          const err = new Error(data.message || '로그인 정보가 유효하지 않습니다. 다시 로그인해 주세요.');
          err.code = 'INVALID_ID_TOKEN';
          err.apiResponse = data;
          err.httpStatus = res.status;
          throw err;
        }
        if (data.fallback) {
          const err = new VideoExtractFallbackError(VIDEO_EXTRACT_FALLBACK_MSG);
          err.warning = data.warning || null;
          err.infoHint = data.infoHint || null;
          err.apiResponse = data;
          throw err;
        }
        const err = new Error(data.message || data.error || '추출에 실패했습니다.');
        err.code = data.error || 'API_ERROR';
        err.apiResponse = data;
        throw err;
      }

      if (data.aiUsage) await AiUsageService.onAnalysisSuccess(data.aiUsage);

      const {
        aiUsage,
        success,
        warning,
        extractionWarning,
        infoHint,
        videoExtractPartial,
        videoExtractWarning,
        pipelineSteps,
        ...recipeData
      } = data;
      const result = this.normalizeApiRecipe(recipeData, url);
      const resolvedWarning = warning || extractionWarning || videoExtractWarning || null;
      if (resolvedWarning) {
        result._warning = resolvedWarning;
        result._videoExtractPartial = true;
      }
      if (infoHint) result._infoHint = infoHint;
      return result;
    }

    const isLocalDev = APP_CONFIG?.runtime?.isLocalDev;
    const hint = isLocalDev
      ? ' ./serve.sh 로 서버를 실행했는지, 실행 중이면 Ctrl+C 후 다시 시작해 주세요.'
      : ' Vercel에 api/extract-youtube-recipe.js 등 API 함수가 배포되어 있는지 확인해 주세요.';
    const err = new Error(`${lastNotFoundErr?.message || '레시피 추출 API를 찾을 수 없습니다.'}${hint}`);
    err.code = 'API_NOT_FOUND';
    throw err;
  },

  async extractViaApi(url, textPayload = {}) {
    const platform = this.detectVideoPlatform(url);
    const apiUrl = this.getRecipeApiUrl(platform);
    const userPastedText = String(textPayload?.userText || textPayload?.pastedText || '').trim();
    console.log('[VideoExtract] extractViaApi', {
      platform,
      videoId: this.extractVideoId(url, platform),
      apiUrl,
      userPastedTextLength: userPastedText.length,
    });
    return this.callVideoRecipeApi(apiUrl, url, textPayload);
  },

  /** @deprecated extractViaApi 사용 */
  async extractYouTubeViaApi(url, textPayload = {}) {
    return this.extractViaApi(url, textPayload);
  },

  /** @deprecated extractViaApi 사용 */
  async extractInstagramViaApi(url, textPayload = {}) {
    return this.extractViaApi(url, textPayload);
  },

  getOpenAIConfig() {
    return (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.openai) ? APP_CONFIG.openai : {};
  },

  normalizeExtraction(raw, meta) {
    const categoryKeys = Object.keys(CATEGORY_MAP);
    const category = categoryKeys.includes(raw.category) ? raw.category : 'korean';
    return {
      sourceUrl: meta.url,
      sourcePlatform: meta.platform,
      thumbnailUrl: meta.thumbnailUrl || null,
      videoTitle: meta.title || '',
      name: String(raw.name || meta.title || '영상 레시피').trim().slice(0, 60),
      ingredients: normalizeIngredientList((raw.ingredients || []).map((s) => String(s).trim()).filter(Boolean)),
      optionalIngredients: normalizeIngredientList((raw.optionalIngredients || []).map((s) => String(s).trim()).filter(Boolean)),
      substitutes: (raw.substitutes || raw.substituteIngredients || []).map((s) => String(s).trim()).filter(Boolean),
      steps: (raw.steps || []).map((s) => String(s).trim()).filter(Boolean),
      cookTime: Math.max(1, Number(raw.cookTime || raw.cookingTime) || 20),
      difficulty: ['쉬움', '보통', '어려움'].includes(raw.difficulty) ? raw.difficulty : '보통',
      category,
    };
  },

  async extractFromUrl(sourceUrl) {
    const urlCheck = this.validateUrl(sourceUrl);
    if (!urlCheck.ok) throw new Error(urlCheck.error);

    const textPayload = VideoRecipeAnalysisService.collectVideoTextPayload(urlCheck.url);
    const apiUrl = this.getRecipeApiUrl(urlCheck.platform);
    if (apiUrl) {
      return this.extractViaApi(urlCheck.url, textPayload);
    }

    const meta = {
      url: urlCheck.url,
      platform: urlCheck.platform,
      platformLabel: urlCheck.platformLabel,
      ...(await this.fetchVideoMetadata(urlCheck.url, urlCheck.platform)),
    };

    const captionText = await this.fetchCaptionText(urlCheck.url);
    if (captionText && captionText.trim().length >= 20) {
      const analyzed = await this.analyzeText(captionText, urlCheck.url);
      return this.normalizeExtraction(analyzed, meta);
    }

    const cfg = this.getVideoExtractConfig();
    if (cfg.enableMock) {
      const mock = mockExtractRecipeFromVideoUrl(urlCheck.url, meta);
      const result = this.normalizeExtraction(mock, meta);
      result._isMockData = true;
      return result;
    }

    throw new VideoExtractFallbackError(this.getFallbackMessage(urlCheck.platform));
  },

  async analyzeText(text, sourceUrl) {
    const cfg = this.getOpenAIConfig();
    if (cfg.enabled !== false && cfg.apiKey) {
      try {
        return await this.analyzeWithOpenAI(sourceUrl, text);
      } catch (err) {
        console.warn('OpenAI 분석 실패, 로컬 분석으로 대체:', err);
      }
    }
    return this.analyzeLocally(text);
  },

  async analyzeFromPaste(sourceUrl, pastedText) {
    const urlCheck = this.validateUrl(sourceUrl);
    if (!urlCheck.ok) throw new Error(urlCheck.error);
    const text = String(pastedText || '').trim();
    if (!text) throw new Error('텍스트를 붙여넣어 주세요.');
    if (text.length < 20) throw new Error('텍스트가 너무 짧습니다.');

    const meta = {
      url: urlCheck.url,
      platform: urlCheck.platform,
      platformLabel: urlCheck.platformLabel,
      ...(await this.fetchVideoMetadata(urlCheck.url, urlCheck.platform)),
    };
    const analyzed = await this.analyzeText(text, urlCheck.url);
    return this.normalizeExtraction(analyzed, meta);
  },

  async analyzeWithOpenAI(sourceUrl, text) {
    const cfg = this.getOpenAIConfig();
    const systemPrompt = `당신은 요리 레시피 추출 전문가입니다. 영상 설명/자막 텍스트에서 레시피만 추출하세요.
반드시 JSON 객체 하나만 반환하세요. 키: name, ingredients(배열), optionalIngredients(배열), substitutes(배열, "재료 → 대체" 형식), steps(배열), cookTime(숫자, 분), difficulty(쉬움|보통|어려움), category(korean|western|japanese|chinese|diet|high-protein), sourceValidation("passed"|"failed"), detectedDishName, confidence(0~1), reason.
확인된 정보만 사용하고, 추측하거나 예시 레시피를 반환하지 마세요. 정보가 부족하면 sourceValidation을 "failed"로 하세요.`;

    const response = await fetch(cfg.endpoint || 'https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.apiKey}`,
      },
      body: JSON.stringify({
        model: cfg.model || 'gpt-4o-mini',
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: `영상 URL: ${sourceUrl}\n\n텍스트:\n${text.slice(0, 12000)}` },
        ],
        temperature: 0.3,
      }),
    });

    if (!response.ok) {
      const errBody = await response.text();
      let openaiCode = null;
      let openaiMessage = null;
      try {
        const parsed = JSON.parse(errBody);
        openaiCode = parsed?.error?.code || parsed?.error?.type || null;
        openaiMessage = parsed?.error?.message || (typeof parsed?.error === 'string' ? parsed.error : null);
      } catch {
        openaiMessage = errBody.slice(0, 500) || null;
      }
      console.error('[OpenAI] client API error:', {
        httpStatus: response.status,
        openaiCode,
        openaiMessage,
        responseBody: errBody,
      });
      const err = new Error(`OpenAI API 오류 (${response.status})${openaiMessage ? `: ${openaiMessage}` : ''}`);
      err.code = response.status === 401 ? 'OPENAI_AUTH_ERROR'
        : response.status === 429 ? 'OPENAI_RATE_LIMIT'
        : response.status === 404 ? 'OPENAI_MODEL_NOT_FOUND'
        : response.status >= 500 ? 'OPENAI_SERVER_ERROR'
        : 'OPENAI_ERROR';
      err.openaiStatus = response.status;
      err.openaiCode = openaiCode;
      err.openaiMessage = openaiMessage;
      err.responseBody = errBody;
      console.error(err);
      throw err;
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content;
    if (!content) throw new Error('AI 응답이 비어 있습니다.');
    return JSON.parse(content);
  },

  analyzeLocally(text) {
    const sourceText = String(text || '').trim();
    console.log('[VideoExtract] analyzeLocally pre-extract', {
      rawTitle: '(로컬 분석)',
      rawDescription: sourceText.slice(0, 500) || '(없음)',
      combinedText: sourceText.slice(0, 500) || '(없음)',
    });

    const lines = sourceText.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
    const joined = lines.join('\n');

    let name = lines.find((l) => /레시피|만들기|요리/.test(l) && l.length <= 40)
      || lines[0]
      || '영상 레시피';
    name = name.replace(/^[\[#📌🍳🎬]\s*/u, '').slice(0, 60);

    const cookMatch = joined.match(/(\d+)\s*분(?:\s*이내|\s*소요)?/);
    const cookTime = cookMatch ? Number(cookMatch[1]) : 20;

    const ingredients = [];
    const optionalIngredients = [];
    const substitutes = [];
    const steps = [];

    let section = '';
    const sectionMatchers = [
      { key: 'ingredients', re: /^(?:재료|材料|ingredients?)[：:]?\s*$/i },
      { key: 'optional', re: /^(?:선택\s*재료|옵션|optional)[：:]?\s*$/i },
      { key: 'substitutes', re: /^(?:대체|대체\s*가능|substitute)[：:]?\s*$/i },
      { key: 'steps', re: /^(?:만드는\s*법|조리\s*순서|조리법|steps?|recipe)[：:]?\s*$/i },
    ];

    for (const line of lines) {
      const hit = sectionMatchers.find((m) => m.re.test(line));
      if (hit) { section = hit.key; continue; }

      if (/→|->|대신|대체/.test(line) && !/^(재료|조리)/.test(line)) {
        substitutes.push(line.replace(/^[-•*]\s*/, ''));
        continue;
      }

      if (section === 'ingredients') {
        if (/\(선택\)|선택\s*재료|optional/i.test(line)) {
          optionalIngredients.push(line.replace(/^[-•*\d.)\s]+/, '').replace(/\s*\(선택\)\s*/g, '').trim());
        } else {
          ingredients.push(line.replace(/^[-•*\d.)\s]+/, '').trim());
        }
        continue;
      }
      if (section === 'optional') {
        optionalIngredients.push(line.replace(/^[-•*\d.)\s]+/, '').replace(/\s*\(선택\)\s*/g, '').trim());
        continue;
      }
      if (section === 'substitutes') {
        substitutes.push(line.replace(/^[-•*\d.)\s]+/, '').trim());
        continue;
      }
      if (section === 'steps') {
        steps.push(line.replace(/^\d+[\.\):]\s*/, '').trim());
        continue;
      }

      if (/^\d+[\.\)]\s+/.test(line)) {
        steps.push(line.replace(/^\d+[\.\):]\s*/, '').trim());
      } else if (/^[-•*]\s+/.test(line) && ingredients.length < 20 && steps.length === 0) {
        const item = line.replace(/^[-•*]\s+/, '').trim();
        if (/\(선택\)/.test(item)) optionalIngredients.push(item.replace(/\s*\(선택\)\s*/g, ''));
        else ingredients.push(item);
      }
    }

    let category = 'korean';
    if (/파스타|스테이크|샐러드|sandwich|toast/i.test(joined)) category = 'western';
    else if (/초밥|라멘|우동|일식|데리야ki/i.test(joined)) category = 'japanese';
    else if (/짜장|마파|중식|짬뽕/i.test(joined)) category = 'chinese';
    else if (/다이어트|저칼로리|샐러드/i.test(joined)) category = 'diet';
    else if (/고단백|닭가슴살|프로tein/i.test(joined)) category = 'high-protein';

    return {
      name,
      ingredients: ingredients.slice(0, 30),
      optionalIngredients: optionalIngredients.slice(0, 15),
      substitutes: substitutes.slice(0, 15),
      steps: steps.slice(0, 20),
      cookTime,
      difficulty: steps.length > 8 ? '보통' : '쉬움',
      category,
    };
  },

  buildIngredientsForSave(required, optional) {
    const req = normalizeIngredientList(parseIngredientList(Array.isArray(required) ? required.join('\n') : required));
    const opt = normalizeIngredientList(parseIngredientList(Array.isArray(optional) ? optional.join('\n') : optional))
      .map((item) => ({
        ...item,
        optional: true,
        originalText: `${item.originalText || formatIngredientDisplay(item)} (선택)`,
      }));
    return [...req, ...opt];
  },
};

// ===== 클라이언트 사용자 ID (게스트) / Firebase UID (로그인) =====
const ClientUserService = {
  isLoggedIn() {
    return Boolean(window.FirebaseServices?.AuthService?.isLoggedIn?.());
  },

  getUserId() {
    const firebaseUid = window.FirebaseServices?.AuthService?.getUid?.();
    if (firebaseUid) return firebaseUid;

    let id = StorageAdapter.get(CONFIG.STORAGE.CLIENT_USER_ID, null);
    if (!id) {
      id = `guest-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
      StorageAdapter.set(CONFIG.STORAGE.CLIENT_USER_ID, id);
    }
    return id;
  },
};

const AiUsageService = {
  getConfig() {
    return (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.videoExtract) ? APP_CONFIG.videoExtract : {};
  },

  getQuotaService() {
    return window.FirebaseServices?.AnalysisQuotaService || null;
  },

  getDailyLimit() {
    return Number(this.getQuotaService()?.getWeeklyLimit?.() ?? this.getConfig().weeklyLimit ?? this.getConfig().dailyLimit) || 5;
  },

  getWeeklyLimit() {
    return this.getDailyLimit();
  },

  async fetchUsage() {
    const quota = this.getQuotaService();
    if (quota) return quota.fetchUsage();

    const cfg = this.getConfig();
    const apiUrl = cfg.aiUsageApiUrl || '/api/ai-usage';
    const userId = ClientUserService.getUserId();
    try {
      const res = await fetch(`${apiUrl}?userId=${encodeURIComponent(userId)}`);
      if (!res.ok) return null;
      const data = await res.json();
      return data.aiUsage || null;
    } catch (err) {
      console.warn('[냉장GO API] GET ai-usage failed:', apiUrl, err);
      return null;
    }
  },

  updateDisplay(usage) {
    if (!dom.videoAiUsage) return;

    if (isAuthInitializing()) {
      dom.videoAiUsage.hidden = false;
      dom.videoAiUsage.textContent = '로그인 상태 확인 중…';
      dom.videoAiUsage.classList.remove('video-ai-usage--exhausted');
      return;
    }

    if (!isLoggedInAppUser()) {
      state.aiUsageRemaining = null;
      dom.videoAiUsage.hidden = false;
      dom.videoAiUsage.textContent = '로그인하면 매주 무료 AI 분석 5회를 제공합니다.';
      dom.videoAiUsage.classList.remove('video-ai-usage--exhausted');
      if (dom.videoAnalyzeBtn) dom.videoAnalyzeBtn.disabled = false;
      return;
    }

    const limit = usage?.limit ?? this.getDailyLimit();
    const remaining = usage?.remaining ?? limit;
    state.aiUsageRemaining = remaining;

    dom.videoAiUsage.hidden = false;
    if (remaining > 0) {
      dom.videoAiUsage.textContent = `이번 주 남은 무료 분석 ${remaining}회`;
      dom.videoAiUsage.classList.remove('video-ai-usage--exhausted');
    } else {
      dom.videoAiUsage.textContent = '이번 주 무료 분석 횟수를 모두 사용했어요';
      dom.videoAiUsage.classList.add('video-ai-usage--exhausted');
    }

    if (dom.videoAnalyzeBtn) {
      dom.videoAnalyzeBtn.disabled = false;
    }
  },

  async refreshDisplay() {
    if (isAuthInitializing()) {
      this.updateDisplay(null);
      return;
    }
    if (!isLoggedInAppUser()) {
      this.updateDisplay(null);
      return;
    }
    const usage = await this.fetchUsage();
    if (usage) this.updateDisplay(usage);
    else this.updateDisplay({ remaining: this.getDailyLimit(), limit: this.getDailyLimit() });
  },

  async onAnalysisSuccess(aiUsage) {
    const quota = this.getQuotaService();
    if (quota?.isLoggedIn()) {
      const usage = await quota.fetchLoggedInUsage();
      if (usage) this.updateDisplay(usage);
      window.FirebaseServices?.refreshHeaderQuota?.();
      return;
    }
    quota?.syncGuestAfterSuccess?.(aiUsage);
    if (aiUsage) this.updateDisplay(aiUsage);
    else await this.refreshDisplay();
  },
};

// ===== Fresh Food (신선식품) =====
const FRESH_FOOD_KEYS = new Set([
  '계란', '달걀', '두부', '순두부', '김치', '깍두기', '콩나물', '시금치', '상추', '청상추', '로메인', '양상추',
  '깻잎', '대파', '쪽파', '실파', '양파', '적양파', '샬롯', '마늘', '마늘종', '감자', '고구마', '당근', '무',
  '오이', '애호박', '호박', '배추', '토마토', '브로ccoli', '파프rika', '피망', '가지', '부추', '미나리', '쑥',
  '상추', '치커리', '양배추', '브로ccoli', '새송이버섯', '표고버섯', '느타리버섯', '팽이버섯', '청양고추',
  '홍고추', '풋고추', '고추', '파', '미역', '다시마', '시래기', '콩', '완두콩', '옥수수', '단무지', '김',
  '우유', '두유', '아몬드밀크', '치즈', '모짜렐라', '리코타', '버터', '생크림', '요거트', '닭가슴살',
  '닭고기', '닭다리', '돼지고기', '삼겹살', '목살', '소고기', '소고기', '돈까스', '햄', '베이컨', '소시지',
  '스팸', '사과', '바나나', '딸기', '포도', '레mon', '귤', '오렌지', '키위', '복숭아', '수박', '멜on',
  '낫또', '두유', '순두부', '연두부', '두부', '나물', '쌈채소', '청경채', '케일', '로메인',
].map(normalizeIngredient));

const FRESH_FOOD_PATTERNS = [
  /고기|삼겹|목살|등심|안심|갈비|닭|오리|돼지|소고기|햄|베이컨|소시지|스팸|돈까스/,
  /버섯|나물|채소|야채|잎$/,
  /치즈|요거트|생크림|우유|두유/,
  /사과|바나나|딸기|포도|레몬|귤|오렌지|키위|복숭아|수박|멜론|망고/,
];

const SEAFOOD_PATTERN = /참치|연어|고등어|갈치|명태|북어|멸치|새우|오징어|문어|낙지|조개|전복|홍합|바지락|굴|게|랍스터|어묵|생선|회$|수산|해물|오만둥이|가리비|대하|킹크랩|쭈꾸미|한치|멍게|해삼|다슬기|소라|골뱅이|아귀|광어|우럭|도미|삼치|가자미|넙치|장어|민어|대구|코다리|황태|건새우|건멸치|건오징어|어란|명란|연체|수어|가오리/;

const NON_FRESH_KEYS = new Set([
  '간장', '된장', '고추장', '고춧가루', '참기름', '들기름', '식용유', '올리브유', '밀가루', '전분', '튀김가루',
  '라면', '스프', '케첩', '마요네즈', '마요', '식초', '설탕', '소금', '물', '밥', '쌀', '국수', '파스타', '스파게티',
  '마카로니', '우동', '비빔면', '쫄면', '냉면', '시리얼', '꿀', '카레', '카레가루', '와사비', '머스터드', '굴소스',
  '올리고당', '다시다', '멸치육수', '육수', '식빵', '핫도그빵', '떡', '라면땅', '커피', '주스',
].map(normalizeIngredient));

const FreshFoodService = {
  isFresh(name) {
    if (!name || !String(name).trim()) return false;
    const raw = String(name).trim();
    const n = normalizeIngredient(raw);
    if (NON_FRESH_KEYS.has(n)) return false;
    if ([...NON_FRESH_KEYS].some((k) => k.length >= 2 && n.includes(k))) return false;
    if (/가루$|분말$/.test(raw)) return false;
    if (SEAFOOD_PATTERN.test(raw)) return false;
    if (IngredientGroupService.getMemberInfo(raw)) return true;
    if (FRESH_FOOD_KEYS.has(n)) return true;
    return FRESH_FOOD_PATTERNS.some((re) => re.test(raw));
  },
};

// ===== Storage Adapter (→ Supabase/Firebase 교체) =====
/** 재료·레시피·장보기·식사 등 사용자 데이터 — localStorage 미사용
 *  로그인: Firestore만 / 게스트 장보기: 메모리만 (새로고침 시 소멸, 로그인 시 이전 안 함)
 */
const USER_DATA_LOCAL_STORAGE_KEYS = [
  CONFIG.STORAGE.PANTRY,
  CONFIG.STORAGE.LEGACY_PANTRY,
  CONFIG.STORAGE.RECIPES,
  CONFIG.STORAGE.SAVED,
  CONFIG.STORAGE.MEALS,
  CONFIG.STORAGE.SHOPPING,
  CONFIG.STORAGE.MEAL_PLAN,
  CONFIG.STORAGE.GROCERY,
  CONFIG.STORAGE.LEGACY_RECIPES,
  CONFIG.STORAGE.MONTHLY_FOOD_BUDGET,
];

function purgeLegacyUserDataFromLocalStorage({ includePantry = false } = {}) {
  for (const key of USER_DATA_LOCAL_STORAGE_KEYS) {
    if (!includePantry && (key === CONFIG.STORAGE.PANTRY || key === CONFIG.STORAGE.LEGACY_PANTRY)) {
      continue;
    }
    try {
      localStorage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

const StorageAdapter = {
  get(key, fallback = null) {
    if (USER_DATA_LOCAL_STORAGE_KEYS.includes(key)) return fallback;
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  },
  set(key, value) {
    if (USER_DATA_LOCAL_STORAGE_KEYS.includes(key)) return;
    localStorage.setItem(key, JSON.stringify(value));
  },
  createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  },
};

// ===== Dish Type Placeholders =====
const DishTypeService = {
  infer(name, explicitType) {
    const svgs = typeof DISH_PLACEHOLDER_SVGS !== 'undefined' ? DISH_PLACEHOLDER_SVGS : {};
    if (explicitType && svgs[explicitType]) return explicitType;
    const n = name || '';
    const rules = [
      ['fried-rice', /볶음밥/],
      ['rice-bowl', /덮밥|주먹밥|오므라이스|오야코|규동|김밥/],
      ['noodle', /라면|우동|국수|파스타|스파게티|쫄면|비빔면|냉면|잔치면|수제비|마카로니/],
      ['sandwich', /샌드위치|샌드/],
      ['toast', /토스트|그릴드치즈|베이컨에그/],
      ['salad', /샐러드/],
      ['stew', /찌개|찜|조림|전골|라조기/],
      ['soup', /국$|미역국|계란국|된장국|콩나물국|북어국|어묵국|김치국|시래기국|육개장|순두부|탕$/],
      ['pancake', /전$|전[^볶]|부침|튀김|지짐|감자전|김치전|파전|호박전|부추전|치즈전|해물파전|김치전병/],
      ['snack', /떡볶이|떡구이|라면땅|핫도그|시리얼|떡라면|치즈떡/],
      ['dessert', /케이크|맛탕|고구마맛탕/],
      ['drink', /스무디|라떼|오트밀|우유시리얼|바나나우유|고구마라떼/],
      ['stir-fry', /볶음|볶아|스크램블|무침|볶음$/],
    ];
    for (const [type, re] of rules) {
      if (re.test(n)) return type;
    }
    return 'default';
  },
  resolve(recipe) {
    return recipe.dishType || this.infer(recipe.name);
  },
  placeholderSVG(recipe, sizeClass = '') {
    const type = this.resolve(recipe);
    const svgs = typeof DISH_PLACEHOLDER_SVGS !== 'undefined' ? DISH_PLACEHOLDER_SVGS : {};
    const svg = svgs[type] || svgs.default || '';
    if (!sizeClass) return svg;
    return svg.replace('class="recipe-placeholder-svg"', `class="recipe-placeholder-svg ${sizeClass}"`);
  },
  label(recipe) {
    const type = this.resolve(recipe);
    const labels = typeof DISH_TYPE_LABELS !== 'undefined' ? DISH_TYPE_LABELS : {};
    return labels[type] || '요리';
  },
};

// ===== Seed Recipes =====
function resolveRecipeImage(data) {
  if (typeof RecipeImageService !== 'undefined') {
    const name = data.name || data.title || '';
    return RecipeImageService.resolveForStorage({
      name,
      title: data.title || name,
      slug: data.slug || data.id,
      id: data.id,
      category: data.category,
      dishType: data.dishType || DishTypeService.infer(name),
      image: data.image,
      imageUrl: data.imageUrl,
      thumbnailUrl: data.thumbnailUrl,
    });
  }
  return DEFAULT_IMAGE;
}

function seed(id, data) {
  const cat = CATEGORY_MAP[data.category || 'korean'] || CATEGORY_MAP.korean;
  const name = data.name || data.title || '';
  const slug = String(data.slug || data.id || `recipe-${id}`).trim().replace(/^builtin-/, '') || `recipe-${id}`;
  const steps = Array.isArray(data.steps) ? data.steps : (Array.isArray(data.instructions) ? data.instructions : []);
  const cookTime = Number(data.cookTime ?? data.cookingTime) || 20;
  const tags = Array.isArray(data.tags) && data.tags.length ? data.tags : [...cat.tags];
  return {
    id: `builtin-${slug}`,
    slug,
    name,
    ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
    steps,
    cookTime: Math.max(1, cookTime),
    difficulty: data.difficulty || '쉬움',
    category: data.category || 'korean',
    dishType: data.dishType || DishTypeService.infer(name),
    cuisine: data.cuisine || cat.cuisine,
    tags: [...tags],
    dietTags: Array.isArray(data.dietTags) ? [...data.dietTags] : [...cat.dietTags],
    substitutions: Array.isArray(data.substitutions) ? data.substitutions : (data.substitutes || []),
    image: resolveRecipeImage({ ...data, name, slug, title: data.title || name }),
    calories: data.calories ?? null,
    memo: '',
    authorId: 'system',
    authorName: '냉장GO',
    visibility: 'public',
    source: 'builtin',
    createdAt: '2024-01-01T00:00:00.000Z',
    updatedAt: '2024-01-01T00:00:00.000Z',
  };
}

const BUILTIN_RECIPES = (typeof BUILTIN_RECIPE_RAW !== 'undefined' ? BUILTIN_RECIPE_RAW : []).map((data, i) => seed(i + 1, data));

// ===== Repositories =====
const PantryRepository = {
  _items: [],
  _usingFirestore: false,
  load() {
    this.clearSession();
    return this._items;
  },
  save() {
    // 게스트=메모리만, 로그인=Firestore — localStorage 미사용
  },
  getAll() { return this._items; },
  findById(id) { return this._items.find((x) => x.id === id); },
  add(item) { this._items.push(item); },
  update(id, data) {
    const i = this._items.findIndex((x) => x.id === id);
    if (i === -1) return null;
    this._items[i] = { ...this._items[i], ...data, updatedAt: new Date().toISOString() };
    return this._items[i];
  },
  remove(id) {
    this._items = this._items.filter((x) => x.id !== id);
  },
  replaceAll(items) {
    this._usingFirestore = true;
    this._items = (items || []).map((raw) => this._normalize(raw));
    console.log('INGREDIENTS_FROM_FIRESTORE', this._items.length);
  },
  clearSession() {
    this._usingFirestore = false;
    this._items = [];
  },
  _normalize(raw) {
    if (typeof raw === 'string') {
      return {
        id: StorageAdapter.createId('pantry'),
        name: raw,
        quantity: '',
        unit: '',
        expiryDate: '',
        recipeId: null,
        recipeName: '',
        firestoreId: null,
        userId: CONFIG.LOCAL_USER_ID,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
    }
    return {
      id: raw.id || raw.firestoreId || StorageAdapter.createId('pantry'),
      name: raw.name || '',
      quantity: raw.quantity || '',
      unit: raw.unit || '',
      expiryDate: raw.expiryDate || '',
      recipeId: raw.recipeId || null,
      recipeName: raw.recipeName || '',
      firestoreId: raw.firestoreId || null,
      userId: raw.userId || CONFIG.LOCAL_USER_ID,
      createdAt: raw.createdAt || new Date().toISOString(),
      updatedAt: raw.updatedAt || new Date().toISOString(),
    };
  },
  create(data) {
    const item = { ...this._normalize(data), id: StorageAdapter.createId('pantry') };
    this.add(item);
    return item;
  },
};

const RecipeRepository = {
  _userRecipes: [],
  load() {
    this.clearSession();
    return this._userRecipes;
  },
  save() {
    // 사용자 레시피 — localStorage 미사용
  },
  clearSession() {
    this._userRecipes = [];
  },
  replaceAll(recipes) {
    this._userRecipes = (recipes || []).map((r) => ({
      ...r,
      source: 'user',
      ingredients: normalizeIngredientList(r.ingredients),
    }));
  },
  getUserRecipes() { return this._userRecipes; },
  getById(id) {
    return BUILTIN_RECIPES.find((r) => r.id === id)
      || this._userRecipes.find((r) => r.id === id)
      || PublicRecipeRepository.getById(id);
  },
  getPublicRecipes() {
    return this.getHomeRecipes();
  },
  getHomeRecipes() {
    const builtinIds = new Set(BUILTIN_RECIPES.map((r) => r.id));
    const publicRecipes = PublicRecipeRepository.getAll().filter(
      (r) => r.visibility === 'public' || r.isPublic !== false,
    );
    const dedupedPublic = publicRecipes.filter((r) => !builtinIds.has(r.id));
    return [...BUILTIN_RECIPES, ...dedupedPublic];
  },
  getRecommendableRecipes() {
    return [...BUILTIN_RECIPES, ...this._userRecipes];
  },
  forkFrom(source) {
    if (!source) return null;
    const image = hasPhoto(source.image) ? source.image : '';
    return this.create({
      name: source.name,
      ingredients: [...source.ingredients].map(normalizeIngredientItem),
      steps: [...source.steps],
      cookTime: source.cookTime,
      difficulty: source.difficulty,
      category: source.category,
      dishType: source.dishType || DishTypeService.infer(source.name),
      memo: source.memo || '',
      image,
      visibility: 'private',
      parentRecipeId: source.id,
      createdFrom: source.name,
    });
  },
  getForks(parentRecipeId) {
    return this._userRecipes.filter((r) => r.parentRecipeId === parentRecipeId);
  },
  create(data) {
    const now = new Date().toISOString();
    const cat = CATEGORY_MAP[data.category] || CATEGORY_MAP.korean;
    const recipe = {
      id: StorageAdapter.createId('recipe'),
      name: data.name, ingredients: normalizeIngredientList(data.ingredients), steps: data.steps,
      cookTime: Number(data.cookTime), difficulty: data.difficulty, category: data.category,
      dishType: data.dishType || DishTypeService.infer(data.name),
      cuisine: cat.cuisine, tags: [...cat.tags], dietTags: [...cat.dietTags],
      image: data.image || DEFAULT_IMAGE, calories: data.calories ?? null, memo: data.memo || '',
      parentRecipeId: data.parentRecipeId || null,
      createdFrom: data.createdFrom || null,
      sourceUrl: data.sourceUrl || null,
      sourcePlatform: data.sourcePlatform || null,
      normalizedVideoId: data.normalizedVideoId || null,
      normalizedSourceUrl: data.normalizedSourceUrl || null,
      thumbnailUrl: data.thumbnailUrl || null,
      ingredientSubstitutes: Array.isArray(data.ingredientSubstitutes) ? data.ingredientSubstitutes : [],
      optionalIngredients: Array.isArray(data.optionalIngredients) ? data.optionalIngredients : [],
      authorId: CONFIG.LOCAL_USER_ID, authorName: CONFIG.LOCAL_USER_NAME,
      visibility: data.visibility || 'private', source: 'user', createdAt: now, updatedAt: now,
    };
    if (!data.image && data.thumbnailUrl) recipe.image = data.thumbnailUrl;
    this._userRecipes.push(recipe);
    this.save();
    return recipe;
  },
  update(id, data) {
    const i = this._userRecipes.findIndex((r) => r.id === id);
    if (i === -1) return null;
    const cat = CATEGORY_MAP[data.category] || CATEGORY_MAP.korean;
    this._userRecipes[i] = {
      ...this._userRecipes[i], ...data,
      ingredients: data.ingredients != null
        ? normalizeIngredientList(data.ingredients)
        : this._userRecipes[i].ingredients,
      dishType: data.dishType || DishTypeService.infer(data.name || this._userRecipes[i].name),
      parentRecipeId: data.parentRecipeId !== undefined ? data.parentRecipeId : this._userRecipes[i].parentRecipeId,
      createdFrom: data.createdFrom !== undefined ? data.createdFrom : this._userRecipes[i].createdFrom,
      sourceUrl: data.sourceUrl !== undefined ? data.sourceUrl : this._userRecipes[i].sourceUrl,
      sourcePlatform: data.sourcePlatform !== undefined ? data.sourcePlatform : this._userRecipes[i].sourcePlatform,
      normalizedVideoId: data.normalizedVideoId !== undefined ? data.normalizedVideoId : this._userRecipes[i].normalizedVideoId,
      normalizedSourceUrl: data.normalizedSourceUrl !== undefined ? data.normalizedSourceUrl : this._userRecipes[i].normalizedSourceUrl,
      thumbnailUrl: data.thumbnailUrl !== undefined ? data.thumbnailUrl : this._userRecipes[i].thumbnailUrl,
      ingredientSubstitutes: data.ingredientSubstitutes !== undefined
        ? data.ingredientSubstitutes
        : (this._userRecipes[i].ingredientSubstitutes || []),
      optionalIngredients: data.optionalIngredients !== undefined
        ? normalizeIngredientList(data.optionalIngredients)
        : (this._userRecipes[i].optionalIngredients || []),
      cuisine: cat.cuisine, tags: [...cat.tags], dietTags: [...cat.dietTags],
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this._userRecipes[i];
  },
  remove(id) {
    this._userRecipes = this._userRecipes.filter((r) => r.id !== id);
    this.save();
  },
  isOwned(recipe) {
    if (recipe.source !== 'user') return false;
    const uid = window.FirebaseServices?.auth?.currentUser?.uid;
    if (uid) return recipe.authorId === uid;
    return recipe.authorId === CONFIG.LOCAL_USER_ID;
  },
};

function findDuplicateVideoRecipe(sourceUrl, excludeRecipeId = null) {
  const norm = VEP().normalizeVideoSource?.(sourceUrl);
  const normalizedVideoId = norm?.normalizedVideoId || null;
  if (!normalizedVideoId) {
    return null;
  }

  const duplicate = RecipeRepository.getUserRecipes().find((recipe) => {
    if (excludeRecipeId && (recipe.id === excludeRecipeId || recipe.firestoreId === excludeRecipeId)) {
      return false;
    }
    const existingId = VEP().resolveRecipeNormalizedVideoId?.(recipe);
    return existingId === normalizedVideoId;
  }) || null;

  return duplicate;
}

function checkVideoSourceDuplicate(sourceUrl, excludeRecipeId = null) {
  try {
    const duplicate = findDuplicateVideoRecipe(sourceUrl, excludeRecipeId);
    return {
      isDuplicate: Boolean(duplicate),
      duplicate,
      normalizedVideoId: VEP().normalizeVideoSource?.(sourceUrl)?.normalizedVideoId || null,
    };
  } catch (err) {
    console.error('[VideoDuplicate] check failed — 추출은 계속 진행', err);
    return { isDuplicate: false, duplicate: null, normalizedVideoId: null, error: err };
  }
}

function assertVideoSourceNotDuplicate(sourceUrl, excludeRecipeId = null) {
  const result = checkVideoSourceDuplicate(sourceUrl, excludeRecipeId);
  if (!result.isDuplicate) return false;
  showToast(VIDEO_DUPLICATE_TOAST);
  return true;
}

function assertVideoAnalysisQuotaAvailable() {
  if (!isLoggedInAppUser()) return true;
  if (state.aiUsageRemaining == null) return true;
  if (state.aiUsageRemaining > 0) return true;
  showToast('이번 주 무료 AI 분석 횟수를 모두 사용했어요.');
  return false;
}

function reportVideoExtractFailure(err, fallbackMessage = '레시피 추출에 실패했어요. 잠시 후 다시 시도해 주세요.') {
  const message = err?.message || fallbackMessage;
  showVideoFormError(message);
  return message;
}

function bindVideoExtractClick() {
  const panel = dom.recipeFormPanelVideo;
  if (!panel || panel.dataset.videoExtractBound === '1') return;
  panel.dataset.videoExtractBound = '1';
  panel.addEventListener('click', (e) => {
    const analyzeBtn = e.target.closest('#video-analyze-btn');
    if (analyzeBtn) {
      e.preventDefault();
      void runVideoExtractFromClick();
      return;
    }
    const fallbackBtn = e.target.closest('#video-fallback-analyze-btn');
    if (fallbackBtn) {
      e.preventDefault();
      void handleVideoFallbackAnalyze().catch((err) => reportVideoExtractFailure(err));
    }
  });
}

async function runVideoExtractFromClick() {
  if (state.videoExtractInFlight) {
    showToast('레시피 분석이 진행 중이에요…');
    return;
  }
  try {
    await handleVideoExtract();
  } catch (err) {
    reportVideoExtractFailure(err, '레시피 추출을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.');
  }
}

const PublicRecipeRepository = {
  _recipes: [],
  load() {
    this.clearSession();
    return this._recipes;
  },
  clearSession() {
    this._recipes = [];
  },
  replaceAll(recipes) {
    this._recipes = (recipes || []).map((r) => ({
      ...r,
      ingredients: normalizeIngredientList(r.ingredients),
    }));
  },
  getAll() { return this._recipes; },
  getById(id) { return this._recipes.find((r) => r.id === id); },
};

function builtinSaveSeed(index) {
  return 40 + (index * 23) % 460;
}

const SavedRecipeRepository = {
  _ids: [],
  load() {
    this.clearSession();
    return this._ids;
  },
  save() {
    // 저장한 레시피 ID — localStorage 미사용
  },
  clearSession() {
    this._ids = [];
  },
  replaceIds(ids) {
    this._ids = Array.isArray(ids) ? [...ids] : [];
  },
  isSaved(id) { return this._ids.includes(id); },
  toggle(id) {
    const wasSaved = this.isSaved(id);
    if (wasSaved) { this._ids = this._ids.filter((x) => x !== id); }
    else { this._ids.push(id); }
    this.save();
    const nowSaved = this.isSaved(id);
    RecipeSaveCountRepository.onSaveToggle(id, wasSaved, nowSaved);
    return nowSaved;
  },
  getRecipes() {
    return this._ids.map((id) => RecipeRepository.getById(id)).filter(Boolean);
  },
};

const RecipeSaveCountRepository = {
  _counts: {},
  load() {
    this._counts = StorageAdapter.get(CONFIG.STORAGE.SAVE_COUNTS, null);
    if (!this._counts) {
      this._counts = {};
      BUILTIN_RECIPES.forEach((r, i) => {
        this._counts[r.id] = builtinSaveSeed(i);
      });
      this.save();
    }
    return this._counts;
  },
  save() { StorageAdapter.set(CONFIG.STORAGE.SAVE_COUNTS, this._counts); },
  ensure(id) {
    if (this._counts[id] == null) {
      this._counts[id] = 0;
      this.save();
    }
  },
  getCount(id) {
    this.ensure(id);
    return this._counts[id] || 0;
  },
  onSaveToggle(id, wasSaved, nowSaved) {
    this.ensure(id);
    if (!wasSaved && nowSaved) this._counts[id] += 1;
    else if (wasSaved && !nowSaved) this._counts[id] = Math.max(0, this._counts[id] - 1);
    this.save();
  },
  syncExistingUserSaves(savedIds) {
    if (StorageAdapter.get(CONFIG.STORAGE.SAVE_COUNTS_USER_SYNC, false)) return;
    savedIds.forEach((id) => {
      this.ensure(id);
      this._counts[id] += 1;
    });
    this.save();
    StorageAdapter.set(CONFIG.STORAGE.SAVE_COUNTS_USER_SYNC, true);
  },
};

const MealLogRepository = {
  _logs: [],
  load() {
    this.clearSession();
    return this._logs;
  },
  save() {
    // 식사 기록 — localStorage 미사용
  },
  clearSession() {
    this._logs = [];
  },
  replaceAll(logs) {
    this._logs = (logs || []).map((log) => ({
      ...log,
      mealType: normalizeMealType(log.mealType),
      cost: Number(log.cost) || 0,
      currency: log.currency || DEFAULT_CURRENCY,
    }));
  },
  getAll() { return this._logs; },
  getByDate(date) { return this._logs.filter((l) => l.date === date); },
  getByMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this._logs.filter((l) => l.date.startsWith(prefix));
  },
  create(data) {
    const log = {
      id: StorageAdapter.createId('meal'),
      date: data.date,
      name: data.name,
      mealType: normalizeMealType(data.mealType),
      recipeId: data.recipeId || null,
      cost: normalizeMealType(data.mealType) === 'home-cook' ? 0 : Number(data.cost) || 0,
      currency: data.currency || DEFAULT_CURRENCY,
      ingredients: data.ingredients || [],
      memo: data.memo || '',
      photo: data.photo || '',
      usedExpiringIngredients: data.usedExpiringIngredients || false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._logs.push(log);
    this.save();
    return log;
  },
  update(id, data) {
    const i = this._logs.findIndex((l) => l.id === id);
    if (i === -1) return null;
    const preservedCurrency = this._logs[i].currency;
    const { currency, ...rest } = data;
    const next = { ...this._logs[i], ...rest, updatedAt: new Date().toISOString() };
    if (rest.mealType != null) next.mealType = normalizeMealType(rest.mealType);
    next.cost = next.mealType === 'home-cook' ? 0 : Number(next.cost) || 0;
    next.currency = currency != null ? currency : preservedCurrency;
    this._logs[i] = next;
    this.save();
    return this._logs[i];
  },
  remove(id) {
    this._logs = this._logs.filter((l) => l.id !== id);
    this.save();
  },
  logFromRecipe(recipe, date, mealType = 'home-cook') {
    const matched = MatchService.analyze(RecommendationService.getPantryNames(), recipe.ingredients);
    const usedExpiring = RecommendationService.getExpiryBoost(matched.matchedPantryNames) > 0;
    return this.create({
      date,
      name: recipe.name,
      mealType,
      recipeId: recipe.id,
      ingredients: [...recipe.ingredients],
      memo: '',
      photo: '',
      usedExpiringIngredients: usedExpiring,
    });
  },
};

const shoppingPantryAddInFlight = new Set();

function normalizeShoppingItem(raw) {
  if (raw && typeof raw === 'object' && raw.name) {
    return {
      name: String(raw.name).trim(),
      quantity: String(raw.quantity || '').trim(),
      unit: String(raw.unit || '').trim(),
      price: raw.price !== '' && raw.price != null ? String(raw.price) : '',
    };
  }
  const parsed = parseRecipeIngredient(raw);
  return {
    name: (parsed.name || formatIngredientDisplay(parsed)).trim(),
    quantity: String(parsed.quantity || '').trim(),
    unit: String(parsed.unit || '').trim(),
    price: '',
  };
}

function normalizeShoppingRecord(record) {
  if (!record) return null;
  const items = Array.isArray(record.items) && record.items.length
    ? record.items.map(normalizeShoppingItem).filter((item) => item.name)
    : (record.ingredients || []).map(normalizeShoppingItem).filter((item) => item.name);
  const ingredientsAdded = Boolean(record.ingredientsAdded ?? record.pantryAdded);
  return {
    ...record,
    type: record.type || 'shopping',
    items,
    ingredients: items.map((item) => formatIngredientDisplay(item)),
    ingredientsAdded,
    pantryAdded: ingredientsAdded,
  };
}

function isShoppingIngredientsAdded(record) {
  return Boolean(normalizeShoppingRecord(record)?.ingredientsAdded);
}

function getShoppingRecordItems(record) {
  return normalizeShoppingRecord(record)?.items || [];
}

function mergePantryQuantityFields(existingQty, existingUnit, nextQty, nextUnit) {
  const currentQty = String(existingQty || '').trim();
  const currentUnit = String(existingUnit || '').trim();
  const addQty = String(nextQty || '').trim();
  const addUnit = String(nextUnit || '').trim();
  if (!addQty) return { quantity: currentQty, unit: currentUnit };
  if (!currentQty) return { quantity: addQty, unit: addUnit || currentUnit };
  if (currentUnit && addUnit && currentUnit !== addUnit) {
    return { quantity: `${currentQty}${currentUnit} + ${addQty}${addUnit}`, unit: '' };
  }
  const unit = addUnit || currentUnit;
  const a = Number(currentQty);
  const b = Number(addQty);
  if (!Number.isNaN(a) && !Number.isNaN(b)) return { quantity: String(a + b), unit };
  return { quantity: `${currentQty} + ${addQty}`, unit };
}

async function addShoppingItemsToPantry(record) {
  const normalized = normalizeShoppingRecord(record);
  const items = normalized?.items || [];
  if (!items.length) return { added: 0, merged: 0 };
  let added = 0;
  let merged = 0;
  for (const item of items) {
    const existing = getPantryItemsForUi().find(
      (pantryItem) => MatchService.normalize(pantryItem.name) === MatchService.normalize(item.name),
    );
    if (existing) {
      const next = mergePantryQuantityFields(existing.quantity, existing.unit, item.quantity, item.unit);
      await updatePantryItem(existing.id, {
        quantity: next.quantity,
        unit: next.unit || existing.unit || item.unit,
      });
      merged += 1;
    } else {
      await createPantryItem({
        name: item.name,
        quantity: item.quantity,
        unit: item.unit,
        expiryDate: '',
        recipeId: record.recipeId,
        recipeName: record.recipeName,
      }, { showGuestHint: false });
      added += 1;
    }
  }
  return { added, merged };
}

async function markShoppingRecordsIngredientsAdded(recordIds) {
  for (const recordId of recordIds) {
    const record = ShoppingRecordRepository.getAll().find((entry) => entry.id === recordId);
    if (!record || isShoppingIngredientsAdded(record)) continue;
    const saved = await saveShoppingRecordToStore({
      ...normalizeShoppingRecord(record),
      ingredientsAdded: true,
      pantryAdded: true,
    }, recordId);
    upsertShoppingRecordLocal(saved);
  }
}

const ShoppingRecordRepository = {
  _records: [],
  load() {
    this.clearSession();
    return this._records;
  },
  save() {
    // 장보기 기록 — localStorage 미사용
  },
  clearSession() {
    this._records = [];
  },
  replaceAll(records) {
    this._records = (records || []).map((record) => normalizeShoppingRecord({
      ...record,
      amount: Number(record.amount) || 0,
      store: record.store || '',
      currency: record.currency || DEFAULT_CURRENCY,
      recipeId: record.recipeId || null,
      recipeName: record.recipeName || '',
      groceryItemKey: record.groceryItemKey || '',
      source: record.source || '',
    }));
  },
  getAll() { return this._records; },
  getByDate(date) { return this._records.filter((r) => r.date === date); },
  getByMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this._records.filter((r) => r.date.startsWith(prefix));
  },
  create(data) {
    const record = normalizeShoppingRecord({
      id: StorageAdapter.createId('shopping'),
      type: 'shopping',
      date: data.date,
      amount: Number(data.amount) || 0,
      store: data.store || '',
      currency: data.currency || DEFAULT_CURRENCY,
      items: data.items,
      ingredients: data.ingredients,
      recipeId: data.recipeId || null,
      recipeName: data.recipeName || '',
      ingredientsAdded: Boolean(data.ingredientsAdded),
      pantryAdded: Boolean(data.pantryAdded ?? data.ingredientsAdded),
      groceryItemKey: data.groceryItemKey || '',
      source: data.source || '',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
    this._records.push(record);
    this.save();
    return record;
  },
  update(id, data) {
    const i = this._records.findIndex((r) => r.id === id);
    if (i === -1) return null;
    const preservedCurrency = this._records[i].currency;
    const { currency, ...rest } = data;
    this._records[i] = normalizeShoppingRecord({
      ...this._records[i],
      ...rest,
      amount: Number(rest.amount ?? this._records[i].amount) || 0,
      updatedAt: new Date().toISOString(),
      currency: currency != null ? currency : preservedCurrency,
    });
    this.save();
    return this._records[i];
  },
  remove(id) {
    this._records = this._records.filter((r) => r.id !== id);
    this.save();
  },
};

const MealPlanRepository = {
  _plans: {},
  load() {
    this.clearSession();
    return this._plans;
  },
  save() {
    // 식단 플랜 — localStorage 미사용
  },
  clearSession() {
    this._plans = {};
  },
  replaceAll(plans) {
    try {
      this._plans = JSON.parse(JSON.stringify(plans && typeof plans === 'object' ? plans : {}));
    } catch {
      this._plans = {};
    }
  },
  /** 저장용 깊은 복사 — 스냅샷/클리어와 참조가 섞이지 않게 */
  exportPlans() {
    try {
      return JSON.parse(JSON.stringify(this._plans || {}));
    } catch {
      return {};
    }
  },
  get(date, slot) {
    const raw = this._plans?.[date]?.[slot] || {};
    const recipeId = raw.recipeId || '';
    const name = raw.name || '';
    const type = raw.type === 'manual' || (!recipeId && name)
      ? 'manual'
      : (recipeId ? 'recipe' : (raw.type || ''));
    return {
      type,
      recipeId,
      name,
      memo: raw.memo || '',
      recorded: Boolean(raw.recorded),
    };
  },
  set(date, slot, data) {
    if (!this._plans[date]) this._plans[date] = {};
    const recipeId = data.recipeId || '';
    const name = data.name || '';
    const type = data.type === 'manual' || (!recipeId && name)
      ? 'manual'
      : (recipeId ? 'recipe' : '');
    const next = {
      type,
      recipeId,
      name,
      memo: data.memo || '',
      recorded: Boolean(data.recorded),
    };
    if (!next.recipeId && !next.name) {
      delete this._plans[date][slot];
    } else {
      this._plans[date][slot] = next;
    }
    if (!Object.keys(this._plans[date]).length) delete this._plans[date];
    this.save();
  },
  getRange(startDate, days) {
    return Array.from({ length: days }, (_, i) => {
      const d = new Date(`${startDate}T00:00:00`);
      d.setDate(d.getDate() + i);
      return d.toISOString().slice(0, 10);
    });
  },
};

function parseGroceryAmount(value) {
  const normalized = String(value ?? '').replace(/,/g, '').trim();
  if (!normalized) return 0;
  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : 0;
}

const GroceryRepository = {
  _state: { budget: '', items: {}, manualItems: [], completedKeys: [], purchasedLedger: [] },
  _byWeek: {},
  _activeWeekKey: '',
  _emptyWeekState() {
    return { budget: '', items: {}, manualItems: [], completedKeys: [], purchasedLedger: [] };
  },
  _isWeekEmpty(weekState) {
    if (!weekState || typeof weekState !== 'object') return true;
    const budget = weekState.budget ?? weekState.weeklyBudget ?? '';
    if (budget !== '' && budget != null) return false;
    const items = weekState.items && typeof weekState.items === 'object' ? weekState.items : {};
    if (Object.keys(items).length > 0) return false;
    if (Array.isArray(weekState.manualItems) && weekState.manualItems.length > 0) return false;
    if (Array.isArray(weekState.completedKeys) && weekState.completedKeys.length > 0) return false;
    return !(Array.isArray(weekState.purchasedLedger) && weekState.purchasedLedger.length > 0);
  },
  _normalizePurchasedLedgerEntry(entry, weekKey = '') {
    const key = String(entry?.key || entry?.id || '').trim();
    if (!key) return null;
    const rawPrice = entry?.actualPrice ?? entry?.actualAmount;
    const actualPrice = rawPrice === '' || rawPrice == null
      ? 0
      : parseGroceryAmount(rawPrice);
    return {
      id: String(entry?.id || key),
      key,
      name: String(entry?.name || '').trim(),
      actualPrice: String(actualPrice),
      actualAmount: String(actualPrice),
      quantity: String(entry?.quantity ?? '').trim(),
      purchasedAt: entry?.purchasedAt || '',
      weekKey: String(entry?.weekKey || weekKey || ''),
      shoppingRecordId: String(entry?.shoppingRecordId || '').trim(),
      status: 'purchased',
    };
  },
  _normalizeWeekState(state) {
    const weekKey = normalizeGroceryWeekKey(state?.weekKey || this._activeWeekKey || todayStr());
    const ledgerRaw = Array.isArray(state?.purchasedLedger)
      ? state.purchasedLedger
      : (Array.isArray(state?.purchasedRecords) ? state.purchasedRecords : []);
    return {
      weekKey,
      budget: state?.budget ?? state?.weeklyBudget ?? '',
      items: state?.items && typeof state.items === 'object'
        ? state.items
        : (state?.groceryItems && typeof state.groceryItems === 'object' ? state.groceryItems : {}),
      manualItems: Array.isArray(state?.manualItems)
        ? state.manualItems.map((item) => this._normalizeManualItem(item)).filter(Boolean)
        : [],
      completedKeys: Array.isArray(state?.completedKeys) ? [...state.completedKeys] : [],
      purchasedLedger: ledgerRaw
        .map((entry) => this._normalizePurchasedLedgerEntry(entry, weekKey))
        .filter(Boolean),
    };
  },
  _cloneWeekState(state) {
    try {
      return this._normalizeWeekState(JSON.parse(JSON.stringify(state || this._emptyWeekState())));
    } catch {
      return this._emptyWeekState();
    }
  },
  clearSession() {
    this._byWeek = {};
    this._activeWeekKey = '';
    this._state = this._emptyWeekState();
  },
  load() {
    // 게스트=메모리만, 로그인=Firestore 스냅샷으로 채움. localStorage 미사용.
    this.clearSession();
    return this._state;
  },
  save() {
    // 주차 작업본만 메모리 byWeek에 커밋. 디스크/Firestore 쓰기는 persistGroceryState가 담당.
    this._syncActiveWeekToByWeek();
  },
  _syncActiveWeekToByWeek() {
    const key = normalizeGroceryWeekKey(this._activeWeekKey || todayStr());
    this._activeWeekKey = key;
    if (!Array.isArray(this._state.purchasedLedger)) this._state.purchasedLedger = [];
    if (!Array.isArray(this._state.completedKeys)) this._state.completedKeys = [];
    if (!this._state.items || typeof this._state.items !== 'object') this._state.items = {};
    if (!Array.isArray(this._state.manualItems)) this._state.manualItems = [];
    this._state.weekKey = key;
    const next = this._cloneWeekState(this._state);
    const prev = this._byWeek[key];
    // 빈 작업본으로 이미 채워진 주차 스냅샷을 덮지 않음 (새로고침 레이스)
    if (prev && this._isWeekEmpty(next) && !this._isWeekEmpty(prev)) {
      this._state = this._cloneWeekState(prev);
      this._state.weekKey = key;
      return;
    }
    this._byWeek[key] = next;
  },
  exportState() {
    this._syncActiveWeekToByWeek();
    const byWeek = {};
    Object.entries(this._byWeek || {}).forEach(([weekKey, weekState]) => {
      const key = normalizeGroceryWeekKey(weekKey);
      const cloned = this._cloneWeekState({ ...weekState, weekKey: key });
      // 빈 주는 Firestore로 보내지 않음
      if (this._isWeekEmpty(cloned)) return;
      byWeek[key] = cloned;
    });
    const activeWeekKey = normalizeGroceryWeekKey(this._activeWeekKey || todayStr());
    // 메모리 byWeek는 유지하되, 전송 payload만 non-empty
    return { activeWeekKey, byWeek };
  },
  setActiveWeek(weekKey) {
    const key = normalizeGroceryWeekKey(weekKey || todayStr());

    // 같은 주차면 작업본만 byWeek에 커밋하고 끝 (리렌더 시 데이터 유실 방지)
    if (this._activeWeekKey === key) {
      this._syncActiveWeekToByWeek();
      return;
    }

    // 현재 주차 작업본을 저장소에 커밋 (빈 값으로 non-empty를 덮지 않음)
    if (this._activeWeekKey) {
      if (!Array.isArray(this._state.purchasedLedger)) this._state.purchasedLedger = [];
      this._state.weekKey = this._activeWeekKey;
      const prev = this._byWeek[this._activeWeekKey];
      const next = this._cloneWeekState(this._state);
      if (!(prev && this._isWeekEmpty(next) && !this._isWeekEmpty(prev))) {
        this._byWeek[this._activeWeekKey] = next;
      }
    } else {
      const hasData = (Array.isArray(this._state.purchasedLedger) && this._state.purchasedLedger.length > 0)
        || Object.keys(this._state.items || {}).length > 0
        || (this._state.budget !== '' && this._state.budget != null)
        || (Array.isArray(this._state.manualItems) && this._state.manualItems.length > 0);
      if (hasData && !this._byWeek[key]) {
        this._state.weekKey = key;
        this._byWeek[key] = this._cloneWeekState(this._state);
      }
    }

    this._activeWeekKey = key;
    if (!this._byWeek[key]) {
      this._byWeek[key] = this._emptyWeekState();
      this._byWeek[key].weekKey = key;
    }
    // 작업본은 clone — byWeek 스냅샷과 분리해 이후 편집이 다른 주를 덮지 않음
    this._state = this._cloneWeekState(this._byWeek[key]);
    this._state.weekKey = key;
  },
  replaceState(state, { strategy = 'replace' } = {}) {
    const byWeek = state?.byWeek && typeof state.byWeek === 'object' ? state.byWeek : null;
    const weekEntries = byWeek ? Object.entries(byWeek) : [];
    if (weekEntries.length) {
      // 같은 주로 정규화되는 키가 여러 개면 날짜 키(YYYY-MM-DD)가 마지막에 오도록 정렬
      weekEntries.sort(([a], [b]) => {
        const aCanon = /^\d{4}-\d{2}-\d{2}$/.test(a) ? 1 : 0;
        const bCanon = /^\d{4}-\d{2}-\d{2}$/.test(b) ? 1 : 0;
        return aCanon - bCanon;
      });

      if (strategy === 'replace') {
        // Firestore 스냅샷이 기준 — 주차별 budget/ledger를 통째로 교체 (오래된 원장 병합 금지)
        const nextByWeek = {};
        weekEntries.forEach(([weekKey, weekState]) => {
          const normalizedKey = normalizeGroceryWeekKey(weekKey);
          nextByWeek[normalizedKey] = this._normalizeWeekState({ ...weekState, weekKey: normalizedKey });
        });
        this._byWeek = nextByWeek;
      } else {
        // 주차 단위로 병합 — 스냅샷에 없는 다른 주차 데이터를 지우지 않음
        weekEntries.forEach(([weekKey, weekState]) => {
          const normalizedKey = normalizeGroceryWeekKey(weekKey);
          const normalized = this._normalizeWeekState({ ...weekState, weekKey: normalizedKey });
          if (this._byWeek[normalizedKey]) {
            const prev = this._byWeek[normalizedKey];
            this._byWeek[normalizedKey] = this._normalizeWeekState({
              ...prev,
              ...normalized,
              budget: normalized.budget !== '' && normalized.budget != null ? normalized.budget : prev.budget,
              items: { ...prev.items, ...normalized.items },
              manualItems: normalized.manualItems.length ? normalized.manualItems : prev.manualItems,
              completedKeys: [...new Set([...(prev.completedKeys || []), ...(normalized.completedKeys || [])])],
              purchasedLedger: [
                ...(prev.purchasedLedger || []),
                ...(normalized.purchasedLedger || []).filter(
                  (entry) => !(prev.purchasedLedger || []).some((p) => p.key === entry.key || p.id === entry.id),
                ),
              ],
              weekKey: normalizedKey,
            });
          } else {
            this._byWeek[normalizedKey] = normalized;
          }
        });
      }

      const activeKey = normalizeGroceryWeekKey(
        state?.activeWeekKey || this._activeWeekKey || todayStr(),
      );
      this.setActiveWeek(activeKey);
      if (Array.isArray(state?.purchasedLedger) && state.purchasedLedger.length
        && this.getPurchasedLedger().length === 0) {
        state.purchasedLedger.forEach((entry) => this.upsertPurchasedLedgerEntry(entry));
      }
      return;
    }
    // 레거시 단일 주차: 해당 week만 갱신하고 다른 주차는 유지
    const weekKey = normalizeGroceryWeekKey(state?.activeWeekKey || this._activeWeekKey || todayStr());
    this._byWeek[weekKey] = this._normalizeWeekState({ ...state, weekKey });
    this.setActiveWeek(weekKey);
  },
  _normalizeManualItem(raw) {
    const name = String(raw?.name || '').trim();
    if (!name) return null;
    const id = raw?.id || StorageAdapter.createId('grocery-item');
    return {
      id,
      name,
      quantity: String(raw?.quantity || '').trim(),
      unit: String(raw?.unit || '').trim(),
      price: raw?.price !== '' && raw?.price != null ? String(raw.price) : '',
      createdAt: raw?.createdAt || new Date().toISOString(),
    };
  },
  getManualItems() {
    return [...(this._state.manualItems || [])];
  },
  addManualItem(data) {
    const item = this._normalizeManualItem({
      ...data,
      id: StorageAdapter.createId('grocery-item'),
      createdAt: new Date().toISOString(),
    });
    if (!item) return null;
    this._state.manualItems.push(item);
    const key = GroceryListService.manualItemKey(item.id);
    this._state.items[key] = { checked: false, price: item.price, actualAmount: '' };
    this.save();
    return item;
  },
  getMeta(key) {
    return this._state.items[key] || { checked: false, price: '', actualAmount: '', shoppingRecordId: '' };
  },
  setItemAmounts(key, { price, actualAmount }) {
    const meta = this.getMeta(key);
    const nextActual = actualAmount === undefined ? meta.actualAmount : actualAmount;
    this._state.items[key] = {
      ...meta,
      price: price ?? meta.price,
      actualAmount: nextActual === '' || nextActual == null ? '' : String(nextActual),
    };
    this.save();
  },
  setChecked(key, checked) {
    const meta = this.getMeta(key);
    this._state.items[key] = {
      ...meta,
      checked: Boolean(checked),
      actualAmount: meta.actualAmount === '' || meta.actualAmount == null ? '' : String(meta.actualAmount),
    };
    this.save();
  },
  setPrice(key, price) {
    this._state.items[key] = { ...this.getMeta(key), price };
    this.save();
  },
  setActualAmount(key, actualAmount) {
    this._state.items[key] = { ...this.getMeta(key), actualAmount };
    this.save();
  },
  setShoppingRecordId(key, shoppingRecordId) {
    this._state.items[key] = { ...this.getMeta(key), shoppingRecordId: shoppingRecordId || '' };
    this.save();
  },
  setBudget(budget) {
    this._state.budget = budget;
    markGroceryLocalMutation();
    this.save();
  },
  getBudget() { return this._state.budget || ''; },
  getPurchasedLedger() {
    this._syncActiveWeekToByWeek();
    return Array.isArray(this._state.purchasedLedger) ? [...this._state.purchasedLedger] : [];
  },
  /** purchaseId(id|key)로 현재 주차 purchasedRecord 1건 삭제 */
  removePurchasedLedgerById(purchaseId) {
    this._syncActiveWeekToByWeek();
    const id = String(purchaseId || '').trim();
    if (!id || !Array.isArray(this._state.purchasedLedger)) return null;
    const entry = this._state.purchasedLedger.find(
      (item) => item.id === id || item.key === id,
    );
    if (!entry) return null;
    this._state.purchasedLedger = this._state.purchasedLedger.filter(
      (item) => item.id !== entry.id && item.key !== entry.key,
    );
    const groceryKey = entry.key || entry.id;
    if (groceryKey && this._state.items?.[groceryKey]) {
      const meta = this._state.items[groceryKey];
      this._state.items[groceryKey] = {
        ...meta,
        shoppingRecordId: '',
        checked: false,
        actualAmount: '',
      };
    }
    markGroceryLocalMutation();
    this.save();
    return { ...entry };
  },
  /**
   * 식사달력 장보기 기록 삭제 시 해당 주차 구매완료(사용금액) 원장에서 제거
   * @returns {boolean} 항목이 제거되었는지
   */
  removePurchasedLedgerForShoppingRecord(record) {
    if (!record) return false;
    const weekKey = getWeekKeyFromDateStr(record.date || todayStr());
    const prevWeek = this._activeWeekKey;
    this.setActiveWeek(weekKey);

    const recordId = String(record.id || '').trim();
    const groceryKey = String(record.groceryItemKey || '').trim();
    const amount = parseGroceryAmount(record.amount);
    const names = new Set(
      (Array.isArray(record.items) ? record.items : [])
        .map((item) => MatchService.normalize(item?.name || ''))
        .filter(Boolean),
    );

    if (!Array.isArray(this._state.purchasedLedger)) this._state.purchasedLedger = [];
    const before = this._state.purchasedLedger.length;
    let manualMatched = false;
    this._state.purchasedLedger = this._state.purchasedLedger.filter((entry) => {
      if (recordId && (entry.shoppingRecordId === recordId || entry.id === recordId)) return false;
      if (groceryKey && (entry.key === groceryKey || entry.id === groceryKey)) return false;
      // groceryItemKey 없는 수동 기록: 이름+금액이 일치하는 원장 1건만 제거
      if (!groceryKey && !manualMatched && names.size) {
        const entryName = MatchService.normalize(entry.name || '');
        const entryAmount = parseGroceryAmount(entry.actualPrice ?? entry.actualAmount);
        if (names.has(entryName) && entryAmount === amount) {
          manualMatched = true;
          return false;
        }
      }
      return true;
    });
    const ledgerRemoved = this._state.purchasedLedger.length !== before;

    let metaUpdated = false;
    if (groceryKey && this._state.items?.[groceryKey]) {
      const meta = this._state.items[groceryKey];
      const linked = !recordId || meta.shoppingRecordId === recordId || !meta.shoppingRecordId;
      if (linked) {
        this._state.items[groceryKey] = {
          ...meta,
          shoppingRecordId: '',
          checked: false,
          actualAmount: '',
        };
        metaUpdated = true;
      }
    } else if (recordId) {
      Object.keys(this._state.items || {}).forEach((key) => {
        const meta = this._state.items[key];
        if (meta?.shoppingRecordId !== recordId) return;
        this._state.items[key] = { ...meta, shoppingRecordId: '', checked: false, actualAmount: '' };
        metaUpdated = true;
      });
    }

    const changed = ledgerRemoved || metaUpdated;
    if (changed) {
      markGroceryLocalMutation();
      this.save();
    }

    const restoreKey = state.plannerWeekKey || prevWeek;
    if (restoreKey) this.setActiveWeek(restoreKey);
    return changed;
  },
  upsertPurchasedLedgerEntry(entry) {
    this._syncActiveWeekToByWeek();
    const weekKey = this._activeWeekKey || getWeekKeyFromDateStr(todayStr());
    const nextEntry = this._normalizePurchasedLedgerEntry({
      ...entry,
      weekKey: entry?.weekKey || weekKey,
      purchasedAt: entry?.purchasedAt || new Date().toISOString(),
      status: 'purchased',
    }, weekKey);
    if (!nextEntry) return;
    if (!Array.isArray(this._state.purchasedLedger)) this._state.purchasedLedger = [];
    const existing = this._state.purchasedLedger.find(
      (item) => item.key === nextEntry.key || item.id === nextEntry.id,
    );
    if (existing) Object.assign(existing, nextEntry);
    else this._state.purchasedLedger.push(nextEntry);
    this._syncActiveWeekToByWeek();
    this.save();
  },
  archivePurchasedItem(item, explicitActualPrice) {
    if (!item?.key) return;
    this._syncActiveWeekToByWeek();
    const meta = this.getMeta(item.key);
    const actualPrice = explicitActualPrice != null
      ? parseGroceryAmount(explicitActualPrice)
      : parseGroceryAmount(meta.actualAmount);

    let quantity = '';
    let name = String(item.name || '').trim();
    if (item.manual && item.manualId) {
      const manual = this.getManualItems().find((entry) => entry.id === item.manualId);
      if (manual) {
        name = manual.name || name;
        quantity = [manual.quantity, manual.unit].filter(Boolean).join('');
      }
    } else if (item.count > 1) {
      quantity = String(item.count);
    }

    this.upsertPurchasedLedgerEntry({
      id: item.key,
      key: item.key,
      name,
      actualPrice,
      quantity,
      purchasedAt: meta.purchasedAt || new Date().toISOString(),
      weekKey: this._activeWeekKey || getWeekKeyFromDateStr(todayStr()),
      shoppingRecordId: meta.shoppingRecordId || '',
      status: 'purchased',
    });
  },
  getCompletedKeys() {
    return Array.isArray(this._state.completedKeys) ? this._state.completedKeys : [];
  },
  markItemCompleted(key) {
    if (!key) return;
    this._syncActiveWeekToByWeek();
    if (!Array.isArray(this._state.completedKeys)) this._state.completedKeys = [];
    if (!this._state.completedKeys.includes(key)) this._state.completedKeys.push(key);
    delete this._state.items[key];
    this.save();
  },
  removeManualItem(manualId) {
    this._syncActiveWeekToByWeek();
    const key = GroceryListService.manualItemKey(manualId);
    this._state.manualItems = (this._state.manualItems || []).filter((item) => item.id !== manualId);
    delete this._state.items[key];
    this._state.completedKeys = this.getCompletedKeys().filter((completedKey) => completedKey !== key);
    this.save();
  },
  completeCheckedItems(items, amountByKey = null) {
    this._syncActiveWeekToByWeek();
    for (const item of items || []) {
      const explicit = amountByKey && Object.prototype.hasOwnProperty.call(amountByKey, item.key)
        ? amountByKey[item.key]
        : undefined;
      this.archivePurchasedItem(item, explicit);
      if (item.manual && item.manualId) this.removeManualItem(item.manualId);
      else this.markItemCompleted(item.key);
    }
    this._syncActiveWeekToByWeek();
  },
  pruneCompletedKeys(activeMissingKeys) {
    const active = new Set(activeMissingKeys || []);
    const before = this.getCompletedKeys();
    this._state.completedKeys = before.filter((key) => active.has(key));
    if (this._state.completedKeys.length !== before.length) this.save();
  },
};

const GROCERY_CATEGORIES = [
  { id: 'vegetable', label: '🥬 채소', test: (n) => /양파|대파|쪽파|마늘|생강|당근|감자|고구마|호박|애호박|시금치|상추|깻잎|배추|양배추|브로콜리|파프리카|오이|가지|무|청경채|숙주|콩나물|미나리|부추|버섯|표고|새송이|느타리|냉이|순두부|두부|김치|나물|피망|샐러드/.test(n) },
  { id: 'fruit', label: '🍎 과일', test: (n) => /사과|배|바나나|딸기|포도|레몬|라임|오렌지|키위|블루베리|복숭아|수박|멜론|토마토|아보카도|망고|체리|자몽/.test(n) },
  { id: 'meat', label: '🥩 고기/해산물', test: (n) => /소고기|돼지|닭|삼겹|목살|베이컨|햄|참치|고등어|연어|새우|오징어|조개|명태|갈비|안심|등심|치킨|오리|육|해물|조기|꽃게|전복|문어|삼치/.test(n) },
  { id: 'dairy', label: '🥛 유제품', test: (n) => /우유|치즈|버터|요거트|생크림|모짜|크림치즈|계란|달걀|두유/.test(n) },
  { id: 'grain', label: '🌾 곡류', test: (n) => /쌀|밥|면|국수|라면|파스타|스파게티|빵|떡|밀가루|중력분|옥수수|시리얼|오트|현미|잡곡/.test(n) },
  { id: 'sauce', label: '🧂 소스/양념', test: (n) => /간장|된장|고추장|식초|설탕|소금|후추|참기름|들기름|올리브|케첩|마요|굴소스|다시다|미원|고춧가루|올리고|액젓|청|맛술|미림|와사비|머스타드|스테비아|알룰로스|물엿|올리브유/.test(n) },
  { id: 'frozen', label: '🧊 냉동', test: (n) => /냉동|얼린|아이스/.test(n) },
  { id: 'other', label: '📦 기타', test: () => true },
];

const GroceryListService = {
  manualItemKey(id) {
    return `manual:${id}`;
  },
  formatManualDisplay(item) {
    const name = String(item?.name || '').trim();
    const quantity = String(item?.quantity || '').trim();
    const unit = String(item?.unit || '').trim();
    if (quantity && unit) return `${name} ${quantity}${unit}`;
    if (quantity) return `${name} ${quantity}`;
    return name;
  },
  categorize(name) {
    const n = String(name || '');
    return GROCERY_CATEGORIES.find((c) => c.id === 'other' || c.test(n)) || GROCERY_CATEGORIES[GROCERY_CATEGORIES.length - 1];
  },
  itemKey(name) {
    return MatchService.normalize(parseRecipeIngredient(name).name || name);
  },
  getPlannerDates(weekStart) {
    return getWeekDates(weekStart || todayStr());
  },
  resolveEntry(text) {
    const trimmed = String(text || '').trim();
    if (!trimmed) return { recipeId: '', name: '' };
    const recipe = RecipeRepository.getRecommendableRecipes().find(
      (r) => MatchService.normalize(r.name) === MatchService.normalize(trimmed),
    );
    if (recipe) return { recipeId: recipe.id, name: recipe.name };
    return { recipeId: '', name: trimmed };
  },
  computeMissing(planDates) {
    const pantryNames = RecommendationService.getPantryNames();
    const map = new Map();
    for (const date of planDates) {
      for (const slot of PLANNER_SLOTS) {
        const entry = MealPlanRepository.get(date, slot.id);
        if (!entry.recipeId) continue;
        const recipe = RecipeRepository.getById(entry.recipeId);
        if (!recipe) continue;
        const { missing } = MatchService.analyze(pantryNames, recipe.ingredients);
        for (const raw of missing) {
          const { name } = parseRecipeIngredient(raw);
          const display = name || raw;
          const key = this.itemKey(display);
          const prev = map.get(key) || { key, name: display, count: 0 };
          prev.count += 1;
          map.set(key, prev);
        }
      }
    }
    const grouped = {};
    for (const cat of GROCERY_CATEGORIES) grouped[cat.id] = [];
    for (const item of map.values()) {
      const cat = this.categorize(item.name);
      grouped[cat.id].push(item);
    }
    for (const cat of GROCERY_CATEGORIES) {
      grouped[cat.id].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }
    this.mergeManualItems(grouped);
    const activeKeys = [
      ...map.keys(),
      ...GroceryRepository.getManualItems().map((item) => this.manualItemKey(item.id)),
    ];
    GroceryRepository.pruneCompletedKeys(activeKeys);
    const completed = new Set(GroceryRepository.getCompletedKeys());
    if (completed.size) {
      for (const cat of GROCERY_CATEGORIES) {
        grouped[cat.id] = grouped[cat.id].filter((item) => !completed.has(item.key));
      }
    }
    return grouped;
  },
  mergeManualItems(grouped) {
    for (const item of GroceryRepository.getManualItems()) {
      const cat = this.categorize(item.name);
      grouped[cat.id].push({
        key: this.manualItemKey(item.id),
        name: this.formatManualDisplay(item),
        count: 1,
        manual: true,
        manualId: item.id,
      });
    }
    for (const cat of GROCERY_CATEGORIES) {
      grouped[cat.id].sort((a, b) => a.name.localeCompare(b.name, 'ko'));
    }
  },
  estimateTotal(grouped) {
    let total = 0;
    for (const cat of GROCERY_CATEGORIES) {
      for (const item of grouped[cat.id] || []) {
        total += Number(GroceryRepository.getMeta(item.key).price) || 0;
      }
    }
    return total;
  },
  isIngredientInGroceryList(ingredientName, grouped) {
    const normalized = MatchService.normalize(parseRecipeIngredient(ingredientName).name || ingredientName);
    for (const cat of GROCERY_CATEGORIES) {
      for (const item of grouped[cat.id] || []) {
        if (item.key === this.itemKey(ingredientName)) return true;
        if (MatchService.normalize(item.name) === normalized) return true;
      }
    }
    for (const manual of GroceryRepository.getManualItems()) {
      if (MatchService.normalize(manual.name) === normalized) return true;
    }
    return false;
  },
  addMissingIngredientsFromRecipe(recipe, grouped) {
    const pantryNames = RecommendationService.getPantryNames();
    const { missing } = MatchService.analyze(pantryNames, recipe.ingredients || []);
    if (!missing.length) return { added: 0, missingCount: 0 };
    let added = 0;
    const seen = new Set();
    for (const raw of missing) {
      const item = parseRecipeIngredient(raw);
      const name = item.name || formatIngredientDisplay(item);
      const normalized = MatchService.normalize(name);
      if (!name || seen.has(normalized)) continue;
      seen.add(normalized);
      if (this.isIngredientInGroceryList(raw, grouped)) continue;
      const manual = GroceryRepository.addManualItem({
        name,
        quantity: item.quantity || '',
        unit: item.unit || '',
        price: '',
      });
      if (!manual) continue;
      added += 1;
      const cat = this.categorize(manual.name);
      grouped[cat.id].push({
        key: this.manualItemKey(manual.id),
        name: this.formatManualDisplay(manual),
        count: 1,
        manual: true,
        manualId: manual.id,
      });
    }
    return { added, missingCount: missing.length };
  },
};

const PantryIngredientService = {
  async addFromNames(names, options = {}) {
    const { recipeId = null, recipeName = null, skipDuplicates = true } = options;
    let added = 0;
    const addedNames = [];
    try {
      for (const raw of names) {
        const name = String(raw || '').trim();
        if (!name) continue;
        const dup = skipDuplicates && getPantryItemsForUi().some(
          (i) => MatchService.normalize(i.name) === MatchService.normalize(name),
        );
        if (dup) continue;
        await createPantryItem({ name, quantity: '', unit: '', expiryDate: '', recipeId, recipeName }, { showGuestHint: false });
        added += 1;
        addedNames.push(name);
      }
    } catch (err) {
      handlePantryFirestoreError(err);
      throw err;
    }
    if (added > 0) notifyGuestPantryNotPersisted();
    return { added, addedNames };
  },
};

function isAuthInitializing() {
  const gate = window.__authGateState || window.FirebaseServices?.getAuthGateState?.() || {};
  return gate.authLoading === true && !window.FirebaseServices?.AuthService?.isInitialAuthResolved?.();
}

async function ensureVideoAuthReady() {
  const authSvc = window.FirebaseServices?.AuthService;
  if (!authSvc?.waitForInitialAuth) return null;
  return authSvc.waitForInitialAuth();
}

function isLoggedInAppUser() {
  if (isAuthInitializing()) return false;
  const authSvc = window.FirebaseServices?.AuthService;
  if (authSvc?.isLoggedIn?.()) return true;
  return Boolean(window.FirebaseServices?.auth?.currentUser?.uid);
}

/** @see js/login-required-modal.js — redirectAfterLogin 패턴 */
function requireAppLogin(actionOrOptions) {
  return window.LoginRequiredModal?.requireAuth(actionOrOptions);
}

function syncAuthGateUi() {
  window.AuthGateUI?.sync();
}

function isGuestUser() {
  return !isLoggedInAppUser();
}

function getPantryItemsForUi() {
  return PantryRepository.getAll();
}

function clearAllUserDataState() {
  PantryRepository.clearSession();
  RecipeRepository.clearSession();
  SavedRecipeRepository.clearSession();
  MealLogRepository.clearSession();
  ShoppingRecordRepository.clearSession();
  MealPlanRepository.clearSession();
  GroceryRepository.clearSession();
  state.monthlyFoodBudget = 0;
  mealPlanLocalMutatedAt = 0;
  groceryLocalMutatedAt = 0;
  resetGroceryFirestoreReady();
}

function clearUserData() {
  window.FirebaseServices?.FirestoreIngredientService?.stopSync?.();
  clearAllUserDataState();
  purgeLegacyUserDataFromLocalStorage({ includePantry: true });
  refreshAll();
  console.log('LOGOUT_SUCCESS_AND_USER_DATA_CLEARED');
}

function switchToGuestPantry() {
  clearUserData();
}

function reloadGuestPantry() {
  clearAllUserDataState();
  refreshAll();
}

function notifyGuestPantryNotPersisted() {
  if (!isLoggedInAppUser()) {
    showToast('로그인하면 입력한 재료를 저장할 수 있어요.');
  }
}

function notifyGuestPersonalDataNotPersisted(label = '입력한 내용') {
  if (!isLoggedInAppUser()) {
    showToast(`로그인하면 ${label}을 저장할 수 있어요.`);
  }
}

function getFirestoreUserDataSync() {
  return window.FirebaseServices?.FirestoreUserDataSync || null;
}

function buildRecipePayload(data, existing = null) {
  const cat = CATEGORY_MAP[data.category] || CATEGORY_MAP.korean;
  const now = new Date().toISOString();
  const base = existing || {};
  const recipeId = base.id || StorageAdapter.createId('recipe');
  const sourceUrl = data.sourceUrl ?? base.sourceUrl ?? null;
  const videoNorm = sourceUrl ? VideoRecipeAnalysisService.normalizeVideoSource(sourceUrl) : null;
  return {
    ...base,
    id: recipeId,
    firestoreId: base.firestoreId || recipeId,
    name: data.name,
    ingredients: normalizeIngredientList(data.ingredients || base.ingredients || []),
    steps: data.steps,
    cookTime: Number(data.cookTime),
    difficulty: data.difficulty,
    category: data.category,
    dishType: data.dishType || DishTypeService.infer(data.name),
    cuisine: cat.cuisine,
    tags: [...cat.tags],
    dietTags: [...cat.dietTags],
    image: data.image || base.image || DEFAULT_IMAGE,
    calories: data.calories ?? base.calories ?? null,
    memo: data.memo || '',
    parentRecipeId: data.parentRecipeId ?? base.parentRecipeId ?? null,
    createdFrom: data.createdFrom ?? base.createdFrom ?? null,
    sourceUrl,
    sourcePlatform: data.sourcePlatform ?? base.sourcePlatform ?? null,
    normalizedVideoId: data.normalizedVideoId ?? videoNorm?.normalizedVideoId ?? base.normalizedVideoId ?? null,
    normalizedSourceUrl: data.normalizedSourceUrl ?? videoNorm?.normalizedSourceUrl ?? base.normalizedSourceUrl ?? null,
    thumbnailUrl: data.thumbnailUrl ?? base.thumbnailUrl ?? null,
    ingredientSubstitutes: data.ingredientSubstitutes ?? base.ingredientSubstitutes ?? [],
    optionalIngredients: normalizeIngredientList(data.optionalIngredients ?? base.optionalIngredients ?? []),
    authorId: window.FirebaseServices?.auth?.currentUser?.uid || base.authorId || CONFIG.LOCAL_USER_ID,
    authorName: base.authorName || CONFIG.LOCAL_USER_NAME,
    visibility: data.visibility || 'private',
    source: 'user',
    createdAt: base.createdAt || now,
    updatedAt: now,
  };
}

async function saveUserRecipe(data, editingId = null) {
  const existing = editingId ? RecipeRepository.getById(editingId) : null;
  if (existing && (existing.source === 'builtin' || !RecipeRepository.isOwned(existing))) {
    throw new Error('수정할 수 없는 레시피입니다.');
  }

  const sourceUrl = data.sourceUrl || existing?.sourceUrl || null;
  if (sourceUrl && !editingId && findDuplicateVideoRecipe(sourceUrl)) {
    const err = new Error(VIDEO_DUPLICATE_TOAST);
    err.code = 'DUPLICATE_VIDEO_SOURCE';
    throw err;
  }

  if (!isLoggedInAppUser()) {
    const recipe = editingId ? RecipeRepository.update(editingId, data) : RecipeRepository.create(data);
    notifyGuestPersonalDataNotPersisted('레시피');
    return recipe;
  }

  const sync = getFirestoreUserDataSync();
  if (!sync) throw new Error('Firestore 동기화를 시작하는 중입니다. 잠시 후 다시 시도해 주세요.');
  const merged = buildRecipePayload(data, existing);
  const uid = window.FirebaseServices?.auth?.currentUser?.uid;
  const authUser = window.FirebaseServices?.auth?.currentUser;
  const recipeId = merged.firestoreId || merged.id;
  const savePath = `users/${uid}/myRecipes/${recipeId}`;
  const isNewRecipe = !editingId && !existing?.firestoreId;
  console.log('[saveUserRecipe] Firestore 저장 시도', {
    uid,
    path: savePath,
    source: data.createdFrom || (editingId ? 'edit' : 'manual'),
    visibility: merged.visibility,
    isNewRecipe,
  });

  try {
    if (authUser && window.FirebaseServices?.FirestoreUserService) {
      await window.FirebaseServices.FirestoreUserService.ensureUserDocument(authUser);
    }
    await sync.myRecipes.saveRecipe(merged, { isNew: isNewRecipe });
  } catch (error) {
    if (error?.code === 'permission-denied') {
      console.error('[saveUserRecipe] PERMISSION_DENIED', { uid, path: savePath, message: error.message });
      throw new Error(
        '레시피 저장 권한이 없습니다. Firebase Console → Firestore → Rules에서 myRecipes 규칙을 배포했는지 확인해 주세요.',
      );
    }
    throw error;
  }
  return merged;
}

async function deleteUserRecipe(recipeId) {
  const recipe = RecipeRepository.getById(recipeId);
  if (!recipe || !RecipeRepository.isOwned(recipe)) return;

  if (!isLoggedInAppUser()) {
    RecipeRepository.remove(recipeId);
    SavedRecipeRepository._ids = SavedRecipeRepository._ids.filter((id) => id !== recipeId);
    notifyGuestPersonalDataNotPersisted('레시피');
    return;
  }

  await getFirestoreUserDataSync().myRecipes.deleteRecipe(recipe.firestoreId || recipe.id);
}

async function saveMealLogToStore(payload, editingId = null) {
  if (!isLoggedInAppUser()) {
    const log = editingId ? MealLogRepository.update(editingId, payload) : MealLogRepository.create(payload);
    notifyGuestPersonalDataNotPersisted('식사 기록');
    return log;
  }
  const existing = editingId ? MealLogRepository.getAll().find((l) => l.id === editingId) : null;
  const merged = existing ? { ...existing, ...payload } : { ...payload, id: StorageAdapter.createId('meal') };
  const logId = await getFirestoreUserDataSync().mealCalendar.saveLog(merged);
  return { ...merged, id: logId, firestoreId: logId };
}

async function deleteMealLogFromStore(logId) {
  if (!isLoggedInAppUser()) {
    MealLogRepository.remove(logId);
    notifyGuestPersonalDataNotPersisted('식사 기록');
    return;
  }
  const log = MealLogRepository.getAll().find((l) => l.id === logId);
  if (!log) return;
  await getFirestoreUserDataSync().mealCalendar.deleteLog(log.firestoreId || logId);
}

async function saveShoppingRecordToStore(payload, editingId = null) {
  if (!isLoggedInAppUser()) {
    const record = editingId
      ? ShoppingRecordRepository.update(editingId, payload)
      : ShoppingRecordRepository.create(payload);
    notifyGuestPersonalDataNotPersisted('장보기 기록');
    return record;
  }
  const existing = editingId ? ShoppingRecordRepository.getAll().find((r) => r.id === editingId) : null;
  const merged = existing ? { ...existing, ...payload } : { ...payload, id: StorageAdapter.createId('shopping') };
  const recordId = await getFirestoreUserDataSync().shopping.saveRecord(merged);
  return { ...merged, id: recordId, firestoreId: recordId };
}

async function deleteShoppingRecordFromStore(recordId, { syncGrocery = true } = {}) {
  const record = ShoppingRecordRepository.getAll().find((r) => r.id === recordId);
  if (!isLoggedInAppUser()) {
    ShoppingRecordRepository.remove(recordId);
    notifyGuestPersonalDataNotPersisted('장보기 기록');
    if (syncGrocery && record) await syncGroceryWeekAfterShoppingRecordRemoved(record);
    return;
  }
  if (!record) return;
  await getFirestoreUserDataSync().shopping.deleteRecord(record.firestoreId || recordId);
  ShoppingRecordRepository.remove(recordId);
  if (syncGrocery) await syncGroceryWeekAfterShoppingRecordRemoved(record);
}

/** 식사달력 장보기 삭제 → 해당 주차 사용금액(구매완료 원장)에서 차감 */
async function syncGroceryWeekAfterShoppingRecordRemoved(record) {
  if (!record) return;
  GroceryRepository.removePurchasedLedgerForShoppingRecord(record);
  await persistGroceryState();
  if (dom.groceryList || dom.groceryBudgetSummary) {
    renderGroceryList({ force: true });
  }
}

async function persistMealPlans() {
  if (!isLoggedInAppUser()) {
    notifyGuestPersonalDataNotPersisted('식단');
    return;
  }
  const sync = getFirestoreUserDataSync();
  if (!sync?.mealPlans?.savePlans) {
    throw new Error('Firestore 동기화를 사용할 수 없습니다.');
  }
  markMealPlanLocalMutation();
  const plansSnapshot = MealPlanRepository.exportPlans();
  await sync.mealPlans.savePlans(plansSnapshot);
}

/** 로컬 식단 변경 직후 Firestore snapshot이 이전 데이터로 덮어쓰는 것을 방지 */
let mealPlanLocalMutatedAt = 0;

function markMealPlanLocalMutation() {
  mealPlanLocalMutatedAt = Date.now();
}

function hasMealPlanLocalData() {
  return Object.keys(MealPlanRepository._plans || {}).length > 0;
}

/** 로컬 장보기 금액 입력 직후 Firestore snapshot이 덮어쓰거나 리스트가 리렌더되는 것을 방지 */
let groceryLocalMutatedAt = 0;
let groceryPersistTimer = null;
/** 로그인 사용자: settings 스냅샷을 한 번 적용하기 전에는 빈 state를 Firestore에 쓰지 않음 */
let groceryFirestoreReady = false;
/** Firestore에서 장보기를 복원한 시각 — 직후 빈 DOM flush/blur로 덮어쓰기 방지 */
let groceryRestoredAt = 0;

function markGroceryLocalMutation() {
  groceryLocalMutatedAt = Date.now();
}

function markGroceryFirestoreReady() {
  groceryFirestoreReady = true;
}

function markGroceryRestoredFromRemote() {
  groceryRestoredAt = Date.now();
  groceryLocalMutatedAt = 0;
}

function resetGroceryFirestoreReady() {
  groceryFirestoreReady = false;
  groceryRestoredAt = 0;
}

function isWithinGroceryRestoreGuard(ms = 5000) {
  return groceryRestoredAt > 0 && Date.now() - groceryRestoredAt < ms;
}

function schedulePersistGroceryState() {
  if (!isGuestUser() && !isLoggedInAppUser()) return;
  clearTimeout(groceryPersistTimer);
  groceryPersistTimer = setTimeout(() => {
    persistGroceryState().catch((error) => {
      console.error('Failed to save grocery week', {
        uid: window.FirebaseServices?.auth?.currentUser?.uid || null,
        weekKey: GroceryRepository._activeWeekKey || state.plannerWeekKey || '',
        error,
      });
    });
  }, 800);
}

async function flushPersistGroceryState() {
  clearTimeout(groceryPersistTimer);
  await persistGroceryState();
}

function isGroceryAmountInput(el) {
  return el?.classList?.contains('grocery-item__price') || el?.classList?.contains('grocery-item__actual');
}

function isGroceryListAmountEditing() {
  const active = document.activeElement;
  return Boolean(dom.groceryList?.contains(active) && isGroceryAmountInput(active));
}

function syncGroceryAmountRow(row, { schedulePersist = true } = {}) {
  if (!row) return;
  const key = row.querySelector('[data-price-key]')?.dataset.priceKey
    || row.querySelector('[data-actual-key]')?.dataset.actualKey;
  if (!key) return;
  const priceInput = row.querySelector('.grocery-item__price');
  const price = priceInput ? priceInput.value : GroceryRepository.getMeta(key).price;
  const actualAmount = row.querySelector('.grocery-item__actual')?.value ?? '';
  markGroceryLocalMutation();
  GroceryRepository.setItemAmounts(key, { price, actualAmount });
  const latestGrouped = GroceryListService.computeMissing(
    GroceryListService.getPlannerDates(state.plannerWeekStart),
  );
  renderGroceryBudgetSummary(latestGrouped);
  if (schedulePersist) schedulePersistGroceryState();
}

async function persistGroceryState() {
  // 게스트: 메모리(session)만 유지 — localStorage/Firestore 미사용, 로그인 시 이전 안 함
  if (isGuestUser()) {
    GroceryRepository.save();
    return;
  }
  if (!isLoggedInAppUser()) return;
  // 새로고침 직후 빈 기본값이 Firestore를 덮어쓰지 않도록, 스냅샷 적용 전 저장 금지
  if (!groceryFirestoreReady) return;
  // 스냅샷 복원 직후 persist 레이스 차단
  if (isWithinGroceryRestoreGuard()) return;

  const payload = GroceryRepository.exportState();
  // 보낼 non-empty 주가 없으면 서버를 건드리지 않음
  if (!payload?.byWeek || !Object.keys(payload.byWeek).length) return;

  markGroceryLocalMutation();
  const weekKey = payload.activeWeekKey
    || GroceryRepository._activeWeekKey
    || state.plannerWeekKey
    || '';
  const uid = window.FirebaseServices?.auth?.currentUser?.uid
    || window.__authGateState?.user?.uid
    || null;
  try {
    await getFirestoreUserDataSync().settings.saveGroceryState(payload);
  } catch (error) {
    console.error('Failed to save grocery week', {
      uid,
      weekKey,
      data: payload?.byWeek?.[weekKey] || payload,
      error: {
        code: error?.code || '',
        message: error?.message || String(error),
      },
    });
    throw error;
  }
}

async function persistCurrencySetting() {
  if (!isLoggedInAppUser()) return;
  await getFirestoreUserDataSync().settings.saveCurrency(state.currency);
}

async function persistMonthlyFoodBudget() {
  if (!isLoggedInAppUser()) return;
  await getFirestoreUserDataSync().settings.saveMonthlyFoodBudget(state.monthlyFoodBudget);
}

async function persistSavedRecipeIds() {
  if (!isLoggedInAppUser()) {
    notifyGuestPersonalDataNotPersisted('저장한 레시피');
    return;
  }
  await getFirestoreUserDataSync().settings.saveSavedRecipeIds([...SavedRecipeRepository._ids]);
}

function isFirestorePantryEnabled() {
  const authRef = window.FirebaseServices?.auth;
  const dbRef = window.FirebaseServices?.db;
  return Boolean(authRef?.currentUser?.uid && dbRef);
}

function getFirestoreIngredientService() {
  return window.FirebaseServices?.FirestoreIngredientService || null;
}

async function createPantryItem(data, options = {}) {
  const { showGuestHint = true } = options;
  const ingredientName = String(data?.name || '').trim();
  if (!ingredientName) return null;

  if (isFirestorePantryEnabled()) {
    const authRef = window.FirebaseServices?.auth || null;
    const dbRef = window.FirebaseServices?.db || null;
    const uid = authRef?.currentUser?.uid || null;

    console.log('ADD_INGREDIENT_CLICKED');
    console.log('currentUser:', authRef?.currentUser ?? null);
    if (uid) console.log('SAVE_TARGET: Firestore users/' + uid + '/ingredients');
    console.log('ingredientName:', ingredientName);

    if (!uid || !dbRef) {
      const err = new Error('Firestore가 초기화되지 않았습니다.');
      err.code = 'firestore/not-initialized';
      throw err;
    }

    const svc = getFirestoreIngredientService();
    if (!svc) {
      const err = new Error('FirestoreIngredientService를 불러올 수 없습니다.');
      err.code = 'firebase/not-ready';
      throw err;
    }
    await svc.addIngredient({
      name: ingredientName,
      quantity: String(data?.quantity ?? ''),
      expiryDate: String(data?.expiryDate ?? ''),
    });
    return null;
  }

  const item = PantryRepository.create(data);
  if (showGuestHint) notifyGuestPantryNotPersisted();
  return item;
}

async function updatePantryItem(id, data) {
  if (isFirestorePantryEnabled()) {
    const svc = getFirestoreIngredientService();
    const item = PantryRepository.findById(id);
    const docId = item?.firestoreId || item?.id || id;
    if (!svc) throw new Error('Firebase 서비스를 불러오는 중입니다.');
    await svc.updateIngredient(docId, data);
    return null;
  }
  return PantryRepository.update(id, data);
}

async function removePantryItem(id) {
  if (isFirestorePantryEnabled()) {
    const svc = getFirestoreIngredientService();
    const item = PantryRepository.findById(id);
    const docId = item?.firestoreId || item?.id || id;
    if (!svc) throw new Error('Firebase 서비스를 불러오는 중입니다.');
    await svc.deleteIngredient(docId);
    return;
  }
  PantryRepository.remove(id);
  refreshAll();
}

function handlePantryFirestoreError(error) {
  console.error('INGREDIENT_FIRESTORE_SAVE_FAILED', error);
  const msg = error?.code === 'auth/not-logged-in'
    ? '로그인 후 재료를 추가할 수 있습니다.'
    : '재료 저장에 실패했습니다. 콘솔을 확인해 주세요.';
  alert(msg);
}

const RecipePickerService = {
  init({ inputEl, hiddenEl, listEl, onSelect }) {
    if (!inputEl || !hiddenEl || !listEl) return null;
    const picker = { inputEl, hiddenEl, listEl, onSelect, blurTimer: null };

    inputEl.addEventListener('input', () => {
      const q = inputEl.value.trim();
      this._renderSuggestions(picker, q);
      if (!q) hiddenEl.value = '';
    });
    inputEl.addEventListener('focus', () => {
      this._renderSuggestions(picker, inputEl.value.trim());
    });
    inputEl.addEventListener('blur', () => {
      picker.blurTimer = setTimeout(() => { listEl.hidden = true; }, 150);
    });
    listEl.addEventListener('mousedown', (e) => e.preventDefault());
    return picker;
  },
  search(query, limit = 8) {
    const q = normalizeIngredient(query || '');
    const recipes = RecipeRepository.getRecommendableRecipes();
    if (!q) return recipes.slice(0, limit);
    return recipes.filter((r) => normalizeIngredient(r.name).includes(q)).slice(0, limit);
  },
  setSelection(picker, recipe) {
    if (!picker) return;
    picker.hiddenEl.value = recipe?.id || '';
    picker.inputEl.value = recipe?.name || '';
    picker.listEl.hidden = true;
    picker.onSelect?.(recipe || null);
  },
  clear(picker) {
    if (!picker) return;
    picker.hiddenEl.value = '';
    picker.inputEl.value = '';
    picker.listEl.hidden = true;
    picker.onSelect?.(null);
  },
  resolve(inputEl, hiddenEl) {
    const typed = inputEl.value.trim();
    if (!typed) {
      hiddenEl.value = '';
      return null;
    }
    if (hiddenEl.value) {
      const selected = RecipeRepository.getById(hiddenEl.value);
      if (selected && MatchService.normalize(selected.name) === MatchService.normalize(typed)) return selected;
    }
    const exact = RecipeRepository.getRecommendableRecipes().find(
      (r) => MatchService.normalize(r.name) === MatchService.normalize(typed)
    );
    if (exact) {
      hiddenEl.value = exact.id;
      return exact;
    }
    hiddenEl.value = '';
    return { id: null, name: typed };
  },
  _renderSuggestions(picker, query) {
    const results = this.search(query);
    if (!results.length) {
      picker.listEl.hidden = true;
      picker.listEl.innerHTML = '';
      return;
    }
    picker.listEl.hidden = false;
    picker.listEl.innerHTML = results.map((r) =>
      `<li><button type="button" class="recipe-picker__option" data-id="${esc(r.id)}">${esc(r.name)}</button></li>`
    ).join('');
    picker.listEl.querySelectorAll('.recipe-picker__option').forEach((btn) => {
      btn.onclick = () => {
        const recipe = RecipeRepository.getById(btn.dataset.id);
        if (recipe) this.setSelection(picker, recipe);
      };
    });
  },
};

// ===== Domain Services =====
const MatchService = {
  normalize: normalizeIngredientName,
  parseIngredient: parseRecipeIngredient,
  formatDisplay: formatIngredientDisplay,
  getMatchName: getIngredientMatchName,
  analyze(pantryNames, recipeIngredients) {
    const exact = [];
    const substituted = [];
    const missing = [];
    const matched = [];
    const matchedPantryNames = [];
    let scoreSum = 0;
    let requiredCount = 0;

    for (const rawIng of recipeIngredients) {
      const item = normalizeIngredientItem(rawIng);
      const ing = item.name;
      const displayText = formatIngredientDisplay(item);
      if (!item.optional) requiredCount += 1;

      const owned = IngredientAliasService.findOwned(ing, pantryNames);
      if (owned) {
        exact.push({ required: displayText, owned, score: 1 });
        matched.push(displayText);
        matchedPantryNames.push(owned);
        if (!item.optional) scoreSum += 1;
        continue;
      }

      const sub = IngredientGroupService.findSubstitute(ing, pantryNames);
      if (sub) {
        substituted.push({ ...sub, required: displayText });
        matched.push(displayText);
        matchedPantryNames.push(sub.owned);
        if (!item.optional) scoreSum += sub.substituteScore;
        continue;
      }

      if (item.optional) continue;
      missing.push(displayText);
    }

    const matchPercent = requiredCount
      ? Math.round((scoreSum / requiredCount) * 100)
      : 100;

    const substitutionAdvices = this.getSubstitutionAdvices(missing);
    return { exact, substituted, missing, matched, matchedPantryNames, matchPercent, substitutionAdvices };
  },
  getSubstitutionAdvices(missingIngredients) {
    const advices = [];
    const seen = new Set();
    for (const raw of missingIngredients) {
      const name = getIngredientMatchName(raw);
      for (const guide of SUBSTITUTION_GUIDES) {
        if (!guide.keys.some((key) => IngredientAliasService.matches(key, name))) continue;
        const id = guide.keys[0];
        if (seen.has(id)) continue;
        seen.add(id);
        advices.push({
          ingredient: id,
          alternatives: guide.alternatives,
          message: guide.message,
        });
      }
    }
    return advices;
  },
  renderSubstitutionGuideHTML(advices) {
    if (!advices?.length) return '';
    return `
      <section class="recipe-detail__section">
        <h3 class="recipe-detail__section-title">🔄 대체 가능 재료</h3>
        <ul class="substitution-guide">
          ${advices.map((a) => `
            <li class="substitution-guide__item">
              <strong>${esc(a.ingredient)}</strong>
              <span>${esc(a.message)}</span>
            </li>`).join('')}
        </ul>
      </section>`;
  },
  formatCardSummary({ exact, substituted, missing }) {
    if (!missing.length && !substituted.length) return '모든 재료 준비 완료!';
    const parts = [];
    if (substituted.length) {
      const hints = substituted.slice(0, 2).map((s) => `${s.required} → ${s.owned}`);
      parts.push(`${hints.join(', ')}${substituted.length > 2 ? ` 외 ${substituted.length - 2}개` : ''}로 대체 가능`);
    }
    if (missing.length) {
      if (missing.length === 1) parts.push(`${missing[0]}만 있으면 가능`);
      else if (missing.length === 2) parts.push(`${missing[0]}, ${missing[1]}만 있으면 가능`);
      else parts.push(`${missing.slice(0, 2).join(', ')} 외 ${missing.length - 2}개만 있으면 가능`);
    }
    return parts.join(' · ');
  },
  renderMatchDetailHTML(analysis) {
    const { exact, substituted, missing } = analysis;
    let html = '';
    if (exact.length) {
      html += `<div class="match-section"><h4 class="match-section__title">정확 일치</h4><ul class="ingredient-list">${
        exact.map((e) => `<li class="ingredient-list__item ingredient-list__item--have">✓ ${esc(e.required)}</li>`).join('')
      }</ul></div>`;
    }
    if (substituted.length) {
      html += `<div class="match-section"><h4 class="match-section__title">대체 가능</h4><ul class="ingredient-list">${
        substituted.map((s) => `<li class="ingredient-list__item ingredient-list__item--substitute">↔ ${esc(s.required)} <span class="match-sub-hint">(${esc(s.owned)} 보유)</span></li>`).join('')
      }</ul></div>`;
    }
    if (missing.length) {
      html += `<div class="match-section"><h4 class="match-section__title">부족한 재료</h4><ul class="ingredient-list">${
        missing.map((m) => {
          const name = getIngredientMatchName(m);
          return `<li class="ingredient-list__item ingredient-list__item--missing ingredient-list__item--buy">
            <span>✗ ${esc(formatIngredientDisplay(m))}</span>
            ${AffiliateService.buyButtonHTML(name, { compact: true })}
          </li>`;
        }).join('')
      }</ul></div>`;
    }
    if (!html) {
      html = '<p class="match-section__empty">보유 재료를 추가하면 일치율을 확인할 수 있어요</p>';
    }
    return html;
  },
  /** @deprecated use formatCardSummary */
  formatMissing(missing, name) {
    if (!missing.length) return '모든 재료 준비 완료!';
    if (missing.length === 1) return `${missing[0]}만 있으면 ${name} 가능`;
    return `${missing.slice(0, 2).join(', ')}${missing.length > 2 ? ` 외 ${missing.length - 2}개` : ''}만 있으면 ${name} 가능`;
  },
};

const RecommendationService = {
  getPantryNames() {
    return getPantryItemsForUi().map((i) => i.name);
  },
  getExpiryBoost(matched) {
    let boost = 0;
    for (const name of matched) {
      const item = getPantryItemsForUi().find((p) => MatchService.normalize(p.name) === MatchService.normalize(name));
      if (!item?.expiryDate) continue;
      const days = ExpiryService.daysUntil(item.expiryDate);
      if (days !== null && days <= CONFIG.EXPIRY_SOON_DAYS && days >= 0) boost += 10;
    }
    return boost;
  },
  isHighProtein(recipe) {
    const text = `${recipe.name} ${(recipe.tags || []).join(' ')} ${(recipe.ingredients || []).map(formatIngredientDisplay).join(' ')}`;
    return recipe.dietTags?.includes('high-protein') || /고단백|계란|달걀|참치|두부|닭가슴살|닭고기|소고기|돼지고기|연어/.test(text);
  },
  isDiet(recipe) {
    const text = `${recipe.name} ${(recipe.tags || []).join(' ')} ${(recipe.ingredients || []).map(formatIngredientDisplay).join(' ')}`;
    return recipe.dietTags?.includes('diet') || recipe.dishType === 'salad' || /다이어트|샐러드|저칼로리|닭가슴살|두부|양배추/.test(text);
  },
  isSnack(recipe) {
    return ['snack', 'toast', 'dessert'].includes(recipe.dishType) || /간식|토스트|프렌치토스트|감자전|떡볶이|핫도그|맛탕/.test(recipe.name);
  },
  reasonFor(result) {
    if (result.missing.length === 0 && result.substituted.length === 0) return '🔥 바로 가능';
    if (result.missing.length === 1) return `🛒 ${formatIngredientDisplay(result.missing[0])}만 있으면 가능`;
    if (result.missing.length === 2) {
      const names = result.missing.map((m) => formatIngredientDisplay(m));
      return `🛒 ${names.join(', ')}만 있으면 가능`;
    }
    if (result.missing.length > 2) {
      const names = result.missing.slice(0, 2).map((m) => formatIngredientDisplay(m));
      return `🛒 ${names.join(', ')} 외 ${result.missing.length - 2}개만 있으면 가능`;
    }
    if (result.expiryBoost > 0) return '⚠️ 임박 재료 활용';
    if (this.isHighProtein(result.recipe)) return '💪 고단백';
    if (this.isDiet(result.recipe)) return '🥗 다이어트';
    if (this.isSnack(result.recipe)) return '🍪 간식';
    if (Number(result.recipe.cookTime) <= 15) return '⏱️ 15분 이하';
    return '';
  },
  matchesHomeSearch(recipe, query) {
    const q = normalizeIngredient(query);
    if (!q) return true;
    const categoryLabel = CATEGORY_MAP[recipe.category]?.tags?.join(' ') || '';
    const haystack = [
      recipe.name,
      ...(recipe.ingredients || []).map(formatIngredientDisplay),
      recipe.authorName,
      recipe.category,
      categoryLabel,
    ].filter(Boolean).map(normalizeIngredient).join(' ');
    return haystack.includes(q);
  },
  compareHomeResultsByDate(a, b) {
    const dateA = a.recipe.publishedAt || a.recipe.createdAt || '';
    const dateB = b.recipe.publishedAt || b.recipe.createdAt || '';
    if (dateA !== dateB) return dateB.localeCompare(dateA);
    return RecipeSaveCountRepository.getCount(b.recipe.id) - RecipeSaveCountRepository.getCount(a.recipe.id);
  },
  compareHomeResults(a, b) {
    const matchA = Number(a.matchPercent);
    const matchB = Number(b.matchPercent);
    const rateA = Number.isFinite(matchA) ? matchA : -1;
    const rateB = Number.isFinite(matchB) ? matchB : -1;
    if (rateB !== rateA) return rateB - rateA;

    const missingA = a.missing?.length ?? 0;
    const missingB = b.missing?.length ?? 0;
    if (missingA !== missingB) return missingA - missingB;

    const timeA = Number(a.recipe?.cookTime);
    const timeB = Number(b.recipe?.cookTime);
    const cookA = Number.isFinite(timeA) ? timeA : Number.POSITIVE_INFINITY;
    const cookB = Number.isFinite(timeB) ? timeB : Number.POSITIVE_INFINITY;
    if (cookA !== cookB) return cookA - cookB;

    return 0;
  },
  recommendHome(recipes, { activeFilters = new Set(), query = '' } = {}) {
    const names = this.getPantryNames();
    const q = query.trim();
    const hasPantry = names.length > 0;
    const hasSearchMode = Boolean(q || activeFilters?.size);
    const results = [];

    for (const recipe of recipes) {
      if (q && !this.matchesHomeSearch(recipe, q)) continue;
      const analysis = MatchService.analyze(names, recipe.ingredients);
      const matchPercent = Number(analysis.matchPercent);
      const result = {
        recipe,
        ...analysis,
        matchPercent: Number.isFinite(matchPercent) ? matchPercent : 0,
        expiryBoost: this.getExpiryBoost(analysis.matchedPantryNames),
      };
      if (hasPantry && !hasSearchMode && result.matchPercent <= 0) continue;
      if (activeFilters?.size && !this.matchesFilters(result, activeFilters)) continue;
      results.push({
        ...result,
        recommendationReason: hasPantry ? this.reasonFor(result) : '',
      });
    }

    if (hasPantry || hasSearchMode) {
      return results.sort((a, b) => this.compareHomeResults(a, b));
    }
    return results.sort((a, b) => this.compareHomeResultsByDate(a, b));
  },
  countMakeableNow(recipes) {
    const names = this.getPantryNames();
    if (!names.length) return 0;
    let count = 0;
    for (const recipe of recipes) {
      const analysis = MatchService.analyze(names, recipe.ingredients);
      if (analysis.missing.length === 0 && analysis.substituted.length === 0) count += 1;
    }
    return count;
  },
  countOneMissing(recipes) {
    const names = this.getPantryNames();
    if (!names.length) return 0;
    let count = 0;
    for (const recipe of recipes) {
      const analysis = MatchService.analyze(names, recipe.ingredients);
      if (analysis.missing.length === 1) count += 1;
    }
    return count;
  },
  getPantryUtilization(result) {
    const pantrySize = this.getPantryNames().length;
    if (!pantrySize) return 0;
    const used = new Set((result.matchedPantryNames || []).map((name) => MatchService.normalize(name)));
    return used.size / pantrySize;
  },
  compareNaengtulResults(a, b) {
    if ((b.expiryBoost || 0) !== (a.expiryBoost || 0)) return (b.expiryBoost || 0) - (a.expiryBoost || 0);
    const utilDiff = this.getPantryUtilization(b) - this.getPantryUtilization(a);
    if (utilDiff !== 0) return utilDiff > 0 ? 1 : -1;
    const usedDiff = (b.matchedPantryNames?.length ?? 0) - (a.matchedPantryNames?.length ?? 0);
    if (usedDiff !== 0) return usedDiff;
    const timeA = Number(a.recipe.cookTime) || 9999;
    const timeB = Number(b.recipe.cookTime) || 9999;
    if (timeA !== timeB) return timeA - timeB;
    return this.compareHomeResultsByDate(a, b);
  },
  recommendNaengtul(recipes, { limit = 3 } = {}) {
    const names = this.getPantryNames();
    if (!names.length) return [];
    const results = [];
    for (const recipe of recipes) {
      const analysis = MatchService.analyze(names, recipe.ingredients);
      if (analysis.missing.length > 0 || analysis.substituted.length > 0) continue;
      results.push({
        recipe,
        ...analysis,
        expiryBoost: this.getExpiryBoost(analysis.matchedPantryNames),
      });
    }
    return results
      .sort((a, b) => this.compareNaengtulResults(a, b))
      .slice(0, limit);
  },
  matchesFilters(result, activeFilters) {
    if (!activeFilters?.size) return true;
    const recipe = result.recipe;
    for (const filter of activeFilters) {
      if (filter === 'available' && !(result.missing.length === 0 && result.substituted.length === 0)) return false;
      if (filter === 'expiring' && result.expiryBoost <= 0) return false;
      if (filter === 'one-missing' && result.missing.length !== 1) return false;
      if (filter === 'high-protein' && !this.isHighProtein(recipe)) return false;
      if (filter === 'diet' && !this.isDiet(recipe)) return false;
      if (filter === 'snack' && !this.isSnack(recipe)) return false;
      if (filter === 'quick' && Number(recipe.cookTime) > 15) return false;
    }
    return true;
  },
  recommend(recipes, { activeFilters = new Set(), query = '' } = {}) {
    const names = this.getPantryNames();
    const q = normalizeIngredient(query || '');
    const results = [];
    for (const recipe of recipes) {
      if (q && !normalizeIngredient(recipe.name).includes(q)) continue;
      const analysis = MatchService.analyze(names, recipe.ingredients);
      const result = { recipe, ...analysis, expiryBoost: this.getExpiryBoost(analysis.matchedPantryNames) };
      if (!q && !activeFilters?.size && analysis.matchPercent <= 0) continue;
      if (!this.matchesFilters(result, activeFilters)) continue;
      results.push({ ...result, recommendationReason: this.reasonFor(result) });
    }
    return results.sort((a, b) =>
      b.matchPercent - a.matchPercent || b.expiryBoost - a.expiryBoost || a.missing.length - b.missing.length);
  },
};

const ExpiryService = {
  daysUntil(dateStr) {
    if (!dateStr) return null;
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const exp = new Date(`${dateStr}T00:00:00`);
    return Math.ceil((exp - today) / 86400000);
  },
  status(dateStr) {
    const d = this.daysUntil(dateStr);
    if (d === null) return 'none';
    if (d < 0) return 'expired';
    if (d <= CONFIG.EXPIRY_SOON_DAYS) return 'soon';
    return 'ok';
  },
  label(dateStr) {
    const d = this.daysUntil(dateStr);
    if (d === null) return '';
    if (d < 0) return `만료 ${Math.abs(d)}일 지남`;
    if (d === 0) return '오늘까지';
    if (d <= CONFIG.EXPIRY_SOON_DAYS) return `${d}일 남음`;
    return '';
  },
};

/** 홈 «오늘의 냉장고 브리핑» — Firestore/앱 상태만으로 계산 (AI 없음) */
const HomeBriefingService = {
  _cache: null,
  _fingerprint: null,

  invalidate() {
    this._cache = null;
    this._fingerprint = null;
  },

  _buildFingerprint() {
    const pantryKey = getPantryItemsForUi()
      .map((item) => `${item.id}\0${item.name}\0${item.expiryDate || ''}\0${item.quantity ?? ''}`)
      .join('\n');
    const recipesKey = RecipeRepository.getHomeRecipes()
      .map((recipe) => {
        const ings = (recipe.ingredients || []).map((ing) => formatIngredientDisplay(ing)).join('\u001f');
        return `${recipe.id}\0${ings}`;
      })
      .join('\n');
    if (state.plannerWeekKey) GroceryRepository.setActiveWeek(state.plannerWeekKey);
    const budgetRaw = GroceryRepository.getBudget();
    const groceryState = GroceryRepository._state || {};
    const itemsKey = Object.entries(groceryState.items || {})
      .map(([key, meta]) => `${key}:${meta?.actualAmount ?? ''}:${meta?.checked ? 1 : 0}`)
      .join('|');
    const ledgerKey = GroceryRepository.getPurchasedLedger()
      .map((entry) => `${entry.id || entry.key}\0${entry.actualPrice ?? entry.actualAmount ?? ''}`)
      .join('|');
    return [pantryKey, recipesKey, String(budgetRaw), state.plannerWeekKey || '', itemsKey, ledgerKey].join('\n@@\n');
  },

  _countDueIngredients() {
    return getPantryItemsForUi().filter((item) => {
      const days = ExpiryService.daysUntil(item.expiryDate);
      return days !== null && days <= CONFIG.EXPIRY_SOON_DAYS;
    }).length;
  },

  _computeBudgetRemaining() {
    if (state.plannerWeekKey) GroceryRepository.setActiveWeek(state.plannerWeekKey);
    const raw = GroceryRepository.getBudget();
    if (raw === '' || raw == null) {
      return { hasBudget: false, remaining: null, budget: null, used: 0 };
    }
    const budget = Number(raw);
    if (!Number.isFinite(budget) || budget < 0) {
      return { hasBudget: false, remaining: null, budget: null, used: 0 };
    }
    const dates = GroceryListService.getPlannerDates(state.plannerWeekStart);
    const grouped = GroceryListService.computeMissing(dates);
    const used = computeGroceryActualTotal(grouped);
    return {
      hasBudget: true,
      budget,
      used,
      remaining: budget - used,
    };
  },

  _compute() {
    const recipes = RecipeRepository.getHomeRecipes();
    const dueCount = this._countDueIngredients();
    const readyCount = RecommendationService.countMakeableNow(recipes);
    const oneMissingCount = RecommendationService.countOneMissing(recipes);
    const budgetInfo = this._computeBudgetRemaining();
    return {
      dueCount,
      readyCount,
      oneMissingCount,
      ...budgetInfo,
    };
  },

  get() {
    const fingerprint = this._buildFingerprint();
    if (this._cache && this._fingerprint === fingerprint) return this._cache;
    const data = this._compute();
    this._cache = data;
    this._fingerprint = fingerprint;
    return data;
  },
};

// ===== State & DOM =====
const state = {
  view: 'main', filters: new Set(), menuSearch: '', homeSavedOnly: false,
  editingRecipeId: null, editingPantryId: null,
  editingMealId: null, editingShoppingId: null, formImage: null, mealFormImage: null, isComposing: false,
  calendarYear: new Date().getFullYear(), calendarMonth: new Date().getMonth(),
  selectedCalendarDate: null, selectedMealType: 'home-cook', mealPhotoRemoved: false,
  calendarModalType: null,
  calendarExpenseFilter: 'all',
  calendarReopenListDate: null,
  currency: CURRENCY_OPTIONS[StorageAdapter.get(CONFIG.STORAGE.CURRENCY, DEFAULT_CURRENCY)]
    ? StorageAdapter.get(CONFIG.STORAGE.CURRENCY, DEFAULT_CURRENCY)
    : DEFAULT_CURRENCY,
  monthlyFoodBudget: 0,
  shoppingRecipePicker: null,
  pantryRecipePicker: null,
  recipeFormTab: 'manual',
  videoReviewDraft: null,
  videoLinkMeta: null,
  videoExtractNeedsFallback: false,
  videoExtractSessionUrl: null,
  videoDishMismatchAcknowledged: false,
  videoExtractInFlight: false,
  aiUsageRemaining: null,
  plannerWeekStart: toDateStr(getWeekStartDate(todayStr())),
  plannerWeekKey: getWeekKeyFromDateStr(todayStr()),
  plannerAnimate: null,
  plannerSheet: { date: null, slot: null, action: 'add', tab: 'recommend', search: '' },
  /** 식단에서 «레시피 등록 후 추가» 시 저장 완료 후 슬롯에 연결 */
  plannerPendingMeal: null,
  myRecipesSort: { mine: 'newest', saved: 'match' },
  myRecipesSortSheetSection: null,
  authorProfileId: null,
  authorProfileReturnView: 'main',
  detailRecipeId: null,
  detailReturnView: 'main',
  detailReturnScrollY: 0,
};

const $ = (s) => document.querySelector(s);
const dom = {
  headerSubtitle: $('#header-subtitle'),
  headerBrand: $('#header-brand'),
  toast: $('#toast'),
  views: {
    main: $('#view-main'), 'my-recipes': $('#view-my-recipes'),
    pantry: $('#view-pantry'), planner: $('#view-planner'), calendar: $('#view-calendar'),
    'author-profile': $('#view-author-profile'), 'recipe-detail': $('#view-recipe-detail'),
  },
  authorProfileBack: $('#author-profile-back'),
  authorProfileHeader: $('#author-profile-header'),
  authorProfileRecipes: $('#author-profile-recipes'),
  authorProfileEmpty: $('#author-profile-empty'),
  plannerWeekPrev: $('#planner-week-prev'), plannerWeekLabel: $('#planner-week-label'), plannerWeekNext: $('#planner-week-next'),
  plannerAutoBtn: $('#planner-auto-btn'), plannerGrid: $('#planner-grid'),
  plannerGuestHint: $('#planner-guest-hint'),
  plannerSlotSheet: $('#planner-slot-sheet'), plannerSlotSheetTitle: $('#planner-slot-sheet-title'),
  plannerSlotMenu: $('#planner-slot-menu'),
  plannerRecipeSheet: $('#planner-recipe-sheet'), plannerRecipeSheetTitle: $('#planner-recipe-sheet-title'),
  plannerRecipeSearch: $('#planner-recipe-search'), plannerRecipeTabs: $('#planner-recipe-tabs'),
  plannerRecipeList: $('#planner-recipe-list'), plannerRecipeEmpty: $('#planner-recipe-empty'),
  groceryCompleteBtn: $('#grocery-complete-btn'),
  groceryAddItemBtn: $('#grocery-add-item-btn'),
  groceryBudgetBox: $('#grocery-budget-box'),
  groceryBudget: $('#grocery-budget'), groceryBudgetSummary: $('#grocery-budget-summary'),
  groceryList: $('#grocery-list'), groceryEmpty: $('#grocery-empty'),
  groceryItemModal: $('#grocery-item-modal'), groceryItemModalForm: $('#grocery-item-modal-form'),
  groceryItemModalTitle: $('#grocery-item-modal-title'), groceryItemName: $('#grocery-item-name'),
  groceryItemQuantity: $('#grocery-item-quantity'), groceryItemUnit: $('#grocery-item-unit'),
  grocerySpendSheet: $('#grocery-spend-sheet'), grocerySpendSheetTitle: $('#grocery-spend-sheet-title'),
  grocerySpendList: $('#grocery-spend-list'), grocerySpendEmpty: $('#grocery-spend-empty'),
  tabItems: document.querySelectorAll('.tab-bar__item'),
  openPantryManageBtn: $('#open-pantry-manage-btn'),
  quickForm: $('#quick-ingredient-form'), quickInput: $('#quick-ingredient-input'),
  homePantrySection: document.querySelector('.home-pantry-section'),
  pantryChipsClip: $('#pantry-chips-clip'),
  pantryChips: $('#pantry-chips'),
  pantryChipsCount: $('#pantry-chips-count'),
  pantryChipsToggle: null,
  pantryChipsDivider: null,
  homeRecipesSubtitle: $('#home-recipes-subtitle'),
  menuSearchInput: $('#menu-search-input'),
  homeSearchDock: $('.home-search-dock'),
  homeSearchFloat: $('#home-search-float'),
  homeSearchExpandArea: $('#home-search-expand-area'),
  homeTodayHero: $('#home-today-hero'),
  homeBriefing: $('#home-briefing'),
  homeBriefingGrid: $('#home-briefing-grid'),
  homeRecipesSeeAll: $('#home-recipes-see-all'),
  homeRecommendList: $('#home-recommend-list'),
  homeRecommendEmpty: $('#home-recommend-empty'),
  homeRecommendSeeAll: $('#home-recommend-see-all'),
  quickIngredientScanBtn: $('#quick-ingredient-scan-btn'),
  homeFilterBtn: $('#home-filter-btn'),
  homeFilterPanel: $('#home-filter-panel'),
  homeFilterChips: $('#home-filter-chips'),
  headerNotifyBtn: $('#header-notify-btn'),
  recipeList: $('#recipe-list'), resultsCount: $('#results-count'),
  emptyState: $('#empty-state'), noResults: $('#no-results'),
  myRecipesList: $('#my-recipes-list'), myRecipesCount: $('#my-recipes-count'), myRecipesEmpty: $('#my-recipes-empty'),
  myRecipesGuestHint: $('#my-recipes-guest-hint'),
  savedList: $('#saved-recipes-list'), savedCount: $('#saved-recipes-count'), savedEmpty: $('#saved-recipes-empty'),
  myRecipesSortSheet: $('#my-recipes-sort-sheet'),
  myRecipesSortOptions: $('#my-recipes-sort-options'),
  myRecipesSortSheetTitle: $('#my-recipes-sort-sheet-title'),
  pantryList: $('#pantry-list'), pantryCount: $('#pantry-manage-count'), pantryEmpty: $('#pantry-empty'),
  openPantryAdd: $('#open-pantry-add-btn'), openRecipeForm: $('#open-recipe-form-btn'),
  openVideoRecipeFormBtn: $('#open-video-recipe-form-btn'),
  mealStats: $('#meal-stats'), currencySelect: $('#currency-select'), calendarLabel: $('#calendar-label'),
  calendarGuestHint: $('#calendar-guest-hint'),
  calendarPrev: $('#calendar-prev'), calendarNext: $('#calendar-next'),
  calendarWeekdays: $('#calendar-weekdays'), calendarDays: $('#calendar-days'),
  calendarDaySection: $('#calendar-day-section'), calendarDayLabel: $('#calendar-day-label'),
  calendarDaySheet: $('#calendar-day-sheet'), calendarDaySheetTitle: $('#calendar-day-sheet-title'),
  calendarDayList: $('#calendar-day-list'), calendarDayEmpty: $('#calendar-day-empty'),
  calendarExpenseSheet: $('#calendar-expense-sheet'), calendarExpenseSheetTitle: $('#calendar-expense-sheet-title'),
  calendarExpenseSummary: $('#calendar-expense-summary'), calendarExpenseList: $('#calendar-expense-list'),
  calendarExpenseEmpty: $('#calendar-expense-empty'),
  monthlyFoodBudget: $('#monthly-food-budget'),
  openMealAddBtn: $('#open-meal-add-btn'), openShoppingAddBtn: $('#open-shopping-add-btn'),
  mealModal: $('#meal-modal'), mealModalForm: $('#meal-modal-form'), mealModalTitle: $('#meal-modal-title'),
  mealDate: $('#meal-date'), mealTypeField: $('#meal-type-field'), mealTypeTabs: $('#meal-type-tabs'),
  mealRecipeField: $('#meal-recipe-field'),
  mealRecipeSelect: $('#meal-recipe-select'), mealName: $('#meal-name'), mealCostField: $('#meal-cost-field'),
  mealCost: $('#meal-cost'), mealMemo: $('#meal-memo'),
  mealPhotoPreview: $('#meal-photo-preview'), mealPhotoInput: $('#meal-photo-input'),
  mealPhotoSelectBtn: $('#meal-photo-select-btn'), mealPhotoRemoveBtn: $('#meal-photo-remove-btn'),
  shoppingModal: $('#shopping-modal'), shoppingModalForm: $('#shopping-modal-form'),
  shoppingModalTitle: $('#shopping-modal-title'), shoppingDate: $('#shopping-date'),
  shoppingAmount: $('#shopping-amount'), shoppingStore: $('#shopping-store'),
  shoppingIngredients: $('#shopping-ingredients'),
  shoppingRecipeInput: $('#shopping-recipe-input'), shoppingRecipeId: $('#shopping-recipe-id'),
  shoppingRecipeSuggestions: $('#shopping-recipe-suggestions'),
  pantryModal: $('#pantry-modal'), pantryModalForm: $('#pantry-modal-form'),
  pantryModalTitle: $('#pantry-modal-title'), pantryModalName: $('#pantry-modal-name'),
  pantryModalQty: $('#pantry-modal-quantity'), pantryModalUnit: $('#pantry-modal-unit'),
  pantryModalExpiry: $('#pantry-modal-expiry'),
  pantryRecipeInput: $('#pantry-recipe-input'), pantryRecipeId: $('#pantry-recipe-id'),
  pantryRecipeSuggestions: $('#pantry-recipe-suggestions'),
  recipeDetailContent: $('#recipe-detail-content'),
  recipeDetailTitle: $('#recipe-detail-page-title'),
  recipeDetailBack: $('#recipe-detail-back'),
  recipeDetailSaveIcon: $('#recipe-detail-save-icon'),
  recipeDetailShare: $('#recipe-detail-share'),
  recipeFormModal: $('#recipe-form-modal'), recipeForm: $('#recipe-form'),
  formModalTitle: $('#form-modal-title'), formError: $('#form-error'),
  formName: $('#recipe-name'), formIngredients: $('#recipe-ingredients'),
  formCookTime: $('#recipe-cook-time'), formDifficulty: $('#recipe-difficulty'),
  formSteps: $('#recipe-steps'), formCategory: $('#recipe-category'), formMemo: $('#recipe-memo'),
  formVisibilityPrivate: $('#recipe-visibility-private'), formVisibilityPublic: $('#recipe-visibility-public'),
  photoPreview: $('#photo-preview'), formPhoto: $('#recipe-photo'),
  recipePhotoUpload: $('#recipe-photo-upload'),
  photoRemoveBtn: $('#photo-remove-btn'),
  imageLightbox: $('#image-lightbox'), imageLightboxImg: $('#image-lightbox-img'),
  recipeFormTabs: $('#recipe-form-tabs'),
  recipeFormPanelManual: $('#recipe-form'),
  recipeFormPanelVideo: $('#recipe-form-panel-video'),
  recipeFormPanelReview: $('#recipe-form-panel-review'),
  videoSourceUrl: $('#video-source-url'),
  videoLinkPreview: $('#video-link-preview'),
  videoPreviewThumb: $('#video-preview-thumb'),
  videoPreviewThumbPlaceholder: $('#video-preview-thumb-placeholder'),
  videoPreviewPlatform: $('#video-preview-platform'),
  videoPreviewTitle: $('#video-preview-title'),
  videoFallbackSection: $('#video-fallback-section'),
  videoFallbackMessage: $('#video-fallback-message'),
  videoFallbackAnalyzeBtn: $('#video-fallback-analyze-btn'),
  videoUserText: $('#video-user-text'),
  videoUserTextHint: $('#video-user-text-hint'),
  videoPasteText: $('#video-paste-text'),
  videoFormError: $('#video-form-error'),
  videoPasteBtn: $('#video-paste-btn'),
  videoFlowStepBar: $('#video-flow-step-bar'),
  videoExtractLoading: $('#video-extract-loading'),
  videoExtractLoadingText: $('#video-extract-loading-text'),
  videoFormErrorText: $('#video-form-error')?.querySelector('.video-form-error-card__text'),
  videoReviewErrorText: $('#video-review-error')?.querySelector('.video-form-error-card__text'),
  videoAnalyzeBtn: $('#video-analyze-btn'),
  loginPromptModal: $('#login-prompt-modal'),
  profileMenuModal: $('#profile-menu-modal'),
  loginPromptGoogleBtn: $('#login-prompt-google-btn'),
  loginPromptDismissBtn: $('#login-prompt-dismiss-btn'),
  loginPromptQuota: $('#login-prompt-quota'),
  loginPromptError: $('#login-prompt-error'),
  videoAiUsage: $('#video-ai-usage'),
  videoExtractWarning: $('#video-extract-warning'),
  videoReviewPreview: $('#video-review-preview'),
  videoReviewMockNotice: $('#video-review-mock-notice'),
  videoReviewPartialNotice: $('#video-review-partial-notice'),
  videoReviewThumb: $('#video-review-thumb'),
  videoReviewPlatform: $('#video-review-platform'),
  videoReviewTitleHint: $('#video-review-title-hint'),
  videoReviewSourceLink: $('#video-review-source-link'),
  videoReviewName: $('#video-review-name'),
  videoReviewIngredients: $('#video-review-ingredients'),
  videoReviewOptional: $('#video-review-optional'),
  videoReviewSubstitutes: $('#video-review-substitutes'),
  videoReviewSteps: $('#video-review-steps'),
  videoReviewCookTime: $('#video-review-cook-time'),
  videoReviewDifficulty: $('#video-review-difficulty'),
  videoReviewCategory: $('#video-review-category'),
  videoReviewError: $('#video-review-error'),
  videoReviewBackBtn: $('#video-review-back-btn'),
  videoRecipeSaveBtn: $('#video-recipe-save-btn'),
  videoVisibilityPrivate: $('#video-recipe-visibility-private'),
  videoVisibilityPublic: $('#video-recipe-visibility-public'),
};

// ===== Utils =====
function esc(s) { const d = document.createElement('div'); d.textContent = s; return d.innerHTML; }
function linkifyText(text) {
  if (!text) return '';
  const urlPattern = /(https?:\/\/[^\s<]+|www\.[^\s<]+)/gi;
  let result = '';
  let lastIndex = 0;
  const str = String(text);
  for (const match of str.matchAll(urlPattern)) {
    const idx = match.index;
    result += esc(str.slice(lastIndex, idx));
    let url = match[0];
    let trail = '';
    while (/[.,;:!?\])'"]$/.test(url)) {
      trail = url.slice(-1) + trail;
      url = url.slice(0, -1);
    }
    if (url) {
      const href = url.startsWith('www.') ? `https://${url}` : url;
      result += `<a href="${esc(href)}" target="_blank" rel="noopener noreferrer" class="text-link">${esc(url)}</a>`;
    }
    result += esc(trail);
    lastIndex = idx + match[0].length;
  }
  result += esc(str.slice(lastIndex));
  return result;
}
function parseIngredientList(t) {
  return String(t || '').split(/[\n,，、]/).map((s) => s.trim()).filter(Boolean);
}
function parseStepList(t) {
  return String(t || '').split(/\r?\n/).map((s) => s.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean);
}
/** @deprecated use parseIngredientList or parseStepList */
function parseList(t) { return parseIngredientList(t); }
function hasPhoto(img) { return img && img !== DEFAULT_IMAGE && !String(img).includes('images.unsplash.com'); }

function getRecipeDisplayImage(recipe) {
  if (typeof RecipeImageService !== 'undefined') return RecipeImageService.resolveSrc(recipe);
  if (hasPhoto(recipe?.image)) return recipe.image;
  return null;
}
function formatMoney(value, currencyCode = null) {
  const amount = Number(value) || 0;
  const code = currencyCode || state.currency || DEFAULT_CURRENCY;
  const currency = CURRENCY_OPTIONS[code] || CURRENCY_OPTIONS[DEFAULT_CURRENCY];
  return `${currency.symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency.fractionDigits,
  })}`;
}

/**
 * 통화별 금액 입력 예시 (placeholder)
 * KRW: 5,000 / 10,000 · JPY: 500 · USD/AUD/CAD: 50
 * scale: item | weekly | monthly
 */
function getCurrencyAmountExample(currencyCode = null, scale = 'item') {
  const code = currencyCode || state.currency || DEFAULT_CURRENCY;
  if (code === 'JPY') {
    if (scale === 'monthly') return '50,000';
    if (scale === 'weekly') return '5,000';
    return '500';
  }
  if (code === 'USD' || code === 'AUD' || code === 'CAD' || code === 'EUR' || code === 'GBP') {
    if (scale === 'monthly') return '500';
    if (scale === 'weekly') return '80';
    return '50';
  }
  // KRW (기본)
  if (scale === 'monthly') return '500,000';
  if (scale === 'weekly') return '50,000';
  return '5,000';
}

function currencyAmountPlaceholder(scale = 'item', currencyCode = null) {
  const example = getCurrencyAmountExample(currencyCode, scale);
  if (scale === 'item' && (currencyCode || state.currency || DEFAULT_CURRENCY) === 'KRW') {
    return '예: 5,000 또는 10,000';
  }
  return `예: ${example}`;
}

function currencyAmountInputStep(currencyCode = null) {
  const code = currencyCode || state.currency || DEFAULT_CURRENCY;
  const currency = CURRENCY_OPTIONS[code] || CURRENCY_OPTIONS[DEFAULT_CURRENCY];
  return currency.fractionDigits > 0 ? '0.01' : '1';
}

/** 금액 입력 placeholder·step을 현재 통화에 맞춤 */
function syncCurrencyAmountPlaceholders() {
  const code = state.currency || DEFAULT_CURRENCY;
  const step = currencyAmountInputStep(code);
  const apply = (el, scale) => {
    if (!el) return;
    el.placeholder = currencyAmountPlaceholder(scale, code);
    if (el.tagName === 'INPUT' && el.type === 'number') {
      el.step = step;
      el.inputMode = CURRENCY_OPTIONS[code]?.fractionDigits > 0 ? 'decimal' : 'numeric';
    }
  };
  apply(dom.groceryBudget, 'weekly');
  apply(dom.mealCost, 'item');
  apply(dom.shoppingAmount, 'item');
  apply(dom.monthlyFoodBudget, 'monthly');
}
function formatMoneyTotalsByCurrency(totalsMap) {
  const entries = Object.entries(totalsMap).filter(([, amount]) => amount > 0);
  if (!entries.length) return formatMoney(0);
  return entries.map(([code, amount]) => formatMoney(amount, code)).join(' + ');
}
function sumAmountsByCurrency(items, getAmount, getCurrency) {
  const totals = {};
  items.forEach((item) => {
    const code = getCurrency(item) || DEFAULT_CURRENCY;
    totals[code] = (totals[code] || 0) + (Number(getAmount(item)) || 0);
  });
  return totals;
}

function recipePlaceholderHTML(recipe, variant = 'card') {
  const type = DishTypeService.resolve(recipe);
  const label = DishTypeService.label(recipe);
  const svg = DishTypeService.placeholderSVG(recipe, variant === 'hero' ? 'recipe-placeholder-svg--hero' : '');
  if (variant === 'hero') {
    return `<div class="recipe-detail__hero--placeholder recipe-detail__hero--${type}" aria-label="${esc(label)}">${svg}<span class="recipe-placeholder-label">${esc(label)}</span></div>`;
  }
  return `<div class="recipe-card__image recipe-card__image--placeholder recipe-card__image--${type}" aria-label="${esc(label)}" title="${esc(label)}">${svg}</div>`;
}

function recipeCardImageHTML(recipe) {
  if (typeof RecipeImageService !== 'undefined') {
    // 카드 사진은 라이트박스 대신 카드와 같이 상세 모달로 연결
    return RecipeImageService.renderImg(recipe, { variant: 'card', zoomable: false });
  }
  return recipePlaceholderHTML(recipe, 'card');
}

function recipeHeroHTML(recipe) {
  if (typeof RecipeImageService !== 'undefined') {
    return RecipeImageService.renderImg(recipe, { variant: 'hero', zoomable: true });
  }
  return recipePlaceholderHTML(recipe, 'hero');
}

function bindZoomableImages(container) {
  // 카드 안 사진은 상세 모달로 열리게 두고, 상세 히어로 등만 라이트박스
  container.querySelectorAll('[data-zoom-src]').forEach((btn) => {
    if (btn.closest('.recipe-card')) return;
    btn.onclick = (e) => {
      e.stopPropagation();
      openImageLightbox(btn.dataset.zoomSrc, btn.querySelector('img')?.alt || '');
    };
  });
}

function openImageLightbox(src, alt = '') {
  if (!src || !dom.imageLightbox) return;
  dom.imageLightboxImg.src = src;
  dom.imageLightboxImg.alt = alt;
  dom.imageLightbox.hidden = false;
  dom.imageLightbox.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}

function closeImageLightbox() {
  if (!dom.imageLightbox) return;
  dom.imageLightbox.hidden = true;
  dom.imageLightbox.setAttribute('aria-hidden', 'true');
  dom.imageLightboxImg.removeAttribute('src');
  const modalOpen = [dom.recipeFormModal, dom.pantryModal, dom.mealModal, dom.shoppingModal, dom.groceryItemModal]
    .some((m) => m && !m.hidden);
  if (!modalOpen) document.body.style.overflow = '';
}
function idEq(a, b) { return String(a) === String(b); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parseDateStr(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}
function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
function getWeekStartDate(dateLike) {
  const base = dateLike instanceof Date ? new Date(dateLike) : parseDateStr(dateLike || todayStr());
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + diff);
  base.setHours(0, 0, 0, 0);
  return base;
}
function getWeekDates(startDateStr) {
  const start = getWeekStartDate(startDateStr);
  return Array.from({ length: 7 }, (_, i) => {
    const d = new Date(start);
    d.setDate(start.getDate() + i);
    return toDateStr(d);
  });
}
function getWeekKeyFromDateStr(dateStr) {
  // 주 시작일(월요일) YYYY-MM-DD — 주차 장보기 데이터 키
  return toDateStr(getWeekStartDate(dateStr));
}

/** 레거시 ISO 주차 키(2026-W28) → 주 시작일 키로 변환 */
function normalizeGroceryWeekKey(weekKey) {
  const raw = String(weekKey || '').trim();
  if (!raw) return getWeekKeyFromDateStr(todayStr());
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return getWeekKeyFromDateStr(raw);
  const iso = /^(\d{4})-W(\d{1,2})$/i.exec(raw);
  if (iso) {
    const year = Number(iso[1]);
    const weekNo = Number(iso[2]);
    const jan4 = new Date(year, 0, 4);
    const start = getWeekStartDate(jan4);
    start.setDate(start.getDate() + (weekNo - 1) * 7);
    return toDateStr(start);
  }
  return getWeekKeyFromDateStr(raw);
}
function formatPlannerWeekLabel(startDateStr) {
  const dates = getWeekDates(startDateStr);
  const first = parseDateStr(dates[0]);
  const last = parseDateStr(dates[6]);
  return `${first.getMonth() + 1}/${first.getDate()} - ${last.getMonth() + 1}/${last.getDate()}`;
}
function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

let toastTimer = null;
function showToast(msg) {
  if (!dom.toast) return;
  dom.toast.textContent = msg;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 2000);
}

function compressImage(file) {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) return reject(new Error('이미지 파일만 가능합니다'));
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const max = 800; let { width, height } = img;
        if (width > max || height > max) {
          if (width > height) { height = Math.round(height * max / width); width = max; }
          else { width = Math.round(width * max / height); height = max; }
        }
        const c = document.createElement('canvas'); c.width = width; c.height = height;
        c.getContext('2d').drawImage(img, 0, 0, width, height);
        resolve(c.toDataURL('image/jpeg', 0.82));
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
      img.src = e.target.result;
    };
    reader.readAsDataURL(file);
  });
}

// ===== Navigation =====
function isPublicCommunityRecipe(recipe) {
  return recipe?.source === 'user' && (recipe.visibility === 'public' || recipe.isPublic === true);
}

function getAuthorProfilesService() {
  return window.FirebaseServices?.FirestorePublicProfilesService || null;
}

function resolveAuthorCardInfo(recipe) {
  if (!recipe || !isPublicCommunityRecipe(recipe)) return null;
  const authorId = String(recipe.authorId || '').trim();
  const svc = getAuthorProfilesService();
  const cached = authorId && svc?.peek ? svc.peek(authorId) : undefined;
  const fallbackName = String(
    recipe.authorName || recipe.nickname || recipe.displayName || '',
  ).trim();
  const fallbackImage = String(
    recipe.profileImage || recipe.profileImageUrl || recipe.authorGooglePhotoURL || '',
  ).trim();

  if (cached) {
    return {
      authorId,
      displayName: cached.displayName || fallbackName || '냉장GO 사용자',
      profileImageUrl: cached.profileImageUrl || fallbackImage,
    };
  }
  if (cached === null) {
    return {
      authorId,
      displayName: fallbackName || '냉장GO 사용자',
      profileImageUrl: fallbackImage,
    };
  }
  return {
    authorId,
    displayName: fallbackName || '냉장GO 사용자',
    profileImageUrl: fallbackImage,
  };
}

async function hydrateAuthorProfiles(recipes = []) {
  const svc = getAuthorProfilesService();
  if (!svc?.getMany) return;
  const ids = [...new Set(
    (recipes || [])
      .filter((r) => isPublicCommunityRecipe(r) && r.authorId)
      .map((r) => String(r.authorId)),
  )];
  if (!ids.length) return;
  try {
    await svc.getMany(ids);
  } catch (err) {
    console.warn('[hydrateAuthorProfiles]', err);
  }
}

function recipeAuthorRowHTML(recipe) {
  const info = resolveAuthorCardInfo(recipe);
  if (!info) return '';
  const initial = (info.displayName.charAt(0) || '냉').toUpperCase();
  const avatar = info.profileImageUrl
    ? `<img class="recipe-card-author__avatar" src="${esc(info.profileImageUrl)}" alt="" loading="lazy" decoding="async" width="20" height="20">`
    : `<span class="recipe-card-author__avatar recipe-card-author__avatar--initial" aria-hidden="true">${esc(initial)}</span>`;
  const authorAttr = info.authorId ? ` data-author-id="${esc(info.authorId)}"` : '';
  return `
    <button type="button" class="recipe-card-author"${authorAttr} aria-label="${esc(info.displayName)} 프로필 보기">
      ${avatar}
      <span class="recipe-card-author__name">${esc(info.displayName)}</span>
      <span class="recipe-card-author__chevron" aria-hidden="true">›</span>
    </button>`;
}

function recipeSourcePostLinkHTML(recipe) {
  const url = String(recipe?.sourcePostUrl || recipe?.sourceUrl || '').trim();
  if (!url) return '';
  const platform = String(recipe?.sourcePlatform || '').toLowerCase();
  const isVideo = /youtube|youtu\.be|tiktok|instagram|video|reel|shorts/i.test(platform)
    || /youtube\.com|youtu\.be|tiktok\.com|instagram\.com/.test(url);
  const label = isVideo ? '이 레시피 영상 보기 ↗' : '원본 게시물 보기 ↗';
  return `<a class="recipe-detail__source-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`;
}

function authorSocialButtonsHTML(socialLinks = {}) {
  const items = [
    { key: 'youtube', label: 'YouTube' },
    { key: 'instagram', label: 'Instagram' },
    { key: 'tiktok', label: 'TikTok' },
    { key: 'website', label: '웹사이트' },
  ];
  return items
    .filter((item) => socialLinks[item.key])
    .map((item) => `
      <a class="author-profile__social-btn" href="${esc(socialLinks[item.key])}" target="_blank" rel="noopener noreferrer">
        <span class="author-profile__social-label">${esc(item.label)}</span>
        <span class="author-profile__social-ext" aria-hidden="true">↗</span>
      </a>`)
    .join('');
}

async function openAuthorProfile(authorId, { returnView = null } = {}) {
  const uid = String(authorId || '').trim();
  if (!uid) return;
  state.authorProfileId = uid;
  state.authorProfileReturnView = returnView || (state.view === 'author-profile' ? state.authorProfileReturnView : state.view) || 'main';
  closeAllModals();
  switchView('author-profile');
  window.scrollTo({ top: 0, behavior: 'smooth' });
  await renderAuthorProfile();
}

async function renderAuthorProfile() {
  const header = dom.authorProfileHeader;
  const listEl = dom.authorProfileRecipes;
  const emptyEl = dom.authorProfileEmpty;
  if (!header || !listEl) return;

  const authorId = state.authorProfileId;
  if (!authorId) {
    header.innerHTML = '<p class="author-profile__error">작성자를 찾을 수 없어요</p>';
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.hidden = true;
    return;
  }

  header.innerHTML = '<div class="author-profile__loading">프로필을 불러오는 중…</div>';
  listEl.innerHTML = '';
  if (emptyEl) emptyEl.hidden = true;

  const svc = getAuthorProfilesService();
  let profile = null;
  try {
    profile = svc ? await svc.getById(authorId, { force: true, includeSocial: true }) : null;
  } catch (err) {
    console.warn('[renderAuthorProfile]', err);
  }

  const fallbackRecipe = PublicRecipeRepository.getAll().find((r) => r.authorId === authorId);
  const displayName = profile?.displayName
    || fallbackRecipe?.authorName
    || fallbackRecipe?.nickname
    || '냉장GO 사용자';
  const imageUrl = profile?.profileImageUrl
    || fallbackRecipe?.profileImage
    || '';
  const bio = profile?.bio || '';
  const socialLinks = profile?.socialLinks || {};
  const initial = (displayName.charAt(0) || '냉').toUpperCase();
  const avatar = imageUrl
    ? `<img class="author-profile__avatar" src="${esc(imageUrl)}" alt="" loading="lazy" decoding="async" width="72" height="72">`
    : `<span class="author-profile__avatar author-profile__avatar--initial" aria-hidden="true">${esc(initial)}</span>`;
  const socialHtml = authorSocialButtonsHTML(socialLinks);

  header.innerHTML = `
    <div class="author-profile__identity">
      ${avatar}
      <div class="author-profile__text">
        <h2 class="author-profile__name">${esc(displayName)}</h2>
        ${bio ? `<p class="author-profile__bio">${esc(bio)}</p>` : ''}
      </div>
    </div>
    ${socialHtml ? `<div class="author-profile__socials">${socialHtml}</div>` : ''}`;

  let recipes = PublicRecipeRepository.getAll().filter(
    (r) => r.authorId === authorId && isPublicCommunityRecipe(r),
  );
  const publicSvc = window.FirebaseServices?.FirestorePublicRecipesService;
  if ((!recipes.length || recipes.length < (profile?.publicRecipeCount || 0)) && publicSvc?.listByAuthorId) {
    try {
      const remote = await publicSvc.listByAuthorId(authorId);
      if (remote?.length) recipes = remote;
    } catch (err) {
      console.warn('[renderAuthorProfile] listByAuthorId', err);
    }
  }

  const names = RecommendationService.getPantryNames();
  const results = recipes.map((recipe) => ({
    recipe,
    ...MatchService.analyze(names, recipe.ingredients),
  }));

  await hydrateAuthorProfiles(recipes);
  if (state.view !== 'author-profile' || state.authorProfileId !== authorId) return;

  if (!results.length) {
    listEl.innerHTML = '';
    if (emptyEl) emptyEl.hidden = false;
    return;
  }
  if (emptyEl) emptyEl.hidden = true;
  listEl.innerHTML = results.map((r) => homeRecipeCardHTML(r, { showAuthor: true })).join('');
  bindRecipeCards(listEl, results);
}

/** 직접 입력 공개설정과 동일한 Material 선형 아이콘 */
function recipeVisibilityLabelHTML(visibility) {
  const isPublic = visibility === 'public';
  const icon = isPublic ? 'public' : 'lock';
  const text = isPublic ? '공개' : '비공개';
  return `<span class="recipe-visibility-label"><span class="material-symbols-outlined recipe-visibility-label__icon" aria-hidden="true">${icon}</span>${text}</span>`;
}

function switchView(view) {
  if (view === 'community') view = 'main';
  const prevView = state.view;
  state.view = view;
  Object.entries(dom.views).forEach(([k, el]) => { if (el) el.hidden = k !== view; });
  dom.tabItems.forEach((tab) => {
    tab.classList.toggle('tab-bar__item--active', tab.dataset.view === view);
  });
  document.body.classList.toggle('view--main', view === 'main');
  document.body.classList.toggle('view--calendar', view === 'calendar');
  document.body.classList.toggle('view--author-profile', view === 'author-profile');
  document.body.classList.toggle('view--recipe-detail', view === 'recipe-detail');
  if (prevView === 'main' && view !== 'main') {
    toggleHomeFilterPanel(false);
    collapseHomeSearchDock();
    setHomeSearchKeyboardActive(false);
  }
  if (dom.headerSubtitle) {
    if (view === 'main' || view === 'recipe-detail') {
      dom.headerSubtitle.hidden = true;
      dom.headerSubtitle.textContent = '';
    } else {
      dom.headerSubtitle.hidden = false;
      dom.headerSubtitle.textContent = VIEW_TITLES[view] || VIEW_TITLES.main;
    }
  }
  renderCurrentView();
}

function navigate(view) {
  if (view === 'community') view = 'main';
  if (view !== 'author-profile') state.authorProfileId = null;
  switchView(view);
  closeAllModals();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function openVideoRecipeForm() {
  if (!isLoggedInAppUser()) {
    requireAppLogin({
      preset: 'videoRecipe',
      redirectAfterLogin: () => openVideoRecipeForm(),
    });
    return;
  }
  if (!prepareRecipeForm(null)) return;
  openModal('form');
  applyRecipeFormTab('video');
  requestAnimationFrame(() => dom.videoSourceUrl?.focus());
}

function renderCurrentView() {
  renderPantryChips();
  switch (state.view) {
    case 'main': renderHome(); break;
    case 'my-recipes': renderMyRecipes(); break;
    case 'pantry': renderPantryManage(); break;
    case 'planner': renderPlanner(); break;
    case 'calendar': renderCalendar(); break;
    case 'author-profile': renderAuthorProfile(); break;
    case 'recipe-detail': renderRecipeDetailPage(); break;
  }
}

function refreshAll() {
  HomeBriefingService.invalidate();
  renderCurrentView();
  if (state.view !== 'main') renderHome();
}

// ===== Render: Pantry Chips =====
function pantryChipBadge(item) {
  if (ExpiryService.status(item.expiryDate) !== 'soon') return '';
  const days = ExpiryService.daysUntil(item.expiryDate);
  const label = days === 0 ? '오늘' : days > 0 ? `${days}일` : '⚠️';
  return `<span class="tag__expiry-badge">${esc(label)}</span>`;
}

const HOME_PANTRY_PREVIEW_COUNT = 5;
let pantryChipsExpanded = Boolean(StorageAdapter.get(CONFIG.STORAGE.HOME_PANTRY_EXPANDED, false));
let pantryChipsRelayoutTimer = null;
let pantryMeasureHost = null;

function isMobilePantryChipsViewport() {
  return window.matchMedia('(max-width: 480px)').matches;
}

function pantryChipHTML(item) {
  return `
    <span class="tag" role="listitem">
      <span class="tag__emoji" aria-hidden="true">${pantryItemEmoji(item.name)}</span>
      <span class="tag__name">${esc(item.name)}</span>${pantryChipBadge(item)}
      <button type="button" class="tag__remove" data-rm="${esc(item.id)}" aria-label="삭제">&times;</button>
    </span>`;
}

/** 홈 보유 재료 칩 — 삭제/배지 없이 아이콘+이름만 */
function pantryChipHomeHTML(item) {
  return `
    <span class="tag tag--home-rail" role="listitem">
      <span class="tag__emoji" aria-hidden="true">${pantryItemEmoji(item.name)}</span>
      <span class="tag__name">${esc(item.name)}</span>
    </span>`;
}

function pantryOverflowButtonHTML(overflow, expanded) {
  const caret = expanded ? '▲' : '▼';
  const aria = expanded ? '보유 재료 접기' : `외 ${overflow}개 재료 펼치기`;
  return `<button type="button" class="tag tag--overflow" data-pantry-expand aria-expanded="${expanded ? 'true' : 'false'}" aria-label="${aria}">
      <span class="tag__overflow-count">+${overflow}</span>
      <span class="tag__overflow-caret" aria-hidden="true">${caret}</span>
    </button>`;
}

function pantryHomeMoreChipHTML(overflow) {
  return `<button type="button" class="tag tag--overflow tag--home-more" data-pantry-home-more aria-label="외 ${overflow}개 재료 더보기">
      <span class="tag__overflow-count">+${overflow} 더보기</span>
    </button>`;
}

function getPantryChipsGapPx(el) {
  const styles = getComputedStyle(el);
  const gap = Number.parseFloat(styles.columnGap || styles.gap || '0');
  return Number.isFinite(gap) ? gap : 8;
}

function pantryChipsFitInRows(widths, containerWidth, gap, maxRows) {
  if (!widths.length) return true;
  if (containerWidth <= 0) return false;
  let row = 1;
  let used = 0;
  for (const width of widths) {
    const w = Math.max(0, Number(width) || 0);
    const need = used === 0 ? w : used + gap + w;
    if (need <= containerWidth + 0.5) {
      used = need;
      continue;
    }
    row += 1;
    if (row > maxRows) return false;
    used = w;
    if (w > containerWidth + 0.5) return false;
  }
  return true;
}

function ensurePantryMeasureHost() {
  if (pantryMeasureHost?.isConnected) return pantryMeasureHost;
  pantryMeasureHost = document.createElement('div');
  pantryMeasureHost.className = 'tags home-tags pantry-chips-measure-host';
  pantryMeasureHost.setAttribute('aria-hidden', 'true');
  document.body.appendChild(pantryMeasureHost);
  return pantryMeasureHost;
}

function measurePantryOverflowWidth(host, overflow) {
  const probe = document.createElement('button');
  probe.type = 'button';
  probe.className = 'tag tag--overflow';
  probe.innerHTML = `<span class="tag__overflow-count">+${overflow}</span><span class="tag__overflow-caret" aria-hidden="true">▼</span>`;
  host.appendChild(probe);
  const width = probe.offsetWidth;
  probe.remove();
  return width;
}

function measureHomePantryChipWidths(items) {
  const source = dom.pantryChips;
  const host = ensurePantryMeasureHost();
  const width = source?.clientWidth || source?.parentElement?.clientWidth || 0;
  host.style.width = width ? `${width}px` : '';
  host.innerHTML = (items || []).map(pantryChipHTML).join('');
  const chipWidths = [...host.querySelectorAll('.tag')].map((el) => el.offsetWidth);
  const gap = getPantryChipsGapPx(source || host);
  host.innerHTML = '';
  return { containerWidth: width, gap, chipWidths };
}

function getDesktopPantryCollapsedPlan(items) {
  const total = items.length;
  if (total <= HOME_PANTRY_PREVIEW_COUNT) {
    return { visibleCount: total, overflow: 0, needsToggle: false };
  }
  return {
    visibleCount: HOME_PANTRY_PREVIEW_COUNT,
    overflow: total - HOME_PANTRY_PREVIEW_COUNT,
    needsToggle: true,
  };
}

function getMobilePantryCollapsedPlan(items) {
  const total = items.length;
  if (!total) return { visibleCount: 0, overflow: 0, needsToggle: false };

  const { containerWidth, gap, chipWidths } = measureHomePantryChipWidths(items);
  if (!containerWidth || chipWidths.length !== total) {
    return getDesktopPantryCollapsedPlan(items);
  }

  if (pantryChipsFitInRows(chipWidths, containerWidth, gap, 2)) {
    return { visibleCount: total, overflow: 0, needsToggle: false };
  }

  const host = ensurePantryMeasureHost();
  host.style.width = `${containerWidth}px`;

  for (let visibleCount = total - 1; visibleCount >= 0; visibleCount -= 1) {
    const overflow = total - visibleCount;
    const overflowWidth = measurePantryOverflowWidth(host, overflow);
    const widths = chipWidths.slice(0, visibleCount).concat(overflowWidth);
    if (pantryChipsFitInRows(widths, containerWidth, gap, 2)) {
      return { visibleCount, overflow, needsToggle: true };
    }
  }

  return { visibleCount: 0, overflow: total, needsToggle: true };
}

function getPantryCollapsedPlan(items) {
  if (isMobilePantryChipsViewport()) return getMobilePantryCollapsedPlan(items);
  return getDesktopPantryCollapsedPlan(items);
}

function buildPantryChipsHTML(items, { expanded, visibleCount, overflow, needsToggle } = {}) {
  const showAll = expanded || !needsToggle;
  const visible = showAll ? items : items.slice(0, Math.max(0, visibleCount || 0));
  let html = visible.map(pantryChipHTML).join('');
  if (needsToggle && overflow > 0) {
    html += pantryOverflowButtonHTML(overflow, showAll);
  }
  return html;
}

function bindPantryChipRemoveHandlers(root = dom.pantryChips) {
  root?.querySelectorAll('[data-rm]').forEach((btn) => {
    btn.onclick = () => {
      requireAppLogin(() => {
        removePantryItem(btn.dataset.rm).catch((err) => handlePantryFirestoreError(err));
      });
    };
  });
}

function bindPantryChipExpandHandler(root = dom.pantryChips) {
  const btn = root?.querySelector('[data-pantry-expand]');
  if (!btn) return;
  btn.onclick = (e) => {
    e.preventDefault();
    e.stopPropagation();
    setPantryChipsExpanded(!pantryChipsExpanded, { animate: true });
  };
}

function bindPantryChipsHandlers(root = dom.pantryChips) {
  bindPantryChipRemoveHandlers(root);
  bindPantryChipExpandHandler(root);
}

function schedulePantryChipsRelayout() {
  clearTimeout(pantryChipsRelayoutTimer);
  pantryChipsRelayoutTimer = setTimeout(() => {
    if (!dom.pantryChips || state.view !== 'main') return;
    if (!isMobilePantryChipsViewport()) return;
    renderPantryChips({ animate: false });
  }, 120);
}

function updateHomeRecipesSubtitle() {
  // 홈 화면에서는 안내 문구를 표시하지 않음 (계산 로직 countMakeableNow 등은 다른 곳에서 유지)
  const el = dom.homeRecipesSubtitle;
  if (!el) return;
  el.hidden = true;
  el.textContent = '';
}

function runPantryChipsHeightTransition(clip, fromHeight, toHeight, onComplete) {
  clip.style.height = `${fromHeight}px`;
  clip.style.overflow = 'hidden';
  requestAnimationFrame(() => {
    clip.style.transition = 'height 250ms ease';
    clip.style.height = `${toHeight}px`;
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      clip.style.height = '';
      clip.style.overflow = '';
      clip.style.transition = '';
      onComplete?.();
    };
    clip.addEventListener('transitionend', finish, { once: true });
    setTimeout(finish, 280);
  });
}

function setPantryChipsExpanded(next, { animate = false } = {}) {
  pantryChipsExpanded = next;
  StorageAdapter.set(CONFIG.STORAGE.HOME_PANTRY_EXPANDED, next);
  renderPantryChips({ animate });
}

function renderPantryChips({ animate = false } = {}) {
  const items = getPantryItemsForUi();
  const count = items.length;
  if (dom.pantryChipsCount) {
    dom.pantryChipsCount.textContent = count > 0 ? ` ${count}개` : '';
    dom.pantryChipsCount.hidden = count === 0;
  }
  const chips = dom.pantryChips;
  if (!chips) return;

  dom.homePantrySection?.classList.remove('is-expanded');
  if (!count) {
    chips.innerHTML = '<p class="hint hint--inline">재료를 추가하면 맞춤 레시피를 추천해 드려요.</p>';
    return;
  }

  const preview = Math.min(HOME_PANTRY_PREVIEW_COUNT, count);
  const overflow = Math.max(0, count - preview);
  const visible = items.slice(0, preview);
  let html = visible.map(pantryChipHomeHTML).join('');
  if (overflow > 0) html += pantryHomeMoreChipHTML(overflow);
  chips.innerHTML = html;
  chips.querySelector('[data-pantry-home-more]')?.addEventListener('click', (e) => {
    e.preventDefault();
    navigate('pantry');
  });
}


function canForkRecipe(recipe) {
  return Boolean(recipe);
}

function forkRecipeFrom(sourceId) {
  if (!isLoggedInAppUser()) {
    requireAppLogin(() => forkRecipeFrom(sourceId));
    return;
  }
  const source = RecipeRepository.getById(sourceId);
  if (!source) return;
  const image = hasPhoto(source.image) ? source.image : '';
  const data = {
    name: source.name,
    ingredients: [...source.ingredients],
    steps: [...source.steps],
    cookTime: source.cookTime,
    difficulty: source.difficulty,
    category: source.category,
    dishType: source.dishType || DishTypeService.infer(source.name),
    memo: source.memo || '',
    image,
    visibility: 'private',
    parentRecipeId: source.id,
    createdFrom: source.name,
  };
  saveUserRecipe(data)
    .then((saved) => {
      switchView('my-recipes');
      openRecipeForm(saved?.id || saved?.firestoreId);
      showToast(`"${source.name}"을(를) 내 레시피로 복사했어요`);
    })
    .catch((err) => showToast(err.message || '레시피 복사에 실패했습니다.'));
}

function recipeOriginHTML(recipe, { compact = false } = {}) {
  if (!recipe.createdFrom && !recipe.parentRecipeId) return '';
  const label = recipe.createdFrom || '레시피';
  if (compact) {
    return `<p class="recipe-card__origin">${esc(label)} 기반</p>`;
  }
  const parentId = recipe.parentRecipeId ? esc(recipe.parentRecipeId) : '';
  if (parentId) {
    return `<button type="button" class="recipe-detail__origin" data-open-parent="${parentId}">원본: ${esc(label)}</button>`;
  }
  return `<p class="recipe-detail__origin recipe-detail__origin--static">원본: ${esc(label)}</p>`;
}

function groceryAddButtonHTML(recipeId, { compact = false } = {}) {
  const cls = compact ? 'btn-grocery-add btn-grocery-add--sm' : 'btn-grocery-add';
  return `<button type="button" class="${cls}" data-grocery-add-rid="${esc(recipeId)}" onclick="event.stopPropagation()">장보기 추가</button>`;
}

async function addRecipeMissingToGroceryList(recipeId, { button = null } = {}) {
  if (button?.disabled) return;
  const recipe = RecipeRepository.getById(recipeId);
  if (!recipe) return;

  if (button) button.disabled = true;
  try {
    const dates = GroceryListService.getPlannerDates(state.plannerWeekStart);
    const grouped = GroceryListService.computeMissing(dates);
    const { added, missingCount } = GroceryListService.addMissingIngredientsFromRecipe(recipe, grouped);
    if (!missingCount) {
      showToast('이미 모든 재료가 있어요');
      return;
    }
    if (!added) {
      showToast('이미 장보기 리스트에 추가되어 있어요');
      return;
    }
    await persistGroceryState();
    if (state.view === 'planner') renderGroceryList();
    showToast(
      added === 1
        ? '장보기 리스트에 재료 1개를 추가했어요'
        : `장보기 리스트에 재료 ${added}개를 추가했어요`,
    );
  } catch (err) {
    console.error('[Grocery] addRecipeMissingToGroceryList failed', { recipeId, err });
    showToast('장보기 리스트에 추가하지 못했어요');
  } finally {
    if (button) button.disabled = false;
  }
}

// ===== Render: Home Recipe Card (4-row layout) =====
function shortIngredientLabel(text) {
  return getIngredientMatchName(text) || formatIngredientDisplay(text) || String(text || '').trim();
}

const HOME_CARD_CLOCK_ICON = `<svg class="recipe-card-home__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><circle cx="8" cy="8" r="5.25" stroke="currentColor" stroke-width="1.4"/><path d="M8 5.25V8l2 1.5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

function homeCardDifficultyIcon(difficulty) {
  const level = difficulty === '어려움' ? 3 : difficulty === '보통' ? 2 : 1;
  const bars = [1, 2, 3].map((n) => {
    const h = 3 + n * 2.5;
    const y = 12.5 - h;
    const opacity = n <= level ? '1' : '0.28';
    return `<rect x="${2.5 + (n - 1) * 3.5}" y="${y}" width="2.2" height="${h}" rx="0.6" fill="currentColor" opacity="${opacity}"/>`;
  }).join('');
  return `<svg class="recipe-card-home__icon" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">${bars}</svg>`;
}

const HOME_CARD_BOOKMARK_ICON = `<svg class="recipe-card-home__bookmark-icon" viewBox="0 0 20 20" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 3.75h8a1 1 0 011 1V16l-5-2.75L5 16V4.75a1 1 0 011-1z" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
const HOME_CARD_BOOKMARK_ICON_FILLED = `<svg class="recipe-card-home__bookmark-icon" viewBox="0 0 20 20" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M6 3.75h8a1 1 0 011 1V16l-5-2.75L5 16V4.75a1 1 0 011-1z" fill="currentColor"/></svg>`;
const HOME_CARD_CART_ICON = `<svg class="recipe-card-home__hint-icon recipe-card-home__hint-icon--cart" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M2.5 2.5h1.2l.35 1.4M4.05 3.9h9.2l-1.1 5.1H5.2L4.05 3.9z" stroke="currentColor" stroke-width="1.35" stroke-linecap="round" stroke-linejoin="round"/><circle cx="6.1" cy="12.2" r="1.05" fill="currentColor"/><circle cx="11.1" cy="12.2" r="1.05" fill="currentColor"/></svg>`;
const HOME_CARD_SWAP_ICON = `<svg class="recipe-card-home__hint-icon recipe-card-home__hint-icon--swap" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3.2 5.2h7.2M8.6 3.2l2.2 2-2.2 2M12.8 10.8H5.6M7.4 8.8l-2.2 2 2.2 2" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

/** 홈 카드 추천 태그 (최대 2개, 이모지 없음). 대체 문구가 없을 때만 사용 */
function getHomeRecipeRecommendTags({ recipe, matchedPantryNames, expiryBoost }) {
  const tags = [];
  const soon = (expiryBoost != null ? expiryBoost : RecommendationService.getExpiryBoost(matchedPantryNames || [])) > 0;
  const text = [
    recipe?.name,
    ...(recipe?.tags || []),
    ...(recipe?.dietTags || []),
    recipe?.dishType,
    ...(recipe?.ingredients || []).map(formatIngredientDisplay),
  ].filter(Boolean).join(' ');

  if (soon) tags.push('임박 재료 활용');
  if (Number(recipe?.cookTime) > 0 && Number(recipe.cookTime) <= 15) tags.push('15분 이하');
  if (RecommendationService.isHighProtein(recipe)) tags.push('고단백');
  if (RecommendationService.isDiet(recipe)) tags.push('다이어트');
  if (/야식|심야/.test(text) || recipe?.dishType === 'snack') tags.push('야식 추천');
  if (recipe?.dishType === 'breakfast' || /아침|브런치|모닝/.test(text)) tags.push('아침 추천');
  if (recipe?.dishType === 'salad' || /도시락|런치박스|lunchbox/.test(text)) tags.push('도시락');
  if (/안주|술안주|맥주|소주|치킨|마른안주/.test(text)) tags.push('술안주');

  return [...new Set(tags)].slice(0, 2);
}

/** 홈 카드 준비 상태 문구 — 목업: 🛒 + 주황 Bold 재료명 + 기본색 나머지 */
function uniqueShortIngredientLabels(missing) {
  const out = [];
  const seen = new Set();
  for (const item of missing || []) {
    const label = shortIngredientLabel(item);
    if (!label) continue;
    const key = MatchService.normalize(label);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(label);
  }
  return out;
}

function homeCardMissingStatusInnerHTML(namesText, restText) {
  return `${HOME_CARD_CART_ICON}<span class="recipe-card-status__names">${esc(namesText)}</span><span class="recipe-card-status__rest">${esc(restText)}</span>`;
}

/** 부족 재료 표시 후보 (선호 순). 모바일에서 한 줄에 맞는 첫 후보를 고른다. */
function buildHomeCardMissingStatusVariants(names) {
  const count = names.length;
  if (count <= 0) return [];
  if (count <= 2) {
    const joined = names.join(', ');
    return [
      { namesText: joined, restText: '만 있으면 가능' },
      { namesText: joined, restText: ' 부족' },
    ];
  }
  return [
    { namesText: `${names[0]}, ${names[1]} 외 ${count - 2}개`, restText: ' 부족' },
    { namesText: `${names[0]} 외 ${count - 1}개`, restText: ' 부족' },
  ];
}

function formatHomeReadyMessage(missing, { readyHtml = '바로 가능' } = {}) {
  const names = uniqueShortIngredientLabels(missing);
  const count = names.length;
  if (count <= 0) {
    return { html: readyHtml, mod: 'available', names: [] };
  }
  const preferred = buildHomeCardMissingStatusVariants(names)[0];
  return {
    html: homeCardMissingStatusInnerHTML(preferred.namesText, preferred.restText),
    mod: count <= 2 ? 'low' : 'medium',
    names,
  };
}

/** 홈 카드 대체 문구 — 목업: 초록 교체 아이콘 + 초록 Bold "A → B" + 기본색 나머지 */
function formatHomeSubstitutionLine(substituted) {
  if (!isLoggedInAppUser() || !substituted?.length) return '';
  const first = substituted[0];
  const required = shortIngredientLabel(first.required);
  const owned = shortIngredientLabel(first.owned);
  if (!required || !owned) return '';
  return {
    required,
    owned,
    html: `${HOME_CARD_SWAP_ICON}<span class="recipe-card-home__sub-pair">${esc(required)} → ${esc(owned)}</span><span class="recipe-card-home__sub-rest">로 대체 가능</span>`,
  };
}

/** 내 레시피 카드 준비 상태 — 홈과 동일한 긍정형 부족 안내 */
function formatMyRecipeReadyMessage(missing) {
  return formatHomeReadyMessage(missing, { readyHtml: '바로 가능' });
}

/** 내 레시피 대체 문구 — 초록 교체 아이콘 + 초록 "A → B" + 회색 "로 대체 가능" */
function formatMyRecipeSubstitutionLine(substituted) {
  if (!isLoggedInAppUser() || !substituted?.length) return '';
  const first = substituted[0];
  const required = shortIngredientLabel(first.required);
  const owned = shortIngredientLabel(first.owned);
  if (!required || !owned) return '';
  return {
    required,
    owned,
    html: `${HOME_CARD_SWAP_ICON}<span class="recipe-card-home__sub-pair">${esc(required)} → ${esc(owned)}</span><span class="recipe-card-home__sub-rest">로 대체 가능</span>`,
  };
}

function isMobileHomeCardMissingFitViewport() {
  return window.matchMedia('(max-width: 480px)').matches;
}

function applyHomeCardMissingStatusVariant(statusEl, variant) {
  const namesEl = statusEl.querySelector('.recipe-card-status__names');
  const restEl = statusEl.querySelector('.recipe-card-status__rest');
  if (!namesEl || !restEl || !variant) return;
  namesEl.textContent = variant.namesText;
  restEl.textContent = variant.restText;
}

function homeCardMissingStatusOverflows(statusEl) {
  const prev = {
    whiteSpace: statusEl.style.whiteSpace,
    display: statusEl.style.display,
    webkitLineClamp: statusEl.style.webkitLineClamp,
    lineClamp: statusEl.style.lineClamp,
    overflow: statusEl.style.overflow,
    maxHeight: statusEl.style.maxHeight,
  };
  statusEl.style.whiteSpace = 'nowrap';
  statusEl.style.display = 'block';
  statusEl.style.webkitLineClamp = 'unset';
  statusEl.style.lineClamp = 'unset';
  statusEl.style.overflow = 'hidden';
  statusEl.style.maxHeight = 'none';
  const overflows = statusEl.scrollWidth > statusEl.clientWidth + 0.5;
  statusEl.style.whiteSpace = prev.whiteSpace;
  statusEl.style.display = prev.display;
  statusEl.style.webkitLineClamp = prev.webkitLineClamp;
  statusEl.style.lineClamp = prev.lineClamp;
  statusEl.style.overflow = prev.overflow;
  statusEl.style.maxHeight = prev.maxHeight;
  return overflows;
}

/** 모바일에서만: 카드별 실제 폭으로 부족 재료 문구를 한 줄에 맞게 축소 */
function fitMobileHomeCardMissingStatuses(container) {
  if (!container) return;
  const statusNodes = container.querySelectorAll('.recipe-card--home .recipe-card-status[data-missing-labels]');
  if (!statusNodes.length) return;
  const mobile = isMobileHomeCardMissingFitViewport();
  statusNodes.forEach((statusEl) => {
    const names = String(statusEl.dataset.missingLabels || '').split('\u001f').filter(Boolean);
    if (!names.length) return;
    const variants = buildHomeCardMissingStatusVariants(names);
    if (!variants.length) return;
    if (!mobile) {
      applyHomeCardMissingStatusVariant(statusEl, variants[0]);
      return;
    }
    let chosen = variants[variants.length - 1];
    for (const variant of variants) {
      applyHomeCardMissingStatusVariant(statusEl, variant);
      if (!homeCardMissingStatusOverflows(statusEl)) {
        chosen = variant;
        break;
      }
    }
    applyHomeCardMissingStatusVariant(statusEl, chosen);
  });
}

let homeCardMissingFitResizeTimer = null;
function scheduleFitMobileHomeCardMissingStatuses() {
  clearTimeout(homeCardMissingFitResizeTimer);
  homeCardMissingFitResizeTimer = setTimeout(() => {
    [dom.recipeList, dom.myRecipesList, dom.savedList].forEach((el) => {
      if (el && !el.hidden) fitMobileHomeCardMissingStatuses(el);
    });
  }, 120);
}

function homeGroceryAddButtonHTML(recipeId) {
  return `<button type="button" class="recipe-card-home__grocery-btn" data-grocery-add-rid="${esc(recipeId)}" onclick="event.stopPropagation()">장보기 추가</button>`;
}

function getHomeMatchPercentMod(percent) {
  const value = Math.max(0, Math.min(100, Number(percent) || 0));
  if (value >= 100) return 'full';
  if (value >= 80) return 'high';
  if (value >= 60) return 'mid';
  if (value >= 40) return 'fair';
  return 'low';
}

function homeMatchPercentPillHTML(matchPercent) {
  if (matchPercent == null || Number.isNaN(Number(matchPercent))) return '';
  const value = Math.max(0, Math.min(100, Math.round(Number(matchPercent))));
  const mod = getHomeMatchPercentMod(value);
  return `<span class="recipe-card-home__match recipe-card-home__match--${mod}">${value}%</span>`;
}

/** 홈·저장·내 레시피 공통 카드 레이아웃 */
function homeRecipeCardHTML(result, options = {}) {
  const {
    action = 'save', // 'save' | 'fork' | 'none'
    showVisibility = false,
    showAuthor = true,
    readyHtml = '바로 가능',
    showRecommendTags = true,
    variant = 'home', // 'home' | 'my'
  } = options;
  const isMy = variant === 'my';

  const recipe = result.recipe;
  const missing = result.missing || [];
  const substituted = result.substituted || [];
  const matchedPantryNames = result.matchedPantryNames || [];
  const missingCount = missing.length;
  const status = isMy
    ? formatMyRecipeReadyMessage(missing)
    : formatHomeReadyMessage(missing, { readyHtml });
  const saved = SavedRecipeRepository.isSaved(recipe.id);
  const img = recipeCardImageHTML(recipe);
  const subLine = isMy
    ? formatMyRecipeSubstitutionLine(substituted)
    : formatHomeSubstitutionLine(substituted);
  const tags = (!subLine && showRecommendTags)
    ? getHomeRecipeRecommendTags({
      recipe,
      matchedPantryNames,
      expiryBoost: result.expiryBoost,
    })
    : [];

  let actionBtn = '';
  if (action === 'fork' && canForkRecipe(recipe)) {
    actionBtn = `<button type="button" class="recipe-card__action-btn" data-fork-id="${esc(recipe.id)}" data-auth-required aria-label="내 버전 만들기">✏️ 내 버전</button>`;
  } else if (action === 'save') {
    actionBtn = `<button type="button" class="recipe-card__action-btn recipe-card__action-btn--bookmark${saved ? ' recipe-card__action-btn--saved' : ''}" data-save-id="${esc(recipe.id)}" data-auth-required aria-label="${saved ? '저장 해제' : '레시피 저장'}">${saved ? HOME_CARD_BOOKMARK_ICON_FILLED : HOME_CARD_BOOKMARK_ICON}</button>`;
  }
  const matchPill = homeMatchPercentPillHTML(result.matchPercent);

  const visibilityMeta = showVisibility
    ? `<span class="recipe-card-home__meta-sep">·</span>
       <span class="recipe-card-home__meta-item">${recipeVisibilityLabelHTML(recipe.visibility)}</span>`
    : '';

  const statusRow = missingCount > 0
    ? `<div class="recipe-card-home__row recipe-card-home__row--status">
        <span class="recipe-card-status recipe-card-status--${status.mod}"${status.names?.length ? ` data-missing-labels="${esc(status.names.join('\u001f'))}"` : ''}>${status.html}</span>
        ${homeGroceryAddButtonHTML(recipe.id)}
      </div>`
    : `<div class="recipe-card-home__row recipe-card-home__row--status">
        <span class="recipe-card-status recipe-card-status--${status.mod}">${status.html}</span>
      </div>`;

  let row4;
  if (subLine) {
    row4 = `<p class="recipe-card-home__row recipe-card-home__sub recipe-card-home__footer">${subLine.html}</p>`;
  } else if (tags.length) {
    row4 = `<div class="recipe-card-home__row recipe-card-home__tags recipe-card-home__footer">${tags.map((t) => `<span class="recipe-card-home__tag">${esc(t)}</span>`).join('')}</div>`;
  } else {
    row4 = '<div class="recipe-card-home__row recipe-card-home__footer recipe-card-home__footer--empty" aria-hidden="true"></div>';
  }

  const authorRow = showAuthor && !isMy ? recipeAuthorRowHTML(recipe) : '';

  const cardClass = isMy
    ? 'recipe-card recipe-card--home recipe-card--my'
    : 'recipe-card recipe-card--home';

  return `
    <div class="${cardClass}" role="button" tabindex="0" data-rid="${esc(recipe.id)}">
      <div class="recipe-card__image-wrap">${img}</div>
      <div class="recipe-card__body recipe-card-home__content">
        <div class="recipe-card-home__info">
          <div class="recipe-card-home__title-row">
            <span class="recipe-card__name recipe-card-home__title">${esc(recipe.name)}</span>
            <div class="recipe-card-home__actions">${matchPill}${actionBtn}</div>
          </div>
          <div class="recipe-card-home__row recipe-card-home__meta">
            <span class="recipe-card-home__meta-item">${HOME_CARD_CLOCK_ICON}<span>${esc(String(recipe.cookTime || '-'))}분</span></span>
            <span class="recipe-card-home__meta-sep">·</span>
            <span class="recipe-card-home__meta-item">${homeCardDifficultyIcon(recipe.difficulty)}<span>${esc(recipe.difficulty || '-')}</span></span>
            ${visibilityMeta}
          </div>
          ${authorRow}
          ${statusRow}
          ${row4}
        </div>
      </div>
    </div>`;
}

function recipeCardHTML({ recipe, matchPercent, missing, matched, matchedPantryNames, exact, substituted, recommendationReason, showAuthor, showVisibility, showCardSave, showCardMealLog, showCardFork, showSaveCount, hideMatchBadge, hideOrigin, hideReason, hideExpiryHint, showMissingLine, showCommunityBadge }) {
  const badge = !hideMatchBadge && matchPercent != null ? (matchPercent >= 70 ? 'high' : matchPercent >= 40 ? 'mid' : 'low') : null;
  const img = recipeCardImageHTML(recipe);
  const soon = !hideExpiryHint && matchedPantryNames?.length && RecommendationService.getExpiryBoost(matchedPantryNames) > 0;
  const saved = SavedRecipeRepository.isSaved(recipe.id);
  const saveCount = showSaveCount ? RecipeSaveCountRepository.getCount(recipe.id) : 0;
  const communityBadge = showCommunityBadge
    ? '<span class="recipe-card__community-badge">🌍 Community</span>'
    : '';
  let headerAction = '';
  if (showCardSave) {
    headerAction = `<button type="button" class="recipe-card__action-btn${saved ? ' recipe-card__action-btn--saved' : ''}" data-save-id="${esc(recipe.id)}" data-auth-required aria-label="레시피 저장">${saved ? '⭐ 저장됨' : '☆ 저장'}</button>`;
  } else if (showCardMealLog) {
    headerAction = `<button type="button" class="recipe-card__action-btn" data-log-meal-id="${esc(recipe.id)}" data-auth-required aria-label="식사 기록">🍳 기록</button>`;
  }
  const forkBtn = showCardFork && canForkRecipe(recipe)
    ? `<button type="button" class="recipe-card__action-btn" data-fork-id="${esc(recipe.id)}" data-auth-required aria-label="내 버전 만들기">✏️ 내 버전</button>`
    : '';
  const missingLine = (showMissingLine || matchPercent != null) && (missing?.length || exact?.length || substituted?.length)
    ? `<p class="recipe-card__missing">${esc(MatchService.formatCardSummary({ exact: exact || [], substituted: substituted || [], missing: missing || [] }))}${missing?.length ? ` ${groceryAddButtonHTML(recipe.id, { compact: true })}` : ''}</p>`
    : (showMissingLine && !missing?.length && !exact?.length && !substituted?.length
      ? '<p class="recipe-card__missing">보유 재료와 일치합니다</p>'
      : '');
  return `
    <div class="recipe-card" role="button" tabindex="0" data-rid="${esc(recipe.id)}">
      <div class="recipe-card__image-wrap">${img}</div>
      <div class="recipe-card__body">
        <div class="recipe-card__top">
          <div class="recipe-card__title-wrap">
            <span class="recipe-card__name">${esc(recipe.name)}</span>
            ${communityBadge}
          </div>
          <div class="recipe-card__header-end">
            ${badge ? `<span class="match-badge match-badge--${badge}">${matchPercent}%</span>` : ''}
            ${headerAction || forkBtn ? `<div class="recipe-card__actions-row">${headerAction}${forkBtn}</div>` : ''}
          </div>
        </div>
        ${hideOrigin ? '' : recipeOriginHTML(recipe, { compact: true })}
        <div class="recipe-card__meta">
          <span>⏱ ${recipe.cookTime}분</span>
          <span>📊 ${recipe.difficulty}</span>
          ${showAuthor ? `<span>👤 ${esc(recipe.authorName)}</span>` : ''}
          ${showVisibility ? `<span>${recipeVisibilityLabelHTML(recipe.visibility)}</span>` : ''}
          ${showSaveCount ? `<span class="recipe-card__save-count">⭐ ${saveCount}명 저장</span>` : ''}
        </div>
        ${!hideReason && recommendationReason ? `<p class="recipe-card__reason">${esc(recommendationReason)}</p>` : ''}
        ${missingLine}
        ${soon ? `<p class="recipe-card__expiry-hint">유통기한 임박 재료 포함</p>` : ''}
      </div>
    </div>`;
}

function bindRecipeCards(container, results) {
  bindZoomableImages(container);
  container.querySelectorAll('.recipe-card').forEach((card) => {
    const open = (e) => {
      if (e.target.closest('[data-log-meal-id], [data-save-id], [data-fork-id], [data-grocery-add-rid], .recipe-card-author, [data-author-id]')) return;
      const r = results.find((x) => idEq(x.recipe.id, card.dataset.rid));
      openRecipeDetail(r || { recipe: RecipeRepository.getById(card.dataset.rid) });
    };
    card.onclick = open;
    card.onkeydown = (e) => {
      if (e.key === 'Enter' && !e.target.closest('[data-log-meal-id], [data-save-id], [data-fork-id], [data-grocery-add-rid], .recipe-card-author')) open(e);
    };
  });
  container.querySelectorAll('.recipe-card-author[data-author-id]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      openAuthorProfile(btn.dataset.authorId);
    };
  });
  container.querySelectorAll('[data-log-meal-id]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const recipeId = btn.dataset.logMealId;
      requireAppLogin(() => {
        const recipe = RecipeRepository.getById(recipeId);
        if (!recipe) return;
        openMealModal(null, { defaultDate: todayStr(), recipeId: recipe.id, mealType: 'home-cook', hideMealType: true });
      });
    };
  });
  container.querySelectorAll('[data-save-id]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const saveId = btn.dataset.saveId;
      requireAppLogin(() => {
        const nowSaved = SavedRecipeRepository.toggle(saveId);
        persistSavedRecipeIds().catch(() => undefined);
        showToast(nowSaved ? '레시피를 저장했어요' : '저장을 해제했어요');
        renderCurrentView();
      });
    };
  });
  container.querySelectorAll('[data-fork-id]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      forkRecipeFrom(btn.dataset.forkId);
    };
  });
  container.querySelectorAll('[data-grocery-add-rid]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      if (btn.disabled) return;
      addRecipeMissingToGroceryList(btn.dataset.groceryAddRid, { button: btn });
    };
  });
  requestAnimationFrame(() => fitMobileHomeCardMissingStatuses(container));
}

// ===== Render: Home =====
function homeHeroImageHTML(recipe) {
  const dishType = recipe.dishType || DishTypeService.infer(recipe.name);
  const hasPhoto = typeof RecipeImageService !== 'undefined' && RecipeImageService.pickPhoto(recipe);
  if (hasPhoto) {
    return `<div class="home-today-hero__image-frame">${RecipeImageService.renderImg(recipe, { variant: 'home-hero', alt: '' })}</div>`;
  }
  const categorySrc = typeof RecipeImageService !== 'undefined'
    ? RecipeImageService.resolveCategoryAssetSrc(recipe)
    : '';
  const svg = DishTypeService.placeholderSVG(recipe);
  return `
    <div class="home-today-hero__image-frame home-today-hero__image-frame--illustrated" aria-hidden="true">
      ${categorySrc ? `<img class="home-today-hero__img-bg" src="${esc(categorySrc)}" alt="">` : ''}
      <div class="home-today-hero__img home-today-hero__img--placeholder home-today-hero__img--${esc(dishType)}">${svg}</div>
    </div>`;
}

function homeMatchLevel(matchPercent) {
  if (matchPercent == null) return 'low';
  if (matchPercent >= 70) return 'high';
  if (matchPercent >= 40) return 'mid';
  return 'low';
}

function homeNaengtulCardHTML(result, index, total) {
  const { recipe, matchPercent } = result;
  const level = homeMatchLevel(matchPercent);
  return `
    <article class="home-today-hero home-naengtul-card" data-naengtul-index="${index}" aria-label="냉털 추천 ${index + 1} / ${total}">
      <div class="home-today-hero__content">
        <h3 class="home-today-hero__name">${esc(recipe.name)}</h3>
        <div class="home-today-hero__stats">
          ${matchPercent != null ? `<span class="home-today-hero__match home-today-hero__match--${level}">${matchPercent}% 재료 일치</span>` : ''}
          <span>${recipe.cookTime}분</span>
        </div>
        <button type="button" class="home-today-hero__cta" data-hero-rid="${esc(recipe.id)}">레시피 보기 →</button>
      </div>
      <div class="home-today-hero__image">${homeHeroImageHTML(recipe)}</div>
    </article>`;
}

function homeNaengtulHTML(results) {
  if (!results.length) {
    return `
      <section class="home-naengtul-empty" aria-label="냉털 추천">
        <p class="home-naengtul-empty__title">지금 만들 수 있는 냉털 메뉴가 없습니다.</p>
        <p class="home-naengtul-empty__text">부족한 재료 1개 레시피를 확인해보세요.</p>
        <button type="button" class="home-naengtul-empty__cta" data-scroll-home-recipes>레시피 탐색 보기 →</button>
      </section>`;
  }
  const total = results.length;
  const showDots = total > 1;
  return `
    <section class="home-naengtul" aria-label="냉털 추천">
      <div class="home-naengtul__head">
        <p class="home-naengtul__label">냉털 추천</p>
        ${showDots ? `<div class="home-naengtul__dots" role="tablist" aria-label="냉털 추천 카드">${results.map((_, i) => `<button type="button" class="home-naengtul__dot${i === 0 ? ' home-naengtul__dot--active' : ''}" role="tab" aria-selected="${i === 0 ? 'true' : 'false'}" aria-label="${i + 1}번째 추천" data-naengtul-dot="${i}"></button>`).join('')}</div>` : ''}
      </div>
      <div class="home-naengtul__carousel">
        ${results.map((r, i) => homeNaengtulCardHTML(r, i, total)).join('')}
      </div>
    </section>`;
}

function scrollToHomeRecipes() {
  dom.recipeList?.closest('.section--home-recipes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

function applyHomeBriefingFilter(filterId) {
  state.filters.clear();
  state.homeSavedOnly = false;
  if (filterId) state.filters.add(filterId);
  state.menuSearch = '';
  if (dom.menuSearchInput) dom.menuSearchInput.value = '';
  if (state.view !== 'main') {
    navigate('main');
  } else {
    renderHome();
  }
  expandHomeSearchDock();
  toggleHomeFilterPanel(true);
  requestAnimationFrame(() => scrollToHomeRecipes());
}

/** UI 전용 — HomeBriefingService와 독립, 1개 부족 레시피의 대표 재료 선정 */
function getBriefingOneMissingHighlight() {
  const pantryNames = RecommendationService.getPantryNames();
  if (!pantryNames.length) return null;

  const counts = new Map();
  let total = 0;
  for (const recipe of RecipeRepository.getHomeRecipes()) {
    const analysis = MatchService.analyze(pantryNames, recipe.ingredients || []);
    if (analysis.missing.length !== 1) continue;
    total += 1;
    const name = getIngredientMatchName(analysis.missing[0]) || String(analysis.missing[0] || '').trim();
    if (!name) continue;
    const key = MatchService.normalize(name);
    const prev = counts.get(key);
    if (prev) prev.count += 1;
    else counts.set(key, { name, count: 1 });
  }
  if (!total || counts.size !== 1) {
    return { total, ingredientName: null };
  }
  const [{ name }] = counts.values();
  return { total, ingredientName: name };
}

function formatBriefingBudget(amount) {
  const value = Math.abs(Number(amount) || 0);
  const code = state.currency || DEFAULT_CURRENCY;
  const currency = CURRENCY_OPTIONS[code] || CURRENCY_OPTIONS[DEFAULT_CURRENCY];
  const unitWord = {
    KRW: '원',
    USD: '달러',
    AUD: '달러',
    EUR: '유로',
    GBP: '파운드',
    JPY: '엔',
  }[code] || '';
  const formatted = value.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency.fractionDigits,
  });
  return { formatted, unitWord };
}

/** UI 전용 — 임박 재료 이름 최대 2개 (HomeBriefingService 계산과 독립) */
function getBriefingDueIngredientNames(limit = 2) {
  return getPantryItemsForUi()
    .filter((item) => {
      const days = ExpiryService.daysUntil(item.expiryDate);
      return days !== null && days <= CONFIG.EXPIRY_SOON_DAYS;
    })
    .map((item) => item.name)
    .filter(Boolean)
    .slice(0, limit);
}

function homeBriefingBudgetProgressHTML(used, budget) {
  const b = Math.max(0, Number(budget) || 0);
  const u = Math.max(0, Number(used) || 0);
  const pct = b > 0 ? Math.min(100, Math.round((u / b) * 100)) : 0;
  return `<span class="home-briefing__progress" aria-hidden="true"><span class="home-briefing__progress-bar" style="width:${pct}%"></span></span>`;
}

function homeBriefingCardHTML({
  action,
  tone,
  icon,
  title,
  num,
  unit,
  desc,
  empty,
  emptyText,
  over = false,
  accentNum = false,
  progressHtml = '',
}) {
  const emptyClass = empty ? ' home-briefing__card--empty' : '';
  const toneClass = tone ? ` home-briefing__card--${tone}` : '';
  const metricHtml = empty
    ? `<span class="home-briefing__empty-text">${esc(emptyText)}</span>`
    : `<span class="home-briefing__metric">
        <span class="home-briefing__value-num${over ? ' home-briefing__value-num--over' : ''}${accentNum ? ' home-briefing__value-num--accent' : ''}">${esc(String(num))}</span>
        ${unit ? `<span class="home-briefing__unit">${esc(unit)}</span>` : ''}
      </span>
      ${desc ? `<span class="home-briefing__desc">${esc(desc)}</span>` : ''}
      ${progressHtml || ''}`;

  return `
    <button type="button" class="home-briefing__card${toneClass}${emptyClass}" data-briefing-action="${esc(action)}" role="listitem">
      <span class="home-briefing__icon" aria-hidden="true">${icon}</span>
      <span class="home-briefing__title">${esc(title)}</span>
      ${metricHtml}
    </button>`;
}

function renderHomeBriefing() {
  const section = dom.homeBriefing || document.getElementById('home-briefing');
  const grid = dom.homeBriefingGrid || document.getElementById('home-briefing-grid');
  if (!section || !grid) {
    console.warn('[HomeBriefing] #home-briefing / #home-briefing-grid 없음');
    return;
  }

  section.hidden = false;
  HomeBriefingService.invalidate();

  let data;
  try {
    data = HomeBriefingService.get();
  } catch (err) {
    console.error('[HomeBriefing] 계산 실패:', err);
    grid.innerHTML = homeBriefingCardHTML({
      action: 'ready',
      tone: 'ready',
      icon: HOME_BRIEFING_ICONS.ready,
      title: '냉장고 브리핑',
      empty: true,
      emptyText: '브리핑을 불러오지 못했어요',
    });
    return;
  }

  const dueEmpty = data.dueCount <= 0;
  const readyEmpty = data.readyCount <= 0;
  const oneMissingEmpty = data.oneMissingCount <= 0;
  const budgetEmpty = !data.hasBudget;
  const dueNames = dueEmpty ? [] : getBriefingDueIngredientNames(2);
  const dueDesc = dueNames.length ? dueNames.join(', ') : '유통기한 임박';

  let budgetCard;
  if (budgetEmpty) {
    budgetCard = homeBriefingCardHTML({
      action: 'budget',
      tone: 'budget',
      icon: HOME_BRIEFING_ICONS.budget,
      title: '이번 주 식비',
      empty: true,
      emptyText: '예산을 설정해보세요',
    });
  } else {
    const remaining = Number(data.remaining) || 0;
    const over = remaining < 0;
    const usedFmt = formatBriefingBudget(data.used);
    const remainFmt = formatBriefingBudget(remaining);
    const remainLabel = over
      ? `${remainFmt.formatted}${remainFmt.unitWord} 초과`
      : `남은 예산 ${remainFmt.formatted}${remainFmt.unitWord}`;
    budgetCard = homeBriefingCardHTML({
      action: 'budget',
      tone: 'budget',
      icon: HOME_BRIEFING_ICONS.budget,
      title: '이번 주 식비',
      num: usedFmt.formatted,
      unit: usedFmt.unitWord,
      desc: remainLabel,
      over,
      progressHtml: homeBriefingBudgetProgressHTML(data.used, data.budget),
    });
  }

  grid.innerHTML = [
    homeBriefingCardHTML({
      action: 'due',
      tone: 'due',
      icon: HOME_BRIEFING_ICONS.due,
      title: '오늘 먹어야 하는 재료',
      num: data.dueCount,
      unit: '개',
      desc: dueDesc,
      empty: dueEmpty,
      emptyText: '버릴 재료가 없어요',
      accentNum: true,
    }),
    homeBriefingCardHTML({
      action: 'ready',
      tone: 'ready',
      icon: HOME_BRIEFING_ICONS.ready,
      title: '지금 바로 만들 수 있어요',
      num: data.readyCount,
      unit: '개',
      desc: '레시피 가능',
      empty: readyEmpty,
      emptyText: '재료를 추가해보세요',
    }),
    homeBriefingCardHTML({
      action: 'one-missing',
      tone: 'missing',
      icon: HOME_BRIEFING_ICONS.missing,
      title: '재료 1개만 더 있으면',
      num: data.oneMissingCount,
      unit: '개',
      desc: '레시피 가능',
      empty: oneMissingEmpty,
      emptyText: '거의 다 준비됐어요',
    }),
    budgetCard,
  ].join('');

  grid.querySelectorAll('[data-briefing-action]').forEach((btn) => {
    btn.onclick = () => {
      const action = btn.dataset.briefingAction;
      if (action === 'due') {
        applyHomeBriefingFilter('expiring');
        return;
      }
      if (action === 'ready') {
        applyHomeBriefingFilter('available');
        return;
      }
      if (action === 'one-missing') {
        applyHomeBriefingFilter('one-missing');
        return;
      }
      if (action === 'budget') {
        navigate('planner');
        requestAnimationFrame(() => {
          document.getElementById('grocery-budget-box')?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
      }
    };
  });
}


function bindHomeNaengtul(container, results) {
  container.querySelector('[data-scroll-home-recipes]')?.addEventListener('click', scrollToHomeRecipes);

  container.querySelectorAll('[data-hero-rid]').forEach((btn) => {
    const idx = Number.parseInt(btn.closest('[data-naengtul-index]')?.dataset.naengtulIndex ?? '0', 10);
    const result = results[idx];
    if (!result) return;
    btn.onclick = (e) => {
      e.stopPropagation();
      openRecipeDetail(result);
    };
  });

  const carousel = container.querySelector('.home-naengtul__carousel');
  const dots = [...container.querySelectorAll('[data-naengtul-dot]')];
  if (!carousel || dots.length < 2) return;

  const cards = [...carousel.querySelectorAll('[data-naengtul-index]')];
  const getPageWidth = () => carousel.clientWidth || 1;
  const getActiveIndex = () => Math.min(
    cards.length - 1,
    Math.max(0, Math.round(carousel.scrollLeft / getPageWidth())),
  );
  const updateDots = () => {
    const index = getActiveIndex();
    dots.forEach((dot, i) => {
      const active = i === index;
      dot.classList.toggle('home-naengtul__dot--active', active);
      dot.setAttribute('aria-selected', active ? 'true' : 'false');
    });
  };
  carousel.addEventListener('scroll', () => requestAnimationFrame(updateDots), { passive: true });
  dots.forEach((dot) => {
    dot.addEventListener('click', () => {
      const i = Number.parseInt(dot.dataset.naengtulDot, 10);
      carousel.scrollTo({ left: i * getPageWidth(), behavior: 'smooth' });
    });
  });
}

function getActiveHomeExploreChip() {
  if (state.homeSavedOnly) return 'saved';
  if (state.filters.size === 0) return 'recommend';
  if (state.filters.size === 1 && state.filters.has('available')) return 'available';
  if (state.filters.size === 1 && state.filters.has('one-missing')) return 'one-missing';
  return '';
}

function applyHomeExploreChip(chipId) {
  state.homeSavedOnly = false;
  state.filters.clear();
  if (chipId === 'saved') {
    state.homeSavedOnly = true;
  } else if (chipId === 'available' || chipId === 'one-missing') {
    state.filters.add(chipId);
  }
}

function renderHomeFilters() {
  if (!dom.homeFilterChips) return;
  const activeExplore = getActiveHomeExploreChip();
  const showExtra = Boolean(dom.homeFilterPanel && !dom.homeFilterPanel.hidden && dom.homeFilterPanel.dataset.extra === '1');
  const exploreHtml = HOME_EXPLORE_FILTERS.map((f) => `
    <button type="button" class="filter-chip${activeExplore === f.id ? ' filter-chip--active' : ''}" data-home-explore="${f.id}">${f.label}</button>
  `).join('');
  const extraHtml = showExtra
    ? FILTERS.filter((f) => !['available', 'one-missing'].includes(f.id)).map((f) => `
    <button type="button" class="filter-chip${state.filters.has(f.id) ? ' filter-chip--active' : ''}" data-home-f="${f.id}">${f.label}</button>
  `).join('')
    : '';
  dom.homeFilterChips.innerHTML = exploreHtml + extraHtml;

  dom.homeFilterChips.querySelectorAll('[data-home-explore]').forEach((chip) => {
    chip.onclick = () => {
      applyHomeExploreChip(chip.dataset.homeExplore);
      renderHomeFilters();
      renderHome();
    };
  });
  dom.homeFilterChips.querySelectorAll('[data-home-f]').forEach((chip) => {
    chip.onclick = () => {
      state.homeSavedOnly = false;
      if (state.filters.has(chip.dataset.homeF)) state.filters.delete(chip.dataset.homeF);
      else state.filters.add(chip.dataset.homeF);
      renderHomeFilters();
      renderHome();
    };
  });
}

function isHomeSearchInline() {
  return Boolean(dom.homeSearchDock?.classList.contains('home-search-dock--inline'));
}

function toggleHomeFilterPanel(force) {
  if (!dom.homeFilterPanel || !dom.homeFilterBtn) return;
  if (isHomeSearchInline()) {
    const open = typeof force === 'boolean' ? force : dom.homeFilterPanel.hidden;
    dom.homeFilterPanel.hidden = !open;
    dom.homeFilterPanel.dataset.extra = open ? '1' : '0';
    dom.homeSearchFloat?.classList.toggle('home-search-float--show-filters', open);
    document.body.classList.remove('home-search-filter-open', 'home-search-expanded');
    dom.homeFilterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (dom.homeSearchExpandArea) dom.homeSearchExpandArea.setAttribute('aria-hidden', open ? 'false' : 'true');
    renderHomeFilters();
    return;
  }
  const open = typeof force === 'boolean' ? force : dom.homeFilterPanel.hidden;
  if (open) expandHomeSearchDock();
  dom.homeFilterPanel.hidden = !open;
  dom.homeSearchFloat?.classList.toggle('home-search-float--show-filters', open);
  document.body.classList.toggle('home-search-filter-open', open);
  dom.homeFilterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  if (dom.homeSearchExpandArea) {
    dom.homeSearchExpandArea.setAttribute('aria-hidden', open ? 'false' : 'true');
  }
  if (!open) maybeCollapseHomeSearchDock();
}

let homeSearchDockExpanded = false;
let homeSearchBlurTimer = null;
let homeSearchRenderTimer = null;
let homeSearchKeyboardActive = false;
let homeSearchViewportHandler = null;

function shouldUseHomeSearchKeyboardMode() {
  return window.matchMedia('(hover: none) and (pointer: coarse), (max-width: 480px)').matches;
}

function getHomeSearchFloatGapPx() {
  const raw = getComputedStyle(document.documentElement).getPropertyValue('--home-search-float-gap').trim();
  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return 6;
  return raw.endsWith('rem') ? value * 16 : value;
}

function syncHomeSearchKeyboardPosition() {
  if (!homeSearchKeyboardActive) return;
  const gap = getHomeSearchFloatGapPx();
  const vv = window.visualViewport;
  if (!vv) {
    document.documentElement.style.setProperty('--home-search-keyboard-bottom', `${gap}px`);
    return;
  }
  const keyboardInset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--home-search-keyboard-bottom', `${keyboardInset + gap}px`);
}

function setHomeSearchKeyboardActive(active) {
  if (isHomeSearchInline()) active = false;
  if (!shouldUseHomeSearchKeyboardMode()) active = false;
  if (active) {
    homeSearchKeyboardActive = true;
    document.body.classList.add('home-search-keyboard-active');
    syncHomeSearchKeyboardPosition();
    if (!homeSearchViewportHandler && window.visualViewport) {
      homeSearchViewportHandler = () => syncHomeSearchKeyboardPosition();
      window.visualViewport.addEventListener('resize', homeSearchViewportHandler);
      window.visualViewport.addEventListener('scroll', homeSearchViewportHandler);
    }
    return;
  }
  homeSearchKeyboardActive = false;
  document.body.classList.remove('home-search-keyboard-active');
  document.documentElement.style.removeProperty('--home-search-keyboard-bottom');
  if (homeSearchViewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', homeSearchViewportHandler);
    window.visualViewport.removeEventListener('scroll', homeSearchViewportHandler);
    homeSearchViewportHandler = null;
  }
}

function endHomeSearchKeyboardMode() {
  setHomeSearchKeyboardActive(false);
}

function expandHomeSearchDock() {
  if (isHomeSearchInline()) {
    dom.homeSearchFloat?.classList.add('home-search-float--expanded', 'home-search-float--show-filters');
    return;
  }
  if (homeSearchDockExpanded) return;
  homeSearchDockExpanded = true;
  dom.homeSearchFloat?.classList.add('home-search-float--expanded');
  document.body.classList.add('home-search-expanded');
  if (state.filters.size > 0) toggleHomeFilterPanel(true);
}

function collapseHomeSearchDock() {
  if (isHomeSearchInline()) {
    dom.homeSearchFloat?.classList.add('home-search-float--expanded', 'home-search-float--show-filters');
    document.body.classList.remove('home-search-expanded', 'home-search-filter-open');
    return;
  }
  if (!homeSearchDockExpanded) return;
  homeSearchDockExpanded = false;
  dom.homeSearchFloat?.classList.remove('home-search-float--expanded', 'home-search-float--show-filters');
  document.body.classList.remove('home-search-expanded', 'home-search-filter-open');
  toggleHomeFilterPanel(false);
}

function maybeCollapseHomeSearchDock() {
  if (document.activeElement === dom.menuSearchInput) return;
  if (!dom.homeFilterPanel?.hidden) return;
  collapseHomeSearchDock();
}

function scheduleHomeSearchRender() {
  clearTimeout(homeSearchRenderTimer);
  homeSearchRenderTimer = setTimeout(() => renderHome(), 180);
}

function initHomeSearchDock() {
  if (!dom.menuSearchInput || !dom.homeSearchFloat) return;

  dom.menuSearchInput.addEventListener('focus', () => {
    clearTimeout(homeSearchBlurTimer);
    expandHomeSearchDock();
    setHomeSearchKeyboardActive(true);
  });

  dom.menuSearchInput.addEventListener('blur', () => {
    clearTimeout(homeSearchBlurTimer);
    homeSearchBlurTimer = setTimeout(() => {
      maybeCollapseHomeSearchDock();
      endHomeSearchKeyboardMode();
    }, 160);
  });

  dom.menuSearchInput.addEventListener('input', () => {
    state.menuSearch = dom.menuSearchInput.value;
    if (state.menuSearch.trim()) expandHomeSearchDock();
    scheduleHomeSearchRender();
    if (!state.menuSearch.trim() && dom.homeFilterPanel?.hidden) {
      maybeCollapseHomeSearchDock();
    }
  });

  dom.menuSearchInput.addEventListener('search', () => {
    if (!dom.menuSearchInput.value.trim()) {
      state.menuSearch = '';
      renderHome();
      maybeCollapseHomeSearchDock();
      endHomeSearchKeyboardMode();
    }
  });

  dom.menuSearchInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      dom.menuSearchInput.blur();
      maybeCollapseHomeSearchDock();
      endHomeSearchKeyboardMode();
    }
  });

  dom.homeFilterBtn?.addEventListener('mousedown', (e) => e.preventDefault());
  dom.homeFilterBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    expandHomeSearchDock();
    toggleHomeFilterPanel();
  });

  document.addEventListener('pointerdown', (e) => {
    if (state.view !== 'main' || !homeSearchDockExpanded) return;
    if (dom.homeSearchFloat?.contains(e.target)) return;
    dom.menuSearchInput?.blur();
    toggleHomeFilterPanel(false);
    collapseHomeSearchDock();
    endHomeSearchKeyboardMode();
  }, { passive: true });

  window.addEventListener('resize', () => {
    if (homeSearchKeyboardActive) syncHomeSearchKeyboardPosition();
  });
}

function renderHomeRecommendRail(homeRecipes) {
  const list = dom.homeRecommendList;
  const empty = dom.homeRecommendEmpty;
  if (!list) return;
  const names = RecommendationService.getPantryNames();
  if (!names.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  const railResults = RecommendationService.recommendHome(homeRecipes, {
    activeFilters: new Set(),
    query: '',
  }).slice(0, 4);
  if (!railResults.length) {
    list.innerHTML = '';
    if (empty) empty.hidden = false;
    return;
  }
  if (empty) empty.hidden = true;
  list.innerHTML = railResults.map((r) => homeRecipeCardHTML(r)).join('');
  bindRecipeCards(list, railResults);
}

function renderHome() {
  renderHomeFilters();
  renderHomeBriefing();
  const names = RecommendationService.getPantryNames();
  const query = state.menuSearch.trim();
  const hasSearchMode = Boolean(query || state.filters.size || state.homeSavedOnly);
  const homeRecipes = RecipeRepository.getHomeRecipes();

  dom.emptyState.hidden = names.length > 0 || hasSearchMode || homeRecipes.length > 0;
  dom.noResults.hidden = true;
  dom.recipeList.innerHTML = '';
  if (dom.homeTodayHero) {
    dom.homeTodayHero.hidden = true;
    dom.homeTodayHero.innerHTML = '';
  }

  renderHomeRecommendRail(homeRecipes);

  let results = RecommendationService.recommendHome(homeRecipes, { activeFilters: state.filters, query });
  if (state.homeSavedOnly) {
    results = results.filter((r) => SavedRecipeRepository.isSaved(r.recipe.id));
  }
  dom.noResults.hidden = results.length > 0;
  dom.resultsCount.textContent = results.length ? `${results.length}개` : '';

  dom.recipeList.innerHTML = results.map((r) => homeRecipeCardHTML(r)).join('');
  bindRecipeCards(dom.recipeList, results);
  updateHomeRecipesSubtitle();
  syncAuthGateUi();

  hydrateAuthorProfiles(results.map((r) => r.recipe)).then(() => {
    if (state.view !== 'main') return;
    const cards = dom.recipeList?.querySelectorAll('.recipe-card');
    if (!cards?.length) return;
    results.forEach((r, i) => {
      const card = cards[i];
      if (!card || !idEq(card.dataset.rid, r.recipe.id)) return;
      const meta = card.querySelector('.recipe-card-home__meta');
      if (!meta) return;
      let authorEl = card.querySelector('.recipe-card-author');
      const html = recipeAuthorRowHTML(r.recipe);
      if (!html) {
        authorEl?.remove();
        return;
      }
      if (authorEl) {
        authorEl.outerHTML = html;
      } else {
        meta.insertAdjacentHTML('afterend', html);
      }
      card.querySelector('.recipe-card-author[data-author-id]')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openAuthorProfile(e.currentTarget.dataset.authorId);
      });
    });
  });
}

// ===== Render: My Recipes =====
const MY_RECIPES_SORT_OPTIONS = [
  { id: 'newest', label: '최신순' },
  { id: 'oldest', label: '오래된순' },
  { id: 'match', label: '재료 일치율 높은순' },
  { id: 'cookTime', label: '조리시간 짧은순' },
  { id: 'name', label: '이름순' },
];

function buildMyPageRecipeResult(recipe) {
  const names = RecommendationService.getPantryNames();
  const a = MatchService.analyze(names, recipe.ingredients || []);
  return {
    recipe,
    matchPercent: a.matchPercent,
    missing: a.missing || [],
    matched: a.matched || [],
    matchedPantryNames: a.matchedPantryNames || [],
    exact: a.exact || [],
    substituted: a.substituted || [],
    expiryBoost: RecommendationService.getExpiryBoost(a.matchedPantryNames || []),
  };
}

function getSavedRecipeOrderIndex(recipeId) {
  const ids = SavedRecipeRepository._ids || [];
  const idx = ids.findIndex((id) => idEq(id, recipeId));
  return idx >= 0 ? idx : -1;
}

function getMyRecipeCreatedAtValue(recipe) {
  return String(recipe?.createdAt || recipe?.updatedAt || '');
}

function sortMyPageRecipeResults(results, sortId, section) {
  const list = [...(results || [])];
  list.sort((a, b) => {
    if (sortId === 'newest' || sortId === 'oldest') {
      const dir = sortId === 'newest' ? -1 : 1;
      if (section === 'saved') {
        return dir * (getSavedRecipeOrderIndex(a.recipe.id) - getSavedRecipeOrderIndex(b.recipe.id));
      }
      const dateA = getMyRecipeCreatedAtValue(a.recipe);
      const dateB = getMyRecipeCreatedAtValue(b.recipe);
      if (dateA !== dateB) return dir * dateA.localeCompare(dateB);
      return String(a.recipe.name || '').localeCompare(String(b.recipe.name || ''), 'ko');
    }
    if (sortId === 'match') {
      const diff = (Number(b.matchPercent) || 0) - (Number(a.matchPercent) || 0);
      if (diff !== 0) return diff;
      return String(a.recipe.name || '').localeCompare(String(b.recipe.name || ''), 'ko');
    }
    if (sortId === 'cookTime') {
      const timeA = Number(a.recipe.cookTime);
      const timeB = Number(b.recipe.cookTime);
      const normA = Number.isFinite(timeA) ? timeA : 9999;
      const normB = Number.isFinite(timeB) ? timeB : 9999;
      if (normA !== normB) return normA - normB;
      return String(a.recipe.name || '').localeCompare(String(b.recipe.name || ''), 'ko');
    }
    if (sortId === 'name') {
      return String(a.recipe.name || '').localeCompare(String(b.recipe.name || ''), 'ko');
    }
    return 0;
  });
  return list;
}

function setMyRecipesSectionCount(el, count) {
  if (!el) return;
  el.textContent = `${count}개`;
}

function setMyRecipesEmptyState(emptyEl, { title, hint, hidden }) {
  if (!emptyEl) return;
  emptyEl.hidden = hidden;
  const titleEl = emptyEl.querySelector('.empty-state__text');
  const hintEl = emptyEl.querySelector('.empty-state__hint');
  if (titleEl && title != null) titleEl.textContent = title;
  if (hintEl) {
    if (hint) {
      hintEl.hidden = false;
      hintEl.textContent = hint;
    } else {
      hintEl.hidden = true;
      hintEl.textContent = '';
    }
  }
}

function closeMyRecipesSortSheet() {
  if (!dom.myRecipesSortSheet || dom.myRecipesSortSheet.hidden) {
    state.myRecipesSortSheetSection = null;
    return;
  }
  dom.myRecipesSortSheet.hidden = true;
  dom.myRecipesSortSheet.setAttribute('aria-hidden', 'true');
  state.myRecipesSortSheetSection = null;
  updateBodyScrollLock();
}

function renderMyRecipesSortOptions() {
  if (!dom.myRecipesSortOptions) return;
  const section = state.myRecipesSortSheetSection;
  const current = section === 'saved' ? state.myRecipesSort.saved : state.myRecipesSort.mine;
  if (dom.myRecipesSortSheetTitle) {
    dom.myRecipesSortSheetTitle.textContent = section === 'saved' ? '저장한 레시피 정렬' : '내 레시피 정렬';
  }
  dom.myRecipesSortOptions.innerHTML = MY_RECIPES_SORT_OPTIONS.map((opt) => {
    const selected = opt.id === current;
    return `
      <button type="button" class="my-recipes-sort-option${selected ? ' my-recipes-sort-option--selected' : ''}"
        role="option" aria-selected="${selected ? 'true' : 'false'}" data-sort-id="${esc(opt.id)}">
        <span class="my-recipes-sort-option__label">${esc(opt.label)}</span>
        <span class="my-recipes-sort-option__check" aria-hidden="true">${selected ? '✓' : ''}</span>
      </button>`;
  }).join('');
  dom.myRecipesSortOptions.querySelectorAll('[data-sort-id]').forEach((btn) => {
    btn.onclick = () => {
      const sortId = btn.dataset.sortId;
      if (!section || !MY_RECIPES_SORT_OPTIONS.some((o) => o.id === sortId)) return;
      if (section === 'saved') state.myRecipesSort.saved = sortId;
      else state.myRecipesSort.mine = sortId;
      closeMyRecipesSortSheet();
      renderMyRecipes();
    };
  });
}

function openMyRecipesSortSheet(section) {
  if (!dom.myRecipesSortSheet || (section !== 'mine' && section !== 'saved')) return;
  state.myRecipesSortSheetSection = section;
  renderMyRecipesSortOptions();
  dom.myRecipesSortSheet.querySelector('.planner-sheet')?.classList.remove('planner-sheet--closing');
  dom.myRecipesSortSheet.hidden = false;
  dom.myRecipesSortSheet.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  updateBodyScrollLock();
}

function initMyRecipesSortUi() {
  document.querySelectorAll('.my-recipes-sort-btn[data-sort-section]').forEach((btn) => {
    btn.onclick = () => openMyRecipesSortSheet(btn.dataset.sortSection);
  });
  document.querySelectorAll('[data-close-modal="my-recipes-sort"]').forEach((el) => {
    el.onclick = () => closeMyRecipesSortSheet();
  });
}

function renderMyRecipes() {
  const guest = isGuestUser();
  if (dom.myRecipesGuestHint) dom.myRecipesGuestHint.hidden = !guest;

  if (guest) {
    setMyRecipesSectionCount(dom.myRecipesCount, 0);
    setMyRecipesSectionCount(dom.savedCount, 0);
    if (dom.myRecipesList) dom.myRecipesList.innerHTML = '';
    if (dom.savedList) dom.savedList.innerHTML = '';
    setMyRecipesEmptyState(dom.myRecipesEmpty, {
      title: '로그인하면 내 레시피를 확인할 수 있어요.',
      hint: '',
      hidden: false,
    });
    setMyRecipesEmptyState(dom.savedEmpty, {
      title: '로그인하면 즐겨찾기한 레시피를 확인할 수 있어요.',
      hint: '',
      hidden: false,
    });
    syncAuthGateUi();
    return;
  }

  const recipes = RecipeRepository.getUserRecipes();
  const myResults = sortMyPageRecipeResults(
    recipes.map(buildMyPageRecipeResult),
    state.myRecipesSort.mine,
    'mine',
  );
  setMyRecipesSectionCount(dom.myRecipesCount, myResults.length);
  setMyRecipesEmptyState(dom.myRecipesEmpty, {
    title: '아직 직접 만든 레시피가 없어요',
    hint: '직접 입력으로 나만의 레시피를 추가해보세요',
    hidden: myResults.length > 0,
  });
  if (dom.myRecipesList) {
    dom.myRecipesList.innerHTML = myResults.map((r) => homeRecipeCardHTML(r, {
      action: 'none',
      showVisibility: true,
      showRecommendTags: true,
      variant: 'my',
    })).join('');
    bindRecipeCards(dom.myRecipesList, myResults);
    dom.myRecipesList.querySelectorAll('.recipe-card').forEach((card) => {
      card.addEventListener('contextmenu', (e) => e.preventDefault());
    });
  }

  const saved = SavedRecipeRepository.getRecipes();
  const savedResults = sortMyPageRecipeResults(
    saved.map(buildMyPageRecipeResult),
    state.myRecipesSort.saved,
    'saved',
  );
  setMyRecipesSectionCount(dom.savedCount, savedResults.length);
  setMyRecipesEmptyState(dom.savedEmpty, {
    title: '아직 저장한 레시피가 없어요',
    hint: '마음에 드는 레시피를 저장해보세요',
    hidden: savedResults.length > 0,
  });
  if (dom.savedList) {
    dom.savedList.innerHTML = savedResults.map((r) => homeRecipeCardHTML(r, {
      action: 'save',
      showVisibility: false,
      readyHtml: '바로 가능',
      showRecommendTags: true,
    })).join('');
    bindRecipeCards(dom.savedList, savedResults);
  }
  syncAuthGateUi();
}

// ===== Render: Pantry Manage =====
function renderPantryManage() {
  const emptyTextEl = dom.pantryEmpty.querySelector('.empty-state__text');
  if (emptyTextEl) emptyTextEl.textContent = '등록된 재료가 없습니다';
  const items = [...getPantryItemsForUi()].sort((a, b) => {
    const o = { expired: 0, soon: 1, ok: 2, none: 3 };
    return o[ExpiryService.status(a.expiryDate)] - o[ExpiryService.status(b.expiryDate)];
  });
  dom.pantryCount.textContent = items.length ? `${items.length}개` : '';
  dom.pantryEmpty.hidden = items.length > 0;
  dom.pantryList.innerHTML = items.map((item) => {
    const st = ExpiryService.status(item.expiryDate);
    const lbl = ExpiryService.label(item.expiryDate);
    const qty = [item.quantity, item.unit].filter(Boolean).join(' ');
    const statusClass = st !== 'none' && st !== 'ok' ? st : 'normal';
    return `
      <article class="pantry-card pantry-card--${statusClass}" role="listitem">
        <div class="pantry-card__body">
          <p class="pantry-card__name">${esc(item.name)}</p>
          <p class="pantry-card__detail">${qty ? esc(qty) : '수량 미입력'}</p>
          ${item.expiryDate ? `<p class="pantry-card__expiry">${esc(item.expiryDate)}</p>` : ''}
          ${item.recipeName ? `<p class="pantry-card__recipe">📖 ${esc(item.recipeName)}</p>` : ''}
          ${lbl ? `<span class="pantry-card__badge pantry-card__badge--${st}">${st === 'expired' ? '만료' : '임박'} · ${esc(lbl)}</span>` : ''}
        </div>
        <div class="pantry-card__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-edit="${esc(item.id)}">수정</button>
          <button type="button" class="btn btn--danger btn--sm" data-del="${esc(item.id)}">삭제</button>
        </div>
      </article>`;
  }).join('');
  dom.pantryList.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openPantryModal(b.dataset.edit); });
  dom.pantryList.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      const item = getPantryItemsForUi().find((x) => x.id === b.dataset.del);
      if (confirm(`"${item?.name || '재료'}" 삭제할까요?`)) {
        removePantryItem(b.dataset.del).catch((err) => handlePantryFirestoreError(err));
      }
    };
  });
}

// ===== Render: Calendar =====
function getCalendarMonthExpenseEntries(year, month) {
  const monthLogs = MealLogRepository.getByMonth(year, month);
  const shoppingRecords = ShoppingRecordRepository.getByMonth(year, month);
  const entries = [];

  shoppingRecords.forEach((record) => {
    const normalized = normalizeShoppingRecord(record);
    const amount = Number(normalized.amount) || 0;
    if (amount <= 0) return;
    const items = getShoppingRecordItems(normalized);
    const title = items.length
      ? items.map((item) => formatIngredientDisplay(item)).join(', ')
      : '장보기';
    entries.push({
      id: normalized.id,
      date: normalized.date,
      kind: 'shopping',
      category: 'shopping',
      emoji: '🛒',
      title,
      subtitle: normalized.store || '',
      amount,
      currency: normalized.currency || DEFAULT_CURRENCY,
    });
  });

  monthLogs.forEach((log) => {
    const type = normalizeMealType(log.mealType);
    const amount = Number(log.cost) || 0;
    if (type === 'home-cook' || amount <= 0) return;
    const info = mealTypeInfo(type);
    entries.push({
      id: log.id,
      date: log.date,
      kind: 'meal',
      category: type,
      emoji: info.emoji,
      title: log.name,
      subtitle: log.memo || '',
      amount,
      currency: log.currency || DEFAULT_CURRENCY,
    });
  });

  return entries.sort((a, b) => {
    const dateCmp = b.date.localeCompare(a.date);
    if (dateCmp !== 0) return dateCmp;
    return String(b.id || '').localeCompare(String(a.id || ''));
  });
}

function getCalendarMonthExpenseBreakdown(entries) {
  const breakdown = [
    { key: 'shopping', label: '장보기', emoji: '🛒', totals: {} },
    { key: 'eat-out', label: '외식', emoji: '🍽️', totals: {} },
    { key: 'delivery', label: '배달', emoji: '🛵', totals: {} },
    { key: 'snack', label: '간식', emoji: '🍪', totals: {} },
  ];
  const map = Object.fromEntries(breakdown.map((item) => [item.key, item]));
  entries.forEach((entry) => {
    const bucket = map[entry.category];
    if (!bucket) return;
    bucket.totals[entry.currency] = (bucket.totals[entry.currency] || 0) + entry.amount;
  });
  return breakdown.filter((item) => Object.values(item.totals).some((amount) => amount > 0));
}

function groupExpenseEntriesByDate(entries) {
  const groups = new Map();
  entries.forEach((entry) => {
    if (!groups.has(entry.date)) groups.set(entry.date, []);
    groups.get(entry.date).push(entry);
  });
  return [...groups.entries()].sort((a, b) => b[0].localeCompare(a[0]));
}

function renderCalendarExpenseSheet() {
  const year = state.calendarYear;
  const month = state.calendarMonth + 1;
  if (dom.calendarExpenseSheetTitle) {
    dom.calendarExpenseSheetTitle.textContent = `${month}월 지출 내역`;
  }

  if (isGuestUser()) {
    if (dom.calendarExpenseSummary) dom.calendarExpenseSummary.innerHTML = '';
    if (dom.calendarExpenseList) dom.calendarExpenseList.innerHTML = '';
    if (dom.calendarExpenseEmpty) {
      dom.calendarExpenseEmpty.hidden = false;
      const emptyText = dom.calendarExpenseEmpty.querySelector('.empty-state__text');
      if (emptyText) emptyText.textContent = '로그인하면 이번 달 지출 내역을 확인할 수 있어요.';
    }
    return;
  }

  const stats = getCalendarMonthStats(year, month);
  const entries = getCalendarMonthExpenseEntries(year, month);
  const breakdown = getCalendarMonthExpenseBreakdown(entries);
  const filter = state.calendarExpenseFilter || 'all';
  const filteredEntries = filter === 'all'
    ? entries
    : entries.filter((entry) => entry.category === filter);
  const grouped = groupExpenseEntriesByDate(filteredEntries);

  if (dom.calendarExpenseSummary) {
    const chips = breakdown.map((item) => `
      <button type="button" class="calendar-expense-chip${filter === item.key ? ' calendar-expense-chip--active' : ''}" data-expense-filter="${esc(item.key)}">
        <span class="calendar-expense-chip__label">${item.emoji} ${esc(item.label)}</span>
        <strong class="calendar-expense-chip__amount">${esc(formatMoneyTotalsByCurrency(item.totals))}</strong>
      </button>`).join('');
    const allChip = `<button type="button" class="calendar-expense-chip${filter === 'all' ? ' calendar-expense-chip--active' : ''}" data-expense-filter="all">
      <span class="calendar-expense-chip__label">전체</span>
      <strong class="calendar-expense-chip__amount">${esc(stats.totalFoodCost)}</strong>
    </button>`;
    dom.calendarExpenseSummary.innerHTML = `
      <div class="calendar-expense-total">
        <p class="calendar-expense-total__label">이번 달 총 지출</p>
        <p class="calendar-expense-total__amount">${esc(stats.totalFoodCost)}</p>
      </div>
      ${(chips || allChip) ? `<div class="calendar-expense-chips">${allChip}${chips}</div>` : ''}`;
    dom.calendarExpenseSummary.querySelectorAll('[data-expense-filter]').forEach((btn) => {
      btn.onclick = () => {
        const next = btn.dataset.expenseFilter || 'all';
        if (state.calendarExpenseFilter === next) return;
        state.calendarExpenseFilter = next;
        renderCalendarExpenseSheet();
      };
    });
  }

  if (!filteredEntries.length) {
    if (dom.calendarExpenseList) dom.calendarExpenseList.innerHTML = '';
    if (dom.calendarExpenseEmpty) {
      dom.calendarExpenseEmpty.hidden = false;
      const emptyText = dom.calendarExpenseEmpty.querySelector('.empty-state__text');
      if (emptyText) {
        emptyText.textContent = filter === 'all'
          ? '이번 달 기록된 지출이 없어요'
          : '선택한 항목의 지출이 없어요';
      }
    }
    return;
  }

  if (dom.calendarExpenseEmpty) dom.calendarExpenseEmpty.hidden = true;
  if (dom.calendarExpenseList) {
    dom.calendarExpenseList.innerHTML = grouped.map(([date, dayEntries]) => `
      <section class="calendar-expense-day">
        <h4 class="calendar-expense-day__title">${esc(formatDateLabel(date))}</h4>
        <ul class="calendar-expense-day__list">
          ${dayEntries.map((entry) => {
            const categoryLabel = entry.kind === 'shopping'
              ? '장보기'
              : mealTypeInfo(entry.category).label;
            const meta = [categoryLabel, entry.subtitle].filter(Boolean).join(' · ');
            return `
            <li class="calendar-expense-item">
              <span class="calendar-expense-item__emoji" aria-hidden="true">${entry.emoji}</span>
              <div class="calendar-expense-item__text">
                <p class="calendar-expense-item__title">${esc(entry.title)}</p>
                ${meta ? `<p class="calendar-expense-item__meta">${esc(meta)}</p>` : ''}
              </div>
              <span class="calendar-expense-item__amount">${esc(formatMoney(entry.amount, entry.currency))}</span>
            </li>`;
          }).join('')}
        </ul>
      </section>`).join('');
  }
}

function closeCalendarExpenseSheet() {
  if (!dom.calendarExpenseSheet) return;
  dom.calendarExpenseSheet.hidden = true;
  dom.calendarExpenseSheet.setAttribute('aria-hidden', 'true');
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

function openCalendarExpenseSheet() {
  if (!dom.calendarExpenseSheet) return;
  state.calendarExpenseFilter = 'all';
  renderCalendarExpenseSheet();
  dom.calendarExpenseSheet.hidden = false;
  dom.calendarExpenseSheet.setAttribute('aria-hidden', 'false');
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

function getCalendarMonthStats(year, month) {
  const monthLogs = MealLogRepository.getByMonth(year, month);
  const shoppingRecords = ShoppingRecordRepository.getByMonth(year, month);
  const counts = { 'home-cook': 0, 'eat-out': 0, delivery: 0 };
  const costs = { 'eat-out': {}, delivery: {}, snack: {} };
  const combinedTotals = {};

  monthLogs.forEach((log) => {
    const type = normalizeMealType(log.mealType);
    if (type in counts) counts[type] += 1;
    if (type in costs) {
      const code = log.currency || DEFAULT_CURRENCY;
      costs[type][code] = (costs[type][code] || 0) + (Number(log.cost) || 0);
    }
  });

  const shoppingTotals = sumAmountsByCurrency(shoppingRecords, (r) => r.amount, (r) => r.currency);
  Object.entries(shoppingTotals).forEach(([code, amount]) => {
    combinedTotals[code] = (combinedTotals[code] || 0) + amount;
  });
  ['eat-out', 'delivery', 'snack'].forEach((type) => {
    Object.entries(costs[type]).forEach(([code, amount]) => {
      combinedTotals[code] = (combinedTotals[code] || 0) + amount;
    });
  });

  const primaryCode = state.currency || DEFAULT_CURRENCY;
  const primaryTotal = combinedTotals[primaryCode] || 0;

  return {
    counts,
    totalFoodCost: formatMoneyTotalsByCurrency(combinedTotals),
    primaryTotal,
    primaryCode,
  };
}

function getCalendarDayIcons(meals, shoppingRecords) {
  const order = ['eat-out', 'delivery', 'snack', 'shopping'];
  const iconByKey = {
    'eat-out': mealTypeInfo('eat-out').emoji,
    delivery: mealTypeInfo('delivery').emoji,
    snack: mealTypeInfo('snack').emoji,
    shopping: '🛒',
  };
  const present = new Set();
  meals.forEach((log) => {
    if (isHomeCookMealType(log.mealType)) return;
    const type = normalizeMealType(log.mealType);
    if (iconByKey[type]) present.add(type);
  });
  if (shoppingRecords.length) present.add('shopping');
  return order.filter((key) => present.has(key)).map((key) => iconByKey[key]);
}

function buildCalendarDayEntriesHTML(meals, shoppingRecords) {
  const homeCooks = meals.filter((log) => isHomeCookMealType(log.mealType));
  const icons = getCalendarDayIcons(meals, shoppingRecords);
  const parts = [];
  const emoji = mealTypeInfo('home-cook').emoji;
  const shown = homeCooks.slice(0, 2);
  const moreCount = Math.max(0, homeCooks.length - 2);

  shown.forEach((log) => {
    const name = log.name || '직접 요리';
    parts.push(
      `<span class="calendar-day__dish">${emoji} <span class="calendar-day__dish-name">${esc(name)}</span></span>`,
    );
  });

  const metaParts = [];
  if (moreCount > 0) {
    metaParts.push(`<span class="calendar-day__more">+${moreCount}</span>`);
  }
  if (icons.length) {
    metaParts.push(`<span class="calendar-day__icons" aria-hidden="true">${icons.join('')}</span>`);
  }
  if (metaParts.length) {
    parts.push(`<span class="calendar-day__meta">${metaParts.join('')}</span>`);
  }

  if (!parts.length) return '';
  return `<div class="calendar-day__entries">${parts.join('')}</div>`;
}

function buildBudgetProgressHTML(primaryTotal, budget, currencyCode) {
  if (budget <= 0) return '';
  const ratio = primaryTotal / budget;
  const displayPct = Math.round(ratio * 100);
  const barPct = Math.min(100, displayPct);
  const isOver = primaryTotal > budget;
  let barClass = '';
  if (isOver) barClass = ' calendar-spend-card__progress-bar--over';
  else if (ratio >= 0.9) barClass = ' calendar-spend-card__progress-bar--warn';

  return `
    <div class="calendar-spend-card__progress">
      <div class="calendar-spend-card__progress-track" aria-hidden="true">
        <span class="calendar-spend-card__progress-bar${barClass}" style="width:${barPct}%"></span>
        <span class="calendar-spend-card__progress-label">${displayPct}%</span>
      </div>
    </div>`;
}

function buildBudgetFooterHTML(primaryTotal, budget, currencyCode) {
  const budgetValue = Number(budget) || 0;
  let badgeHTML = '<span class="calendar-spend-card__footer-spacer" aria-hidden="true"></span>';
  if (budgetValue > 0) {
    const isOver = primaryTotal > budgetValue;
    const deltaAmount = isOver
      ? formatMoney(primaryTotal - budgetValue, currencyCode)
      : formatMoney(budgetValue - primaryTotal, currencyCode);
    const deltaLabel = isOver ? `초과 금액 ${deltaAmount}` : `남은 예산 ${deltaAmount}`;
    const deltaClass = isOver
      ? 'calendar-spend-card__delta-text--over'
      : 'calendar-spend-card__delta-text--remain';
    badgeHTML = `<span class="calendar-spend-card__delta-text ${deltaClass}">${esc(deltaLabel)}</span>`;
  }

  return `
    <div class="calendar-spend-card__footer">
      ${badgeHTML}
      <div class="calendar-spend-card__budget-field">
        <label for="monthly-food-budget" class="calendar-spend-card__budget-label">월 예산</label>
        <input type="number" id="monthly-food-budget" class="calendar-spend-card__budget-input"
          min="0" step="${esc(currencyAmountInputStep(currencyCode))}" inputmode="${CURRENCY_OPTIONS[currencyCode]?.fractionDigits > 0 ? 'decimal' : 'numeric'}"
          placeholder="${esc(currencyAmountPlaceholder('monthly', currencyCode))}"
          value="${budgetValue > 0 ? esc(String(budgetValue)) : ''}" aria-label="이번 달 식비 예산">
      </div>
    </div>`;
}

function renderMealStats() {
  const year = state.calendarYear;
  const month = state.calendarMonth + 1;
  const { counts, primaryTotal, primaryCode } = getCalendarMonthStats(year, month);
  const budget = Number(state.monthlyFoodBudget) || 0;
  const progressHTML = buildBudgetProgressHTML(primaryTotal, budget, primaryCode);
  const footerHTML = buildBudgetFooterHTML(primaryTotal, budget, primaryCode);

  dom.mealStats.innerHTML = `
    <div class="calendar-summary__spend calendar-spend-card">
      <button type="button" class="calendar-spend-card__trigger" data-open-calendar-expense aria-label="이번 달 지출 내역 보기">
        <div class="calendar-spend-card__head">
          <span class="calendar-spend-card__label">💰 이번 달 식비</span>
          <span class="calendar-spend-card__hint">내역 보기</span>
        </div>
        <p class="calendar-spend-card__amount">${esc(formatMoney(primaryTotal, primaryCode))}</p>
        ${progressHTML}
      </button>
      ${footerHTML}
    </div>
    <div class="calendar-summary__counts calendar-counts">
      <span class="calendar-counts__item">🍳 직접요리 <strong>${counts['home-cook']}회</strong></span>
      <span class="calendar-counts__item">🍽 외식 <strong>${counts['eat-out']}회</strong></span>
      <span class="calendar-counts__item">🛵 배달 <strong>${counts.delivery}회</strong></span>
    </div>`;

  dom.monthlyFoodBudget = $('#monthly-food-budget');
  dom.mealStats.querySelector('[data-open-calendar-expense]')?.addEventListener('click', () => {
    if (isGuestUser()) {
      requireAppLogin(() => openCalendarExpenseSheet());
      return;
    }
    openCalendarExpenseSheet();
  });
  if (dom.monthlyFoodBudget) {
    dom.monthlyFoodBudget.onchange = () => {
      state.monthlyFoodBudget = Number(dom.monthlyFoodBudget.value) || 0;
      if (isGuestUser()) {
        renderMealStats();
        return;
      }
      persistMonthlyFoodBudget().catch(() => undefined);
      renderMealStats();
    };
  }
}

function formatCalendarMealLine(log) {
  const info = mealTypeInfo(log.mealType);
  const photoMark = log.photo ? ' 📷' : '';
  const cost = log.cost ? ` ${formatMoney(log.cost, log.currency || DEFAULT_CURRENCY)}` : '';
  return `${info.emoji} ${log.name}${cost}${photoMark}`;
}

function formatCalendarShoppingLine(record) {
  const normalized = normalizeShoppingRecord(record);
  const labels = getShoppingRecordItems(normalized).map((item) => formatIngredientDisplay(item));
  const label = labels.length ? labels.join(', ') : '장보기';
  return `🛒 ${label} ${formatMoney(normalized.amount, normalized.currency || DEFAULT_CURRENCY)}`;
}

function renderCalendar() {
  const guest = isGuestUser();
  if (dom.calendarGuestHint) dom.calendarGuestHint.hidden = !guest;

  const year = state.calendarYear;
  const month = state.calendarMonth;
  dom.calendarLabel.textContent = `${year}년 ${month + 1}월`;

  const weekdays = ['일', '월', '화', '수', '목', '금', '토'];
  dom.calendarWeekdays.innerHTML = weekdays.map((d) => `<div class="calendar-weekday">${d}</div>`).join('');

  const firstDay = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prefix = `${year}-${String(month + 1).padStart(2, '0')}`;
  const logsByDate = {};
  MealLogRepository.getByMonth(year, month + 1).forEach((log) => {
    if (!logsByDate[log.date]) logsByDate[log.date] = [];
    logsByDate[log.date].push(log);
  });
  const shoppingByDate = {};
  ShoppingRecordRepository.getByMonth(year, month + 1).forEach((record) => {
    if (!shoppingByDate[record.date]) shoppingByDate[record.date] = [];
    shoppingByDate[record.date].push(record);
  });

  const today = todayStr();
  let html = '';
  for (let i = 0; i < firstDay; i++) html += '<div class="calendar-day calendar-day--empty"></div>';

  for (let d = 1; d <= daysInMonth; d++) {
    const dateStr = `${prefix}-${String(d).padStart(2, '0')}`;
    const meals = logsByDate[dateStr] || [];
    const shopping = shoppingByDate[dateStr] || [];
    const entriesHTML = buildCalendarDayEntriesHTML(meals, shopping);
    const hasEntries = Boolean(entriesHTML);
    const classes = ['calendar-day'];
    if (dateStr === today) classes.push('calendar-day--today');
    if (dateStr === state.selectedCalendarDate) classes.push('calendar-day--selected');
    if (hasEntries) classes.push('calendar-day--has-meals');
    const recordCount = meals.length + shopping.length;
    html += `
      <button type="button" class="${classes.join(' ')}" data-date="${dateStr}" aria-label="${d}일${recordCount ? `, 기록 ${recordCount}건` : ''}">
        <span class="calendar-day__num">${d}</span>
        ${entriesHTML}
      </button>`;
  }

  dom.calendarDays.innerHTML = html;
  dom.calendarDays.querySelectorAll('.calendar-day:not(.calendar-day--empty)').forEach((btn) => {
    btn.onclick = () => selectCalendarDate(btn.dataset.date);
  });

  renderMealStats();
  if (state.selectedCalendarDate && dom.calendarDaySheet && !dom.calendarDaySheet.hidden) {
    renderCalendarDayDetail(state.selectedCalendarDate);
  }
  if (dom.calendarExpenseSheet && !dom.calendarExpenseSheet.hidden) {
    renderCalendarExpenseSheet();
  }
}

function renderDayRecordActions(editAttr, delAttr) {
  return `
    <div class="day-record-row__aside">
      <div class="day-record-row__actions">
        <button type="button" class="day-record-row__link" ${editAttr}>수정</button>
        <span class="day-record-row__sep" aria-hidden="true">·</span>
        <button type="button" class="day-record-row__link day-record-row__link--danger" ${delAttr}>삭제</button>
      </div>
    </div>`;
}

function renderCalendarMealRecordRow(log) {
  const info = mealTypeInfo(log.mealType);
  const amount = Number(log.cost) > 0
    ? `<span class="day-record-row__amount">${esc(formatMoney(log.cost, log.currency || DEFAULT_CURRENCY))}</span>`
    : '';
  const icon = log.photo
    ? `<img class="day-record-row__thumb" src="${log.photo}" alt="">`
    : `<span class="day-record-row__icon" aria-hidden="true">${info.emoji}</span>`;
  const memo = log.memo ? `<p class="day-record-row__sub">${esc(log.memo)}</p>` : '';
  return `
    <li class="day-record-row" data-meal-id="${esc(log.id)}">
      <button type="button" class="day-record-row__main day-record-row__tap" data-view-meal="${esc(log.id)}">
        ${icon}
        <div class="day-record-row__content">
          <div class="day-record-row__top">
            <span class="day-record-row__title">${esc(log.name)}</span>
            ${amount}
          </div>
          <p class="day-record-row__sub">${esc(info.label)}</p>
          ${memo}
        </div>
      </button>
      ${renderDayRecordActions(`data-edit-meal="${esc(log.id)}"`, `data-del-meal="${esc(log.id)}"`)}
    </li>`;
}

function renderCalendarShoppingRecordRow(record) {
  const normalized = normalizeShoppingRecord(record);
  const items = getShoppingRecordItems(normalized);
  const itemLabels = items.map((item) => formatIngredientDisplay(item));
  const title = itemLabels.length ? itemLabels.join(', ') : '장보기';
  const ingredientLine = itemLabels.length
    ? `<p class="day-record-row__sub">🥬 ${esc(itemLabels.join(', '))}</p>` : '';
  const recipeLine = normalized.recipeName
    ? `<p class="day-record-row__sub">📖 ${esc(normalized.recipeName)}</p>` : '';
  const pantryMeta = items.length && !isShoppingIngredientsAdded(normalized)
    ? `<button type="button" class="day-record-row__pill" data-add-pantry-shopping="${esc(normalized.id)}">+ 보유 재료에 추가</button>`
    : items.length && isShoppingIngredientsAdded(normalized)
      ? '<span class="day-record-row__badge day-record-row__badge--done">✓ 보유 재료 반영됨</span>'
      : '';
  return `
    <li class="day-record-row day-record-row--shopping" data-shopping-id="${esc(normalized.id)}">
      <div class="day-record-row__main">
        <span class="day-record-row__icon" aria-hidden="true">🛒</span>
        <div class="day-record-row__content">
          <div class="day-record-row__top">
            <span class="day-record-row__title">${esc(title)}</span>
            <span class="day-record-row__amount">${esc(formatMoney(normalized.amount, normalized.currency || DEFAULT_CURRENCY))}</span>
          </div>
          <p class="day-record-row__sub">${esc(normalized.store || '마트명 없음')}</p>
          ${ingredientLine}
          ${recipeLine}
          ${pantryMeta ? `<div class="day-record-row__meta">${pantryMeta}</div>` : ''}
        </div>
      </div>
      ${renderDayRecordActions(`data-edit-shopping="${esc(normalized.id)}"`, `data-del-shopping="${esc(normalized.id)}"`)}
    </li>`;
}

function finishCloseCalendarDaySheet() {
  if (!dom.calendarDaySheet) return;
  const panel = dom.calendarDaySheet.querySelector('.calendar-day-sheet');
  if (panel) {
    panel.style.transform = '';
    panel.classList.remove('calendar-day-sheet--closing');
  }
  dom.calendarDaySheet.hidden = true;
  dom.calendarDaySheet.setAttribute('aria-hidden', 'true');
  if (state.calendarModalType === 'recordList') {
    state.calendarModalType = null;
  }
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

function closeCalendarDaySheet({ immediate = false } = {}) {
  if (!dom.calendarDaySheet || dom.calendarDaySheet.hidden) return;
  const panel = dom.calendarDaySheet.querySelector('.calendar-day-sheet');
  if (immediate || !panel) {
    finishCloseCalendarDaySheet();
    return;
  }
  if (panel.classList.contains('calendar-day-sheet--closing')) return;
  panel.classList.add('calendar-day-sheet--closing');
  let closed = false;
  const done = () => {
    if (closed) return;
    closed = true;
    panel.removeEventListener('animationend', onEnd);
    finishCloseCalendarDaySheet();
  };
  const onEnd = (e) => {
    if (e.target !== panel) return;
    done();
  };
  panel.addEventListener('animationend', onEnd);
  window.setTimeout(done, 280);
}

function initCalendarDaySheetGestures() {
  const modal = dom.calendarDaySheet;
  const panel = modal?.querySelector('.calendar-day-sheet');
  const body = modal?.querySelector('.calendar-day-sheet__body');
  if (!modal || !panel || panel.dataset.swipeBound) return;
  panel.dataset.swipeBound = '1';

  let startY = 0;
  let dragging = false;

  panel.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    if (body && body.scrollTop > 2) return;
    startY = e.touches[0].clientY;
    dragging = true;
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) panel.style.transform = `translateY(${Math.min(dy, 120)}px)`;
  }, { passive: true });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = (e.changedTouches?.[0]?.clientY ?? startY) - startY;
    panel.style.transform = '';
    if (dy > 72) closeCalendarDaySheet();
  };

  panel.addEventListener('touchend', endDrag, { passive: true });
  panel.addEventListener('touchcancel', endDrag, { passive: true });
}

function openCalendarDaySheet() {
  if (!dom.calendarDaySheet) return;
  const panel = dom.calendarDaySheet.querySelector('.calendar-day-sheet');
  if (panel) {
    panel.classList.remove('calendar-day-sheet--closing');
    panel.style.transform = '';
    panel.style.animation = 'none';
    void panel.offsetHeight;
    panel.style.animation = '';
  }
  state.calendarModalType = 'recordList';
  dom.calendarDaySheet.hidden = false;
  dom.calendarDaySheet.setAttribute('aria-hidden', 'false');
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

function openCalendarMealEditor(mealId, dateStr) {
  state.calendarReopenListDate = dateStr;
  state.calendarModalType = 'editRecord';
  closeCalendarDaySheet({ immediate: true });
  openMealModal(mealId);
}

function openCalendarShoppingEditor(recordId, dateStr) {
  state.calendarReopenListDate = dateStr;
  state.calendarModalType = 'editShopping';
  closeCalendarDaySheet({ immediate: true });
  openShoppingModal(recordId);
}

function reopenCalendarRecordListAfterEdit(dateStr) {
  if (!dateStr || state.view !== 'calendar') return;
  state.calendarModalType = 'recordList';
  selectCalendarDate(dateStr);
}

function clearCalendarSubModalState() {
  state.calendarModalType = null;
  state.calendarReopenListDate = null;
  state.editingMealId = null;
  state.editingShoppingId = null;
}

function selectCalendarDate(dateStr) {
  state.selectedCalendarDate = dateStr;
  dom.calendarDays?.querySelectorAll('.calendar-day:not(.calendar-day--empty)').forEach((btn) => {
    btn.classList.toggle('calendar-day--selected', btn.dataset.date === dateStr);
  });
  renderCalendarDayDetail(dateStr);
  openCalendarDaySheet();
}

function renderCalendarDayDetail(dateStr) {
  if (dom.calendarDaySheetTitle) {
    dom.calendarDaySheetTitle.textContent = `${formatDateLabel(dateStr)} 기록`;
  }
  if (dom.calendarDayLabel) dom.calendarDayLabel.textContent = formatDateLabel(dateStr);

  if (isGuestUser()) {
    dom.calendarDayEmpty.hidden = false;
    dom.calendarDayList.innerHTML = '';
    const emptyText = dom.calendarDayEmpty?.querySelector('.empty-state__text');
    if (emptyText) emptyText.textContent = '로그인하면 이 날짜의 식사·장보기 기록을 저장할 수 있어요.';
    return;
  }

  const logs = MealLogRepository.getByDate(dateStr);
  const shoppingRecords = ShoppingRecordRepository.getByDate(dateStr);
  dom.calendarDayEmpty.hidden = logs.length + shoppingRecords.length > 0;

  const mealItems = logs.map((log) => renderCalendarMealRecordRow(log)).join('');

  const shoppingItems = shoppingRecords.map((record) => renderCalendarShoppingRecordRow(record)).join('');

  dom.calendarDayList.innerHTML = mealItems + shoppingItems;

  dom.calendarDayList.querySelectorAll('[data-view-meal]').forEach((b) => {
    b.onclick = () => openCalendarMealEditor(b.dataset.viewMeal, dateStr);
  });
  dom.calendarDayList.querySelectorAll('[data-edit-meal]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      requireAppLogin(() => openCalendarMealEditor(b.dataset.editMeal, dateStr));
    };
  });
  dom.calendarDayList.querySelectorAll('[data-del-meal]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      requireAppLogin(() => {
        if (confirm('이 식사 기록을 삭제할까요?')) {
          deleteMealLogFromStore(b.dataset.delMeal)
            .then(() => { renderCalendar(); showToast('기록이 삭제되었어요'); })
            .catch((err) => showToast(err.message || '삭제에 실패했습니다.'));
        }
      });
    };
  });
  dom.calendarDayList.querySelectorAll('[data-add-pantry-shopping]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      requireAppLogin(() => addShoppingRecordToPantry(b.dataset.addPantryShopping));
    };
  });
  dom.calendarDayList.querySelectorAll('[data-edit-shopping]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      requireAppLogin(() => openCalendarShoppingEditor(b.dataset.editShopping, dateStr));
    };
  });
  dom.calendarDayList.querySelectorAll('[data-del-shopping]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      requireAppLogin(() => {
        if (confirm('이 장보기 기록을 삭제할까요?')) {
          deleteShoppingRecordFromStore(b.dataset.delShopping)
            .then(() => { renderCalendar(); showToast('장보기 기록이 삭제되었어요'); })
            .catch((err) => showToast(err.message || '삭제에 실패했습니다.'));
        }
      });
    };
  });
}

function populateMealRecipeSelect() {
  const recipes = RecipeRepository.getRecommendableRecipes();
  dom.mealRecipeSelect.innerHTML = '<option value="">레시피 선택</option>' +
    recipes.map((r) => `<option value="${esc(r.id)}">${esc(r.name)}</option>`).join('');
}

function setMealType(type) {
  state.selectedMealType = normalizeMealType(type);
  dom.mealTypeTabs.querySelectorAll('.meal-type-tab').forEach((tab) => {
    tab.classList.toggle('meal-type-tab--active', tab.dataset.mealType === state.selectedMealType);
  });
  const isHomeCook = state.selectedMealType === 'home-cook';
  dom.mealRecipeField.hidden = !isHomeCook;
  dom.mealCostField.hidden = isHomeCook;
  if (isHomeCook) dom.mealCost.value = '';
  if (!isHomeCook) dom.mealRecipeSelect.value = '';
}

function updateMealPhotoPreview(src) {
  if (src) {
    dom.mealPhotoPreview.classList.remove('photo-upload__preview--empty');
    dom.mealPhotoPreview.innerHTML = `<img src="${src}" alt="식사 사진 미리보기">`;
    dom.mealPhotoRemoveBtn.hidden = false;
  } else {
    dom.mealPhotoPreview.classList.add('photo-upload__preview--empty');
    dom.mealPhotoPreview.innerHTML = '<span class="photo-upload__placeholder">📷</span><span class="photo-upload__placeholder-text">사진 없음</span>';
    dom.mealPhotoRemoveBtn.hidden = true;
  }
}

function openMealModal(id = null, options = null) {
  if (!isLoggedInAppUser()) {
    requireAppLogin(() => openMealModal(id, options));
    return;
  }
  let defaultDate;
  let presetRecipeId;
  let presetMealType = 'home-cook';
  let hideMealType = false;
  if (typeof options === 'string') defaultDate = options;
  else if (options) {
    defaultDate = options.defaultDate;
    presetRecipeId = options.recipeId;
    presetMealType = options.mealType || 'home-cook';
    hideMealType = options.hideMealType === true;
  }

  state.editingMealId = id;
  state.mealFormImage = null;
  state.mealPhotoRemoved = false;
  dom.mealModalForm.reset();
  populateMealRecipeSelect();
  updateMealPhotoPreview(null);
  dom.mealModalTitle.textContent = id ? '식사 기록 수정' : '식사 기록';
  dom.mealDate.value = defaultDate || state.selectedCalendarDate || todayStr();

  if (id) {
    dom.mealTypeField.hidden = false;
    const log = MealLogRepository.getAll().find((l) => l.id === id);
    if (!log) return;
    dom.mealDate.value = log.date;
    dom.mealName.value = log.name;
    dom.mealCost.value = log.cost || '';
    dom.mealMemo.value = log.memo || '';
    if (log.recipeId) dom.mealRecipeSelect.value = log.recipeId;
    if (log.photo) { state.mealFormImage = log.photo; updateMealPhotoPreview(log.photo); }
    setMealType(log.mealType);
  } else {
    dom.mealTypeField.hidden = hideMealType;
    setMealType(presetMealType);
    if (presetRecipeId) {
      dom.mealRecipeSelect.value = presetRecipeId;
      dom.mealRecipeField.hidden = false;
      const recipe = RecipeRepository.getById(presetRecipeId);
      if (recipe) dom.mealName.value = recipe.name;
    }
  }
  openModal('meal');
}

function handleMealRecipeSelect() {
  if (state.selectedMealType !== 'home-cook') return;
  const recipe = RecipeRepository.getById(dom.mealRecipeSelect.value);
  if (recipe) dom.mealName.value = recipe.name;
}

function handleMealModalSubmit(e) {
  e.preventDefault();
  if (!isLoggedInAppUser()) {
    requireAppLogin(() => handleMealModalSubmit(e));
    return;
  }
  const date = dom.mealDate.value;
  const name = dom.mealName.value.trim();
  const memo = dom.mealMemo.value.trim();
  const mealType = state.selectedMealType;
  const recipeId = mealType === 'home-cook' ? dom.mealRecipeSelect.value : '';
  const cost = mealType === 'home-cook' ? 0 : Number(dom.mealCost.value) || 0;
  if (!date || !name) return;

  let ingredients = [];
  let usedExpiring = false;
  if (recipeId) {
    const recipe = RecipeRepository.getById(recipeId);
    if (recipe) {
      ingredients = [...recipe.ingredients];
      const names = RecommendationService.getPantryNames();
      usedExpiring = RecommendationService.getExpiryBoost(MatchService.analyze(names, recipe.ingredients).matchedPantryNames) > 0;
    }
  } else if (state.editingMealId) {
    const existing = MealLogRepository.getAll().find((l) => l.id === state.editingMealId);
    if (existing) {
      ingredients = existing.ingredients || [];
      usedExpiring = existing.usedExpiringIngredients || false;
    }
  }

  let photo = '';
  if (state.mealFormImage) {
    photo = state.mealFormImage;
  } else if (state.editingMealId && !state.mealPhotoRemoved) {
    const existing = MealLogRepository.getAll().find((l) => l.id === state.editingMealId);
    if (existing?.photo) photo = existing.photo;
  }

  const payload = {
    date, name, memo, mealType, cost, recipeId: recipeId || null, ingredients, usedExpiringIngredients: usedExpiring, photo,
    currency: state.editingMealId
      ? undefined
      : (mealType === 'home-cook' ? DEFAULT_CURRENCY : state.currency),
  };

  saveMealLogToStore(payload, state.editingMealId)
    .then(() => {
      const wasEdit = Boolean(state.editingMealId);
      const reopenDate = state.calendarReopenListDate;
      showToast(wasEdit ? '기록이 수정되었어요' : `"${name}" 기록 완료!`);
      state.selectedCalendarDate = date;
      const [y, m] = date.split('-').map(Number);
      state.calendarYear = y;
      state.calendarMonth = m - 1;
      state.editingMealId = null;
      state.calendarReopenListDate = null;
      state.calendarModalType = null;
      closeModal('meal');
      renderCalendar();
      if (reopenDate) reopenCalendarRecordListAfterEdit(reopenDate);
    })
    .catch((err) => showToast(err.message || '식사 기록 저장에 실패했습니다.'));
}

function addShoppingRecordToPantry(recordId) {
  const record = ShoppingRecordRepository.getAll().find((entry) => entry.id === recordId);
  if (!record) return;
  if (shoppingPantryAddInFlight.has(recordId)) return;
  if (isShoppingIngredientsAdded(record)) {
    showToast('이미 보유 재료에 반영됐어요');
    if (state.selectedCalendarDate && !dom.calendarDaySheet?.hidden) {
      renderCalendarDayDetail(state.selectedCalendarDate);
    }
    return;
  }
  const items = getShoppingRecordItems(record);
  if (!items.length) {
    showToast('추가할 재료가 없어요');
    return;
  }
  shoppingPantryAddInFlight.add(recordId);
  addShoppingItemsToPantry(record)
    .then(async ({ added, merged }) => {
      const saved = await saveShoppingRecordToStore({
        ...normalizeShoppingRecord(record),
        ingredientsAdded: true,
        pantryAdded: true,
      }, recordId);
      upsertShoppingRecordLocal(saved);
      renderCalendar();
      if (state.selectedCalendarDate && !dom.calendarDaySheet?.hidden) {
        renderCalendarDayDetail(state.selectedCalendarDate);
      }
      if (added || merged) {
        showToast(`보유 재료에 반영했어요${added ? ` · ${added}개 추가` : ''}${merged ? `${added ? '' : ''} · ${merged}개 병합` : ''}`);
      } else {
        showToast('보유 재료에 반영했어요');
      }
    })
    .catch(() => showToast('보유 재료 추가에 실패했습니다.'))
    .finally(() => shoppingPantryAddInFlight.delete(recordId));
}

function openShoppingModal(id = null, defaultDate = null) {
  if (!isLoggedInAppUser()) {
    requireAppLogin(() => openShoppingModal(id, defaultDate));
    return;
  }
  state.editingShoppingId = id;
  dom.shoppingModalForm.reset();
  RecipePickerService.clear(state.shoppingRecipePicker);
  dom.shoppingIngredients.value = '';
  dom.shoppingModalTitle.textContent = id ? '장보기 기록 수정' : '장보기 기록';
  dom.shoppingDate.value = defaultDate || state.selectedCalendarDate || todayStr();
  if (id) {
    const record = normalizeShoppingRecord(ShoppingRecordRepository.getAll().find((entry) => entry.id === id));
    if (!record) return;
    dom.shoppingDate.value = record.date;
    dom.shoppingAmount.value = record.amount || '';
    dom.shoppingStore.value = record.store || '';
    dom.shoppingIngredients.value = (record.items || []).map((item) => formatIngredientDisplay(item)).join('\n');
    if (record.recipeId) {
      const recipe = RecipeRepository.getById(record.recipeId);
      if (recipe) RecipePickerService.setSelection(state.shoppingRecipePicker, recipe);
      else if (record.recipeName) dom.shoppingRecipeInput.value = record.recipeName;
    } else if (record.recipeName) {
      dom.shoppingRecipeInput.value = record.recipeName;
    }
  }
  openModal('shopping');
}

function handleShoppingModalSubmit(e) {
  e.preventDefault();
  if (!isLoggedInAppUser()) {
    requireAppLogin(() => handleShoppingModalSubmit(e));
    return;
  }
  const date = dom.shoppingDate.value;
  const amount = Number(dom.shoppingAmount.value);
  const store = dom.shoppingStore.value.trim();
  const ingredientLines = parseIngredientList(dom.shoppingIngredients.value);
  const items = ingredientLines.map((line) => normalizeShoppingItem(line));
  const resolved = RecipePickerService.resolve(dom.shoppingRecipeInput, dom.shoppingRecipeId);
  const recipeId = resolved?.id || null;
  const recipeName = resolved?.name || dom.shoppingRecipeInput.value.trim();
  if (!date || Number.isNaN(amount)) return;

  const existing = state.editingShoppingId
    ? normalizeShoppingRecord(ShoppingRecordRepository.getAll().find((entry) => entry.id === state.editingShoppingId))
    : null;

  const payload = {
    type: 'shopping',
    date,
    amount,
    store,
    items,
    ingredients: items.map((item) => formatIngredientDisplay(item)),
    recipeId,
    recipeName,
    ingredientsAdded: existing?.ingredientsAdded || false,
    pantryAdded: existing?.ingredientsAdded || false,
    currency: state.editingShoppingId ? undefined : state.currency,
  };

  const finish = (msg) => {
    const reopenDate = state.calendarReopenListDate;
    state.selectedCalendarDate = date;
    const [y, m] = date.split('-').map(Number);
    state.calendarYear = y;
    state.calendarMonth = m - 1;
    state.editingShoppingId = null;
    state.calendarReopenListDate = null;
    state.calendarModalType = null;
    closeModal('shopping');
    refreshAll();
    showToast(msg);
    if (reopenDate) reopenCalendarRecordListAfterEdit(reopenDate);
  };

  saveShoppingRecordToStore(payload, state.editingShoppingId)
    .then((saved) => {
      upsertShoppingRecordLocal(saved);
      if (!isLoggedInAppUser()) notifyGuestPersonalDataNotPersisted('장보기 기록');
      finish(state.editingShoppingId ? '장보기 기록이 수정되었어요' : `장보기 ${formatMoney(amount, state.currency)} 기록 완료!`);
    })
    .catch((err) => showToast(err.message || '장보기 기록 저장에 실패했습니다.'));
}

function changeCalendarMonth(delta) {
  state.calendarMonth += delta;
  if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear += 1; }
  else if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear -= 1; }
  state.selectedCalendarDate = null;
  closeCalendarDaySheet();
  renderCalendar();
}

// ===== Meal Planner =====
const PLANNER_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatPlannerDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${PLANNER_WEEKDAYS[d.getDay()]}요일 ${d.getMonth() + 1}/${d.getDate()}`;
}

function plannerSlotInfo(slotId) {
  return PLANNER_SLOTS.find((s) => s.id === slotId) || { id: slotId, label: slotId, emoji: '🍽️', menuEmoji: '🍽️' };
}

function plannerSlotHasEntry(date, slotId) {
  const entry = MealPlanRepository.get(date, slotId);
  return Boolean(entry.recipeId || entry.name);
}

function isPlannerMealManual(entry) {
  if (!entry) return false;
  return entry.type === 'manual' || (!entry.recipeId && Boolean(entry.name));
}

function getPlannerMealDisplay(entry) {
  if (!isPlannerMealManual(entry) && entry.recipeId) {
    const recipe = RecipeRepository.getById(entry.recipeId);
    if (recipe) return { ...recipe, manual: false };
  }
  if (entry.name) {
    return {
      id: '',
      name: entry.name,
      cookTime: null,
      difficulty: null,
      ingredients: [],
      manual: true,
    };
  }
  return null;
}

function plannerMealThumbHTML(recipe) {
  if (recipe?.id && !recipe.manual && typeof RecipeImageService !== 'undefined') {
    return `<div class="planner-meal__thumb">${RecipeImageService.renderImg(recipe, { variant: 'thumb', alt: '' })}</div>`;
  }
  return '<div class="planner-meal__thumb planner-meal__thumb--empty" aria-hidden="true">🍽️</div>';
}

function plannerMealRecordLabel(entry) {
  return entry.recorded ? '기록 완료' : '식사기록';
}

function buildPlannerMealMemo(date, slotId, entry) {
  const slot = plannerSlotInfo(slotId);
  const slotLabel = `${slot.emoji} ${slot.label}`;
  if (entry.memo) return `${slotLabel} · ${entry.memo}`;
  return `${slotLabel} · ${formatPlannerDayLabel(date)} 식단`;
}

const plannerRecordingKeys = new Set();

function plannerRecordKey(dateKey, slotId) {
  return `${dateKey}:${slotId}`;
}

function upsertMealLogLocal(log) {
  if (!log) return null;
  const normalized = {
    ...log,
    id: log.id || log.firestoreId,
    firestoreId: log.firestoreId || log.id,
    mealType: normalizeMealType(log.mealType),
    cost: Number(log.cost) || 0,
    currency: log.currency || DEFAULT_CURRENCY,
    createdAt: log.createdAt || new Date().toISOString(),
    updatedAt: log.updatedAt || new Date().toISOString(),
  };
  const existingIdx = MealLogRepository.getAll().findIndex(
    (l) => l.id === normalized.id || l.firestoreId === normalized.firestoreId,
  );
  if (existingIdx >= 0) {
    MealLogRepository._logs[existingIdx] = { ...MealLogRepository._logs[existingIdx], ...normalized };
  } else {
    MealLogRepository._logs.push(normalized);
  }
  return normalized;
}

function focusCalendarOnMealRecord(dateStr) {
  if (!dateStr) return;
  const [y, m] = dateStr.split('-').map(Number);
  if (!y || !m) return;
  state.calendarYear = y;
  state.calendarMonth = m - 1;
  state.selectedCalendarDate = dateStr;
  renderCalendar();
  if (state.view === 'calendar') {
    selectCalendarDate(dateStr);
  }
}

function plannerMealCardHTML(date, slot, animate = false) {
  const entry = MealPlanRepository.get(date, slot.id);
  const recipe = getPlannerMealDisplay(entry);
  if (!recipe) return '';
  const manual = isPlannerMealManual(entry) || recipe.manual;
  const names = RecommendationService.getPantryNames();
  const matchPercent = !manual && recipe.ingredients?.length && names.length
    ? MatchService.analyze(names, recipe.ingredients).matchPercent
    : null;
  const metaParts = [];
  if (manual) {
    metaParts.push('직접 입력');
  } else {
    if (recipe.cookTime != null) metaParts.push(`${recipe.cookTime}분`);
    if (recipe.difficulty) metaParts.push(recipe.difficulty);
  }
  const meta = metaParts.join(' · ');
  const matchLine = matchPercent != null
    ? `<p class="planner-meal__match">${matchPercent}% 재료 일치</p>`
    : '';
  const animClass = animate ? ' planner-meal--enter' : '';
  const recordBtnClass = entry.recorded ? ' planner-meal__record--done' : '';
  return `
    <article class="planner-meal${animClass}${manual ? ' planner-meal--manual' : ''}" data-meal-date="${esc(date)}" data-meal-slot="${esc(slot.id)}" data-meal-type="${manual ? 'manual' : 'recipe'}">
      <div class="planner-meal__head">
        <p class="planner-meal__slot">${slot.emoji} ${esc(slot.label)}</p>
        <button type="button" class="planner-meal__remove" data-planner-remove data-meal-date="${esc(date)}" data-meal-slot="${esc(slot.id)}" aria-label="${esc(slot.label)} ${esc(recipe.name)} 삭제">×</button>
      </div>
      <div class="planner-meal__content">
        <button type="button" class="planner-meal__body" data-planner-edit data-meal-date="${esc(date)}" data-meal-slot="${esc(slot.id)}" aria-label="${esc(slot.label)} ${esc(recipe.name)} 수정">
          <div class="planner-meal__row">
            ${plannerMealThumbHTML(recipe)}
            <div class="planner-meal__info">
              <p class="planner-meal__name">${esc(recipe.name)}</p>
              ${meta ? `<p class="planner-meal__meta">${esc(meta)}</p>` : ''}
              ${matchLine}
            </div>
          </div>
        </button>
        <button type="button" class="planner-meal__record${recordBtnClass}"
          data-planner-record data-meal-date="${esc(date)}" data-meal-slot="${esc(slot.id)}"
          ${entry.recorded ? 'disabled aria-disabled="true"' : ''}
          aria-label="${esc(slot.label)} ${esc(recipe.name)} ${plannerMealRecordLabel(entry)}">
          ${plannerMealRecordLabel(entry)}
        </button>
      </div>
    </article>`;
}

function plannerDayCardHTML(date) {
  const filled = PLANNER_SLOTS.filter((slot) => plannerSlotHasEntry(date, slot.id));
  const mealsHTML = filled.map((slot) => {
    const animate = state.plannerAnimate?.date === date && state.plannerAnimate?.slot === slot.id;
    return plannerMealCardHTML(date, slot, animate);
  }).join('');
  const todayMark = date === todayStr() ? ' planner-day--today' : '';
  const body = filled.length
    ? `<div class="planner-day__meals">${mealsHTML}</div>`
    : `<div class="planner-day__empty">
        <p class="planner-day__empty-text">아직 추가된 식단이 없어요.</p>
        <p class="planner-day__empty-hint">+ 버튼으로 아침·점심·저녁·간식을 추가해보세요.</p>
      </div>`;
  return `
    <article class="planner-day${todayMark}">
      <div class="planner-day__header">
        <h3 class="planner-day__title">${formatPlannerDayLabel(date)}</h3>
        <button type="button" class="planner-day__add" data-planner-date="${esc(date)}" aria-label="${formatPlannerDayLabel(date)} 식단 추가">＋</button>
      </div>
      ${body}
    </article>`;
}

function setPlannerMeal(date, slotId, data, { animate = false } = {}) {
  markMealPlanLocalMutation();
  MealPlanRepository.set(date, slotId, data);
  if (animate) state.plannerAnimate = { date, slot: slotId };
  renderPlanner();
  renderGroceryList();
  persistMealPlans().catch((err) => {
    console.error('[MealPlanner] persist failed after set', { date, slotId, err });
    showToast(err?.message || '식단 저장에 실패했어요. 다시 시도해 주세요.');
  });
}

function applyMealPlanSlotRemoval(dateKey, mealType) {
  MealPlanRepository.set(dateKey, mealType, { recipeId: '', name: '' });
  renderPlanner();
  renderGroceryList();
}

async function deleteMealPlanItem(dateKey, mealType) {
  const normalizedDate = String(dateKey || '').trim();
  const normalizedSlot = String(mealType || '').trim();
  if (!normalizedDate || !normalizedSlot) {
    const err = new Error('삭제할 식단 정보가 없습니다.');
    console.error('[MealPlanner] deleteMealPlanItem invalid params', { dateKey, mealType });
    throw err;
  }
  markMealPlanLocalMutation();
  applyMealPlanSlotRemoval(normalizedDate, normalizedSlot);
  await persistMealPlans();
  return true;
}

function readPlannerMealDataset(el) {
  if (!el) return { dateKey: '', mealType: '' };
  return {
    dateKey: el.getAttribute('data-meal-date') || el.getAttribute('data-date') || '',
    mealType: el.getAttribute('data-meal-slot') || el.getAttribute('data-slot') || '',
  };
}

function handlePlannerMealRemove(dateKey, mealType) {
  const normalizedDate = String(dateKey || '').trim();
  const normalizedSlot = String(mealType || '').trim();
  if (!normalizedDate || !normalizedSlot) {
    console.error('[MealPlanner] handlePlannerMealRemove invalid params', { dateKey, mealType });
    showToast('식단을 삭제하지 못했어요.');
    return;
  }
  if (isGuestUser()) {
    requireAppLogin({
      redirectAfterLogin: () => removePlannerMeal(normalizedDate, normalizedSlot),
    });
    return;
  }
  removePlannerMeal(normalizedDate, normalizedSlot);
}

async function removePlannerMeal(dateKey, mealType) {
  const normalizedDate = String(dateKey || '').trim();
  const normalizedSlot = String(mealType || '').trim();
  if (!normalizedDate || !normalizedSlot) {
    console.error('[MealPlanner] removePlannerMeal invalid params', { dateKey, mealType });
    showToast('식단을 삭제하지 못했어요.');
    return;
  }

  const selector = `.planner-meal[data-meal-date="${normalizedDate}"][data-meal-slot="${normalizedSlot}"]`;
  const el = dom.plannerGrid?.querySelector(selector)
    || dom.plannerGrid?.querySelector(`.planner-meal[data-date="${normalizedDate}"][data-slot="${normalizedSlot}"]`);

  const commitDelete = async () => {
    try {
      await deleteMealPlanItem(normalizedDate, normalizedSlot);
      showToast(`${plannerSlotInfo(normalizedSlot).label} 식단을 삭제했어요`);
    } catch (err) {
      console.error('[MealPlanner] removePlannerMeal failed', {
        dateKey: normalizedDate,
        mealType: normalizedSlot,
        err,
      });
      showToast(err?.message || '식단 삭제에 실패했어요. 다시 시도해 주세요.');
    }
  };

  if (el) {
    el.classList.add('planner-meal--exit');
    window.setTimeout(() => { commitDelete(); }, 240);
    return;
  }
  await commitDelete();
}

function finishClosePlannerSheet(sheet) {
  if (!sheet) return;
  const panel = sheet.querySelector('.planner-sheet');
  if (panel) {
    panel.style.transform = '';
    panel.classList.remove('planner-sheet--closing');
  }
  sheet.hidden = true;
  sheet.setAttribute('aria-hidden', 'true');
}

function closePlannerSheet(sheet, { immediate = false } = {}) {
  if (!sheet || sheet.hidden) return;
  const panel = sheet.querySelector('.planner-sheet');
  if (immediate || !panel) {
    finishClosePlannerSheet(sheet);
    return;
  }
  if (panel.classList.contains('planner-sheet--closing')) return;
  panel.classList.add('planner-sheet--closing');
  let closed = false;
  const done = () => {
    if (closed) return;
    closed = true;
    panel.removeEventListener('animationend', onEnd);
    finishClosePlannerSheet(sheet);
  };
  const onEnd = (e) => {
    if (e.target !== panel) return;
    done();
  };
  panel.addEventListener('animationend', onEnd);
  window.setTimeout(done, 280);
}

function closePlannerSheets({ immediate = false } = {}) {
  dom.plannerRecipeSearch?.blur();
  setPlannerRecipeSheetKeyboardActive(false);
  closePlannerSheet(dom.plannerSlotSheet, { immediate });
  closePlannerSheet(dom.plannerRecipeSheet, { immediate });
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

function openPlannerSlotSheet(date) {
  if (isGuestUser()) {
    requireAppLogin({ redirectAfterLogin: () => openPlannerSlotSheet(date) });
    return;
  }
  state.plannerSheet.date = date;
  if (dom.plannerSlotSheetTitle) dom.plannerSlotSheetTitle.textContent = formatPlannerDayLabel(date);
  renderPlannerSlotMenu(date);
  if (!dom.plannerSlotSheet) return;
  dom.plannerSlotSheet.querySelector('.planner-sheet')?.classList.remove('planner-sheet--closing');
  dom.plannerSlotSheet.hidden = false;
  dom.plannerSlotSheet.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

function renderPlannerSlotMenu(date) {
  if (!dom.plannerSlotMenu) return;
  dom.plannerSlotMenu.innerHTML = PLANNER_SLOTS.flatMap((slot) => {
    const has = plannerSlotHasEntry(date, slot.id);
    if (has) {
      return [
        `<button type="button" class="planner-slot-menu__item" data-action="edit" data-slot="${esc(slot.id)}">${slot.menuEmoji} ${esc(slot.label)} 수정</button>`,
        `<button type="button" class="planner-slot-menu__item planner-slot-menu__item--danger" data-action="delete" data-slot="${esc(slot.id)}">${slot.menuEmoji} ${esc(slot.label)} 삭제</button>`,
      ];
    }
    return [`<button type="button" class="planner-slot-menu__item" data-action="add" data-slot="${esc(slot.id)}">${slot.menuEmoji} ${esc(slot.label)} 추가</button>`];
  }).join('');
  dom.plannerSlotMenu.querySelectorAll('[data-action]').forEach((btn) => {
    btn.onclick = () => {
      const slotId = btn.dataset.slot;
      const action = btn.dataset.action;
      if (action === 'delete') {
        closePlannerSheets();
        handlePlannerMealRemove(date, slotId);
        return;
      }
      openPlannerRecipeSheet(date, slotId, action === 'edit' ? 'edit' : 'add');
    };
  });
}

function getPlannerRecipePickerItems(tab, query) {
  const q = normalizeIngredient(query || '');
  const names = RecommendationService.getPantryNames();
  let items = [];
  if (tab === 'mine') {
    items = RecipeRepository.getUserRecipes().map((recipe) => ({ recipe, matchPercent: null }));
  } else if (tab === 'public') {
    items = RecipeRepository.getHomeRecipes().map((recipe) => {
      const a = names.length
        ? MatchService.analyze(names, recipe.ingredients)
        : { matchPercent: null };
      return { recipe, matchPercent: a.matchPercent };
    });
  } else {
    items = RecommendationService.recommend(RecipeRepository.getRecommendableRecipes())
      .map(({ recipe, matchPercent }) => ({ recipe, matchPercent }));
  }
  if (q) {
    items = items.filter(({ recipe }) => normalizeIngredient(recipe.name).includes(q));
  }
  return items;
}

function plannerRecipePickRowHTML({ recipe, matchPercent }) {
  const thumb = recipe?.id && typeof RecipeImageService !== 'undefined'
    ? RecipeImageService.renderImg(recipe, { variant: 'thumb', alt: '' })
    : '';
  const metaParts = [];
  if (recipe.cookTime != null) metaParts.push(`${recipe.cookTime}분`);
  if (recipe.difficulty) metaParts.push(recipe.difficulty);
  if (matchPercent != null) metaParts.push(`${matchPercent}% 일치`);
  return `
    <button type="button" class="planner-recipe-pick" data-recipe-id="${esc(recipe.id)}">
      <div class="planner-recipe-pick__thumb">${thumb}</div>
      <div class="planner-recipe-pick__body">
        <span class="planner-recipe-pick__name">${esc(recipe.name)}</span>
        ${metaParts.length ? `<span class="planner-recipe-pick__meta">${esc(metaParts.join(' · '))}</span>` : ''}
      </div>
    </button>`;
}

function normalizePlannerFreeAddQuery(query) {
  return String(query || '').trim();
}

function findRecommendableRecipeByExactTitle(title) {
  const norm = MatchService.normalize(title);
  if (!norm) return null;
  return RecipeRepository.getRecommendableRecipes().find(
    (r) => MatchService.normalize(r.name) === norm,
  ) || null;
}

function findOwnedRecipeByExactTitle(title) {
  const norm = MatchService.normalize(title);
  if (!norm) return null;
  return RecipeRepository.getUserRecipes().find(
    (r) => MatchService.normalize(r.name) === norm,
  ) || null;
}

function plannerRecipeFreeAddHTML(query) {
  const q = normalizePlannerFreeAddQuery(query);
  if (q.length < 2) return '';
  const exact = findRecommendableRecipeByExactTitle(q);
  const hint = exact
    ? `<p class="planner-recipe-free-add__hint">같은 이름의 레시피가 있어요. 위 목록에서 선택하는 걸 권장해요.</p>`
    : '';
  return `
    <div class="planner-recipe-free-add" role="group" aria-label="직접 추가">
      <p class="planner-recipe-free-add__label">직접 추가</p>
      ${hint}
      <button type="button" class="planner-recipe-free-add__btn" data-planner-free="manual">“${esc(q)}” 메뉴로 추가</button>
      <button type="button" class="planner-recipe-free-add__btn planner-recipe-free-add__btn--recipe" data-planner-free="recipe">“${esc(q)}” 레시피 등록 후 추가</button>
    </div>`;
}

function renderPlannerRecipePicker() {
  if (!dom.plannerRecipeList || !dom.plannerRecipeTabs) return;
  const { tab, search } = state.plannerSheet;
  dom.plannerRecipeTabs.querySelectorAll('[data-planner-tab]').forEach((btn) => {
    btn.classList.toggle('planner-recipe-tabs__btn--active', btn.dataset.plannerTab === tab);
  });
  const items = getPlannerRecipePickerItems(tab, search);
  const freeAddQuery = normalizePlannerFreeAddQuery(search);
  const showFreeAdd = freeAddQuery.length >= 2;
  const freeAddHTML = showFreeAdd ? plannerRecipeFreeAddHTML(freeAddQuery) : '';
  if (dom.plannerRecipeEmpty) {
    dom.plannerRecipeEmpty.hidden = items.length > 0 || showFreeAdd;
    if (!showFreeAdd && items.length === 0) {
      dom.plannerRecipeEmpty.textContent = '검색 결과가 없습니다.';
    }
  }
  const hasContent = items.length > 0 || showFreeAdd;
  dom.plannerRecipeList.hidden = !hasContent;
  dom.plannerRecipeList.innerHTML = `${items.map(plannerRecipePickRowHTML).join('')}${freeAddHTML}`;
  dom.plannerRecipeList.querySelectorAll('.planner-recipe-pick').forEach((btn) => {
    btn.onclick = () => {
      const recipe = RecipeRepository.getById(btn.dataset.recipeId);
      if (!recipe) return;
      confirmPlannerRecipe(recipe);
    };
  });
  dom.plannerRecipeList.querySelectorAll('[data-planner-free]').forEach((btn) => {
    btn.onclick = () => {
      const mode = btn.dataset.plannerFree;
      if (mode === 'manual') confirmPlannerManualMeal(freeAddQuery);
      else if (mode === 'recipe') openPlannerRecipeCreateThenAdd(freeAddQuery);
    };
  });
  if (showFreeAdd) {
    requestAnimationFrame(() => {
      const freeAdd = dom.plannerRecipeList.querySelector('.planner-recipe-free-add');
      freeAdd?.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    });
  }
}

function confirmPlannerManualMeal(title) {
  const name = normalizePlannerFreeAddQuery(title);
  const { date, slot, action } = state.plannerSheet;
  if (!date || !slot || name.length < 2) return;
  setPlannerMeal(date, slot, {
    type: 'manual',
    recipeId: null,
    name,
    memo: '',
    recorded: false,
  }, { animate: true });
  closePlannerSheets();
  const slotLabel = plannerSlotInfo(slot).label;
  showToast(action === 'edit' ? `${slotLabel} 식단을 수정했어요` : `${slotLabel}에 ${name}을(를) 추가했어요`);
}

function openPlannerRecipeCreateThenAdd(title) {
  const name = normalizePlannerFreeAddQuery(title);
  if (name.length < 2) return;
  const dup = findOwnedRecipeByExactTitle(name);
  if (dup) {
    const ok = window.confirm(
      `같은 제목의 내 레시피(“${dup.name}”)가 이미 있어요. 그래도 새로 등록할까요?`,
    );
    if (!ok) return;
  }
  const { date, slot, action } = state.plannerSheet;
  if (!date || !slot) return;
  state.plannerPendingMeal = { date, slot, action, prefillName: name };
  closePlannerSheets({ immediate: true });
  openRecipeForm(null, { prefillName: name, fromPlanner: true });
}

function confirmPlannerRecipe(recipe) {
  const { date, slot, action } = state.plannerSheet;
  if (!date || !slot || !recipe) return;
  setPlannerMeal(date, slot, {
    type: 'recipe',
    recipeId: recipe.id,
    name: recipe.name,
    memo: '',
    recorded: false,
  }, { animate: true });
  closePlannerSheets();
  const slotLabel = plannerSlotInfo(slot).label;
  showToast(action === 'edit' ? `${slotLabel} 식단을 수정했어요` : `${slotLabel}에 ${recipe.name}을(를) 추가했어요`);
}

let plannerRecipeViewportHandler = null;

function syncPlannerRecipeSheetKeyboard() {
  const sheet = dom.plannerRecipeSheet;
  if (!sheet || sheet.hidden) {
    document.documentElement.style.removeProperty('--planner-sheet-keyboard-inset');
    return;
  }
  const vv = window.visualViewport;
  if (!vv) {
    document.documentElement.style.setProperty('--planner-sheet-keyboard-inset', '0px');
    return;
  }
  const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--planner-sheet-keyboard-inset', `${inset}px`);
}

function setPlannerRecipeSheetKeyboardActive(active) {
  if (active) {
    syncPlannerRecipeSheetKeyboard();
    if (!plannerRecipeViewportHandler && window.visualViewport) {
      plannerRecipeViewportHandler = () => syncPlannerRecipeSheetKeyboard();
      window.visualViewport.addEventListener('resize', plannerRecipeViewportHandler);
      window.visualViewport.addEventListener('scroll', plannerRecipeViewportHandler);
    }
    return;
  }
  document.documentElement.style.removeProperty('--planner-sheet-keyboard-inset');
  if (plannerRecipeViewportHandler && window.visualViewport) {
    window.visualViewport.removeEventListener('resize', plannerRecipeViewportHandler);
    window.visualViewport.removeEventListener('scroll', plannerRecipeViewportHandler);
    plannerRecipeViewportHandler = null;
  }
}

function openPlannerRecipeSheet(date, slotId, action) {
  state.plannerSheet.date = date;
  state.plannerSheet.slot = slotId;
  state.plannerSheet.action = action;
  state.plannerSheet.tab = 'recommend';
  state.plannerSheet.search = '';
  const slot = plannerSlotInfo(slotId);
  if (dom.plannerRecipeSheetTitle) {
    dom.plannerRecipeSheetTitle.textContent = `${slot.label} ${action === 'edit' ? '수정' : '추가'}`;
  }
  if (dom.plannerRecipeSearch) dom.plannerRecipeSearch.value = '';
  renderPlannerRecipePicker();
  if (dom.plannerSlotSheet) {
    dom.plannerSlotSheet.hidden = true;
    dom.plannerSlotSheet.setAttribute('aria-hidden', 'true');
  }
  if (!dom.plannerRecipeSheet) return;
  dom.plannerRecipeSheet.querySelector('.planner-sheet')?.classList.remove('planner-sheet--closing');
  dom.plannerRecipeSheet.hidden = false;
  dom.plannerRecipeSheet.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  const isMobileInput = window.matchMedia?.('(hover: none), (pointer: coarse), (max-width: 480px)')?.matches;
  if (!isMobileInput) dom.plannerRecipeSearch?.focus();
}

function initPlannerSheetGestures(sheet) {
  const modal = sheet;
  const panel = modal?.querySelector('.planner-sheet');
  const handle = panel?.querySelector('.planner-sheet__handle');
  if (!modal || !panel || !handle || panel.dataset.swipeBound) return;
  panel.dataset.swipeBound = '1';

  let startY = 0;
  let dragging = false;

  handle.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    startY = e.touches[0].clientY;
    dragging = true;
  }, { passive: true });

  panel.addEventListener('touchmove', (e) => {
    if (!dragging) return;
    const dy = e.touches[0].clientY - startY;
    if (dy > 0) panel.style.transform = `translateY(${Math.min(dy, 140)}px)`;
  }, { passive: true });

  const endDrag = (e) => {
    if (!dragging) return;
    dragging = false;
    const dy = (e.changedTouches?.[0]?.clientY ?? startY) - startY;
    panel.style.transform = '';
    if (dy > 72) closePlannerSheets();
  };

  panel.addEventListener('touchend', endDrag, { passive: true });
  panel.addEventListener('touchcancel', endDrag, { passive: true });
}

async function recordPlannerMealToCalendar(dateKey, slotId) {
  const normalizedDate = String(dateKey || '').trim();
  const normalizedSlot = String(slotId || '').trim();
  if (!normalizedDate || !normalizedSlot) return;

  const recordKey = plannerRecordKey(normalizedDate, normalizedSlot);
  if (plannerRecordingKeys.has(recordKey)) return;

  const entry = MealPlanRepository.get(normalizedDate, normalizedSlot);
  if (entry.recorded) {
    showToast('이미 식사 기록이 완료된 식단이에요');
    return;
  }

  const recipe = getPlannerMealDisplay(entry);
  if (!recipe?.name) {
    showToast('기록할 식단 정보가 없어요');
    return;
  }

  plannerRecordingKeys.add(recordKey);
  const recordBtn = dom.plannerGrid?.querySelector(
    `[data-planner-record][data-meal-date="${normalizedDate}"][data-meal-slot="${normalizedSlot}"]`,
  );
  if (recordBtn) {
    recordBtn.disabled = true;
    recordBtn.classList.add('btn--loading');
  }

  const memo = buildPlannerMealMemo(normalizedDate, normalizedSlot, entry);
  let ingredients = [];
  let usedExpiring = false;
  if (entry.recipeId) {
    const fullRecipe = RecipeRepository.getById(entry.recipeId);
    if (fullRecipe?.ingredients?.length) {
      ingredients = [...fullRecipe.ingredients];
      const names = RecommendationService.getPantryNames();
      usedExpiring = RecommendationService.getExpiryBoost(
        MatchService.analyze(names, fullRecipe.ingredients).matchedPantryNames,
      ) > 0;
    }
  }

  const payload = {
    date: normalizedDate,
    name: recipe.name,
    mealType: 'home-cook',
    recipeId: entry.recipeId || null,
    memo,
    cost: 0,
    currency: DEFAULT_CURRENCY,
    ingredients,
    usedExpiringIngredients: usedExpiring,
    photo: '',
  };

  try {
    markMealPlanLocalMutation();
    const log = await saveMealLogToStore(payload);
    upsertMealLogLocal(log);

    MealPlanRepository.set(normalizedDate, normalizedSlot, {
      ...entry,
      recorded: true,
    });
    await persistMealPlans();

    focusCalendarOnMealRecord(normalizedDate);
    renderPlanner();
    showToast(`"${recipe.name}" 식사 기록을 추가했어요`);
  } catch (err) {
    console.error('[MealPlanner] recordPlannerMealToCalendar failed', { dateKey: normalizedDate, slotId: normalizedSlot, err });
    showToast(err?.message || '식사 기록에 실패했어요');
    if (recordBtn) {
      recordBtn.disabled = false;
      recordBtn.classList.remove('btn--loading');
    }
  } finally {
    plannerRecordingKeys.delete(recordKey);
  }
}

function handlePlannerMealRecord(dateKey, slotId) {
  if (isGuestUser()) {
    requireAppLogin({
      redirectAfterLogin: () => recordPlannerMealToCalendar(dateKey, slotId),
    });
    return;
  }
  recordPlannerMealToCalendar(dateKey, slotId);
}

function initPlannerGridDelegation() {
  if (!dom.plannerGrid || dom.plannerGrid._plannerDelegationBound) return;
  dom.plannerGrid._plannerDelegationBound = true;

  dom.plannerGrid.addEventListener('click', (e) => {
    const removeBtn = e.target.closest('[data-planner-remove]');
    if (removeBtn) {
      e.preventDefault();
      e.stopPropagation();
      const { dateKey, mealType } = readPlannerMealDataset(removeBtn);
      handlePlannerMealRemove(dateKey, mealType);
      return;
    }

    const editBtn = e.target.closest('[data-planner-edit]');
    if (editBtn) {
      e.preventDefault();
      e.stopPropagation();
      const { dateKey, mealType } = readPlannerMealDataset(editBtn);
      if (!dateKey || !mealType) return;
      if (isGuestUser()) {
        requireAppLogin({
          redirectAfterLogin: () => openPlannerRecipeSheet(dateKey, mealType, 'edit'),
        });
        return;
      }
      openPlannerRecipeSheet(dateKey, mealType, 'edit');
      return;
    }

    const recordBtn = e.target.closest('[data-planner-record]');
    if (recordBtn) {
      e.preventDefault();
      e.stopPropagation();
      if (recordBtn.disabled) return;
      const { dateKey, mealType } = readPlannerMealDataset(recordBtn);
      handlePlannerMealRecord(dateKey, mealType);
      return;
    }

    const addBtn = e.target.closest('[data-planner-date]');
    if (addBtn) {
      e.preventDefault();
      e.stopPropagation();
      openPlannerSlotSheet(addBtn.getAttribute('data-planner-date'));
    }
  });
}

function renderPlanner() {
  if (!dom.plannerGrid) return;
  const guest = isGuestUser();
  if (dom.plannerGuestHint) dom.plannerGuestHint.hidden = !guest;

  const dates = GroceryListService.getPlannerDates(state.plannerWeekStart);
  dom.plannerGrid.classList.remove('planner-grid--month');
  dom.plannerAutoBtn.hidden = false;

  dom.plannerGrid.innerHTML = dates.map((date) => plannerDayCardHTML(date)).join('');
  state.plannerAnimate = null;

  if (dom.plannerWeekLabel) dom.plannerWeekLabel.textContent = formatPlannerWeekLabel(state.plannerWeekStart);
  if (dom.groceryBudget) dom.groceryBudget.value = GroceryRepository.getBudget();
  renderGroceryList();
}

/** 주차 변경 전 DOM에 남은 예산·실금액을 현재 weekKey에 반영 */
function flushGroceryDomIntoActiveWeek() {
  // 플래너에 보이는 주차와 repo active week를 맞춘 뒤 저장
  if (state.plannerWeekStart) {
    GroceryRepository.setActiveWeek(getWeekKeyFromDateStr(state.plannerWeekStart));
  }
  if (dom.groceryBudget) {
    const domBudget = dom.groceryBudget.value;
    const repoBudget = GroceryRepository.getBudget();
    // 복원 직후 빈 input으로 기존 예산을 지우지 않음
    if (!(isWithinGroceryRestoreGuard() && domBudget === '' && repoBudget !== '' && repoBudget != null)) {
      GroceryRepository.setBudget(domBudget);
    }
  }
  dom.groceryList?.querySelectorAll('.grocery-item').forEach((row) => {
    syncGroceryAmountRow(row, { schedulePersist: false });
  });
  GroceryRepository._syncActiveWeekToByWeek();
}

function setPlannerWeek(weekStartDateStr, { flush = true, persist = true } = {}) {
  if (flush) flushGroceryDomIntoActiveWeek();
  const start = toDateStr(getWeekStartDate(weekStartDateStr));
  state.plannerWeekStart = start;
  state.plannerWeekKey = getWeekKeyFromDateStr(start);
  GroceryRepository.setActiveWeek(state.plannerWeekKey);
  // init·스냅샷 적용 전, 또는 복원 직후 레이스에는 빈 주차로 저장하지 않음
  if (persist && (isGuestUser() || groceryFirestoreReady) && !isWithinGroceryRestoreGuard(5000)) {
    markGroceryLocalMutation();
    persistGroceryState().catch((error) => {
      console.error('Failed to save grocery week', {
        uid: window.FirebaseServices?.auth?.currentUser?.uid || null,
        weekKey: state.plannerWeekKey,
        error,
      });
    });
  }
  renderPlanner();
}

function initPlannerSheets() {
  initPlannerGridDelegation();
  initPlannerSheetGestures(dom.plannerSlotSheet);
  initPlannerSheetGestures(dom.plannerRecipeSheet);
  dom.plannerRecipeTabs?.querySelectorAll('[data-planner-tab]').forEach((btn) => {
    btn.onclick = () => {
      state.plannerSheet.tab = btn.dataset.plannerTab;
      renderPlannerRecipePicker();
    };
  });
  dom.plannerRecipeSearch?.addEventListener('input', () => {
    state.plannerSheet.search = dom.plannerRecipeSearch.value;
    renderPlannerRecipePicker();
  });
  dom.plannerRecipeSearch?.addEventListener('focus', () => {
    setPlannerRecipeSheetKeyboardActive(true);
  });
  dom.plannerRecipeSearch?.addEventListener('blur', () => {
    window.setTimeout(() => {
      if (document.activeElement === dom.plannerRecipeSearch) return;
      setPlannerRecipeSheetKeyboardActive(false);
    }, 120);
  });
  document.querySelectorAll('[data-close-modal="planner-slot"], [data-close-modal="planner-recipe"]').forEach((el) => {
    el.onclick = () => closePlannerSheets();
  });
}

function findGroceryListItemByKey(key, grouped) {
  for (const cat of GROCERY_CATEGORIES) {
    const item = (grouped[cat.id] || []).find((entry) => entry.key === key);
    if (item) return item;
  }
  return null;
}

function getGroceryItemIngredientName(item) {
  if (!item) return '';
  if (item.manual && item.manualId) {
    const manual = GroceryRepository.getManualItems().find((entry) => entry.id === item.manualId);
    return manual?.name || item.name;
  }
  return item.name;
}

function findShoppingRecordForGroceryItem(itemKey, meta) {
  if (meta?.shoppingRecordId) {
    const linked = ShoppingRecordRepository.getAll().find((r) => r.id === meta.shoppingRecordId);
    if (linked) return linked;
  }
  return ShoppingRecordRepository.getAll().find((r) => r.groceryItemKey === itemKey) || null;
}

function upsertShoppingRecordLocal(record) {
  if (!record?.id) return;
  const existing = ShoppingRecordRepository.getAll().find((r) => r.id === record.id);
  if (existing) {
    ShoppingRecordRepository.update(record.id, record);
    return;
  }
  ShoppingRecordRepository._records.push({
    ...record,
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt || new Date().toISOString(),
  });
}

async function syncGroceryItemToShoppingRecord(itemKey, item, { silent = false, force = false } = {}) {
  const meta = GroceryRepository.getMeta(itemKey);
  const amount = Number(meta.actualAmount);
  const shouldRecord = force ? amount > 0 : (meta.checked && amount > 0);
  const existing = findShoppingRecordForGroceryItem(itemKey, meta);

  if (!shouldRecord) {
    if (existing) {
      await deleteShoppingRecordFromStore(existing.id);
      if (isLoggedInAppUser()) ShoppingRecordRepository.remove(existing.id);
      GroceryRepository.setShoppingRecordId(itemKey, '');
      if (state.view === 'calendar') renderCalendar();
    }
    return null;
  }

  const ingredientName = getGroceryItemIngredientName(item);
  const items = ingredientName ? [normalizeShoppingItem(ingredientName)] : [];
  const metaActual = GroceryRepository.getMeta(itemKey).actualAmount;
  const payload = {
    type: 'shopping',
    date: todayStr(),
    amount,
    store: '',
    items,
    ingredients: items.map((entry) => formatIngredientDisplay(entry)),
    recipeId: null,
    recipeName: '',
    groceryItemKey: itemKey,
    source: 'grocery',
    currency: existing?.currency || state.currency,
    ingredientsAdded: Boolean(existing?.ingredientsAdded),
    pantryAdded: Boolean(existing?.ingredientsAdded),
  };

  const saved = await saveShoppingRecordToStore(payload, existing?.id);
  upsertShoppingRecordLocal(saved);
  GroceryRepository.setShoppingRecordId(itemKey, saved.id);
  if (!silent && !existing) showToast('식사 달력에 장보기 지출이 기록됐어요');
  if (state.view === 'calendar') renderCalendar();
  return saved;
}

async function removeGroceryListItem(itemKey, grouped) {
  const item = findGroceryListItemByKey(itemKey, grouped);
  if (!item) return;
  const meta = GroceryRepository.getMeta(itemKey);
  const existing = findShoppingRecordForGroceryItem(itemKey, meta);
  if (existing) {
    await deleteShoppingRecordFromStore(existing.id);
    if (isLoggedInAppUser()) ShoppingRecordRepository.remove(existing.id);
  }
  if (item.manual && item.manualId) GroceryRepository.removeManualItem(item.manualId);
  else GroceryRepository.markItemCompleted(itemKey);
  await persistGroceryState();
  if (state.view === 'calendar') renderCalendar();
  renderGroceryList();
}

function computeGroceryActualTotal(grouped) {
  const amountsById = new Map();

  for (const cat of GROCERY_CATEGORIES) {
    for (const item of grouped?.[cat.id] || []) {
      const meta = GroceryRepository.getMeta(item.key);
      if (!meta.checked) continue;
      const id = item.key;
      // 예상가(price) 제외 — 실금액만
      amountsById.set(id, parseGroceryAmount(meta.actualAmount));
    }
  }

  for (const entry of GroceryRepository.getPurchasedLedger()) {
    const id = entry.id || entry.key;
    if (!id || amountsById.has(id)) continue;
    amountsById.set(id, parseGroceryAmount(entry.actualPrice ?? entry.actualAmount));
  }

  let total = 0;
  for (const amount of amountsById.values()) total += amount;
  return total;
}

function renderGroceryBudgetSummary(grouped) {
  if (!dom.groceryBudgetSummary) return;
  const budget = Number(GroceryRepository.getBudget()) || 0;
  const used = computeGroceryActualTotal(grouped);
  const diff = budget - used;
  const diffLabel = diff >= 0
    ? `여유 ${formatMoney(diff)}`
    : `${formatMoney(Math.abs(diff))} 초과`;
  dom.groceryBudgetSummary.textContent = `${diffLabel} · 사용 ${formatMoney(used)}`;
  dom.groceryBudgetSummary.classList.toggle('budget-box__summary--over', diff < 0);
}

function isGroceryLinkedShoppingSource(source) {
  const value = String(source || '').trim().toLowerCase();
  return value === 'grocery' || value === 'grocery-list';
}

function formatGroceryPurchaseDateLabel(entry) {
  const raw = String(entry?.purchasedAt || entry?.date || '').trim();
  if (!raw) return '';
  const date = raw.includes('T') ? new Date(raw) : parseDateStr(raw.slice(0, 10));
  if (!date || Number.isNaN(date.getTime())) return '';
  return `${date.getMonth() + 1}/${date.getDate()}`;
}

function getActiveWeekPurchasedRecords() {
  if (state.plannerWeekKey) GroceryRepository.setActiveWeek(state.plannerWeekKey);
  return GroceryRepository.getPurchasedLedger()
    .filter((entry) => {
      const entryWeek = entry.weekKey
        ? normalizeGroceryWeekKey(entry.weekKey)
        : (state.plannerWeekKey || '');
      if (entryWeek && state.plannerWeekKey && entryWeek !== state.plannerWeekKey) return false;
      return true;
    })
    .sort((a, b) => String(b.purchasedAt || '').localeCompare(String(a.purchasedAt || '')));
}

function renderGrocerySpendRecordRow(entry) {
  const purchaseId = entry.id || entry.key;
  const name = entry.name || '장보기';
  const amount = formatMoney(parseGroceryAmount(entry.actualPrice ?? entry.actualAmount));
  const dateLabel = formatGroceryPurchaseDateLabel(entry);
  const qty = String(entry.quantity || '').trim();
  const parts = [name, amount];
  if (dateLabel) parts.push(dateLabel);
  const title = parts.join(' · ');
  const sub = qty ? `<p class="day-record-row__sub">수량 ${esc(qty)}</p>` : '';
  return `
    <li class="day-record-row" data-purchase-id="${esc(purchaseId)}">
      <div class="day-record-row__main">
        <span class="day-record-row__icon" aria-hidden="true">🛒</span>
        <div class="day-record-row__content">
          <div class="day-record-row__top">
            <span class="day-record-row__title">${esc(title)}</span>
          </div>
          ${sub}
        </div>
      </div>
      <div class="day-record-row__aside">
        <div class="day-record-row__actions">
          <button type="button" class="day-record-row__link day-record-row__link--danger" data-del-purchase="${esc(purchaseId)}">삭제</button>
        </div>
      </div>
    </li>`;
}

function renderGrocerySpendSheet() {
  if (!dom.grocerySpendList) return;
  if (dom.grocerySpendSheetTitle) dom.grocerySpendSheetTitle.textContent = '이번 주 사용 내역';
  const records = getActiveWeekPurchasedRecords();
  const hasRecords = records.length > 0;
  if (dom.grocerySpendEmpty) dom.grocerySpendEmpty.hidden = hasRecords;
  if (!hasRecords) {
    dom.grocerySpendList.innerHTML = '';
    const emptyText = dom.grocerySpendEmpty?.querySelector('.empty-state__text');
    if (emptyText) emptyText.textContent = '이번 주에 기록된 장보기 내역이 없어요.';
    return;
  }
  dom.grocerySpendList.innerHTML = records.map(renderGrocerySpendRecordRow).join('');
  dom.grocerySpendList.querySelectorAll('[data-del-purchase]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      deleteGroceryPurchasedRecord(btn.dataset.delPurchase).catch((err) => {
        showToast(err?.message || '삭제에 실패했습니다.');
      });
    };
  });
}

function closeGrocerySpendSheet() {
  if (!dom.grocerySpendSheet) return;
  dom.grocerySpendSheet.hidden = true;
  dom.grocerySpendSheet.setAttribute('aria-hidden', 'true');
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

function openGrocerySpendSheet() {
  if (!dom.grocerySpendSheet) return;
  if (state.plannerWeekKey) GroceryRepository.setActiveWeek(state.plannerWeekKey);
  renderGrocerySpendSheet();
  dom.grocerySpendSheet.hidden = false;
  dom.grocerySpendSheet.setAttribute('aria-hidden', 'false');
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}

function findLinkedGroceryShoppingRecords(entry) {
  if (!entry) return [];
  const purchaseId = String(entry.id || entry.key || '').trim();
  const groceryKey = String(entry.key || entry.id || '').trim();
  const shoppingRecordId = String(entry.shoppingRecordId || '').trim();
  return ShoppingRecordRepository.getAll().filter((record) => {
    if (!isGroceryLinkedShoppingSource(record.source)) return false;
    if (shoppingRecordId && record.id === shoppingRecordId) return true;
    if (groceryKey && record.groceryItemKey === groceryKey) return true;
    if (purchaseId && record.id === purchaseId) return true;
    return false;
  });
}

async function deleteLinkedGroceryShoppingRecords(entry) {
  const linked = findLinkedGroceryShoppingRecords(entry);
  for (const record of linked) {
    await deleteShoppingRecordFromStore(record.id, { syncGrocery: false });
  }
  return linked.length;
}

async function deleteGroceryPurchasedRecord(purchaseId) {
  const confirmed = confirm(
    '이 장보기 내역을 삭제할까요?\n이번 주 사용금액과 연결된 식비 기록에서도 함께 제외됩니다.',
  );
  if (!confirmed) return;
  if (state.plannerWeekKey) GroceryRepository.setActiveWeek(state.plannerWeekKey);
  const entry = GroceryRepository.removePurchasedLedgerById(purchaseId);
  if (!entry) {
    showToast('내역을 찾을 수 없어요');
    return;
  }
  await deleteLinkedGroceryShoppingRecords(entry);
  await persistGroceryState();
  renderGrocerySpendSheet();
  renderGroceryList({ force: true });
  if (state.view === 'calendar') renderCalendar();
  showToast('장보기 내역을 삭제했어요');
}

function renderGroceryList({ force = false } = {}) {
  if (!dom.groceryList) return;
  if (!force && isGroceryListAmountEditing()) return;

  const dates = GroceryListService.getPlannerDates(state.plannerWeekStart);
  const grouped = GroceryListService.computeMissing(dates);
  const totalItems = GROCERY_CATEGORIES.reduce((n, c) => n + (grouped[c.id]?.length || 0), 0);
  dom.groceryEmpty.hidden = totalItems > 0;
  dom.groceryList.hidden = totalItems === 0;

  renderGroceryBudgetSummary(grouped);
  if (!totalItems) {
    dom.groceryList.innerHTML = '';
    return;
  }

  const sections = GROCERY_CATEGORIES.filter((cat) => grouped[cat.id]?.length).map((cat) => {
    const items = [...grouped[cat.id]].sort((a, b) => {
      const ac = GroceryRepository.getMeta(a.key).checked ? 1 : 0;
      const bc = GroceryRepository.getMeta(b.key).checked ? 1 : 0;
      return ac - bc || a.name.localeCompare(b.name, 'ko');
    });
    const rows = items.map((item) => {
      const meta = GroceryRepository.getMeta(item.key);
      const qty = !item.manual && item.count > 1 ? ` ×${item.count}` : '';
      const manualBadge = item.manual ? '<span class="grocery-item__badge">직접</span>' : '';
      const actualField = `
        <input type="text" class="grocery-item__actual" data-actual-key="${esc(item.key)}"
          inputmode="${CURRENCY_OPTIONS[state.currency]?.fractionDigits > 0 ? 'decimal' : 'numeric'}"
          placeholder="${esc(currencyAmountPlaceholder('item'))}"
          value="${meta.actualAmount !== '' && meta.actualAmount != null ? esc(String(meta.actualAmount)) : ''}"
          aria-label="${esc(item.name)} 실금액">`;
      return `
        <div class="grocery-item${meta.checked ? ' grocery-item--checked' : ''}">
          <input type="checkbox" class="grocery-item__check" data-check-key="${esc(item.key)}"${meta.checked ? ' checked' : ''} aria-label="${esc(item.name)} 구매 완료 표시">
          <span class="grocery-item__name">${manualBadge}${esc(item.name)}${qty}</span>
          ${actualField}
          <button type="button" class="grocery-item__remove" data-remove-key="${esc(item.key)}" aria-label="${esc(item.name)} 삭제">×</button>
        </div>`;
    }).join('');
    return `
      <section class="grocery-section">
        <h3 class="grocery-section__title">${cat.label}</h3>
        <div class="grocery-section__items">${rows}</div>
      </section>`;
  }).join('');

  dom.groceryList.innerHTML = sections;

  dom.groceryList.querySelectorAll('.grocery-item__check').forEach((cb) => {
    cb.onchange = () => {
      const row = cb.closest('.grocery-item');
      if (row) syncGroceryAmountRow(row, { schedulePersist: false });
      GroceryRepository.setChecked(cb.dataset.checkKey, cb.checked);
      flushPersistGroceryState().catch((error) => {
        console.error('Failed to save grocery week', {
          uid: window.FirebaseServices?.auth?.currentUser?.uid || null,
          weekKey: GroceryRepository._activeWeekKey || state.plannerWeekKey || '',
          error,
        });
      });
      renderGroceryList({ force: true });
    };
  });
  dom.groceryList.querySelectorAll('.grocery-item__remove').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      removeGroceryListItem(btn.dataset.removeKey, grouped).catch(() => showToast('삭제에 실패했습니다.'));
    };
  });
}

function initGroceryListAmountHandlers() {
  if (!dom.groceryList || dom.groceryList.dataset.amountHandlersBound) return;
  dom.groceryList.dataset.amountHandlersBound = '1';

  dom.groceryList.addEventListener('input', (e) => {
    if (!isGroceryAmountInput(e.target)) return;
    syncGroceryAmountRow(e.target.closest('.grocery-item'), { schedulePersist: true });
  });

  dom.groceryList.addEventListener('focusout', (e) => {
    if (!isGroceryAmountInput(e.target)) return;
    const row = e.target.closest('.grocery-item');
    syncGroceryAmountRow(row, { schedulePersist: false });
    window.setTimeout(() => {
      const active = document.activeElement;
      if (row?.contains(active) && isGroceryAmountInput(active)) return;
      flushPersistGroceryState().catch((error) => {
        console.error('Failed to save grocery week', {
          uid: window.FirebaseServices?.auth?.currentUser?.uid || null,
          weekKey: GroceryRepository._activeWeekKey || state.plannerWeekKey || '',
          error,
        });
      });
    }, 0);
  });
}

function autoGenerateWeeklyPlan() {
  const dates = GroceryListService.getPlannerDates(state.plannerWeekStart);
  const recipes = RecipeRepository.getRecommendableRecipes();
  const usedIds = new Set();
  const slotPrefs = {
    breakfast: new Set(['quick']),
    lunch: new Set(),
    dinner: new Set(),
    snack: new Set(['snack']),
  };

  for (const date of dates) {
    for (const slot of PLANNER_SLOTS) {
      let candidates = RecommendationService.recommend(recipes, { activeFilters: slotPrefs[slot.id] });
      candidates = candidates.filter((c) => !usedIds.has(c.recipe.id));
      if (!candidates.length) {
        candidates = RecommendationService.recommend(recipes, { activeFilters: slotPrefs[slot.id] });
      }
      candidates.sort((a, b) =>
        b.expiryBoost - a.expiryBoost
        || b.matchPercent - a.matchPercent
        || a.missing.length - b.missing.length,
      );
      const pick = candidates[0];
      if (!pick) continue;
      MealPlanRepository.set(date, slot.id, { recipeId: pick.recipe.id, name: pick.recipe.name, memo: '', recorded: false });
      usedIds.add(pick.recipe.id);
    }
  }
  markMealPlanLocalMutation();
  persistMealPlans().catch((err) => {
    console.error('[MealPlanner] autoGenerate persist failed', err);
    showToast(err?.message || '식단 저장에 실패했어요. 다시 시도해 주세요.');
  });
  renderPlanner();
  showToast('이번 주 식단을 자동으로 채웠어요');
}

async function handleGroceryPurchaseComplete() {
  if (state.plannerWeekKey) GroceryRepository.setActiveWeek(state.plannerWeekKey);
  const dates = GroceryListService.getPlannerDates(state.plannerWeekStart);
  const grouped = GroceryListService.computeMissing(dates);
  const checkedItems = [];
  const amountByKey = {};
  const names = [];
  let shoppingCount = 0;

  // 삭제 전에 실금액을 스냅샷 — 목록 제거 후에도 ledger에 남기기 위함
  for (const cat of GROCERY_CATEGORIES) {
    for (const item of grouped[cat.id] || []) {
      const row = dom.groceryList?.querySelector(`[data-actual-key="${item.key}"]`)?.closest('.grocery-item');
      if (row) syncGroceryAmountRow(row, { schedulePersist: false });
      const meta = GroceryRepository.getMeta(item.key);
      if (!meta.checked) continue;
      checkedItems.push(item);
      amountByKey[item.key] = parseGroceryAmount(meta.actualAmount);
      if (amountByKey[item.key] > 0) shoppingCount += 1;
      if (item.manual) {
        names.push(item.name);
        continue;
      }
      names.push(item.count > 1 ? `${item.name} ${item.count}개` : item.name);
    }
  }
  if (!checkedItems.length) {
    showToast('구매한 재료를 체크해 주세요');
    return;
  }
  try {
    await Promise.all(checkedItems.map((item) => {
      const amount = amountByKey[item.key] || 0;
      if (amount <= 0) return Promise.resolve();
      return syncGroceryItemToShoppingRecord(item.key, item, { silent: true, force: true });
    }));
    const shoppingRecordIds = checkedItems
      .map((item) => GroceryRepository.getMeta(item.key).shoppingRecordId)
      .filter(Boolean);
    const { added } = await PantryIngredientService.addFromNames(names, { skipDuplicates: true });
    await markShoppingRecordsIngredientsAdded(shoppingRecordIds);
    GroceryRepository.completeCheckedItems(checkedItems, amountByKey);
    await persistGroceryState();
    renderGroceryList({ force: true });
    renderGroceryBudgetSummary(
      GroceryListService.computeMissing(GroceryListService.getPlannerDates(state.plannerWeekStart)),
    );
    if (state.view === 'calendar') renderCalendar();
    const parts = [];
    if (added) parts.push(`${added}개 재료 보유 재료에 추가`);
    if (shoppingCount) parts.push(`장보기 지출 ${shoppingCount}건 기록`);
    showToast(parts.length ? `구매 완료 · ${parts.join(' · ')}` : '구매 완료했어요');
  } catch {
    showToast('구매 완료 처리에 실패했습니다.');
  }
}

// ===== Recipe Detail Page =====
function getRecipeDetailPath(recipeId) {
  return `/recipes/${encodeURIComponent(recipeId)}`;
}

function getRecipeIdFromPath(pathname = window.location.pathname) {
  const match = pathname.match(/^\/recipes\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function openRecipeDetail(result) {
  const recipe = result?.recipe || result;
  if (!recipe?.id) return;
  state.detailReturnView = state.view === 'recipe-detail' ? state.detailReturnView : state.view;
  state.detailReturnScrollY = state.view === 'recipe-detail' ? state.detailReturnScrollY : window.scrollY;
  history.replaceState({
    ...(history.state || {}),
    appView: state.detailReturnView,
    scrollY: state.detailReturnScrollY,
  }, '', window.location.href);
  history.pushState({ recipeDetail: true, recipeId: recipe.id }, '', getRecipeDetailPath(recipe.id));
  state.detailRecipeId = recipe.id;
  switchView('recipe-detail');
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

async function resolveRecipeDetail(recipeId) {
  const local = RecipeRepository.getById(recipeId);
  if (local) return local;
  const publicRecipes = window.FirebaseServices?.FirestorePublicRecipesService;
  if (!publicRecipes?.getById) return null;
  const remote = await publicRecipes.getById(recipeId);
  if (remote) {
    PublicRecipeRepository.replaceAll([...PublicRecipeRepository.getAll(), remote]);
  }
  return remote;
}

function renderRecipeDetailLoading(message = '레시피를 불러오는 중이에요') {
  if (!dom.recipeDetailContent) return;
  dom.recipeDetailContent.innerHTML = `<div class="recipe-detail-page__state"><span class="material-symbols-outlined" aria-hidden="true">progress_activity</span><p>${esc(message)}</p></div>`;
}

function renderRecipeDetailUnavailable(message = '레시피를 찾을 수 없습니다') {
  if (!dom.recipeDetailContent) return;
  dom.recipeDetailContent.innerHTML = `<div class="recipe-detail-page__state"><span class="material-symbols-outlined" aria-hidden="true">menu_book</span><p>${esc(message)}</p><button type="button" class="btn btn--outline" data-detail-back>레시피 탐색으로</button></div>`;
  dom.recipeDetailContent.querySelector('[data-detail-back]')?.addEventListener('click', leaveRecipeDetail);
}

function recipeDetailContentHTML(recipe, analysis) {
  const names = RecommendationService.getPantryNames();
  const hasPantry = names.length > 0;
  const owned = RecipeRepository.isOwned(recipe);
  const substitutionAdvices = analysis.substitutionAdvices?.length
    ? analysis.substitutionAdvices
    : MatchService.getSubstitutionAdvices(hasPantry ? analysis.missing : recipe.ingredients);
  const ingredientsHtml = hasPantry
    ? MatchService.renderMatchDetailHTML(analysis)
    : `<ul class="ingredient-list">${(recipe.ingredients || []).map((ing) => {
      const name = getIngredientMatchName(ing);
      return `<li class="ingredient-list__item ingredient-list__item--buy">
        <span>${esc(formatIngredientDisplay(ing))}</span>
        ${AffiliateService.buyButtonHTML(name, { compact: true })}
      </li>`;
    }).join('')}</ul>`;

  return `
    <article class="recipe-detail">
      <div class="recipe-detail__hero">
        ${recipeHeroHTML(recipe)}
        <div class="recipe-detail__hero-overlay"></div>
        <h1 class="recipe-detail__hero-title">${esc(recipe.name)}</h1>
      </div>
      <div class="recipe-detail__content">
        ${recipeOriginHTML(recipe)}
        ${recipeSourcePostLinkHTML(recipe)}
        <div class="recipe-detail__tags">
          ${(recipe.tags || []).map((t) => `<span class="recipe-detail__tag">${esc(t)}</span>`).join('')}
          <span class="recipe-detail__tag">${recipeVisibilityLabelHTML(recipe.visibility)}</span>
          ${isPublicCommunityRecipe(recipe) ? '' : `<span class="recipe-detail__tag">${esc(recipe.authorName || '냉장GO')}</span>`}
        </div>
        ${isPublicCommunityRecipe(recipe) ? `<div class="recipe-detail__author-wrap">${recipeAuthorRowHTML(recipe)}</div>` : ''}
        <div class="recipe-detail__stats">
          <div class="stat"><span class="stat__label">조리시간</span><span class="stat__value">${recipe.cookTime}분</span></div>
          <div class="stat"><span class="stat__label">난이도</span><span class="stat__value">${esc(recipe.difficulty)}</span></div>
          <div class="stat"><span class="stat__label">일치율</span><span class="stat__value">${analysis.matchPercent}%</span></div>
        </div>
        <section class="recipe-detail__section">
          <h3 class="recipe-detail__section-title">재료 ${hasPantry ? `<span class="recipe-detail__match-rate">일치율 ${analysis.matchPercent}%</span>` : ''}</h3>
          ${ingredientsHtml}
          ${hasPantry && analysis.missing?.length && AffiliateService.isEnabled() ? affiliateDisclosureHTML() : ''}
        </section>
        ${MatchService.renderSubstitutionGuideHTML(substitutionAdvices)}
        ${recipe.ingredientSubstitutes?.length ? `<section class="recipe-detail__section">
          <h3 class="recipe-detail__section-title">대체 가능 재료 (레시피 기록)</h3>
          <ul class="recipe-detail__substitutes">${recipe.ingredientSubstitutes.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>
        </section>` : ''}
        <section class="recipe-detail__section">
          <h3 class="recipe-detail__section-title">조리 순서</h3>
          <ol class="step-list">${(recipe.steps || []).map((s) => `<li class="step-list__item">${esc(s)}</li>`).join('')}</ol>
        </section>
        ${recipe.memo ? `<section class="recipe-detail__section"><h3 class="recipe-detail__section-title">메모</h3><p class="recipe-detail__memo">${linkifyText(recipe.memo)}</p></section>` : ''}
        <div class="recipe-detail__actions">
          <div class="recipe-detail__secondary-actions">
            <button type="button" class="btn btn--outline" data-detail-meal data-auth-required><span class="material-symbols-outlined" aria-hidden="true">restaurant</span>식사 기록</button>
            ${canForkRecipe(recipe) ? `<button type="button" class="btn btn--outline" data-detail-fork><span class="material-symbols-outlined" aria-hidden="true">content_copy</span>내 버전 만들기</button>` : ''}
          </div>
          ${owned ? `<div class="recipe-detail__owner-actions"><button type="button" class="btn btn--ghost" data-detail-edit>수정</button><button type="button" class="btn btn--danger" data-detail-delete>삭제</button></div>` : ''}
        </div>
      </div>
    </article>`;
}

function updateRecipeDetailSaveIcon(saved) {
  if (!dom.recipeDetailSaveIcon) return;
  dom.recipeDetailSaveIcon.innerHTML = saved ? HOME_CARD_BOOKMARK_ICON_FILLED : HOME_CARD_BOOKMARK_ICON;
  dom.recipeDetailSaveIcon.setAttribute('aria-label', saved ? '저장 해제' : '레시피 저장');
  dom.recipeDetailSaveIcon.classList.toggle('recipe-detail-page__icon-btn--saved', saved);
}

function updateRecipeDetailHeader(recipe) {
  if (dom.recipeDetailTitle) dom.recipeDetailTitle.textContent = recipe.name || '레시피 상세';
  updateRecipeDetailSaveIcon(SavedRecipeRepository.isSaved(recipe.id));
}

function toggleRecipeDetailSave() {
  const recipeId = state.detailRecipeId;
  if (!recipeId) return;
  requireAppLogin(() => {
    const saved = SavedRecipeRepository.toggle(recipeId);
    persistSavedRecipeIds().catch(() => undefined);
    showToast(saved ? '레시피를 저장했어요' : '저장을 해제했어요');
    updateRecipeDetailSaveIcon(saved);
    // 홈·내 레시피 목록의 저장 표시를 바로 최신화한다.
    if (state.view === 'recipe-detail') {
      renderHome();
      renderMyRecipes();
    } else {
      renderCurrentView();
    }
  });
}

function bindRecipeDetailActions(recipe) {
  const root = dom.recipeDetailContent;
  if (!root) return;
  root.querySelector('[data-detail-meal]')?.addEventListener('click', () => {
    requireAppLogin(() => openMealModal(null, { defaultDate: todayStr(), recipeId: recipe.id, mealType: 'home-cook', hideMealType: true }));
  });
  root.querySelector('[data-detail-fork]')?.addEventListener('click', () => forkRecipeFrom(recipe.id));
  root.querySelector('[data-detail-edit]')?.addEventListener('click', () => openRecipeForm(recipe.id));
  root.querySelector('[data-detail-delete]')?.addEventListener('click', () => {
    if (!confirm(`"${recipe.name}" 삭제할까요?`)) return;
    deleteUserRecipe(recipe.id)
      .then(() => { showToast('레시피를 삭제했어요'); leaveRecipeDetail(); refreshAll(); })
      .catch((err) => showToast(err.message || '삭제에 실패했습니다.'));
  });
  root.querySelector('[data-open-parent]')?.addEventListener('click', (e) => {
    const parent = RecipeRepository.getById(e.currentTarget.dataset.openParent);
    if (parent) openRecipeDetail(parent);
  });
  root.querySelector('.recipe-card-author[data-author-id]')?.addEventListener('click', (e) => {
    e.preventDefault();
    openAuthorProfile(e.currentTarget.dataset.authorId);
  });
  bindZoomableImages(root);
}

async function renderRecipeDetailPage() {
  const recipeId = state.detailRecipeId || getRecipeIdFromPath();
  if (!recipeId) return renderRecipeDetailUnavailable();
  renderRecipeDetailLoading();
  try {
    const recipe = await resolveRecipeDetail(recipeId);
    if (!recipe) return renderRecipeDetailUnavailable();
    if (recipe.visibility === 'private' && !RecipeRepository.isOwned(recipe)) {
      return renderRecipeDetailUnavailable('비공개 레시피입니다');
    }
    state.detailRecipeId = recipe.id;
    const analysis = MatchService.analyze(RecommendationService.getPantryNames(), recipe.ingredients);
    updateRecipeDetailHeader(recipe);
    dom.recipeDetailContent.innerHTML = recipeDetailContentHTML(recipe, analysis);
    bindRecipeDetailActions(recipe);
    if (isPublicCommunityRecipe(recipe) && recipe.authorId) {
      hydrateAuthorProfiles([recipe]).then(() => {
        if (state.view !== 'recipe-detail' || state.detailRecipeId !== recipe.id) return;
        const wrap = dom.recipeDetailContent?.querySelector('.recipe-detail__author-wrap');
        if (wrap) wrap.innerHTML = recipeAuthorRowHTML(recipe);
      });
    }
  } catch (err) {
    console.error('[RecipeDetail] load failed', err);
    renderRecipeDetailUnavailable('레시피를 불러오지 못했습니다');
  }
}

function leaveRecipeDetail() {
  if (history.state?.recipeDetail && history.length > 1) {
    history.back();
    return;
  }
  history.replaceState({ appView: 'main', scrollY: 0 }, '', '/');
  state.detailRecipeId = null;
  switchView('main');
  window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
}

async function shareRecipeDetail() {
  const recipe = RecipeRepository.getById(state.detailRecipeId);
  const url = new URL(getRecipeDetailPath(state.detailRecipeId), window.location.origin).href;
  const shareData = { title: recipe?.name || '냉장GO 레시피', text: recipe?.name || '냉장GO 레시피', url };
  try {
    if (navigator.share) {
      await navigator.share(shareData);
      return;
    }
    await navigator.clipboard?.writeText(url);
    showToast('레시피 링크를 복사했어요');
  } catch (err) {
    if (err?.name !== 'AbortError') showToast('링크를 복사하지 못했습니다');
  }
}

function syncRecipeDetailRouteFromLocation({ restoreScroll = false } = {}) {
  const recipeId = getRecipeIdFromPath();
  if (recipeId) {
    state.detailRecipeId = recipeId;
    switchView('recipe-detail');
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
    return;
  }
  const historyView = history.state?.appView;
  state.detailRecipeId = null;
  switchView(historyView && dom.views[historyView] ? historyView : 'main');
  if (restoreScroll) {
    requestAnimationFrame(() => window.scrollTo({ top: Number(history.state?.scrollY) || 0, left: 0, behavior: 'auto' }));
  }
}

function initRecipeDetailRouting() {
  window.addEventListener('popstate', () => syncRecipeDetailRouteFromLocation({ restoreScroll: true }));
  dom.recipeDetailBack?.addEventListener('click', leaveRecipeDetail);
  dom.recipeDetailShare?.addEventListener('click', shareRecipeDetail);
  dom.recipeDetailSaveIcon?.addEventListener('click', toggleRecipeDetailSave);
}

function updateVideoFlowStep(step) {
  if (!dom.videoFlowStepBar) return;
  dom.videoFlowStepBar.querySelectorAll('[data-video-step]').forEach((el) => {
    const n = Number(el.dataset.videoStep);
    el.classList.toggle('video-step-bar__item--active', n === step);
    el.classList.toggle('video-step-bar__item--done', n < step);
  });
}

function updateVideoFormModalTitle(tab) {
  if (!dom.formModalTitle || state.editingRecipeId) return;
  if (tab === 'review') dom.formModalTitle.textContent = '추출 결과 확인';
  else if (tab === 'video') dom.formModalTitle.textContent = '영상에서 레시피 가져오기';
  else dom.formModalTitle.textContent = '내 레시피 추가';
}

function applyRecipeFormTab(tab) {
  state.recipeFormTab = tab;
  const panels = { manual: dom.recipeFormPanelManual, video: dom.recipeFormPanelVideo, review: dom.recipeFormPanelReview };
  Object.entries(panels).forEach(([key, el]) => {
    if (!el) return;
    el.hidden = key !== tab;
  });
  dom.recipeFormTabs?.querySelectorAll('[data-recipe-tab]').forEach((btn) => {
    const active = btn.dataset.recipeTab === tab;
    btn.classList.toggle('form-tabs__btn--active', active);
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  if (dom.recipeFormTabs) dom.recipeFormTabs.hidden = tab === 'review' || Boolean(state.editingRecipeId);
  if (dom.videoFlowStepBar) {
    const showFlow = tab === 'video' || tab === 'review';
    dom.videoFlowStepBar.hidden = !showFlow;
    dom.videoFlowStepBar.setAttribute('aria-hidden', showFlow ? 'false' : 'true');
    updateVideoFlowStep(tab === 'review' ? 2 : tab === 'video' ? 1 : 0);
  }
  dom.recipeFormModal?.classList.toggle('recipe-form-modal--video-flow', tab === 'video' || tab === 'review');
  updateVideoFormModalTitle(tab);
  if (tab === 'video') AiUsageService.refreshDisplay();
}

function setRecipeFormTab(tab) {
  if (state.editingRecipeId && tab !== 'manual') return;
  applyRecipeFormTab(tab);
}

function resetVideoRecipeForm() {
  state.videoReviewDraft = null;
  state.videoLinkMeta = null;
  state.videoExtractNeedsFallback = false;
  state.videoExtractSessionUrl = null;
  state.videoDishMismatchAcknowledged = false;
  if (dom.videoSourceUrl) dom.videoSourceUrl.value = '';
  if (dom.videoUserText) dom.videoUserText.value = '';
  if (dom.videoPasteText) dom.videoPasteText.value = '';
  if (dom.videoFormError) dom.videoFormError.hidden = true;
  if (dom.videoReviewError) dom.videoReviewError.hidden = true;
  if (dom.videoVisibilityPrivate) dom.videoVisibilityPrivate.checked = true;
  if (dom.videoReviewMockNotice) dom.videoReviewMockNotice.hidden = true;
  if (dom.videoReviewPartialNotice) dom.videoReviewPartialNotice.hidden = true;
  hideVideoLinkPreview();
  hideVideoExtractWarning();
  setVideoExtractLoading(false);
  hideVideoFallback();
}

function hideVideoLinkPreview() {
  if (dom.videoLinkPreview) dom.videoLinkPreview.hidden = true;
}

function hideVideoFallback() {
  if (dom.videoFallbackSection) dom.videoFallbackSection.hidden = true;
}

function hideVideoExtractWarning() {
  if (dom.videoExtractWarning) dom.videoExtractWarning.hidden = true;
}

function showVideoExtractWarning(message = VIDEO_EXTRACT_PARTIAL_WARNING) {
  if (!dom.videoExtractWarning) return;
  dom.videoExtractWarning.textContent = message;
  dom.videoExtractWarning.hidden = false;
}

function showRecipeWarning(message) {
  if (!message) return;
  showVideoExtractWarning(message);
  if (dom.videoReviewPartialNotice) {
    dom.videoReviewPartialNotice.textContent = message;
    dom.videoReviewPartialNotice.hidden = false;
  }
}

function showVideoFallback(message = VIDEO_EXTRACT_FALLBACK_MSG, options = {}) {
  state.videoExtractNeedsFallback = true;
  if (dom.videoFallbackSection) dom.videoFallbackSection.hidden = false;
  if (dom.videoFallbackMessage) dom.videoFallbackMessage.textContent = message;
  if (options.showPartialWarning) {
    showVideoExtractWarning(options.partialWarning || VIDEO_EXTRACT_PARTIAL_WARNING);
  }
}

function showAiDailyLimitAlert(message) {
  alert(message || '무료 AI 분석 횟수를 모두 사용했어요.');
}

function setVideoExtractLoading(loading, message = '레시피를 분석하고 있어요…') {
  state.videoExtractInFlight = loading;
  dom.recipeFormPanelVideo?.classList.toggle('video-extract-panel--loading', loading);
  if (dom.videoExtractLoading) {
    dom.videoExtractLoading.hidden = !loading;
    dom.videoExtractLoading.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
  if (dom.videoExtractLoadingText && message) {
    dom.videoExtractLoadingText.textContent = message;
  }
  if (dom.videoAnalyzeBtn) {
    dom.videoAnalyzeBtn.disabled = false;
    dom.videoAnalyzeBtn.classList.toggle('btn--loading', loading);
    dom.videoAnalyzeBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
    if (loading) {
      if (!dom.videoAnalyzeBtn.dataset.prevLabel) {
        dom.videoAnalyzeBtn.dataset.prevLabel = '레시피 추출하기';
      }
      dom.videoAnalyzeBtn.textContent = message;
    } else if (dom.videoAnalyzeBtn.dataset.prevLabel) {
      dom.videoAnalyzeBtn.textContent = dom.videoAnalyzeBtn.dataset.prevLabel;
      delete dom.videoAnalyzeBtn.dataset.prevLabel;
    }
  }
  if (dom.videoFallbackAnalyzeBtn) {
    dom.videoFallbackAnalyzeBtn.disabled = false;
    dom.videoFallbackAnalyzeBtn.classList.toggle('btn--loading', loading);
    dom.videoFallbackAnalyzeBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
  if (dom.videoPasteBtn) dom.videoPasteBtn.disabled = loading;
}

function renderVideoLinkPreview(meta) {
  if (!meta || !dom.videoLinkPreview) return;
  state.videoLinkMeta = meta;
  dom.videoLinkPreview.hidden = false;

  const platformLabels = VEP().PLATFORM_LABELS || {
    youtube: 'YouTube',
    youtube_shorts: 'YouTube Shorts',
    instagram_reels: 'Instagram Reels',
    tiktok: 'TikTok',
  };
  dom.videoPreviewPlatform.textContent = platformLabels[meta.platform] || meta.platform || '';
  dom.videoPreviewTitle.textContent = meta.title || '영상 제목 확인 중';

  if (meta.thumbnailUrl) {
    dom.videoPreviewThumb.src = meta.thumbnailUrl;
    dom.videoPreviewThumb.alt = meta.title || '영상 썸네일';
    dom.videoPreviewThumb.hidden = false;
    dom.videoPreviewThumbPlaceholder.hidden = true;
  } else {
    dom.videoPreviewThumb.hidden = true;
    dom.videoPreviewThumb.removeAttribute('src');
    dom.videoPreviewThumbPlaceholder.hidden = false;
  }
}

async function updateVideoLinkPreview() {
  const raw = dom.videoSourceUrl?.value.trim();
  syncVideoUrlSession(raw);
  hideVideoFallback();
  state.videoExtractNeedsFallback = false;
  if (!raw) {
    hideVideoLinkPreview();
    state.videoLinkMeta = null;
    return;
  }
  const check = VideoRecipeAnalysisService.validateUrl(raw);
  if (!check.ok) {
    hideVideoLinkPreview();
    hideVideoExtractWarning();
    return;
  }
  if (check.platform === 'youtube' || check.platform === 'youtube_shorts') {
    hideVideoExtractWarning();
    if (dom.videoUserTextHint) {
      dom.videoUserTextHint.textContent = VideoRecipeAnalysisService.getPlatformExtractHint(check.platform);
    }
    const videoId = check.videoId || VideoRecipeAnalysisService.extractYouTubeVideoId(check.url);
    renderVideoLinkPreview({
      platform: check.platform,
      title: check.platform === 'youtube_shorts' ? 'YouTube Shorts' : 'YouTube 영상',
      thumbnailUrl: VideoRecipeAnalysisService.getYouTubeThumbnail(videoId),
      url: check.url,
    });
  } else if (check.platform === 'instagram_reels') {
    if (dom.videoUserTextHint) {
      dom.videoUserTextHint.textContent = INSTAGRAM_REELS_EXTRACT_HINT;
    }
    showVideoExtractWarning(INSTAGRAM_REELS_EXTRACT_HINT);
    const shortcode = check.videoId || VideoRecipeAnalysisService.extractInstagramShortcode(check.url);
    renderVideoLinkPreview({
      platform: check.platform,
      title: shortcode ? `Instagram Reels (${shortcode})` : 'Instagram Reels',
      thumbnailUrl: null,
      url: check.url,
    });
    try {
      const meta = await VideoRecipeAnalysisService.fetchVideoMetadata(check.url, check.platform);
      renderVideoLinkPreview({ ...meta, url: check.url });
    } catch {
      /* keep basic preview */
    }
  } else if (check.platform === 'tiktok') {
    if (dom.videoUserTextHint) {
      dom.videoUserTextHint.textContent = TIKTOK_EXTRACT_HINT;
    }
    showVideoExtractWarning(TIKTOK_EXTRACT_HINT);
    renderVideoLinkPreview({
      platform: check.platform,
      title: 'TikTok 영상',
      thumbnailUrl: null,
      url: check.url,
    });
  }
}

function showVideoFormError(msg) {
  if (!msg) return;
  showToast(msg);
  const textEl = dom.videoFormErrorText || dom.videoFormError?.querySelector?.('.video-form-error-card__text');
  if (textEl) textEl.textContent = msg;
  if (dom.videoFormError) {
    dom.videoFormError.hidden = false;
    dom.videoFormError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function showVideoReviewError(msg) {
  const textEl = dom.videoReviewErrorText || dom.videoReviewError;
  if (textEl) textEl.textContent = msg;
  if (dom.videoReviewError) {
    dom.videoReviewError.hidden = false;
    dom.videoReviewError.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

function fillVideoReviewForm(draft) {
  state.videoReviewDraft = { ...draft };
  dom.videoReviewSourceLink.href = draft.sourceUrl;
  dom.videoReviewSourceLink.textContent = draft.sourceUrl;
  dom.videoReviewName.value = draft.name;
  dom.videoReviewIngredients.value = (draft.ingredients || []).map(formatIngredientDisplay).join('\n');
  dom.videoReviewOptional.value = (draft.optionalIngredients || []).map(formatIngredientDisplay).join('\n');
  dom.videoReviewSubstitutes.value = (draft.substitutes || []).join('\n');
  dom.videoReviewSteps.value = draft.steps.join('\n');
  dom.videoReviewCookTime.value = draft.cookTime;
  dom.videoReviewDifficulty.value = draft.difficulty;
  dom.videoReviewCategory.value = draft.category;
  dom.videoReviewError.hidden = true;

  const platformLabels = VEP().PLATFORM_LABELS || {
    youtube: 'YouTube',
    youtube_shorts: 'YouTube Shorts',
    instagram: 'Instagram',
    instagram_reels: 'Instagram Reels',
    tiktok: 'TikTok',
  };
  if (draft.thumbnailUrl && dom.videoReviewPreview) {
    dom.videoReviewPreview.hidden = false;
    dom.videoReviewThumb.src = draft.thumbnailUrl;
    dom.videoReviewThumb.alt = draft.name;
    dom.videoReviewPlatform.textContent = platformLabels[draft.sourcePlatform] || draft.sourcePlatform || '';
    dom.videoReviewTitleHint.textContent = draft.videoTitle || draft.name;
  } else if (dom.videoReviewPreview) {
    dom.videoReviewPreview.hidden = true;
  }
  if (dom.videoReviewMockNotice) {
    dom.videoReviewMockNotice.hidden = !draft._isMockData;
  }
  if (dom.videoReviewPartialNotice) {
    const warning = draft._warning || draft._videoExtractWarning || draft._infoHint;
    dom.videoReviewPartialNotice.hidden = !warning;
    if (warning) dom.videoReviewPartialNotice.textContent = warning;
  }
}

function handleVideoAuthError(mapped) {
  if (!mapped?.requireLogin) return false;
  showToast(mapped.message || '로그인이 필요해요.');
  requireAppLogin({
    preset: 'videoRecipe',
    redirectAfterLogin: () => handleVideoExtract(),
  });
  return true;
}

async function handleVideoExtract() {
  if (state.videoExtractInFlight) {
    showToast('레시피 분석이 진행 중이에요…');
    return;
  }

  setVideoExtractLoading(true, '로그인 상태 확인 중…');
  try {
    await ensureVideoAuthReady();
  } catch (err) {
    setVideoExtractLoading(false);
    showVideoFormError('로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    return;
  }
  setVideoExtractLoading(false);

  if (!isLoggedInAppUser()) {
    showToast('로그인이 필요해요.');
    requireAppLogin({
      preset: 'videoRecipe',
      redirectAfterLogin: () => handleVideoExtract(),
    });
    return;
  }

  if (dom.videoFormError) dom.videoFormError.hidden = true;
  hideVideoFallback();
  hideVideoExtractWarning();

  const sourceUrl = dom.videoSourceUrl?.value?.trim() || '';
  if (!sourceUrl) {
    showVideoFormError('영상 링크를 입력해 주세요.');
    return;
  }

  const check = VideoRecipeAnalysisService.validateUrl(sourceUrl);
  if (!check.ok) {
    showVideoFormError(check.error);
    return;
  }

  const duplicateResult = checkVideoSourceDuplicate(sourceUrl);
  if (duplicateResult.isDuplicate) {
    showToast(VIDEO_DUPLICATE_TOAST);
    return;
  }

  if (!assertVideoAnalysisQuotaAvailable()) return;

  clearVideoExtractStateBeforeExtract(sourceUrl);
  setVideoExtractLoading(true, '영상 정보를 확인하고 있어요…');

  try {
    const textPayload = VideoRecipeAnalysisService.collectVideoTextPayload(sourceUrl);
    setVideoExtractLoading(true, 'AI가 레시피를 정리하고 있어요…');
    let result = await VideoRecipeAnalysisService.extractViaApi(sourceUrl, textPayload);
    if (!result) {
      throw new Error('레시피 추출 결과가 비어 있습니다.');
    }
    let proceed = await proceedWithVideoExtractResult(result, sourceUrl, textPayload);
    if (!proceed) {
      clearVideoExtractStateBeforeExtract(sourceUrl);
      setVideoExtractLoading(true, 'AI가 레시피를 다시 정리하고 있어요…');
      result = await VideoRecipeAnalysisService.extractViaApi(sourceUrl, textPayload);
      if (!result) throw new Error('레시피 추출 결과가 비어 있습니다.');
      proceed = await proceedWithVideoExtractResult(result, sourceUrl, textPayload);
      if (!proceed) showToast('추출을 취소했어요. 링크나 캡션을 확인해 주세요.');
    }
  } catch (err) {
    logVideoExtractError('handleVideoExtract', err, { sourceUrl });
    if (err.code === 'DUPLICATE_VIDEO_SOURCE') {
      showToast(VIDEO_DUPLICATE_TOAST);
      return;
    }
    if (err.code === 'DAILY_LIMIT_EXCEEDED' || err.code === 'ANALYSIS_LIMIT_EXCEEDED') {
      showToast(err.message || '이번 주 무료 AI 분석 횟수를 모두 사용했어요.');
      AiUsageService.updateDisplay(err.aiUsage || { remaining: 0, limit: AiUsageService.getDailyLimit() });
      return;
    }
    if (err.code === 'AUTH_REQUIRED' || err.code === 'AUTH_TOKEN_UNAVAILABLE' || err.code === 'INVALID_ID_TOKEN') {
      const mappedAuth = mapVideoExtractUserError(err, err.apiResponse);
      if (handleVideoAuthError(mappedAuth)) return;
    }
    const mapped = mapVideoExtractUserError(err, err.apiResponse);
    if (mapped.requireLogin && handleVideoAuthError(mapped)) return;
    if (mapped.showFallback || err.code === 'FALLBACK') {
      if (err.warning) showVideoExtractWarning(err.warning);
      else if (err.infoHint) showVideoExtractWarning(err.infoHint);
      showVideoFallback(mapped.message);
      showToast(mapped.message);
    } else {
      showVideoFormError(mapped.message);
    }
  } finally {
    setVideoExtractLoading(false);
  }
}

async function handleVideoFallbackAnalyze() {
  setVideoExtractLoading(true, '로그인 상태 확인 중…');
  try {
    await ensureVideoAuthReady();
  } catch {
    setVideoExtractLoading(false);
    showVideoFormError('로그인 상태를 확인하지 못했어요. 잠시 후 다시 시도해 주세요.');
    return;
  }
  setVideoExtractLoading(false);

  if (!isLoggedInAppUser()) {
    showToast('로그인이 필요해요.');
    requireAppLogin({
      preset: 'videoRecipe',
      redirectAfterLogin: () => handleVideoFallbackAnalyze(),
    });
    return;
  }
  if (dom.videoFormError) dom.videoFormError.hidden = true;
  const sourceUrl = dom.videoSourceUrl.value.trim();
  clearVideoExtractStateBeforeExtract(sourceUrl);
  const textPayload = VideoRecipeAnalysisService.collectVideoTextPayload(sourceUrl);

  if (!textPayload.pastedText || textPayload.pastedText.length < 20) {
    return showVideoFormError('영상 설명글이나 캡션을 20자 이상 붙여넣어 주세요.');
  }

  const check = VideoRecipeAnalysisService.validateUrl(sourceUrl);
  if (!check.ok) return showVideoFormError(check.error);

  const duplicateResult = checkVideoSourceDuplicate(sourceUrl);
  if (duplicateResult.isDuplicate) {
    showToast(VIDEO_DUPLICATE_TOAST);
    return;
  }
  if (!assertVideoAnalysisQuotaAvailable()) return;

  setVideoExtractLoading(true, '붙여넣은 텍스트를 분석하고 있어요…');

  try {
    setVideoExtractLoading(true, 'AI가 레시피를 정리하고 있어요…');
    const result = await VideoRecipeAnalysisService.extractViaApi(sourceUrl, textPayload);
    if (!result) throw new Error('레시피 추출 결과가 비어 있습니다.');
    const proceed = await proceedWithVideoExtractResult(result, sourceUrl, textPayload);
    if (!proceed) {
      showToast('추출을 취소했어요. 캡션을 확인한 뒤 다시 시도해 주세요.');
      return;
    }
    hideVideoFallback();
    hideVideoExtractWarning();
    dom.videoPasteText.value = '';
  } catch (err) {
    logVideoExtractError('handleVideoFallbackAnalyze', err, { sourceUrl });
    if (err.code === 'DUPLICATE_VIDEO_SOURCE') {
      showToast(VIDEO_DUPLICATE_TOAST);
      return;
    }
    if (err.code === 'DAILY_LIMIT_EXCEEDED' || err.code === 'ANALYSIS_LIMIT_EXCEEDED') {
      showToast(err.message || '이번 주 무료 AI 분석 횟수를 모두 사용했어요.');
      AiUsageService.updateDisplay(err.aiUsage || { remaining: 0, limit: AiUsageService.getDailyLimit() });
      return;
    }
    const mapped = mapVideoExtractUserError(err, err.apiResponse);
    showVideoFormError(mapped.message);
  } finally {
    setVideoExtractLoading(false);
  }
}

function handleVideoRecipeSave() {
  if (!isLoggedInAppUser()) {
    requireAppLogin({
      preset: 'videoRecipe',
      redirectAfterLogin: () => handleVideoRecipeSave(),
    });
    return;
  }
  dom.videoReviewError.hidden = true;
  const draft = state.videoReviewDraft;
  if (!draft?.sourceUrl) return showVideoReviewError('영상 링크 정보가 없습니다. 다시 입력해 주세요.');

  const name = dom.videoReviewName.value.trim();
  const requiredIngredients = parseIngredientList(dom.videoReviewIngredients.value);
  const optionalIngredients = parseIngredientList(dom.videoReviewOptional.value);
  const ingredients = VideoRecipeAnalysisService.buildIngredientsForSave(
    requiredIngredients,
    optionalIngredients
  );
  const steps = parseStepList(dom.videoReviewSteps.value);
  const substitutes = parseIngredientList(dom.videoReviewSubstitutes.value);
  const cookTime = Number(dom.videoReviewCookTime.value) || 20;
  const difficulty = dom.videoReviewDifficulty.value;
  const category = dom.videoReviewCategory.value;
  const visibility = dom.videoVisibilityPublic.checked ? 'public' : 'private';

  if (!name) return showVideoReviewError('레시피 이름을 입력해 주세요.');
  if (!requiredIngredients.length) return showVideoReviewError('재료를 입력해 주세요.');
  if (!steps.length) return showVideoReviewError('조리 순서를 입력해 주세요.');

  if (draft.dishNameMismatch && !draft._dishMismatchAcknowledged) {
    const detected = draft.sourceDetectedDishName || draft.detectedDishName || draft.videoTitle || '';
    const detectedLabel = String(detected).replace(/\s*[-|｜].*$/, '').trim().slice(0, 40) || '영상 요리';
    const saveAnyway = window.confirm(
      `영상은 "${detectedLabel}"(으)로 보이는데, 저장하려는 레시피는 "${name}"입니다. 그래도 저장할까요?`
    );
    if (!saveAnyway) {
      return showVideoReviewError('영상 내용과 추출 결과가 달라 보여요. 레시피 이름을 확인하거나 다시 추출해 주세요.');
    }
    draft._dishMismatchAcknowledged = true;
  }

  const uid = window.FirebaseServices?.auth?.currentUser?.uid || null;
  console.log('[handleVideoRecipeSave] 영상 레시피 Firestore 저장', {
    uid,
    path: uid ? `users/${uid}/myRecipes/{recipeId}` : null,
    visibility,
    loggedIn: isLoggedInAppUser(),
  });

  saveUserRecipe({
    name,
    ingredients,
    optionalIngredients,
    steps,
    cookTime,
    difficulty,
    category,
    memo: '',
    visibility,
    image: draft.thumbnailUrl || '',
    sourceUrl: draft.sourceUrl,
    normalizedVideoId: draft.normalizedVideoId || null,
    normalizedSourceUrl: draft.normalizedSourceUrl || null,
    sourcePlatform: draft.sourcePlatform || null,
    thumbnailUrl: draft.thumbnailUrl || null,
    ingredientSubstitutes: substitutes,
    createdFrom: '영상 레시피',
  })
    .then(() => {
      resetVideoRecipeForm();
      setRecipeFormTab('manual');
      closeModal('form');
      refreshAll();
      showToast(`"${name}"을(를) 내 레시피로 저장했어요`);
    })
    .catch((err) => {
      if (err?.code === 'DUPLICATE_VIDEO_SOURCE') {
        showToast(VIDEO_DUPLICATE_TOAST);
        return;
      }
      if (err?.code === 'permission-denied') {
        console.error('[handleVideoRecipeSave] PERMISSION_DENIED', {
          uid: window.FirebaseServices?.auth?.currentUser?.uid || null,
          path: uid ? `users/${uid}/myRecipes/{recipeId}` : null,
          message: err.message,
        });
      }
      showVideoReviewError(err.message || '저장에 실패했습니다.');
    });
}

const COOK_TIME_WHEEL_OPTIONS = [5, 10, 15, 20, 25, 30, 40, 50, 60, 90, 120];
const COOK_TIME_WHEEL_DEFAULT = 30;
const COOK_TIME_WHEEL_ITEM_HEIGHT = 44; // (134px wheel - 2px border) / 3

let cookTimeWheelBound = false;
let cookTimeWheelScrollTimer = null;
let cookTimeWheelIgnoreScroll = false;
let cookTimeWheelActiveIndex = -1;

function nearestCookTimeWheelOption(minutes) {
  const n = Number(minutes);
  if (!Number.isFinite(n) || n <= 0) return COOK_TIME_WHEEL_DEFAULT;
  let best = COOK_TIME_WHEEL_OPTIONS[0];
  let bestDiff = Math.abs(best - n);
  for (const opt of COOK_TIME_WHEEL_OPTIONS) {
    const diff = Math.abs(opt - n);
    if (diff < bestDiff) {
      best = opt;
      bestDiff = diff;
    }
  }
  return best;
}

function getCookTimeWheelElements() {
  const root = document.querySelector('[data-cook-time-wheel]');
  const list = root?.querySelector('.cook-time-wheel__list');
  return { root, list };
}

function cookTimeWheelIndexFromScroll(list) {
  if (!list) return 0;
  const raw = Math.round(list.scrollTop / COOK_TIME_WHEEL_ITEM_HEIGHT);
  return Math.max(0, Math.min(COOK_TIME_WHEEL_OPTIONS.length - 1, raw));
}

function updateCookTimeWheelActiveItem(list, index) {
  if (!list || index === cookTimeWheelActiveIndex) return;
  cookTimeWheelActiveIndex = index;
  setCookTimeWheelFormValue(index);
  list.querySelectorAll('.cook-time-wheel__item').forEach((el, i) => {
    el.classList.toggle('cook-time-wheel__item--active', i === index);
    el.setAttribute('aria-selected', i === index ? 'true' : 'false');
  });
}

function setCookTimeWheelFormValue(index) {
  const value = COOK_TIME_WHEEL_OPTIONS[index];
  if (value == null || !dom.formCookTime) return;
  const next = String(value);
  if (dom.formCookTime.value !== next) dom.formCookTime.value = next;
}

function scrollCookTimeWheelToIndex(list, index, { smooth = false } = {}) {
  if (!list) return;
  const targetTop = index * COOK_TIME_WHEEL_ITEM_HEIGHT;
  cookTimeWheelIgnoreScroll = true;
  if (smooth) {
    list.scrollTo({ top: targetTop, behavior: 'smooth' });
  } else {
    list.scrollTop = targetTop;
  }
  window.setTimeout(() => { cookTimeWheelIgnoreScroll = false; }, smooth ? 280 : 0);
}

function syncCookTimeWheelValue(minutes, { scroll = true, smooth = false } = {}) {
  const value = nearestCookTimeWheelOption(minutes);
  if (dom.formCookTime) dom.formCookTime.value = String(value);
  const { list } = getCookTimeWheelElements();
  if (!list) return value;
  const index = COOK_TIME_WHEEL_OPTIONS.indexOf(value);
  updateCookTimeWheelActiveItem(list, index);
  if (scroll) {
    const applyScroll = () => scrollCookTimeWheelToIndex(list, index, { smooth });
    if (list.clientHeight > 0) applyScroll();
    else requestAnimationFrame(applyScroll);
  }
  return value;
}

function commitCookTimeWheelFromScroll(list) {
  if (!list) return;
  const index = cookTimeWheelIndexFromScroll(list);
  updateCookTimeWheelActiveItem(list, index);
  setCookTimeWheelFormValue(index);
  const targetTop = index * COOK_TIME_WHEEL_ITEM_HEIGHT;
  if (Math.abs(list.scrollTop - targetTop) > 0.5) {
    scrollCookTimeWheelToIndex(list, index, { smooth: true });
  }
}

function buildCookTimeWheelItems(list) {
  if (!list) return;
  cookTimeWheelActiveIndex = -1;
  list.innerHTML = COOK_TIME_WHEEL_OPTIONS.map((minutes) => (
    `<li class="cook-time-wheel__item" role="option" data-cook-time="${minutes}" aria-selected="false">${minutes}분</li>`
  )).join('');
}

function initCookTimeWheel() {
  const { root, list } = getCookTimeWheelElements();
  if (!root || !list || cookTimeWheelBound) return;
  cookTimeWheelBound = true;
  buildCookTimeWheelItems(list);

  list.addEventListener('scroll', () => {
    if (cookTimeWheelIgnoreScroll) return;
    // 인덱스가 바뀔 때만 하이라이트 갱신. 폼 값은 스크롤 종료 시 한 번 반영
    updateCookTimeWheelActiveItem(list, cookTimeWheelIndexFromScroll(list));
    clearTimeout(cookTimeWheelScrollTimer);
    cookTimeWheelScrollTimer = setTimeout(() => commitCookTimeWheelFromScroll(list), 100);
  }, { passive: true });

  list.addEventListener('scrollend', () => {
    if (cookTimeWheelIgnoreScroll) return;
    clearTimeout(cookTimeWheelScrollTimer);
    commitCookTimeWheelFromScroll(list);
  });

  // 모달 세로 스크롤과 휠 스크롤 충돌 완화 (기본 pan-y는 유지)
  list.addEventListener('touchstart', (e) => e.stopPropagation(), { passive: true });
  list.addEventListener('touchmove', (e) => e.stopPropagation(), { passive: true });
  list.addEventListener('wheel', (e) => e.stopPropagation(), { passive: true });

  list.querySelectorAll('[data-cook-time]').forEach((item) => {
    item.addEventListener('click', () => {
      syncCookTimeWheelValue(item.dataset.cookTime, { scroll: true, smooth: true });
    });
  });

  requestAnimationFrame(() => {
    syncCookTimeWheelValue(dom.formCookTime?.value || COOK_TIME_WHEEL_DEFAULT, { scroll: true, smooth: false });
  });
}

function prepareRecipeForm(id = null, { prefillName = '' } = {}) {
  state.editingRecipeId = id;
  state.formImage = null;
  state.videoReviewDraft = null;
  dom.formError.hidden = true;
  if (dom.videoFormError) dom.videoFormError.hidden = true;
  if (dom.videoReviewError) dom.videoReviewError.hidden = true;
  dom.recipeForm.reset();
  resetVideoRecipeForm();
  updatePhotoPreview(null);

  if (id) {
    if (dom.recipeFormTabs) dom.recipeFormTabs.hidden = true;
    setRecipeFormTab('manual');
    const r = RecipeRepository.getById(id);
    if (!r) return false;
    dom.formModalTitle.textContent = r.parentRecipeId ? '내 버전 수정' : '레시피 수정';
    dom.formName.value = r.name;
    dom.formIngredients.value = r.ingredients
      .filter((ing) => !isOptionalIngredient(ing))
      .map(formatIngredientDisplay)
      .join('\n');
    syncCookTimeWheelValue(r.cookTime, { scroll: true });
    dom.formDifficulty.value = r.difficulty;
    dom.formSteps.value = r.steps.join('\n');
    dom.formCategory.value = r.category;
    dom.formMemo.value = r.memo;
    (r.visibility === 'public' ? dom.formVisibilityPublic : dom.formVisibilityPrivate).checked = true;
    if (hasPhoto(r.image)) { state.formImage = r.image; updatePhotoPreview(r.image); }
  } else {
    dom.formModalTitle.textContent = '내 레시피 추가';
    if (dom.recipeFormTabs) dom.recipeFormTabs.hidden = false;
    dom.formVisibilityPrivate.checked = true;
    setRecipeFormTab('manual');
    if (prefillName) dom.formName.value = prefillName;
    syncCookTimeWheelValue(COOK_TIME_WHEEL_DEFAULT, { scroll: true });
  }
  return true;
}

// ===== Recipe Form =====
function openRecipeForm(id = null, options = {}) {
  if (!options.fromPlanner) state.plannerPendingMeal = null;
  if (!isLoggedInAppUser()) {
    requireAppLogin({
      redirectAfterLogin: () => openRecipeForm(id, options),
    });
    return;
  }
  if (id && !RecipeRepository.getById(id)) return;
  if (!prepareRecipeForm(id, options)) return;
  openModal('form');
  requestAnimationFrame(() => {
    syncCookTimeWheelValue(dom.formCookTime?.value || COOK_TIME_WHEEL_DEFAULT, { scroll: true });
    if (options.prefillName && !id) {
      dom.formIngredients?.focus();
    } else {
      dom.formName.focus();
    }
  });
}

function handleRecipeFormSubmit(e) {
  e.preventDefault();
  if (!isLoggedInAppUser()) {
    requireAppLogin(() => handleRecipeFormSubmit(e));
    return;
  }
  dom.formError.hidden = true;
  const data = {
    name: dom.formName.value.trim(),
    ingredients: normalizeIngredientList(parseIngredientList(dom.formIngredients.value)),
    cookTime: Number(dom.formCookTime.value),
    difficulty: dom.formDifficulty.value,
    steps: parseStepList(dom.formSteps.value),
    category: dom.formCategory.value,
    memo: dom.formMemo.value.trim(),
    visibility: dom.formVisibilityPublic.checked ? 'public' : 'private',
    image: state.formImage || '',
  };
  if (!data.name) return showError('레시피 이름을 입력해 주세요.');
  if (!data.ingredients.length) return showError('재료를 입력해 주세요.');
  if (!COOK_TIME_WHEEL_OPTIONS.includes(Number(data.cookTime))) {
    data.cookTime = nearestCookTimeWheelOption(data.cookTime);
    if (dom.formCookTime) dom.formCookTime.value = String(data.cookTime);
  }
  if (!data.cookTime) return showError('조리시간을 선택해 주세요.');
  if (!data.steps.length) return showError('조리 순서를 입력해 주세요.');

  if (state.editingRecipeId && !data.image) {
    const existing = RecipeRepository.getById(state.editingRecipeId);
    if (existing?.image) data.image = existing.image;
  }

  const editingId = state.editingRecipeId;
  saveUserRecipe(data, editingId)
    .then((saved) => {
      const pending = state.plannerPendingMeal;
      closeModal('form');
      refreshAll();
      if (!editingId && pending?.date && pending?.slot && saved) {
        const recipeId = saved.id || saved.firestoreId;
        setPlannerMeal(pending.date, pending.slot, {
          type: 'recipe',
          recipeId,
          name: saved.name || data.name,
          memo: '',
          recorded: false,
        }, { animate: true });
        const slotLabel = plannerSlotInfo(pending.slot).label;
        showToast(`${slotLabel}에 ${saved.name || data.name}을(를) 추가했어요`);
      }
    })
    .catch((err) => showError(err.message || '레시피 저장에 실패했습니다.'));
}

function showError(msg) { dom.formError.textContent = msg; dom.formError.hidden = false; }

const RECIPE_PHOTO_EMPTY_HTML = `
  <span class="recipe-photo-upload__icon" aria-hidden="true">
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="12" cy="13" r="4" stroke="currentColor" stroke-width="1.5"/>
    </svg>
  </span>
  <span class="recipe-photo-upload__title">사진을 추가하세요</span>
  <span class="recipe-photo-upload__hint">클릭하여 업로드</span>
  <span class="recipe-photo-upload__formats">JPG, PNG, HEIC</span>`;

function renderRecipePhotoEmpty() {
  if (!dom.photoPreview) return;
  dom.photoPreview.className = 'recipe-photo-upload__zone recipe-photo-upload__zone--empty';
  dom.photoPreview.setAttribute('aria-label', '사진 업로드');
  dom.photoPreview.innerHTML = RECIPE_PHOTO_EMPTY_HTML;
  if (dom.photoRemoveBtn) dom.photoRemoveBtn.hidden = true;
}

function updatePhotoPreview(src) {
  if (!dom.photoPreview) return;
  if (hasPhoto(src)) {
    dom.photoPreview.className = 'recipe-photo-upload__zone recipe-photo-upload__zone--filled';
    dom.photoPreview.setAttribute('aria-label', '사진 변경');
    dom.photoPreview.innerHTML = `<img src="${src}" alt="레시피 사진 미리보기">`;
    if (dom.photoRemoveBtn) dom.photoRemoveBtn.hidden = false;
  } else {
    renderRecipePhotoEmpty();
  }
}

function handleRecipePhotoFile(file) {
  if (!file) return;
  if (!file.type?.startsWith('image/')) {
    showError('이미지 파일만 업로드할 수 있어요.');
    return;
  }
  compressImage(file)
    .then((dataUrl) => {
      state.formImage = dataUrl;
      updatePhotoPreview(dataUrl);
    })
    .catch((err) => showError(err.message || '이미지를 불러오지 못했어요.'));
}

function initRecipePhotoUpload() {
  if (!dom.photoPreview || !dom.formPhoto) return;

  dom.photoPreview.addEventListener('click', () => dom.formPhoto.click());
  dom.formPhoto.addEventListener('change', (e) => {
    handleRecipePhotoFile(e.target.files?.[0]);
    e.target.value = '';
  });

  dom.photoRemoveBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    state.formImage = null;
    dom.formPhoto.value = '';
    updatePhotoPreview(null);
  });

  const root = dom.recipePhotoUpload;
  if (!root) return;

  let dragDepth = 0;
  const setDragOver = (on) => root.classList.toggle('recipe-photo-upload--dragover', on);

  root.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth += 1;
    setDragOver(true);
  });
  root.addEventListener('dragover', (e) => {
    e.preventDefault();
    setDragOver(true);
  });
  root.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) setDragOver(false);
  });
  root.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    setDragOver(false);
    const file = e.dataTransfer?.files?.[0];
    handleRecipePhotoFile(file);
  });
}

// ===== Grocery Item Modal =====
function openGroceryItemModal() {
  dom.groceryItemModalForm?.reset();
  if (dom.groceryItemModalTitle) dom.groceryItemModalTitle.textContent = '물품 추가';
  openModal('grocery-item');
  requestAnimationFrame(() => dom.groceryItemName?.focus());
}

function handleGroceryItemModalSubmit(e) {
  e.preventDefault();
  const name = dom.groceryItemName?.value.trim();
  if (!name) {
    showToast('물품명을 입력해 주세요');
    dom.groceryItemName?.focus();
    return;
  }
  const item = GroceryRepository.addManualItem({
    name,
    quantity: dom.groceryItemQuantity?.value.trim() || '',
    unit: dom.groceryItemUnit?.value || '',
    price: '',
  });
  if (!item) return;
  persistGroceryState().catch((error) => {
    console.error('Failed to save grocery week', {
      uid: window.FirebaseServices?.auth?.currentUser?.uid || null,
      weekKey: GroceryRepository._activeWeekKey || state.plannerWeekKey || '',
      data: item,
      error,
    });
  });
  closeModal('grocery-item');
  renderGroceryList();
  showToast('장보기 목록에 추가했어요');
}

// ===== Pantry Modal =====
function openPantryModal(id = null) {
  if (!isLoggedInAppUser()) {
    requireAppLogin(() => openPantryModal(id));
    return;
  }
  state.editingPantryId = id;
  dom.pantryModalForm.reset();
  RecipePickerService.clear(state.pantryRecipePicker);
  dom.pantryModalTitle.textContent = id ? '재료 수정' : '재료 추가';
  if (id) {
    const item = getPantryItemsForUi().find((x) => x.id === id);
    if (!item) return;
    dom.pantryModalName.value = item.name;
    dom.pantryModalQty.value = item.quantity;
    dom.pantryModalUnit.value = item.unit;
    dom.pantryModalExpiry.value = item.expiryDate;
    if (item.recipeId) {
      const recipe = RecipeRepository.getById(item.recipeId);
      if (recipe) RecipePickerService.setSelection(state.pantryRecipePicker, recipe);
      else if (item.recipeName) dom.pantryRecipeInput.value = item.recipeName;
    } else if (item.recipeName) {
      dom.pantryRecipeInput.value = item.recipeName;
    }
  }
  openModal('pantry');
}

async function handlePantryModalSubmit(e) {
  e.preventDefault();
  const name = dom.pantryModalName.value.trim();
  if (!name) return;
  const resolved = RecipePickerService.resolve(dom.pantryRecipeInput, dom.pantryRecipeId);
  const data = {
    name,
    quantity: dom.pantryModalQty.value.trim(),
    unit: dom.pantryModalUnit.value,
    expiryDate: dom.pantryModalExpiry.value,
    recipeId: resolved?.id || null,
    recipeName: resolved?.name || dom.pantryRecipeInput.value.trim(),
  };
  try {
    const wasGuest = !isLoggedInAppUser();
    if (state.editingPantryId) await updatePantryItem(state.editingPantryId, data);
    else await createPantryItem(data);
    closeModal('pantry');
    refreshAll();
  } catch (err) {
    handlePantryFirestoreError(err);
  }
}

function initVideoExtractUi() {
  bindVideoExtractClick();
  dom.videoPasteBtn?.addEventListener('click', async () => {
    try {
      const text = await navigator.clipboard.readText();
      if (!text?.trim()) {
        showToast('클립보드에 링크가 없어요.');
        return;
      }
      if (dom.videoSourceUrl) {
        dom.videoSourceUrl.value = text.trim();
        updateVideoLinkPreview();
        dom.videoSourceUrl.focus();
      }
    } catch {
      showToast('붙여넣기 권한이 필요해요. 입력칸에 직접 붙여넣어 주세요.');
      dom.videoSourceUrl?.focus();
    }
  });
  dom.videoSourceUrl?.addEventListener('paste', () => {
    window.setTimeout(updateVideoLinkPreview, 0);
  });
  dom.openVideoRecipeFormBtn?.addEventListener('click', (e) => {
    e.preventDefault();
    openVideoRecipeForm();
  });
}

function initRecipePickers() {
  state.shoppingRecipePicker = RecipePickerService.init({
    inputEl: dom.shoppingRecipeInput,
    hiddenEl: dom.shoppingRecipeId,
    listEl: dom.shoppingRecipeSuggestions,
    onSelect(recipe) {
      if (recipe && dom.shoppingIngredients && !dom.shoppingIngredients.value.trim()) {
        dom.shoppingIngredients.value = recipe.ingredients.map(formatIngredientDisplay).join('\n');
      }
    },
  });
  state.pantryRecipePicker = RecipePickerService.init({
    inputEl: dom.pantryRecipeInput,
    hiddenEl: dom.pantryRecipeId,
    listEl: dom.pantryRecipeSuggestions,
  });
}

// ===== Quick Add =====
// 추가 버튼(type=submit) · Enter → form submit → handleQuickAdd
async function handleQuickAdd(e) {
  e.preventDefault();
  if (state.isComposing) return;
  if (!isLoggedInAppUser()) {
    requireAppLogin(() => handleQuickAdd(e));
    return;
  }
  const val = dom.quickInput.value.trim();
  if (!val) return;

  const names = val.split(/[,，、]/).map((s) => s.trim()).filter(Boolean);
  let added = 0;
  try {
    for (const name of names) {
      const dup = getPantryItemsForUi().some((i) => MatchService.normalize(i.name) === MatchService.normalize(name));
      if (dup) continue;
      await createPantryItem({ name, quantity: '', unit: '', expiryDate: '' }, { showGuestHint: false });
      added += 1;
    }
    dom.quickInput.value = '';
    if (added > 0) notifyGuestPantryNotPersisted();
    refreshAll();
  } catch (err) {
    handlePantryFirestoreError(err);
  }
}

// ===== Modals =====
function updateBodyScrollLock() {
  const anyOpen = !dom.recipeFormModal.hidden
    || !dom.pantryModal.hidden
    || !dom.mealModal.hidden
    || !dom.shoppingModal.hidden
    || (dom.groceryItemModal && !dom.groceryItemModal.hidden)
    || (dom.calendarDaySheet && !dom.calendarDaySheet.hidden)
    || (dom.calendarExpenseSheet && !dom.calendarExpenseSheet.hidden)
    || (dom.grocerySpendSheet && !dom.grocerySpendSheet.hidden)
    || (dom.plannerSlotSheet && !dom.plannerSlotSheet.hidden)
    || (dom.plannerRecipeSheet && !dom.plannerRecipeSheet.hidden)
    || (dom.myRecipesSortSheet && !dom.myRecipesSortSheet.hidden)
    || (dom.loginPromptModal && !dom.loginPromptModal.hidden)
    || (dom.profileMenuModal && !dom.profileMenuModal.hidden);
  document.body.style.overflow = anyOpen ? 'hidden' : '';
  document.body.classList.toggle('modal-open', anyOpen);
}

window.updateBodyScrollLock = updateBodyScrollLock;

function openModal(type) {
  if (['meal', 'shopping'].includes(type) && state.calendarModalType === 'recordList') {
    closeCalendarDaySheet({ immediate: true });
  }
  const m = {
    form: dom.recipeFormModal,
    pantry: dom.pantryModal,
    meal: dom.mealModal,
    shopping: dom.shoppingModal,
    'grocery-item': dom.groceryItemModal,
  }[type];
  m.hidden = false; m.setAttribute('aria-hidden', 'false');
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}
function closeModal(type) {
  const m = {
    form: dom.recipeFormModal,
    pantry: dom.pantryModal,
    meal: dom.mealModal,
    shopping: dom.shoppingModal,
    'grocery-item': dom.groceryItemModal,
  }[type];
  if (!m) return;
  m.hidden = true; m.setAttribute('aria-hidden', 'true');
  if (type === 'form') {
    state.plannerPendingMeal = null;
    setVideoExtractLoading(false);
  }
  if (type === 'meal' && (state.calendarModalType === 'editRecord' || state.calendarModalType === 'addRecord')) {
    clearCalendarSubModalState();
  }
  if (type === 'shopping' && (state.calendarModalType === 'editShopping' || state.calendarModalType === 'addShopping')) {
    clearCalendarSubModalState();
  }
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}
function closeAllModals() {
  ['form', 'pantry', 'meal', 'shopping', 'grocery-item'].forEach(closeModal);
  closePlannerSheets();
  closeMyRecipesSortSheet();
  closeCalendarDaySheet({ immediate: true });
  closeCalendarExpenseSheet();
  closeGrocerySpendSheet();
  if (window.LoginRequiredModal?.isOpen()) window.LoginRequiredModal.close(true);
  closeImageLightbox();
}

// ===== PWA =====
function isDevRuntime() {
  const host = location.hostname;
  const port = location.port;
  return port === '8765'
    || host === 'localhost'
    || host === '127.0.0.1'
    || /^192\.168\./.test(host)
    || /^10\./.test(host);
}

async function clearServiceWorkerCaches() {
  if (!('serviceWorker' in navigator)) return;
  try {
    const regs = await navigator.serviceWorker.getRegistrations();
    await Promise.all(regs.map((reg) => reg.unregister()));
  } catch {
    // ignore
  }
  if ('caches' in window) {
    try {
      const keys = await caches.keys();
      await Promise.all(keys.map((key) => caches.delete(key)));
    } catch {
      // ignore
    }
  }
}

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  if (!window.isSecureContext) {
    await clearServiceWorkerCaches();
    return;
  }

  // 로컬 개발 서버 — SW 캐시 없이 새로고침만으로 최신 파일 반영
  if (isDevRuntime()) {
    await clearServiceWorkerCaches();
    return;
  }

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  const activateWaitingWorker = (reg) => {
    if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
  };

  try {
    const reg = await navigator.serviceWorker.register('./sw.js?v=56');
    reg.update();
    activateWaitingWorker(reg);
    reg.addEventListener('updatefound', () => {
      const worker = reg.installing;
      if (!worker) return;
      worker.addEventListener('statechange', () => {
        if (worker.state === 'installed' && navigator.serviceWorker.controller) {
          activateWaitingWorker(reg);
        }
      });
    });
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') reg.update();
    });
  } catch {
    // production SW optional
  }
}

// ===== Init =====
function init() {
  purgeLegacyUserDataFromLocalStorage();
  PublicRecipeRepository.load();
  PantryRepository.load();
  RecipeRepository.load();
  SavedRecipeRepository.load();
  RecipeSaveCountRepository.load();
  RecipeSaveCountRepository.syncExistingUserSaves(SavedRecipeRepository._ids);
  MealLogRepository.load();
  ShoppingRecordRepository.load();
  MealPlanRepository.load();
  GroceryRepository.load();
  // 초기화: 빈 메모리 state를 Firestore에 쓰지 않음 (스냅샷 적용 후 저장 허용)
  setPlannerWeek(state.plannerWeekStart, { flush: false, persist: false });
  dom.currencySelect.value = state.currency;
  syncCurrencyAmountPlaceholders();
  initRecipePickers();
  initVideoExtractUi();
  initPlannerSheets();
  initGroceryListAmountHandlers();
  initCalendarDaySheetGestures();
  initHomeSearchDock();
  initMyRecipesSortUi();
  initRecipeDetailRouting();
  window.addEventListener('resize', scheduleFitMobileHomeCardMissingStatuses);
  window.addEventListener('resize', schedulePantryChipsRelayout);

  dom.tabItems.forEach((tab) => { tab.onclick = () => navigate(tab.dataset.view); });
  dom.authorProfileBack?.addEventListener('click', () => {
    navigate(state.authorProfileReturnView || 'main');
  });
  window.addEventListener('public-profile-updated', () => {
    getAuthorProfilesService()?.clearCache?.();
    if (state.view === 'author-profile') renderAuthorProfile();
    else if (state.view === 'main') renderHome();
  });
  dom.openPantryManageBtn.onclick = () => navigate('pantry');
  dom.quickForm.addEventListener('submit', handleQuickAdd);
  dom.quickInput.addEventListener('compositionstart', () => { state.isComposing = true; });
  dom.quickInput.addEventListener('compositionend', () => { state.isComposing = false; });
  dom.quickIngredientScanBtn?.addEventListener('click', () => {
    requireAppLogin(() => openPantryModal());
  });
  const scrollToExplore = () => {
    dom.recipeList?.closest('.section--home-recipes')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  dom.homeRecipesSeeAll?.addEventListener('click', scrollToExplore);
  dom.homeRecommendSeeAll?.addEventListener('click', scrollToExplore);
  dom.headerNotifyBtn?.addEventListener('click', () => showToast('알림 기능은 준비 중이에요'));
  dom.openPantryAdd.onclick = () => openPantryModal();
  dom.openRecipeForm.onclick = (e) => {
    e.preventDefault();
    openRecipeForm();
  };
  dom.openMealAddBtn.onclick = () => {
    const defaultDate = state.selectedCalendarDate || todayStr();
    if (state.view === 'calendar') {
      state.calendarReopenListDate = defaultDate;
      state.calendarModalType = 'addRecord';
      closeCalendarDaySheet({ immediate: true });
    }
    openMealModal(null, defaultDate);
  };
  dom.openShoppingAddBtn.onclick = () => {
    const defaultDate = state.selectedCalendarDate || todayStr();
    if (state.view === 'calendar') {
      state.calendarReopenListDate = defaultDate;
      state.calendarModalType = 'addShopping';
      closeCalendarDaySheet({ immediate: true });
    }
    openShoppingModal(null, defaultDate);
  };
  dom.currencySelect.onchange = () => {
    state.currency = CURRENCY_OPTIONS[dom.currencySelect.value] ? dom.currencySelect.value : DEFAULT_CURRENCY;
    if (isLoggedInAppUser()) {
      persistCurrencySetting().catch(() => undefined);
    } else {
      StorageAdapter.set(CONFIG.STORAGE.CURRENCY, state.currency);
    }
    syncCurrencyAmountPlaceholders();
    renderCalendar();
    if (state.view === 'planner') renderGroceryList();
  };
  dom.calendarPrev.onclick = () => changeCalendarMonth(-1);
  dom.calendarNext.onclick = () => changeCalendarMonth(1);
  dom.plannerWeekPrev?.addEventListener('click', () => {
    const d = parseDateStr(state.plannerWeekStart);
    d.setDate(d.getDate() - 7);
    setPlannerWeek(toDateStr(d));
  });
  dom.plannerWeekNext?.addEventListener('click', () => {
    const d = parseDateStr(state.plannerWeekStart);
    d.setDate(d.getDate() + 7);
    setPlannerWeek(toDateStr(d));
  });
  dom.plannerAutoBtn?.addEventListener('click', () => requireAppLogin(autoGenerateWeeklyPlan));
  dom.groceryCompleteBtn?.addEventListener('click', handleGroceryPurchaseComplete);
  dom.groceryAddItemBtn?.addEventListener('click', () => openGroceryItemModal());
  dom.groceryItemModalForm?.addEventListener('submit', handleGroceryItemModalSubmit);
  const openGrocerySpendFromBudget = (e) => {
    if (e.target.closest('#grocery-budget, .budget-box__input')) return;
    e.preventDefault();
    openGrocerySpendSheet();
  };
  dom.groceryBudgetBox?.addEventListener('click', openGrocerySpendFromBudget);
  dom.groceryBudgetBox?.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (e.target.closest('#grocery-budget, .budget-box__input')) return;
    e.preventDefault();
    openGrocerySpendSheet();
  });
  dom.groceryBudget?.addEventListener('click', (e) => e.stopPropagation());
  const commitGroceryBudget = () => {
    if (!dom.groceryBudget) return;
    if (!isGuestUser() && !groceryFirestoreReady) return;
    const pendingBudget = dom.groceryBudget.value;
    const currentBudget = GroceryRepository.getBudget();
    // 스냅샷 복원 직후 빈 blur가 서버 예산을 지우지 않게
    if (isWithinGroceryRestoreGuard()
      && pendingBudget === ''
      && currentBudget !== ''
      && currentBudget != null) {
      dom.groceryBudget.value = currentBudget;
      return;
    }
    markGroceryLocalMutation();
    GroceryRepository.setBudget(pendingBudget);
    persistGroceryState().catch((error) => {
      console.error('Failed to save grocery week', {
        uid: window.FirebaseServices?.auth?.currentUser?.uid || null,
        weekKey: GroceryRepository._activeWeekKey || state.plannerWeekKey || '',
        data: { budget: pendingBudget },
        error,
      });
    });
    renderGroceryBudgetSummary(
      GroceryListService.computeMissing(GroceryListService.getPlannerDates(state.plannerWeekStart)),
    );
    HomeBriefingService.invalidate();
    if (state.view === 'main') renderHomeBriefing();
  };
  dom.groceryBudget?.addEventListener('change', commitGroceryBudget);
  dom.groceryBudget?.addEventListener('blur', commitGroceryBudget);
  dom.pantryModalForm.addEventListener('submit', handlePantryModalSubmit);
  dom.mealModalForm.addEventListener('submit', handleMealModalSubmit);
  dom.shoppingModalForm.addEventListener('submit', handleShoppingModalSubmit);
  dom.mealRecipeSelect.addEventListener('change', handleMealRecipeSelect);
  dom.mealTypeTabs.querySelectorAll('.meal-type-tab').forEach((tab) => {
    tab.onclick = () => setMealType(tab.dataset.mealType);
  });
  dom.mealPhotoSelectBtn.onclick = () => dom.mealPhotoInput.click();
  dom.mealPhotoInput.onchange = (e) => {
    compressImage(e.target.files[0]).then((s) => {
      state.mealFormImage = s;
      state.mealPhotoRemoved = false;
      updateMealPhotoPreview(s);
    }).catch(() => showToast('이미지 파일만 첨부할 수 있어요'));
  };
  dom.mealPhotoRemoveBtn.onclick = () => {
    state.mealFormImage = null;
    state.mealPhotoRemoved = true;
    dom.mealPhotoInput.value = '';
    updateMealPhotoPreview(null);
  };
  dom.recipeForm.addEventListener('submit', handleRecipeFormSubmit);
  dom.recipeFormTabs?.querySelectorAll('[data-recipe-tab]').forEach((btn) => {
    btn.onclick = () => setRecipeFormTab(btn.dataset.recipeTab);
  });
  dom.videoReviewBackBtn?.addEventListener('click', () => setRecipeFormTab('video'));
  dom.videoRecipeSaveBtn?.addEventListener('click', handleVideoRecipeSave);
  let videoPreviewTimer = null;
  dom.videoSourceUrl?.addEventListener('input', () => {
    clearTimeout(videoPreviewTimer);
    videoPreviewTimer = setTimeout(updateVideoLinkPreview, 400);
  });
  dom.videoSourceUrl?.addEventListener('blur', updateVideoLinkPreview);
  initRecipePhotoUpload();
  initCookTimeWheel();

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.onclick = () => {
      const type = el.dataset.closeModal;
      if (type === 'login') window.LoginRequiredModal?.close(true);
      else if (type === 'calendar-day') closeCalendarDaySheet();
      else if (type === 'calendar-expense') closeCalendarExpenseSheet();
      else if (type === 'grocery-spend') closeGrocerySpendSheet();
      else if (type === 'planner-slot' || type === 'planner-recipe') closePlannerSheets();
      else if (type === 'my-recipes-sort') closeMyRecipesSortSheet();
      else if (type !== 'profile') closeModal(type);
    };
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  dom.imageLightbox?.querySelectorAll('[data-close-lightbox]').forEach((el) => {
    el.onclick = closeImageLightbox;
  });

  if (getRecipeIdFromPath()) {
    syncRecipeDetailRouteFromLocation();
  } else {
    history.replaceState({ appView: 'main', scrollY: 0 }, '', window.location.href);
    navigate('main');
  }
}

function startApp() {
  init();
  registerServiceWorker();
  window.addEventListener('auth-state-changed', () => {
    AiUsageService.refreshDisplay();
    syncAuthGateUi();
    refreshAll();
  });
  window.addEventListener('analysis-quota-updated', (e) => {
    if (e.detail) AiUsageService.updateDisplay(e.detail);
  });
  window.addEventListener('pantry-firestore-sync', (e) => {
    if (!isFirestorePantryEnabled()) return;
    const items = Array.isArray(e.detail?.items) ? e.detail.items : [];
    PantryRepository.replaceAll(items);
    refreshAll();
  });
  window.addEventListener('my-recipes-firestore-sync', (e) => {
    if (!isLoggedInAppUser()) return;
    RecipeRepository.replaceAll(e.detail?.recipes || []);
    refreshAll();
  });
  window.addEventListener('meal-calendar-firestore-sync', (e) => {
    if (!isLoggedInAppUser()) return;
    MealLogRepository.replaceAll(e.detail?.logs || []);
    refreshAll();
  });
  window.addEventListener('meal-plans-firestore-sync', (e) => {
    if (!isLoggedInAppUser()) return;
    const incoming = e.detail?.plans && typeof e.detail.plans === 'object' ? e.detail.plans : {};
    const localHasData = hasMealPlanLocalData();
    // 로컬이 비어 있으면(로그인 직후) 항상 Firestore 적용.
    // 로컬 수정 직후 짧은 구간만 예전 스냅샷 덮어쓰기를 막는다.
    if (localHasData && Date.now() - mealPlanLocalMutatedAt < 5000) return;
    MealPlanRepository.replaceAll(incoming);
    refreshAll();
  });
  window.addEventListener('shopping-firestore-sync', (e) => {
    if (!isLoggedInAppUser()) return;
    ShoppingRecordRepository.replaceAll(e.detail?.records || []);
    refreshAll();
  });
  window.addEventListener('settings-firestore-sync', (e) => {
    if (!isLoggedInAppUser()) return;
    const settings = e.detail?.settings || {};
    if (settings.currency && CURRENCY_OPTIONS[settings.currency]) {
      state.currency = settings.currency;
      if (dom.currencySelect) dom.currencySelect.value = settings.currency;
      syncCurrencyAmountPlaceholders();
    }
    if (settings.monthlyFoodBudget != null) {
      state.monthlyFoodBudget = Number(settings.monthlyFoodBudget) || 0;
    }
    if (settings.grocery) {
      const localGroceryEmpty = !GroceryRepository._byWeek
        || !Object.keys(GroceryRepository._byWeek).length
        || GroceryRepository._isWeekEmpty(GroceryRepository._state);
      const allowRemote = !groceryFirestoreReady
        || localGroceryEmpty
        || Date.now() - groceryLocalMutatedAt >= 2000;
      if (allowRemote) {
        // 첫 스냅샷·로컬 비어 있음은 항상 적용. 이후엔 로컬 편집 직후 2초 가드.
        GroceryRepository.replaceState(settings.grocery, { strategy: 'replace' });
        if (state.plannerWeekKey) {
          GroceryRepository.setActiveWeek(state.plannerWeekKey);
        }
        markGroceryRestoredFromRemote();
      }
      markGroceryFirestoreReady();
    }
    if (Array.isArray(settings.savedRecipeIds)) SavedRecipeRepository.replaceIds(settings.savedRecipeIds);
    refreshAll();
  });
  window.addEventListener('public-recipes-firestore-sync', (e) => {
    PublicRecipeRepository.replaceAll(e.detail?.recipes || []);
    refreshAll();
  });
}

window.switchToGuestPantry = switchToGuestPantry;
window.reloadGuestPantry = reloadGuestPantry;
window.clearUserData = clearUserData;
window.clearAllUserDataState = clearAllUserDataState;

if (window.__firebaseBootstrapPromise) {
  window.__firebaseBootstrapPromise.finally(startApp);
} else {
  startApp();
}

window.AppServices = { PantryRepository, RecipeRepository, PublicRecipeRepository, SavedRecipeRepository, RecipeSaveCountRepository, MealLogRepository, ShoppingRecordRepository, MealPlanRepository, GroceryRepository, GroceryListService, RecommendationService, MatchService, IngredientGroupService, FreshFoodService, AffiliateService, PantryIngredientService, RecipePickerService, VideoRecipeAnalysisService, ClientUserService, AiUsageService, mockExtractRecipeFromVideoUrl, normalizeIngredientName, normalizeIngredientItem, normalizeIngredientList, formatIngredientDisplay, parseRecipeIngredient };
