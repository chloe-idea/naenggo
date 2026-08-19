#!/usr/bin/env node
/**
 * 레시피 JSON → js/data/builtin-recipes.js 생성
 * 사용법: npm run build:recipes
 *
 * Source of truth (우선순위):
 *   1) src/data/recipes_v5_beginner_friendly.json
 *   2) src/data/recipes_v6_instructions_only.json (레거시)
 *   3) src/data/recipes.json / recipes_v5_qa_complete.json
 *   4) src/data/backups/* (삭제하지 않은 백업)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const CANDIDATES = [
  path.join(ROOT, 'src/data/recipes_v5_beginner_friendly.json'),
  path.join(ROOT, 'src/data/recipes_v6_instructions_only.json'),
  path.join(ROOT, 'src/data/recipes.json'),
  path.join(ROOT, 'src/data/recipes_v5_qa_complete.json'),
  path.join(ROOT, 'src/data/backups/recipes_v5_beginner_friendly.json'),
  path.join(ROOT, 'src/data/backups/recipes_v6_instructions_only.json'),
  path.join(ROOT, 'src/data/backups/recipes_v5_qa_complete.json'),
  path.join(ROOT, 'src/data/backups/recipes.json'),
];
const OUT_PATH = path.join(ROOT, 'js/data/builtin-recipes.js');
const PUBLIC_JSON_PATH = path.join(ROOT, 'public/data/recipes.json');

function main() {
  const JSON_PATH = CANDIDATES.find((p) => fs.existsSync(p));
  if (!JSON_PATH) {
    throw new Error(`레시피 데이터를 찾을 수 없습니다:\n${CANDIDATES.map((p) => `  - ${p}`).join('\n')}`);
  }

  const payload = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const recipes = Array.isArray(payload) ? payload : payload.recipes || [];

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(PUBLIC_JSON_PATH), { recursive: true });

  const relSource = path.relative(ROOT, JSON_PATH);
  const header = `/**
 * 자동 생성 — 직접 수정하지 마세요.
 * 원본: ${relSource}
 * 재생성: npm run build:recipes
 */
window.BUILTIN_RECIPE_RAW = `;

  fs.writeFileSync(OUT_PATH, `${header}${JSON.stringify(recipes, null, 2)};\n`, 'utf8');
  fs.writeFileSync(PUBLIC_JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`생성 완료: ${recipes.length}개`);
  console.log(`  ← ${relSource}`);
  console.log(`  → ${OUT_PATH}`);
  console.log(`  → ${PUBLIC_JSON_PATH}`);
}

main();
