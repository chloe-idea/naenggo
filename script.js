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
    MEAL_PLAN: 'naengjanggo_v2_meal_plan',
    GROCERY: 'naengjanggo_v2_grocery',
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

const VIEW_TITLES = {
  main: '집에 있는 재료로 만들 수 있는 요리를 찾아보세요',
  'my-recipes': '나만의 레시피를 관리하세요',
  community: '다른 사람들이 만든 레시피를 검색하고 저장해보세요.',
  pantry: '보유 재료를 상세 관리하세요',
  planner: '일주일 식단과 장보기 리스트를 준비하세요',
  calendar: '해먹은 음식을 기록하고 확인하세요',
};

const MEAL_TYPES = [
  { id: 'home-cook', label: '직접 요리', emoji: '🍳' },
  { id: 'eat-out', label: '외식', emoji: '🍽️' },
  { id: 'delivery', label: '배달', emoji: '🛵' },
  { id: 'snack', label: '간식', emoji: '🍪' },
];

const PLANNER_SLOTS = [
  { id: 'breakfast', label: '아침' },
  { id: 'lunch', label: '점심' },
  { id: 'dinner', label: '저녁' },
  { id: 'snack', label: '간식' },
];

function normalizeMealType(type) {
  return MEAL_TYPES.some((t) => t.id === type) ? type : 'home-cook';
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
  buildSearchUrl(query) {
    const cfg = this.getConfig();
    const name = parseRecipeIngredient(String(query || '')).name || String(query || '').trim();
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
  buyButtonHTML(ingredientName, { compact = false } = {}) {
    if (!this.isEnabled()) return '';
    const { name } = parseRecipeIngredient(ingredientName);
    if (!name) return '';
    const url = this.buildSearchUrl(name);
    const cls = compact ? 'btn-buy btn-buy--sm' : 'btn-buy';
    return `<a href="${esc(url)}" target="_blank" rel="noopener noreferrer sponsored" class="${cls}" onclick="event.stopPropagation()">구매하기</a>`;
  },
  openSearch(ingredientName) {
    if (!this.isEnabled()) return;
    window.open(this.buildSearchUrl(ingredientName), '_blank', 'noopener,noreferrer');
  },
};

// ===== 영상 레시피 추출 (Recime-style pipeline — js/video-extract-platform.js) =====
const VEP = () => window.VideoExtractPlatform || {};
const VIDEO_EXTRACT_FALLBACK_MSG = '자동 추출이 어려운 영상이에요. 영상 설명글, 자막, 고정 댓글을 붙여넣으면 정리해드릴게요.';
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
      message: VIDEO_EXTRACT_FALLBACK_MSG,
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
    return {
      sourceUrl: data.sourceUrl || fallbackUrl,
      sourcePlatform: data.sourcePlatform || 'youtube',
      thumbnailUrl: data.thumbnailUrl || null,
      videoTitle: data.title || '',
      name: String(data.title || '영상 레시피').trim().slice(0, 60),
      ingredients: (data.ingredients || []).map((s) => String(s).trim()).filter(Boolean),
      optionalIngredients: (data.optionalIngredients || []).map((s) => String(s).trim()).filter(Boolean),
      substitutes: (data.substituteIngredients || []).map((s) => String(s).trim()).filter(Boolean),
      steps: (data.steps || []).map((s) => String(s).trim()).filter(Boolean),
      cookTime: Math.max(1, Number(data.cookingTime) || 20),
      difficulty: ['쉬움', '보통', '어려움'].includes(data.difficulty) ? data.difficulty : '보통',
      category,
    };
  },

  collectVideoTextPayload() {
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

  async callVideoRecipeApi(apiUrl, url, textPayload = {}) {
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

    const headers = { 'Content-Type': 'application/json' };
    const idToken = await window.FirebaseServices?.AnalysisQuotaService?.getIdTokenForApi?.();
    if (idToken) headers.Authorization = `Bearer ${idToken}`;

    const platform = this.detectVideoPlatform(url);
    const apiUrls = [apiUrl, ...this.getRecipeApiFallbackUrls(platform, apiUrl)];
    let lastNotFoundErr = null;

    for (let i = 0; i < apiUrls.length; i += 1) {
      const currentApiUrl = apiUrls[i];
      if (i > 0) {
        console.warn('[VideoExtract] API 404 — fallback 시도:', currentApiUrl);
      }

      let res;
      try {
        res = await fetch(currentApiUrl, {
          method: 'POST',
          headers,
          body: JSON.stringify(payload),
        });
      } catch (networkErr) {
        logVideoExtractError('callVideoRecipeApi:network', networkErr, { apiUrl: currentApiUrl, url });
        const isLocalDev = APP_CONFIG?.runtime?.isLocalDev;
        const hint = isLocalDev
          ? '로컬에서는 ./serve.sh 로 서버를 실행해 주세요.'
          : 'Vercel에 API 함수가 배포되어 있는지 확인해 주세요.';
        const err = new Error(`레시피 추출 서버에 연결할 수 없습니다. ${hint}`);
        err.code = 'NETWORK_ERROR';
        throw err;
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

    const textPayload = VideoRecipeAnalysisService.collectVideoTextPayload();
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
반드시 JSON 객체 하나만 반환하세요. 키: name, ingredients(배열), optionalIngredients(배열), substitutes(배열, "재료 → 대체" 형식), steps(배열), cookTime(숫자, 분), difficulty(쉬움|보통|어려움), category(korean|western|japanese|chinese|diet|high-protein).
원문 전체를 저장하지 말고 요약된 레시피 정보만 추출하세요.`;

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
    return Number(this.getConfig().dailyLimit) || 5;
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
      dom.videoAnalyzeBtn.disabled = remaining <= 0;
    }
  },

  async refreshDisplay() {
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
/** 재료·레시피·장보기·식사 등 사용자 데이터 — localStorage 미사용 (게스트=메모리, 로그인=Firestore) */
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
  const raw = data.image;
  if (raw && raw !== '' && raw !== DEFAULT_IMAGE) {
    if (typeof raw === 'string' && raw.includes('images.unsplash.com')) return DEFAULT_IMAGE;
    if (raw.startsWith('data:') || raw.startsWith('http')) return raw;
    return raw.startsWith('images/') ? raw : `images/recipes/${raw}`;
  }
  const map = typeof RECIPE_IMAGE_MAP !== 'undefined' ? RECIPE_IMAGE_MAP : {};
  return map[data.name] || DEFAULT_IMAGE;
}

function seed(id, data) {
  const cat = CATEGORY_MAP[data.category || 'korean'];
  return {
    id: `builtin-${id}`,
    name: data.name,
    ingredients: data.ingredients,
    steps: data.steps,
    cookTime: data.cookTime,
    difficulty: data.difficulty,
    category: data.category || 'korean',
    dishType: data.dishType || DishTypeService.infer(data.name),
    cuisine: cat.cuisine,
    tags: cat.tags,
    dietTags: cat.dietTags,
    image: resolveRecipeImage(data),
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
    return [...BUILTIN_RECIPES, ...PublicRecipeRepository.getAll()];
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
    this._records = (records || []).map((record) => ({
      ...record,
      amount: Number(record.amount) || 0,
      store: record.store || '',
      currency: record.currency || DEFAULT_CURRENCY,
      ingredients: Array.isArray(record.ingredients) ? record.ingredients : [],
      recipeId: record.recipeId || null,
      recipeName: record.recipeName || '',
      pantryAdded: Boolean(record.pantryAdded),
    }));
  },
  getAll() { return this._records; },
  getByDate(date) { return this._records.filter((r) => r.date === date); },
  getByMonth(year, month) {
    const prefix = `${year}-${String(month).padStart(2, '0')}`;
    return this._records.filter((r) => r.date.startsWith(prefix));
  },
  create(data) {
    const record = {
      id: StorageAdapter.createId('shopping'),
      date: data.date,
      amount: Number(data.amount) || 0,
      store: data.store || '',
      currency: data.currency || DEFAULT_CURRENCY,
      ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
      recipeId: data.recipeId || null,
      recipeName: data.recipeName || '',
      pantryAdded: Boolean(data.pantryAdded),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    this._records.push(record);
    this.save();
    return record;
  },
  update(id, data) {
    const i = this._records.findIndex((r) => r.id === id);
    if (i === -1) return null;
    const preservedCurrency = this._records[i].currency;
    const { currency, ...rest } = data;
    this._records[i] = {
      ...this._records[i],
      ...rest,
      amount: Number(rest.amount ?? this._records[i].amount) || 0,
      updatedAt: new Date().toISOString(),
      currency: currency != null ? currency : preservedCurrency,
    };
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
    this._plans = plans && typeof plans === 'object' ? plans : {};
  },
  get(date, slot) {
    return this._plans?.[date]?.[slot] || { recipeId: '', name: '' };
  },
  set(date, slot, data) {
    if (!this._plans[date]) this._plans[date] = {};
    this._plans[date][slot] = {
      recipeId: data.recipeId || '',
      name: data.name || '',
    };
    if (!this._plans[date][slot].recipeId && !this._plans[date][slot].name) {
      delete this._plans[date][slot];
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

const GroceryRepository = {
  _state: { budget: '', items: {} },
  load() {
    this.clearSession();
    return this._state;
  },
  save() {
    // 장보기 리스트 — localStorage 미사용
  },
  clearSession() {
    this._state = { budget: '', items: {} };
  },
  replaceState(state) {
    this._state = {
      budget: state?.budget ?? '',
      items: state?.items && typeof state.items === 'object' ? state.items : {},
    };
  },
  getMeta(key) { return this._state.items[key] || { checked: false, price: '' }; },
  setChecked(key, checked) {
    this._state.items[key] = { ...this.getMeta(key), checked: Boolean(checked) };
    this.save();
  },
  setPrice(key, price) {
    this._state.items[key] = { ...this.getMeta(key), price };
    this.save();
  },
  setBudget(budget) {
    this._state.budget = budget;
    this.save();
  },
  getBudget() { return this._state.budget || ''; },
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
  categorize(name) {
    const n = String(name || '');
    return GROCERY_CATEGORIES.find((c) => c.id === 'other' || c.test(n)) || GROCERY_CATEGORIES[GROCERY_CATEGORIES.length - 1];
  },
  itemKey(name) {
    return MatchService.normalize(parseRecipeIngredient(name).name || name);
  },
  getPlannerDates(range) {
    const now = new Date();
    if (range === 'month') {
      const year = now.getFullYear();
      const month = now.getMonth();
      const days = new Date(year, month + 1, 0).getDate();
      return Array.from({ length: days }, (_, i) => {
        const d = new Date(year, month, i + 1);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      });
    }
    const start = new Date(now);
    const day = start.getDay();
    start.setDate(start.getDate() - (day === 0 ? 6 : day - 1));
    return MealPlanRepository.getRange(
      `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`,
      7,
    );
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
    return grouped;
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

function isLoggedInAppUser() {
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
    sourceUrl: data.sourceUrl ?? base.sourceUrl ?? null,
    sourcePlatform: data.sourcePlatform ?? base.sourcePlatform ?? null,
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
  await getFirestoreUserDataSync().mealCalendar.saveLog(merged);
  return merged;
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
  await getFirestoreUserDataSync().shopping.saveRecord(merged);
  return merged;
}

async function deleteShoppingRecordFromStore(recordId) {
  if (!isLoggedInAppUser()) {
    ShoppingRecordRepository.remove(recordId);
    notifyGuestPersonalDataNotPersisted('장보기 기록');
    return;
  }
  const record = ShoppingRecordRepository.getAll().find((r) => r.id === recordId);
  if (!record) return;
  await getFirestoreUserDataSync().shopping.deleteRecord(record.firestoreId || recordId);
}

async function persistMealPlans() {
  if (!isLoggedInAppUser()) {
    notifyGuestPersonalDataNotPersisted('식단');
    return;
  }
  await getFirestoreUserDataSync().mealPlans.savePlans(MealPlanRepository._plans);
}

async function persistGroceryState() {
  if (!isLoggedInAppUser()) {
    notifyGuestPersonalDataNotPersisted('장보기 목록');
    return;
  }
  await getFirestoreUserDataSync().settings.saveGroceryState({
    budget: GroceryRepository.getBudget(),
    items: GroceryRepository._state.items,
  });
}

async function persistCurrencySetting() {
  if (!isLoggedInAppUser()) return;
  await getFirestoreUserDataSync().settings.saveCurrency(state.currency);
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
      const hints = substituted.slice(0, 2).map((s) => `${s.required}→${s.owned}`);
      parts.push(`${hints.join(', ')}${substituted.length > 2 ? ` 외 ${substituted.length - 2}개` : ''} 대체 가능`);
    }
    if (missing.length) {
      if (missing.length === 1) parts.push(`${missing[0]}만 있으면 가능`);
      else parts.push(`${missing.slice(0, 2).join(', ')}${missing.length > 2 ? ` 외 ${missing.length - 2}개` : ''} 부족`);
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
    if (result.missing.length === 1) return `🛒 ${result.missing[0]}만 있으면 가능`;
    if (result.expiryBoost > 0) return '⚠️ 임박 재료 활용';
    if (this.isHighProtein(result.recipe)) return '💪 고단백';
    if (this.isDiet(result.recipe)) return '🥗 다이어트';
    if (this.isSnack(result.recipe)) return '🍪 간식';
    if (Number(result.recipe.cookTime) <= 15) return '⏱️ 15분 이하';
    return '';
  },
  matchesFilters(result, activeFilters) {
    if (!activeFilters?.size) return true;
    const recipe = result.recipe;
    for (const filter of activeFilters) {
      if (filter === 'available' && !(result.missing.length === 0 && result.substituted.length === 0)) return false;
      if (filter === 'expiring' && result.expiryBoost <= 0) return false;
      if (filter === 'one-missing' && result.missing.length > 1) return false;
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

// ===== State & DOM =====
const state = {
  view: 'main', filters: new Set(), communityFilters: new Set(), menuSearch: '', communitySearch: '',
  editingRecipeId: null, editingPantryId: null,
  editingMealId: null, editingShoppingId: null, formImage: null, mealFormImage: null, isComposing: false, detailRecipeId: null,
  calendarYear: new Date().getFullYear(), calendarMonth: new Date().getMonth(),
  selectedCalendarDate: null, selectedMealType: 'home-cook', mealPhotoRemoved: false,
  currency: CURRENCY_OPTIONS[StorageAdapter.get(CONFIG.STORAGE.CURRENCY, DEFAULT_CURRENCY)]
    ? StorageAdapter.get(CONFIG.STORAGE.CURRENCY, DEFAULT_CURRENCY)
    : DEFAULT_CURRENCY,
  shoppingRecipePicker: null,
  pantryRecipePicker: null,
  recipeFormTab: 'manual',
  videoReviewDraft: null,
  videoLinkMeta: null,
  videoExtractNeedsFallback: false,
  aiUsageRemaining: null,
  plannerRange: 'week',
  martMode: false,
};

const $ = (s) => document.querySelector(s);
const dom = {
  headerSubtitle: $('#header-subtitle'),
  headerBrand: $('#header-brand'),
  headerCommunityTitle: $('#header-community-title'),
  toast: $('#toast'),
  views: {
    main: $('#view-main'), 'my-recipes': $('#view-my-recipes'), community: $('#view-community'),
    pantry: $('#view-pantry'), planner: $('#view-planner'), calendar: $('#view-calendar'),
  },
  plannerRange: $('#planner-range'), plannerAutoBtn: $('#planner-auto-btn'), plannerGrid: $('#planner-grid'),
  plannerGuestHint: $('#planner-guest-hint'),
  martModeToggle: $('#mart-mode-toggle'), groceryCompleteBtn: $('#grocery-complete-btn'),
  groceryBudget: $('#grocery-budget'), groceryBudgetSummary: $('#grocery-budget-summary'),
  groceryList: $('#grocery-list'), groceryEmpty: $('#grocery-empty'),
  tabItems: document.querySelectorAll('.tab-bar__item'),
  openPantryManageBtn: $('#open-pantry-manage-btn'),
  quickForm: $('#quick-ingredient-form'), quickInput: $('#quick-ingredient-input'),
  pantryChips: $('#pantry-chips'),
  menuSearchInput: $('#menu-search-input'),
  recipeList: $('#recipe-list'), resultsCount: $('#results-count'),
  emptyState: $('#empty-state'), noResults: $('#no-results'),
  myRecipesList: $('#my-recipes-list'), myRecipesCount: $('#my-recipes-count'), myRecipesEmpty: $('#my-recipes-empty'),
  myRecipesGuestHint: $('#my-recipes-guest-hint'),
  savedList: $('#saved-recipes-list'), savedCount: $('#saved-recipes-count'), savedEmpty: $('#saved-recipes-empty'),
  communityList: $('#community-list'), communityEmpty: $('#community-empty'),
  communitySearchInput: $('#community-search-input'), communityEmptyTitle: $('#community-empty-title'),
  communityFilterBtn: $('#community-filter-btn'), communityFilterPanel: $('#community-filter-panel'),
  communityFilterChips: $('#community-filter-chips'),
  pantryList: $('#pantry-list'), pantryCount: $('#pantry-manage-count'), pantryEmpty: $('#pantry-empty'),
  openPantryAdd: $('#open-pantry-add-btn'), openRecipeForm: $('#open-recipe-form-btn'),
  mealStats: $('#meal-stats'), currencySelect: $('#currency-select'), calendarLabel: $('#calendar-label'),
  calendarGuestHint: $('#calendar-guest-hint'),
  calendarPrev: $('#calendar-prev'), calendarNext: $('#calendar-next'),
  calendarWeekdays: $('#calendar-weekdays'), calendarDays: $('#calendar-days'),
  calendarDaySection: $('#calendar-day-section'), calendarDayLabel: $('#calendar-day-label'),
  calendarDayList: $('#calendar-day-list'), calendarDayEmpty: $('#calendar-day-empty'),
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
  shoppingIngredients: $('#shopping-ingredients'), shoppingAddPantry: $('#shopping-add-pantry'),
  shoppingRecipeInput: $('#shopping-recipe-input'), shoppingRecipeId: $('#shopping-recipe-id'),
  shoppingRecipeSuggestions: $('#shopping-recipe-suggestions'),
  pantryModal: $('#pantry-modal'), pantryModalForm: $('#pantry-modal-form'),
  pantryModalTitle: $('#pantry-modal-title'), pantryModalName: $('#pantry-modal-name'),
  pantryModalQty: $('#pantry-modal-quantity'), pantryModalUnit: $('#pantry-modal-unit'),
  pantryModalExpiry: $('#pantry-modal-expiry'),
  pantryRecipeInput: $('#pantry-recipe-input'), pantryRecipeId: $('#pantry-recipe-id'),
  pantryRecipeSuggestions: $('#pantry-recipe-suggestions'),
  recipeModal: $('#recipe-modal'), modalContent: $('#modal-content'),
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
  videoAnalyzeBtn: $('#video-analyze-btn'),
  loginPromptModal: $('#login-prompt-modal'),
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
function formatMoney(value, currencyCode = null) {
  const amount = Number(value) || 0;
  const code = currencyCode || state.currency || DEFAULT_CURRENCY;
  const currency = CURRENCY_OPTIONS[code] || CURRENCY_OPTIONS[DEFAULT_CURRENCY];
  return `${currency.symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency.fractionDigits,
  })}`;
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
  if (hasPhoto(recipe.image)) {
    return `<button type="button" class="recipe-card__image-btn" data-zoom-src="${esc(recipe.image)}" aria-label="${esc(recipe.name)} 사진 크게 보기">
      <img class="recipe-card__image" src="${recipe.image}" alt="${esc(recipe.name)}" loading="lazy">
    </button>`;
  }
  return recipePlaceholderHTML(recipe, 'card');
}

function recipeHeroHTML(recipe) {
  if (hasPhoto(recipe.image)) {
    return `<button type="button" class="recipe-detail__hero-btn" data-zoom-src="${esc(recipe.image)}" aria-label="${esc(recipe.name)} 사진 크게 보기">
      <img src="${recipe.image}" alt="${esc(recipe.name)}">
    </button>`;
  }
  return recipePlaceholderHTML(recipe, 'hero');
}

function bindZoomableImages(container) {
  container.querySelectorAll('[data-zoom-src]').forEach((btn) => {
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
  const modalOpen = [dom.recipeModal, dom.recipeFormModal, dom.pantryModal, dom.mealModal, dom.shoppingModal]
    .some((m) => m && !m.hidden);
  if (!modalOpen) document.body.style.overflow = '';
}
function idEq(a, b) { return String(a) === String(b); }
function todayStr() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function formatDateLabel(dateStr) {
  const [y, m, d] = dateStr.split('-');
  return `${y}년 ${Number(m)}월 ${Number(d)}일`;
}

let toastTimer = null;
function showToast(msg) {
  dom.toast.textContent = msg;
  dom.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { dom.toast.hidden = true; }, 2200);
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
function switchView(view) {
  state.view = view;
  Object.entries(dom.views).forEach(([k, el]) => { el.hidden = k !== view; });
  dom.tabItems.forEach((tab) => tab.classList.toggle('tab-bar__item--active', tab.dataset.view === view));
  document.body.classList.toggle('view--community', view === 'community');
  if (dom.headerCommunityTitle) dom.headerCommunityTitle.hidden = view !== 'community';
  if (dom.headerSubtitle) {
    if (view === 'community') {
      dom.headerSubtitle.hidden = true;
    } else {
      dom.headerSubtitle.hidden = false;
      dom.headerSubtitle.textContent = VIEW_TITLES[view] || VIEW_TITLES.main;
    }
  }
  renderCurrentView();
}

function navigate(view) {
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
    case 'community': renderCommunity(); break;
    case 'pantry': renderPantryManage(); break;
    case 'planner': renderPlanner(); break;
    case 'calendar': renderCalendar(); break;
  }
}

function refreshAll() { renderCurrentView(); if (state.view !== 'main') renderHome(); }

// ===== Render: Pantry Chips =====
function pantryChipBadge(item) {
  if (ExpiryService.status(item.expiryDate) !== 'soon') return '';
  const days = ExpiryService.daysUntil(item.expiryDate);
  const label = days === 0 ? '오늘' : days > 0 ? `${days}일` : '⚠️';
  return `<span class="tag__expiry-badge">${esc(label)}</span>`;
}

function renderPantryChips() {
  const items = getPantryItemsForUi();
  if (!items.length) {
    dom.pantryChips.innerHTML = '<p class="hint hint--inline">재료를 추가하면 맞춤 레시피를 추천해 드려요.</p>';
    return;
  }
  dom.pantryChips.innerHTML = items.map((item) => `
    <span class="tag" role="listitem">${esc(item.name)}${pantryChipBadge(item)}
      <button type="button" class="tag__remove" data-rm="${esc(item.id)}" aria-label="삭제">&times;</button>
    </span>`).join('');
  dom.pantryChips.querySelectorAll('[data-rm]').forEach((btn) => {
    btn.onclick = () => {
      requireAppLogin(() => {
        removePantryItem(btn.dataset.rm).catch((err) => handlePantryFirestoreError(err));
      });
    };
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
      closeModal('recipe');
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

// ===== Render: Recipe Card =====
function recipeCardHTML({ recipe, matchPercent, missing, matched, matchedPantryNames, exact, substituted, recommendationReason, showAuthor, showVisibility, showCardSave, showCardMealLog, showCardFork, showSaveCount, hideMatchBadge, hideOrigin, hideReason, hideExpiryHint, showMissingLine }) {
  const badge = !hideMatchBadge && matchPercent != null ? (matchPercent >= 70 ? 'high' : matchPercent >= 40 ? 'mid' : 'low') : null;
  const img = recipeCardImageHTML(recipe);
  const soon = !hideExpiryHint && matchedPantryNames?.length && RecommendationService.getExpiryBoost(matchedPantryNames) > 0;
  const saved = SavedRecipeRepository.isSaved(recipe.id);
  const saveCount = showSaveCount ? RecipeSaveCountRepository.getCount(recipe.id) : 0;
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
    ? `<p class="recipe-card__missing">${esc(MatchService.formatCardSummary({ exact: exact || [], substituted: substituted || [], missing: missing || [] }))}${missing?.length && AffiliateService.isEnabled() ? ` ${AffiliateService.buyButtonHTML(missing[0], { compact: true })}` : ''}</p>`
    : (showMissingLine && !missing?.length && !exact?.length && !substituted?.length
      ? '<p class="recipe-card__missing">보유 재료와 일치합니다</p>'
      : '');
  return `
    <div class="recipe-card" role="button" tabindex="0" data-rid="${esc(recipe.id)}">
      <div class="recipe-card__image-wrap">${img}</div>
      <div class="recipe-card__body">
        <div class="recipe-card__top">
          <span class="recipe-card__name">${esc(recipe.name)}</span>
          <div class="recipe-card__header-end">
            ${headerAction || forkBtn ? `<div class="recipe-card__actions-row">${headerAction}${forkBtn}</div>` : ''}
            ${badge ? `<span class="match-badge match-badge--${badge}">${matchPercent}%</span>` : ''}
          </div>
        </div>
        ${hideOrigin ? '' : recipeOriginHTML(recipe, { compact: true })}
        <div class="recipe-card__meta">
          <span>⏱ ${recipe.cookTime}분</span>
          <span>📊 ${recipe.difficulty}</span>
          ${showAuthor ? `<span>👤 ${esc(recipe.authorName)}</span>` : ''}
          ${showVisibility ? `<span>${recipe.visibility === 'public' ? '🌐 공개' : '🔒 비공개'}</span>` : ''}
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
      if (e.target.closest('[data-log-meal-id], [data-save-id], [data-fork-id], [data-zoom-src], .recipe-card__image-btn')) return;
      const r = results.find((x) => idEq(x.recipe.id, card.dataset.rid));
      openRecipeDetail(r || { recipe: RecipeRepository.getById(card.dataset.rid) });
    };
    card.onclick = open;
    card.onkeydown = (e) => { if (e.key === 'Enter' && !e.target.closest('[data-log-meal-id], [data-save-id], [data-fork-id]')) open(e); };
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
        showToast(nowSaved ? '레시피를 저장했어요 ⭐' : '저장을 해제했어요');
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
}

