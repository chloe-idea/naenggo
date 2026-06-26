const VALID_CATEGORIES = new Set([
  'korean', 'western', 'japanese', 'chinese', 'diet', 'high-protein',
]);
const VALID_DIFFICULTIES = new Set(['쉬움', '보통', '어려움']);

const SYSTEM_PROMPT = `당신은 요리 레시피 추출 전문가입니다. YouTube 영상의 자막 또는 설명 텍스트에서 레시피만 추출하세요.
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
텍스트에 레시피 정보가 없으면 error 필드에 "NOT_A_RECIPE"를 넣으세요.`;

function cleanStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((s) => String(s).trim()).filter(Boolean);
}

function normalizeRecipe(raw, meta) {
  const title = String(raw.title || meta.title || '영상 레시피').trim().slice(0, 80);
  const category = VALID_CATEGORIES.has(raw.category) ? raw.category : 'korean';

  return {
    title,
    sourceUrl: meta.sourceUrl,
    sourcePlatform: 'youtube',
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

export async function analyzeYouTubeTextToRecipe(youtubeContent) {
  const { text, sourceUrl, title, thumbnailUrl, textSource } = youtubeContent;

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    const err = new Error('서버에 OpenAI API Key가 설정되지 않았습니다.');
    err.code = 'MISSING_OPENAI_KEY';
    throw err;
  }

  const model = process.env.OPENAI_MODEL || 'gpt-4o-mini';
  const endpoint = process.env.OPENAI_ENDPOINT || 'https://api.openai.com/v1/chat/completions';

  const userContent = [
    `영상 URL: ${sourceUrl}`,
    title ? `영상 제목: ${title}` : '',
    textSource ? `텍스트 출처: ${textSource}` : '',
    '',
    '텍스트:',
    text.slice(0, 14000),
  ].filter(Boolean).join('\n');

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
        { role: 'system', content: SYSTEM_PROMPT },
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

  if (parsed.error === 'NOT_A_RECIPE') {
    const err = new Error(
      '이 영상에서 레시피 정보를 찾지 못했어요. 영상 설명이나 자막을 붙여넣으면 레시피로 정리해드릴게요.'
    );
    err.code = 'NOT_A_RECIPE';
    err.fallback = true;
    throw err;
  }

  const recipe = normalizeRecipe(parsed, { sourceUrl, thumbnailUrl, title });

  if (!recipe.ingredients.length || !recipe.steps.length) {
    const err = new Error(
      '레시피 재료나 조리 순서를 추출하지 못했어요. 영상 설명이나 자막을 붙여넣으면 레시피로 정리해드릴게요.'
    );
    err.code = 'INCOMPLETE_RECIPE';
    err.fallback = true;
    throw err;
  }

  return recipe;
}
