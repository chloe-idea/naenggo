/**
 * 레시피 대표 이미지 — /public/images/recipes (URL: /images/recipes)
 *
 * 규칙:
 * - imageUrl/image/thumbnailUrl이 있고 유효할 때만 <img> 요청
 * - id/slug로 경로를 추측해 요청하지 않음
 * - 번들 이미지는 실제 파일 allowlist에 있을 때만 사용
 * - 없으면 placeholder(로컬 SVG/아이콘) — 없는 경로로 <img> 만들지 않음
 * - 실제 이미지 로드 실패 시에만 default-recipe.webp 1회
 */
window.RECIPE_IMAGE_MAP = {};

const RECIPE_IMAGES_BASE = 'images/recipes/';
const DEFAULT_RECIPE_IMAGE = `${RECIPE_IMAGES_BASE}default-recipe.webp`;

/** APP_CONFIG.runtime.recipeImageVersion 단일 소스 (fallback은 동일 값 1회만) */
function getRecipeImageVersion() {
  const fromConfig = window.APP_CONFIG?.runtime?.recipeImageVersion
    || window.APP_CONFIG?.runtime?.appVersion;
  const raw = String(fromConfig || '20260816').trim();
  const digits = raw.replace(/\D/g, '');
  return digits || '20260816';
}

/** public/images/recipes 에 실제로 있는 파일 (default 제외) */
const EXISTING_RECIPE_IMAGE_FILES = new Set([
  '--152.webp',
  '--153.webp',
  'aglio-olio.webp',
  'bun-bo-hue.webp',
  'cheese-pancake.webp',
  'cheese-rice-ball.webp',
  'cold-pasta.webp',
  'egg-fried-rice.webp',
  'egg-in-hell.webp',
  'egg-soup-diet.webp',
  'egg-white-omelet.webp',
  'khao-pad.webp',
  'kimchi-fried-rice.webp',
  'kimchi-pancake.webp',
  'kimchi-rice-ball.webp',
  'kimchi-stew.webp',
  'natto-rice-bowl.webp',
  'omurice.webp',
  'onion-egg-rice-bowl.webp',
  'onion-egg-stir-fry.webp',
  'onion-stir-fry.webp',
  'pad-thai.webp',
  'pho.webp',
  'potato-cheese-bake.webp',
  'potato-fries.webp',
  'potato-pancake.webp',
  'ramen-snack.webp',
  'ramen.webp',
  'recipe-110.webp',
  'recipe-12.webp',
  'recipe-120.webp',
  'recipe-125.webp',
  'recipe-127.webp',
  'recipe-129.webp',
  'recipe-13.webp',
  'recipe-138.webp',
  'recipe-14.webp',
  'recipe-141.webp',
  'recipe-147.webp',
  'recipe-149.webp',
  'recipe-15.webp',
  'recipe-159.webp',
  'recipe-16.webp',
  'recipe-17.webp',
  'recipe-174.webp',
  'recipe-175.webp',
  'recipe-176.webp',
  'recipe-177.webp',
  'recipe-178.webp',
  'recipe-179.webp',
  'recipe-18.webp',
  'recipe-180.webp',
  'recipe-181.webp',
  'recipe-19.webp',
  'recipe-192.webp',
  'recipe-20.webp',
  'recipe-21.webp',
  'recipe-22.webp',
  'recipe-23.webp',
  'recipe-24.webp',
  'recipe-26.webp',
  'recipe-27.webp',
  'recipe-28.webp',
  'recipe-29.webp',
  'recipe-30.webp',
  'recipe-31.webp',
  'recipe-32.webp',
  'recipe-33.webp',
  'recipe-34.webp',
  'recipe-35.webp',
  'recipe-38.webp',
  'recipe-39.webp',
  'recipe-40.webp',
  'recipe-41.webp',
  'recipe-42.webp',
  'recipe-43.webp',
  'recipe-44.webp',
  'recipe-45.webp',
  'recipe-47.webp',
  'recipe-48.webp',
  'recipe-49.webp',
  'recipe-5.webp',
  'recipe-50.webp',
  'recipe-51.webp',
  'recipe-52.webp',
  'recipe-53.webp',
  'recipe-55.webp',
  'recipe-56.webp',
  'recipe-57.webp',
  'recipe-58.webp',
  'recipe-59.webp',
  'recipe-60.webp',
  'recipe-61.webp',
  'recipe-62.webp',
  'recipe-63.webp',
  'recipe-64.webp',
  'recipe-66.webp',
  'recipe-67.webp',
  'recipe-68.webp',
  'recipe-69.webp',
  'recipe-70.webp',
  'recipe-72.webp',
  'recipe-73.webp',
  'recipe-74.webp',
  'recipe-75.webp',
  'recipe-76.webp',
  'recipe-77.webp',
  'recipe-79.webp',
  'recipe-8.webp',
  'recipe-80.webp',
  'recipe-81.webp',
  'recipe-82.webp',
  'recipe-83.webp',
  'recipe-84.webp',
  'recipe-86.webp',
  'recipe-87.webp',
  'recipe-88.webp',
  'recipe-89.webp',
  'recipe-9.webp',
  'recipe-90.webp',
  'scrambled-eggs.webp',
  'sesame-seaweed-fried-rice.webp',
  'shrimp-tofu.webp',
  'soft-tofu-stew.webp',
  'soy-sauce-egg-rice.webp',
  'soybean-paste-stew.webp',
  'spam-rice-ball.webp',
  'steamed-egg.webp',
  'stir-fried-udon.webp',
  'sweet-potato-fries.webp',
  'sweet-potato-sticks.webp',
  'tofu-salad.webp',
  'tomato-pasta.webp',
  'tteokbokki.webp',
  'tuna-mayo-rice-ball.webp',
  'tuna-mayo-rice.webp',
  'tuna-rice-ball.webp',
  'tuna-salad.webp',
  'vietnamese-fried-rice.webp',
]);