// ===== Render: Home =====
function renderHome() {
  const names = RecommendationService.getPantryNames();
  const query = state.menuSearch.trim();
  const hasSearchMode = Boolean(query || state.filters.size);
  dom.emptyState.hidden = names.length > 0 || hasSearchMode;
  dom.noResults.hidden = true;
  dom.recipeList.innerHTML = '';
  if (!names.length && !hasSearchMode) { dom.resultsCount.textContent = ''; return; }

  const results = RecommendationService.recommend(RecipeRepository.getRecommendableRecipes(), { activeFilters: state.filters, query });
  dom.noResults.hidden = results.length > 0;
  dom.resultsCount.textContent = `${results.length}개`;
  dom.recipeList.innerHTML = results.map((r) => recipeCardHTML({ ...r, showCardSave: true, showCardFork: true })).join('');
  bindRecipeCards(dom.recipeList, results);
  syncAuthGateUi();
}

// ===== Render: My Recipes =====
function renderMyRecipes() {
  const guest = isGuestUser();
  if (dom.myRecipesGuestHint) dom.myRecipesGuestHint.hidden = !guest;

  if (guest) {
    dom.myRecipesCount.textContent = '';
    dom.myRecipesList.innerHTML = '';
    dom.myRecipesEmpty.hidden = false;
    const myEmptyText = dom.myRecipesEmpty?.querySelector('.empty-state__text');
    if (myEmptyText) myEmptyText.textContent = '로그인하면 저장한 레시피를 확인할 수 있어요.';
    dom.savedCount.textContent = '';
    dom.savedList.innerHTML = '';
    dom.savedEmpty.hidden = false;
    const savedEmptyText = dom.savedEmpty?.querySelector('.empty-state__text');
    if (savedEmptyText) savedEmptyText.textContent = '로그인하면 즐겨찾기한 레시피를 확인할 수 있어요.';
    syncAuthGateUi();
    return;
  }

  const recipes = RecipeRepository.getUserRecipes();
  dom.myRecipesCount.textContent = recipes.length ? `${recipes.length}개` : '';
  dom.myRecipesEmpty.hidden = recipes.length > 0;
  dom.myRecipesList.innerHTML = recipes.map((recipe) => {
    const names = RecommendationService.getPantryNames();
    const a = names.length ? MatchService.analyze(names, recipe.ingredients) : null;
    return recipeCardHTML({ recipe, matchPercent: a?.matchPercent, missing: a?.missing || [], matched: a?.matched || [],
      matchedPantryNames: a?.matchedPantryNames || [], exact: a?.exact || [], substituted: a?.substituted || [],
      showVisibility: true, showCardMealLog: true, showCardFork: true });
  }).join('');
  bindRecipeCards(dom.myRecipesList, recipes.map((r) => ({ recipe: r })));

  dom.myRecipesList.querySelectorAll('.recipe-card').forEach((card) => {
    card.addEventListener('contextmenu', (e) => e.preventDefault());
  });

  const saved = SavedRecipeRepository.getRecipes();
  dom.savedCount.textContent = saved.length ? `${saved.length}개` : '';
  dom.savedEmpty.hidden = saved.length > 0;
  const savedResults = saved.map((recipe) => {
    const names = RecommendationService.getPantryNames();
    const a = names.length ? MatchService.analyze(names, recipe.ingredients) : null;
    return { recipe, matchPercent: a?.matchPercent ?? null, missing: a?.missing || [], matched: a?.matched || [],
      matchedPantryNames: a?.matchedPantryNames || [], exact: a?.exact || [], substituted: a?.substituted || [] };
  });
  dom.savedList.innerHTML = savedResults.map((r) => recipeCardHTML({ ...r, showAuthor: true, showCardMealLog: true, showCardFork: true })).join('');
  bindRecipeCards(dom.savedList, savedResults);
  syncAuthGateUi();
}

