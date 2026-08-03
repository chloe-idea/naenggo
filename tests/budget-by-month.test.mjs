import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  budgetForMonth,
  getMonthKey,
  normalizeBudgetByMonth,
  resolveBudgetByMonthFromSettings,
  toMonthKey,
} from '../js/lib/budget-by-month.js';

describe('budgetByMonth helpers', () => {
  it('builds YYYY-MM keys from 0-based month index', () => {
    assert.equal(toMonthKey(2026, 6), '2026-07');
    assert.equal(toMonthKey(2026, 7), '2026-08');
    assert.equal(getMonthKey(new Date(2026, 6, 15)), '2026-07');
  });

  it('normalizes only valid month keys', () => {
    const map = normalizeBudgetByMonth({
      '2026-07': 300000,
      '2026-08': '100000',
      bad: 1,
      '2026-13': 2,
    });
    assert.deepEqual(map, { '2026-07': 300000, '2026-08': 100000 });
  });

  it('plans legacy migration without injecting client map keys', () => {
    const { budgetByMonth, migrated, migrationMap } = resolveBudgetByMonthFromSettings(
      { monthlyFoodBudget: 300000 },
      '2026-08',
    );
    assert.equal(migrated, true);
    assert.deepEqual(budgetByMonth, {});
    assert.deepEqual(migrationMap, { '2026-08': 300000 });
  });

  it('does not migrate when budgetByMonth already exists', () => {
    const { budgetByMonth, migrated, migrationMap } = resolveBudgetByMonthFromSettings({
      monthlyFoodBudget: 999,
      budgetByMonth: { '2026-07': 300000, '2026-08': 100000 },
    }, '2026-08');
    assert.equal(migrated, false);
    assert.equal(migrationMap, null);
    assert.equal(budgetForMonth(budgetByMonth, '2026-07'), 300000);
    assert.equal(budgetForMonth(budgetByMonth, '2026-08'), 100000);
    assert.equal(budgetForMonth(budgetByMonth, '2026-09'), 0);
  });

  it('applies legacy fallback only for the specified month', () => {
    assert.equal(
      budgetForMonth({}, '2026-08', { legacyMonthly: 300000, legacyOnlyForMonthKey: '2026-08' }),
      300000,
    );
    assert.equal(
      budgetForMonth({}, '2026-07', { legacyMonthly: 300000, legacyOnlyForMonthKey: '2026-08' }),
      0,
    );
  });
});
