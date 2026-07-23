/**
 * users/{uid}/settings/preferences — 통화, 장보기 리스트, 저장한 레시피 ID
 *
 * grocery.byWeek는 주차 맵이다. setDoc(merge)만으로 현재 주만 쓰면 다른 주는 유지되지만,
 * updateDoc으로 grocery 전체를 빈 byWeek로 바꾸면 전 주가 삭제된다.
 * → 저장 시 서버 기존 byWeek와 클라이언트를 병합한 뒤 grocery 필드를 통째로 교체한다.
 * 레거시 ISO 키(2026-W29)는 읽을 때 YYYY-MM-DD로 접는다.
 */
import {
  doc,
  collection,
  getDoc,
  getDocFromServer,
  onSnapshot,
  setDoc,
  updateDoc,
  runTransaction,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { FamilySharingService } from './family-sharing-service.js';

const SUBCOLLECTION = 'settings';
const DOC_ID = 'preferences';

let snapshotUnsubscribe = null;

function settingsDoc(uid) {
  if (!db || !uid) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return doc(db, 'households', householdId, 'grocery', DOC_ID);
  return doc(db, 'users', uid, SUBCOLLECTION, DOC_ID);
}

function savedRecipesCollection() {
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (!db || !householdId) return null;
  return collection(db, 'households', householdId, 'savedRecipes');
}

function isFamilyScope() {
  return Boolean(FamilySharingService.getActiveHouseholdId());
}

function normalizeSavedByMembers(data = {}) {
  const members = Array.isArray(data.savedByMembers) ? data.savedByMembers : [];
  const legacy = data.savedBy ? [{
    uid: data.savedBy,
    name: data.savedByName || '냉장GO 사용자',
    savedAt: data.savedAt || null,
  }] : [];
  return [...members, ...legacy].reduce((result, member) => {
    const uid = String(member?.uid || '').trim();
    if (uid && !result.some((item) => item.uid === uid)) {
      result.push({ uid, name: String(member.name || '냉장GO 사용자'), savedAt: member.savedAt || null });
    }
    return result;
  }, []);
}

function readSettingsData(data = {}) {
  if (!isFamilyScope()) return data;
  return {
    currency: data.currency,
    monthlyFoodBudget: data.monthlyFoodBudget,
    grocery: { activeWeekKey: data.activeWeekKey, byWeek: data.byWeek },
  };
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

function parseDateStr(dateStr) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

function toDateStr(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function getWeekStartDate(dateLike) {
  const base = dateLike instanceof Date ? new Date(dateLike) : parseDateStr(dateLike);
  const day = base.getDay();
  const diff = day === 0 ? -6 : 1 - day;
  base.setDate(base.getDate() + diff);
  base.setHours(0, 0, 0, 0);
  return base;
}

/** 레거시 ISO(2026-W29) → 주 시작일 YYYY-MM-DD */
function normalizeGroceryWeekKey(weekKey) {
  const raw = String(weekKey || '').trim();
  if (!raw) return toDateStr(getWeekStartDate(new Date()));
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return toDateStr(getWeekStartDate(raw));
  const iso = /^(\d{4})-W(\d{1,2})$/i.exec(raw);
  if (iso) {
    const year = Number(iso[1]);
    const weekNo = Number(iso[2]);
    const jan4 = new Date(year, 0, 4);
    const start = getWeekStartDate(jan4);
    start.setDate(start.getDate() + (weekNo - 1) * 7);
    return toDateStr(start);
  }
  return toDateStr(getWeekStartDate(raw));
}

function isCanonicalWeekKey(key) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(key || ''));
}

function cloneJson(value, fallback) {
  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

/** 주차에 의미 있는 장보기 데이터가 있는지 */
function isGroceryWeekEmpty(weekState) {
  if (!weekState || typeof weekState !== 'object') return true;
  const budget = weekState.budget ?? weekState.weeklyBudget ?? '';
  if (budget !== '' && budget != null) return false;
  const items = weekState.items && typeof weekState.items === 'object'
    ? weekState.items
    : (weekState.groceryItems && typeof weekState.groceryItems === 'object' ? weekState.groceryItems : {});
  if (Object.keys(items).length > 0) return false;
  if (Array.isArray(weekState.manualItems) && weekState.manualItems.length > 0) return false;
  if (Array.isArray(weekState.completedKeys) && weekState.completedKeys.length > 0) return false;
  const ledger = Array.isArray(weekState.purchasedLedger)
    ? weekState.purchasedLedger
    : (Array.isArray(weekState.purchasedRecords) ? weekState.purchasedRecords : []);
  return ledger.length === 0;
}

/** 같은 주의 두 스냅샷 중 데이터가 있는 쪽을 고른다 */
function preferRicherWeekState(a, b, weekKey) {
  const aEmpty = isGroceryWeekEmpty(a);
  const bEmpty = isGroceryWeekEmpty(b);
  if (aEmpty && !bEmpty) return { ...cloneJson(b, {}), weekKey };
  if (!aEmpty && bEmpty) return { ...cloneJson(a, {}), weekKey };
  // 둘 다 있으면 나중에 온 값(b) 우선 — 호출부가 덮어쓰기 순서를 정함
  return { ...cloneJson(b && typeof b === 'object' ? b : {}, {}), weekKey };
}

/**
 * byWeek 키를 월요일 YYYY-MM-DD 하나로 접는다.
 * 같은 주가 ISO+날짜로 둘 다 있으면, 빈 값보다 데이터가 있는 쪽을 우선한다.
 */
function collapseByWeek(byWeek) {
  const entries = Object.entries(byWeek && typeof byWeek === 'object' ? byWeek : {});
  // 날짜 키를 뒤에 두되, 빈 날짜 키가 찬 ISO를 덮지 않도록 preferRicher 사용
  entries.sort(([a], [b]) => Number(isCanonicalWeekKey(a)) - Number(isCanonicalWeekKey(b)));
  const out = {};
  for (const [rawKey, weekState] of entries) {
    const key = normalizeGroceryWeekKey(rawKey);
    const cloned = cloneJson(weekState && typeof weekState === 'object' ? weekState : {}, {});
    if (out[key]) {
      out[key] = preferRicherWeekState(out[key], { ...cloned, weekKey: key }, key);
    } else {
      out[key] = { ...cloned, weekKey: key };
    }
  }
  return out;
}

/**
 * 서버 byWeek ← 클라이언트 byWeek 병합.
 * - 빈 클라이언트 주는 서버 non-empty를 덮지 않음
 * - 빈 클라이언트 주는 payload에서 빠져도 되므로, 여기 들어오면 스킵해 서버 유지
 */
function mergeByWeekProtectNonEmpty(existingByWeek, incomingByWeek) {
  const merged = { ...existingByWeek };
  Object.entries(incomingByWeek || {}).forEach(([key, incoming]) => {
    if (isGroceryWeekEmpty(incoming)) {
      // 빈 주로는 신규 키도 넣지 않음 — 새로고침 레이스의 빈 현재 주 삽입 방지
      return;
    }
    merged[key] = incoming;
  });
  return merged;
}

/** 저장용: activeWeekKey + byWeek(정규화)만. 레거시 flat은 한 주로 승격. */
function canonicalizeGroceryForSave(grocery) {
  if (!grocery || typeof grocery !== 'object') {
    return { activeWeekKey: '', byWeek: {} };
  }

  let byWeek = collapseByWeek(grocery.byWeek);
  if (!Object.keys(byWeek).length) {
    const hasFlat = grocery.budget != null && grocery.budget !== ''
      || (grocery.items && Object.keys(grocery.items).length)
      || (Array.isArray(grocery.manualItems) && grocery.manualItems.length)
      || (Array.isArray(grocery.purchasedLedger) && grocery.purchasedLedger.length)
      || (Array.isArray(grocery.purchasedRecords) && grocery.purchasedRecords.length);
    if (hasFlat) {
      const key = normalizeGroceryWeekKey(grocery.activeWeekKey || new Date());
      byWeek = {
        [key]: {
          weekKey: key,
          budget: grocery.budget ?? grocery.weeklyBudget ?? '',
          items: grocery.items && typeof grocery.items === 'object' ? grocery.items : {},
          manualItems: Array.isArray(grocery.manualItems) ? grocery.manualItems : [],
          completedKeys: Array.isArray(grocery.completedKeys) ? grocery.completedKeys : [],
          purchasedLedger: Array.isArray(grocery.purchasedLedger)
            ? grocery.purchasedLedger
            : (Array.isArray(grocery.purchasedRecords) ? grocery.purchasedRecords : []),
        },
      };
    }
  }

  const activeWeekKey = grocery.activeWeekKey
    ? normalizeGroceryWeekKey(grocery.activeWeekKey)
    : (Object.keys(byWeek)[0] || '');

  return cloneJson({ activeWeekKey, byWeek }, { activeWeekKey: '', byWeek: {} });
}

/** Firestore grocery → 앱 상태. byWeek 주차 구조를 유지·정규화한다. */
function normalizeGroceryFromFirestore(grocery) {
  if (!grocery || typeof grocery !== 'object') {
    return { ...DEFAULT_SETTINGS.grocery, byWeek: {}, items: {}, manualItems: [], completedKeys: [], purchasedLedger: [] };
  }

  const byWeek = grocery.byWeek && typeof grocery.byWeek === 'object' ? grocery.byWeek : null;
  if (byWeek && Object.keys(byWeek).length > 0) {
    const collapsed = collapseByWeek(byWeek);
    return {
      activeWeekKey: grocery.activeWeekKey
        ? normalizeGroceryWeekKey(grocery.activeWeekKey)
        : '',
      byWeek: collapsed,
    };
  }

  // 레거시 단일 주차 형식
  return {
    activeWeekKey: grocery.activeWeekKey
      ? normalizeGroceryWeekKey(grocery.activeWeekKey)
      : '',
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

function weekPayloadForLog(grocery) {
  const key = grocery?.activeWeekKey || '';
  return {
    activeWeekKey: key,
    week: key && grocery?.byWeek ? grocery.byWeek[key] : null,
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
    const emit = (preferenceData, savedRecipes = []) => {
      const data = readSettingsData(preferenceData);
      onSettings?.({
        currency: data.currency || DEFAULT_SETTINGS.currency,
        monthlyFoodBudget: Number(data.monthlyFoodBudget) || 0,
        grocery: normalizeGroceryFromFirestore(data.grocery),
        savedRecipeIds: savedRecipes.map((item) => item.recipeId),
        savedRecipes,
      });
    };
    let preferenceData = {};
    let savedRecipes = [];
    const stopPreferences = onSnapshot(
      settingsDoc(uid),
      (snap) => {
        preferenceData = snap.exists() ? snap.data() : {};
        savedRecipes = isFamilyScope()
          ? savedRecipes
          : (Array.isArray(preferenceData.savedRecipeIds) ? preferenceData.savedRecipeIds : []);
        emit(preferenceData, Array.isArray(savedRecipes)
          ? savedRecipes.map((item) => typeof item === 'string' ? { recipeId: item, savedByMembers: [] } : item)
          : []);
      },
      (err) => onError?.(err),
    );
    if (isFamilyScope()) {
      const stopSavedRecipes = onSnapshot(
        savedRecipesCollection(),
        (snap) => {
          savedRecipes = snap.docs.map((item) => ({
            recipeId: item.id,
            ...item.data(),
            savedByMembers: normalizeSavedByMembers(item.data()),
          }));
          emit(preferenceData, savedRecipes);
        },
        (err) => onError?.(err),
      );
      snapshotUnsubscribe = () => { stopPreferences(); stopSavedRecipes(); };
    } else {
      snapshotUnsubscribe = stopPreferences;
    }
    return snapshotUnsubscribe;
  },

  async saveSettings(partial) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 설정을 저장할 수 있습니다.');

    if (isFamilyScope() && Object.prototype.hasOwnProperty.call(partial || {}, 'savedRecipeIds')) {
      const { savedRecipeIds, ...rest } = partial;
      await this.saveSavedRecipeIds(savedRecipeIds);
      if (!Object.keys(rest).length) return;
      partial = rest;
    }
    // grocery가 포함되면 전용 저장으로 주차 병합 처리
    if (partial && Object.prototype.hasOwnProperty.call(partial, 'grocery')) {
      const { grocery, ...rest } = partial;
      await this.saveGroceryState(grocery);
      if (rest && Object.keys(rest).length) {
        await setDoc(
          settingsDoc(user.uid),
          sanitizeFirestorePayload({
            ...rest,
            updatedAt: serverTimestamp(),
          }, 'FirestoreSettingsService.saveSettings'),
          { merge: true },
        );
      }
      return;
    }

    // 가족 scope의 grocery 문서는 flat 구조다. 통화·예산만 저장할 때
    // 빈 byWeek를 병합하면 기존 가족 장보기 주차가 통째로 사라진다.
    const payload = { ...partial, updatedAt: serverTimestamp() };
    await setDoc(
      settingsDoc(user.uid),
      sanitizeFirestorePayload(payload, 'FirestoreSettingsService.saveSettings'),
      { merge: true },
    );
  },

  /**
   * grocery 저장: 서버 기존 byWeek + 클라이언트 byWeek 병합 후 grocery 필드 교체.
   * 다른 주차는 유지하고, 클라이언트가 보낸 주차는 통째로 덮어쓴다.
   */
  async saveGroceryState(grocery) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 설정을 저장할 수 있습니다.');
    const ref = settingsDoc(user.uid);
    const incoming = canonicalizeGroceryForSave(grocery);
    // 빈 주는 아예 보내지 않음 → 서버 기존 값 유지
    const incomingNonEmpty = {};
    Object.entries(incoming.byWeek || {}).forEach(([key, week]) => {
      if (!isGroceryWeekEmpty(week)) incomingNonEmpty[key] = week;
    });
    if (!Object.keys(incomingNonEmpty).length) {
      // 저장할 실데이터가 없으면 no-op (새로고침 직후 빈 persist가 서버를 건드리지 않음)
      return;
    }

    try {
      // 캐시에 남은 빈 스냅샷보다 서버 값을 우선
      let snap;
      try {
        snap = await getDocFromServer(ref);
      } catch {
        snap = await getDoc(ref);
      }
      const sourceGrocery = isFamilyScope() ? snap.data() : snap.data()?.grocery;
      let existingByWeek = snap.exists()
        ? collapseByWeek(sourceGrocery?.byWeek || {})
        : {};
      // 레거시 flat grocery도 한 주로 승격해 보호
      if (!Object.keys(existingByWeek).length && snap.exists()) {
        const g = sourceGrocery;
        if (g && typeof g === 'object' && !isGroceryWeekEmpty(g)) {
          const key = normalizeGroceryWeekKey(g.activeWeekKey || incoming.activeWeekKey || new Date());
          existingByWeek = {
            ...existingByWeek,
            [key]: {
              weekKey: key,
              budget: g.budget ?? g.weeklyBudget ?? '',
              items: g.items && typeof g.items === 'object' ? g.items : {},
              manualItems: Array.isArray(g.manualItems) ? g.manualItems : [],
              completedKeys: Array.isArray(g.completedKeys) ? g.completedKeys : [],
              purchasedLedger: Array.isArray(g.purchasedLedger)
                ? g.purchasedLedger
                : (Array.isArray(g.purchasedRecords) ? g.purchasedRecords : []),
            },
          };
        }
      }
      const mergedByWeek = mergeByWeekProtectNonEmpty(existingByWeek, incomingNonEmpty);
      const nextGrocery = {
        activeWeekKey: incoming.activeWeekKey || Object.keys(mergedByWeek)[0] || '',
        byWeek: mergedByWeek,
      };
      const payload = sanitizeFirestorePayload(isFamilyScope()
        ? { ...nextGrocery, updatedAt: serverTimestamp() }
        : { grocery: nextGrocery, updatedAt: serverTimestamp() },
      'FirestoreSettingsService.saveGroceryState');

      if (snap.exists()) {
        await updateDoc(ref, payload);
      } else {
        await setDoc(ref, payload);
      }
    } catch (error) {
      console.error('Failed to save grocery week', {
        uid: user.uid,
        weekKey: incoming.activeWeekKey,
        data: weekPayloadForLog({ ...incoming, byWeek: incomingNonEmpty }),
        error: {
          code: error?.code || '',
          message: error?.message || String(error),
        },
      });
      throw error;
    }
  },

  async saveCurrency(currency) {
    return this.saveSettings({ currency });
  },

  async saveMonthlyFoodBudget(monthlyFoodBudget) {
    return this.saveSettings({ monthlyFoodBudget: Number(monthlyFoodBudget) || 0 });
  },

  async saveSavedRecipeIds(savedRecipeIds) {
    if (!isFamilyScope()) return this.saveSettings({ savedRecipeIds });
    const user = auth?.currentUser;
    const col = savedRecipesCollection();
    if (!user?.uid || !col) throw new Error('로그인 후 저장한 레시피를 관리할 수 있습니다.');
    const wanted = new Set((Array.isArray(savedRecipeIds) ? savedRecipeIds : []).map(String));
    const existing = await getDoc(settingsDoc(user.uid)); // membership/rules check before collection write
    if (!existing.exists() && !FamilySharingService.isActive()) return;
    const displayName = String(user.displayName || user.email?.split('@')[0] || '냉장GO 사용자').slice(0, 40);
    const currentSnapshot = await new Promise((resolve, reject) => {
      const stop = onSnapshot(col, (snap) => { stop(); resolve(snap); }, reject);
    });
    const operations = [...new Set([...currentSnapshot.docs.map((item) => item.id), ...wanted])];
    await Promise.all(operations.map((id) => runTransaction(db, async (tx) => {
      const ref = doc(col, id);
      const snap = await tx.get(ref);
      const data = snap.exists() ? snap.data() : {};
      const members = normalizeSavedByMembers(data);
      const hasCurrentUser = members.some((member) => member.uid === user.uid);
      if (wanted.has(id) && !hasCurrentUser) {
        tx.set(ref, {
          recipeId: id,
          savedByMembers: [...members, { uid: user.uid, name: displayName, savedAt: new Date() }],
        }, { merge: true });
      } else if (!wanted.has(id) && hasCurrentUser) {
        const remaining = members.filter((member) => member.uid !== user.uid);
        if (remaining.length) tx.set(ref, { recipeId: id, savedByMembers: remaining }, { merge: true });
        else tx.delete(ref);
      } else if (snap.exists() && data.savedBy && !data.savedByMembers) {
        // 기존 single-saver 문서는 다음 저장 동작에서 새 구조로 승격한다.
        tx.set(ref, { recipeId: id, savedByMembers: members }, { merge: true });
      }
    })));
  },
};
