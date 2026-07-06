/**
 * users/{uid}/myRecipes/{recipeId}
 */
import {
  collection,
  doc,
  getDoc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { auth, db } from '../firebase.js';
import { timestampToIso, nowIso } from './firestore-timestamp.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { FirestorePublicRecipesService } from './firestore-public-recipes-service.js';
import {
  runFirestoreWrite,
  userSubcollectionPath,
  logFirestorePermissionDenied,
} from './firestore-debug.js';

const SUBCOLLECTION = 'myRecipes';

let snapshotUnsubscribe = null;

function recipesCol(uid) {
  if (!db || !uid) return null;
  return collection(db, 'users', uid, SUBCOLLECTION);
}

function recipeDoc(uid, recipeId) {
  if (!db || !uid || !recipeId) return null;
  return doc(db, 'users', uid, SUBCOLLECTION, recipeId);
}

export function mapMyRecipeDoc(docSnap, uid) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    firestoreId: docSnap.id,
    name: data.name || '',
    ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
    optionalIngredients: Array.isArray(data.optionalIngredients) ? data.optionalIngredients : [],
    ingredientSubstitutes: Array.isArray(data.ingredientSubstitutes) ? data.ingredientSubstitutes : [],
    steps: Array.isArray(data.steps) ? data.steps : [],
    cookTime: Number(data.cookTime) || 20,
    difficulty: data.difficulty || '보통',
    category: data.category || 'korean',
    dishType: data.dishType || 'default',
    cuisine: data.cuisine || '',
    tags: Array.isArray(data.tags) ? data.tags : [],
    dietTags: Array.isArray(data.dietTags) ? data.dietTags : [],
    image: data.image || '',
    thumbnailUrl: data.thumbnailUrl || '',
    calories: data.calories ?? null,
    memo: data.memo || '',
    sourceUrl: data.sourceUrl || null,
    sourcePlatform: data.sourcePlatform || null,
    parentRecipeId: data.parentRecipeId || null,
    createdFrom: data.createdFrom || null,
    authorId: data.authorId || uid,
    authorName: data.authorName || '',
    visibility: data.visibility === 'public' ? 'public' : 'private',
    source: 'user',
    publicRecipeId: data.publicRecipeId || null,
    createdAt: timestampToIso(data.createdAt) || nowIso(),
    updatedAt: timestampToIso(data.updatedAt) || nowIso(),
  };
}

function buildPayload(recipe, uid, authUser) {
  return {
    name: recipe.name,
    ingredients: recipe.ingredients || [],
    optionalIngredients: recipe.optionalIngredients || [],
    ingredientSubstitutes: recipe.ingredientSubstitutes || [],
    steps: recipe.steps || [],
    cookTime: Number(recipe.cookTime) || 20,
    difficulty: recipe.difficulty || '보통',
    category: recipe.category || 'korean',
    dishType: recipe.dishType || 'default',
    cuisine: recipe.cuisine || '',
    tags: recipe.tags || [],
    dietTags: recipe.dietTags || [],
    image: recipe.image || '',
    thumbnailUrl: recipe.thumbnailUrl || '',
    calories: recipe.calories ?? null,
    memo: recipe.memo || '',
    sourceUrl: recipe.sourceUrl || null,
    sourcePlatform: recipe.sourcePlatform || null,
    parentRecipeId: recipe.parentRecipeId || null,
    createdFrom: recipe.createdFrom || null,
    authorId: uid,
    authorName: recipe.authorName || authUser?.displayName || '나',
    visibility: recipe.visibility === 'public' ? 'public' : 'private',
    publicRecipeId: recipe.visibility === 'public' ? (recipe.firestoreId || recipe.id) : null,
    updatedAt: serverTimestamp(),
  };
}

