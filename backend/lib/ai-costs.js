// Central model-cost configuration. Token counts recorded from the OpenAI
// response are authoritative; dollar figures derived here are accounting
// ESTIMATES. Recheck prices against the OpenAI pricing page periodically —
// never treat the estimate as a bill.

export const AI_MODEL = 'gpt-4o-mini';

export const AI_PRICES = {
  'gpt-4o-mini': {
    // USD per 1M tokens. Verified against the OpenAI pricing page 2026-10-06.
    inputPer1M: 0.15,
    outputPer1M: 0.6,
    cachedInputPer1M: 0.075,
    pricingSource: 'OpenAI pricing page, verified 2026-10-06',
  },
};

export function estimateCostUsd(model, inputTokens, outputTokens) {
  const p = AI_PRICES[model];
  if (!p || !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)) return null;
  const cost = (inputTokens / 1e6) * p.inputPer1M + (outputTokens / 1e6) * p.outputPer1M;
  return Math.round(cost * 1e6) / 1e6;
}

// Pre-request diagnostic only (~4 chars/token heuristic). NEVER authoritative;
// the OpenAI response usage is the single source of truth.
export function estimateInputTokens(chars) {
  if (!Number.isFinite(chars) || chars < 0) return null;
  return Math.ceil(chars / 4);
}
