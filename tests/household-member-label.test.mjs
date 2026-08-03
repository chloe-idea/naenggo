import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { buildMemberPublicFields } from '../server/lib/household-service.js';

describe('buildMemberPublicFields', () => {
  it('prefers nickname over profileId/username for label', () => {
    const fields = buildMemberPublicFields(
      { username: 'chloe123', nickname: 'Chloe', displayName: 'Display' },
      {},
    );
    assert.equal(fields.profileId, 'chloe123');
    assert.equal(fields.username, 'chloe123');
    assert.equal(fields.nickname, 'Chloe');
    assert.equal(fields.displayName, 'Display');
    assert.equal(fields.label, 'Chloe');
  });

  it('falls back to displayName as nickname when nickname missing', () => {
    const fields = buildMemberPublicFields(
      { displayName: '닉네임유저' },
      {},
    );
    assert.equal(fields.nickname, '닉네임유저');
    assert.equal(fields.displayName, '닉네임유저');
    assert.equal(fields.label, '닉네임유저');
  });

  it('prefers users.nickname over publicProfiles fields', () => {
    const fields = buildMemberPublicFields(
      { nickname: '공개닉', displayName: '공개이름' },
      { nickname: '별명' },
    );
    assert.equal(fields.nickname, '별명');
    assert.equal(fields.label, '별명');
  });

  it('uses email local part only for label, never returns email', () => {
    const fields = buildMemberPublicFields({}, { email: 'hello@example.com' });
    assert.equal(fields.label, 'hello');
    assert.equal(fields.displayName, '');
    assert.equal('email' in fields, false);
  });

  it('reads photoURL from public profile image fields', () => {
    const fields = buildMemberPublicFields(
      { profileImageUrl: 'https://example.com/a.png' },
      {},
    );
    assert.equal(fields.photoURL, 'https://example.com/a.png');
  });
});
