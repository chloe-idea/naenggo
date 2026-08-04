/**
 * 로그인 사용자 Firestore 동기화 + 공개 레시피 구독
 *
 * 홈 초기 로딩: ingredients + myRecipes 만 즉시 구독
 * mealCalendar / mealPlans / shopping / settings 는 해당 화면 최초 진입 시 구독
 */
import { FirestoreIngredientService } from './firestore-ingredient-service.js';
import { FirestoreMyRecipesService } from './firestore-my-recipes-service.js';
import { FirestoreMealCalendarService } from './firestore-meal-calendar-service.js';
import { FirestoreMealPlansService } from './firestore-meal-plans-service.js';
import { FirestoreShoppingService } from './firestore-shopping-service.js';
import { FirestoreSettingsService } from './firestore-settings-service.js';
import { FirestorePublicRecipesService } from './firestore-public-recipes-service.js';

/** @type {null | {
 *   onIngredients?: Function,
 *   onMyRecipes?: Function,
 *   onMealCalendar?: Function,
 *   onMealPlans?: Function,
 *   onShopping?: Function,
 *   onSettings?: Function,
 *   onError?: Function,
 * }} */
let activeHandlers = null;
const startedDeferred = new Set();

const DEFERRED_KEYS = new Set(['mealCalendar', 'mealPlans', 'shopping', 'settings']);

function startDeferredKey(key) {
  if (!activeHandlers || startedDeferred.has(key) || !DEFERRED_KEYS.has(key)) return false;
  const {
    onMealCalendar,
    onMealPlans,
    onShopping,
    onSettings,
    onError,
  } = activeHandlers;

  startedDeferred.add(key);
  switch (key) {
    case 'mealCalendar':
      FirestoreMealCalendarService.startSync(onMealCalendar, onError);
      return true;
    case 'mealPlans':
      FirestoreMealPlansService.startSync(onMealPlans, onError);
      return true;
    case 'shopping':
      FirestoreShoppingService.startSync(onShopping, onError);
      return true;
    case 'settings':
      FirestoreSettingsService.startSync(onSettings, onError);
      return true;
    default:
      return false;
  }
}

export const FirestoreUserDataSync = {
  stopAll() {
    FirestoreIngredientService.stopSync();
    FirestoreMyRecipesService.stopSync();
    FirestoreMealCalendarService.stopSync();
    FirestoreMealPlansService.stopSync();
    FirestoreShoppingService.stopSync();
    FirestoreSettingsService.stopSync();
    startedDeferred.clear();
    activeHandlers = null;
  },

  stopPublicSync() {
    FirestorePublicRecipesService.stopSync();
  },

  startPublicSync(onItems, onError) {
    return FirestorePublicRecipesService.startSync(onItems, onError);
  },

  /**
   * 홈에 필요한 사용자 데이터만 즉시 구독한다.
   * myRecipes는 항상 users/{uid}/myRecipes — household scope와 무관.
   */
  startUserSync(handlers = {}) {
    this.stopAll();
    activeHandlers = handlers;
    const {
      onIngredients,
      onMyRecipes,
      onError,
    } = handlers;

    FirestoreIngredientService.startSync(onIngredients, onError);
    FirestoreMyRecipesService.startSync(onMyRecipes, onError);
  },

  /**
   * household scope 변경 시 ingredients만 재구독한다.
   * myRecipes는 개인 경로라 끊지 않아 registerCount 중복을 막는다.
   */
  restartIngredientsSync(handlers = {}) {
    if (handlers && Object.keys(handlers).length) {
      activeHandlers = { ...(activeHandlers || {}), ...handlers };
    }
    if (!activeHandlers) return;
    FirestoreIngredientService.startSync(activeHandlers.onIngredients, activeHandlers.onError);
  },

  /**
   * scope(개인↔가족) 변경 시 ingredients + 이미 켜진 deferred 구독을 모두 재시작한다.
   * 늦은 개인 경로 snapshot 이 가족 state 를 덮지 않도록 이전 listener 를 끊는다.
   * myRecipes는 users/{uid} 고정이라 유지한다.
   */
  restartScopedSync(handlers = {}) {
    if (handlers && Object.keys(handlers).length) {
      activeHandlers = { ...(activeHandlers || {}), ...handlers };
    }
    if (!activeHandlers) return;
    const deferredKeys = [...startedDeferred];
    FirestoreIngredientService.stopSync();
    FirestoreMealCalendarService.stopSync();
    FirestoreMealPlansService.stopSync();
    FirestoreShoppingService.stopSync();
    FirestoreSettingsService.stopSync();
    startedDeferred.clear();
    FirestoreIngredientService.startSync(activeHandlers.onIngredients, activeHandlers.onError);
    for (const key of deferredKeys) {
      startDeferredKey(key);
    }
    console.log('[FirestoreUserDataSync] scoped sync restarted', {
      deferredKeys,
      householdId: handlers?.householdId ?? null,
    });
  },

  /** @param {string|string[]} keys */
  ensureDeferredSync(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    const started = [];
    for (const key of list) {
      if (startDeferredKey(key)) started.push(key);
    }
    if (started.length) {
      console.log('[FirestoreUserDataSync] deferred sync started', { keys: started });
    }
    return started;
  },

  isDeferredStarted(key) {
    return startedDeferred.has(key);
  },

  /**
   * 홈 브리핑: 이번 주 grocery만 1회 로드 (settings onSnapshot 시작 안 함)
   */
  fetchBriefingGroceryWeek(weekKey) {
    return FirestoreSettingsService.fetchGroceryWeekForBriefing(weekKey);
  },

  // CRUD delegates
  ingredients: FirestoreIngredientService,
  myRecipes: FirestoreMyRecipesService,
  mealCalendar: FirestoreMealCalendarService,
  mealPlans: FirestoreMealPlansService,
  shopping: FirestoreShoppingService,
  settings: FirestoreSettingsService,
  publicRecipes: FirestorePublicRecipesService,
};
