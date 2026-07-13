/**
 * Vercel(Output Directory = .)은 Next.js처럼 public/ → / 매핑을 하지 않음.
 * 로컬 Express만 /images/* → public/images/* 로 서빙한다.
 *
 * 이 스크립트는 배포 빌드에서 public/images 전체를 루트 images/ 로 복사해
 * /images/recipes/*.webp URL이 실제 정적 파일로 존재하게 한다.
 *
 * 원본: public/images/** (git tracked)
 * 생성물: images/** (gitignore — 빌드 시에만 생성)
 *
 * exclude 없음. public/images 아래 모든 파일·하위폴더를 그대로 복사한다.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC_IMAGES = path.join(ROOT, 'public', 'images');
const SRC_RECIPES = path.join(SRC_IMAGES, 'recipes');
const DEST_IMAGES = path.join(ROOT, 'images');
const DEST_RECIPES = path.join(DEST_IMAGES, 'recipes');

/** @returns {string[]} absolute paths of copied files */
function copyDirRecursive(from, to, copied = []) {
  if (!fs.existsSync(from)) {
    throw new Error(`source missing: ${from}`);
  }
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, destPath, copied);
      continue;
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      fs.copyFileSync(srcPath, destPath);
      copied.push(destPath);
    }
  }
  return copied;
}

function rel(p) {
  return path.relative(ROOT, p);
}

if (!fs.existsSync(SRC_IMAGES)) {
  console.error(`[sync-public-static] missing ${rel(SRC_IMAGES)}`);
  process.exit(1);
}
if (!fs.existsSync(SRC_RECIPES)) {
  console.error(`[sync-public-static] missing ${rel(SRC_RECIPES)} — recipe images required`);
  process.exit(1);
}

const srcRecipeFiles = fs.readdirSync(SRC_RECIPES).filter((name) => {
  const full = path.join(SRC_RECIPES, name);
  return fs.statSync(full).isFile() && name !== '.gitkeep';
});
if (srcRecipeFiles.length === 0) {
  console.error(`[sync-public-static] ${rel(SRC_RECIPES)} has no image files`);
  process.exit(1);
}

// 1) public/images 전체 → images/ (recipes 하위 포함, exclude 없음)
const copied = copyDirRecursive(SRC_IMAGES, DEST_IMAGES);

// 2) recipes 경로를 한 번 더 명시적으로 보장 (동일 파일 overwrite)
const recipeCopied = copyDirRecursive(SRC_RECIPES, DEST_RECIPES);
const recipeDestFiles = fs.readdirSync(DEST_RECIPES).filter((name) => {
  const full = path.join(DEST_RECIPES, name);
  return fs.statSync(full).isFile() && name !== '.gitkeep';
});

console.log('[sync-public-static] source: public/images → dest: images/');
console.log(`[sync-public-static] copied ${copied.length} file(s) from public/images:`);
for (const file of copied.sort()) {
  console.log(`  - ${rel(file)}`);
}
console.log(`[sync-public-static] images/recipes guaranteed (${recipeCopied.length} file(s)):`);
for (const name of recipeDestFiles.sort()) {
  console.log(`  - images/recipes/${name}`);
}

if (recipeDestFiles.length === 0) {
  console.error('[sync-public-static] FAIL: images/recipes is empty after copy');
  process.exit(1);
}
if (!fs.existsSync(path.join(DEST_RECIPES, 'ramen.webp'))) {
  console.error('[sync-public-static] FAIL: images/recipes/ramen.webp missing after copy');
  process.exit(1);
}

console.log(`[sync-public-static] OK — ${recipeDestFiles.length} recipe image(s) ready for /images/recipes/*`);
