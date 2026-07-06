/**
 * Firestore users/{uid}/ingredients 재료 저장 · 실시간 동기화
 */
import {
  collection,
  doc,
  addDoc,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';

const INGREDIENTS_COLLECTION = 'ingredients';

let snapshotUnsubscribe = null;

function ingredientsCollection(uid) {
  if (!db || !uid) return null;
  return collection(db, 'users', uid, INGREDIENTS_COLLECTION);
}

function ingredientDoc(uid, docId) {
  if (!db || !uid || !docId) return null;
  return doc(db, 'users', uid, INGREDIENTS_COLLECTION, docId);
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
    console.log('[FirestoreIngredientService] onSnapshot 구독 시작:', user.uid);

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
        console.error('[FirestoreIngredientService] onSnapshot 실패:', error?.code, error?.message, error);
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

    console.log('SAVE_TARGET: Firestore users/' + user.uid + '/ingredients');

    try {
      const docRef = await addDoc(
        col,
        sanitizeFirestorePayload(payload, 'FirestoreIngredientService.addIngredient'),
      );
      console.log('INGREDIENT_FIRESTORE_SAVE_SUCCESS', docRef.id);
      return { id: docRef.id, firestoreId: docRef.id, ...payload };
    } catch (error) {
      console.error('INGREDIENT_FIRESTORE_SAVE_FAILED', error);
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

    try {
      await updateDoc(
        ref,
        sanitizeFirestorePayload(payload, 'FirestoreIngredientService.updateIngredient'),
      );
      console.log('INGREDIENT_FIRESTORE_SAVE_SUCCESS', docId);
    } catch (error) {
      console.error('INGREDIENT_FIRESTORE_SAVE_FAILED', error);
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

    try {
      await deleteDoc(ref);
      console.log('[FirestoreIngredientService] Firestore 재료 삭제 성공:', docId);
    } catch (error) {
      console.error('INGREDIENT_FIRESTORE_SAVE_FAILED', error);
      throw error;
    }
  },
};
