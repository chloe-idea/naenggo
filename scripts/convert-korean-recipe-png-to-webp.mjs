#!/usr/bin/env node
/**
 * 원본 PNG/JPG → recipes title/slug 매핑 기준 WebP 변환 (이미지 파일만 교체)
 *
 * Mapping (read-only): public/data/recipes.json 의 title / slug / id
 * - 스크립트는 slug를 생성하지 않음
 * - recipes.json 내용을 수정·생성하지 않음 (image 필드 업데이트 없음)
 * - 매칭 우선순위: slug → id → title → alias
 * - 출력: public/images/recipes/{recipe.slug}.webp (q85)
 * - 대상 .webp가 이미 있어도 source PNG/JPG가 있으면 항상 overwrite
 * - 원본 파일 유지
 *
 * 사용법:
 *   npm run convert:recipe-images
 *   node scripts/convert-korean-recipe-png-to-webp.mjs [원본폴더]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
/** title/slug 매핑 전용 (read-only). 데이터 복구·생성·수정 금지. */
const RECIPES_JSON = path.join(ROOT, 'public/data/recipes.json');
const DEFAULT_SOURCE_DIR = path.join(ROOT, 'public/recipes');
const OUTPUT_DIR = path.join(ROOT, 'public/images/recipes');
const OUTPUT_REL = 'public/images/recipes';
const WEBP_QUALITY = 85;
const SOURCE_EXT = new Set(['.png', '.jpg', '.jpeg']);
const SKIP_BASENAMES = new Set(['default-recipe']);

/**
 * 파일명(확장자 제외) → recipes.json 의 title 또는 slug/id
 * 임의 영문 slug 생성 금지. 출력은 항상 매칭된 recipe.slug.
 */
const TITLE_ALIASES = {
  토마토달걀볶음: '토마토 계란볶음',
  팟카오: '팟카파오',
  크림파스타: '크림 파스타',
  토마토파스타: '토마토 파스타',
};

/** 영어 파일명인데 recipes.json slug가 다른 경우 (basename → slug|id|title) */
const FILE_ALIASES = {
  'milk-cereal': 'recipe-107', // 우유시리얼
  'sausage-rice-bowl': 'recipe-42', // 소시지덮밥
  'stir-fried-eggs': 'recipe-131', // 계란볶음
};

const normalize = (value) => String(value || '')
  .normalize('NFC')
  .replace(/\s+/g, ' ')
  .trim();

const normalizeKey = (value) => normalize(value).toLocaleLowerCase('en-US');

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return String(bytes);
  if (bytes < 1024) return `${bytes}B`;
  return `${Math.round(bytes / 1024)}KB`;
}

function expectedImagePath(slug) {
  return `images/recipes/${slug}.webp`;
}

function recipeKey(recipe) {
  return String(recipe?.slug || recipe?.id || '').trim();
}

function buildIndexes(recipes) {
  /** @type {Map<string, object[]>} */
  const bySlug = new Map();
  /** @type {Map<string, object[]>} */
  const byId = new Map();
  /** @type {Map<string, object[]>} */
  const byTitle = new Map();

  const push = (map, key, recipe) => {
    if (!key) return;
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(recipe);
  };

  for (const recipe of recipes) {
    push(bySlug, normalizeKey(recipe?.slug), recipe);
    push(byId, normalizeKey(recipe?.id), recipe);
    push(byTitle, normalizeKey(recipe?.title || recipe?.name), recipe);
  }

  /** @type {Map<string, string>} */
  const aliasToTarget = new Map();
  for (const [from, to] of Object.entries(TITLE_ALIASES)) {
    aliasToTarget.set(normalizeKey(from), normalize(to));
  }
  for (const [from, to] of Object.entries(FILE_ALIASES)) {
    aliasToTarget.set(normalizeKey(from), normalize(to));
  }

  return { bySlug, byId, byTitle, aliasToTarget };
}

