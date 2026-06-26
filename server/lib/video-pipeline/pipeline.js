/**
 * 영상 레시피 추출 파이프라인 (2차 확장용)
 *
 * Stage 순서: metadata → userCaption(fallback) → stt → ocr → analyze(OpenAI)
 * 현재 MVP: metadata + userCaption만 활성, stt/ocr은 stub
 */

export const PipelineStageId = {
  METADATA: 'metadata',
  USER_CAPTION: 'userCaption',
  STT: 'stt',
  OCR: 'ocr',
  ANALYZE: 'analyze',
};

/** @typedef {{ id: string, run: (ctx: object) => Promise<object>, required?: boolean }} PipelineStage */

/**
 * @param {PipelineStage[]} stages
 * @param {object} initialContext
 */
export async function runVideoExtractPipeline(stages, initialContext = {}) {
  const context = { ...initialContext, pipelineSteps: [] };

  for (const stage of stages) {
    const step = { id: stage.id, ok: false, skipped: false };
    try {
      const output = await stage.run(context);
      if (output?.skipped) {
        step.skipped = true;
        step.reason = output.reason || 'skipped';
      } else {
        step.ok = true;
        Object.assign(context, output);
      }
    } catch (err) {
      step.error = err?.message || String(err);
      if (stage.required) {
        context.pipelineSteps.push(step);
        throw err;
      }
    }
    context.pipelineSteps.push(step);
  }

  return context;
}

/** 2차: 영상 음성 STT (미구현) */
export async function runSttStage(_context) {
  return {
    skipped: true,
    reason: 'STT not implemented',
    sttText: '',
  };
}

/** 2차: 화면 텍스트 OCR (미구현) */
export async function runOcrStage(_context) {
  return {
    skipped: true,
    reason: 'OCR not implemented',
    ocrText: '',
  };
}
