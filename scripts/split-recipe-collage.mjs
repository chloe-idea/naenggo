#!/usr/bin/env node
/**
 * 레시피 콜라주 → 정사각형 webp 분할 (6×4)
 *
 * 사용법:
 *   npm run split-recipe-collage
 *   node scripts/split-recipe-collage.mjs [입력이미지경로]
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import sharp from 'sharp';
import { optimizeRecipeImage } from './optimize-recipe-image.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, '..');
const DEFAULT_INPUT = path.join(ROOT, 'assets/recipe-collage.png');
const OUTPUT_DIR = path.join(ROOT, 'public/images/recipes');
const TILES_PATH = path.join(__dirname, 'recipe-collage-tiles.json');

const COLS = 6;
const ROWS = 4;
/** 하단 음식명 텍스트 영역 제외 */
const CONTENT_HEIGHT_RATIO = 0.82;
const TOP_PADDING_RATIO = 0.06;
const HORIZONTAL_PADDING_RATIO = 0.04;

const tiles = JSON.parse(fs.readFileSync(TILES_PATH, 'utf8'));

function getTileSlug(row, col) {
  const tile = tiles.find((entry) => entry.row === row && entry.col === col);
  if (!tile) throw new Error(`타일 정의 없음: ${row}행 ${col}열`);
  return tile.slug;
}

async function createDefaultRecipeImage() {
  const size = 512;
  const outPath = path.join(OUTPUT_DIR, 'default-recipe.webp');
  const tmp = path.join(OUTPUT_DIR, '.default-recipe.tmp.png');
  await sharp({
    create: {
      width: size,
      height: size,
      channels: 3,
      background: { r: 250, g: 244, b: 239 },
    },
  })
    .png()
    .toFile(tmp);
  await optimizeRecipeImage(tmp, outPath);
  fs.unlinkSync(tmp);
  console.log(`  default → default-recipe.webp`);
}

async function splitCollage(inputPath) {
  if (!fs.existsSync(inputPath)) {
    throw new Error(`입력 이미지를 찾을 수 없습니다: ${inputPath}`);
  }

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const image = sharp(inputPath);
  const { width, height } = await image.metadata();
  if (!width || !height) throw new Error('이미지 크기를 읽을 수 없습니다.');

  const cellW = width / COLS;
  const cellH = height / ROWS;
  const contentH = cellH * CONTENT_HEIGHT_RATIO;
  const squareSize = Math.floor(Math.min(cellW * (1 - HORIZONTAL_PADDING_RATIO * 2), contentH));

  console.log(`입력: ${inputPath}`);
  console.log(`크기: ${width}x${height} → 셀 ${cellW.toFixed(1)}x${cellH.toFixed(1)}, 정사각형 ${squareSize}px`);

  const outputs = [];

  for (let row = 1; row <= ROWS; row += 1) {
    for (let col = 1; col <= COLS; col += 1) {
      const slug = getTileSlug(row, col);
      const left = Math.round((col - 1) * cellW + (cellW - squareSize) / 2);
      const top = Math.round((row - 1) * cellH + cellH * TOP_PADDING_RATIO);
      const outPath = path.join(OUTPUT_DIR, `${slug}.webp`);
      const tmp = path.join(OUTPUT_DIR, `.${slug}.tmp.png`);

      await image
        .clone()
        .extract({ left, top, width: squareSize, height: squareSize })
        .png()
        .toFile(tmp);
      await optimizeRecipeImage(tmp, outPath);
      fs.unlinkSync(tmp);

      const tile = tiles.find((entry) => entry.slug === slug);
      outputs.push({ row, col, name: tile?.name, slug, outPath });
      console.log(`  ${row}행 ${col}열 ${tile?.name} → ${slug}.webp`);
    }
  }

  await createDefaultRecipeImage();
  return outputs;
}

const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : DEFAULT_INPUT;

splitCollage(inputPath)
  .then((outputs) => {
    console.log(`\n완료: ${outputs.length}개 이미지 + default → ${OUTPUT_DIR}`);
  })
  .catch((err) => {
    console.error(err.message || err);
    process.exit(1);
  });
