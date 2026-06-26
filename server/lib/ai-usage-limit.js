import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_DIR = process.env.VERCEL
  ? path.join('/tmp', 'naengjanggo-ai-usage')
  : path.join(__dirname, '../data');
const DATA_FILE = path.join(DATA_DIR, 'ai-usage.json');
const TIMEZONE = process.env.AI_USAGE_TIMEZONE || 'Asia/Seoul';

export function getDailyLimit() {
  return Math.max(1, Number(process.env.AI_DAILY_LIMIT) || 5);
}

export function getTodayDateKey(date = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TIMEZONE }).format(date);
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

export function getAiUsage(userId) {
  const limit = getDailyLimit();
  const today = getTodayDateKey();
  const store = loadStore();
  const record = store[userId];

  if (!record || record.date !== today) {
    return { used: 0, remaining: limit, limit, date: today };
  }

  const used = Math.max(0, Number(record.count) || 0);
  return {
    used,
    remaining: Math.max(0, limit - used),
    limit,
    date: today,
  };
}

export function assertCanUseAi(userId) {
  const usage = getAiUsage(userId);
  if (usage.used >= usage.limit) {
    const err = new Error('오늘 무료 AI 분석 5회를 모두 사용했습니다.');
    err.code = 'DAILY_LIMIT_EXCEEDED';
    err.aiUsage = usage;
    throw err;
  }
  return usage;
}

export function recordAiUsage(userId) {
  const limit = getDailyLimit();
  const today = getTodayDateKey();
  const store = loadStore();
  const prev = store[userId];

  const record = !prev || prev.date !== today
    ? { date: today, count: 1 }
    : { date: today, count: (Number(prev.count) || 0) + 1 };

  store[userId] = record;
  saveStore(store);

  const used = record.count;
  return {
    used,
    remaining: Math.max(0, limit - used),
    limit,
    date: today,
  };
}
