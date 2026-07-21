/**
 * Chaos injection. Deterministically perturbs a run to exercise the failure
 * modes Hindsight is built to debug. Driven by the CHAOS env var or an explicit
 * option so the seed script and a live demo can trigger specific incidents.
 */
export type ChaosMode =
  | "malformed_tool_json"
  | "tool_timeout"
  | "wrong_tool_loop"
  | "context_flood";

export const CHAOS_MODES: ChaosMode[] = [
  "malformed_tool_json",
  "tool_timeout",
  "wrong_tool_loop",
  "context_flood",
];

export function parseChaos(value: string | undefined): ChaosMode | undefined {
  if (!value) return undefined;
  return (CHAOS_MODES as string[]).includes(value) ? (value as ChaosMode) : undefined;
}

/** Raised inside a tool to simulate a malformed provider/tool response. */
export class MalformedToolJsonError extends Error {
  constructor() {
    super("tool returned malformed JSON");
    this.name = "MalformedToolJsonError";
  }
}

/** Raised inside a tool to simulate a timeout. */
export class ToolTimeoutError extends Error {
  constructor(tool: string) {
    super(`tool ${tool} timed out`);
    this.name = "ToolTimeoutError";
  }
}
