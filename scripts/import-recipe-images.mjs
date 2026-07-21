#!/usr/bin/env node
/**
 * 다운로드 폴더의 레시피 webp → public/images/recipes/{slug}.webp
 * src/data/recipes.json image 필드 연결
 *
 * 사용법:
 *   node scripts/import-recipe-images.mjs [폴더1] [폴더2] ...
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { optimizeRecipeImage } from './optimize-recipe-image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const JSON_PATH = path.join(ROOT, 'src/data/recipes.json');
const MAP_PATH = path.join(__dirname, 'recipe-image-import-map.json');
const OUTPUT_DIR = path.join(ROOT, 'public/images/recipes');

const DEFAULT_SOURCE_DIRS = [
  '/Users/gyuheean/Downloads/noodle_mix_webp_6x3',
  '/Users/gyuheean/Downloads/noodles_webp_5x4',
  '/Users/gyuheean/Downloads/fried_rice_webp',
  '/Users/gyuheean/Downloads/rice_bowls_webp_5x4',
  '/Users/gyuheean/Downloads/side_dishes_webp_5x4',
  '/Users/gyuheean/Downloads/korean_soup_webp_6x3',
];

function normalizeTitle(title) {
  return String(title || '').replace(/\s+/g, '');
}

function loadPayload() {
  const raw = JSON.parse(fs.readFileSync(JSON_PATH, 'utf8'));
  return Array.isArray(raw) ? { version: 1, recipes: raw } : raw;
}

function collectSourceFiles(dirs) {
  const files = new Map();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) {
      console.warn(`[skip] 폴더 없음: ${dir}`);
      continue;
    }
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith('.webp')) continue;
      const base = name.replace(/\.webp$/, '');
      const full = path.join(dir, name);
      if (files.has(base)) {
        console.warn(`[dup] ${base}.webp — ${full} (기존: ${files.get(base)})`);
      }
      files.set(base, full);
    }
  }
  return files;
}

async function optimizeWebp(srcPath, destPath) {
  return optimizeRecipeImage(srcPath, destPath);
}

async function main() {
  const sourceDirs = process.argv.length > 2 ? process.argv.slice(2) : DEFAULT_SOURCE_DIRS;
  const titleMap = JSON.parse(fs.readFileSync(MAP_PATH, 'utf8'));
  const sourceFiles = collectSourceFiles(sourceDirs);
  const payload = loadPayload();
  const recipes = payload.recipes || [];
  const byTitle = new Map(recipes.map((r) => [normalizeTitle(r.title), r]));

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const imported = [];
  const unmappedFiles = [];
  const missingFiles = [];

  for (const [base, title] of Object.entries(titleMap)) {
    const src = sourceFiles.get(base);
    if (!src) {
      missingFiles.push({ file: `${base}.webp`, title });
      continue;
    }
    const recipe = byTitle.get(normalizeTitle(title));
    if (!recipe) {
      console.warn(`[warn] 레시피 없음: ${title} (${base})`);
      continue;
    }
    const slug = recipe.slug || recipe.id;
    const dest = path.join(OUTPUT_DIR, `${slug}.webp`);
    await optimizeWebp(src, dest);
    recipe.image = `images/recipes/${slug}.webp`;
    imported.push({ file: `${base}.webp`, title: recipe.title, slug });
  }

  for (const base of sourceFiles.keys()) {
    if (!titleMap[base]) unmappedFiles.push(`${base}.webp`);
  }

  payload.recipes = recipes;
  payload.updatedAt = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  // 기존 콜라주 등 slug.webp 파일이 있으면 image 필드 자동 연결
  let autoLinked = 0;
  for (const recipe of recipes) {
    if (recipe.image) continue;
    const slug = recipe.slug || recipe.id;
    if (!slug || String(slug).startsWith('recipe-')) continue;
    const file = `${slug}.webp`;
    if (!fs.existsSync(path.join(OUTPUT_DIR, file))) continue;
    recipe.image = `images/recipes/${file}`;
    autoLinked += 1;
  }
  if (autoLinked > 0) {
    fs.writeFileSync(JSON_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`기존 파일 자동 연결: ${autoLinked}개`);
  }

  const withImage = recipes.filter((r) => r.image?.startsWith('images/recipes/'));
  const withoutImage = recipes.filter((r) => !r.image?.startsWith('images/recipes/'));

  console.log(`\n=== import-recipe-images ===`);
  console.log(`복사·최적화: ${imported.length}개`);
  console.log(`recipes.json image 연결: ${withImage.length}개`);
  console.log(`이미지 없는 레시피: ${withoutImage.length}개`);

  if (missingFiles.length) {
    console.log(`\n[매핑은 있으나 파일 없음] ${missingFiles.length}개`);
    missingFiles.forEach(({ file, title }) => console.log(`  - ${file} → ${title}`));
  }
  if (unmappedFiles.length) {
    console.log(`\n[파일은 있으나 매핑 없음] ${unmappedFiles.length}개`);
    unmappedFiles.forEach((f) => console.log(`  - ${f}`));
  }

  console.log('\n다음: npm run build:recipes && npm run sync:public-static');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
