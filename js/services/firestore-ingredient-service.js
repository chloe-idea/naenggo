/**
 * Firestore users/{uid}/ingredients 재료 저장 · 실시간 동기화
 */
import {
  collection,
  doc,
  addDoc,
  getDoc,
  getDocs,
  setDoc,
  runTransaction,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { FamilySharingService } from './family-sharing-service.js';
import { StartupPerf } from './startup-perf.js';

const INGREDIENTS_COLLECTION = 'ingredients';
/** households/{id}/ingredients Rules hasOnly 와 동일한 허용 필드 */
const HOUSEHOLD_INGREDIENT_KEYS = [
  'name',
  'normalizedName',
  'quantity',
  'unit',
  'expiryDate',
  'createdAt',
  'updatedAt',
];

let snapshotUnsubscribe = null;
/** stale personal/household listener 가 최신 scope state 를 덮지 않도록 */
let listenGeneration = 0;

function isDevIngredientLog() {
  try {
    const host = String(globalThis?.location?.hostname || '');
    return host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  } catch (_) {
    return false;
  }
}

function logIngredientWrite(label, details = {}) {
  if (!isDevIngredientLog()) return;
  const mode = details.householdId ? 'household' : 'personal';
  console.info(`[FirestoreIngredientService] ${label}`, {
    mode,
    path: details.path || null,
    documentId: details.documentId || null,
    payloadKeys: details.payloadKeys || null,
    uid: details.uid || null,
    householdId: details.householdId || null,
    code: details.code || null,
    message: details.message || null,
  });
}

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
    normalizedName: normalizedIngredientName(data.normalizedName || data.name),
    quantity: data.quantity == null || data.quantity === '' ? '' : String(data.quantity),
    unit: data.unit == null ? '' : String(data.unit),
    expiryDate: normalizeExpiryDateForStorage(data.expiryDate),
    recipeId: null,
    recipeName: '',
    userId: uid,
    createdAt: toIso(data.createdAt) || new Date().toISOString(),
    updatedAt: toIso(data.updatedAt) || new Date().toISOString(),
  };
}

/** 유통기한: 기존 Firestore 형식(YYYY-MM-DD 문자열)으로 통일 */
function normalizeExpiryDateForStorage(value) {
  if (value == null || value === '') return '';
  if (typeof value?.toDate === 'function') {
    const d = value.toDate();
    if (!(d instanceof Date) || Number.isNaN(d.getTime())) return '';
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }
  const raw = String(value).trim();
  if (!raw) return '';
  // date input / ISO → YYYY-MM-DD
  const isoDay = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (isoDay) return isoDay[1];
  return raw.slice(0, 40);
}

function buildFirestorePayload(data) {
  return {
    name: String(data?.name || '').trim(),
    normalizedName: normalizedIngredientName(String(data?.name || '').trim()),
    quantity: normalizeQuantityForStorage(data?.quantity),
    unit: String(data?.unit ?? '').trim().slice(0, 40),
    expiryDate: normalizeExpiryDateForStorage(data?.expiryDate),
  };
}

function pickHouseholdIngredientFields(data = {}) {
  const out = {};
  HOUSEHOLD_INGREDIENT_KEYS.forEach((key) => {
    if (data[key] !== undefined) out[key] = data[key];
  });
  return out;
}

function normalizedIngredientName(value) {
  const normalize = window.IngredientNormalizer?.normalizeIngredientName;
  return typeof normalize === 'function'
    ? normalize(value)
    : (typeof value === 'string' ? value.trim().toLocaleLowerCase().replace(/\s+/g, ' ') : '');
}

/**
 * 수량 파싱. 빈 문자열/null/undefined/NaN 은 미입력(null).
 * 사용자가 입력한 0 이상은 그대로 반환 (1을 기본값으로 쓰지 않음).
 */
function parseIngredientQuantity(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'nan') return null;
  const quantity = Number.parseFloat(raw);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