// ===== Render: Community =====
function matchesCommunitySearch(recipe, query) {
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
}

function renderCommunityFilters() {
  if (!dom.communityFilterChips) return;
  dom.communityFilterChips.innerHTML = FILTERS.map((f) => `
    <button type="button" class="filter-chip${state.communityFilters.has(f.id) ? ' filter-chip--active' : ''}" data-community-f="${f.id}">${f.label}</button>
  `).join('');
  dom.communityFilterChips.querySelectorAll('[data-community-f]').forEach((c) => {
    c.onclick = () => {
      if (state.communityFilters.has(c.dataset.communityF)) state.communityFilters.delete(c.dataset.communityF);
      else state.communityFilters.add(c.dataset.communityF);
      renderCommunityFilters();
      renderCommunity();
    };
  });
}

function renderCommunity() {
  renderCommunityFilters();
  const publicRecipes = RecipeRepository.getPublicRecipes();
  const names = RecommendationService.getPantryNames();
  const query = state.communitySearch.trim();
  const filteredRecipes = publicRecipes.filter((recipe) => matchesCommunitySearch(recipe, query));

  const results = filteredRecipes.map((recipe) => {
    const a = names.length
      ? MatchService.analyze(names, recipe.ingredients)
      : { matched: [], missing: recipe.ingredients, matchPercent: 0, exact: [], substituted: [], matchedPantryNames: [] };
    return {
      recipe,
      ...a,
      expiryBoost: RecommendationService.getExpiryBoost(a.matchedPantryNames || []),
    };
  }).filter((r) => RecommendationService.matchesFilters(r, state.communityFilters))
    .sort((a, b) => (b.matchPercent || 0) - (a.matchPercent || 0));

  const hasSearch = Boolean(query || state.communityFilters.size);
  dom.communityEmpty.hidden = results.length > 0;
  if (dom.communityEmptyTitle) {
    dom.communityEmptyTitle.textContent = hasSearch ? '검색 결과가 없습니다.' : '공개 레시피가 없어요';
  }

  dom.communityList.innerHTML = results.map((r) => recipeCardHTML({
    ...r,
    showAuthor: true,
    showCardSave: true,
    showSaveCount: true,
    showCardFork: true,
    hideMatchBadge: true,
    hideOrigin: true,
    hideReason: true,
    hideExpiryHint: true,
    showMissingLine: true,
  })).join('');
  bindRecipeCards(dom.communityList, results);
  syncAuthGateUi();
}

