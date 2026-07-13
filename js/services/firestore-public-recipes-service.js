/**
 * publicRecipes/{recipeId} — 커뮤니티 공개 레시피 (비로그인 포함 전체 읽기)
 */
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
  query,
  where,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { db, auth } from '../firebase.js';
import { timestampToIso, nowIso } from './firestore-timestamp.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { FirestoreUserService } from './firestore-user-service.js';
import { FirestorePublicProfilesService } from './firestore-public-profiles-service.js';
import {
  runFirestoreWrite,
  publicRecipePath,
} from './firestore-debug.js';

const COLLECTION = 'publicRecipes';

let snapshotUnsubscribe = null;

function publicRecipeDoc(recipeId) {
  if (!db || !recipeId) return null;
  return doc(db, COLLECTION, recipeId);
}

function mapPublicRecipe(docSnap) {
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
    sourceUrl: data.sourceUrl || data.sourcePostUrl || null,
    sourcePostUrl: data.sourcePostUrl || data.sourceUrl || null,
    sourcePlatform: data.sourcePlatform || null,
    authorId: data.authorId || data.userId || '',
    userId: data.userId || data.authorId || '',
    // 레거시 fallback — 카드/상세는 authorId → publicProfiles 우선
    authorName: data.authorName || data.nickname || data.displayName || '',
    displayName: data.displayName || data.authorName || '',
    nickname: data.nickname || '',
    profileImage: data.profileImage || '',
    authorGooglePhotoURL: data.authorGooglePhotoURL || '',
    visibility: 'public',
    source: data.source || 'user',
    isPublic: data.isPublic !== false,
    myRecipeId: data.myRecipeId || docSnap.id,
    createdAt: timestampToIso(data.createdAt) || nowIso(),
    updatedAt: timestampToIso(data.updatedAt) || nowIso(),
    publishedAt: timestampToIso(data.publishedAt) || timestampToIso(data.createdAt) || nowIso(),
  };
}

export const FirestorePublicRecipesService = {
  stopSync() {
    if (snapshotUnsubscribe) {
      snapshotUnsubscribe();
      snapshotUnsubscribe = null;
    }
  },

  startSync(onItems, onError) {
    this.stopSync();
    if (!db) {
      onError?.(new Error('Firestore not initialized'));
      onItems?.([]);
      return null;
    }

    const col = query(collection(db, COLLECTION), where('isPublic', '==', true));
    snapshotUnsubscribe = onSnapshot(
      col,
      (snap) => {
        const items = snap.docs.map(mapPublicRecipe).sort(
          (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''),
        );
        onItems?.(items);
      },
      (err) => onError?.(err),
    );
    return snapshotUnsubscribe;
  },

  async publish(recipe, authUser) {
    if (!authUser?.uid || !db) throw new Error('로그인 후 공개할 수 있습니다.');
    const recipeId = recipe.firestoreId || recipe.id;
    if (!recipeId) throw new Error('레시피 ID가 없습니다.');

    const ref = publicRecipeDoc(recipeId);
    const savePath = publicRecipePath(recipeId);
    const profile = await FirestoreUserService.getUserDocument(authUser.uid);
    const nickname = String(profile?.displayName || '').trim();
    const displayName = String(authUser.displayName || authUser.email?.split('@')[0] || '').trim();
    const authorLabel = nickname || displayName || '냉장GO 사용자';
    const sourcePostUrl = recipe.sourcePostUrl || recipe.sourceUrl || null;
    const payload = {
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
      memo: recipe.memo || '',
      sourceUrl: sourcePostUrl,
      sourcePostUrl,
      sourcePlatform: recipe.sourcePlatform || null,
      authorId: authUser.uid,
      userId: authUser.uid,
      // 표시용 fallback만 유지 — SNS는 publicProfiles에서 조회
      authorName: authorLabel,
      source: recipe.source || 'user',
      isPublic: true,
      myRecipeId: recipeId,
      updatedAt: serverTimestamp(),
      publishedAt: serverTimestamp(),
    };

    const existingSnap = await runFirestoreWrite(
      'publicRecipes.getDoc',
      authUser.uid,
      savePath,
      () => getDoc(ref),
      { recipeId, step: 'exists-check' },
    );
    const isNew = !existingSnap.exists();
    if (isNew) {
      payload.createdAt = serverTimestamp();
    }

    await runFirestoreWrite(
      'publicRecipes.setDoc',
      authUser.uid,
      savePath,
      () => setDoc(
        ref,
        sanitizeFirestorePayload(payload, 'FirestorePublicRecipesService.publish'),
        { merge: true },
      ),
      { recipeId, visibility: 'public' },
    );

    try {
      await FirestorePublicProfilesService.syncFromUserProfile(authUser.uid, profile || {
        displayName: authorLabel,
        profileImageUrl: profile?.profileImageUrl || profile?.profileImage || '',
        bio: profile?.bio || '',
        socialLinks: profile?.socialLinks || {},
      });
      if (isNew) {
        await FirestorePublicProfilesService.adjustPublicRecipeCount(authUser.uid, 1);
      }
    } catch (err) {
      console.warn('[FirestorePublicRecipesService] public profile sync failed:', err);
    }

    return recipeId;
  },

  async unpublish(recipeId, uid = null, options = {}) {
    if (!db || !recipeId) return;
    const ref = publicRecipeDoc(recipeId);
    if (!ref) return;
    const savePath = publicRecipePath(recipeId);
    const authUid = uid || auth?.currentUser?.uid || null;
    const allowAdmin = options?.allowAdmin === true;

    const snap = await getDoc(ref);
    if (!snap.exists()) return;

    const authorId = snap.data()?.authorId || '';
    const isOwner = authorId && authUid && authorId === authUid;
    if (!isOwner && !allowAdmin) {
      console.warn('[FirestorePublicRecipesService] unpublish skipped — not owner', { recipeId, authUid });
      return;
    }

    await runFirestoreWrite(
      'publicRecipes.deleteDoc',
      authUid,
      savePath,
      () => deleteDoc(ref),
      { recipeId, allowAdmin },
    );

    if (authorId) {
      try {
        await FirestorePublicProfilesService.adjustPublicRecipeCount(authorId, -1);
      } catch (err) {
        console.warn('[FirestorePublicRecipesService] publicRecipeCount adjust failed:', err);
      }
    }
  },

  async listByAuthorId(authorId) {
    if (!db || !authorId) return [];
    const q = query(
      collection(db, COLLECTION),
      where('authorId', '==', authorId),
    );
    const snap = await getDocs(q);
    return snap.docs
      .map(mapPublicRecipe)
      .filter((r) => r.isPublic !== false)
      .sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
  },
};
