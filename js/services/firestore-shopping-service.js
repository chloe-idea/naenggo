/**
 * users/{uid}/shopping/{recordId}
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

const SUBCOLLECTION = 'shopping';

let snapshotUnsubscribe = null;

function col(uid) {
  if (!db || !uid) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return collection(db, 'households', householdId, SUBCOLLECTION);
  return collection(db, 'users', uid, SUBCOLLECTION);
}

function recordDoc(uid, recordId) {
  if (!db || !uid || !recordId) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return doc(db, 'households', householdId, SUBCOLLECTION, recordId);
  return doc(db, 'users', uid, SUBCOLLECTION, recordId);
}

function mapDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    firestoreId: docSnap.id,
    type: data.type || 'shopping',
    date: data.date || '',
    amount: Number(data.amount) || 0,
    store: data.store || '',
    currency: data.currency || 'KRW',
    items: Array.isArray(data.items) ? data.items : [],
    ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
    recipeId: data.recipeId || null,
    recipeName: data.recipeName || '',
    ingredientsAdded: Boolean(data.ingredientsAdded ?? data.pantryAdded),
    pantryAdded: Boolean(data.ingredientsAdded ?? data.pantryAdded),
    groceryItemKey: data.groceryItemKey || '',
    source: data.source || '',
    createdAt: timestampToIso(data.createdAt) || nowIso(),
    updatedAt: timestampToIso(data.updatedAt) || nowIso(),
  };
}

export const FirestoreShoppingService = {
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

  async saveRecord(record) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 장보기 기록을 저장할 수 있습니다.');
    const recordId = record.firestoreId || record.id || doc(col(user.uid)).id;
    const ref = recordDoc(user.uid, recordId);
    const payload = {
      type: record.type || 'shopping',
      date: record.date,
      amount: Number(record.amount) || 0,
      store: record.store || '',
      currency: record.currency || 'KRW',
      items: record.items || [],
      ingredients: record.ingredients || [],
      recipeId: record.recipeId || null,
      recipeName: record.recipeName || '',
      ingredientsAdded: Boolean(record.ingredientsAdded ?? record.pantryAdded),
      pantryAdded: Boolean(record.ingredientsAdded ?? record.pantryAdded),
      groceryItemKey: record.groceryItemKey || '',
      source: record.source || '',
      updatedAt: serverTimestamp(),
    };

    const existingSnap = await getDoc(ref);
    if (!existingSnap.exists()) {
      payload.createdAt = serverTimestamp();
    }

    await setDoc(
      ref,
      sanitizeFirestorePayload(payload, 'FirestoreShoppingService.saveRecord'),
      { merge: true },
    );
    return recordId;
  },

  async deleteRecord(recordId) {
    const user = auth?.currentUser;
    if (!user?.uid || !recordId) throw new Error('로그인 후 삭제할 수 있습니다.');
    await deleteDoc(recordDoc(user.uid, recordId));
  },
};
