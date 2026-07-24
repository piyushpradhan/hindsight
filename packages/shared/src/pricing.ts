/**
 * Static price table (USD per 1M tokens). Approximate list prices as of
 * mid-2026 — edit freely; documenting the knob is a maturity signal, not a bug.
 */
export interface ModelPrice {
  inputPer1M: number;
  outputPer1M: number;
}

export const PRICE_TABLE: Record<string, ModelPrice> = {
  "claude-haiku-4-5": { inputPer1M: 1.0, outputPer1M: 5.0 },
  "claude-sonnet-4-5": { inputPer1M: 3.0, outputPer1M: 15.0 },
  "claude-opus-4-1": { inputPer1M: 15.0, outputPer1M: 75.0 },
  "gpt-4o": { inputPer1M: 2.5, outputPer1M: 10.0 },
  "gpt-4o-mini": { inputPer1M: 0.15, outputPer1M: 0.6 },
};

/** Prefix match so dated model ids (e.g. "claude-haiku-4-5-20251001") resolve. */
export function lookupPrice(
  model: string,
  priceTable: Record<string, ModelPrice> = PRICE_TABLE,
): ModelPrice | undefined {
  const table = priceTable === PRICE_TABLE ? PRICE_TABLE : { ...PRICE_TABLE, ...priceTable };
  if (table[model]) return table[model];
  const key = Object.keys(table).find((k) => model.startsWith(k));
  return key ? table[key] : undefined;
}

export function computeCostUsd(
  model: string,
  inputTokens: number,
  outputTokens: number,
  priceTable: Record<string, ModelPrice> = PRICE_TABLE,
): number | undefined {
  const p = lookupPrice(model, priceTable);
  if (!p) return undefined;
  return (inputTokens * p.inputPer1M + outputTokens * p.outputPer1M) / 1_000_000;
}
