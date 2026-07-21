import { getFirestoreAdmin, isFirebaseAdminConfigured } from './firebase-admin.js';
import { normalizeVideoSource, resolveRecipeNormalizedVideoId } from './video-source-normalize.js';

const MY_RECIPES = 'myRecipes';

/**
 * @returns {Promise<string|null>} 중복 recipe doc id
 */
export async function findFirestoreDuplicateVideo(uid, normalizedVideoId, excludeRecipeId = null) {
  if (!uid || !normalizedVideoId || !isFirebaseAdminConfigured()) return null;

  const col = getFirestoreAdmin().collection('users').doc(uid).collection(MY_RECIPES);

  try {
    const indexed = await col.where('normalizedVideoId', '==', normalizedVideoId).limit(5).get();
    for (const doc of indexed.docs) {
      if (excludeRecipeId && doc.id === excludeRecipeId) continue;
      return doc.id;
    }
  } catch (err) {
    console.warn('[firestore-video-duplicate] indexed query failed:', err?.message || err);
  }

  const allSnap = await col.get();
  for (const doc of allSnap.docs) {
    if (excludeRecipeId && doc.id === excludeRecipeId) continue;
    const data = doc.data() || {};
    const existingId = resolveRecipeNormalizedVideoId(data);
    if (existingId === normalizedVideoId) return doc.id;
  }

  return null;
}

/**
 * @returns {Promise<{ duplicate: boolean, recipeId?: string }>}
 */
export async function assertNoDuplicateFirestoreVideo(uid, rawUrl, excludeRecipeId = null) {
  const normalized = normalizeVideoSource(rawUrl);
  if (!normalized?.normalizedVideoId) {
    return { duplicate: false };
  }
  const recipeId = await findFirestoreDuplicateVideo(uid, normalized.normalizedVideoId, excludeRecipeId);
  if (!recipeId) return { duplicate: false, normalized };
  return { duplicate: true, recipeId, normalized };
}