async function syncPublicRecipeState(recipe, user, targetId) {
  if (recipe.visibility === 'public') {
    try {
      await FirestorePublicRecipesService.publish(
        { ...recipe, id: targetId, firestoreId: targetId },
        user,
      );
    } catch (error) {
      if (error?.code === 'permission-denied') {
        logFirestorePermissionDenied(
          'publicRecipes.publish',
          user.uid,
          `publicRecipes/${targetId}`,
          error,
          { recipeId: targetId },
        );
      }
      console.warn('[FirestoreMyRecipesService] publicRecipes publish failed (myRecipes saved):', error?.message);
    }
    return;
  }

  try {
    await FirestorePublicRecipesService.unpublish(targetId, user.uid);
  } catch (error) {
    if (error?.code === 'permission-denied') {
      logFirestorePermissionDenied(
        'publicRecipes.unpublish',
        user.uid,
        `publicRecipes/${targetId}`,
        error,
        { recipeId: targetId },
      );
    }
    console.warn('[FirestoreMyRecipesService] publicRecipes unpublish skipped:', error?.message);
  }
}

export const FirestoreMyRecipesService = {
  stopSync() {
    if (snapshotUnsubscribe) {
      snapshotUnsubscribe();
      snapshotUnsubscribe = null;
    }
  },

  startSync(onItems, onError) {
    this.stopSync();
    const uid = auth?.currentUser?.uid;
    if (!uid || !db) {
      onItems?.([]);
      return null;
    }
    const col = recipesCol(uid);
    snapshotUnsubscribe = onSnapshot(
      col,
      (snap) => {
        const items = snap.docs.map((d) => mapMyRecipeDoc(d, uid)).sort(
          (a, b) => (b.updatedAt || '').localeCompare(a.updatedAt || ''),
        );
        onItems?.(items);
      },
      (err) => onError?.(err),
    );
    return snapshotUnsubscribe;
  },

  async saveRecipe(recipe, { isNew = false } = {}) {
    const user = auth?.currentUser;
    if (!user?.uid || !db) throw new Error('로그인 후 레시피를 저장할 수 있습니다.');

    const col = recipesCol(user.uid);
    if (!col) throw new Error('Firestore collection을 만들 수 없습니다.');
    const targetId = recipe.firestoreId || recipe.id || doc(col).id;
    const ref = recipeDoc(user.uid, targetId);
    const savePath = userSubcollectionPath(user.uid, SUBCOLLECTION, targetId);
    const payload = buildPayload(recipe, user.uid, user);

    if (isNew) {
      payload.createdAt = serverTimestamp();
    } else {
      try {
        const existingSnap = await runFirestoreWrite(
          'myRecipes.getDoc',
          user.uid,
          savePath,
          () => getDoc(ref),
          { recipeId: targetId, step: 'exists-check' },
        );
        if (!existingSnap.exists()) {
          payload.createdAt = serverTimestamp();
        }
      } catch (error) {
        if (error?.code === 'permission-denied') {
          logFirestorePermissionDenied('myRecipes.getDoc', user.uid, savePath, error, { recipeId: targetId });
          const hint = new Error(
            '내 레시피 저장 권한이 없습니다. Firebase Console에서 Firestore Rules를 배포했는지 확인해 주세요.',
          );
          hint.code = 'permission-denied';
          throw hint;
        }
        throw error;
      }
    }

    await runFirestoreWrite(
      'myRecipes.setDoc',
      user.uid,
      savePath,
      () => setDoc(
        ref,
        sanitizeFirestorePayload(payload, 'FirestoreMyRecipesService.saveRecipe'),
        { merge: true },
      ),
      { recipeId: targetId, visibility: recipe.visibility || 'private' },
    );

    await syncPublicRecipeState(recipe, user, targetId);
    return targetId;
  },

  async deleteRecipe(recipeId) {
    const user = auth?.currentUser;
    if (!user?.uid || !recipeId) throw new Error('로그인 후 삭제할 수 있습니다.');
    await FirestorePublicRecipesService.unpublish(recipeId);
    await deleteDoc(recipeDoc(user.uid, recipeId));
  },
};
