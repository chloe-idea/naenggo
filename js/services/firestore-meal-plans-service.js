/**
 * users/{uid}/mealPlans/default — 식단 플랜 (날짜×슬롯 객체)
 *
 * 문서 전체를 plans + updatedAt 로 저장한다.
 * merge:true 깊은 병합을 쓰면 로컬에서 삭제한 슬롯이 Firestore에 남아
 * 재로그인 시 이전 식단이 되살아난다.
 */
import {
  doc,
  onSnapshot,
  setDoc,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { FamilySharingService } from './family-sharing-service.js';

const SUBCOLLECTION = 'mealPlans';
const DOC_ID = 'default';

let snapshotUnsubscribe = null;

function planDoc(uid) {
  if (!db || !uid) return null;
  const householdId = FamilySharingService.getActiveHouseholdId();
  if (householdId) return doc(db, 'households', householdId, SUBCOLLECTION, DOC_ID);
  return doc(db, 'users', uid, SUBCOLLECTION, DOC_ID);
}

function resolveUid() {
  return auth?.currentUser?.uid || null;
}

function clonePlans(plans) {
  try {
    return JSON.parse(JSON.stringify(plans && typeof plans === 'object' ? plans : {}));
  } catch {
    return {};
  }
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
    const uid = resolveUid();
    if (!uid || !db) {
      onPlans?.({});
      return null;
    }
    snapshotUnsubscribe = onSnapshot(
      planDoc(uid),
      (snap) => {
        const data = snap.exists() ? snap.data() : {};
        onPlans?.(data.plans && typeof data.plans === 'object' ? clonePlans(data.plans) : {});
      },
      (err) => onError?.(err),
    );
    return snapshotUnsubscribe;
  },

  async savePlans(plans) {
    const uid = resolveUid();
    if (!uid || !db) throw new Error('로그인 후 식단을 저장할 수 있습니다.');
    // merge 없이 문서 전체를 교체해 삭제·수정이 그대로 반영되게 한다.
    await setDoc(
      planDoc(uid),
      sanitizeFirestorePayload({
        plans: clonePlans(plans),
        updatedAt: serverTimestamp(),
      }, 'FirestoreMealPlansService.savePlans'),
    );
  },

  async setSlot(date, slot, data) {
    const uid = resolveUid();
    if (!uid || !db) throw new Error('로그인 후 식단을 저장할 수 있습니다.');
    // 단건 갱신도 전체 문서 덮어쓰기와 충돌하지 않도록 읽기 없이 경로 병합이 필요하면
    // 호출측에서 savePlans(전체)를 쓰도록 유지한다. 호환용으로 merge 필드 경로 유지.
    const payload = {};
    payload[`plans.${date}.${slot}`] = {
      type: data.type === 'manual' || (!data.recipeId && data.name) ? 'manual' : (data.recipeId ? 'recipe' : ''),
      recipeId: data.recipeId || '',
      name: data.name || '',
      memo: data.memo || '',
      recorded: Boolean(data.recorded),
    };
    payload.updatedAt = serverTimestamp();
    await setDoc(
      planDoc(uid),
      sanitizeFirestorePayload(payload, 'FirestoreMealPlansService.setSlot'),
      { merge: true },
    );
  },
};
