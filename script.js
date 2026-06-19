/**
 * 냉장GO v2 — 커뮤니티 확장 가능 구조
 *
 * 데이터 계층 (향후 Supabase/Firebase 교체 지점):
 *   StorageAdapter → PantryRepository / RecipeRepository / SavedRecipeRepository
 *
 * Recipe 스키마:
 *   id, name, ingredients[], steps[], cookTime, difficulty, category, cuisine, tags[], dietTags[],
 *   image, calories, memo, authorId, authorName, visibility('public'|'private'), source('builtin'|'user'),
 *   parentRecipeId, createdFrom, dishType,
 *   createdAt, updatedAt
 */

// ===== 설정 =====
const CONFIG = {
  LOCAL_USER_ID: 'local-user',
  LOCAL_USER_NAME: '나',
  EXPIRY_SOON_DAYS: 3,
  STORAGE: {
    PANTRY: 'naengjanggo_v2_pantry',
    RECIPES: 'naengjanggo_v2_recipes',
    SAVED: 'naengjanggo_v2_saved',
    SAVE_COUNTS: 'naengjanggo_v2_save_counts',
    SAVE_COUNTS_USER_SYNC: 'naengjanggo_v2_save_counts_user_sync',
    MEALS: 'naengjanggo_v2_meals',
    SHOPPING: 'naengjanggo_v2_shopping',
    CURRENCY: 'naengjanggo_v2_currency',
    // v1 마이그레이션
    LEGACY_PANTRY: 'naengjanggo_pantry_ingredients',
    LEGACY_RECIPES: 'naengjanggo_user_recipes',
  },
};

const CURRENCY_OPTIONS = {
  AUD: { symbol: 'A$', fractionDigits: 2 },
  KRW: { symbol: '₩', fractionDigits: 0 },
  USD: { symbol: '$', fractionDigits: 2 },
  EUR: { symbol: '€', fractionDigits: 2 },
  JPY: { symbol: '¥', fractionDigits: 0 },
  GBP: { symbol: '£', fractionDigits: 2 },
};

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
  community: '공개 레시피를 둘러보세요',
  pantry: '보유 재료를 상세 관리하세요',
  calendar: '해먹은 음식을 기록하고 확인하세요',
};

