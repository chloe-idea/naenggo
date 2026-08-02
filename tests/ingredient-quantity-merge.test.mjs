import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

/** 클라이언트/서버 merge와 동일한 계약 (자동 1 금지) */
function parseIngredientQuantity(value) {
  if (value == null) return null;
  if (typeof value === 'number') {
    return Number.isFinite(value) && value >= 0 ? value : null;
  }
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'nan') return null;
  const quantity = Number.parseFloat(raw);
  return Number.isFinite(quantity) && quantity >= 0 ? quantity : null;
}

function normalizeQuantityForStorage(value) {
  const parsed = parseIngredientQuantity(value);
  if (parsed != null) {
    return Number.isInteger(parsed) ? String(parsed) : String(parsed);
  }
  if (value == null) return '';
  const raw = String(value).trim();
  if (!raw || raw.toLowerCase() === 'nan') return '';
  return raw;
}

function mergeQuantityValues(...values) {
  const numeric = values.map(parseIngredientQuantity).filter((n) => n != null);
  if (numeric.length) {
    const total = numeric.reduce((sum, n) => sum + n, 0);
    return Number.isInteger(total) ? String(total) : String(total);
  }
  for (const value of values) {
    const stored = normalizeQuantityForStorage(value);
    if (stored) return stored;
  }
  return '';
}

describe('ingredient quantity merge (no default 1)', () => {
  it('treats empty/null/undefined/NaN as unset', () => {
    assert.equal(parseIngredientQuantity(''), null);
    assert.equal(parseIngredientQuantity(null), null);
    assert.equal(parseIngredientQuantity(undefined), null);
    assert.equal(parseIngredientQuantity(Number.NaN), null);
    assert.equal(parseIngredientQuantity('nan'), null);
    assert.equal(normalizeQuantityForStorage(''), '');
    assert.equal(normalizeQuantityForStorage(null), '');
    assert.equal(normalizeQuantityForStorage(undefined), '');
  });

  it('keeps explicit 1 and other numbers', () => {
    assert.equal(normalizeQuantityForStorage('1'), '1');
    assert.equal(normalizeQuantityForStorage(1), '1');
    assert.equal(normalizeQuantityForStorage('2'), '2');
    assert.equal(normalizeQuantityForStorage('1.5'), '1.5');
  });

  it('merges unset + unset to empty string, not 1', () => {
    assert.equal(mergeQuantityValues('', ''), '');
    assert.equal(mergeQuantityValues(null, undefined), '');
  });

  it('merges unset + explicit without inventing 1', () => {
    assert.equal(mergeQuantityValues('', '1'), '1');
    assert.equal(mergeQuantityValues('2', ''), '2');
    assert.equal(mergeQuantityValues('2', '1'), '3');
  });
});