/** Firestore/앱 공통 미입력 표현: 빈 문자열 (undefined 저장 금지) */
function normalizeQuantityForStorage(value) {
  const parsed = parseIngredientQuantity(value);
  if (parsed != null) {
    return Number.isInteger(parsed) ? String(parsed) : String(parsed);
  }
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'nan') return '';
  // 비숫자 자유 입력(예: 약간)은 사용자가 넣은 값으로 유지
  return raw;
}

function mergeQuantityValues(...values) {
  const numeric = values.map(parseIngredientQuantity).filter((n) => n != null);
  if (numeric.length) {
    const total = numeric.reduce((sum, n) => sum + n, 0);
    return Number.isInteger(total) ? String(total) : String(total);
  }
  for (const value of values) {
    const stored = normalizeQuantityForStorage(value);
    if (stored) return stored;
  }
  return '';
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
  const quantity = mergeQuantityValues(
    ...existingItems.map((item) => item.quantity),
    payload.quantity,
  );
  const expiryDate = earlierExpiryDate(
    payload.expiryDate,
    ...existingItems.map((item) => item.expiryDate),
  );
  const primary = existingItems[0] || {};
  const unit = String(
    payload.unit != null && String(payload.unit).trim() !== ''
      ? payload.unit
      : (primary.unit ?? ''),
  ).trim().slice(0, 40);
  // Rules hasOnly 를 위해 허용 필드만 반환 (legacy unit/recipeId 등 잔여 필드 제거)
  return pickHouseholdIngredientFields({
    name: String(primary.name || payload.name).trim(),
    normalizedName,
    quantity,
    unit,
    expiryDate,
    createdAt: primary.createdAt || payload.createdAt || serverTimestamp(),
    updatedAt: serverTimestamp(),
  });
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
    // merge:false — 마이그레이션으로 남은 비허용 필드를 문서에서 제거해 Rules hasOnly 통과
    transaction.set(
      ingredientRef,
      sanitizeFirestorePayload(merged, 'FirestoreIngredientService.mergeHouseholdIngredient'),
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
    listenGeneration += 1;
    if (snapshotUnsubscribe) {
      snapshotUnsubscribe();
      snapshotUnsubscribe = null;
      console.log('[FirestoreIngredientService] onSnapshot 구독 해제');
    }
  },

  startSync(onItems, onError) {
    this.stopSync();
    const generation = listenGeneration;

    const user = auth?.currentUser;
    if (!user?.uid) {
      console.warn('[FirestoreIngredientService] startSync — 로그인 사용자 없음');
      // 로그인 전 빈 emit 은 허용. permission-denied 와는 구분한다.
      if (generation === listenGeneration) onItems?.([]);
      return null;
    }

    if (!db) {
      console.error('NO_FIRESTORE_DB');
      const err = new Error('Firestore가 초기화되지 않았습니다.');
      err.code = 'firestore/not-initialized';
      if (generation === listenGeneration) onError?.(err);
      return null;
    }

    const col = ingredientsCollection(user.uid);
    const activeHouseholdId = FamilySharingService.getActiveHouseholdId();
    const householdId = FamilySharingService.getActiveFamily()?.householdId || activeHouseholdId || null;
    const collectionPath = ingredientPath(user.uid);
    const family = FamilySharingService.getActiveFamily();
    console.info('[HouseholdDataSource]', {
      uid: user.uid,
      role: family?.role || null,
      activeHouseholdId: activeHouseholdId || null,
      resolvedHouseholdId: householdId || null,
      pendingSetup: Boolean(family?.pendingSetup),
      ingredientsPath: collectionPath,
      shoppingPath: activeHouseholdId
        ? `households/${activeHouseholdId}/shopping`
        : `users/${user.uid}/shopping`,
      mealPlansPath: activeHouseholdId
        ? `households/${activeHouseholdId}/mealPlans/default`
        : `users/${user.uid}/mealPlans/default`,
    });
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
      generation,
    });

    const perfPath = activeHouseholdId
      ? 'households/{householdId}/ingredients'
      : 'users/{uid}/ingredients';
    const syncStartMs = StartupPerf.begin('ingredients loaded', perfPath);
    StartupPerf.markListener(perfPath);

    snapshotUnsubscribe = onSnapshot(
      col,
      (snapshot) => {
        if (generation !== listenGeneration) {
          console.warn('[FirestoreIngredientService] ignore stale snapshot', {
            generation,
            listenGeneration,
            path: collectionPath,
          });
          return;
        }
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
        if (generation !== listenGeneration) return;
        console.error('[FirestoreIngredientService] onSnapshot failed', {
          operation: 'ingredients.onSnapshot',
          uid: user.uid,
          firestorePath: collectionPath,
          path: collectionPath,
          householdId: FamilySharingService.getActiveHouseholdId(),
          activeHouseholdId: FamilySharingService.getActiveHouseholdId(),
          authPresent: Boolean(auth?.currentUser),
          membershipRole: FamilySharingService.getActiveFamily()?.role || null,
          code: error?.code || null,
          message: error?.message || String(error),
          error,
        });
        // permission-denied 시 빈 배열로 state 를 덮지 않는다.
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

    const base = buildFirestorePayload(data);
    const payload = {
      ...base,
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
    const writePayload = isHouseholdSave
      ? pickHouseholdIngredientFields(payload)
      : payload;
    logIngredientWrite('addIngredient', {
      uid: user.uid,
      path,
      householdId: isHouseholdSave ? householdId : null,
      payloadKeys: Object.keys(writePayload),
    });

    try {
      const result = isHouseholdSave
        ? await addOrMergeHouseholdIngredient(householdId, writePayload)
        : await addDoc(
          col,
          sanitizeFirestorePayload(writePayload, 'FirestoreIngredientService.addIngredient'),
        ).then((docRef) => ({ id: docRef.id, firestoreId: docRef.id, ...writePayload }));
      console.log('INGREDIENT_FIRESTORE_SAVE_SUCCESS', result.id);
      return result;
    } catch (error) {
      logIngredientWrite('addIngredient failed', {
        uid: user.uid,
        path,
        householdId: isHouseholdSave ? householdId : null,
        payloadKeys: Object.keys(writePayload),
        code: error?.code || null,
        message: error?.message || String(error),
      });
      console.error('재료 저장 실패', {
        uid: user.uid,
        path,
        householdId: isHouseholdSave ? householdId : null,
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

    const householdId = FamilySharingService.getActiveHouseholdId();
    const path = ingredientPath(user.uid, docId);
    const base = buildFirestorePayload(data);
    if (!base.name) throw new Error('재료명이 비어 있습니다.');

    try {
      const existingSnap = await getDoc(ref);
      if (!existingSnap.exists()) {
        const err = new Error('재료를 찾을 수 없습니다.');
        err.code = 'firestore/not-found';
        throw err;
      }
      const existing = existingSnap.data() || {};
      // 전체 문서를 허용 필드로 재작성 — updateDoc+잔여 필드 시 Rules hasOnly 실패 방지
      const payload = householdId
        ? pickHouseholdIngredientFields({
          ...base,
          createdAt: existing.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        })
        : {
          ...base,
          createdAt: existing.createdAt || serverTimestamp(),
          updatedAt: serverTimestamp(),
        };

      logIngredientWrite('updateIngredient', {
        uid: user.uid,
        path,
        documentId: docId,
        householdId,
        payloadKeys: Object.keys(payload),
      });

      await setDoc(
        ref,
        sanitizeFirestorePayload(payload, 'FirestoreIngredientService.updateIngredient'),
      );
      console.log('INGREDIENT_FIRESTORE_SAVE_SUCCESS', docId);
    } catch (error) {
      logIngredientWrite('updateIngredient failed', {
        uid: user.uid,
        path,
        documentId: docId,
        householdId,
        code: error?.code || null,
        message: error?.message || String(error),
      });
      console.error('[FirestoreIngredientService] update ingredient failed', {
        uid: user.uid,
        path,
        householdId,
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
