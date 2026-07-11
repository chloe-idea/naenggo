#!/usr/bin/env node
/**
 * recipes-builtin.js → src/data/recipes.json 마이그레이션
 * 사용법: node scripts/migrate-builtin-to-json.mjs
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const LEGACY_PATH = path.join(ROOT, 'recipes-builtin.js');
const OUT_PATH = path.join(ROOT, 'src/data/recipes.json');

const CATEGORY_TO_CUISINE = {
  korean: '한식',
  western: '양식',
  japanese: '일식',
  chinese: '중식',
  thai: '태국',
  vietnamese: '베트남',
  diet: '한식',
  'high-protein': '한식',
  other: '기타',
};

const REMOVE_NAMES = new Set(['계란프라이']);
const REMOVE_SLUGS = new Set(['egg-fry', 'fried-egg', 'egg-fried']);

function slugify(name) {
  return String(name || '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9가-힣-]/g, '')
    .replace(/[가-힣]/g, '');
}

function inferSlug(recipe, index) {
  if (recipe.slug) return recipe.slug;
  const fromName = slugify(recipe.name);
  if (fromName && /^[a-z0-9-]+$/.test(fromName)) return fromName;
  return `recipe-${index + 1}`;
}

function loadLegacy() {
  const src = fs.readFileSync(LEGACY_PATH, 'utf8');
  const match = src.match(/window\.BUILTIN_RECIPE_RAW\s*=\s*(\[[\s\S]*\])\s*;/);
  if (!match) throw new Error('BUILTIN_RECIPE_RAW not found');
  // eslint-disable-next-line no-eval
  return eval(match[1]);
}

function toRecipeRecord(raw, index) {
  const slug = inferSlug(raw, index);
  const category = raw.category || 'korean';
  const cuisine = raw.cuisine || CATEGORY_TO_CUISINE[category] || '기타';
  const tags = Array.isArray(raw.tags) && raw.tags.length
    ? raw.tags
    : [cuisine];

  return {
    id: slug,
    slug,
    title: raw.title || raw.name,
    image: raw.image || null,
    cuisine,
    category,
    dishType: raw.dishType || 'default',
    ingredients: raw.ingredients || [],
    cookingTime: raw.cookingTime ?? raw.cookTime ?? 15,
    difficulty: raw.difficulty || '쉬움',
    calories: raw.calories ?? null,
    instructions: raw.instructions || raw.steps || [],
    tags,
    substitutions: raw.substitutions || raw.ingredientSubstitutes || [],
  };
}

const THAI_RECIPES = [
  { id: 'pad-thai', slug: 'pad-thai', title: '팟타이', cuisine: '태국', category: 'thai', dishType: 'noodle', cookingTime: 20, difficulty: '보통', calories: 480, ingredients: ['쌀국수', '새우', '계란', '숙주', '땅콩', '라임', '팜설탕', '타마린드'], instructions: ['면을 불립니다.', '팬에 재료를 볶고 소스를 넣습니다.', '면과 함께 볶아 완성합니다.'], tags: ['태국', '면요리'] },
  { id: 'pad-kra-pao', slug: 'pad-kra-pao', title: '팟카파오', cuisine: '태국', category: 'thai', dishType: 'stir-fry', cookingTime: 15, difficulty: '쉬움', calories: 420, ingredients: ['돼지고기', '홍고추', '마늘', '바질', '밥', '간장', '설탕'], instructions: ['고기와 마늘·고추를 볶습니다.', '바질과 양념을 넣습니다.', '밥과 함께 담아 완성합니다.'], tags: ['태국', '볶음'] },
  { id: 'tom-yum-goong', slug: 'tom-yum-goong', title: '똠얌꿍', cuisine: '태국', category: 'thai', dishType: 'soup', cookingTime: 25, difficulty: '보통', calories: 280, ingredients: ['새우', '레몬그라스', '갈랑가', '라임잎', '고추', '버섯', '타마린드'], instructions: ['육수에 향신채를 넣고 끓입니다.', '새우와 버섯을 넣습니다.', '라임즙으로 맛을 맞춥니다.'], tags: ['태국', '국물'] },
  { id: 'yum-woon-sen', slug: 'yum-woon-sen', title: '얌운센', cuisine: '태국', category: 'thai', dishType: 'salad', cookingTime: 15, difficulty: '쉬움', calories: 220, ingredients: ['당면', '새우', '양파', '토마토', '라임', '고추', '설탕', '생선소스'], instructions: ['당면을 삶습니다.', '새우와 채소를 넣고 무칩니다.', '라임 드레싱으로 완성합니다.'], tags: ['태국', '샐러드'] },
  { id: 'som-tam', slug: 'som-tam', title: '쏨땀', cuisine: '태국', category: 'thai', dishType: 'salad', cookingTime: 10, difficulty: '쉬움', calories: 180, ingredients: ['파파야', '토마토', '땅콩', '라임', '생선소스', '설탕', '고추', '마늘'], instructions: ['파파야를 채 썹니다.', '양념과 함께 무칩니다.', '땅콩을 올려 완성합니다.'], tags: ['태국', '샐러드'] },
  { id: 'green-curry', slug: 'green-curry', title: '그린커리', cuisine: '태국', category: 'thai', dishType: 'stew', cookingTime: 25, difficulty: '보통', calories: 380, ingredients: ['닭고기', '그린커리페이스트', '코코넛밀크', '가지', '홍고추', '바질', '밥'], instructions: ['커리페이스트를 볶습니다.', '코코넛밀크와 닭고기를 넣고 끓입니다.', '채소와 바질을 넣어 완성합니다.'], tags: ['태국', '커리'] },
  { id: 'khao-pad', slug: 'khao-pad', title: '카오팟', cuisine: '태국', category: 'thai', dishType: 'fried-rice', cookingTime: 12, difficulty: '쉬움', calories: 450, ingredients: ['밥', '계란', '양파', '대파', '생선소스', '설탕', '라임'], instructions: ['계란을 볶습니다.', '밥과 양념을 넣고 볶습니다.', '라임을 곁들여 완성합니다.'], tags: ['태국', '볶음밥'] },
  { id: 'thai-basil-chicken', slug: 'thai-basil-chicken', title: '태국식 바질 치킨', cuisine: '태국', category: 'thai', dishType: 'stir-fry', cookingTime: 15, difficulty: '쉬움', calories: 400, ingredients: ['닭고기', '홍고추', '마늘', '바질', '간장', '설탕', '밥'], instructions: ['닭고기를 볶습니다.', '양념과 바질을 넣습니다.', '밥과 함께 담아 완성합니다.'], tags: ['태국', '볶음'] },
];

const VIETNAMESE_RECIPES = [
  { id: 'pho', slug: 'pho', title: '쌀국수', cuisine: '베트남', category: 'vietnamese', dishType: 'noodle', cookingTime: 40, difficulty: '보통', calories: 420, ingredients: ['쌀국수', '소고기', '양파', '생강', '계피', '고수', '라임', '숙주'], instructions: ['육수를 끓입니다.', '면을 삶습니다.', '고명과 함께 담아 완성합니다.'], tags: ['베트남', '면요리'] },
  { id: 'bun-cha', slug: 'bun-cha', title: '분짜', cuisine: '베트남', category: 'vietnamese', dishType: 'default', cookingTime: 30, difficulty: '보통', calories: 480, ingredients: ['돼지고기', '쌀국수', '양파', '마늘', '설탕', '생선소스', '라임', '고수'], instructions: ['고기를 양념해 구웁니다.', '면을 삶습니다.', '소스와 함께 담아 완성합니다.'], tags: ['베트남'] },
  { id: 'banh-mi', slug: 'banh-mi', title: '반미', cuisine: '베트남', category: 'vietnamese', dishType: 'toast', cookingTime: 15, difficulty: '쉬움', calories: 380, ingredients: ['바게트', '돼지고기', '오이', '당근', '고수', '마요네즈', '간장'], instructions: ['빵을 토스팅합니다.', '속재료를 넣습니다.', '고기와 채소를 담아 완성합니다.'], tags: ['베트남', '샌드위치'] },
  { id: 'vietnamese-spring-rolls', slug: 'vietnamese-spring-rolls', title: '월남쌈', cuisine: '베트남', category: 'vietnamese', dishType: 'default', cookingTime: 20, difficulty: '쉬움', calories: 260, ingredients: ['라이스페이퍼', '새우', '돼지고기', '숙주', '상추', '고수', '라이스버미셀리'], instructions: ['재료를 준비합니다.', '라이스페이퍼에 싸듯 담습니다.', '소스와 함께 완성합니다.'], tags: ['베트남'] },
  { id: 'bun-bo-hue', slug: 'bun-bo-hue', title: '분보후에', cuisine: '베트남', category: 'vietnamese', dishType: 'noodle', cookingTime: 45, difficulty: '어려움', calories: 460, ingredients: ['쌀국수', '소고기', '돼지고기', '레몬그라스', '고추', '숙주', '라임'], instructions: ['매운 육수를 끓입니다.', '면을 삶습니다.', '고기와 채소를 올려 완성합니다.'], tags: ['베트남', '면요리'] },
  { id: 'vietnamese-fried-rice', slug: 'vietnamese-fried-rice', title: '베트남식 볶음밥', cuisine: '베트남', category: 'vietnamese', dishType: 'fried-rice', cookingTime: 12, difficulty: '쉬움', calories: 430, ingredients: ['밥', '계란', '새우', '양파', '완두콩', '생선소스', '설탕'], instructions: ['새우와 계란을 볶습니다.', '밥과 양념을 넣고 볶습니다.', '완성합니다.'], tags: ['베트남', '볶음밥'] },
  { id: 'lemongrass-chicken', slug: 'lemongrass-chicken', title: '레몬그라스 치킨', cuisine: '베트남', category: 'vietnamese', dishType: 'stir-fry', cookingTime: 20, difficulty: '보통', calories: 390, ingredients: ['닭고기', '레몬그라스', '마늘', '양파', '설탕', '생선소스', '밥'], instructions: ['레몬그라스와 닭고기를 볶습니다.', '양념을 넣고 익힙니다.', '밥과 함께 완성합니다.'], tags: ['베트남', '볶음'] },
];

function main() {
  const legacy = loadLegacy();
  const recipes = [];
  const seenSlugs = new Set();

  for (const raw of legacy) {
    const name = raw.name || raw.title || '';
    const slug = raw.slug || inferSlug(raw, recipes.length);
    if (REMOVE_NAMES.has(name) || REMOVE_SLUGS.has(slug)) {
      console.log(`제거: ${name} (${slug})`);
      continue;
    }
    const record = toRecipeRecord(raw, recipes.length);
    if (seenSlugs.has(record.slug)) {
      record.slug = `${record.slug}-${recipes.length + 1}`;
      record.id = record.slug;
    }
    seenSlugs.add(record.slug);
    recipes.push(record);
  }

  for (const extra of [...THAI_RECIPES, ...VIETNAMESE_RECIPES]) {
    if (seenSlugs.has(extra.slug)) continue;
    seenSlugs.add(extra.slug);
    recipes.push({ ...extra, image: null, substitutions: extra.substitutions || [] });
    console.log(`추가: ${extra.title} (${extra.slug})`);
  }

  const payload = {
    version: 1,
    updatedAt: new Date().toISOString().slice(0, 10),
    recipes,
  };

  fs.mkdirSync(path.dirname(OUT_PATH), { recursive: true });
  fs.writeFileSync(OUT_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`\n완료: ${recipes.length}개 → ${OUT_PATH}`);
}

main();
