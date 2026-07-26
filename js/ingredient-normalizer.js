(function installIngredientNormalizer(global) {
  const INGREDIENT_ALIASES_URL = '/public/data/ingredient-aliases.json?v=1';
  let ingredientAliases = Object.freeze({});
  let ingredientAliasLookup = new Map();
  let ingredientAliasesReady = false;
  let aliasesLoadPromise = null;

  function cleanName(value) {
    if (typeof value !== 'string') return '';
    return value.trim().toLocaleLowerCase().replace(/\s+/g, ' ');
  }

  function comparisonKey(value) {
    return cleanName(value).replace(/\s/g, '');
  }

  function installAliases(aliases) {
    if (!aliases || typeof aliases !== 'object' || Array.isArray(aliases)) {
      throw new Error('재료 동의어 JSON 형식이 올바르지 않습니다.');
    }

    const nextAliases = {};
    const nextLookup = new Map();
    Object.entries(aliases).forEach(([canonicalName, values]) => {
      if (typeof canonicalName !== 'string' || !Array.isArray(values)) {
        throw new Error('재료 동의어 JSON 항목 형식이 올바르지 않습니다.');
      }
      nextAliases[canonicalName] = [...values];
      values.forEach((alias) => {
        if (typeof alias === 'string' && alias.trim()) {
          nextLookup.set(comparisonKey(alias), canonicalName);
        }
      });
    });
    ingredientAliases = Object.freeze(nextAliases);
    ingredientAliasLookup = nextLookup;
    ingredientAliasesReady = true;
  }

  function loadIngredientAliases() {
    if (aliasesLoadPromise) return aliasesLoadPromise;
    if (typeof global.fetch !== 'function') return Promise.resolve(false);

    aliasesLoadPromise = global.fetch(INGREDIENT_ALIASES_URL, { cache: 'no-cache' })
      .then((response) => {
        if (!response.ok) throw new Error(`재료 동의어 JSON 로드 실패: HTTP ${response.status}`);
        return response.json();
      })
      .then((aliases) => {
        installAliases(aliases);
        console.info('[IngredientNormalizer] ingredient aliases loaded', {
          path: INGREDIENT_ALIASES_URL,
          canonicalNameCount: Object.keys(ingredientAliases).length,
        });
        return true;
      })
      .catch((error) => {
        console.warn('[IngredientNormalizer] ingredient aliases unavailable; original name fallback is active', {
          path: INGREDIENT_ALIASES_URL,
          message: error?.message || String(error),
        });
        return false;
      });
    return aliasesLoadPromise;
  }

  function normalizeIngredientName(value) {
    if (typeof value !== 'string') return '';
    const cleaned = cleanName(value);
    if (!cleaned) return '';
    return ingredientAliasLookup.get(comparisonKey(cleaned)) || cleaned;
  }

  global.IngredientNormalizer = Object.freeze({
    get INGREDIENT_ALIASES() {
      return ingredientAliases;
    },
    normalizeIngredientName,
    comparisonKey,
    loadIngredientAliases,
    isReady: () => ingredientAliasesReady,
  });

  loadIngredientAliases();
})(globalThis);
