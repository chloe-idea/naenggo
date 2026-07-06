/**
 * 레시피 분석용 텍스트 병합
 */
import { buildFullCombinedText } from '../video-text-priority.js';

/** API body의 여러 텍스트 필드를 하나로 병합 */
export function mergeUserTextInput({ userText, caption, description, pastedText } = {}) {
  const chunks = [userText, caption, description, pastedText]
    .map((value) => String(value || '').trim())
    .filter(Boolean);

  const seen = new Set();
  const unique = [];
  for (const chunk of chunks) {
    if (seen.has(chunk)) continue;
    seen.add(chunk);
    unique.push(chunk);
  }
  return unique.join('\n\n');
}

/**
 * title + description + captions/transcript + userPastedText → combinedText
 */
export function combineRecipeText({
  title = '',
  description = '',
  caption = '',
  transcript = '',
  captions = '',
  userPastedText = '',
  userText = '',
} = {}) {
  return buildFullCombinedText({
    title,
    description,
    caption: caption || captions,
    transcript,
    userText: userPastedText || userText,
  });
}

export function isCombinedTextEmpty(combinedText) {
  return String(combinedText || '').trim().length === 0;
}
