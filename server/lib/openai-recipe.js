const VALID_CATEGORIES = new Set([
  'korean', 'western', 'japanese', 'chinese', 'diet', 'high-protein',
]);
const VALID_DIFFICULTIES = new Set(['쉬움', '보통', '어려움']);

const PLATFORM_LABELS = {
  youtube: 'YouTube',
  instagram: 'Instagram',
  tiktok: 'TikTok',
};

function buildSystemPrompt(platform = 'youtube') {
  const label = PLATFORM_LABELS[platform] || '영상';
  return `당신은 요리 레시피 추출 전문가입니다. ${label} URL, 제목, 설명글, 자막/캡션, 사용자 입력 텍스트에서 레시피만 추출하세요.
반드시 JSON 객체 하나만 반환하세요. 키:
- title (문자열, 레시피 이름)
- ingredients (문자열 배열, 필수 재료)
- optionalIngredients (문자열 배열, 선택 재료)
- substituteIngredients (문자열 배열, "재료 → 대체" 형식)
- steps (문자열 배열, 조리 순서)
- cookingTime (숫자, 분)
- difficulty ("쉬움"|"보통"|"어려움")
- category ("korean"|"western"|"japanese"|"chinese"|"diet"|"high-protein")

원문 전체를 저장하지 말고 요약된 레시피 정보만 추출하세요.
레시피 정보가 전혀 없으면 error 필드에 "NOT_A_RECIPE"를 넣으세요.`;
}

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((s) => String(s).trim()).filter(Boolean);
}

function normalizeRecipe(raw, meta) {
  const title = String(raw.title || meta.title || '영상 레시피').trim().slice(0, 80);
  const category = VALID_CATEGORIES.has(raw.category) ? raw.category : 'korean';
  const platform = meta.sourcePlatform || 'youtube';

  return {
    title,
    sourceUrl: meta.sourceUrl,
    sourcePlatform: platform,
    thumbnailUrl: meta.thumbnailUrl,
    ingredients: cleanStringArray(raw.ingredients),
    optionalIngredients: cleanStringArray(raw.optionalIngredients),
    substituteIngredients: cleanStringArray(raw.substituteIngredients),
    steps: cleanStringArray(raw.steps),
    cookingTime: Math.max(1, Number(raw.cookingTime) || 20),
    difficulty: VALID_DIFFICULTIES.has(raw.difficulty) ? raw.difficulty : '보통',
    category,
  };
}

function buildPromptContent(context) {
  const {
    platform = 'youtube',
    sourceUrl,
    title,
    extractedDescription,
    extractedTranscript,
    extractedCaption,
    userText,
  } = context;

  const platformLabel = PLATFORM_LABELS[platform] || '영상';
  const captionBlock = extractedCaption && extractedCaption !== extractedDescription
    ? `추출된 캡션:\n${extractedCaption.slice(0, 8000)}`
    : '';

  return [
    `${platformLabel} URL: ${sourceUrl}`,
    title ? `추출된 제목: ${title}` : '',
    extractedDescription ? `추출된 설명글:\n${extractedDescription.slice(0, 6000)}` : '',
    captionBlock,
    extractedTranscript ? `추출된 자막/음성/화면 텍스트:\n${extractedTranscript.slice(0, 8000)}` : '',
    userText ? `사용자 입력 설명글/캡션:\n${userText.slice(0, 8000)}` : '',
  ].filter(Boolean).join('\n\n');
}

export async function analyzeVideoTextToRecipe(context) {
  const {
    platform = 'youtube',
    sourceUrl,
    title,
    thumbnailUrl,
  } = context;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('서버에 OpenAI API Key가 설정되지 않았습니다.');
    err.code = 'MISSING_OPENAI_KEY';
    throw err;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const endpoint = process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';
  const userContent = buildPromptContent(context);

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: buildSystemPrompt(platform) },
        { role: 'user', content: userContent },
      ],
      temperature: 0.2,
    }),
  });

  if (!response.ok) {
    const body = await response.text();
    const err = new Error(`OpenAI API 오류 (${response.status})`);
    err.code = 'OPENAI_ERROR';
    err.details = body.slice(0, 300);
    throw err;
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) {
    const err = new Error('OpenAI 응답이 비어 있습니다.');
    err.code = 'OPENAI_EMPTY';
    throw err;
  }

  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const err = new Error('OpenAI 응답 JSON 파싱에 실패했습니다.');
    err.code = 'OPENAI_PARSE';
    throw err;
  }

  const fallbackHint = platform === 'instagram'
    ? '릴스 캡션이나 설명글을 붙여넣으면 더 정확하게 정리해드릴게요.'
    : '영상 설명글이나 캡션을 붙여넣으면 더 정확하게 정리해드릴게요.';

  if (parsed.error === 'NOT_A_RECIPE') {
    const err = new Error(`레시피 정보를 찾지 못했어요. ${fallbackHint}`);
    err.code = 'NOT_A_RECIPE';
    err.fallback = true;
    throw err;
  }

  const recipe = normalizeRecipe(parsed, {
    sourceUrl,
    thumbnailUrl,
    title,
    sourcePlatform: platform,
  });

  if (!recipe.ingredients.length || !recipe.steps.length) {
    const err = new Error(
      platform === 'instagram'
        ? '레시피 재료나 조리 순서를 추출하지 못했어요. 릴스 캡션을 붙여넣어 주세요.'
        : '레시피 재료나 조리 순서를 추출하지 못했어요. 영상 설명글이나 캡션을 붙여넣어 주세요.'
    );
    err.code = 'INCOMPLETE_RECIPE';
    err.fallback = true;
    throw err;
  }

  return recipe;
}

/** @deprecated analyzeVideoTextToRecipe 사용 */
export const analyzeYouTubeTextToRecipe = analyzeVideoTextToRecipe;
