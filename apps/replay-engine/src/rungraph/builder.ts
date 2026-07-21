/**
 * Pure RunGraph reconstruction. No I/O, no SigNoz knowledge: spans and
 * payload logs arrive as plain inputs so this module is trivially testable
 * and reusable by the future fork executor (which replays steps the same way).
 */
import {
  ATTR,
  GENAI_ATTR,
  computeCostUsd,
  type ChatMessage,
  type RunGraph,
  type RunOutcome,
  type RunStep,
  type RunSummary,
  type StepKind,
} from "@hindsight/shared";
import type { PayloadLogRecord } from "../payload-shape.js";

export interface SpanInput {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  serviceName?: string;
  startTime: string; // ISO 8601
  durationNano: number;
  attributes: Record<string, string | number | boolean>;
}

export interface PayloadLogInput extends PayloadLogRecord {
  traceId?: string;
  spanId?: string;
  timestamp?: string;
}

const OUTCOMES: readonly RunOutcome[] = ["success", "failure", "timeout"];

export function buildRunGraph(
  traceId: string,
  spans: SpanInput[],
  payloadLogs: PayloadLogInput[],
): RunGraph {
  const steps = mergePayloads(buildSteps(spans), payloadLogs, payloadRefBySpan(spans));
  return { run: summarize(traceId, spans, steps), steps };
}

/** Summary without payload merge — used by /api/runs and /api/fleet. */
export function summarizeSpans(traceId: string, spans: SpanInput[]): RunSummary {
  return summarize(traceId, spans, buildSteps(spans));
}

/* --------------------------------- steps ---------------------------------- */

function buildSteps(spans: SpanInput[]): RunStep[] {
  return spans
    // A step is identified by its kind, not its index: live SigNoz returns 0
    // for absent numeric attributes, so the root span (no step.kind) would
    // otherwise masquerade as step 0. step.kind is the reliable discriminator.
    .filter((s) => s.attributes[ATTR.STEP_KIND] === "llm" || s.attributes[ATTR.STEP_KIND] === "tool")
    .map((s) => {
      const a = s.attributes;
      const kind: StepKind = a[ATTR.STEP_KIND] === "tool" ? "tool" : "llm";
      const model = str(a[GENAI_ATTR.REQUEST_MODEL]) ?? str(a[GENAI_ATTR.RESPONSE_MODEL]);
      const inputTokens = num(a[GENAI_ATTR.INPUT_TOKENS]);
      const outputTokens = num(a[GENAI_ATTR.OUTPUT_TOKENS]);
      const costUsd =
        num(a[ATTR.COST_USD]) ??
        (model !== undefined && inputTokens !== undefined && outputTokens !== undefined
          ? computeCostUsd(model, inputTokens, outputTokens)
          : 0);
      const step: RunStep = {
        index: a[ATTR.STEP_INDEX] as number,
        kind,
        spanId: s.spanId,
        name: kind === "llm" ? model ?? s.name : s.name,
        startTime: s.startTime,
        latencyMs: s.durationNano / 1e6,
        costUsd,
        error: str(a[GENAI_ATTR.ERROR_TYPE]),
      };
      if (kind === "llm") {
        step.model = model;
        step.temperature = num(a[GENAI_ATTR.TEMPERATURE]);
        step.inputTokens = inputTokens;
        step.outputTokens = outputTokens;
      } else {
        step.toolName = s.name;
        step.argsHash = str(a[ATTR.ARGS_HASH]);
      }
      return step;
    })
    .sort((x, y) => x.index - y.index || x.startTime.localeCompare(y.startTime));
}

function payloadRefBySpan(spans: SpanInput[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const s of spans) {
    const ref = str(s.attributes[ATTR.PAYLOAD_REF]);
    if (ref) map.set(s.spanId, ref);
  }
  return map;
}

/** Payloads attach via hindsight.payload.ref first, spanId as fallback. */
function mergePayloads(
  steps: RunStep[],
  logs: PayloadLogInput[],
  refBySpan: Map<string, string>,
): RunStep[] {
  const byRef = new Map<string, PayloadLogInput>();
  const bySpan = new Map<string, PayloadLogInput>();
  for (const log of logs) {
    if (log.payloadRef && !byRef.has(log.payloadRef)) byRef.set(log.payloadRef, log);
    if (log.spanId && !bySpan.has(log.spanId)) bySpan.set(log.spanId, log);
  }
  return steps.map((step) => {
    const ref = refBySpan.get(step.spanId);
    const log = (ref ? byRef.get(ref) : undefined) ?? bySpan.get(step.spanId);
    if (!log) return step;
    if (step.kind === "llm") {
      step.requestMessages = asChatMessages(log.request);
      step.response = log.response ?? log.output;
    } else {
      step.args = log.args;
      step.toolOutput = log.output ?? log.response;
    }
    return step;
  });
}

/* -------------------------------- summary --------------------------------- */

function summarize(traceId: string, spans: SpanInput[], steps: RunStep[]): RunSummary {
  const root =
    spans.find((s) => s.attributes[ATTR.OUTCOME] !== undefined) ??
    spans.find((s) => !s.parentSpanId) ??
    [...spans].sort((a, b) => a.startTime.localeCompare(b.startTime))[0];
  const ra = root?.attributes ?? {};
  const startMs = Math.min(...spans.map((s) => Date.parse(s.startTime)));
  const endMs = Math.max(...spans.map((s) => Date.parse(s.startTime) + s.durationNano / 1e6));
  const anyError = spans.some((s) => s.attributes[GENAI_ATTR.ERROR_TYPE] !== undefined);
  return {
    runId: str(ra[ATTR.RUN_ID]) ?? str(spans[0]?.attributes[ATTR.RUN_ID]) ?? traceId,
    traceId,
    agentId: str(ra[ATTR.AGENT_ID]) ?? str(spans[0]?.attributes[ATTR.AGENT_ID]) ?? "unknown",
    taskId: str(ra[ATTR.TASK_ID]),
    startTime: new Date(startMs).toISOString(),
    endTime: Number.isFinite(endMs) ? new Date(endMs).toISOString() : undefined,
    outcome: asOutcome(ra[ATTR.OUTCOME]) ?? (anyError ? "failure" : "success"),
    stepCount: steps.length,
    totalTokens: steps.reduce((n, s) => n + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0),
    costUsd: steps.reduce((n, s) => n + s.costUsd, 0),
    forkOf: str(ra[ATTR.FORK_OF]),
    error: str(ra[GENAI_ATTR.ERROR_TYPE]),
  };
}

/* -------------------------------- helpers --------------------------------- */

function str(v: unknown): string | undefined {
  return typeof v === "string" && v !== "" ? v : undefined;
}

function num(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v !== "" && !Number.isNaN(Number(v))) return Number(v);
  return undefined;
}

function asOutcome(v: unknown): RunOutcome | undefined {
  return typeof v === "string" && (OUTCOMES as readonly string[]).includes(v)
    ? (v as RunOutcome)
    : undefined;
}

function asChatMessages(v: unknown): ChatMessage[] | undefined {
  if (!Array.isArray(v)) return undefined;
  return v.filter(
    (m): m is ChatMessage =>
      !!m && typeof m === "object" && typeof (m as { role?: unknown }).role === "string",
  );
}