function toggleCommunityFilterPanel(force) {
  if (!dom.communityFilterPanel || !dom.communityFilterBtn) return;
  const open = typeof force === 'boolean' ? force : dom.communityFilterPanel.hidden;
  dom.communityFilterPanel.hidden = !open;
  dom.communityFilterBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
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
function renderMealStats() {
  const year = state.calendarYear;
  const month = state.calendarMonth + 1;
  const monthLogs = MealLogRepository.getByMonth(year, month);
  const shoppingRecords = ShoppingRecordRepository.getByMonth(year, month);
  const counts = { 'home-cook': 0, 'eat-out': 0, delivery: 0, snack: 0 };
  const costs = { 'eat-out': {}, delivery: {}, snack: {} };
  const foodCounts = {};

  monthLogs.forEach((log) => {
    const type = normalizeMealType(log.mealType);
    if (type in counts) counts[type] += 1;
    if (type in costs) {
      const code = log.currency || DEFAULT_CURRENCY;
      costs[type][code] = (costs[type][code] || 0) + (Number(log.cost) || 0);
    }
    foodCounts[log.name] = (foodCounts[log.name] || 0) + 1;
  });
  const shoppingTotals = sumAmountsByCurrency(shoppingRecords, (r) => r.amount, (r) => r.currency);
  const eatOutTotal = formatMoneyTotalsByCurrency(costs['eat-out']);
  const deliveryTotal = formatMoneyTotalsByCurrency(costs.delivery);
  const snackTotal = formatMoneyTotalsByCurrency(costs.snack);
  const shoppingTotal = formatMoneyTotalsByCurrency(shoppingTotals);
  const combinedTotals = { ...shoppingTotals };
  ['eat-out', 'delivery', 'snack'].forEach((type) => {
    Object.entries(costs[type]).forEach(([code, amount]) => {
      combinedTotals[code] = (combinedTotals[code] || 0) + amount;
    });
  });
  const totalFoodCost = formatMoneyTotalsByCurrency(combinedTotals);
  const topFood = Object.entries(foodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

  dom.mealStats.innerHTML = `
    <div class="meal-stat"><span class="meal-stat__label">🍳 직접 요리</span><span class="meal-stat__value">${counts['home-cook']}회</span></div>
    <div class="meal-stat"><span class="meal-stat__label">🍽️ 외식</span><span class="meal-stat__value">${counts['eat-out']}회<br>${eatOutTotal}</span></div>
    <div class="meal-stat"><span class="meal-stat__label">🛵 배달</span><span class="meal-stat__value">${counts.delivery}회<br>${deliveryTotal}</span></div>
    <div class="meal-stat"><span class="meal-stat__label">🍪 간식</span><span class="meal-stat__value">${counts.snack}회<br>${snackTotal}</span></div>
    <div class="meal-stat"><span class="meal-stat__label">🛒 장보기</span><span class="meal-stat__value">${shoppingTotal}</span></div>
    <div class="meal-stat"><span class="meal-stat__label">💰 이번 달 총 식비</span><span class="meal-stat__value">${totalFoodCost}</span></div>
    <div class="meal-stat meal-stat--wide"><span class="meal-stat__label">🏆 가장 많이 먹은 음식</span><span class="meal-stat__value">${esc(topFood)}</span></div>`;
}

function formatCalendarMealLine(log) {
  const info = mealTypeInfo(log.mealType);
  const photoMark = log.photo ? ' 📷' : '';
  const cost = log.cost ? ` ${formatMoney(log.cost, log.currency || DEFAULT_CURRENCY)}` : '';
  return `${info.emoji} ${log.name}${cost}${photoMark}`;
}

function formatCalendarShoppingLine(record) {
  return `🛒 ${formatMoney(record.amount, record.currency || DEFAULT_CURRENCY)}`;
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
    const lines = [
      ...meals.map(formatCalendarMealLine),
      ...shopping.map(formatCalendarShoppingLine),
    ];
    const classes = ['calendar-day'];
    if (dateStr === today) classes.push('calendar-day--today');
    if (dateStr === state.selectedCalendarDate) classes.push('calendar-day--selected');
    if (lines.length) classes.push('calendar-day--has-meals');
    const previewLines = lines.slice(0, 2).map(esc);
    const extra = lines.length > 2 ? `<span class="calendar-day__more">+${lines.length - 2}</span>` : '';
    html += `
      <button type="button" class="${classes.join(' ')}" data-date="${dateStr}">
        <span class="calendar-day__num">${d}</span>
        ${lines.length ? `<span class="calendar-day__meals">${previewLines.join('<br>')}${extra}</span>` : ''}
      </button>`;
  }

  dom.calendarDays.innerHTML = html;
  dom.calendarDays.querySelectorAll('.calendar-day:not(.calendar-day--empty)').forEach((btn) => {
    btn.onclick = () => selectCalendarDate(btn.dataset.date);
  });

  renderMealStats();
  if (state.selectedCalendarDate) renderCalendarDayDetail(state.selectedCalendarDate);
  else dom.calendarDaySection.hidden = true;
}

function selectCalendarDate(dateStr) {
  state.selectedCalendarDate = dateStr;
  renderCalendar();
}

function renderCalendarDayDetail(dateStr) {
  if (isGuestUser()) {
    dom.calendarDaySection.hidden = false;
    dom.calendarDayLabel.textContent = formatDateLabel(dateStr);
    dom.calendarDayEmpty.hidden = false;
    dom.calendarDayList.innerHTML = '';
    const emptyText = dom.calendarDayEmpty?.querySelector('.empty-state__text');
    if (emptyText) emptyText.textContent = '로그인하면 이 날짜의 식사·장보기 기록을 저장할 수 있어요.';
    return;
  }

  const logs = MealLogRepository.getByDate(dateStr);
  const shoppingRecords = ShoppingRecordRepository.getByDate(dateStr);
  dom.calendarDaySection.hidden = false;
  dom.calendarDayLabel.textContent = formatDateLabel(dateStr);
  dom.calendarDayEmpty.hidden = logs.length + shoppingRecords.length > 0;

  const mealItems = logs.map((log) => {
    const info = mealTypeInfo(log.mealType);
    return `
    <div class="meal-day-item" data-meal-id="${esc(log.id)}">
      <button type="button" class="meal-day-item__body" data-view-meal="${esc(log.id)}">
        <div class="meal-day-item__head">
          ${log.photo ? `<img class="meal-day-item__thumb" src="${log.photo}" alt="">` : `<span class="meal-day-item__emoji">${info.emoji}</span>`}
          <div class="meal-day-item__text">
            <p class="meal-day-item__name">${info.emoji} ${esc(log.name)}</p>
            <p class="meal-day-item__type">${esc(info.label)}${log.cost ? ` · ${esc(formatMoney(log.cost, log.currency || DEFAULT_CURRENCY))}` : ''}</p>
            ${log.memo ? `<p class="meal-day-item__memo">${esc(log.memo)}</p>` : ''}
          </div>
        </div>
      </button>
      <div class="meal-day-item__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-edit-meal="${esc(log.id)}">수정</button>
        <button type="button" class="btn btn--danger btn--sm" data-del-meal="${esc(log.id)}">삭제</button>
      </div>
    </div>`;
  }).join('');

  const shoppingItems = shoppingRecords.map((record) => {
    const ingredientLine = record.ingredients?.length
      ? `<p class="meal-day-item__memo">🥬 ${esc(record.ingredients.map(formatIngredientDisplay).join(', '))}</p>` : '';
    const recipeLine = record.recipeName
      ? `<p class="meal-day-item__memo">📖 ${esc(record.recipeName)}</p>` : '';
    const pantryAction = record.ingredients?.length && !record.pantryAdded
      ? `<button type="button" class="btn btn--outline btn--sm" data-add-pantry-shopping="${esc(record.id)}">보유 재료에 추가</button>`
      : record.pantryAdded && record.ingredients?.length
        ? '<span class="meal-day-item__done">✓ 보유 재료 반영됨</span>' : '';
    return `
    <div class="meal-day-item meal-day-item--shopping" data-shopping-id="${esc(record.id)}">
      <div class="meal-day-item__body">
        <div class="meal-day-item__head">
          <span class="meal-day-item__emoji">🛒</span>
          <div class="meal-day-item__text">
            <p class="meal-day-item__name">장보기 ${esc(formatMoney(record.amount, record.currency || DEFAULT_CURRENCY))}</p>
            <p class="meal-day-item__type">${record.store ? esc(record.store) : '마트명 없음'}</p>
            ${recipeLine}
            ${ingredientLine}
          </div>
        </div>
      </div>
      <div class="meal-day-item__actions">
        ${pantryAction}
        <button type="button" class="btn btn--ghost btn--sm" data-edit-shopping="${esc(record.id)}">수정</button>
        <button type="button" class="btn btn--danger btn--sm" data-del-shopping="${esc(record.id)}">삭제</button>
      </div>
    </div>`;
  }).join('');

  dom.calendarDayList.innerHTML = mealItems + shoppingItems;

  dom.calendarDayList.querySelectorAll('[data-view-meal]').forEach((b) => {
    b.onclick = () => openMealModal(b.dataset.viewMeal);
  });
  dom.calendarDayList.querySelectorAll('[data-edit-meal]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      requireAppLogin(() => openMealModal(b.dataset.editMeal));
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
      requireAppLogin(() => openShoppingModal(b.dataset.editShopping));
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
      showToast(state.editingMealId ? '기록이 수정되었어요' : `"${name}" 기록 완료!`);
      state.selectedCalendarDate = date;
      const [y, m] = date.split('-').map(Number);
      state.calendarYear = y;
      state.calendarMonth = m - 1;
      closeModal('meal');
      renderCalendar();
    })
    .catch((err) => showToast(err.message || '식사 기록 저장에 실패했습니다.'));
}

