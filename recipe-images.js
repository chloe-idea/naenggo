/**
 * 레시피 대표 이미지 — /public/images/recipes (URL: /images/recipes)
 * 파일명: {slug}.webp | {id}.webp → 없으면 default-recipe.webp
 */
window.RECIPE_IMAGE_MAP = {};

const RECIPE_IMAGES_BASE = 'images/recipes/';
const DEFAULT_RECIPE_IMAGE = `${RECIPE_IMAGES_BASE}default-recipe.webp`;
const RECIPE_IMAGE_VERSION = '2';
const RECIPE_IMAGE_EXTENSIONS = ['webp', 'jpg', 'jpeg', 'png'];

function withRecipeImageVersion(url) {
  if (!url || typeof url !== 'string') return url;
  if (url.startsWith('data:') || url.startsWith('http://') || url.startsWith('https://')) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}v=${RECIPE_IMAGE_VERSION}`;
}

/** 레시피명 → slug (이미지 파일명). scripts/recipe-collage-tiles.json 과 동기화 */
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

function normalizeRecipePhotoUrl(url) {
  if (!url || typeof url !== 'string') return null;
  const trimmed = url.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith('data:') || trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
    return trimmed;
  }
  if (trimmed.startsWith(RECIPE_IMAGES_BASE)) return withRecipeImageVersion(trimmed);
  if (trimmed.startsWith('public/images/recipes/')) {
    return trimmed.replace(/^public\//, '');
  }
  if (trimmed.startsWith('images/recipes/')) return trimmed;
  if (trimmed.startsWith('src/assets/')) return trimmed;
  if (trimmed.startsWith('/')) return trimmed.replace(/^\//, '');
  return `${RECIPE_IMAGES_BASE}${trimmed}`;
}

function inferRecipeSlug(recipe) {
  const name = recipe?.name || recipe?.title || '';
  if (recipe?.slug) {
    const slug = String(recipe.slug).trim();
    if (slug && !slug.startsWith('builtin-')) return slug;
  }
  if (recipe?.imageSlug) return String(recipe.imageSlug).trim();
  if (name && RECIPE_NAME_SLUGS[name]) return RECIPE_NAME_SLUGS[name];
  const id = recipe?.id ? String(recipe.id).trim() : '';
  if (id && !id.startsWith('builtin-')) return id;
  return '';
}

function getBundledImageSrc(recipe) {
  const slug = inferRecipeSlug(recipe);
  if (!slug) return null;
  return withRecipeImageVersion(`${RECIPE_IMAGES_BASE}${slug}.webp`);
}

function buildRecipeImageCandidates(recipe) {
  const slugs = [];
  const slug = inferRecipeSlug(recipe);
  if (slug) slugs.push(slug);
  if (recipe?.id && !slugs.includes(recipe.id)) slugs.push(recipe.id);
  if (recipe?.source === 'builtin' && recipe?.id?.startsWith('builtin-')) {
    const numericId = recipe.id.replace(/^builtin-/, '');
    if (numericId && !slugs.includes(numericId)) slugs.push(numericId);
  }

  const paths = [];
  slugs.forEach((key) => {
    RECIPE_IMAGE_EXTENSIONS.forEach((ext) => {
      paths.push(withRecipeImageVersion(`${RECIPE_IMAGES_BASE}${key}.${ext}`));
    });
  });
  paths.push(withRecipeImageVersion(DEFAULT_RECIPE_IMAGE));
  paths.push(withRecipeImageVersion(`${RECIPE_IMAGES_BASE}default-recipe.png`));
  return [...new Set(paths)];
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

window.RecipeImageService = {
  basePath: RECIPE_IMAGES_BASE,
  defaultSrc: DEFAULT_RECIPE_IMAGE,

  inferSlug: inferRecipeSlug,

  isValidPhoto(url) {
    if (!url || typeof url !== 'string') return false;
    if (typeof DEFAULT_IMAGE !== 'undefined' && url === DEFAULT_IMAGE) return false;
    if (isUnsplashUrl(url)) return false;
    return true;
  },

  isUserUploadedPhoto(url) {
    if (!this.isValidPhoto(url)) return false;
    const normalized = normalizeRecipePhotoUrl(url);
    if (!normalized) return false;
    if (normalized.startsWith('data:')) return true;
    if (normalized.startsWith('http://') || normalized.startsWith('https://')) return true;
    if (normalized.startsWith(RECIPE_IMAGES_BASE)) return false;
    if (normalized.startsWith(LEGACY_ASSET_BASE)) return false;
    return true;
  },

  pickPhoto(recipe) {
    if (!recipe) return null;
    const candidates = [recipe.imageUrl, recipe.image, recipe.thumbnailUrl];
    for (const raw of candidates) {
      const normalized = normalizeRecipePhotoUrl(raw);
      if (!normalized || !this.isValidPhoto(normalized)) continue;
      if (this.isUserUploadedPhoto(normalized)) return normalized;
      if (normalized.startsWith(RECIPE_IMAGES_BASE) && normalized !== DEFAULT_RECIPE_IMAGE) {
        return normalized;
      }
    }
    return getBundledImageSrc(recipe);
  },

  getCandidatePaths(recipe) {
    return buildRecipeImageCandidates(recipe);
  },

  resolveSrc(recipe) {
    const userPhoto = this.pickPhoto(recipe);
    if (userPhoto) return userPhoto;
    return getBundledImageSrc(recipe) || DEFAULT_RECIPE_IMAGE;
  },

  resolveForStorage(recipe) {
    const userPhoto = this.pickPhoto(recipe);
    if (userPhoto && this.isUserUploadedPhoto(userPhoto)) return userPhoto;
    return getBundledImageSrc(recipe) || DEFAULT_RECIPE_IMAGE;
  },

  handleImgError(img) {
    if (!img) return;
    let candidates = [];
    try {
      candidates = JSON.parse(img.dataset.fallbackCandidates || '[]');
    } catch {
      candidates = [];
    }
    const index = Number(img.dataset.fallbackIndex || '0');
    const next = candidates[index];
    if (next && img.src !== next) {
      img.dataset.fallbackIndex = String(index + 1);
      img.src = next;
      return;
    }
    const legacy = img.dataset.fallbackLegacy;
    if (legacy && img.src !== legacy) {
      img.dataset.fallbackLegacy = '';
      img.src = legacy;
      return;
    }
    if (img.src !== DEFAULT_RECIPE_IMAGE) {
      img.src = DEFAULT_RECIPE_IMAGE;
    }
  },

  renderImg(recipe, options = {}) {
    const {
      variant = 'thumb',
      zoomable = false,
      alt = '',
      lazy = true,
    } = options;

    const name = recipe?.name || recipe?.title || '요리';
    const candidates = buildRecipeImageCandidates(recipe);
    const userPhoto = this.pickPhoto(recipe);
    const src = userPhoto || candidates[0] || DEFAULT_RECIPE_IMAGE;
    const legacyFallback = resolveLegacyCategoryAsset(recipe);
    const altText = typeof esc === 'function' ? esc(alt || name) : String(alt || name).replace(/"/g, '&quot;');
    const escSrc = typeof esc === 'function' ? esc(src) : src;
    const lazyAttr = lazy ? ' loading="lazy"' : '';
    const fallbackCandidates = userPhoto
      ? [DEFAULT_RECIPE_IMAGE, `${RECIPE_IMAGES_BASE}default-recipe.png`]
      : candidates.slice(1);
    const dataAttrs = [
      `data-fallback-candidates="${typeof esc === 'function' ? esc(JSON.stringify(fallbackCandidates)) : JSON.stringify(fallbackCandidates)}"`,
      `data-fallback-index="0"`,
      `data-fallback-legacy="${typeof esc === 'function' ? esc(legacyFallback) : legacyFallback}"`,
    ].join(' ');

    const classMap = {
      card: 'recipe-card__image recipe-display-image',
      feed: 'recipe-card__image recipe-card__image--feed recipe-display-image',
      hero: 'recipe-detail__hero-img',
      thumb: 'home-recipe-row__thumb recipe-display-image',
      'home-hero': 'home-today-hero__img recipe-display-image',
      planner: 'planner-meal__img recipe-display-image',
    };
    const imgClass = classMap[variant] || 'recipe-display-image';
    const img = `<img class="${imgClass}" src="${escSrc}" alt="${altText}"${lazyAttr} onerror="RecipeImageService.handleImgError(this)" ${dataAttrs}>`;

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
    return RecipeImageService.resolveSrc({ name, dishType });
  },
};
