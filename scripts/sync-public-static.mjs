/**
 * Vercel(Output Directory = .)은 public/ 을 URL 루트로 매핑하지 않음.
 * 로컬 Express는 /images/* → public/images/* 로 서빙하므로,
 * 배포 시 public/images 를 루트 images/ 로 동기화해 동일 URL을 맞춘다.
 *
 * 원본은 항상 public/images 만 관리한다. images/ 아래 생성물은 gitignore.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'public', 'images');
const DEST = path.join(ROOT, 'images');

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const srcPath = path.join(from, entry.name);
    const destPath = path.join(to, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

if (!fs.existsSync(SRC)) {
  console.error(`[sync-public-static] missing source: ${SRC}`);
  process.exit(1);
}

copyDir(SRC, DEST);

const recipeDir = path.join(DEST, 'recipes');
const count = fs.existsSync(recipeDir)
  ? fs.readdirSync(recipeDir).filter((n) => n !== '.gitkeep').length
  : 0;
console.log(`[sync-public-static] synced public/images → images/ (${count} files in images/recipes)`);