function addShoppingRecordToPantry(recordId) {
  const record = ShoppingRecordRepository.getAll().find((r) => r.id === recordId);
  if (!record?.ingredients?.length) {
    showToast('추가할 재료가 없어요');
    return;
  }
  PantryIngredientService.addFromNames(record.ingredients, {
    recipeId: record.recipeId,
    recipeName: record.recipeName,
  }).then(({ added }) => {
    if (isLoggedInAppUser()) {
      saveShoppingRecordToStore({ ...record, pantryAdded: true }, recordId).catch(() => undefined);
    } else {
      ShoppingRecordRepository.update(recordId, { pantryAdded: true });
    }
    showToast(added ? `재료 ${added}개를 보유 재료에 추가했어요` : '이미 보유 재료에 있는 항목이에요');
  }).catch(() => undefined);
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
  dom.shoppingAddPantry.checked = true;
  dom.shoppingModalTitle.textContent = id ? '장보기 기록 수정' : '장보기 기록';
  dom.shoppingDate.value = defaultDate || state.selectedCalendarDate || todayStr();
  if (id) {
    const record = ShoppingRecordRepository.getAll().find((r) => r.id === id);
    if (!record) return;
    dom.shoppingDate.value = record.date;
    dom.shoppingAmount.value = record.amount || '';
    dom.shoppingStore.value = record.store || '';
    dom.shoppingIngredients.value = (record.ingredients || []).join('\n');
    dom.shoppingAddPantry.checked = !record.pantryAdded;
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
  const ingredients = parseIngredientList(dom.shoppingIngredients.value);
  const addToPantry = dom.shoppingAddPantry.checked;
  const resolved = RecipePickerService.resolve(dom.shoppingRecipeInput, dom.shoppingRecipeId);
  const recipeId = resolved?.id || null;
  const recipeName = resolved?.name || dom.shoppingRecipeInput.value.trim();
  if (!date || Number.isNaN(amount)) return;

  const existing = state.editingShoppingId
    ? ShoppingRecordRepository.getAll().find((r) => r.id === state.editingShoppingId)
    : null;
  const shouldAddPantry = addToPantry && ingredients.length && !(existing?.pantryAdded);

  const payload = {
    date,
    amount,
    store,
    ingredients,
    recipeId,
    recipeName,
    pantryAdded: existing?.pantryAdded || shouldAddPantry,
    currency: state.editingShoppingId ? undefined : state.currency,
  };

  const finish = (msg) => {
    state.selectedCalendarDate = date;
    const [y, m] = date.split('-').map(Number);
    state.calendarYear = y;
    state.calendarMonth = m - 1;
    closeModal('shopping');
    refreshAll();
    showToast(msg);
  };

  const afterSave = (msg) => {
    if (!shouldAddPantry) {
      finish(msg);
      return;
    }
    PantryIngredientService.addFromNames(ingredients, { recipeId, recipeName })
      .then(({ added }) => {
        if (isLoggedInAppUser()) {
          const latest = ShoppingRecordRepository.getAll().find((r) => r.date === date && r.amount === amount);
          if (latest) {
            saveShoppingRecordToStore({ ...latest, pantryAdded: true }, latest.id).catch(() => undefined);
          }
        } else if (existing) {
          ShoppingRecordRepository.update(existing.id, { pantryAdded: true });
        }
        finish(added ? `${msg} · 재료 ${added}개를 보유 재료에 추가했어요` : msg);
      })
      .catch(() => finish(msg));
  };

  saveShoppingRecordToStore(payload, state.editingShoppingId)
    .then(() => {
      if (!isLoggedInAppUser()) notifyGuestPersonalDataNotPersisted('장보기 기록');
      afterSave(state.editingShoppingId ? '장보기 기록이 수정되었어요' : `장보기 ${formatMoney(amount, state.currency)} 기록 완료!`);
    })
    .catch((err) => showToast(err.message || '장보기 기록 저장에 실패했습니다.'));
}

function changeCalendarMonth(delta) {
  state.calendarMonth += delta;
  if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear += 1; }
  else if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear -= 1; }
  renderCalendar();
}

