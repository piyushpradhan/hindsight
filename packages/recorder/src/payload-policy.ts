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
export type RecordPayloadsPolicy = "always" | "onError" | "sampled";

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
  }
}
