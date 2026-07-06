/**
 * 플랫폼별 영상 메타데이터 fetch (Recime-style registry)
 */
import { VideoPlatform } from './constants.js';
import { detectVideoPlatform, extractVideoId } from './platform.js';
import { fetchYouTubeContent } from '../youtube.js';
import { fetchInstagramReelsContent } from '../instagram.js';
import { logVideoExtractPipeline } from './debug.js';

function createTikTokPlaceholder(url, videoId) {
  return {
    platform: VideoPlatform.TIKTOK,
    videoId,
    title: '',
    thumbnailUrl: null,
    sourceUrl: url,
    extractedDescription: '',
    extractedCaption: '',
    extractedTranscript: '',
    combinedText: '',
    apiStatus: 'unsupported',
    autoExtractFailed: true,
  };
}

function createUnknownPlaceholder(url) {
  return {
    platform: VideoPlatform.UNKNOWN,
    videoId: null,
    title: '',
    thumbnailUrl: null,
    sourceUrl: url,
    extractedDescription: '',
    extractedCaption: '',
    extractedTranscript: '',
    combinedText: '',
    apiStatus: 'unknown',
    autoExtractFailed: true,
  };
}

/** @param {string} url */
export async function fetchVideoMetadata(url) {
  const platform = detectVideoPlatform(url);
  const videoId = extractVideoId(url, platform);

  let content;
  switch (platform) {
    case VideoPlatform.YOUTUBE:
    case VideoPlatform.YOUTUBE_SHORTS:
      content = await fetchYouTubeContent(url);
      break;
    case VideoPlatform.INSTAGRAM_REELS:
      content = await fetchInstagramReelsContent(url);
      break;
    case VideoPlatform.TIKTOK:
      content = createTikTokPlaceholder(url, videoId);
      break;
    default:
      content = createUnknownPlaceholder(url);
      break;
  }

  const metadata = {
    ...content,
    platform: content.platform || platform,
    videoId: content.videoId || videoId,
  };

  logVideoExtractPipeline({
    phase: 'fetchVideoMetadata',
    platform: metadata.platform,
    videoId: metadata.videoId,
    apiStatus: metadata.apiStatus || null,
    title: metadata.title,
    description: metadata.extractedDescription || metadata.extractedCaption || '',
    captionText: metadata.extractedCaption || '',
    transcriptText: metadata.extractedTranscript || '',
    combinedText: metadata.combinedText || '',
  });

  return metadata;
}
