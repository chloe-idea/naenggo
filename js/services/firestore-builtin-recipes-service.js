/**
 * builtinRecipes/{recipeKey} — 운영자 관리 기본 레시피
 * builtinRecipeTombstones/{recipeKey} — 번들 레시피 삭제 표시
 */
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  onSnapshot,
  serverTimestamp,
} from 'https://www.gstatic.com/firebasejs/12.15.0/firebase-firestore.js';
import { db } from '../firebase.js';
import { sanitizeFirestorePayload } from './firestore-payload.js';
import { runFirestoreWrite } from './firestore-debug.js';

const RECIPES_COLLECTION = 'builtinRecipes';
const TOMBSTONES_COLLECTION = 'builtinRecipeTombstones';

let recipesUnsubscribe = null;
let tombstonesUnsubscribe = null;

function recipeDocRef(recipeKey) {
  return doc(db, RECIPES_COLLECTION, recipeKey);
}

function tombstoneDocRef(recipeKey) {
  return doc(db, TOMBSTONES_COLLECTION, recipeKey);
}

function mapRecipeDoc(docSnap) {
  const data = docSnap.data() || {};
  return {
    ...data,
    id: data.id || docSnap.id,
    slug: data.slug || docSnap.id,
  };
}

function buildRecipePayload(raw) {
  const recipeKey = raw.slug || raw.id;
  return {
    id: recipeKey,
    slug: recipeKey,
    title: raw.title || raw.name || '',
    image: raw.image || null,
    cuisine: raw.cuisine || '',
    category: raw.category || 'korean',
    dishType: raw.dishType || 'default',
    ingredients: Array.isArray(raw.ingredients) ? raw.ingredients : [],
    cookingTime: Number(raw.cookingTime ?? raw.cookTime) || 15,
    difficulty: raw.difficulty || '쉬움',
    calories: raw.calories ?? null,
    instructions: Array.isArray(raw.instructions) ? raw.instructions : (raw.steps || []),
    tags: Array.isArray(raw.tags) ? raw.tags : [],
    substitutions: Array.isArray(raw.substitutions) ? raw.substitutions : [],
    hidden: raw.hidden === true,
    updatedAt: serverTimestamp(),
  };
}

export const FirestoreBuiltinRecipesService = {
  stopSync() {
    if (recipesUnsubscribe) {
      recipesUnsubscribe();
      recipesUnsubscribe = null;
    }
    if (tombstonesUnsubscribe) {
      tombstonesUnsubscribe();
      tombstonesUnsubscribe = null;
    }
  },

  startSync(onChange, onError) {
    this.stopSync();
    if (!db) return;

    let recipes = [];
    let tombstones = [];

    const emit = () => {
      onChange?.({
        recipes: recipes.filter((item) => !item.hidden),
        tombstones: tombstones.map((item) => item.id),
      });
    };

    recipesUnsubscribe = onSnapshot(
      collection(db, RECIPES_COLLECTION),
      (snap) => {
        recipes = snap.docs.map(mapRecipeDoc);
        emit();
      },
      (err) => onError?.(err),
    );

    tombstonesUnsubscribe = onSnapshot(
      collection(db, TOMBSTONES_COLLECTION),
      (snap) => {
        tombstones = snap.docs.map((docSnap) => ({ id: docSnap.id, ...docSnap.data() }));
        emit();
      },
      (err) => onError?.(err),
    );
  },

  async saveRecipe(raw, uid) {
    if (!db) throw new Error('Firestore를 사용할 수 없습니다.');
    const recipeKey = String(raw.slug || raw.id || '').trim();
    if (!recipeKey) throw new Error('레시피 slug가 필요합니다.');
    const path = `${RECIPES_COLLECTION}/${recipeKey}`;
    const payload = buildRecipePayload({ ...raw, slug: recipeKey, id: recipeKey });
    await runFirestoreWrite(
      'builtinRecipes.setDoc',
      uid,
      path,
      () => setDoc(
        recipeDocRef(recipeKey),
        sanitizeFirestorePayload(payload, 'FirestoreBuiltinRecipesService.saveRecipe'),
        { merge: true },
      ),
      { recipeKey },
    );
    await this.removeTombstone(recipeKey, uid);
    return recipeKey;
  },

  async removeRecipe(recipeKey, uid) {
    if (!db || !recipeKey) return;
    const path = `${RECIPES_COLLECTION}/${recipeKey}`;
    await runFirestoreWrite(
      'builtinRecipes.deleteDoc',
      uid,
      path,
      () => deleteDoc(recipeDocRef(recipeKey)),
      { recipeKey },
    );
  },

  async addTombstone(recipeKey, uid) {
    if (!db || !recipeKey) return;
    const path = `${TOMBSTONES_COLLECTION}/${recipeKey}`;
    await runFirestoreWrite(
      'builtinRecipeTombstones.setDoc',
      uid,
      path,
      () => setDoc(tombstoneDocRef(recipeKey), {
        removed: true,
        removedAt: serverTimestamp(),
      }, { merge: true }),
      { recipeKey },
    );
  },

  async removeTombstone(recipeKey, uid) {
    if (!db || !recipeKey) return;
    const path = `${TOMBSTONES_COLLECTION}/${recipeKey}`;
    await runFirestoreWrite(
      'builtinRecipeTombstones.deleteDoc',
      uid,
      path,
      () => deleteDoc(tombstoneDocRef(recipeKey)),
      { recipeKey },
    );
  },
};