function uniqueRecipes(list) {
  const seen = new Set();
  const out = [];
  for (const recipe of list || []) {
    const key = recipeKey(recipe) || normalizeKey(recipe?.title);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    out.push(recipe);
  }
  return out;
}

/**
 * @returns {{
 *   recipe: object | null,
 *   via: 'slug'|'id'|'title'|'alias'|null,
 *   candidates: object[],
 *   attempts: Record<string, string>,
 *   ambiguous: boolean,
 * }}
 */
function resolveRecipeForBasename(basename, indexes) {
  const key = normalizeKey(basename);
  const attempts = {
    slug: 'none',
    id: 'none',
    title: 'none',
    alias: 'none',
  };

  const tryLevel = (level, list) => {
    const uniq = uniqueRecipes(list);
    if (!uniq.length) return null;
    attempts[level] = uniq.map((r) => `${r.title || '?'} [${recipeKey(r)}]`).join(' | ');
    if (uniq.length > 1) {
      return { recipe: null, via: level, candidates: uniq, attempts, ambiguous: true };
    }
    return { recipe: uniq[0], via: level, candidates: uniq, attempts, ambiguous: false };
  };

  let hit = tryLevel('slug', indexes.bySlug.get(key) || []);
  if (hit?.ambiguous) return hit;
  if (hit?.recipe) return hit;

  hit = tryLevel('id', indexes.byId.get(key) || []);
  if (hit?.ambiguous) return hit;
  if (hit?.recipe) return hit;

  hit = tryLevel('title', indexes.byTitle.get(key) || []);
  if (hit?.ambiguous) return hit;
  if (hit?.recipe) return hit;

  const aliasTarget = indexes.aliasToTarget.get(key);
  if (aliasTarget) {
    const aliasKey = normalizeKey(aliasTarget);
    const aliasHits = uniqueRecipes([
      ...(indexes.bySlug.get(aliasKey) || []),
      ...(indexes.byId.get(aliasKey) || []),
      ...(indexes.byTitle.get(normalizeKey(aliasTarget)) || []),
      ...(indexes.byTitle.get(aliasKey) || []),
    ]);
    attempts.alias = aliasHits.length
      ? `${basename} → ${aliasTarget} => ${aliasHits.map((r) => `${r.title} [${recipeKey(r)}]`).join(' | ')}`
      : `${basename} → ${aliasTarget} (recipes.json에 없음)`;
    if (aliasHits.length > 1) {
      return { recipe: null, via: 'alias', candidates: aliasHits, attempts, ambiguous: true };
    }
    if (aliasHits.length === 1) {
      return { recipe: aliasHits[0], via: 'alias', candidates: aliasHits, attempts, ambiguous: false };
    }
  }

  return { recipe: null, via: null, candidates: [], attempts, ambiguous: false };
}

async function convertOne(srcPath, outPath) {
  await sharp(srcPath)
    .webp({ quality: WEBP_QUALITY })
    .toFile(outPath);
  if (!fs.existsSync(outPath)) throw new Error(`출력 파일이 생성되지 않음: ${outPath}`);
  const st = fs.statSync(outPath);
  if (!(st.size > 0)) throw new Error(`출력 파일 size가 0: ${outPath}`);
  return st;
}

