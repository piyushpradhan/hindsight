/**
 * Versioned recorder log-body parsers. Payload records correlate by both
 * trace/span context and hindsight.payload.ref; event records supply the
 * failure conditions used by incident verification.
 */
import { EVENT_LOG_MARKER, PAYLOAD_LOG_MARKER, type RunEvent } from "@hindsight/shared";

export interface PayloadLogRecord {
  marker: string;
  payloadRef?: string;
  stepIndex?: number;
  kind?: "llm" | "tool";
  request?: unknown;
  response?: unknown;
  args?: unknown;
  output?: unknown;
  toolCallId?: unknown;
  schemaVersion?: unknown;
  bytes?: unknown;
  hash?: unknown;
  truncated?: unknown;
  redacted?: unknown;
  /** Extra fields from the recorder are tolerated and carried along. */
  [extra: string]: unknown;
}

export function parsePayloadLogBody(body: unknown): PayloadLogRecord | null {
  let obj: unknown = body;
  if (typeof body === "string") {
    try {
      obj = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!obj || typeof obj !== "object" || Array.isArray(obj)) return null;
  const rec = obj as Record<string, unknown>;
  if (rec.marker !== PAYLOAD_LOG_MARKER) return null;
  return {
    ...rec,
    marker: rec.marker,
    payloadRef: typeof rec.payloadRef === "string" ? rec.payloadRef : undefined,
    stepIndex: typeof rec.stepIndex === "number" ? rec.stepIndex : undefined,
    kind: rec.kind === "llm" || rec.kind === "tool" ? rec.kind : undefined,
    request: rec.request,
    response: rec.response,
    args: rec.args,
    output: rec.output,
  };
}

export function parseEventLogBody(body: unknown): RunEvent | null {
  let value: unknown = body;
  if (typeof body === "string") {
    try {
      value = JSON.parse(body);
    } catch {
      return null;
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const event = value as Record<string, unknown>;
  if (event.marker !== EVENT_LOG_MARKER || typeof event.event !== "string") return null;
  return {
    event: event.event,
    runId: typeof event.runId === "string" ? event.runId : undefined,
    agentId: typeof event.agentId === "string" ? event.agentId : undefined,
    errorType: typeof event.errorType === "string" ? event.errorType : undefined,
    toolName: typeof event.toolName === "string" ? event.toolName : undefined,
    score: typeof event.score === "number" ? event.score : undefined,
  };
}
