import { handleExtractVideoRecipeUnified } from './extract-video-recipe-unified.js';

/** @deprecated 통합 API `/api/extract-video-recipe` 사용 권장 */
export async function handleExtractInstagramRecipe(params) {
  return handleExtractVideoRecipeUnified(params);
}
