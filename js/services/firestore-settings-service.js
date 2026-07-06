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
  grocery: { budget: '', items: {} },
  savedRecipeIds: [],
};

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
      onSettings?.({ ...DEFAULT_SETTINGS });
      return null;
    }
    snapshotUnsubscribe = onSnapshot(
      settingsDoc(uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        onSettings?.({
          currency: data.currency || DEFAULT_SETTINGS.currency,
          grocery: {
            budget: data.grocery?.budget ?? '',
            items: data.grocery?.items && typeof data.grocery.items === 'object'
              ? data.grocery.items
              : {},
          },
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

  async saveSavedRecipeIds(savedRecipeIds) {
    return this.saveSettings({ savedRecipeIds });
  },
};
