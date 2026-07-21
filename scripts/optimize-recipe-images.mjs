#!/usr/bin/env node
/**
 * public/images/recipes/*.webp 일괄 최적화
 *
 * 사용법:
 *   node scripts/optimize-recipe-images.mjs [대상폴더]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  RECIPE_IMAGE_MAX_BYTES,
  RECIPE_IMAGE_MAX_EDGE,
  RECIPE_IMAGE_WEBP_QUALITY,
  optimizeRecipeImage,
} from './optimize-recipe-image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_DIR = path.join(ROOT, 'public/images/recipes');

function formatKb(bytes) {
  return `${Math.round(bytes / 1024)}KB`;
}

async function main() {
  const dir = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_DIR;
  if (!fs.existsSync(dir)) {
    console.error(`폴더 없음: ${dir}`);
    process.exit(1);
  }

  const files = fs.readdirSync(dir)
    .filter((name) => name.endsWith('.webp'))
    .sort();

  console.log(`=== optimize-recipe-images ===`);
  console.log(`대상: ${dir}`);
  console.log(`설정: 긴 변 ${RECIPE_IMAGE_MAX_EDGE}px, webp q${RECIPE_IMAGE_WEBP_QUALITY}, 목표 ≤${formatKb(RECIPE_IMAGE_MAX_BYTES)}`);

  let processed = 0;
  let overBudget = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const name of files) {
    const filePath = path.join(dir, name);
    const before = fs.statSync(filePath).size;
    totalBefore += before;

    const result = await optimizeRecipeImage(filePath, filePath);
    const after = fs.statSync(filePath).size;
    totalAfter += after;
    processed += 1;

    if (after > RECIPE_IMAGE_MAX_BYTES) overBudget += 1;

    const note = after > RECIPE_IMAGE_MAX_BYTES
      ? ` (q${result.quality}, ${formatKb(after)} — 목표 초과)`
      : ` (q${result.quality}, ${formatKb(after)})`;

    console.log(`  ${name}: ${result.width}x${result.height}, ${formatKb(before)} → ${formatKb(after)}${note}`);
  }

  console.log(`\n완료: ${processed}개`);
  console.log(`총 용량: ${formatKb(totalBefore)} → ${formatKb(totalAfter)}`);
  if (overBudget) {
    console.log(`목표 초과: ${overBudget}개 (최소 품질까지 낮춰도 150KB 초과)`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
