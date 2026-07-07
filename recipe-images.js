/**
 * 레시피 카드 공통 이미지 선택·렌더링
 * 우선순위: imageUrl → image/thumbnailUrl → category → name 키워드 → default
 */
window.RECIPE_IMAGE_MAP = {};

const RECIPE_IMAGE_ASSET_BASE = 'src/assets/recipe-images/';

const RECIPE_DISH_TYPE_ASSETS = {
  stew: 'stew.png',
  soup: 'soup.png',
  'fried-rice': 'rice.png',
  'rice-bowl': 'rice.png',
  noodle: 'noodle.png',
  pasta: 'pasta.png',
  'stir-fry': 'stir-fry.png',
  salad: 'default.png',
  toast: 'default.png',
  pancake: 'stir-fry.png',
  snack: 'default.png',
  sandwich: 'default.png',
  dessert: 'default.png',
  drink: 'default.png',
  default: 'default.png',
};

const RECIPE_CATEGORY_ASSETS = {
  western: 'pasta.png',
  italian: 'pasta.png',
  chinese: 'noodle.png',
  japanese: 'rice.png',
};

const RECIPE_KEYWORD_ASSETS = [
  [/토마토.*계란|계란.*토마토/, 'tomato-egg.png'],
  [/감자/, 'potato.png'],
  [/파스타|스파게티|알리오|봉골레|페투치네|크림파스/, 'pasta.png'],
  [/김치찌개|된장찌개|순두부|찌개|찜|조림|전골|육개장|김치/, 'stew.png'],
  [/볶음밥|덮밥|주먹밥|오므라이스|규동|김밥|밥$/, 'rice.png'],
  [/계란|달걀|오믈렛|스크램블|계란볶/, 'egg.png'],
  [/라면|우동|짬뽕|짜장|국수|쫄면|냉면|수제비|라볶이/, 'noodle.png'],
  [/국$|미역국|된장국|탕$|스프|콩나물국|어묵국/, 'soup.png'],
  [/볶음|무침/, 'stir-fry.png'],
];

function inferRecipeDishType(name) {
  if (typeof DishTypeService !== 'undefined') return DishTypeService.infer(name);
  const rules = [
    ['fried-rice', /볶음밥/],
    ['rice-bowl', /덮밥|주먹밥|오므라이스|김밥/],
    ['noodle', /라면|우동|국수|파스타|스파게티|쫄면|냉면/],
    ['stew', /찌개|찜|조림|전골/],
    ['soup', /국$|탕$|스프/],
    ['stir-fry', /볶음|무침|스크램블/],
  ];
  for (const [type, pattern] of rules) {
    if (pattern.test(name || '')) return type;
  }
  return 'default';
}

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
  if (trimmed.startsWith('src/assets/') || trimmed.startsWith('images/')) return trimmed;
  return `images/recipes/${trimmed}`;
}

function resolveRecipeAssetFile(recipe) {
  const name = recipe?.name || recipe?.title || '';
  const category = recipe?.category;

  if (category && RECIPE_CATEGORY_ASSETS[category]) {
    return RECIPE_CATEGORY_ASSETS[category];
  }
  for (const [pattern, file] of RECIPE_KEYWORD_ASSETS) {
    if (pattern.test(name)) return file;
  }
  const dishType = recipe?.dishType || inferRecipeDishType(name);
  if (dishType && RECIPE_DISH_TYPE_ASSETS[dishType] && dishType !== 'default') {
    return RECIPE_DISH_TYPE_ASSETS[dishType];
  }
  return 'default.png';
}

function recipeAssetUrl(file) {
  return `${RECIPE_IMAGE_ASSET_BASE}${file}`;
}

