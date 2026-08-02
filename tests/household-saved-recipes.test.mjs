import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  normalizeSavedByMembers,
  recipeIdsSavedByUid,
} from '../server/lib/household-saved-recipes.js';

describe('normalizeSavedByMembers', () => {
  it('merges savedByMembers and legacy savedBy by uid', () => {
    const result = normalizeSavedByMembers({
      savedByMembers: [{ uid: 'a', name: 'A' }],
      savedBy: 'b',
      savedByName: 'B',
    });
    assert.deepEqual(result.map((m) => m.uid), ['a', 'b']);
  });

  it('dedupes uid and ignores empty', () => {
    const result = normalizeSavedByMembers({
      savedByMembers: [
        { uid: 'a', name: 'A1' },
        { uid: 'a', name: 'A2' },
        { uid: '', name: 'x' },
      ],
      savedBy: 'a',
      savedByName: 'Legacy',
    });
    assert.equal(result.length, 1);
    assert.equal(result[0].uid, 'a');
    assert.equal(result[0].name, 'A1');
  });
});

describe('inactive filter semantics', () => {
  it('keeps only active member uids', () => {
    const active = new Set(['owner', 'b']);
    const members = normalizeSavedByMembers({
      savedByMembers: [
        { uid: 'owner', name: 'Owner' },
        { uid: 'a', name: 'Left' },
        { uid: 'b', name: 'B' },
      ],
    });
    const remaining = members.filter((m) => active.has(m.uid));
    assert.deepEqual(remaining.map((m) => m.uid), ['owner', 'b']);
  });
});

describe('recipeIdsSavedByUid', () => {
  it('returns only recipe ids saved by the given uid', () => {
    const docs = [
      {
        id: 'r1',
        data: () => ({ savedByMembers: [{ uid: 'me', name: 'Me' }, { uid: 'other', name: 'O' }] }),
      },
      {
        id: 'r2',
        data: () => ({ savedByMembers: [{ uid: 'other', name: 'O' }] }),
      },
      {
        id: 'r3',
        data: () => ({ savedBy: 'me', savedByName: 'Me' }),
      },
    ];
    assert.deepEqual(recipeIdsSavedByUid(docs, 'me'), ['r1', 'r3']);
  });

  it('ignores empty uid and empty docs', () => {
    assert.deepEqual(recipeIdsSavedByUid([], 'me'), []);
    assert.deepEqual(recipeIdsSavedByUid([{ id: 'r1', data: () => ({}) }], ''), []);
  });
});
