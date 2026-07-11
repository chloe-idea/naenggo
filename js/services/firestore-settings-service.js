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
  getDoc,
  onSnapshot,
  setDoc,
  updateDoc,
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

/**
 * byWeek 키를 월요일 YYYY-MM-DD 하나로 접는다.
 * 같은 주가 ISO+날짜로 둘 다 있으면 날짜 키 값을 우선한다.
 */
function collapseByWeek(byWeek) {
  const entries = Object.entries(byWeek && typeof byWeek === 'object' ? byWeek : {});
  entries.sort(([a], [b]) => Number(isCanonicalWeekKey(a)) - Number(isCanonicalWeekKey(b)));
  const out = {};
  for (const [rawKey, weekState] of entries) {
    const key = normalizeGroceryWeekKey(rawKey);
    const cloned = cloneJson(weekState && typeof weekState === 'object' ? weekState : {}, {});
    out[key] = { ...cloned, weekKey: key };
  }
  return out;
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

    await setDoc(
      settingsDoc(user.uid),
      sanitizeFirestorePayload({
        ...partial,
        updatedAt: serverTimestamp(),
      }, 'FirestoreSettingsService.saveSettings'),
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

    try {
      const snap = await getDoc(ref);
      const existingByWeek = snap.exists()
        ? collapseByWeek(snap.data()?.grocery?.byWeek || {})
        : {};
      const mergedByWeek = { ...existingByWeek, ...incoming.byWeek };
      const nextGrocery = {
        activeWeekKey: incoming.activeWeekKey || Object.keys(mergedByWeek)[0] || '',
        byWeek: mergedByWeek,
      };
      const payload = sanitizeFirestorePayload({
        grocery: nextGrocery,
        updatedAt: serverTimestamp(),
      }, 'FirestoreSettingsService.saveGroceryState');

      if (snap.exists()) {
        await updateDoc(ref, payload);
      } else {
        await setDoc(ref, payload);
      }
    } catch (error) {
      console.error('Failed to save grocery week', {
        uid: user.uid,
        weekKey: incoming.activeWeekKey,
        data: weekPayloadForLog(incoming),
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
    return this.saveSettings({ savedRecipeIds });
  },
};
