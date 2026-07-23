/**
 * users/{uid}/mealCalendar/{logId}
 */
import {
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { timestampToIso, nowIso } from './firestore-timestamp.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { FamilySharingService } from './family-sharing-service.js';

const SUBCOLLECTION = 'mealCalendar';

let snapshotUnsubscribe = null;

function col(uid) {
  if (!db || !uid) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return collection(db, 'households', householdId, SUBCOLLECTION);
  return collection(db, 'users', uid, SUBCOLLECTION);
}

function logDoc(uid, logId) {
  if (!db || !uid || !logId) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return doc(db, 'households', householdId, SUBCOLLECTION, logId);
  return doc(db, 'users', uid, SUBCOLLECTION, logId);
}

function mapDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    firestoreId: docSnap.id,
    date: data.date || '',
    name: data.name || '',
    mealType: data.mealType || 'home-cook',
    recipeId: data.recipeId || null,
    cost: Number(data.cost) || 0,
    currency: data.currency || 'KRW',
    ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
    memo: data.memo || '',
    photo: data.photo || '',
    usedExpiringIngredients: Boolean(data.usedExpiringIngredients),
    createdAt: timestampToIso(data.createdAt) || nowIso(),
    updatedAt: timestampToIso(data.updatedAt) || nowIso(),
  };
}

export const FirestoreMealCalendarService = {
  stopSync() {
    if (snapshotUnsubscribe) {
      snapshotUnsubscribe();
      snapshotUnsubscribe = null;
    }
  },

  startSync(onItems, onError) {
    this.stopSync();
    const uid = auth?.currentUser?.uid;
    if (!uid || !db) {
      onItems?.([]);
      return null;
    }
    snapshotUnsubscribe = onSnapshot(
      col(uid),
      (snap) => {
        const items = snap.docs.map(mapDoc).sort((a, b) => (b.date || '').localeCompare(a.date || ''));
        onItems?.(items);
      },
      (err) => onError?.(err),
    );
    return snapshotUnsubscribe;
  },

  async saveLog(log) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 식사 기록을 저장할 수 있습니다.');
    const logId = log.firestoreId || log.id || doc(col(user.uid)).id;
    const ref = logDoc(user.uid, logId);
    const payload = {
      date: log.date,
      name: log.name,
      mealType: log.mealType || 'home-cook',
      recipeId: log.recipeId || null,
      cost: Number(log.cost) || 0,
      currency: log.currency || 'KRW',
      ingredients: log.ingredients || [],
      memo: log.memo || '',
      photo: log.photo || '',
      usedExpiringIngredients: Boolean(log.usedExpiringIngredients),
      updatedAt: serverTimestamp(),
    };

    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      payload.createdAt = serverTimestamp();
    }

    await setDoc(
      ref,
      sanitizeFirestorePayload(payload, 'FirestoreMealCalendarService.saveLog'),
      { merge: true },
    );
    return logId;
  },

  async deleteLog(logId) {
    const user = auth?.currentUser;
    if (!user?.uid || !logId) throw new Error('로그인 후 삭제할 수 있습니다.');
    await deleteDoc(logDoc(user.uid, logId));
  },
};
