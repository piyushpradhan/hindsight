/**
 * Canonical-JSON sha256 for tool arguments.
 *
 * The same args with keys in a different order MUST hash identically: the
 * fork executor's mock matching and the loop-detection metric both key on
 * hindsight.args.hash, so key order can never be allowed to change the hash.
 * Canonicalization mirrors JSON.stringify semantics (undefined/function
 * object props dropped, non-finite numbers -> null) with one change: object
 * keys are emitted in sorted order, recursively.
 */
import { createHash } from "node:crypto";

/** JSON string of `value` with all object keys recursively sorted. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(normalize(value));
}

/** sha256 hex digest of the canonicalized args — the hindsight.args.hash value. */
export function hashToolArgs(args: unknown): string {
  return createHash("sha256").update(canonicalJson(args), "utf8").digest("hex");
}

function normalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    // JSON.stringify turns undefined/functions in arrays into null.
    return value.map((item) => {
      const n = normalize(item);
      return n === undefined ? null : n;
    });
  }
  if (value !== null && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      const n = normalize((value as Record<string, unknown>)[key]);
      if (n !== undefined) out[key] = n;
    }
    return out;
  }
  if (typeof value === "number" && !Number.isFinite(value)) return null;
  if (typeof value === "bigint") return null; // JSON.stringify would throw
  if (typeof value === "function" || typeof value === "symbol" || value === undefined) {
    return undefined;
  }
  return value;
}