const MEAL_TYPES = [
  { id: 'home-cook', label: '직접 요리', emoji: '🍳' },
  { id: 'eat-out', label: '외식', emoji: '🍽️' },
  { id: 'delivery', label: '배달', emoji: '🛵' },
  { id: 'snack', label: '간식', emoji: '🍪' },
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

function normalizeIngredient(s) {
  return s.trim().toLowerCase().replace(/\s/g, '');
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
    const requiredNorm = normalizeIngredient(recipeIngredient);
    for (const owned of pantryNames) {
      if (normalizeIngredient(owned) === requiredNorm) continue;
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
const StorageAdapter = {
  get(key, fallback = null) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (err) {
      return fallback;
    }
  },
  set(key, value) {
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
  load() {
    this._items = StorageAdapter.get(CONFIG.STORAGE.PANTRY, []);
    if (this._items.length === 0) this._migrateLegacy();
    return this._items;
  },
  save() { StorageAdapter.set(CONFIG.STORAGE.PANTRY, this._items); },
  getAll() { return this._items; },
  add(item) { this._items.push(item); this.save(); },
  update(id, data) {
    const i = this._items.findIndex((x) => x.id === id);
    if (i === -1) return null;
    this._items[i] = { ...this._items[i], ...data, updatedAt: new Date().toISOString() };
    this.save();
    return this._items[i];
  },
  remove(id) {
    this._items = this._items.filter((x) => x.id !== id);
    this.save();
  },
  _migrateLegacy() {
    const legacy = StorageAdapter.get(CONFIG.STORAGE.LEGACY_PANTRY, []);
    if (!legacy.length) return;
    this._items = legacy.map((raw) => this._normalize(raw));
    this.save();
  },
  _normalize(raw) {
    if (typeof raw === 'string') {
      return { id: StorageAdapter.createId('pantry'), name: raw, quantity: '', unit: '', expiryDate: '',
        userId: CONFIG.LOCAL_USER_ID, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    }
    return { id: raw.id || StorageAdapter.createId('pantry'), name: raw.name || '', quantity: raw.quantity || '',
      unit: raw.unit || '', expiryDate: raw.expiryDate || '', userId: CONFIG.LOCAL_USER_ID,
      createdAt: raw.createdAt || new Date().toISOString(), updatedAt: new Date().toISOString() };
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
    this._userRecipes = StorageAdapter.get(CONFIG.STORAGE.RECIPES, []);
    if (this._userRecipes.length === 0) this._migrateLegacy();
    return this._userRecipes;
  },
  save() { StorageAdapter.set(CONFIG.STORAGE.RECIPES, this._userRecipes); },
  getUserRecipes() { return this._userRecipes; },
  getById(id) {
    return BUILTIN_RECIPES.find((r) => r.id === id) || this._userRecipes.find((r) => r.id === id);
  },
  getPublicRecipes() {
    return [...BUILTIN_RECIPES, ...this._userRecipes.filter((r) => r.visibility === 'public')];
  },
  getRecommendableRecipes() {
    return [...BUILTIN_RECIPES, ...this._userRecipes];
  },
  forkFrom(source) {
    if (!source) return null;
    const image = hasPhoto(source.image) ? source.image : '';
    return this.create({
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
      name: data.name, ingredients: data.ingredients, steps: data.steps,
      cookTime: Number(data.cookTime), difficulty: data.difficulty, category: data.category,
      dishType: data.dishType || DishTypeService.infer(data.name),
      cuisine: cat.cuisine, tags: [...cat.tags], dietTags: [...cat.dietTags],
      image: data.image || DEFAULT_IMAGE, calories: data.calories ?? null, memo: data.memo || '',
      parentRecipeId: data.parentRecipeId || null,
      createdFrom: data.createdFrom || null,
      authorId: CONFIG.LOCAL_USER_ID, authorName: CONFIG.LOCAL_USER_NAME,
      visibility: data.visibility || 'private', source: 'user', createdAt: now, updatedAt: now,
    };
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
      dishType: data.dishType || DishTypeService.infer(data.name || this._userRecipes[i].name),
      parentRecipeId: data.parentRecipeId !== undefined ? data.parentRecipeId : this._userRecipes[i].parentRecipeId,
      createdFrom: data.createdFrom !== undefined ? data.createdFrom : this._userRecipes[i].createdFrom,
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
  isOwned(recipe) { return recipe.source === 'user' && recipe.authorId === CONFIG.LOCAL_USER_ID; },
  _migrateLegacy() {
    const legacy = StorageAdapter.get(CONFIG.STORAGE.LEGACY_RECIPES, []);
    if (!legacy.length) return;
    const now = new Date().toISOString();
    this._userRecipes = legacy.map((raw) => {
      const cat = CATEGORY_MAP[raw.category] || CATEGORY_MAP.korean;
      return {
        id: raw.id || StorageAdapter.createId('recipe'), name: raw.name, ingredients: raw.ingredients,
        steps: raw.steps, cookTime: Number(raw.cookTime), difficulty: raw.difficulty, category: raw.category,
        cuisine: cat.cuisine, tags: [...cat.tags, '내 레시피'], dietTags: cat.dietTags,
        image: raw.image || DEFAULT_IMAGE, calories: null, memo: raw.memo || '',
        authorId: CONFIG.LOCAL_USER_ID, authorName: CONFIG.LOCAL_USER_NAME,
        visibility: 'private', source: 'user', createdAt: now, updatedAt: now,
      };
    });
    this.save();
  },
};

function builtinSaveSeed(index) {
  return 40 + (index * 23) % 460;
}

const SavedRecipeRepository = {
  _ids: [],
  load() { this._ids = StorageAdapter.get(CONFIG.STORAGE.SAVED, []); return this._ids; },
  save() { StorageAdapter.set(CONFIG.STORAGE.SAVED, this._ids); },
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
    this._logs = StorageAdapter.get(CONFIG.STORAGE.MEALS, []).map((log) => ({
      ...log,
      mealType: normalizeMealType(log.mealType),
      cost: Number(log.cost) || 0,
    }));
    return this._logs;
  },
  save() { StorageAdapter.set(CONFIG.STORAGE.MEALS, this._logs); },
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
    const next = { ...this._logs[i], ...data, updatedAt: new Date().toISOString() };
    if (data.mealType != null) next.mealType = normalizeMealType(data.mealType);
    next.cost = next.mealType === 'home-cook' ? 0 : Number(next.cost) || 0;
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
    this._records = StorageAdapter.get(CONFIG.STORAGE.SHOPPING, []).map((record) => ({
      ...record,
      amount: Number(record.amount) || 0,
      store: record.store || '',
    }));
    return this._records;
  },
  save() { StorageAdapter.set(CONFIG.STORAGE.SHOPPING, this._records); },
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
    this._records[i] = {
      ...this._records[i],
      ...data,
      amount: Number(data.amount) || 0,
      updatedAt: new Date().toISOString(),
    };
    this.save();
    return this._records[i];
  },
  remove(id) {
    this._records = this._records.filter((r) => r.id !== id);
    this.save();
  },
};

// ===== Domain Services =====
const MatchService = {
  normalize: normalizeIngredient,
  analyze(pantryNames, recipeIngredients) {
    const pantryNormSet = new Set(pantryNames.map(this.normalize));
    const exact = [];
    const substituted = [];
    const missing = [];
    const matched = [];
    const matchedPantryNames = [];
    let scoreSum = 0;

    for (const ing of recipeIngredients) {
      const ingNorm = this.normalize(ing);
      if (pantryNormSet.has(ingNorm)) {
        const owned = pantryNames.find((p) => this.normalize(p) === ingNorm) || ing;
        exact.push({ required: ing, owned, score: 1 });
        matched.push(ing);
        matchedPantryNames.push(owned);
        scoreSum += 1;
        continue;
      }
      const sub = IngredientGroupService.findSubstitute(ing, pantryNames);
      if (sub) {
        substituted.push(sub);
        matched.push(ing);
        matchedPantryNames.push(sub.owned);
        scoreSum += sub.substituteScore;
        continue;
      }
      missing.push(ing);
    }

    const matchPercent = recipeIngredients.length
      ? Math.round((scoreSum / recipeIngredients.length) * 100)
      : 0;

    return { exact, substituted, missing, matched, matchedPantryNames, matchPercent };
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
        missing.map((m) => `<li class="ingredient-list__item ingredient-list__item--missing">✗ ${esc(m)}</li>`).join('')
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
  getPantryNames() { return PantryRepository.getAll().map((i) => i.name); },
  getExpiryBoost(matched) {
    let boost = 0;
    for (const name of matched) {
      const item = PantryRepository.getAll().find((p) => MatchService.normalize(p.name) === MatchService.normalize(name));
      if (!item?.expiryDate) continue;
      const days = ExpiryService.daysUntil(item.expiryDate);
      if (days !== null && days <= CONFIG.EXPIRY_SOON_DAYS && days >= 0) boost += 10;
    }
    return boost;
  },
  isHighProtein(recipe) {
    const text = `${recipe.name} ${(recipe.tags || []).join(' ')} ${(recipe.ingredients || []).join(' ')}`;
    return recipe.dietTags?.includes('high-protein') || /고단백|계란|달걀|참치|두부|닭가슴살|닭고기|소고기|돼지고기|연어/.test(text);
  },
  isDiet(recipe) {
    const text = `${recipe.name} ${(recipe.tags || []).join(' ')} ${(recipe.ingredients || []).join(' ')}`;
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
  view: 'main', filters: new Set(), menuSearch: '', communitySearch: '', editingRecipeId: null, editingPantryId: null,
  editingMealId: null, editingShoppingId: null, formImage: null, mealFormImage: null, isComposing: false, detailRecipeId: null,
  calendarYear: new Date().getFullYear(), calendarMonth: new Date().getMonth(),
  selectedCalendarDate: null, selectedMealType: 'home-cook', mealPhotoRemoved: false,
  currency: CURRENCY_OPTIONS[StorageAdapter.get(CONFIG.STORAGE.CURRENCY, 'AUD')] ? StorageAdapter.get(CONFIG.STORAGE.CURRENCY, 'AUD') : 'AUD',
};

const $ = (s) => document.querySelector(s);
const dom = {
  headerSubtitle: $('#header-subtitle'),
  toast: $('#toast'),
  views: {
    main: $('#view-main'), 'my-recipes': $('#view-my-recipes'), community: $('#view-community'),
    pantry: $('#view-pantry'), calendar: $('#view-calendar'),
  },
  tabItems: document.querySelectorAll('.tab-bar__item'),
  openPantryManageBtn: $('#open-pantry-manage-btn'),
  quickForm: $('#quick-ingredient-form'), quickInput: $('#quick-ingredient-input'),
  pantryChips: $('#pantry-chips'),
  filterChips: $('#filter-chips'), menuSearchInput: $('#menu-search-input'),
  recipeList: $('#recipe-list'), resultsCount: $('#results-count'),
  emptyState: $('#empty-state'), noResults: $('#no-results'),
  myRecipesList: $('#my-recipes-list'), myRecipesCount: $('#my-recipes-count'), myRecipesEmpty: $('#my-recipes-empty'),
  savedList: $('#saved-recipes-list'), savedCount: $('#saved-recipes-count'), savedEmpty: $('#saved-recipes-empty'),
  communityList: $('#community-list'), communityEmpty: $('#community-empty'),
  communitySearchInput: $('#community-search-input'), communityEmptyTitle: $('#community-empty-title'),
  communityEmptyText: $('#community-empty-text'),
  pantryList: $('#pantry-list'), pantryCount: $('#pantry-manage-count'), pantryEmpty: $('#pantry-empty'),
  openPantryAdd: $('#open-pantry-add-btn'), openRecipeForm: $('#open-recipe-form-btn'),
  mealStats: $('#meal-stats'), currencySelect: $('#currency-select'), calendarLabel: $('#calendar-label'),
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
  pantryModal: $('#pantry-modal'), pantryModalForm: $('#pantry-modal-form'),
  pantryModalTitle: $('#pantry-modal-title'), pantryModalName: $('#pantry-modal-name'),
  pantryModalQty: $('#pantry-modal-quantity'), pantryModalUnit: $('#pantry-modal-unit'),
  pantryModalExpiry: $('#pantry-modal-expiry'),
  recipeModal: $('#recipe-modal'), modalContent: $('#modal-content'),
  recipeFormModal: $('#recipe-form-modal'), recipeForm: $('#recipe-form'),
  formModalTitle: $('#form-modal-title'), formError: $('#form-error'),
  formName: $('#recipe-name'), formIngredients: $('#recipe-ingredients'),
  formCookTime: $('#recipe-cook-time'), formDifficulty: $('#recipe-difficulty'),
  formSteps: $('#recipe-steps'), formCategory: $('#recipe-category'), formMemo: $('#recipe-memo'),
  formVisibilityPrivate: $('#recipe-visibility-private'), formVisibilityPublic: $('#recipe-visibility-public'),
  photoPreview: $('#photo-preview'), formPhoto: $('#recipe-photo'),
  photoSelectBtn: $('#photo-select-btn'), photoRemoveBtn: $('#photo-remove-btn'),
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
function parseList(t) { return t.split(/[\n,，、]/).map((s) => s.replace(/^\d+[\.\)]\s*/, '').trim()).filter(Boolean); }
function hasPhoto(img) { return img && img !== DEFAULT_IMAGE && !String(img).includes('images.unsplash.com'); }
function formatMoney(value) {
  const amount = Number(value) || 0;
  const currency = CURRENCY_OPTIONS[state.currency] || CURRENCY_OPTIONS.AUD;
  return `${currency.symbol}${amount.toLocaleString(undefined, {
    minimumFractionDigits: 0,
    maximumFractionDigits: currency.fractionDigits,
  })}`;
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
    return `<img class="recipe-card__image" src="${recipe.image}" alt="${esc(recipe.name)}" loading="lazy">`;
  }
  return recipePlaceholderHTML(recipe, 'card');
}

function recipeHeroHTML(recipe) {
  if (hasPhoto(recipe.image)) {
    return `<img src="${recipe.image}" alt="${esc(recipe.name)}">`;
  }
  return recipePlaceholderHTML(recipe, 'hero');
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
function navigate(view) {
  state.view = view;
  Object.entries(dom.views).forEach(([k, el]) => { el.hidden = k !== view; });
  dom.tabItems.forEach((tab) => tab.classList.toggle('tab-bar__item--active', tab.dataset.view === view));
  dom.headerSubtitle.textContent = VIEW_TITLES[view] || VIEW_TITLES.main;
  closeAllModals();
  renderCurrentView();
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function renderCurrentView() {
  renderPantryChips();
  switch (state.view) {
    case 'main': renderHome(); break;
    case 'my-recipes': renderMyRecipes(); break;
    case 'community': renderCommunity(); break;
    case 'pantry': renderPantryManage(); break;
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
  const items = PantryRepository.getAll();
  dom.pantryChips.innerHTML = items.map((item) => `
    <span class="tag" role="listitem">${esc(item.name)}${pantryChipBadge(item)}
      <button type="button" class="tag__remove" data-rm="${esc(item.id)}" aria-label="삭제">&times;</button>
    </span>`).join('');
  dom.pantryChips.querySelectorAll('[data-rm]').forEach((btn) => {
    btn.onclick = () => { PantryRepository.remove(btn.dataset.rm); refreshAll(); };
  });
}

function canForkRecipe(recipe) {
  return Boolean(recipe);
}

function forkRecipeFrom(sourceId) {
  const source = RecipeRepository.getById(sourceId);
  if (!source) return;
  const forked = RecipeRepository.forkFrom(source);
  if (!forked) return;
  closeModal('recipe');
  navigate('my-recipes');
  openRecipeForm(forked.id);
  showToast(`"${source.name}"을(를) 내 레시피로 복사했어요`);
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
function recipeCardHTML({ recipe, matchPercent, missing, matched, matchedPantryNames, exact, substituted, recommendationReason, showAuthor, showVisibility, showCardSave, showCardMealLog, showCardFork, showSaveCount }) {
  const badge = matchPercent != null ? (matchPercent >= 70 ? 'high' : matchPercent >= 40 ? 'mid' : 'low') : null;
  const img = recipeCardImageHTML(recipe);
  const soon = matchedPantryNames?.length && RecommendationService.getExpiryBoost(matchedPantryNames) > 0;
  const saved = SavedRecipeRepository.isSaved(recipe.id);
  const saveCount = showSaveCount ? RecipeSaveCountRepository.getCount(recipe.id) : 0;
  let headerAction = '';
  if (showCardSave) {
    headerAction = `<button type="button" class="recipe-card__action-btn${saved ? ' recipe-card__action-btn--saved' : ''}" data-save-id="${esc(recipe.id)}" aria-label="레시피 저장">${saved ? '⭐ 저장됨' : '☆ 저장'}</button>`;
  } else if (showCardMealLog) {
    headerAction = `<button type="button" class="recipe-card__action-btn" data-log-meal-id="${esc(recipe.id)}" aria-label="식사 기록">🍳 기록</button>`;
  }
  const forkBtn = showCardFork && canForkRecipe(recipe)
    ? `<button type="button" class="recipe-card__action-btn" data-fork-id="${esc(recipe.id)}" aria-label="내 버전 만들기">✏️ 내 버전</button>`
    : '';
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
        ${recipeOriginHTML(recipe, { compact: true })}
        <div class="recipe-card__meta">
          <span>⏱ ${recipe.cookTime}분</span>
          <span>📊 ${recipe.difficulty}</span>
          ${showAuthor ? `<span>👤 ${esc(recipe.authorName)}</span>` : ''}
          ${showVisibility ? `<span>${recipe.visibility === 'public' ? '🌐 공개' : '🔒 비공개'}</span>` : ''}
          ${showSaveCount ? `<span class="recipe-card__save-count">⭐ ${saveCount}명 저장</span>` : ''}
        </div>
        ${recommendationReason ? `<p class="recipe-card__reason">${esc(recommendationReason)}</p>` : ''}
        ${matchPercent != null ? `<p class="recipe-card__missing">${esc(MatchService.formatCardSummary({ exact: exact || [], substituted: substituted || [], missing: missing || [] }))}</p>` : ''}
        ${soon ? `<p class="recipe-card__expiry-hint">유통기한 임박 재료 포함</p>` : ''}
      </div>
    </div>`;
}

function bindRecipeCards(container, results) {
  container.querySelectorAll('.recipe-card').forEach((card) => {
    const open = (e) => {
      if (e.target.closest('[data-log-meal-id], [data-save-id], [data-fork-id]')) return;
      const r = results.find((x) => idEq(x.recipe.id, card.dataset.rid));
      openRecipeDetail(r || { recipe: RecipeRepository.getById(card.dataset.rid) });
    };
    card.onclick = open;
    card.onkeydown = (e) => { if (e.key === 'Enter' && !e.target.closest('[data-log-meal-id], [data-save-id], [data-fork-id]')) open(e); };
  });
  container.querySelectorAll('[data-log-meal-id]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const recipe = RecipeRepository.getById(btn.dataset.logMealId);
      if (!recipe) return;
      openMealModal(null, { defaultDate: todayStr(), recipeId: recipe.id, mealType: 'home-cook', hideMealType: true });
    };
  });
  container.querySelectorAll('[data-save-id]').forEach((btn) => {
    btn.onclick = (e) => {
      e.stopPropagation();
      const nowSaved = SavedRecipeRepository.toggle(btn.dataset.saveId);
      showToast(nowSaved ? '레시피를 저장했어요 ⭐' : '저장을 해제했어요');
      renderCurrentView();
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
function renderFilters() {
  dom.filterChips.innerHTML = FILTERS.map((f) => `
    <button type="button" class="filter-chip${state.filters.has(f.id) ? ' filter-chip--active' : ''}" data-f="${f.id}">${f.label}</button>
  `).join('');
  dom.filterChips.querySelectorAll('.filter-chip').forEach((c) => {
    c.onclick = () => {
      if (state.filters.has(c.dataset.f)) state.filters.delete(c.dataset.f);
      else state.filters.add(c.dataset.f);
      renderFilters();
      renderHome();
    };
  });
}

function renderHome() {
  renderFilters();
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
}

// ===== Render: My Recipes =====
function renderMyRecipes() {
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
}

// ===== Render: Community =====
function matchesCommunitySearch(recipe, query) {
  const q = normalizeIngredient(query);
  if (!q) return true;
  const categoryLabel = CATEGORY_MAP[recipe.category]?.tags?.join(' ') || '';
  const haystack = [
    recipe.name,
    ...(recipe.ingredients || []),
    recipe.authorName,
    recipe.category,
    categoryLabel,
  ].filter(Boolean).map(normalizeIngredient).join(' ');
  return haystack.includes(q);
}

function renderCommunity() {
  const publicRecipes = RecipeRepository.getPublicRecipes();
  const names = RecommendationService.getPantryNames();
  const query = state.communitySearch.trim();
  const filteredRecipes = publicRecipes.filter((recipe) => matchesCommunitySearch(recipe, query));
  dom.communityEmpty.hidden = filteredRecipes.length > 0;
  dom.communityEmptyTitle.textContent = query ? '검색 결과가 없어요' : '공개 레시피가 없어요';
  dom.communityEmptyText.textContent = query
    ? '다른 메뉴명이나 재료명으로 검색해보세요.'
    : '내 레시피를 공개로 설정하면 커뮤니티에 표시됩니다';

  const results = filteredRecipes.map((recipe) => {
    const a = names.length ? MatchService.analyze(names, recipe.ingredients) : { matched: [], missing: recipe.ingredients, matchPercent: 0, exact: [], substituted: [], matchedPantryNames: [] };
    return { recipe, ...a };
  }).sort((a, b) => (b.matchPercent || 0) - (a.matchPercent || 0));

  dom.communityList.innerHTML = results.map((r) => recipeCardHTML({
    ...r, showAuthor: true, showCardSave: true, showSaveCount: true, showCardFork: true,
  })).join('');
  bindRecipeCards(dom.communityList, results);
}

// ===== Render: Pantry Manage =====
function renderPantryManage() {
  const items = [...PantryRepository.getAll()].sort((a, b) => {
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
      <div class="pantry-item pantry-item--${statusClass}" role="listitem">
        <div class="pantry-item__body">
          <p class="pantry-item__name">${esc(item.name)}</p>
          <p class="pantry-item__detail">${qty ? `수량: ${esc(qty)}` : '수량: -'}${item.expiryDate ? ` · ${esc(item.expiryDate)}` : ''}</p>
          ${lbl ? `<span class="pantry-item__badge pantry-item__badge--${st}">${st === 'expired' ? '만료' : '임박'} · ${esc(lbl)}</span>` : ''}
        </div>
        <div class="pantry-item__actions">
          <button type="button" class="btn btn--ghost btn--sm" data-edit="${esc(item.id)}">수정</button>
          <button type="button" class="btn btn--danger btn--sm" data-del="${esc(item.id)}">삭제</button>
        </div>
      </div>`;
  }).join('');
  dom.pantryList.querySelectorAll('[data-edit]').forEach((b) => { b.onclick = () => openPantryModal(b.dataset.edit); });
  dom.pantryList.querySelectorAll('[data-del]').forEach((b) => {
    b.onclick = () => {
      const item = PantryRepository.getAll().find((x) => x.id === b.dataset.del);
      if (confirm(`"${item?.name || '재료'}" 삭제할까요?`)) { PantryRepository.remove(b.dataset.del); refreshAll(); }
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
  const costs = { 'eat-out': 0, delivery: 0, snack: 0 };
  const foodCounts = {};

  monthLogs.forEach((log) => {
    const type = normalizeMealType(log.mealType);
    if (type in counts) counts[type] += 1;
    if (type in costs) costs[type] += Number(log.cost) || 0;
    foodCounts[log.name] = (foodCounts[log.name] || 0) + 1;
  });
  const shoppingTotal = shoppingRecords.reduce((sum, record) => sum + (Number(record.amount) || 0), 0);
  const totalFoodCost = shoppingTotal + costs['eat-out'] + costs.delivery + costs.snack;
  const topFood = Object.entries(foodCounts).sort((a, b) => b[1] - a[1])[0]?.[0] || '-';

  dom.mealStats.innerHTML = `
    <div class="meal-stat"><span class="meal-stat__label">🍳 직접 요리</span><span class="meal-stat__value">${counts['home-cook']}회</span></div>
    <div class="meal-stat"><span class="meal-stat__label">🍽️ 외식</span><span class="meal-stat__value">${counts['eat-out']}회<br>${formatMoney(costs['eat-out'])}</span></div>
    <div class="meal-stat"><span class="meal-stat__label">🛵 배달</span><span class="meal-stat__value">${counts.delivery}회<br>${formatMoney(costs.delivery)}</span></div>
    <div class="meal-stat"><span class="meal-stat__label">🍪 간식</span><span class="meal-stat__value">${counts.snack}회<br>${formatMoney(costs.snack)}</span></div>
    <div class="meal-stat"><span class="meal-stat__label">🛒 장보기</span><span class="meal-stat__value">${formatMoney(shoppingTotal)}</span></div>
    <div class="meal-stat"><span class="meal-stat__label">💰 이번 달 총 식비</span><span class="meal-stat__value">${formatMoney(totalFoodCost)}</span></div>
    <div class="meal-stat meal-stat--wide"><span class="meal-stat__label">🏆 가장 많이 먹은 음식</span><span class="meal-stat__value">${esc(topFood)}</span></div>`;
}

function formatCalendarMealLine(log) {
  const info = mealTypeInfo(log.mealType);
  const photoMark = log.photo ? ' 📷' : '';
  const cost = log.cost ? ` ${formatMoney(log.cost)}` : '';
  return `${info.emoji} ${log.name}${cost}${photoMark}`;
}

function formatCalendarShoppingLine(record) {
  return `🛒 ${formatMoney(record.amount)}`;
}

function renderCalendar() {
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
            <p class="meal-day-item__type">${esc(info.label)}${log.cost ? ` · ${esc(formatMoney(log.cost))}` : ''}</p>
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

  const shoppingItems = shoppingRecords.map((record) => `
    <div class="meal-day-item" data-shopping-id="${esc(record.id)}">
      <button type="button" class="meal-day-item__body" data-edit-shopping="${esc(record.id)}">
        <div class="meal-day-item__head">
          <span class="meal-day-item__emoji">🛒</span>
          <div class="meal-day-item__text">
            <p class="meal-day-item__name">🛒 장보기 ${esc(formatMoney(record.amount))}</p>
            <p class="meal-day-item__type">${record.store ? esc(record.store) : '마트명 없음'}</p>
          </div>
        </div>
      </button>
      <div class="meal-day-item__actions">
        <button type="button" class="btn btn--ghost btn--sm" data-edit-shopping="${esc(record.id)}">수정</button>
        <button type="button" class="btn btn--danger btn--sm" data-del-shopping="${esc(record.id)}">삭제</button>
      </div>
    </div>`).join('');

  dom.calendarDayList.innerHTML = mealItems + shoppingItems;

  dom.calendarDayList.querySelectorAll('[data-view-meal]').forEach((b) => {
    b.onclick = () => openMealModal(b.dataset.viewMeal);
  });
  dom.calendarDayList.querySelectorAll('[data-edit-meal]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); openMealModal(b.dataset.editMeal); };
  });
  dom.calendarDayList.querySelectorAll('[data-del-meal]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      if (confirm('이 식사 기록을 삭제할까요?')) {
        MealLogRepository.remove(b.dataset.delMeal);
        renderCalendar();
        showToast('기록이 삭제되었어요');
      }
    };
  });
  dom.calendarDayList.querySelectorAll('[data-edit-shopping]').forEach((b) => {
    b.onclick = (e) => { e.stopPropagation(); openShoppingModal(b.dataset.editShopping); };
  });
  dom.calendarDayList.querySelectorAll('[data-del-shopping]').forEach((b) => {
    b.onclick = (e) => {
      e.stopPropagation();
      if (confirm('이 장보기 기록을 삭제할까요?')) {
        ShoppingRecordRepository.remove(b.dataset.delShopping);
        renderCalendar();
        showToast('장보기 기록이 삭제되었어요');
      }
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
  };

  if (state.editingMealId) {
    MealLogRepository.update(state.editingMealId, payload);
    showToast('기록이 수정되었어요');
  } else {
    MealLogRepository.create(payload);
    showToast(`"${name}" 기록 완료!`);
  }

  state.selectedCalendarDate = date;
  const [y, m] = date.split('-').map(Number);
  state.calendarYear = y;
  state.calendarMonth = m - 1;
  closeModal('meal');
  renderCalendar();
}

function openShoppingModal(id = null, defaultDate = null) {
  state.editingShoppingId = id;
  dom.shoppingModalForm.reset();
  dom.shoppingModalTitle.textContent = id ? '장보기 기록 수정' : '장보기 기록';
  dom.shoppingDate.value = defaultDate || state.selectedCalendarDate || todayStr();
  if (id) {
    const record = ShoppingRecordRepository.getAll().find((r) => r.id === id);
    if (!record) return;
    dom.shoppingDate.value = record.date;
    dom.shoppingAmount.value = record.amount || '';
    dom.shoppingStore.value = record.store || '';
  }
  openModal('shopping');
}

function handleShoppingModalSubmit(e) {
  e.preventDefault();
  const date = dom.shoppingDate.value;
  const amount = Number(dom.shoppingAmount.value);
  const store = dom.shoppingStore.value.trim();
  if (!date || Number.isNaN(amount)) return;
  const payload = { date, amount, store };
  if (state.editingShoppingId) {
    ShoppingRecordRepository.update(state.editingShoppingId, payload);
    showToast('장보기 기록이 수정되었어요');
  } else {
    ShoppingRecordRepository.create(payload);
    showToast(`장보기 ${formatMoney(amount)} 기록 완료!`);
  }
  state.selectedCalendarDate = date;
  const [y, m] = date.split('-').map(Number);
  state.calendarYear = y;
  state.calendarMonth = m - 1;
  closeModal('shopping');
  renderCalendar();
}

function changeCalendarMonth(delta) {
  state.calendarMonth += delta;
  if (state.calendarMonth > 11) { state.calendarMonth = 0; state.calendarYear += 1; }
  else if (state.calendarMonth < 0) { state.calendarMonth = 11; state.calendarYear -= 1; }
  renderCalendar();
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

  dom.modalContent.innerHTML = `
    <div class="recipe-detail">
      <div class="recipe-detail__hero">
        ${recipeHeroHTML(recipe)}
        <div class="recipe-detail__hero-overlay"></div>
        <h2 class="recipe-detail__hero-title">${esc(recipe.name)}</h2>
      </div>
      <div class="recipe-detail__content">
        ${recipeOriginHTML(recipe)}
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
          ${hasPantry ? MatchService.renderMatchDetailHTML(a) : `<ul class="ingredient-list">${recipe.ingredients.map((ing) => `<li class="ingredient-list__item">${esc(ing)}</li>`).join('')}</ul>`}
        </section>
        <section class="recipe-detail__section">
          <h3 class="recipe-detail__section-title">👨‍🍳 조리 순서</h3>
          <ol class="step-list">${recipe.steps.map((s) => `<li class="step-list__item">${esc(s)}</li>`).join('')}</ol>
        </section>
        ${recipe.memo ? `<section class="recipe-detail__section"><h3 class="recipe-detail__section-title">📝 메모</h3><p class="recipe-detail__memo">${linkifyText(recipe.memo)}</p></section>` : ''}
        <div class="recipe-detail__actions">
          <button type="button" class="btn btn--meal-log" id="btn-log-meal-recipe">🍳 식사 기록</button>
          <button type="button" class="btn ${saved ? 'btn--primary' : 'btn--outline'}" id="btn-save-recipe">${saved ? '⭐ 저장됨' : '☆ 레시피 저장'}</button>
          ${canForkRecipe(recipe) ? `<button type="button" class="btn btn--outline" id="btn-fork-recipe">✏️ 내 버전 만들기</button>` : ''}
          ${owned ? `<button type="button" class="btn btn--ghost" id="btn-edit-recipe">수정</button>
            <button type="button" class="btn btn--danger" id="btn-delete-recipe">삭제</button>` : ''}
        </div>
      </div>
    </div>`;

  dom.modalContent.querySelector('#btn-log-meal-recipe')?.addEventListener('click', () => {
    closeModal('recipe');
    openMealModal(null, { defaultDate: todayStr(), recipeId: recipe.id, mealType: 'home-cook', hideMealType: true });
  });
  dom.modalContent.querySelector('#btn-save-recipe')?.addEventListener('click', () => {
    SavedRecipeRepository.toggle(recipe.id);
    openRecipeDetail({ recipe, ...MatchService.analyze(names, recipe.ingredients) });
    renderMyRecipes();
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
      RecipeRepository.remove(recipe.id);
      SavedRecipeRepository._ids = SavedRecipeRepository._ids.filter((id) => id !== recipe.id);
      SavedRecipeRepository.save();
      closeModal('recipe'); refreshAll();
    }
  });
  openModal('recipe');
}

// ===== Recipe Form =====
function openRecipeForm(id = null) {
  state.editingRecipeId = id;
  state.formImage = null;
  dom.recipeForm.reset();
  dom.formError.hidden = true;
  updatePhotoPreview(null);

  if (id) {
    const r = RecipeRepository.getById(id);
    if (!r) return;
    dom.formModalTitle.textContent = r.parentRecipeId ? '내 버전 수정' : '레시피 수정';
    dom.formName.value = r.name;
    dom.formIngredients.value = r.ingredients.join('\n');
    dom.formCookTime.value = r.cookTime;
    dom.formDifficulty.value = r.difficulty;
    dom.formSteps.value = r.steps.join('\n');
    dom.formCategory.value = r.category;
    dom.formMemo.value = r.memo;
    (r.visibility === 'public' ? dom.formVisibilityPublic : dom.formVisibilityPrivate).checked = true;
    if (hasPhoto(r.image)) { state.formImage = r.image; updatePhotoPreview(r.image); }
  } else {
    dom.formModalTitle.textContent = '내 레시피 추가';
    dom.formVisibilityPrivate.checked = true;
  }
  openModal('form');
  dom.formName.focus();
}

function handleRecipeFormSubmit(e) {
  e.preventDefault();
  dom.formError.hidden = true;
  const data = {
    name: dom.formName.value.trim(),
    ingredients: parseList(dom.formIngredients.value),
    cookTime: Number(dom.formCookTime.value),
    difficulty: dom.formDifficulty.value,
    steps: parseList(dom.formSteps.value),
    category: dom.formCategory.value,
    memo: dom.formMemo.value.trim(),
    visibility: dom.formVisibilityPublic.checked ? 'public' : 'private',
    image: state.formImage || '',
  };
  if (!data.name) return showError('레시피 이름을 입력해 주세요.');
  if (!data.ingredients.length) return showError('재료를 입력해 주세요.');
  if (!data.steps.length) return showError('조리 순서를 입력해 주세요.');

  if (state.editingRecipeId) {
    if (!data.image) {
      const existing = RecipeRepository.getById(state.editingRecipeId);
      if (existing?.image) data.image = existing.image;
    }
    RecipeRepository.update(state.editingRecipeId, data);
  } else {
    RecipeRepository.create(data);
  }

  closeModal('form');
  refreshAll();
}

function showError(msg) { dom.formError.textContent = msg; dom.formError.hidden = false; }

function updatePhotoPreview(src) {
  if (hasPhoto(src)) {
    dom.photoPreview.classList.remove('photo-upload__preview--empty');
    dom.photoPreview.innerHTML = `<img src="${src}" alt="미리보기">`;
    dom.photoRemoveBtn.hidden = false;
  } else {
    dom.photoPreview.classList.add('photo-upload__preview--empty');
    dom.photoPreview.innerHTML = '<span class="photo-upload__placeholder">📷</span><span class="photo-upload__placeholder-text">사진 없음</span>';
    dom.photoRemoveBtn.hidden = true;
  }
}

// ===== Pantry Modal =====
function openPantryModal(id = null) {
  state.editingPantryId = id;
  dom.pantryModalForm.reset();
  dom.pantryModalTitle.textContent = id ? '재료 수정' : '재료 추가';
  if (id) {
    const item = PantryRepository.getAll().find((x) => x.id === id);
    if (!item) return;
    dom.pantryModalName.value = item.name;
    dom.pantryModalQty.value = item.quantity;
    dom.pantryModalUnit.value = item.unit;
    dom.pantryModalExpiry.value = item.expiryDate;
  }
  openModal('pantry');
}

function handlePantryModalSubmit(e) {
  e.preventDefault();
  const name = dom.pantryModalName.value.trim();
  if (!name) return;
  const data = { name, quantity: dom.pantryModalQty.value.trim(), unit: dom.pantryModalUnit.value, expiryDate: dom.pantryModalExpiry.value };
  if (state.editingPantryId) PantryRepository.update(state.editingPantryId, data);
  else PantryRepository.create(data);
  closeModal('pantry');
  refreshAll();
}

// ===== Quick Add =====
function handleQuickAdd(e) {
  e.preventDefault();
  if (state.isComposing) return;
  const val = dom.quickInput.value.trim();
  if (!val) return;
  val.split(/[,，、]/).map((s) => s.trim()).filter(Boolean).forEach((name) => {
    const dup = PantryRepository.getAll().some((i) => MatchService.normalize(i.name) === MatchService.normalize(name));
    if (!dup) PantryRepository.create({ name, quantity: '', unit: '', expiryDate: '' });
  });
  dom.quickInput.value = '';
  refreshAll();
}

// ===== Modals =====
function openModal(type) {
  const m = { recipe: dom.recipeModal, form: dom.recipeFormModal, pantry: dom.pantryModal, meal: dom.mealModal, shopping: dom.shoppingModal }[type];
  m.hidden = false; m.setAttribute('aria-hidden', 'false');
  document.body.style.overflow = 'hidden';
}
function closeModal(type) {
  const m = { recipe: dom.recipeModal, form: dom.recipeFormModal, pantry: dom.pantryModal, meal: dom.mealModal, shopping: dom.shoppingModal }[type];
  m.hidden = true; m.setAttribute('aria-hidden', 'true');
  if (dom.recipeModal.hidden && dom.recipeFormModal.hidden && dom.pantryModal.hidden && dom.mealModal.hidden && dom.shoppingModal.hidden) {
    document.body.style.overflow = '';
  }
}
function closeAllModals() { ['recipe', 'form', 'pantry', 'meal', 'shopping'].forEach(closeModal); }

// ===== PWA =====
async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;

  if (!window.isSecureContext) {
    try {
      const regs = await navigator.serviceWorker.getRegistrations();
      await Promise.all(regs.map((reg) => reg.unregister()));
    } catch {
      // file:// 또는 로컬 HTTP — SW 미지원, 앱은 그대로 실행
    }
    return;
  }

  let refreshing = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (refreshing) return;
    refreshing = true;
    window.location.reload();
  });

  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js?v=14').then((reg) => {
      reg.update();
      if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
    }).catch(() => undefined);
  });
}

