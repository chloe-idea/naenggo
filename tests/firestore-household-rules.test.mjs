import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test, { after, beforeEach } from 'node:test';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';
import {
  Timestamp,
  deleteDoc,
  doc,
  getDoc,
  setDoc,
} from 'firebase/firestore';

const rules = readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8');
const projectId = 'naenggo-household-rules-test';
const householdId = 'household-a';
let testEnv;

function ingredient(name = '감자') {
  const now = Timestamp.now();
  return {
    name,
    quantity: '2',
    expiryDate: '2026-08-01',
    createdAt: now,
    updatedAt: now,
  };
}

beforeEach(async () => {
  if (!testEnv) {
    testEnv = await initializeTestEnvironment({
      projectId,
      firestore: { rules },
    });
  }
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'households', householdId), {
      name: '우리 가족',
      ownerId: 'owner',
      status: 'active',
      schemaVersion: 1,
    });
    await setDoc(doc(db, 'households', householdId, 'members', 'owner'), {
      uid: 'owner',
      role: 'owner',
      joinedAt: Timestamp.now(),
      joinedBy: 'owner',
    });
    await setDoc(doc(db, 'households', householdId, 'members', 'member'), {
      uid: 'member',
      role: 'member',
      joinedAt: Timestamp.now(),
      joinedBy: 'owner',
    });
    await setDoc(doc(db, 'households', householdId, 'ingredients', 'existing'), ingredient());
  });
});

after(async () => {
  await testEnv?.cleanup();
});

test('household member can read and create a valid ingredient', async () => {
  const db = testEnv.authenticatedContext('member').firestore();
  await assertSucceeds(getDoc(doc(db, 'households', householdId, 'ingredients', 'existing')));
  await assertSucceeds(setDoc(doc(db, 'households', householdId, 'ingredients', 'new'), ingredient('양파')));
});

test('owner and member see each other’s household ingredients', async () => {
  const ownerDb = testEnv.authenticatedContext('owner').firestore();
  const memberDb = testEnv.authenticatedContext('member').firestore();
  const onion = doc(ownerDb, 'households', householdId, 'ingredients', 'onion');
  const egg = doc(memberDb, 'households', householdId, 'ingredients', 'egg');

  await assertSucceeds(setDoc(onion, ingredient('양파')));
  await assertSucceeds(getDoc(doc(memberDb, 'households', householdId, 'ingredients', 'onion')));
  await assertSucceeds(setDoc(egg, ingredient('계란')));
  await assertSucceeds(getDoc(doc(ownerDb, 'households', householdId, 'ingredients', 'egg')));
});

test('non-member cannot read or write household data', async () => {
  const db = testEnv.authenticatedContext('outsider').firestore();
  await assertFails(getDoc(doc(db, 'households', householdId, 'ingredients', 'existing')));
  await assertFails(setDoc(doc(db, 'households', householdId, 'ingredients', 'new'), ingredient()));
});

test('member cannot create malformed ingredient or rewrite createdAt', async () => {
  const db = testEnv.authenticatedContext('member').firestore();
  await assertFails(setDoc(doc(db, 'households', householdId, 'ingredients', 'malformed'), {
    ...ingredient(),
    name: '',
  }));
  await assertFails(setDoc(doc(db, 'households', householdId, 'ingredients', 'existing'), {
    ...ingredient('고구마'),
    createdAt: Timestamp.now(),
  }));
});

test('client cannot create membership, alter household, or read invites', async () => {
  const memberDb = testEnv.authenticatedContext('member').firestore();
  const ownerDb = testEnv.authenticatedContext('owner').firestore();
  await assertFails(setDoc(doc(memberDb, 'households', householdId, 'members', 'member'), {
    uid: 'member',
    role: 'owner',
    joinedAt: Timestamp.now(),
  }));
  await assertFails(setDoc(doc(ownerDb, 'households', householdId), {
    name: '바뀐 이름',
  }, { merge: true }));
  await assertFails(getDoc(doc(memberDb, 'householdInvites', 'secret-invite')));
});

test('members manage their saved recipe member list', async () => {
  const db = testEnv.authenticatedContext('member').firestore();
  const ref = doc(db, 'households', householdId, 'savedRecipes', 'recipe-a');
  await assertSucceeds(setDoc(ref, {
    recipeId: 'recipe-a',
    savedByMembers: [{ uid: 'member', name: '구성원', savedAt: Timestamp.now() }],
  }));
  await assertFails(deleteDoc(doc(testEnv.authenticatedContext('outsider').firestore(), 'households', householdId, 'savedRecipes', 'recipe-a')));
  await assertSucceeds(setDoc(ref, {
    recipeId: 'recipe-a',
    savedByMembers: [
      { uid: 'member', name: '구성원', savedAt: Timestamp.now() },
      { uid: 'owner', name: '관리자', savedAt: Timestamp.now() },
    ],
  }, { merge: true }));
});

test('legacy personal paths remain available only to their owner', async () => {
  const ownerDb = testEnv.authenticatedContext('owner').firestore();
  const otherDb = testEnv.authenticatedContext('member').firestore();
  const ref = doc(ownerDb, 'users', 'owner', 'ingredients', 'personal');
  await assertSucceeds(setDoc(ref, { name: '개인 재료' }));
  await assertFails(getDoc(doc(otherDb, 'users', 'owner', 'ingredients', 'personal')));
  assert.ok(true);
});

test('personal recipes remain private from household members', async () => {
  const ownerDb = testEnv.authenticatedContext('owner').firestore();
  const memberDb = testEnv.authenticatedContext('member').firestore();
  const recipe = doc(ownerDb, 'users', 'owner', 'myRecipes', 'personal-recipe');

  await assertSucceeds(setDoc(recipe, {
    name: '개인 레시피',
    ownerId: 'owner',
    authorId: 'owner',
  }));
  await assertFails(getDoc(doc(memberDb, 'users', 'owner', 'myRecipes', 'personal-recipe')));
});
