#!/usr/bin/env node
/**
 * recipe-collage-tiles.json 기준으로 src/data/recipes.json 에 slug 를 부여하고
 * 없는 레시피는 추가합니다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'src/data/recipes.json');
const TILES_PATH = path.join(__dirname, 'recipe-collage-tiles.json');

const tiles = JSON.parse(fs.readFileSync(TILES_PATH, 'utf8'));

const MISSING_RECIPES = {
  '참치주먹밥': {
    id: 'tuna-rice-ball',
    slug: 'tuna-rice-ball',
    title: '참치주먹밥',
    cuisine: '한식',
    category: 'korean',
    dishType: 'rice-bowl',
    cookingTime: 8,
    difficulty: '쉬움',
    calories: 360,
    ingredients: ['밥', '참치', '간장', '참기름', '김'],
    instructions: ['참치와 밥을 섞어 주먹밥으로 만듭니다.'],
    tags: ['한식'],
    substitutions: [],
  },
};

function loadPayload() {
  const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  return Array.isArray(raw) ? { version: 1, recipes: raw } : raw;
}

function main() {
  const payload = loadPayload();
  const recipes = payload.recipes || [];
  const byTitle = new Map(recipes.map((r) => [r.title, r]));
  let slugCount = 0;

  tiles.forEach((tile) => {
    const recipe = byTitle.get(tile.name);
    if (recipe) {
      if (recipe.slug !== tile.slug) {
        recipe.slug = tile.slug;
        recipe.id = recipe.id || tile.slug;
        slugCount += 1;
      }
      return;
    }
    const extra = MISSING_RECIPES[tile.name];
    if (!extra) {
      console.warn(`정의 없음: ${tile.name}`);
      return;
    }
    recipes.push({ image: null, ...extra });
    byTitle.set(tile.name, extra);
    console.log(`추가: ${tile.name} (${extra.slug})`);
  });

  payload.recipes = recipes;
  payload.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`완료: slug ${slugCount}개 갱신, 총 ${recipes.length}개 레시피`);
  console.log('다음: npm run build:recipes');
}

main();