// ===== Init =====
function init() {
  PantryRepository.load();
  RecipeRepository.load();
  SavedRecipeRepository.load();
  RecipeSaveCountRepository.load();
  RecipeSaveCountRepository.syncExistingUserSaves(SavedRecipeRepository._ids);
  MealLogRepository.load();
  ShoppingRecordRepository.load();
  renderFilters();
  dom.currencySelect.value = state.currency;

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
  dom.openPantryAdd.onclick = () => openPantryModal();
  dom.openRecipeForm.onclick = () => openRecipeForm();
  dom.openMealAddBtn.onclick = () => openMealModal(null, state.selectedCalendarDate || todayStr());
  dom.openShoppingAddBtn.onclick = () => openShoppingModal(null, state.selectedCalendarDate || todayStr());
  dom.currencySelect.onchange = () => {
    state.currency = CURRENCY_OPTIONS[dom.currencySelect.value] ? dom.currencySelect.value : 'AUD';
    StorageAdapter.set(CONFIG.STORAGE.CURRENCY, state.currency);
    renderCalendar();
  };
  dom.calendarPrev.onclick = () => changeCalendarMonth(-1);
  dom.calendarNext.onclick = () => changeCalendarMonth(1);
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
  dom.photoSelectBtn.onclick = () => dom.formPhoto.click();
  dom.formPhoto.onchange = (e) => { compressImage(e.target.files[0]).then((s) => { state.formImage = s; updatePhotoPreview(s); }).catch((err) => showError(err.message)); };
  dom.photoRemoveBtn.onclick = () => { state.formImage = null; dom.formPhoto.value = ''; updatePhotoPreview(null); };

  document.querySelectorAll('[data-close-modal]').forEach((el) => {
    el.onclick = () => closeModal(el.dataset.closeModal);
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeAllModals();
  });

  navigate('main');

  if (new URLSearchParams(location.search).get('demo') === '1' && !PantryRepository.getAll().length) {
    [['계란', '6', '개', '2026-06-20'], ['양파', '2', '개', '2026-06-25'], ['김치', '1', '봉', '2026-06-18']].forEach(([name, q, u, exp]) => {
      PantryRepository.create({ name, quantity: q, unit: u, expiryDate: exp });
    });
    refreshAll();
  }
}

init();
registerServiceWorker();

window.AppServices = { PantryRepository, RecipeRepository, SavedRecipeRepository, RecipeSaveCountRepository, MealLogRepository, ShoppingRecordRepository, RecommendationService, MatchService, IngredientGroupService, FreshFoodService };