// ===== Meal Planner =====
const PLANNER_WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

function formatPlannerDayLabel(dateStr) {
  const d = new Date(`${dateStr}T00:00:00`);
  return `${PLANNER_WEEKDAYS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}`;
}

function getPlannerRecipeOptionsHTML() {
  return RecipeRepository.getRecommendableRecipes()
    .map((r) => `<option value="${esc(r.name)}"></option>`)
    .join('');
}

function applyPlannerSlotChange(input) {
  const data = GroceryListService.resolveEntry(input.value);
  MealPlanRepository.set(input.dataset.date, input.dataset.slot, data);
  if (data.name && data.name !== input.value.trim()) input.value = data.name;
  persistMealPlans().catch(() => undefined);
  renderGroceryList();
}

function handlePlannerSlotInputChange(input) {
  const pendingValue = input.value;
  const date = input.dataset.date;
  const slot = input.dataset.slot;
  if (isGuestUser()) {
    const entry = MealPlanRepository.get(date, slot);
    input.value = entry?.name || '';
    requireAppLogin({
      redirectAfterLogin: () => {
        const el = dom.plannerGrid?.querySelector(
          `.planner-slot__input[data-date="${date}"][data-slot="${slot}"]`,
        );
        if (el) {
          el.value = pendingValue;
          applyPlannerSlotChange(el);
        }
      },
    });
    return;
  }
  applyPlannerSlotChange(input);
}

function renderPlanner() {
  if (!dom.plannerGrid) return;
  const guest = isGuestUser();
  if (dom.plannerGuestHint) dom.plannerGuestHint.hidden = !guest;

  const dates = GroceryListService.getPlannerDates(state.plannerRange);
  const isMonth = state.plannerRange === 'month';
  dom.plannerGrid.classList.toggle('planner-grid--month', isMonth);
  dom.plannerAutoBtn.hidden = isMonth;

  dom.plannerGrid.innerHTML = dates.map((date) => {
    const slots = PLANNER_SLOTS.map((slot) => {
      const entry = MealPlanRepository.get(date, slot.id);
      const value = entry.name || '';
      return `
        <label class="planner-slot">
          <span class="planner-slot__label">${slot.label}</span>
          <input type="text" class="planner-slot__input" list="planner-recipe-options"
            data-date="${esc(date)}" data-slot="${slot.id}" value="${esc(value)}"
            placeholder="메뉴 또는 레시피명" autocomplete="off">
        </label>`;
    }).join('');
    const todayMark = date === todayStr() ? ' planner-day--today' : '';
    return `
      <article class="planner-day${todayMark}">
        <h3 class="planner-day__title">${formatPlannerDayLabel(date)}</h3>
        <div class="planner-day__slots">${slots}</div>
      </article>`;
  }).join('') + `<datalist id="planner-recipe-options">${getPlannerRecipeOptionsHTML()}</datalist>`;

  dom.plannerGrid.querySelectorAll('.planner-slot__input').forEach((input) => {
    input.addEventListener('change', () => handlePlannerSlotInputChange(input));
  });

  if (dom.plannerRange) dom.plannerRange.value = state.plannerRange;
  if (dom.groceryBudget) dom.groceryBudget.value = GroceryRepository.getBudget();
  renderGroceryList();
}

function renderGroceryBudgetSummary(total) {
  if (!dom.groceryBudgetSummary) return;
  const budget = Number(GroceryRepository.getBudget()) || 0;
  if (!budget && !total) {
    dom.groceryBudgetSummary.textContent = '';
    return;
  }
  if (!budget) {
    dom.groceryBudgetSummary.textContent = `예상 ${formatMoney(total)}`;
    return;
  }
  const diff = budget - total;
  const diffLabel = diff >= 0
    ? `여유 ${formatMoney(diff)}`
    : `${formatMoney(Math.abs(diff))} 초과`;
  dom.groceryBudgetSummary.textContent = `예상 ${formatMoney(total)} · ${diffLabel}`;
  dom.groceryBudgetSummary.classList.toggle('budget-box__summary--over', diff < 0);
}

function renderGroceryList() {
  if (!dom.groceryList) return;

  if (isGuestUser()) {
    dom.groceryEmpty.hidden = false;
    dom.groceryList.hidden = true;
    dom.groceryList.innerHTML = '';
    const emptyText = dom.groceryEmpty?.querySelector('.empty-state__text');
    if (emptyText) emptyText.textContent = '로그인하면 장보기 목록을 저장할 수 있어요.';
    if (dom.groceryBudgetSummary) dom.groceryBudgetSummary.textContent = '';
    return;
  }

  const dates = GroceryListService.getPlannerDates(state.plannerRange);
  const grouped = GroceryListService.computeMissing(dates);
  const totalItems = GROCERY_CATEGORIES.reduce((n, c) => n + (grouped[c.id]?.length || 0), 0);
  const totalCost = GroceryListService.estimateTotal(grouped);

  dom.groceryEmpty.hidden = totalItems > 0;
  dom.groceryList.hidden = totalItems === 0;
  dom.groceryList.classList.toggle('grocery-list--mart', state.martMode);
  if (dom.martModeToggle) {
    dom.martModeToggle.textContent = state.martMode ? '일반 모드' : '마트 모드';
    dom.martModeToggle.classList.toggle('btn--primary', state.martMode);
  }

  renderGroceryBudgetSummary(totalCost);
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
      const qty = item.count > 1 ? ` ×${item.count}` : '';
      const priceField = state.martMode ? '' : `
        <input type="number" class="grocery-item__price" data-price-key="${esc(item.key)}"
          min="0" step="0.01" inputmode="decimal" placeholder="금액"
          value="${meta.price !== '' && meta.price != null ? esc(String(meta.price)) : ''}">`;
      return `
        <label class="grocery-item${meta.checked ? ' grocery-item--checked' : ''}">
          <input type="checkbox" class="grocery-item__check" data-check-key="${esc(item.key)}"${meta.checked ? ' checked' : ''}>
          <span class="grocery-item__name">${esc(item.name)}${qty}</span>
          ${priceField}
        </label>`;
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
      requireAppLogin(() => {
        GroceryRepository.setChecked(cb.dataset.checkKey, cb.checked);
        persistGroceryState().catch(() => undefined);
        renderGroceryList();
      });
    };
  });
  dom.groceryList.querySelectorAll('.grocery-item__price').forEach((input) => {
    input.onchange = () => {
      requireAppLogin(() => {
        GroceryRepository.setPrice(input.dataset.priceKey, input.value);
        persistGroceryState().catch(() => undefined);
        renderGroceryBudgetSummary(GroceryListService.estimateTotal(grouped));
      });
    };
  });
}

function autoGenerateWeeklyPlan() {
  const dates = GroceryListService.getPlannerDates('week');
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
      MealPlanRepository.set(date, slot.id, { recipeId: pick.recipe.id, name: pick.recipe.name });
      usedIds.add(pick.recipe.id);
    }
  }
  persistMealPlans().catch(() => undefined);
  renderPlanner();
  showToast('이번 주 식단을 자동으로 채웠어요');
}

function handleGroceryPurchaseComplete() {
  const dates = GroceryListService.getPlannerDates(state.plannerRange);
  const grouped = GroceryListService.computeMissing(dates);
  const names = [];
  for (const cat of GROCERY_CATEGORIES) {
    for (const item of grouped[cat.id] || []) {
      const meta = GroceryRepository.getMeta(item.key);
      if (!meta.checked) continue;
      names.push(item.count > 1 ? `${item.name} ${item.count}개` : item.name);
    }
  }
  if (!names.length) {
    showToast('구매한 재료를 체크해 주세요');
    return;
  }
  PantryIngredientService.addFromNames(names, { skipDuplicates: true })
    .then(({ added }) => {
      showToast(`${added}개 재료를 냉장고에 추가했어요`);
    })
    .catch(() => undefined);
}

