/**
 * Firestore 컬렉션 · 경로 · 필드 상수
 * 구현 시 Repository / FirestoreAdapter에서 import
 */

export const FREE_ANALYSIS_LIMIT = 5;

/** 논리 컬렉션 이름 (문서·팀 커뮤니케이션용) */
export const Collection = {
  USERS: 'users',
  PUBLIC_RECIPES: 'publicRecipes',
  RECIPES: 'recipes',
  MY_RECIPES: 'myRecipes',
  MEAL_PLANS: 'mealPlans',
  MEAL_CALENDAR: 'mealCalendar',
  SHOPPING: 'shopping',
  SETTINGS: 'settings',
  INGREDIENTS: 'ingredients',
  FRIDGES: 'fridges',
  FRIDGE_ITEMS: 'items',
  MEAL_LOGS: 'mealLogs',
  SHOPPING_LISTS: 'shoppingLists',
  SHOPPING_ITEMS: 'items',
  FAVORITES: 'favorites',
};

/** users/{uid} 프로필 필드 */
export const UserFields = {
  EMAIL: 'email',
  DISPLAY_NAME: 'displayName',
  PHOTO_URL: 'photoURL',
  FREE_ANALYSIS_REMAINING: 'freeAnalysisRemaining',
  DEFAULT_CURRENCY: 'defaultCurrency',
  DEFAULT_FRIDGE_ID: 'defaultFridgeId',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
  LAST_LOGIN_AT: 'lastLoginAt',
};

/** recipes/{recipeId} 필드 */
export const RecipeFields = {
  NAME: 'name',
  INGREDIENTS: 'ingredients',
  OPTIONAL_INGREDIENTS: 'optionalIngredients',
  INGREDIENT_SUBSTITUTES: 'ingredientSubstitutes',
  STEPS: 'steps',
  COOK_TIME: 'cookTime',
  DIFFICULTY: 'difficulty',
  CATEGORY: 'category',
  CUISINE: 'cuisine',
  TAGS: 'tags',
  DIET_TAGS: 'dietTags',
  DISH_TYPE: 'dishType',
  IMAGE: 'image',
  THUMBNAIL_URL: 'thumbnailUrl',
  CALORIES: 'calories',
  MEMO: 'memo',
  SOURCE: 'source',
  SOURCE_URL: 'sourceUrl',
  SOURCE_PLATFORM: 'sourcePlatform',
  PARENT_RECIPE_ID: 'parentRecipeId',
  CREATED_FROM: 'createdFrom',
  AUTHOR_ID: 'authorId',
  AUTHOR_NAME: 'authorName',
  VISIBILITY: 'visibility',
  SAVE_COUNT: 'saveCount',
  PUBLISHED_AT: 'publishedAt',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
};

export const RecipeVisibility = {
  PRIVATE: 'private',
  PUBLIC: 'public',
};

export const RecipeSource = {
  USER: 'user',
  BUILTIN: 'builtin',
  VIDEO: 'video',
};

/** fridges/{fridgeId}/items/{itemId} 필드 */
export const FridgeItemFields = {
  NAME: 'name',
  QUANTITY: 'quantity',
  UNIT: 'unit',
  EXPIRY_DATE: 'expiryDate',
  RECIPE_ID: 'recipeId',
  RECIPE_NAME: 'recipeName',
  OWNER_ID: 'ownerId',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
};

/** mealLogs/{logId} 필드 */
export const MealLogFields = {
  DATE: 'date',
  NAME: 'name',
  MEAL_TYPE: 'mealType',
  RECIPE_ID: 'recipeId',
  COST: 'cost',
  CURRENCY: 'currency',
  INGREDIENTS: 'ingredients',
  MEMO: 'memo',
  PHOTO: 'photo',
  USED_EXPIRING_INGREDIENTS: 'usedExpiringIngredients',
  OWNER_ID: 'ownerId',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
};

/** favorites/{recipeId} 필드 */
export const FavoriteFields = {
  RECIPE_ID: 'recipeId',
  RECIPE_NAME: 'recipeName',
  AUTHOR_ID: 'authorId',
  SAVED_AT: 'savedAt',
};

/** shoppingLists/{listId} 필드 (Phase A — flat 기록) */
export const ShoppingListFields = {
  DATE: 'date',
  AMOUNT: 'amount',
  STORE: 'store',
  CURRENCY: 'currency',
  INGREDIENTS: 'ingredients',
  RECIPE_ID: 'recipeId',
  RECIPE_NAME: 'recipeName',
  PANTRY_ADDED: 'pantryAdded',
  OWNER_ID: 'ownerId',
  CREATED_AT: 'createdAt',
  UPDATED_AT: 'updatedAt',
};

/** 기본 냉장 ID (MVP 단일 냉장) */
export const DEFAULT_FRIDGE_ID = 'default';

// ── 경로 헬퍼 ──

export function userPath(uid) {
  return `${Collection.USERS}/${uid}`;
}

export function userFridgesPath(uid) {
  return `${userPath(uid)}/${Collection.FRIDGES}`;
}

export function userFridgePath(uid, fridgeId = DEFAULT_FRIDGE_ID) {
  return `${userFridgesPath(uid)}/${fridgeId}`;
}

export function userFridgeItemsPath(uid, fridgeId = DEFAULT_FRIDGE_ID) {
  return `${userFridgePath(uid, fridgeId)}/${Collection.FRIDGE_ITEMS}`;
}

export function userFridgeItemPath(uid, itemId, fridgeId = DEFAULT_FRIDGE_ID) {
  return `${userFridgeItemsPath(uid, fridgeId)}/${itemId}`;
}

export function userIngredientsPath(uid) {
  return `${userPath(uid)}/${Collection.INGREDIENTS}`;
}

export function userMyRecipesPath(uid) {
  return `${userPath(uid)}/${Collection.MY_RECIPES}`;
}

export function userMealPlansPath(uid) {
  return `${userPath(uid)}/${Collection.MEAL_PLANS}`;
}

export function userMealCalendarPath(uid) {
  return `${userPath(uid)}/${Collection.MEAL_CALENDAR}`;
}

export function userShoppingPath(uid) {
  return `${userPath(uid)}/${Collection.SHOPPING}`;
}

export function userSettingsPath(uid) {
  return `${userPath(uid)}/${Collection.SETTINGS}`;
}

export function publicRecipePath(recipeId) {
  return `${Collection.PUBLIC_RECIPES}/${recipeId}`;
}

/** @deprecated mealCalendar 서브컬렉션 사용 */
export function userMealLogsPath(uid) {
  return `${userPath(uid)}/${Collection.MEAL_LOGS}`;
}

export function userMealLogPath(uid, logId) {
  return `${userMealLogsPath(uid)}/${logId}`;
}

export function userShoppingListsPath(uid) {
  return `${userPath(uid)}/${Collection.SHOPPING_LISTS}`;
}

export function userShoppingListPath(uid, listId) {
  return `${userShoppingListsPath(uid)}/${listId}`;
}

export function userFavoritesPath(uid) {
  return `${userPath(uid)}/${Collection.FAVORITES}`;
}

export function userFavoritePath(uid, recipeId) {
  return `${userFavoritesPath(uid)}/${recipeId}`;
}

export function recipePath(recipeId) {
  return `${Collection.RECIPES}/${recipeId}`;
}
