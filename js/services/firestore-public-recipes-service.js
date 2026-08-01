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
import { StartupPerf } from './startup-perf.js';

const COLLECTION = 'publicRecipes';

let snapshotUnsubscribe = null;

function publicRecipeDoc(recipeId) {
  if (!db || !recipeId) return null;
  return doc(db, COLLECTION, recipeId);
}

/**
 * @param {import('firebase/firestore').DocumentSnapshot} docSnap
 * @param {{ lite?: boolean }} [options]
 *   lite=true: 홈 추천용. steps/memo 등 큰 필드는 메모리에 올리지 않음 (Firestore 문서는 그대로 수신)
 */
function mapPublicRecipe(docSnap, { lite = false } = {}) {
  const data = docSnap.data() || {};
  return {
    id: docSnap.id,
    firestoreId: docSnap.id,
    name: data.name || '',
    ingredients: Array.isArray(data.ingredients) ? data.ingredients : [],
    optionalIngredients: Array.isArray(data.optionalIngredients) ? data.optionalIngredients : [],
    ingredientSubstitutes: Array.isArray(data.ingredientSubstitutes) ? data.ingredientSubstitutes : [],
    // 추천·카드에는 steps/memo 불필요 — 상세/포크 시 getById로 전체 로드
    steps: lite ? [] : (Array.isArray(data.steps) ? data.steps : []),
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
    memo: lite ? '' : (data.memo || ''),
    sourceUrl: data.sourceUrl || data.sourcePostUrl || null,
    sourcePostUrl: data.sourcePostUrl || data.sourceUrl || null,
    sourcePlatform: data.sourcePlatform || null,
    authorDeleted: data.authorDeleted === true,
    authorId: data.authorDeleted === true
      ? ''
      : (data.authorId || data.userId || ''),
    userId: data.authorDeleted === true
      ? ''
      : (data.userId || data.authorId || ''),
    // 레거시 fallback — 카드/상세는 authorId → publicProfiles 우선
    authorName: data.authorDeleted === true
      ? '탈퇴한 사용자'
      : (data.authorName || data.nickname || data.displayName || ''),
    displayName: data.authorDeleted === true
      ? '탈퇴한 사용자'
      : (data.displayName || data.authorName || ''),
    nickname: data.authorDeleted === true ? '' : (data.nickname || ''),
    profileImage: data.authorDeleted === true ? '' : (data.profileImage || ''),
    authorGooglePhotoURL: data.authorDeleted === true ? '' : (data.authorGooglePhotoURL || ''),
    visibility: 'public',
    source: data.source || 'user',
    isPublic: data.isPublic !== false,
    myRecipeId: data.authorDeleted === true ? '' : (data.myRecipeId || docSnap.id),
    createdAt: timestampToIso(data.createdAt) || nowIso(),
    updatedAt: timestampToIso(data.updatedAt) || nowIso(),
    publishedAt: timestampToIso(data.publishedAt) || timestampToIso(data.createdAt) || nowIso(),
    _homeLite: Boolean(lite),
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
    const perfPath = 'publicRecipes?isPublic==true';
    const syncStartMs = StartupPerf.begin('publicRecipes fetch complete', perfPath);
    StartupPerf.markListener(perfPath);
    snapshotUnsubscribe = onSnapshot(
      col,
      (snap) => {
        // 홈 추천용 lite 매핑 — steps/memo는 상세 진입 시 getById로 채움
        // 추천 계산은 renderHome에서 별도 계측
        const items = snap.docs.map((docSnap) => mapPublicRecipe(docSnap, { lite: true })).sort(
          (a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''),
        );
        StartupPerf.end('publicRecipes fetch complete', {
          documentCount: items.length,
          firestorePath: `${perfPath} (lite:no-steps-in-memory)`,
          startMs: syncStartMs,
        });
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

  async getById(recipeId) {
    const ref = publicRecipeDoc(recipeId);
    if (!ref) return null;
    const snap = await getDoc(ref);
    if (!snap.exists()) return null;
    const recipe = mapPublicRecipe(snap, { lite: false });
    return recipe.isPublic === false ? null : recipe;
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