window.RecipeImageService = {
  assetBase: RECIPE_IMAGE_ASSET_BASE,

  isValidPhoto(url) {
    if (!url || typeof url !== 'string') return false;
    if (typeof DEFAULT_IMAGE !== 'undefined' && url === DEFAULT_IMAGE) return false;
    if (isUnsplashUrl(url)) return false;
    return true;
  },

  pickPhoto(recipe) {
    if (!recipe) return null;
    const candidates = [recipe.imageUrl, recipe.image, recipe.thumbnailUrl];
    for (const raw of candidates) {
      const normalized = normalizeRecipePhotoUrl(raw);
      if (normalized && this.isValidPhoto(normalized)) return normalized;
    }
    return null;
  },

  resolveAssetFile(recipe) {
    const map = typeof RECIPE_IMAGE_MAP !== 'undefined' ? RECIPE_IMAGE_MAP : {};
    const name = recipe?.name || recipe?.title || '';
    if (name && map[name]) return map[name].replace(RECIPE_IMAGE_ASSET_BASE, '');
    return resolveRecipeAssetFile(recipe);
  },

  resolveCategoryAssetSrc(recipe) {
    return recipeAssetUrl(this.resolveAssetFile(recipe));
  },

  resolveDefaultAssetSrc() {
    return recipeAssetUrl('default.png');
  },

  /** 표시용 최종 src (1~4순위) */
  resolveSrc(recipe) {
    const photo = this.pickPhoto(recipe);
    if (photo) return photo;
    return this.resolveCategoryAssetSrc(recipe);
  },

  /** 시드/저장용 — 사진 없으면 카테고리 에셋 경로 */
  resolveForStorage(recipe) {
    const photo = this.pickPhoto(recipe);
    if (photo && !photo.startsWith(RECIPE_IMAGE_ASSET_BASE)) return photo;
    return this.resolveCategoryAssetSrc(recipe);
  },

  handleImgError(img) {
    if (!img) return;
    const step = img.dataset.fallbackStep || '0';
    const category = img.dataset.fallbackCategory;
    const fallback = img.dataset.fallbackDefault;
    if (step === '0' && category && img.src !== category) {
      img.dataset.fallbackStep = '1';
      img.src = category;
      return;
    }
    if (step !== '2' && fallback && img.src !== fallback) {
      img.dataset.fallbackStep = '2';
      img.src = fallback;
    }
  },

  /**
   * @param {object} recipe
   * @param {{ variant?: 'card'|'hero'|'thumb'|'home-hero', zoomable?: boolean, alt?: string, lazy?: boolean }} options
   */
  renderImg(recipe, options = {}) {
    const {
      variant = 'thumb',
      zoomable = false,
      alt = '',
      lazy = true,
    } = options;

    const name = recipe?.name || recipe?.title || '요리';
    const src = this.resolveSrc(recipe);
    const categorySrc = this.resolveCategoryAssetSrc(recipe);
    const defaultSrc = this.resolveDefaultAssetSrc();
    const altText = typeof esc === 'function' ? esc(alt || name) : String(alt || name).replace(/"/g, '&quot;');
    const escSrc = typeof esc === 'function' ? esc(src) : src;
    const lazyAttr = lazy ? ' loading="lazy"' : '';
    const dataAttrs = `data-fallback-category="${typeof esc === 'function' ? esc(categorySrc) : categorySrc}" data-fallback-default="${typeof esc === 'function' ? esc(defaultSrc) : defaultSrc}"`;

    const classMap = {
      card: 'recipe-card__image recipe-display-image',
      hero: 'recipe-display-image',
      thumb: 'home-recipe-row__thumb recipe-display-image',
      'home-hero': 'home-today-hero__img recipe-display-image',
    };
    const imgClass = classMap[variant] || 'recipe-display-image';
    const img = `<img class="${imgClass}" src="${escSrc}" alt="${altText}"${lazyAttr} onerror="RecipeImageService.handleImgError(this)" ${dataAttrs}>`;

    if (variant === 'card' && zoomable) {
      return `<button type="button" class="recipe-card__image-btn" data-zoom-src="${escSrc}" aria-label="${altText} 사진 크게 보기">${img}</button>`;
    }
    if (variant === 'hero' && zoomable) {
      return `<button type="button" class="recipe-detail__hero-btn" data-zoom-src="${escSrc}" aria-label="${altText} 사진 크게 보기">${img}</button>`;
    }
    return img;
  },
};

/** @deprecated RecipeImageService.resolveSrc 사용 */
window.RecipeThumbnailService = {
  getDataUri(name, dishType) {
    return RecipeImageService.resolveCategoryAssetSrc({ name, dishType });
  },
};
