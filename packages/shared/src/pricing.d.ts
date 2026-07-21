/**
 * Static price table (USD per 1M tokens). Approximate list prices as of
 * mid-2026 — edit freely; documenting the knob is a maturity signal, not a bug.
 */
export interface ModelPrice {
    inputPer1M: number;
    outputPer1M: number;
}
export declare const PRICE_TABLE: Record<string, ModelPrice>;
/** Prefix match so dated model ids (e.g. "claude-haiku-4-5-20251001") resolve. */
export declare function lookupPrice(model: string): ModelPrice;
export declare function computeCostUsd(model: string, inputTokens: number, outputTokens: number): number;
