/**
 * users/{uid}/mealPlans/default — 식단 플랜 (날짜×슬롯 객체)
 */
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { timestampToIso } from './firestore-timestamp.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';

const SUBCOLLECTION = 'mealPlans';
const DOC_ID = 'default';

let snapshotUnsubscribe = null;

function planDoc(uid) {
  if (!db || !uid) return null;
  return doc(db, 'users', uid, SUBCOLLECTION, DOC_ID);
}

export const FirestoreMealPlansService = {
  stopSync() {
    if (snapshotUnsubscribe) {
      snapshotUnsubscribe();
      snapshotUnsubscribe = null;
    }
  },

  startSync(onPlans, onError) {
    this.stopSync();
    const uid = auth?.currentUser?.uid;
    if (!uid || !db) {
      onPlans?.({});
      return null;
    }
    snapshotUnsubscribe = onSnapshot(
      planDoc(uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        onPlans?.(data.plans && typeof data.plans === 'object' ? data.plans : {});
      },
      (err) => onError?.(err),
    );
    return snapshotUnsubscribe;
  },

  async savePlans(plans) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 식단을 저장할 수 있습니다.');
    await setDoc(
      planDoc(user.uid),
      sanitizeFirestorePayload({
        plans: plans || {},
        updatedAt: serverTimestamp(),
      }, 'FirestoreMealPlansService.savePlans'),
      { merge: true },
    );
  },

  async setSlot(date, slot, data) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 식단을 저장할 수 있습니다.');
    const ref = planDoc(user.uid);
    // read-modify-write via merge field paths
    const payload = {};
    payload[`plans.${date}.${slot}`] = {
      recipeId: data.recipeId || '',
      name: data.name || '',
    };
    payload.updatedAt = serverTimestamp();
    await setDoc(
      ref,
      sanitizeFirestorePayload(payload, 'FirestoreMealPlansService.setSlot'),
      { merge: true },
    );
  },
};
