/**
 * 레시피 이미지 최적화 — 긴 변 800px, webp, 목표 150KB 이하
 */
import fs from 'fs';
import path from 'path';
import sharp from 'sharp';

export const RECIPE_IMAGE_MAX_EDGE = 800;
export const RECIPE_IMAGE_WEBP_QUALITY = 80;
export const RECIPE_IMAGE_MAX_BYTES = 150 * 1024;
export const RECIPE_IMAGE_MIN_QUALITY = 55;

function tempPath(destPath) {
  return path.join(
    path.dirname(destPath),
    `.${path.basename(destPath)}.${process.pid}.${Date.now()}.tmp`,
  );
}

async function encodeWebp(buffer, quality) {
  return sharp(buffer)
    .webp({ quality, effort: 4 })
    .toBuffer();
}

/**
 * @param {string} srcPath
 * @param {string} destPath
 * @returns {Promise<{ width: number, height: number, quality: number, bytes: number }>}
 */
export async function optimizeRecipeImage(srcPath, destPath) {
  const resized = await sharp(srcPath)
    .rotate()
    .resize({
      width: RECIPE_IMAGE_MAX_EDGE,
      height: RECIPE_IMAGE_MAX_EDGE,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .toBuffer({ resolveWithObject: true });

  let quality = RECIPE_IMAGE_WEBP_QUALITY;
  let output = await encodeWebp(resized.data, quality);

  while (output.length > RECIPE_IMAGE_MAX_BYTES && quality > RECIPE_IMAGE_MIN_QUALITY) {
    quality -= 5;
    output = await encodeWebp(resized.data, quality);
  }

  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const tmp = tempPath(destPath);
  await fs.promises.writeFile(tmp, output);
  await fs.promises.rename(tmp, destPath);

  return {
    width: resized.info.width,
    height: resized.info.height,
    quality,
    bytes: output.length,
  };
}
