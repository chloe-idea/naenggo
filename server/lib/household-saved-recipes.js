/**
 * 가족 household 저장 레시피(savedByMembers) 정리 — Admin SDK 전용.
 * leave / remove / account-delete / lazy cleanup 에서 공유한다.
 *
 * 공개 레시피 원본은 건드리지 않는다. savedRecipes 관계 문서만 갱신/삭제한다.
 */
import { FieldValue } from 'firebase-admin/firestore';

const HOUSEHOLDS = 'households';

export function normalizeSavedByMembers(data = {}) {
  const members = Array.isArray(data.savedByMembers) ? data.savedByMembers : [];
  const legacy = data.savedBy ? [{
    uid: String(data.savedBy),
    name: String(data.savedByName || '냉장GO 사용자'),
    savedAt: data.savedAt || null,
  }] : [];
  return [...members, ...legacy].reduce((result, member) => {
    const memberUid = String(member?.uid || '').trim();
    if (memberUid && !result.some((item) => item.uid === memberUid)) {
      result.push({
        uid: memberUid,
        name: String(member.name || '냉장GO 사용자'),
        savedAt: member.savedAt || null,
      });
    }
    return result;
  }, []);
}

/** household-service.isMemberActiveDoc 과 동일 계약 */
function isMemberActiveDoc(data) {
  if (!data) return false;
  return data.active !== false;
}

/**
 * household savedRecipes 문서 목록에서 해당 uid가 저장한 recipeId만 추출한다.
 */
export function recipeIdsSavedByUid(docs, uid) {
  const targetUid = String(uid || '').trim();
  if (!targetUid || !Array.isArray(docs)) return [];
  const ids = [];
  for (const docSnap of docs) {
    const data = typeof docSnap?.data === 'function' ? (docSnap.data() || {}) : (docSnap || {});
    const recipeId = String(docSnap?.id || data.recipeId || '').trim();
    if (!recipeId) continue;
    const members = normalizeSavedByMembers(data);
    const hasUid = members.some((m) => m.uid === targetUid) || data.savedBy === targetUid;
    if (hasUid) ids.push(recipeId);
  }
  return ids;
}

/**
 * 내가 저장한 household savedRecipes → 개인 preferences.savedRecipeIds 로 합친다.
 * (leave/remove/delete 후 개인 스코프에서 내 저장만 유지하기 위함)
 */
export async function migrateUidSavedRecipesToPersonal(db, householdId, uid) {
  const hid = String(householdId || '').trim();
  const targetUid = String(uid || '').trim();
  if (!hid || !targetUid) {
    return { migratedIds: [], mergedIds: [], migratedCount: 0 };
  }

  const col = db.collection(HOUSEHOLDS).doc(hid).collection('savedRecipes');
  const snap = await col.get();
  const migratedIds = recipeIdsSavedByUid(snap.docs, targetUid);

  const prefsRef = db.collection('users').doc(targetUid).collection('settings').doc('preferences');
  const prefsSnap = await prefsRef.get();
  const existing = prefsSnap.exists ? (prefsSnap.data() || {}) : {};
  const existingIds = Array.isArray(existing.savedRecipeIds)
    ? existing.savedRecipeIds.map(String).filter(Boolean)
    : [];
  const mergedIds = [...new Set([...existingIds, ...migratedIds])];

  await prefsRef.set({
    savedRecipeIds: mergedIds,
    updatedAt: FieldValue.serverTimestamp(),
  }, { merge: true });

  return {
    migratedIds,
    mergedIds,
    migratedCount: migratedIds.length,
    previousCount: existingIds.length,
  };
}

/**
 * 특정 uid의 저장 관계를 household savedRecipes에서 제거한다 (idempotent).
 * 남은 저장자가 없으면 해당 savedRecipes 문서만 삭제한다.
 */
export async function removeUidFromHouseholdSavedRecipes(db, householdId, uid) {
  const hid = String(householdId || '').trim();
  const targetUid = String(uid || '').trim();
  if (!hid || !targetUid) return { updated: 0, deleted: 0 };

  const col = db.collection(HOUSEHOLDS).doc(hid).collection('savedRecipes');
  const snap = await col.get();
  let updated = 0;
  let deleted = 0;

  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const members = normalizeSavedByMembers(data);
    const hasUid = members.some((m) => m.uid === targetUid) || data.savedBy === targetUid;
    if (!hasUid) continue;

    const remaining = members.filter((m) => m.uid !== targetUid);
    if (!remaining.length) {
      await docSnap.ref.delete();
      deleted += 1;
    } else {
      await docSnap.ref.set({
        recipeId: docSnap.id,
        savedByMembers: remaining,
        savedBy: FieldValue.delete(),
        savedByName: FieldValue.delete(),
        savedAt: FieldValue.delete(),
      }, { merge: true });
      updated += 1;
    }
  }

  return { updated, deleted, touched: updated + deleted };
}

/**
 * 활성 member uid 집합에 없는 저장자를 모두 제거한다 (기존 잔여 데이터 lazy cleanup).
 * idempotent — 이미 정리된 household에도 안전.
 */
export async function purgeInactiveSavedRecipeMembers(db, householdId) {
  const hid = String(householdId || '').trim();
  if (!hid) return { updated: 0, deleted: 0, removedUids: [] };

  const membersSnap = await db.collection(HOUSEHOLDS).doc(hid).collection('members').get();
  const activeUids = new Set(
    membersSnap.docs
      .filter((docSnap) => isMemberActiveDoc(docSnap.data()))
      .map((docSnap) => docSnap.id),
  );

  const col = db.collection(HOUSEHOLDS).doc(hid).collection('savedRecipes');
  const snap = await col.get();
  let updated = 0;
  let deleted = 0;
  const removedUids = new Set();

  for (const docSnap of snap.docs) {
    const data = docSnap.data() || {};
    const members = normalizeSavedByMembers(data);
    const remaining = members.filter((m) => activeUids.has(m.uid));
    const needsRewrite = remaining.length !== members.length
      || Boolean(data.savedBy)
      || Boolean(data.savedByName)
      || Boolean(data.savedAt);
    if (!needsRewrite) continue;

    members.filter((m) => !activeUids.has(m.uid)).forEach((m) => removedUids.add(m.uid));
    if (data.savedBy && !activeUids.has(String(data.savedBy))) {
      removedUids.add(String(data.savedBy));
    }

    if (!remaining.length) {
      await docSnap.ref.delete();
      deleted += 1;
    } else {
      await docSnap.ref.set({
        recipeId: docSnap.id,
        savedByMembers: remaining,
        savedBy: FieldValue.delete(),
        savedByName: FieldValue.delete(),
        savedAt: FieldValue.delete(),
      }, { merge: true });
      updated += 1;
    }
  }

  return {
    updated,
    deleted,
    touched: updated + deleted,
    removedUids: [...removedUids],
    activeMemberCount: activeUids.size,
  };
}
