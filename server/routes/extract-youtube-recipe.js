import { Router } from 'express';
import { extractYouTubeVideoId, fetchYouTubeContent } from '../lib/youtube.js';
import { analyzeYouTubeTextToRecipe } from '../lib/openai-recipe.js';
import { assertCanUseAi, recordAiUsage } from '../lib/ai-usage-limit.js';

const router = Router();

function resolveUserId(req) {
  return String(req.body?.userId || req.headers['x-user-id'] || '').trim();
}

router.post('/extract-youtube-recipe', async (req, res) => {
  const url = String(req.body?.url || '').trim();
  const userId = resolveUserId(req);

  if (!userId) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_USER_ID',
      message: 'userId가 필요합니다.',
    });
  }

  if (!url) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_URL',
      message: '영상 링크(url)가 필요합니다.',
    });
  }

  const videoId = extractYouTubeVideoId(url);
  if (!videoId) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_URL',
      message: '유효한 YouTube 링크가 아닙니다.',
    });
  }

  try {
    const youtubeContent = await fetchYouTubeContent(url);

    try {
      assertCanUseAi(userId);
    } catch (limitErr) {
      if (limitErr.code === 'DAILY_LIMIT_EXCEEDED') {
        return res.status(429).json({
          success: false,
          error: 'DAILY_LIMIT_EXCEEDED',
          message: limitErr.message,
          aiUsage: limitErr.aiUsage,
        });
      }
      throw limitErr;
    }

    const recipe = await analyzeYouTubeTextToRecipe(youtubeContent);
    const aiUsage = recordAiUsage(userId);

    return res.json({
      success: true,
      ...recipe,
      aiUsage,
    });
  } catch (err) {
    console.error('[extract-youtube-recipe]', err.code || err.message, err.details || '');

    if (err.code === 'DAILY_LIMIT_EXCEEDED') {
      return res.status(429).json({
        success: false,
        error: 'DAILY_LIMIT_EXCEEDED',
        message: err.message,
        aiUsage: err.aiUsage,
      });
    }

    if (err.fallback) {
      return res.status(422).json({
        success: false,
        error: err.code || 'EXTRACTION_FAILED',
        message: err.message,
        fallback: true,
      });
    }

    if (err.code === 'INVALID_VIDEO_ID' || err.code === 'INVALID_URL') {
      return res.status(400).json({ success: false, error: err.code, message: err.message });
    }

    if (err.code === 'MISSING_OPENAI_KEY') {
      return res.status(503).json({
        success: false,
        error: err.code,
        message: '서버 AI 설정이 완료되지 않았습니다. 관리자에게 문의해 주세요.',
      });
    }

    if (err.code === 'NO_TEXT') {
      return res.status(422).json({
        success: false,
        error: err.code,
        message: err.message,
        fallback: true,
      });
    }

    if (err.code === 'VIDEO_UNAVAILABLE') {
      return res.status(404).json({
        success: false,
        error: err.code,
        message: 'YouTube 영상을 찾을 수 없거나 접근할 수 없습니다.',
        fallback: true,
      });
    }

    return res.status(500).json({
      success: false,
      error: err.code || 'SERVER_ERROR',
      message: '레시피 추출 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.',
    });
  }
});

export default router;
