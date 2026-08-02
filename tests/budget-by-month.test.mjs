import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  budgetForMonth,
  normalizeBudgetByMonth,
  resolveBudgetByMonthFromSettings,
  toMonthKey,
} from '../js/lib/budget-by-month.js';

describe('budgetByMonth helpers', () => {
  it('builds YYYY-MM keys', () => {
    assert.equal(toMonthKey(2026, 6), '2026-07');
    assert.equal(toMonthKey(2026, 7), '2026-08');
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

  it('migrates legacy monthlyFoodBudget into fallback month once', () => {
    const { budgetByMonth, migrated } = resolveBudgetByMonthFromSettings(
      { monthlyFoodBudget: 300000 },
      '2026-08',
    );
    assert.equal(migrated, true);
    assert.deepEqual(budgetByMonth, { '2026-08': 300000 });
  });

  it('does not migrate when budgetByMonth already exists', () => {
    const { budgetByMonth, migrated } = resolveBudgetByMonthFromSettings({
      monthlyFoodBudget: 999,
      budgetByMonth: { '2026-07': 300000, '2026-08': 100000 },
    }, '2026-08');
    assert.equal(migrated, false);
    assert.equal(budgetForMonth(budgetByMonth, '2026-07'), 300000);
    assert.equal(budgetForMonth(budgetByMonth, '2026-08'), 100000);
    assert.equal(budgetForMonth(budgetByMonth, '2026-09'), 0);
  });
});
