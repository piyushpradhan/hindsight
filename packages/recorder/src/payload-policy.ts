/**
 * Decides whether a given step's full payload (LLM messages / tool I/O) should
 * be written as a payload log record. Payloads can be large, so production
 * deployments dial this down; the demo defaults to "always".
 *
 *   - "always"  : record every step.
 *   - "onError" : record only steps that failed (error !== undefined).
 *   - "sampled" : record all steps, but only for ~1 in N runs (run-level
 *                 sampling keeps a sampled run's timeline complete instead of
 *                 recording a random scatter of steps).
 */
import { createHash } from "node:crypto";

export type RecordPayloadsPolicy = "always" | "onError" | "sampled" | "never";
export type PayloadMode = "off" | "redacted" | "full";

export const DEFAULT_MAX_PAYLOAD_BYTES = 256 * 1024;

/** 1 in SAMPLE_EVERY runs is fully recorded under the "sampled" policy. */
export const SAMPLE_EVERY = 5;

/** Per-run seed used by the "sampled" policy; incremented once per run. */
export function runIsSampled(runOrdinal: number): boolean {
  return runOrdinal % SAMPLE_EVERY === 0;
}

export interface PayloadDecisionInput {
  policy: RecordPayloadsPolicy;
  /** Whether this specific step errored. */
  errored: boolean;
  /** Whether the current run is in the sampled cohort (see runIsSampled). */
  runSampled: boolean;
}

/** True when the payload log record for this step should be emitted. */
export function shouldRecordPayload(input: PayloadDecisionInput): boolean {
  switch (input.policy) {
    case "always":
      return true;
    case "onError":
      return input.errored;
    case "sampled":
      return input.runSampled;
    case "never":
      return false;
  }
}

export interface ProtectedPayload {
  body?: Record<string, unknown>;
  bytes: number;
  hash: string;
  truncated: boolean;
  redacted: boolean;
  complete: boolean;
}

const SECRET_KEY =
  /^(authorization|api[-_]?key|access[-_]?token|auth[-_]?token|secret|password|cookie|set-cookie)$/i;

/** Redact common secret-bearing keys, then fail closed if the JSON exceeds the cap. */
export function protectPayload(
  body: Record<string, unknown>,
  options: {
    mode: PayloadMode;
    maxBytes?: number;
    redact?: (value: unknown) => unknown;
  },
): ProtectedPayload {
  if (options.mode === "off") {
    return { bytes: 0, hash: "", truncated: false, redacted: false, complete: false };
  }

  let value: unknown = body;
  let redacted = false;
  if (options.mode === "redacted") {
    const result = redactSecrets(body);
    value = result.value;
    redacted = result.redacted;
  }
  if (options.redact) {
    value = options.redact(value);
    redacted = true;
  }

  let json: string;
  try {
    json = JSON.stringify(value);
  } catch {
    return { bytes: 0, hash: "", truncated: true, redacted, complete: false };
  }
  const bytes = Buffer.byteLength(json);
  const hash = createHash("sha256").update(json).digest("hex");
  if (bytes > (options.maxBytes ?? DEFAULT_MAX_PAYLOAD_BYTES)) {
    return { bytes, hash, truncated: true, redacted, complete: false };
  }
  return {
    body: value as Record<string, unknown>,
    bytes,
    hash,
    truncated: false,
    redacted,
    complete: !redacted,
  };
}

function redactSecrets(value: unknown): { value: unknown; redacted: boolean } {
  if (Array.isArray(value)) {
    let redacted = false;
    const array = value.map((item) => {
      const result = redactSecrets(item);
      redacted ||= result.redacted;
      return result.value;
    });
    return { value: array, redacted };
  }
  if (!value || typeof value !== "object") return { value, redacted: false };

  let redacted = false;
  const object: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
    if (SECRET_KEY.test(key)) {
      object[key] = "[REDACTED]";
      redacted = true;
      continue;
    }
    const result = redactSecrets(item);
    object[key] = result.value;
    redacted ||= result.redacted;
  }
  return { value: object, redacted };
}
