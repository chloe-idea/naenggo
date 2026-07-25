/**
 * Firestore users/{uid}/ingredients 재료 저장 · 실시간 동기화
 */
import {
  collection,
  doc,
  addDoc,
  runTransaction,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { FamilySharingService } from './family-sharing-service.js';

const INGREDIENTS_COLLECTION = 'ingredients';

let snapshotUnsubscribe = null;

function ingredientsCollection(uid) {
  if (!db || !uid) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return collection(db, 'households', householdId, INGREDIENTS_COLLECTION);
  return collection(db, 'users', uid, INGREDIENTS_COLLECTION);
}

function ingredientDoc(uid, docId) {
  if (!db || !uid || !docId) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return doc(db, 'households', householdId, INGREDIENTS_COLLECTION, docId);
  return doc(db, 'users', uid, INGREDIENTS_COLLECTION, docId);
}

function ingredientPath(uid, docId = null) {
  const householdId = FamilySharingService.getActiveHouseholdId();
  const base = householdId
    ? `households/${householdId}/${INGREDIENTS_COLLECTION}`
    : `users/${uid}/${INGREDIENTS_COLLECTION}`;
  return docId ? `${base}/${docId}` : base;
}

function mapFirestoreDoc(docSnap, uid) {
  const data = docSnap.data() || {};
  const toIso = (ts) => (ts?.toDate ? ts.toDate().toISOString() : '');
  return {
    id: docSnap.id,
    firestoreId: docSnap.id,
    name: data.name || '',
    quantity: data.quantity || '',
    unit: '',
    expiryDate: data.expiryDate || '',
    recipeId: null,
    recipeName: '',
    userId: uid,
    createdAt: toIso(data.createdAt) || new Date().toISOString(),
    updatedAt: toIso(data.updatedAt) || new Date().toISOString(),
  };
}

function buildFirestorePayload(data) {
  return {
    name: String(data?.name || '').trim(),
    quantity: String(data?.quantity ?? ''),
    expiryDate: String(data?.expiryDate ?? ''),
  };
}

function normalizedIngredientName(value) {
  return String(value || '').trim().toLocaleLowerCase();
}

function ingredientQuantity(value) {
  const quantity = Number.parseFloat(String(value ?? '').trim());
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : 1;
}

function earlierExpiryDate(...values) {
  return values
    .map((value) => String(value || '').trim())
    .filter(Boolean)
    .sort()[0] || '';
}

async function addOrMergeHouseholdIngredient(col, payload) {
  return runTransaction(db, async (transaction) => {
    const snapshot = await transaction.get(col);
    const sameName = snapshot.docs.filter((snap) => (
      normalizedIngredientName(snap.data()?.name) === normalizedIngredientName(payload.name)
    ));
    if (!sameName.length) {
      const ref = doc(col);
      transaction.set(ref, sanitizeFirestorePayload(payload, 'FirestoreIngredientService.addIngredient'));
      return { id: ref.id, firestoreId: ref.id, ...payload };
    }

    const canonical = sameName[0];
    const totalQuantity = sameName.reduce(
      (total, snap) => total + ingredientQuantity(snap.data()?.quantity),
      ingredientQuantity(payload.quantity),
    );
    const expiryDate = earlierExpiryDate(
      payload.expiryDate,
      ...sameName.map((snap) => snap.data()?.expiryDate),
    );
    transaction.set(canonical.ref, sanitizeFirestorePayload({
      ...canonical.data(),
      name: String(canonical.data()?.name || payload.name).trim(),
      quantity: String(totalQuantity),
      expiryDate,
      updatedAt: serverTimestamp(),
    }, 'FirestoreIngredientService.mergeHouseholdIngredient'), { merge: true });
    sameName.slice(1).forEach((duplicate) => transaction.delete(duplicate.ref));
    return { id: canonical.id, firestoreId: canonical.id, ...canonical.data(), quantity: String(totalQuantity), expiryDate };
  });
}

export const FirestoreIngredientService = {
  ingredientsCollectionRef(uid) {
    return ingredientsCollection(uid);
  },

  isAvailable() {
    return Boolean(db && auth?.currentUser?.uid);
  },

  getCurrentUid() {
    return auth?.currentUser?.uid || null;
  },

  stopSync() {
    if (snapshotUnsubscribe) {
      snapshotUnsubscribe();
      snapshotUnsubscribe = null;
      console.log('[FirestoreIngredientService] onSnapshot 구독 해제');
    }
  },

  startSync(onItems, onError) {
    this.stopSync();

    const user = auth?.currentUser;
    if (!user?.uid) {
      console.warn('[FirestoreIngredientService] startSync — 로그인 사용자 없음');
      onItems?.([]);
      return null;
    }

    if (!db) {
      console.error('NO_FIRESTORE_DB');
      const err = new Error('Firestore가 초기화되지 않았습니다.');
      err.code = 'firestore/not-initialized';
      onError?.(err);
      return null;
    }

    const col = ingredientsCollection(user.uid);
    console.info('[FirestoreIngredientService] onSnapshot subscription', {
      uid: user.uid,
      path: ingredientPath(user.uid),
      householdId: FamilySharingService.getActiveHouseholdId(),
    });

    snapshotUnsubscribe = onSnapshot(
      col,
      (snapshot) => {
        const items = snapshot.docs
          .map((docSnap) => mapFirestoreDoc(docSnap, user.uid))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        console.log('[FirestoreIngredientService] onSnapshot 수신:', items.length, '개');
        onItems?.(items);
      },
      (error) => {
        console.error('[FirestoreIngredientService] onSnapshot failed', {
          uid: user.uid,
          path: ingredientPath(user.uid),
          householdId: FamilySharingService.getActiveHouseholdId(),
          code: error?.code || null,
          message: error?.message || String(error),
          error,
        });
        onError?.(error);
      },
    );

    return snapshotUnsubscribe;
  },

  async addIngredient(data) {
    const user = auth?.currentUser;

    if (!user?.uid) {
      console.error('NO_AUTH_USER');
      const err = new Error('로그인 후 재료를 추가할 수 있습니다.');
      err.code = 'auth/not-logged-in';
      throw err;
    }

    if (!db) {
      console.error('NO_FIRESTORE_DB');
      const err = new Error('Firestore가 초기화되지 않았습니다.');
      err.code = 'firestore/not-initialized';
      throw err;
    }

    const payload = {
      ...buildFirestorePayload(data),
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    if (!payload.name) {
      const err = new Error('재료명이 비어 있습니다.');
      err.code = 'firestore/invalid-name';
      throw err;
    }

    const col = ingredientsCollection(user.uid);
    if (!col) {
      console.error('NO_FIRESTORE_DB');
      throw new Error('Firestore collection을 만들 수 없습니다.');
    }

    const path = ingredientPath(user.uid);
    console.info('[FirestoreIngredientService] add ingredient target', {
      uid: user.uid,
      path,
      householdId: FamilySharingService.getActiveHouseholdId(),
      payloadKeys: Object.keys(payload),
    });

    try {
      const result = FamilySharingService.isActive()
        ? await addOrMergeHouseholdIngredient(col, payload)
        : await addDoc(
          col,
          sanitizeFirestorePayload(payload, 'FirestoreIngredientService.addIngredient'),
        ).then((docRef) => ({ id: docRef.id, firestoreId: docRef.id, ...payload }));
      console.log('INGREDIENT_FIRESTORE_SAVE_SUCCESS', result.id);
      return result;
    } catch (error) {
      console.error('[FirestoreIngredientService] add ingredient failed', {
        uid: user.uid,
        path,
        householdId: FamilySharingService.getActiveHouseholdId(),
        code: error?.code || null,
        message: error?.message || String(error),
        error,
      });
      throw error;
    }
  },

  async updateIngredient(docId, data) {
    const user = auth?.currentUser;
    if (!user?.uid || !docId) {
      console.error('NO_AUTH_USER');
      throw new Error('로그인 후 재료를 수정할 수 있습니다.');
    }

    const ref = ingredientDoc(user.uid, docId);
    if (!ref) {
      console.error('NO_FIRESTORE_DB');
      throw new Error('Firestore가 초기화되지 않았습니다.');
    }

    const payload = {
      ...buildFirestorePayload(data),
      updatedAt: serverTimestamp(),
    };
    if (!payload.name) throw new Error('재료명이 비어 있습니다.');
    const path = ingredientPath(user.uid, docId);

    try {
      await updateDoc(
        ref,
        sanitizeFirestorePayload(payload, 'FirestoreIngredientService.updateIngredient'),
      );
      console.log('INGREDIENT_FIRESTORE_SAVE_SUCCESS', docId);
    } catch (error) {
      console.error('[FirestoreIngredientService] update ingredient failed', {
        uid: user.uid,
        path,
        householdId: FamilySharingService.getActiveHouseholdId(),
        code: error?.code || null,
        message: error?.message || String(error),
        error,
      });
      throw error;
    }
  },

  async deleteIngredient(docId) {
    const user = auth?.currentUser;
    if (!user?.uid || !docId) {
      console.error('NO_AUTH_USER');
      throw new Error('로그인 후 재료를 삭제할 수 있습니다.');
    }

    const ref = ingredientDoc(user.uid, docId);
    if (!ref) {
      console.error('NO_FIRESTORE_DB');
      throw new Error('Firestore가 초기화되지 않았습니다.');
    }
    const path = ingredientPath(user.uid, docId);

    try {
      await deleteDoc(ref);
      console.log('[FirestoreIngredientService] Firestore 재료 삭제 성공:', docId);
    } catch (error) {
      console.error('[FirestoreIngredientService] delete ingredient failed', {
        uid: user.uid,
        path,
        householdId: FamilySharingService.getActiveHouseholdId(),
        code: error?.code || null,
        message: error?.message || String(error),
        error,
      });
      throw error;
    }
  },
};