async function main() {
  const sourceDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_SOURCE_DIR;

  if (!fs.existsSync(sourceDir)) {
    console.error(`폴더 없음: ${sourceDir}`);
    console.error('원본 PNG 폴더를 인자로 지정하세요. 예: npm run convert:recipe-images -- public/images/recipes');
    process.exit(1);
  }
  if (!fs.existsSync(RECIPES_JSON)) {
    console.error(`recipes.json 없음 (매핑용 read-only): ${RECIPES_JSON}`);
    process.exit(1);
  }

  const payload = JSON.parse(fs.readFileSync(RECIPES_JSON, 'utf8'));
  const recipes = Array.isArray(payload) ? payload : payload.recipes || [];
  const indexes = buildIndexes(recipes);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const sourceFiles = fs.readdirSync(sourceDir)
    .filter((name) => SOURCE_EXT.has(path.extname(name).toLowerCase()))
    .sort((a, b) => normalize(a).localeCompare(normalize(b), 'ko'));

  console.log('SOURCE:');
  console.log(`  ${sourceDir}`);
  console.log('FOUND SOURCE IMAGES:');
  console.log(`  ${sourceFiles.length}개 (.png/.jpg/.jpeg)`);
  for (const name of sourceFiles) {
    const base = path.basename(name, path.extname(name));
    const form = name.normalize('NFC') === name ? 'NFC' : (name.normalize('NFD') === name ? 'NFD' : 'MIXED');
    console.log(`  - ${normalize(base)}${path.extname(name).toLowerCase()}  (fs:${form})`);
  }
  console.log('OUTPUT:');
  console.log(`  ${OUTPUT_REL}`);
  console.log('RECIPES MAPPING (read-only):');
  console.log(`  ${RECIPES_JSON} (${recipes.length}개)`);
  console.log(`QUALITY: webp q${WEBP_QUALITY}`);
  console.log('NOTE: slug는 recipes.json 값을 그대로 사용합니다 (스크립트가 생성하지 않음).');
  console.log('NOTE: recipes.json / image 필드는 수정하지 않습니다. WebP 파일만 overwrite 합니다.');
  console.log('NOTE: 기존 {slug}.webp 가 있어도 source가 있으면 항상 overwrite 합니다.');
  console.log('');

  let converted = 0;
  let overwritten = 0;
  let skipped = 0;
  let failed = 0;
  let matched = 0;
  let unmatched = 0;
  let ambiguous = 0;

  for (const name of sourceFiles) {
    const ext = path.extname(name);
    const rawBase = path.basename(name, ext);
    const displayBase = normalize(rawBase);
    const displayName = `${displayBase}${ext.toLowerCase()}`;

    if (SKIP_BASENAMES.has(normalizeKey(rawBase))) {
      skipped += 1;
      console.log('[SKIP]');
      console.log(`original filename: ${name}`);
      console.log('reason: placeholder / non-recipe asset');
      console.log('');
      continue;
    }

    const resolved = resolveRecipeForBasename(rawBase, indexes);

    if (resolved.ambiguous) {
      ambiguous += 1;
      skipped += 1;
      console.log('[AMBIGUOUS MATCH]');
      console.log(`filename: ${displayName}`);
      console.log('candidate recipes:');
      for (const r of resolved.candidates) {
        console.log(`- ${r.title || '(no title)'} | id=${r.id} | slug=${r.slug}`);
      }
      console.log('action: skip (자동 변환하지 않음)');
      console.log('');
      continue;
    }

    if (!resolved.recipe) {
      unmatched += 1;
      console.log('[NO MATCH]');
      console.log(`original filename: ${name}`);
      console.log(`normalized filename: ${displayBase}`);
      console.log(`slug match: ${resolved.attempts.slug}`);
      console.log(`id match: ${resolved.attempts.id}`);
      console.log(`title match: ${resolved.attempts.title}`);
      console.log(`alias match: ${resolved.attempts.alias}`);
      console.log('');
      continue;
    }

    const recipe = resolved.recipe;
    const slug = String(recipe.slug || '').trim();
    if (!slug) {
      unmatched += 1;
      console.log('[NO MATCH]');
      console.log(`original filename: ${name}`);
      console.log(`normalized filename: ${displayBase}`);
      console.log('reason: matched recipe has empty slug in recipes.json');
      console.log('');
      continue;
    }

    matched += 1;
    const srcPath = path.join(sourceDir, name);
    const outName = `${slug}.webp`;
    const outPath = path.join(OUTPUT_DIR, outName);
    const outRel = path.join(OUTPUT_REL, outName);
    const imagePath = expectedImagePath(slug);
    const existed = fs.existsSync(outPath);
    const oldStat = existed ? fs.statSync(outPath) : null;

    console.log('[MATCH]');
    console.log(`original filename: ${name}`);
    console.log(`normalized filename: ${displayBase}`);
    console.log(`via: ${resolved.via}`);
    console.log(`title: ${recipe.title}`);
    console.log(`id: ${recipe.id}`);
    console.log(`slug: ${slug}  (from recipes.json mapping)`);
    console.log(`output: ${outRel}`);

    try {
      const st = await convertOne(srcPath, outPath);

      if (existed) {
        overwritten += 1;
        console.log(`[OVERWRITE] ${displayName} → ${outName}`);
        console.log(`old size: ${formatBytes(oldStat.size)} → new size: ${formatBytes(st.size)} (${st.size} bytes)`);
        console.log(`mtime: ${st.mtime.toISOString()}`);
      } else {
        console.log(`[OK] ${displayName} → ${outName} size=${st.size} mtime=${st.mtime.toISOString()}`);
      }

      converted += 1;
      console.log(`[IMAGE FILE] ${imagePath} (recipes.json image 필드는 변경하지 않음)`);
      console.log('');
    } catch (err) {
      failed += 1;
      console.error(`[FAIL] ${displayName}: ${err?.message || err}`);
      console.log('');
    }
  }

  // read-only 검증 리포트 (JSON 수정 없음)
  if (fs.existsSync(OUTPUT_DIR)) {
    const filesNow = new Set(fs.readdirSync(OUTPUT_DIR));
    let missingImage = 0;
    let pathMismatch = 0;
    console.log('=== RECIPE IMAGE VALIDATION (read-only) ===');
    for (const recipe of recipes) {
      const slug = String(recipe.slug || '').trim();
      if (!slug) continue;
      const expected = expectedImagePath(slug);
      const current = recipe.image == null ? null : String(recipe.image).trim();
      if (!current) continue;

      if (current !== expected) {
        pathMismatch += 1;
        console.log('[IMAGE PATH MISMATCH]');
        console.log(`title: ${recipe.title}`);
        console.log(`slug: ${slug}`);
        console.log(`recipe.image: ${current}`);
        console.log(`expected: ${expected}`);
        console.log('');
      }

      const basename = path.basename(current);
      const exists = filesNow.has(basename) || filesNow.has(`${slug}.webp`);
      if (!exists) {
        missingImage += 1;
        console.log('[MISSING IMAGE]');
        console.log(`title: ${recipe.title}`);
        console.log(`slug: ${slug}`);
        console.log(`expected path: ${path.join(OUTPUT_REL, `${slug}.webp`)}`);
        console.log('exists: false');
        console.log('action: none (recipes.json 미수정)');
        console.log('');
      }
    }
    if (!missingImage && !pathMismatch) {
      console.log('OK: image가 설정된 레시피의 파일이 모두 존재하고 slug 경로와 일치합니다.');
    }
    console.log(`MISSING IMAGE (report only): ${missingImage}`);
    console.log(`PATH MISMATCH (report only): ${pathMismatch}`);
  }

  console.log('\n=== SUMMARY ===');
  console.log(`MATCH: ${matched}`);
  console.log(`NO MATCH: ${unmatched}`);
  console.log(`AMBIGUOUS SKIP: ${ambiguous}`);
  console.log(`SKIPPED OTHER: ${skipped - ambiguous}`);
  console.log(`CONVERTED: ${converted}`);
  console.log(`OVERWRITE: ${overwritten}`);
  console.log(`IMAGE FIELD UPDATED: 0 (disabled)`);
  console.log(`FAILED: ${failed}`);

  console.log('\n=== NEXT ===');
  console.log('이미지 파일만 교체했습니다. recipes.json / build:recipes 는 필요하지 않습니다.');
  console.log('필요 시 SW CACHE_NAME / recipeImageVersion 을 갱신해 클라이언트 캐시를 교체하세요.');

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
