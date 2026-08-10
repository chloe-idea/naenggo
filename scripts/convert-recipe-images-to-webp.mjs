#!/usr/bin/env node
/**
 * public/images/recipes 의 PNG/JPG/JPEG → WebP 일괄 변환
 *
 * - 품질: 85
 * - 출력: 원본 파일명 유지, 확장자만 .webp
 * - 기존 .webp 는 건너뜀 (덮어쓰지 않음)
 * - 원본 PNG/JPG 는 삭제하지 않음
 *
 * 사용법:
 *   npm run images:webp
 *   node scripts/convert-recipe-images-to-webp.mjs [대상폴더]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_DIR = path.join(ROOT, 'public/images/recipes');
const WEBP_QUALITY = 85;
const SOURCE_EXT = new Set(['.png', '.jpg', '.jpeg']);

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
    .filter((name) => SOURCE_EXT.has(path.extname(name).toLowerCase()))
    .sort();

  console.log('=== convert-recipe-images-to-webp ===');
  console.log(`대상: ${dir}`);
  console.log(`품질: webp q${WEBP_QUALITY}`);
  console.log(`후보: ${files.length}개 (기존 .webp 는 건너뜀, 원본 유지)\n`);

  let converted = 0;
  let skipped = 0;
  let failed = 0;

  for (const name of files) {
    const srcPath = path.join(dir, name);
    const base = path.basename(name, path.extname(name));
    const outName = `${base}.webp`;
    const outPath = path.join(dir, outName);

    if (fs.existsSync(outPath)) {
      console.log(`  skip  ${name} → ${outName} (이미 존재)`);
      skipped += 1;
      continue;
    }

    try {
      const before = fs.statSync(srcPath).size;
      await sharp(srcPath)
        .webp({ quality: WEBP_QUALITY })
        .toFile(outPath);
      const after = fs.statSync(outPath).size;
      console.log(`  ok    ${name} → ${outName} (${formatKb(before)} → ${formatKb(after)})`);
      converted += 1;
    } catch (err) {
      failed += 1;
      console.error(`  fail  ${name}: ${err?.message || err}`);
    }
  }

  console.log(`\n완료: 변환 ${converted}개, 건너뜀 ${skipped}개, 실패 ${failed}개`);
  if (failed) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
