/** Firestore 저장 경로 로깅 · permission-denied 디버그 */

export function userSubcollectionPath(uid, subcollection, docId = null) {
  const base = `users/${uid}/${subcollection}`;
  return docId ? `${base}/${docId}` : `${base}`;
}

export function publicRecipePath(recipeId) {
  return `publicRecipes/${recipeId}`;
}

export function logFirestoreWriteTarget(label, uid, path, extra = {}) {
  console.log(`[FirestoreWrite] ${label}`, { uid, path, ...extra });
}

export function logFirestorePermissionDenied(label, uid, path, error, extra = {}) {
  console.error(`[FirestoreWrite] PERMISSION_DENIED ${label}`, {
    uid,
    path,
    code: error?.code || 'permission-denied',
    message: error?.message || String(error),
    ...extra,
  });
}

export async function runFirestoreWrite(label, uid, path, fn, extra = {}) {
  logFirestoreWriteTarget(label, uid, path, extra);
  try {
    return await fn();
  } catch (error) {
    if (error?.code === 'permission-denied') {
      logFirestorePermissionDenied(label, uid, path, error, extra);
    }
    throw error;
  }
}