// ===== Recipe Detail Modal =====
function openRecipeDetail(result) {
  const { recipe } = result;
  if (!recipe) return;
  state.detailRecipeId = recipe.id;
  const names = RecommendationService.getPantryNames();
  const a = result.matchPercent != null ? result : MatchService.analyze(names, recipe.ingredients);
  const owned = RecipeRepository.isOwned(recipe);
  const saved = SavedRecipeRepository.isSaved(recipe.id);
  const hasPantry = names.length > 0;

  const substitutionAdvices = a.substitutionAdvices?.length
    ? a.substitutionAdvices
    : MatchService.getSubstitutionAdvices(hasPantry ? a.missing : recipe.ingredients);

  dom.modalContent.innerHTML = `
    <div class="recipe-detail">
      <div class="recipe-detail__hero">
        ${recipeHeroHTML(recipe)}
        <div class="recipe-detail__hero-overlay"></div>
        <h2 class="recipe-detail__hero-title">${esc(recipe.name)}</h2>
      </div>
      <div class="recipe-detail__content">
        ${recipeOriginHTML(recipe)}
        ${recipe.sourceUrl ? `<a class="recipe-detail__source-link" href="${esc(recipe.sourceUrl)}" target="_blank" rel="noopener noreferrer">🎬 원본 영상 보기</a>` : ''}
        <div class="recipe-detail__tags">
          ${recipe.tags.map((t) => `<span class="recipe-detail__tag">${esc(t)}</span>`).join('')}
          <span class="recipe-detail__tag">${recipe.visibility === 'public' ? '🌐 공개' : '🔒 비공개'}</span>
          <span class="recipe-detail__tag">👤 ${esc(recipe.authorName)}</span>
        </div>
        <div class="recipe-detail__stats">
          <div class="stat"><span class="stat__label">조리시간</span><span class="stat__value">${recipe.cookTime}분</span></div>
          <div class="stat"><span class="stat__label">난이도</span><span class="stat__value">${recipe.difficulty}</span></div>
          <div class="stat"><span class="stat__label">일치율</span><span class="stat__value">${a.matchPercent}%</span></div>
        </div>
        <section class="recipe-detail__section">
          <h3 class="recipe-detail__section-title">🥬 재료 ${hasPantry ? `<span class="recipe-detail__match-rate">일치율 ${a.matchPercent}%</span>` : ''}</h3>
          ${hasPantry ? MatchService.renderMatchDetailHTML(a) : `<ul class="ingredient-list">${recipe.ingredients.map((ing) => {
            const name = getIngredientMatchName(ing);
            return `<li class="ingredient-list__item ingredient-list__item--buy">
              <span>${esc(formatIngredientDisplay(ing))}</span>
              ${AffiliateService.buyButtonHTML(name, { compact: true })}
            </li>`;
          }).join('')}</ul>`}
        </section>
        ${MatchService.renderSubstitutionGuideHTML(substitutionAdvices)}
        ${recipe.ingredientSubstitutes?.length ? `
        <section class="recipe-detail__section">
          <h3 class="recipe-detail__section-title">🔄 대체 가능 재료 (레시피 기록)</h3>
          <ul class="recipe-detail__substitutes">
            ${recipe.ingredientSubstitutes.map((s) => `<li>${esc(s)}</li>`).join('')}
          </ul>
        </section>` : ''}
        <section class="recipe-detail__section">
          <h3 class="recipe-detail__section-title">👨‍🍳 조리 순서</h3>
          <ol class="step-list">${recipe.steps.map((s) => `<li class="step-list__item">${esc(s)}</li>`).join('')}</ol>
        </section>
        ${recipe.memo ? `<section class="recipe-detail__section"><h3 class="recipe-detail__section-title">📝 메모</h3><p class="recipe-detail__memo">${linkifyText(recipe.memo)}</p></section>` : ''}
        <div class="recipe-detail__actions">
          ${AffiliateService.isEnabled() ? `<button type="button" class="btn btn--outline" id="btn-buy-recipe-ingredients">🛒 부족 재료 구매</button>` : ''}
          <button type="button" class="btn btn--meal-log" id="btn-log-meal-recipe" data-auth-required>🍳 식사 기록</button>
          <button type="button" class="btn ${saved ? 'btn--primary' : 'btn--outline'}" id="btn-save-recipe" data-auth-required>${saved ? '⭐ 저장됨' : '☆ 레시피 저장'}</button>
          ${canForkRecipe(recipe) ? `<button type="button" class="btn btn--outline" id="btn-fork-recipe">✏️ 내 버전 만들기</button>` : ''}
          ${owned ? `<button type="button" class="btn btn--ghost" id="btn-edit-recipe">수정</button>
            <button type="button" class="btn btn--danger" id="btn-delete-recipe">삭제</button>` : ''}
        </div>
      </div>
    </div>`;

  dom.modalContent.querySelector('#btn-log-meal-recipe')?.addEventListener('click', () => {
    requireAppLogin(() => {
      closeModal('recipe');
      openMealModal(null, { defaultDate: todayStr(), recipeId: recipe.id, mealType: 'home-cook', hideMealType: true });
    });
  });
  dom.modalContent.querySelector('#btn-buy-recipe-ingredients')?.addEventListener('click', () => {
    const targets = hasPantry && a.missing.length ? a.missing : recipe.ingredients;
    const query = targets.map((ing) => getIngredientMatchName(ing)).slice(0, 3).join(' ');
    if (query) AffiliateService.openSearch(query);
  });
  dom.modalContent.querySelector('#btn-save-recipe')?.addEventListener('click', () => {
    requireAppLogin(() => {
      SavedRecipeRepository.toggle(recipe.id);
      persistSavedRecipeIds().catch(() => undefined);
      openRecipeDetail({ recipe, ...MatchService.analyze(names, recipe.ingredients) });
      renderMyRecipes();
    });
  });
  dom.modalContent.querySelector('#btn-fork-recipe')?.addEventListener('click', () => {
    forkRecipeFrom(recipe.id);
  });
  dom.modalContent.querySelector('[data-open-parent]')?.addEventListener('click', (e) => {
    const parent = RecipeRepository.getById(e.currentTarget.dataset.openParent);
    if (parent) openRecipeDetail({ recipe: parent, ...MatchService.analyze(names, parent.ingredients) });
  });
  dom.modalContent.querySelector('#btn-edit-recipe')?.addEventListener('click', () => {
    closeModal('recipe'); openRecipeForm(recipe.id);
  });
  dom.modalContent.querySelector('#btn-delete-recipe')?.addEventListener('click', () => {
    if (confirm(`"${recipe.name}" 삭제할까요?`)) {
      deleteUserRecipe(recipe.id)
        .then(() => { closeModal('recipe'); refreshAll(); })
        .catch((err) => showToast(err.message || '삭제에 실패했습니다.'));
    }
  });
  bindZoomableImages(dom.modalContent);
  openModal('recipe');
  syncAuthGateUi();
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

function setVideoExtractLoading(loading) {
  if (dom.videoAnalyzeBtn) {
    const limitReached = state.aiUsageRemaining === 0;
    dom.videoAnalyzeBtn.disabled = loading || limitReached;
    dom.videoAnalyzeBtn.classList.toggle('btn--loading', loading);
    dom.videoAnalyzeBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
  if (dom.videoFallbackAnalyzeBtn) {
    dom.videoFallbackAnalyzeBtn.disabled = loading;
    dom.videoFallbackAnalyzeBtn.classList.toggle('btn--loading', loading);
    dom.videoFallbackAnalyzeBtn.setAttribute('aria-busy', loading ? 'true' : 'false');
  }
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
  dom.videoFormError.textContent = msg;
  dom.videoFormError.hidden = false;
}

function showVideoReviewError(msg) {
  dom.videoReviewError.textContent = msg;
  dom.videoReviewError.hidden = false;
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

async function handleVideoExtract() {
  if (!isLoggedInAppUser()) {
    requireAppLogin({
      preset: 'videoRecipe',
      redirectAfterLogin: () => handleVideoExtract(),
    });
    return;
  }
  dom.videoFormError.hidden = true;
  hideVideoFallback();
  hideVideoExtractWarning();
  const sourceUrl = dom.videoSourceUrl.value.trim();
  if (!sourceUrl) return showVideoFormError('영상 링크를 입력해 주세요.');

  const check = VideoRecipeAnalysisService.validateUrl(sourceUrl);
  if (!check.ok) return showVideoFormError(check.error);

  setVideoExtractLoading(true);

  try {
    const textPayload = VideoRecipeAnalysisService.collectVideoTextPayload();
    const result = await VideoRecipeAnalysisService.extractViaApi(sourceUrl, textPayload);
    if (!result) {
      throw new Error('레시피 추출 결과가 비어 있습니다.');
    }
    fillVideoReviewForm(result);
    if (result._warning) showRecipeWarning(result._warning);
    setRecipeFormTab('review');
    if (result._isMockData) {
      showToast('현재는 테스트 데이터입니다. 내용을 확인해 주세요.');
    } else if (result._warning) {
      showToast('레시피를 정리했어요. 안내 문구를 확인해 주세요.');
    } else {
      showToast('레시피 추출이 완료됐어요. 내용을 확인해 주세요.');
    }
  } catch (err) {
    logVideoExtractError('handleVideoExtract', err, { sourceUrl });
    if (err.code === 'DAILY_LIMIT_EXCEEDED' || err.code === 'ANALYSIS_LIMIT_EXCEEDED') {
      showAiDailyLimitAlert(err.message);
      AiUsageService.updateDisplay(err.aiUsage || { remaining: 0, limit: AiUsageService.getDailyLimit() });
      return;
    }
    const mapped = mapVideoExtractUserError(err, err.apiResponse);
    if (mapped.showFallback || err.code === 'FALLBACK') {
      if (err.warning) showVideoExtractWarning(err.warning);
      else if (err.infoHint) showVideoExtractWarning(err.infoHint);
      showVideoFallback(mapped.message);
    } else {
      showVideoFormError(mapped.message);
    }
  } finally {
    setVideoExtractLoading(false);
  }
}

async function handleVideoFallbackAnalyze() {
  if (!isLoggedInAppUser()) {
    requireAppLogin({
      preset: 'videoRecipe',
      redirectAfterLogin: () => handleVideoFallbackAnalyze(),
    });
    return;
  }
  dom.videoFormError.hidden = true;
  const sourceUrl = dom.videoSourceUrl.value.trim();
  const textPayload = VideoRecipeAnalysisService.collectVideoTextPayload();

  if (!textPayload.pastedText || textPayload.pastedText.length < 20) {
    return showVideoFormError('영상 설명글이나 캡션을 20자 이상 붙여넣어 주세요.');
  }

  setVideoExtractLoading(true);

  try {
    const check = VideoRecipeAnalysisService.validateUrl(sourceUrl);
    if (!check.ok) return showVideoFormError(check.error);
    const result = await VideoRecipeAnalysisService.extractViaApi(sourceUrl, textPayload);
    if (!result) throw new Error('레시피 추출 결과가 비어 있습니다.');
    fillVideoReviewForm(result);
    hideVideoFallback();
    hideVideoExtractWarning();
    if (result._warning) showRecipeWarning(result._warning);
    dom.videoPasteText.value = '';
    setRecipeFormTab('review');
    showToast(result._warning
      ? '레시피를 정리했어요. 안내 문구를 확인해 주세요.'
      : '레시피 정리가 완료됐어요. 내용을 확인해 주세요.');
  } catch (err) {
    logVideoExtractError('handleVideoFallbackAnalyze', err, { sourceUrl });
    if (err.code === 'DAILY_LIMIT_EXCEEDED' || err.code === 'ANALYSIS_LIMIT_EXCEEDED') {
      showAiDailyLimitAlert(err.message);
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

function prepareRecipeForm(id = null) {
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
    dom.formCookTime.value = r.cookTime;
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
  }
  return true;
}

// ===== Recipe Form =====
function openRecipeForm(id = null) {
  if (!isLoggedInAppUser()) {
    requireAppLogin({
      redirectAfterLogin: () => openRecipeForm(id),
    });
    return;
  }
  if (id && !RecipeRepository.getById(id)) return;
  if (!prepareRecipeForm(id)) return;
  openModal('form');
  requestAnimationFrame(() => dom.formName.focus());
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
  if (!data.steps.length) return showError('조리 순서를 입력해 주세요.');

  if (state.editingRecipeId && !data.image) {
    const existing = RecipeRepository.getById(state.editingRecipeId);
    if (existing?.image) data.image = existing.image;
  }

  saveUserRecipe(data, state.editingRecipeId)
    .then(() => {
      closeModal('form');
      refreshAll();
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
  const anyOpen = !dom.recipeModal.hidden
    || !dom.recipeFormModal.hidden
    || !dom.pantryModal.hidden
    || !dom.mealModal.hidden
    || !dom.shoppingModal.hidden
    || (dom.loginPromptModal && !dom.loginPromptModal.hidden);
  document.body.style.overflow = anyOpen ? 'hidden' : '';
}

window.updateBodyScrollLock = updateBodyScrollLock;

function openModal(type) {
  const m = { recipe: dom.recipeModal, form: dom.recipeFormModal, pantry: dom.pantryModal, meal: dom.mealModal, shopping: dom.shoppingModal }[type];
  m.hidden = false; m.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}
function closeModal(type) {
  const m = { recipe: dom.recipeModal, form: dom.recipeFormModal, pantry: dom.pantryModal, meal: dom.mealModal, shopping: dom.shoppingModal }[type];
  if (!m) return;
  m.hidden = true; m.setAttribute('aria-hidden', 'true');
  updateBodyScrollLock();
  window.dispatchEvent(new CustomEvent('ui-modal-change'));
}
function closeAllModals() {
  ['recipe', 'form', 'pantry', 'meal', 'shopping'].forEach(closeModal);
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
    const reg = await navigator.serviceWorker.register('./sw.js?v=50');
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
  dom.currencySelect.value = state.currency;
  initRecipePickers();

  dom.tabItems.forEach((tab) => { tab.onclick = () => navigate(tab.dataset.view); });
  dom.openPantryManageBtn.onclick = () => navigate('pantry');
  dom.quickForm.addEventListener('submit', handleQuickAdd);
  dom.quickInput.addEventListener('compositionstart', () => { state.isComposing = true; });
  dom.quickInput.addEventListener('compositionend', () => { state.isComposing = false; });
  dom.menuSearchInput.addEventListener('input', () => {
    state.menuSearch = dom.menuSearchInput.value;
    renderHome();
  });
  dom.communitySearchInput.addEventListener('input', () => {
    state.communitySearch = dom.communitySearchInput.value;
    renderCommunity();
  });
  dom.communityFilterBtn?.addEventListener('click', () => toggleCommunityFilterPanel());
  dom.openPantryAdd.onclick = () => openPantryModal();
  dom.openRecipeForm.onclick = (e) => {
    e.preventDefault();
    openRecipeForm();
  };
  dom.openMealAddBtn.onclick = () => openMealModal(null, state.selectedCalendarDate || todayStr());
  dom.openShoppingAddBtn.onclick = () => openShoppingModal(null, state.selectedCalendarDate || todayStr());
  dom.currencySelect.onchange = () => {
    state.currency = CURRENCY_OPTIONS[dom.currencySelect.value] ? dom.currencySelect.value : DEFAULT_CURRENCY;
    if (isLoggedInAppUser()) {
      persistCurrencySetting().catch(() => undefined);
    } else {
      StorageAdapter.set(CONFIG.STORAGE.CURRENCY, state.currency);
    }
    renderCalendar();
  };
  dom.calendarPrev.onclick = () => changeCalendarMonth(-1);
  dom.calendarNext.onclick = () => changeCalendarMonth(1);
  dom.plannerRange?.addEventListener('change', () => {
    state.plannerRange = dom.plannerRange.value === 'month' ? 'month' : 'week';
    renderPlanner();
  });
  dom.plannerAutoBtn?.addEventListener('click', () => requireAppLogin(autoGenerateWeeklyPlan));
  dom.martModeToggle?.addEventListener('click', () => {
    state.martMode = !state.martMode;
    renderGroceryList();
  });
  dom.groceryCompleteBtn?.addEventListener('click', () => requireAppLogin(handleGroceryPurchaseComplete));
  dom.groceryBudget?.addEventListener('change', () => {
    const pendingBudget = dom.groceryBudget.value;
    if (isGuestUser()) {
      dom.groceryBudget.value = GroceryRepository.getBudget();
      requireAppLogin({
        redirectAfterLogin: () => {
          dom.groceryBudget.value = pendingBudget;
          GroceryRepository.setBudget(pendingBudget);
          persistGroceryState().catch(() => undefined);
          renderGroceryBudgetSummary(GroceryListService.estimateTotal(
            GroceryListService.computeMissing(GroceryListService.getPlannerDates(state.plannerRange)),
          ));
        },
      });
      return;
    }
    GroceryRepository.setBudget(pendingBudget);
    persistGroceryState().catch(() => undefined);
    renderGroceryBudgetSummary(GroceryListService.estimateTotal(
      GroceryListService.computeMissing(GroceryListService.getPlannerDates(state.plannerRange)),
    ));
  });
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
  dom.videoAnalyzeBtn?.addEventListener('click', handleVideoExtract);
  dom.videoFallbackAnalyzeBtn?.addEventListener('click', handleVideoFallbackAnalyze);
  dom.videoReviewBackBtn?.addEventListener('click', () => setRecipeFormTab('video'));
  dom.videoRecipeSaveBtn?.addEventListener('click', handleVideoRecipeSave);
  let videoPreviewTimer = null;
  dom.videoSourceUrl?.addEventListener('input', () => {
    clearTimeout(videoPreviewTimer);
    videoPreviewTimer = setTimeout(updateVideoLinkPreview, 400);
  });
  dom.videoSourceUrl?.addEventListener('blur', updateVideoLinkPreview);
  initRecipePhotoUpload();

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.onclick = () => {
      const type = el.dataset.closeModal;
      if (type === 'login') window.LoginRequiredModal?.close(true);
      else if (type !== 'profile') closeModal(type);
    };
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  dom.imageLightbox?.querySelectorAll('[data-close-lightbox]').forEach((el) => {
    el.onclick = closeImageLightbox;
  });

  navigate('main');
}

function startApp() {
  init();
  registerServiceWorker();
  window.addEventListener('auth-state-changed', () => {
    AiUsageService.refreshDisplay();
    syncAuthGateUi();
    refreshAll();
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
    MealPlanRepository.replaceAll(e.detail?.plans || {});
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
    }
    if (settings.grocery) GroceryRepository.replaceState(settings.grocery);
    if (Array.isArray(settings.savedRecipeIds)) SavedRecipeRepository.replaceIds(settings.savedRecipeIds);
    refreshAll();
  });
  window.addEventListener('public-recipes-firestore-sync', (e) => {
    PublicRecipeRepository.replaceAll(e.detail?.recipes || []);
    if (state.view === 'community') renderCommunity();
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
