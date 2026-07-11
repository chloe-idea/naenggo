#!/usr/bin/env node
/**
 * src/data/recipes.json → js/data/builtin-recipes.js 생성
 * 사용법: npm run build:recipes
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'src/data/recipes.json');
const OUT_PATH = path.join(ROOT, 'js/data/builtin-recipes.js');
const PUBLIC_JSON_PATH = path.join(ROOT, 'public/data/recipes.json');

function main() {
  if (!fs.existsSync(JSON_PATH)) {
    throw new Error(`레시피 데이터를 찾을 수 없습니다: ${JSON_PATH}`);
  }

  const payload = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  const recipes = Array.isArray(payload) ? payload : payload.recipes || [];

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.mkdirSync(path.dirname(PUBLIC_JSON_PATH), { recursive: true });

  const header = `/**
 * 자동 생성 — 직접 수정하지 마세요.
 * 원본: src/data/recipes.json
 * 재생성: npm run build:recipes
 */
window.BUILTIN_RECIPE_RAW = `;

  fs.writeFileSync(OUT_PATH, `${header}${JSON.stringify(recipes, null, 2)};\n`, 'utf8');
  fs.writeFileSync(PUBLIC_JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`생성 완료: ${recipes.length}개`);
  console.log(`  → ${OUT_PATH}`);
  console.log(`  → ${PUBLIC_JSON_PATH}`);
}

main();
