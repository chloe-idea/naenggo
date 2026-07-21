import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  buildUsageDisplay,
  getWeeklyLimit,
  normalizeWeeklyUsageRecord,
} from './analysis-quota-core.js';
import { getCurrentWeekKey } from './analysis-week-key.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'naengjanggo-ai-usage')
  : path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'ai-usage.json');

export function getDailyLimit() {
  return getWeeklyLimit();
}

export function getTodayDateKey() {
  return getCurrentWeekKey();
}

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
    }
  } catch (err) {
    console.warn('[ai-usage] store read failed:', err.message);
  }
  return {};
}

function saveStore(store) {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2), 'utf8');
}

function normalizeGuestRecord(record) {
  if (!record || typeof record !== 'object') return {};

  if (record.weekKey || record.analysisQuotaWeekKey || record.weeklyUsageCount != null) {
    return {
      analysisQuotaWeekKey: record.analysisQuotaWeekKey || record.weekKey,
      analysisQuotaUsed: record.analysisQuotaUsed ?? record.weeklyUsageCount ?? record.count,
      freeAnalysisRemaining: record.freeAnalysisRemaining,
    };
  }

  if (record.date) {
    // 레거시 일간 카운트 → 새 주간 한도로 초기화
    return {};
  }

  return {
    freeAnalysisRemaining: record.remaining,
  };
}

export function getAiUsage(userId) {
  const store = loadStore();
  const record = normalizeGuestRecord(store[userId]);
  const normalized = normalizeWeeklyUsageRecord(record, getWeeklyLimit());
  return buildUsageDisplay(normalized, 'guest-server');
}

export function assertCanUseAi(userId) {
  const usage = getAiUsage(userId);
  if (usage.used >= usage.limit) {
    const err = new Error('이번 주 무료 AI 분석 5회를 모두 사용했습니다.');
    err.code = 'DAILY_LIMIT_EXCEEDED';
    err.aiUsage = usage;
    throw err;
  }
  return usage;
}

export function recordAiUsage(userId) {
  const store = loadStore();
  const record = normalizeGuestRecord(store[userId]);
  const normalized = normalizeWeeklyUsageRecord(record, getWeeklyLimit());

  if (normalized.used >= normalized.limit) {
    const err = new Error('이번 주 무료 AI 분석 5회를 모두 사용했습니다.');
    err.code = 'DAILY_LIMIT_EXCEEDED';
    err.aiUsage = buildUsageDisplay(normalized, 'guest-server');
    throw err;
  }

  const next = {
    ...normalized,
    weeklyUsageCount: normalized.weeklyUsageCount + 1,
  };
  next.used = next.weeklyUsageCount;
  next.remaining = Math.max(0, next.limit - next.used);

  store[userId] = {
    weekKey: next.currentWeekKey,
    analysisQuotaWeekKey: next.currentWeekKey,
    weeklyUsageCount: next.weeklyUsageCount,
    analysisQuotaUsed: next.weeklyUsageCount,
    count: next.weeklyUsageCount,
    remaining: next.remaining,
  };
  saveStore(store);

  return buildUsageDisplay(next, 'guest-server');
}
