/**
 * ============================================================================
 * ASSUMED PAYLOAD LOG BODY SHAPE — packages/recorder DID NOT EXIST when this
 * was written. When the recorder lands, reconcile this parser with reality.
 *
 * Payload log records are OTel *logs* (not span attributes — attributes have
 * practical size limits, see packages/shared/src/telemetry.ts). The log body
 * is a JSON string (or already-parsed object) with these fields:
 *
 *   {
 *     marker: PAYLOAD_LOG_MARKER,   // "hindsight.payload" — REQUIRED, filter key
 *     payloadRef: string,           // matches span attr hindsight.payload.ref
 *     stepIndex: number,            // matches span attr hindsight.step.index
 *     kind: "llm" | "tool",
 *     // llm payloads:
 *     request?: ChatMessage[],      // full prompt/messages
 *     response?: unknown,           // full completion
 *     // tool payloads:
 *     args?: unknown,               // tool call arguments
 *     output?: unknown              // tool result
 *   }
 *
 * Correlation to a span happens two ways and BOTH are honored (see
 * rungraph/builder.ts): the log record's own trace_id/span_id fields, and
 * payloadRef <-> span attribute hindsight.payload.ref.
 *
 * Parsing is DEFENSIVE: extra fields are preserved and ignored by consumers;
 * missing optional fields yield undefined; a wrong marker or non-JSON body
 * yields null (the record is skipped, never fatal).
 * ============================================================================
 */
import { PAYLOAD_LOG_MARKER } from "@hindsight/shared";

export interface PayloadLogRecord {
  marker: string;
  payloadRef?: string;
  stepIndex?: number;
  kind?: "llm" | "tool";
  request?: unknown;
  response?: unknown;
  args?: unknown;
  output?: unknown;
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
