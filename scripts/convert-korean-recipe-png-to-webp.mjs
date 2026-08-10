#!/usr/bin/env node
/**
 * 한글 파일명 PNG → recipes.json slug 기준 영문 WebP 변환
 *
 * - 비교 전 Unicode NFC + 공백 정규화 (macOS NFD 대응)
 * - TITLE_ALIASES 로 표기 차이만 명시적 매핑 (임의 영문 번역 금지)
 * - 출력: public/images/recipes/{slug}.webp (q85, 원본 PNG 유지)
 * - 매칭된 recipe.image 를 images/recipes/{slug}.webp 로 보정
 *
 * 사용법:
 *   npm run convert:recipe-images
 *   node scripts/convert-korean-recipe-png-to-webp.mjs [png폴더]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const RECIPES_JSON = path.join(ROOT, 'src/data/recipes.json');
const DEFAULT_DIR = path.join(ROOT, 'public/images/recipes');
const OUTPUT_REL = 'public/images/recipes';
const WEBP_QUALITY = 85;

/**
 * 파일명 title → recipes.json title
 * 임의 번역 금지. 표기 차이만 명시적으로 연결.
 */
const TITLE_ALIASES = {
  토마토달걀볶음: '토마토 계란볶음',
  팟카오: '팟카파오',
  크림파스타: '크림 파스타',
  토마토파스타: '토마토 파스타',
};

const normalize = (value) => String(value || '')
  .normalize('NFC')
  .replace(/\s+/g, ' ')
  .trim();

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return String(bytes);
  if (bytes < 1024) return `${bytes}B`;
  return `${Math.round(bytes / 1024)}KB`;
}

function buildAliasMap() {
  const map = new Map();
  for (const [from, to] of Object.entries(TITLE_ALIASES)) {
    map.set(normalize(from), normalize(to));
  }
  return map;
}

function loadRecipes() {
  if (!fs.existsSync(RECIPES_JSON)) {
    throw new Error(`recipes.json 없음: ${RECIPES_JSON}`);
  }
  const payload = JSON.parse(fs.readFileSync(RECIPES_JSON, 'utf8'));
  const recipes = Array.isArray(payload) ? payload : payload.recipes || [];
  /** @type {Map<string, object[]>} */
  const byTitle = new Map();
  for (const recipe of recipes) {
    const title = normalize(recipe?.title || recipe?.name);
    if (!title) continue;
    if (!byTitle.has(title)) byTitle.set(title, []);
    byTitle.get(title).push(recipe);
  }
  return { payload, recipes, byTitle };
}

function resolveRecipeForFilename(filenameTitle, byTitle, aliasMap) {
  const direct = byTitle.get(filenameTitle) || [];
  if (direct.length) {
    return { recipe: direct[0], matchedTitle: filenameTitle, viaAlias: null, ambiguous: direct };
  }
  const aliased = aliasMap.get(filenameTitle);
  if (aliased) {
    const hits = byTitle.get(aliased) || [];
    if (hits.length) {
      return { recipe: hits[0], matchedTitle: aliased, viaAlias: filenameTitle, ambiguous: hits };
    }
  }
  return { recipe: null, matchedTitle: null, viaAlias: null, ambiguous: [] };
}

function expectedImagePath(slug) {
  return `images/recipes/${slug}.webp`;
}

