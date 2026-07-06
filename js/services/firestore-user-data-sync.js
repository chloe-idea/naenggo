/**
 * 로그인 사용자 Firestore 동기화 + 공개 레시피 구독
 */
import { FirestoreIngredientService } from './firestore-ingredient-service.js';
import { FirestoreMyRecipesService } from './firestore-my-recipes-service.js';
import { FirestoreMealCalendarService } from './firestore-meal-calendar-service.js';
import { FirestoreMealPlansService } from './firestore-meal-plans-service.js';
import { FirestoreShoppingService } from './firestore-shopping-service.js';
import { FirestoreSettingsService } from './firestore-settings-service.js';
import { FirestorePublicRecipesService } from './firestore-public-recipes-service.js';

export const FirestoreUserDataSync = {
  stopAll() {
    FirestoreIngredientService.stopSync();
    FirestoreMyRecipesService.stopSync();
    FirestoreMealCalendarService.stopSync();
    FirestoreMealPlansService.stopSync();
    FirestoreShoppingService.stopSync();
    FirestoreSettingsService.stopSync();
  },

  stopPublicSync() {
    FirestorePublicRecipesService.stopSync();
  },

  startPublicSync(onItems, onError) {
    return FirestorePublicRecipesService.startSync(onItems, onError);
  },

  startUserSync(handlers = {}) {
    this.stopAll();
    const {
      onIngredients,
      onMyRecipes,
      onMealCalendar,
      onMealPlans,
      onShopping,
      onSettings,
      onError,
    } = handlers;

    FirestoreIngredientService.startSync(onIngredients, onError);
    FirestoreMyRecipesService.startSync(onMyRecipes, onError);
    FirestoreMealCalendarService.startSync(onMealCalendar, onError);
    FirestoreMealPlansService.startSync(onMealPlans, onError);
    FirestoreShoppingService.startSync(onShopping, onError);
    FirestoreSettingsService.startSync(onSettings, onError);
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
