/**
 * users/{uid}/settings/preferences — 통화, 장보기 리스트, 저장한 레시피 ID
 */
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';

const SUBCOLLECTION = 'settings';
const DOC_ID = 'preferences';

let snapshotUnsubscribe = null;

function settingsDoc(uid) {
  if (!db || !uid) return null;
  return doc(db, 'users', uid, SUBCOLLECTION, DOC_ID);
}

const DEFAULT_SETTINGS = {
  currency: 'KRW',
  monthlyFoodBudget: 0,
  grocery: {
    activeWeekKey: '',
    byWeek: {},
    budget: '',
    items: {},
    manualItems: [],
    completedKeys: [],
    purchasedLedger: [],
  },
  savedRecipeIds: [],
};

/** Firestore grocery → 앱 상태. byWeek 주차 구조를 유지한다. */
function normalizeGroceryFromFirestore(grocery) {
  if (!grocery || typeof grocery !== 'object') {
    return { ...DEFAULT_SETTINGS.grocery, byWeek: {}, items: {}, manualItems: [], completedKeys: [], purchasedLedger: [] };
  }

  const byWeek = grocery.byWeek && typeof grocery.byWeek === 'object' ? grocery.byWeek : null;
  if (byWeek && Object.keys(byWeek).length > 0) {
    const out = {
      activeWeekKey: String(grocery.activeWeekKey || ''),
      byWeek,
    };
    if (Array.isArray(grocery.purchasedLedger)) out.purchasedLedger = grocery.purchasedLedger;
    if (Array.isArray(grocery.purchasedRecords)) out.purchasedRecords = grocery.purchasedRecords;
    return out;
  }

  // 레거시 단일 주차 형식
  return {
    activeWeekKey: String(grocery.activeWeekKey || ''),
    budget: grocery.budget ?? grocery.weeklyBudget ?? '',
    items: (grocery.items && typeof grocery.items === 'object')
      ? grocery.items
      : ((grocery.groceryItems && typeof grocery.groceryItems === 'object') ? grocery.groceryItems : {}),
    manualItems: Array.isArray(grocery.manualItems) ? grocery.manualItems : [],
    completedKeys: Array.isArray(grocery.completedKeys) ? grocery.completedKeys : [],
    purchasedLedger: Array.isArray(grocery.purchasedLedger)
      ? grocery.purchasedLedger
      : (Array.isArray(grocery.purchasedRecords) ? grocery.purchasedRecords : []),
  };
}

export const FirestoreSettingsService = {
  stopSync() {
    if (snapshotUnsubscribe) {
      snapshotUnsubscribe();
      snapshotUnsubscribe = null;
    }
  },

  startSync(onSettings, onError) {
    this.stopSync();
    const uid = auth?.currentUser?.uid;
    if (!uid || !db) {
      onSettings?.({
        ...DEFAULT_SETTINGS,
        grocery: { ...DEFAULT_SETTINGS.grocery, byWeek: {}, items: {}, manualItems: [], completedKeys: [], purchasedLedger: [] },
        savedRecipeIds: [],
      });
      return null;
    }
    snapshotUnsubscribe = onSnapshot(
      settingsDoc(uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        onSettings?.({
          currency: data.currency || DEFAULT_SETTINGS.currency,
          monthlyFoodBudget: Number(data.monthlyFoodBudget) || 0,
          grocery: normalizeGroceryFromFirestore(data.grocery),
          savedRecipeIds: Array.isArray(data.savedRecipeIds) ? data.savedRecipeIds : [],
        });
      },
      (err) => onError?.(err),
    );
    return snapshotUnsubscribe;
  },

  async saveSettings(partial) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 설정을 저장할 수 있습니다.');
    await setDoc(
      settingsDoc(user.uid),
      sanitizeFirestorePayload({
        ...partial,
        updatedAt: serverTimestamp(),
      }, 'FirestoreSettingsService.saveSettings'),
      { merge: true },
    );
  },

  async saveGroceryState(grocery) {
    return this.saveSettings({ grocery });
  },

  async saveCurrency(currency) {
    return this.saveSettings({ currency });
  },

  async saveMonthlyFoodBudget(monthlyFoodBudget) {
    return this.saveSettings({ monthlyFoodBudget: Number(monthlyFoodBudget) || 0 });
  },

  async saveSavedRecipeIds(savedRecipeIds) {
    return this.saveSettings({ savedRecipeIds });
  },
};