/** 레시피명 → slug (명시적 image 필드 검증·표시용) */
const RECIPE_NAME_SLUGS = {
  '고구마튀김': 'sweet-potato-fries',
  '감자튀김': 'potato-fries',
  '고구마스틱': 'sweet-potato-sticks',
  '계란흰자오믈렛': 'egg-white-omelet',
  '감자전': 'potato-pancake',
  '감자치즈구이': 'potato-cheese-bake',
  '에그인헬': 'egg-in-hell',
  '참치주먹밥': 'tuna-rice-ball',
  '참기름김볶음밥': 'sesame-seaweed-fried-rice',
  '낫또덮밥': 'natto-rice-bowl',
  '에그스크램블': 'scrambled-eggs',
  '참치마요주먹밥': 'tuna-mayo-rice-ball',
  '스팸주먹밥': 'spam-rice-ball',
  '김치주먹밥': 'kimchi-rice-ball',
  '치즈주먹밥': 'cheese-rice-ball',
  '라면': 'ramen',
  '두부샐러드': 'tofu-salad',
  '참치샐러드': 'tuna-salad',
  '계란국다이어트': 'egg-soup-diet',
  '양파계란볶음': 'onion-egg-stir-fry',
  '양파볶음': 'onion-stir-fry',
  '양파계란덮밥': 'onion-egg-rice-bowl',
  '치즈전': 'cheese-pancake',
  '냉파스타': 'cold-pasta',
  '라면땅': 'ramen-snack',
};

const LEGACY_ASSET_BASE = 'src/assets/recipe-images/';

function isUnsplashUrl(url) {
  return String(url || '').includes('images.unsplash.com');
}

/** 기존 ?v= / &v= 제거 후 단일 버전만 부여 (?v=2&v=2 방지). 렌더링용. */
function withRecipeImageVersion(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
  const pathOnly = url.split('?')[0].split('#')[0];
  if (!pathOnly) return url;
  return `${pathOnly}?v=${getRecipeImageVersion()}`;
}

/** 저장·데이터용 — query 없이 경로만 */
function stripRecipeImageVersion(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
  return url.split('?')[0].split('#')[0];
}