async function main() {
  const sourceDir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DIR;
  const outputDir = DEFAULT_DIR;
  const aliasMap = buildAliasMap();

  if (!fs.existsSync(sourceDir)) {
    console.error(`폴더 없음: ${sourceDir}`);
    process.exit(1);
  }

  const { payload, recipes, byTitle } = loadRecipes();
  const pngFiles = fs.readdirSync(sourceDir)
    .filter((name) => path.extname(name).toLowerCase() === '.png')
    .sort((a, b) => normalize(a).localeCompare(normalize(b), 'ko'));

  console.log('SOURCE:');
  console.log(`  ${sourceDir}`);
  console.log('FOUND PNG:');
  console.log(`  ${pngFiles.length}개`);
  for (const name of pngFiles) {
    const form = name.normalize('NFC') === name ? 'NFC' : (name.normalize('NFD') === name ? 'NFD' : 'MIXED');
    console.log(`  - ${normalize(path.basename(name, path.extname(name)))}.png  (fs:${form})`);
  }
  console.log('OUTPUT:');
  console.log(`  ${OUTPUT_REL}`);
  console.log(`RECIPES:`);
  console.log(`  ${RECIPES_JSON} (${recipes.length}개)`);
  console.log(`QUALITY: webp q${WEBP_QUALITY}`);
  console.log('');

  let converted = 0;
  let overwritten = 0;
  let imageFieldUpdated = 0;
  let failed = 0;
  let matched = 0;
  let unmatched = 0;
  /** @type {{ slug: string, outPath: string, size: number, mtime: Date }[]} */
  const outputs = [];
  let recipesDirty = false;

  for (const name of pngFiles) {
    const ext = path.extname(name);
    const rawBase = path.basename(name, ext);
    const filenameTitle = normalize(rawBase);
    const displayPng = `${filenameTitle}${ext.toLowerCase()}`;
    const { recipe, matchedTitle, viaAlias, ambiguous } = resolveRecipeForFilename(
      filenameTitle,
      byTitle,
      aliasMap,
    );

    if (!recipe) {
      unmatched += 1;
      console.log('[NO MATCH]');
      console.log(displayPng);
      console.log(`normalized filename: ${filenameTitle}`);
      if (aliasMap.has(filenameTitle)) {
        console.log(`alias target: ${aliasMap.get(filenameTitle)} (recipes.json에 없음)`);
      }
      console.log('');
      continue;
    }

    const slug = String(recipe.slug || recipe.id || '').trim();
    if (!slug) {
      unmatched += 1;
      console.log('[NO MATCH]');
      console.log(displayPng);
      console.log(`normalized filename: ${filenameTitle}`);
      console.log('reason: matched title has empty slug');
      console.log('');
      continue;
    }

    matched += 1;
    const srcPath = path.join(sourceDir, name);
    const outName = `${slug}.webp`;
    const outPath = path.join(outputDir, outName);
    const outRel = path.join(OUTPUT_REL, outName);
    const imagePath = expectedImagePath(slug);
    const existed = fs.existsSync(outPath);
    const oldSize = existed ? fs.statSync(outPath).size : 0;

    console.log('[MATCH]');
    console.log(displayPng);
    console.log(`→ title: ${matchedTitle}${viaAlias ? ` (alias from: ${viaAlias})` : ''}`);
    console.log(`→ slug: ${slug}`);
    console.log(`→ output: ${outRel}`);
    if (ambiguous.length > 1) {
      const slugs = [...new Set(ambiguous.map((r) => r.slug || r.id))];
      if (slugs.length > 1) {
        console.log(`→ note: duplicate titles, using first slug (${slug}); others: ${slugs.slice(1).join(', ')}`);
      }
    }

    try {
      await sharp(srcPath)
        .webp({ quality: WEBP_QUALITY })
        .toFile(outPath);

      if (!fs.existsSync(outPath)) {
        throw new Error(`출력 파일이 생성되지 않음: ${outPath}`);
      }
      const st = fs.statSync(outPath);
      if (!(st.size > 0)) {
        throw new Error(`출력 파일 size가 0: ${outPath}`);
      }

      if (existed) {
        overwritten += 1;
        console.log('[OVERWRITE]');
        console.log(`old size: ${formatBytes(oldSize)} (${oldSize} bytes)`);
        console.log(`new size: ${formatBytes(st.size)} (${st.size} bytes)`);
      }

      console.log(`[OK] exists=${fs.existsSync(outPath)} size=${st.size} mtime=${st.mtime.toISOString()}`);
      converted += 1;
      outputs.push({ slug, outPath, size: st.size, mtime: st.mtime });

      const currentImage = recipe.image == null ? null : String(recipe.image).trim();
      if (currentImage !== imagePath) {
        console.log(`[IMAGE UPDATE] ${currentImage || 'null'} → ${imagePath}`);
        recipe.image = imagePath;
        imageFieldUpdated += 1;
        recipesDirty = true;
      } else {
        console.log(`[IMAGE OK] ${imagePath}`);
      }
      console.log('');
    } catch (err) {
      failed += 1;
      console.error(`[FAIL] ${displayPng}: ${err?.message || err}`);
      console.log('');
    }
  }

  if (recipesDirty) {
    if (!Array.isArray(payload) && payload && typeof payload === 'object') {
      payload.updatedAt = new Date().toISOString().slice(0, 10);
    }
    fs.writeFileSync(RECIPES_JSON, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
    console.log(`[RECIPES.JSON] image 필드 ${imageFieldUpdated}개 갱신 → ${RECIPES_JSON}`);
    console.log('다음: npm run build:recipes  (앱 번들 builtin-recipes.js 반영)\n');
  }

  console.log('=== SUMMARY ===');
  console.log(`MATCH: ${matched}`);
  console.log(`NO MATCH: ${unmatched}`);
  console.log(`CONVERTED: ${converted}`);
  console.log(`OVERWRITE: ${overwritten}`);
  console.log(`IMAGE FIELD UPDATED: ${imageFieldUpdated}`);
  console.log(`FAILED: ${failed}`);

  if (outputs.length) {
    console.log('\n=== OUTPUT FILES ===');
    for (const item of outputs) {
      console.log(`${item.slug}.webp  size=${item.size}  mtime=${item.mtime.toISOString()}`);
    }
  }

  console.log('\n=== CACHE CHECK (앱에서 이전 이미지가 보일 때) ===');
  console.log('- 위 OUTPUT FILES 의 mtime/size 가 방금 변환 시각·용량인지 확인');
  console.log('- 브라우저 Network 에서 요청 URL이 /images/recipes/{slug}.webp 인지 확인');
  console.log('- sw.js 가 images/recipes/*.webp 를 precache 하므로, 하드 리로드 또는 SW/Cache 삭제 후 재확인');
  console.log('- 로컬에서 public/ 이 아닌 루트 images/ 를 쓰면 npm run sync:public-static 후 배포본과 경로를 맞출 것');
  console.log('- recipes.json image 를 바꿨다면 npm run build:recipes 후 앱을 새로고침');

  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
