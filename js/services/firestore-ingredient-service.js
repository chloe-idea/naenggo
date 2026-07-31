/**
 * Firestore users/{uid}/ingredients 재료 저장 · 실시간 동기화
 */
import {
  collection,
  doc,
  addDoc,
  getDocs,
  runTransaction,
  updateDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { FamilySharingService } from './family-sharing-service.js';
import { StartupPerf } from './startup-perf.js';

const INGREDIENTS_COLLECTION = 'ingredients';

let snapshotUnsubscribe = null;

function ingredientsCollection(uid) {
  if (!db || !uid) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return collection(db, 'households', householdId, INGREDIENTS_COLLECTION);
  return collection(db, 'users', uid, INGREDIENTS_COLLECTION);
}

function householdIngredientsCollection(householdId) {
  if (!db || !householdId) return null;
  return collection(db, 'households', householdId, INGREDIENTS_COLLECTION);
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
    normalizedName: normalizeIngredientName(data.normalizedName || data.name),
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
    normalizedName: normalizeIngredientName(String(data?.name || '').trim()),
    quantity: String(data?.quantity ?? ''),
    expiryDate: String(data?.expiryDate ?? ''),
  };
}

function normalizedIngredientName(value) {
  const normalize = window.IngredientNormalizer?.normalizeIngredientName;
  return typeof normalize === 'function'
    ? normalize(value)
    : (typeof value === 'string' ? value.trim().toLocaleLowerCase().replace(/\s+/g, ' ') : '');
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

function ingredientDocumentId(normalizedName) {
  return encodeURIComponent(String(normalizedName || '').trim().toLocaleLowerCase());
}

function mergeHouseholdIngredientData(items, payload, normalizedName) {
  const existingItems = items.filter(Boolean);
  const totalQuantity = existingItems.reduce(
    (total, item) => total + ingredientQuantity(item.quantity),
    ingredientQuantity(payload.quantity),
  );
  const expiryDate = earlierExpiryDate(
    payload.expiryDate,
    ...existingItems.map((item) => item.expiryDate),
  );
  const primary = existingItems[0] || {};
  return {
    ...primary,
    ...payload,
    name: String(primary.name || payload.name).trim(),
    normalizedName,
    quantity: String(totalQuantity),
    expiryDate,
    createdAt: primary.createdAt || payload.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  };
}

async function addOrMergeHouseholdIngredient(householdId, ingredient) {
  if (typeof householdId !== 'string' || !householdId.trim()) {
    throw new Error(`Invalid householdId: ${String(householdId)}`);
  }
  const payload = ingredient;
  const col = householdIngredientsCollection(householdId);
  if (!col) throw new Error('가족 재료 저장 경로를 만들 수 없습니다.');
  const normalizedName = normalizedIngredientName(payload.name);
  if (!normalizedName) throw new Error('표준화된 재료명이 비어 있습니다.');
  const documentId = ingredientDocumentId(normalizedName);
  const ingredientRef = doc(db, 'households', householdId, INGREDIENTS_COLLECTION, documentId);
  console.log('[FirestoreIngredientService] family ingredient save target', {
    householdId,
    normalizedName,
    ingredientDocumentId: documentId,
    ingredientRefPath: ingredientRef?.path,
  });

  // 이전 버전이 만든 자동 ID 문서는 트랜잭션 밖에서 찾고, 트랜잭션 안에서는
  // 반드시 DocumentReference만 읽어 고정 ID 문서로 안전하게 합친다.
  const legacySnapshot = await getDocs(col);
  const legacyRefs = legacySnapshot.docs
    .filter((snap) => snap.id !== documentId
      && normalizedIngredientName(snap.data()?.normalizedName || snap.data()?.name) === normalizedName)
    .map((snap) => snap.ref);

  return runTransaction(db, async (transaction) => {
    const refs = [ingredientRef, ...legacyRefs];
    const snapshots = await Promise.all(refs.map((ref) => transaction.get(ref)));
    const existingItems = snapshots.filter((snap) => snap.exists()).map((snap) => snap.data());
    const merged = mergeHouseholdIngredientData(existingItems, payload, normalizedName);
    transaction.set(
      ingredientRef,
      sanitizeFirestorePayload(merged, 'FirestoreIngredientService.mergeHouseholdIngredient'),
      { merge: true },
    );
    legacyRefs.forEach((ref) => transaction.delete(ref));
    return { id: ingredientRef.id, firestoreId: ingredientRef.id, ...merged };
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
    const activeHouseholdId = FamilySharingService.getActiveHouseholdId();
    const householdId = FamilySharingService.getActiveFamily()?.householdId || activeHouseholdId || null;
    const collectionPath = ingredientPath(user.uid);
    console.info([
      '[CURRENT INGREDIENT SOURCE]',
      `uid: ${user.uid}`,
      `activeHouseholdId: ${activeHouseholdId || ''}`,
      `householdId: ${householdId || ''}`,
      `collectionPath: ${collectionPath}`,
    ].join('\n'));
    console.info('[FirestoreIngredientService] onSnapshot subscription', {
      path: collectionPath.replace(/\/(?:users|households)\/[^/]+/, (m) => (
        m.startsWith('/users/') ? '/users/{uid}' : '/households/{householdId}'
      )),
      hasHousehold: Boolean(activeHouseholdId),
    });

    const perfPath = activeHouseholdId
      ? 'households/{householdId}/ingredients'
      : 'users/{uid}/ingredients';
    const syncStartMs = StartupPerf.begin('ingredients loaded', perfPath);
    StartupPerf.markListener(perfPath);

    snapshotUnsubscribe = onSnapshot(
      col,
      (snapshot) => {
        const items = snapshot.docs
          .map((docSnap) => mapFirestoreDoc(docSnap, user.uid))
          .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''));
        console.log('[FirestoreIngredientService] onSnapshot 수신:', items.length, '개');
        StartupPerf.end('ingredients loaded', {
          documentCount: items.length,
          firestorePath: perfPath,
          startMs: syncStartMs,
        });
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

  async addIngredient(data, { householdId = null } = {}) {
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

    const isHouseholdSave = householdId !== null && householdId !== undefined;
    if (isHouseholdSave && (typeof householdId !== 'string' || !householdId.trim())) {
      throw new Error(`Invalid householdId: ${String(householdId)}`);
    }
    const col = isHouseholdSave
      ? householdIngredientsCollection(householdId)
      : collection(db, 'users', user.uid, INGREDIENTS_COLLECTION);
    if (!col) {
      console.error('NO_FIRESTORE_DB');
      throw new Error('Firestore collection을 만들 수 없습니다.');
    }

    const path = isHouseholdSave
      ? `households/${householdId}/${INGREDIENTS_COLLECTION}`
      : `users/${user.uid}/${INGREDIENTS_COLLECTION}`;
    console.info('[FirestoreIngredientService] add ingredient target', {
      uid: user.uid,
      path,
      householdId,
      payloadKeys: Object.keys(payload),
    });

    try {
      const result = isHouseholdSave
        ? await addOrMergeHouseholdIngredient(householdId, payload)
        : await addDoc(
          col,
          sanitizeFirestorePayload(payload, 'FirestoreIngredientService.addIngredient'),
        ).then((docRef) => ({ id: docRef.id, firestoreId: docRef.id, ...payload }));
      console.log('INGREDIENT_FIRESTORE_SAVE_SUCCESS', result.id);
      return result;
    } catch (error) {
      console.error('가족 재료 저장 실패', {
        uid: user.uid,
        path,
        householdId,
        normalizedName: payload.normalizedName,
        code: error?.code || null,
        message: error?.message || String(error),
        stack: error?.stack || null,
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