function stripToRecipeImageFilename(url) {
  if (!url || typeof url !== 'string') return null;
  const pathOnly = stripRecipeImageVersion(url).replace(/^\/+/, '');
  const normalized = pathOnly.replace(/^public\//, '');
  if (!normalized.startsWith(RECIPE_IMAGES_BASE)) return null;
  return normalized.slice(RECIPE_IMAGES_BASE.length) || null;
}

function isKnownBundledImage(url) {
  const file = stripToRecipeImageFilename(url);
  if (!file) return false;
  if (/^default-recipe\./i.test(file)) return false;
  return EXISTING_RECIPE_IMAGE_FILES.has(file);
}

function normalizeRecipePhotoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  let path = stripRecipeImageVersion(trimmed).replace(/^\/+/, '').replace(/^public\//, '');
  if (path.startsWith(RECIPE_IMAGES_BASE) || path.startsWith('images/recipes/')) {
    if (!path.startsWith(RECIPE_IMAGES_BASE)) path = path.replace(/^images\/recipes\//, RECIPE_IMAGES_BASE);
    return path;
  }
  if (path.startsWith('src/assets/')) return path;
  // 파일명만 온 경우 — allowlist에 있을 때만
  if (!path.includes('/') && EXISTING_RECIPE_IMAGE_FILES.has(path)) {
    return `${RECIPE_IMAGES_BASE}${path}`;
  }
  return null;
}

function inferRecipeSlug(recipe) {
  const name = recipe?.name || recipe?.title || '';
  if (recipe?.slug) {
    const slug = String(recipe.slug).trim().replace(/^builtin-/, '');
    if (slug) return slug;
  }
  if (recipe?.imageSlug) return String(recipe.imageSlug).trim();
  if (name && RECIPE_NAME_SLUGS[name]) return RECIPE_NAME_SLUGS[name];
  const id = recipe?.id ? String(recipe.id).trim().replace(/^builtin-/, '') : '';
  if (id) return id;
  return '';
}

function resolveLegacyCategoryAsset(recipe) {
  const map = typeof RECIPE_IMAGE_MAP !== 'undefined' ? RECIPE_IMAGE_MAP : {};
  const name = recipe?.name || recipe?.title || '';
  if (name && map[name]) return normalizeRecipePhotoUrl(map[name]);
  const category = recipe?.category;
  const categoryAssets = {
    western: 'pasta.png',
    italian: 'pasta.png',
    chinese: 'noodle.png',
    japanese: 'rice.png',
  };
  if (category && categoryAssets[category]) {
    return `${LEGACY_ASSET_BASE}${categoryAssets[category]}`;
  }
  return `${LEGACY_ASSET_BASE}default.png`;
}

function renderPlaceholderMarkup(recipe, variant = 'card') {
  if (typeof recipePlaceholderHTML === 'function') {
    return recipePlaceholderHTML(recipe, variant === 'hero' || variant === 'home-hero' ? 'hero' : 'card');
  }
  const type = typeof DishTypeService !== 'undefined'
    ? DishTypeService.resolve(recipe)
    : 'default';
  const label = typeof DishTypeService !== 'undefined'
    ? DishTypeService.label(recipe)
    : '요리';
  const classMap = {
    card: `recipe-card__image recipe-card__image--placeholder recipe-card__image--${type}`,
    feed: `recipe-card__image recipe-card__image--feed recipe-card__image--placeholder recipe-card__image--${type}`,
    hero: `recipe-detail__hero--placeholder recipe-detail__hero--${type}`,
    thumb: `home-recipe-row__thumb home-recipe-row__thumb--placeholder recipe-card__image--${type}`,
    'home-hero': `home-today-hero__img home-today-hero__img--placeholder recipe-card__image--${type}`,
    planner: `planner-meal__img planner-meal__img--placeholder recipe-card__image--${type}`,
  };
  const cls = classMap[variant] || classMap.card;
  const escLabel = typeof esc === 'function' ? esc(label) : String(label).replace(/"/g, '&quot;');
  return `<div class="${cls}" aria-label="${escLabel}" title="${escLabel}"></div>`;
}

window.RecipeImageService = {
  basePath: RECIPE_IMAGES_BASE,
  defaultSrc: DEFAULT_RECIPE_IMAGE,
  existingFiles: EXISTING_RECIPE_IMAGE_FILES,

  inferSlug: inferRecipeSlug,

  isValidPhoto(url) {
    if (!url || typeof url !== 'string') return false;
    if (typeof DEFAULT_IMAGE !== 'undefined' && url === DEFAULT_IMAGE) return false;
    if (isUnsplashUrl(url)) return false;
    return true;
  },

  isUserUploadedPhoto(url) {
    if (!this.isValidPhoto(url)) return false;
    const normalized = normalizeRecipePhotoUrl(url) || url;
    if (!normalized) return false;
    if (normalized.startsWith('data:')) return true;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) return true;
    if (normalized.startsWith(RECIPE_IMAGES_BASE)) return false;
    if (normalized.startsWith(LEGACY_ASSET_BASE)) return false;
    return true;
  },

  isKnownBundledImage,

  /**
   * 표시 가능한 실제 사진만 반환. 없으면 null.
   * - hasImage === false 이면 무조건 null
   * - recipe.image / imageUrl / thumbnailUrl 에 명시된 경로를 우선 신뢰
   *   (images/recipes/*.webp 가 allowlist에 없어도 데이터에 있으면 사용, 404는 onerror로 fallback)
   * - id/slug로 없는 경로를 추측해 만들지 않음
   * - hasImage === true 이고 명시 필드가 비었을 때만 allowlist slug 조회
   */
  pickPhoto(recipe) {
    if (!recipe) return null;
    if (recipe.hasImage === false) return null;

    const candidates = [recipe.imageUrl, recipe.image, recipe.thumbnailUrl];
    for (const raw of candidates) {
      if (raw == null || raw === '') continue;
      const normalized = normalizeRecipePhotoUrl(raw);
      if (!normalized || !this.isValidPhoto(normalized)) continue;
      if (this.isUserUploadedPhoto(normalized)) return normalized;
      if (normalized.startsWith(RECIPE_IMAGES_BASE)) {
        const file = stripToRecipeImageFilename(normalized);
        if (!file || /^default-recipe\./i.test(file)) continue;
        // 레시피 데이터에 명시된 번들 경로 → allowlist 여부와 무관하게 표시 (저장용 경로는 version 없음)
        return `${RECIPE_IMAGES_BASE}${file}`;
      }
    }

    // hasImage: true 이고 명시 필드가 비었을 때만 slug allowlist 조회
    if (recipe.hasImage === true) {
      const slug = inferRecipeSlug(recipe);
      if (slug && EXISTING_RECIPE_IMAGE_FILES.has(`${slug}.webp`)) {
        return `${RECIPE_IMAGES_BASE}${slug}.webp`;
      }
    }
    return null;
  },

  hasDisplayImage(recipe) {
    return Boolean(this.pickPhoto(recipe));
  },

  getCandidatePaths(recipe) {
    const photo = this.pickPhoto(recipe);
    return photo ? [photo] : [];
  },

  /** 화면 표시용 — cache-busting ?v= 포함 */
  resolveSrc(recipe) {
    const photo = this.pickPhoto(recipe);
    return photo ? withRecipeImageVersion(photo) : null;
  },

  /** 저장용 — 실제 사진 경로만. query 없음 (가짜 /images/recipes/recipe-xxx.webp 생성 금지) */
  resolveForStorage(recipe) {
    const photo = this.pickPhoto(recipe);
    return photo ? stripRecipeImageVersion(photo) : '';
  },

  resolveCategoryAssetSrc(recipe) {
    return resolveLegacyCategoryAsset(recipe);
  },

  withVersion: withRecipeImageVersion,
  getVersion: getRecipeImageVersion,

  handleImgError(img) {
    if (!img) return;
    img.onerror = null;
    const fallback = withRecipeImageVersion(DEFAULT_RECIPE_IMAGE);
    const current = String(img.currentSrc || img.src || '');
    if (current.includes('default-recipe')) return;
    img.src = fallback;
  },

  renderImg(recipe, options = {}) {
    const {
      variant = 'thumb',
      zoomable = false,
      alt = '',
      lazy = true,
    } = options;

    const src = this.resolveSrc(recipe);
    if (!src) {
      return renderPlaceholderMarkup(recipe, variant);
    }

    const name = recipe?.name || recipe?.title || '요리';
    const altText = typeof esc === 'function' ? esc(alt || name) : String(alt || name).replace(/"/g, '&quot;');
    const escSrc = typeof esc === 'function' ? esc(src) : src;
    const lazyAttr = lazy ? ' loading="lazy"' : '';

    const classMap = {
      card: 'recipe-card__image recipe-display-image',
      feed: 'recipe-card__image recipe-card__image--feed recipe-display-image',
      hero: 'recipe-detail__hero-img',
      thumb: 'home-recipe-row__thumb recipe-display-image',
      'home-hero': 'home-today-hero__img recipe-display-image',
      planner: 'planner-meal__img recipe-display-image',
    };
    const imgClass = classMap[variant] || 'recipe-display-image';
    const img = `<img class="${imgClass}" src="${escSrc}" alt="${altText}"${lazyAttr} onerror="this.onerror=null;RecipeImageService.handleImgError(this)">`;

    if (variant === 'card' && zoomable) {
      return `<button type="button" class="recipe-card__image-btn" data-zoom-src="${escSrc}" aria-label="${altText} 사진 크게 보기">${img}</button>`;
    }
    if (variant === 'feed' && zoomable) {
      return `<button type="button" class="recipe-card__image-btn recipe-card__image-btn--feed" data-zoom-src="${escSrc}" aria-label="${altText} 사진 크게 보기">${img}</button>`;
    }
    if (variant === 'hero' && zoomable) {
      return `<button type="button" class="recipe-detail__hero-btn" data-zoom-src="${escSrc}" aria-label="${altText} 사진 크게 보기">${img}</button>`;
    }
    return img;
  },
};

/** @deprecated */
window.RecipeThumbnailService = {
  getDataUri(name, dishType) {
    return RecipeImageService.resolveSrc({ name, dishType }) || '';
  },
};
