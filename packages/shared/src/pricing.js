export const PRICE_TABLE = {
    "claude-haiku-4-5": { inputPer1M: 1.0, outputPer1M: 5.0 },
    "claude-sonnet-4-5": { inputPer1M: 3.0, outputPer1M: 15.0 },
    "claude-opus-4-1": { inputPer1M: 15.0, outputPer1M: 75.0 },
    "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
    "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
};
const FALLBACK = { inputPer1M: 1.0, outputPer1M: 5.0 };
/** Prefix match so dated model ids (e.g. "claude-haiku-4-5-20251001") resolve. */
export function lookupPrice(model) {
    if (PRICE_TABLE[model])
        return PRICE_TABLE[model];
    const key = Object.keys(PRICE_TABLE).find((k) => model.startsWith(k));
    return key ? PRICE_TABLE[key] : FALLBACK;
}
export function computeCostUsd(model, inputTokens, outputTokens) {
    const p = lookupPrice(model);
    return (inputTokens * p.inputPer1M + outputTokens * p.outputPer1M) / 1_000_000;
}
//# sourceMappingURL=pricing.js.map