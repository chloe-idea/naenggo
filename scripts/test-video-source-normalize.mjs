#!/usr/bin/env node
/**
 * 영상 URL 정규화 · 중복 판별 테스트
 * node scripts/test-video-source-normalize.mjs
 */
import assert from 'node:assert/strict';
import {
  normalizeVideoSource,
  resolveRecipeNormalizedVideoId,
} from '../server/lib/video-source-normalize.js';

const VIDEO_ID = 'dQw4w9WgXcQ';
const IG_CODE = 'ABCde12345';

const youtubeVariants = [
  `https://www.youtube.com/watch?v=${VIDEO_ID}`,
  `https://youtu.be/${VIDEO_ID}`,
  `https://www.youtube.com/shorts/${VIDEO_ID}`,
  `https://www.youtube.com/watch?v=${VIDEO_ID}&utm_source=share&utm_medium=copy`,
  `https://youtu.be/${VIDEO_ID}?si=abc123`,
  `https://www.youtube.com/watch?v=${VIDEO_ID}/`,
];

const instagramVariants = [
  `https://www.instagram.com/reel/${IG_CODE}/`,
  `https://www.instagram.com/reels/${IG_CODE}?igsh=abc`,
  `https://www.instagram.com/reel/${IG_CODE}`,
];

console.log('=== YouTube variants ===');
const youtubeIds = youtubeVariants.map((url) => {
  const norm = normalizeVideoSource(url);
  console.log(`  ${url}\n    -> ${norm?.normalizedVideoId}`);
  return norm?.normalizedVideoId;
});
assert.ok(youtubeIds.every((id) => id === `youtube:${VIDEO_ID}`));

console.log('\n=== Instagram variants ===');
const igIds = instagramVariants.map((url) => {
  const norm = normalizeVideoSource(url);
  console.log(`  ${url}\n    -> ${norm?.normalizedVideoId}`);
  return norm?.normalizedVideoId;
});
assert.ok(igIds.every((id) => id === `instagram:${IG_CODE}`));

console.log('\n=== Different videos ===');
const other = normalizeVideoSource('https://www.youtube.com/watch?v=OTHERVIDEO1');
assert.notEqual(other?.normalizedVideoId, `youtube:${VIDEO_ID}`);

console.log('\n=== Legacy recipe backward compat ===');
const legacyId = resolveRecipeNormalizedVideoId({
  sourceUrl: `https://youtu.be/${VIDEO_ID}`,
});
assert.equal(legacyId, `youtube:${VIDEO_ID}`);

const storedId = resolveRecipeNormalizedVideoId({
  normalizedVideoId: `youtube:${VIDEO_ID}`,
  sourceUrl: 'https://www.youtube.com/watch?v=OTHERVIDEO1',
});
assert.equal(storedId, `youtube:${VIDEO_ID}`);

console.log('\nAll tests passed.');
