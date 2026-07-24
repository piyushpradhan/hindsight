/**
 * Pure RunGraph reconstruction. No I/O, no SigNoz knowledge: spans and
 * payload logs arrive as plain inputs so this module is trivially testable
 * and reused by replay and fork checkpoint validation.
 */
import {
  ATTR,
  GENAI_ATTR,
  HINDSIGHT_SCHEMA_VERSION,
  computeCostUsd,
  type ChatMessage,
  type CheckpointIssue,
  type CheckpointReport,
  type RunGraph,
  type RunEvent,
  type RunOutcome,
  type RunStep,
  type RunSummary,
  type StepKind,
} from "@hindsight/shared";
import { createHash } from "node:crypto";
import { hashToolArgs } from "@hindsight/recorder";
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
  events: RunEvent[] = [],
): RunGraph {
  const merged = mergePayloads(buildSteps(spans), payloadLogs, payloadRefBySpan(spans));
  const steps = merged.steps;
  const run = summarize(traceId, spans, steps);
  return {
    run,
    steps,
    events,
    checkpoint: checkpointReport(run, steps, merged.evidence),
  };
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
          : kind === "tool"
            ? 0
            : undefined) ??
        null;
      const step: RunStep = {
        index: a[ATTR.STEP_INDEX] as number,
        kind,
        spanId: s.spanId,
        name: kind === "llm" ? model ?? s.name : s.name,
        startTime: s.startTime,
        latencyMs: s.durationNano / 1e6,
        costUsd,
        payloadPresent: false,
        error: str(a[GENAI_ATTR.ERROR_TYPE]),
      };
      if (kind === "llm") {
        step.model = model;
        step.provider =
          str(a[GENAI_ATTR.PROVIDER_NAME]) ?? str(a[GENAI_ATTR.SYSTEM]);
        step.temperature = num(a[GENAI_ATTR.TEMPERATURE]);
        step.maxTokens = num(a[GENAI_ATTR.MAX_TOKENS]);
        step.inputTokens = inputTokens;
        step.outputTokens = outputTokens;
      } else {
        step.toolName = str(a[ATTR.TOOL_NAME]) ?? s.name;
        step.toolCallId = str(a[ATTR.TOOL_CALL_ID]);
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
interface PayloadEvidence {
  hashPresent: boolean;
  hashValid: boolean;
  identityValid: boolean;
  toolCallValid: boolean;
  argsHashValid: boolean;
}

function mergePayloads(
  steps: RunStep[],
  logs: PayloadLogInput[],
  refBySpan: Map<string, string>,
): { steps: RunStep[]; evidence: Map<number, PayloadEvidence> } {
  const byRef = new Map<string, PayloadLogInput>();
  const bySpan = new Map<string, PayloadLogInput>();
  for (const log of logs) {
    if (log.payloadRef && !byRef.has(log.payloadRef)) byRef.set(log.payloadRef, log);
    if (log.spanId && !bySpan.has(log.spanId)) bySpan.set(log.spanId, log);
  }
  const evidence = new Map<number, PayloadEvidence>();
  const merged = steps.map((step) => {
    const ref = refBySpan.get(step.spanId);
    const log = (ref ? byRef.get(ref) : undefined) ?? bySpan.get(step.spanId);
    if (!log) return step;
    const payloadHash = str(log.hash);
    evidence.set(step.index, {
      hashPresent: payloadHash !== undefined,
      hashValid: payloadHash === undefined || payloadHash === hashPayload(log),
      identityValid:
        log.stepIndex === step.index &&
        log.kind === step.kind &&
        log.schemaVersion === HINDSIGHT_SCHEMA_VERSION,
      toolCallValid:
        step.kind !== "tool" ||
        (step.toolCallId !== undefined && step.toolCallId === str(log.toolCallId)),
      argsHashValid:
        step.kind !== "tool" ||
        (step.argsHash !== undefined &&
          log.args !== undefined &&
          step.argsHash === hashToolArgs(log.args)),
    });
    step.payloadPresent = true;
    step.payloadTruncated = log.truncated === true;
    step.payloadRedacted = log.redacted === true;
    if (step.kind === "llm") {
      const request = readLlmRequest(log.request);
      step.requestMessages = request.messages;
      step.systemPrompt = request.system;
      step.model = request.model ?? step.model;
      step.provider = request.provider ?? step.provider;
      step.temperature = request.temperature ?? step.temperature;
      step.maxTokens = request.maxTokens ?? step.maxTokens;
      step.response = log.response ?? log.output;
    } else {
      step.args = log.args;
      step.toolCallId = str(log.toolCallId) ?? step.toolCallId;
      step.toolOutput = log.output ?? log.response;
    }
    return step;
  });
  return { steps: merged, evidence };
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
    stepCount: num(ra[ATTR.RUN_STEP_COUNT]) ?? steps.length,
    totalTokens:
      num(ra[ATTR.RUN_TOKENS_TOTAL]) ??
      (steps.some(
        (s) =>
          s.kind === "llm" &&
          (s.inputTokens === undefined || s.outputTokens === undefined),
      )
        ? null
        : steps.reduce((n, s) => n + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0)),
    costUsd:
      num(ra[ATTR.RUN_COST_USD]) ??
      (steps.some((s) => s.costUsd === null)
        ? null
        : steps.reduce((n, s) => n + (s.costUsd ?? 0), 0)),
    schemaVersion: str(ra[ATTR.SCHEMA_VERSION]),
    payloadComplete: bool(ra[ATTR.PAYLOAD_COMPLETE]) ?? false,
    agentRevision: str(ra[ATTR.AGENT_REVISION]),
    forkOf: str(ra[ATTR.FORK_OF]),
    forkPoint: num(ra[ATTR.FORK_POINT]),
    incidentId: str(ra[ATTR.INCIDENT_ID]),
    mutationHash: str(ra[ATTR.FORK_MUTATION_HASH]),
    error: str(ra[GENAI_ATTR.ERROR_TYPE]),
  };
}

export function checkpointReport(
  run: RunSummary,
  steps: RunStep[],
  evidence: Map<number, PayloadEvidence> = new Map(),
): CheckpointReport {
  const issues: CheckpointIssue[] = [];
  if (run.schemaVersion !== HINDSIGHT_SCHEMA_VERSION) {
    issues.push({
      code: "legacy_schema",
      detail: `recorded schema ${run.schemaVersion ?? "missing"} is not ${HINDSIGHT_SCHEMA_VERSION}`,
    });
  }
  if (!run.payloadComplete) {
    issues.push({
      code: "root_marked_incomplete",
      detail: "root span reports incomplete payload capture",
    });
  }
  if (!run.agentRevision) {
    issues.push({
      code: "missing_agent_revision",
      detail: "agent/runtime revision was not recorded",
    });
  }
  const firstIndex = run.forkPoint ?? 0;
  for (let index = firstIndex; index < firstIndex + run.stepCount; index++) {
    const step = steps.find((candidate) => candidate.index === index);
    if (!step) {
      issues.push({ code: "missing_step", stepIndex: index, detail: `step ${index} is absent` });
      continue;
    }
    if (!step.payloadPresent) {
      issues.push({
        code: "missing_payload",
        stepIndex: index,
        detail: `step ${index} has no correlated payload log`,
      });
    }
    if (step.payloadTruncated) {
      issues.push({
        code: "truncated_payload",
        stepIndex: index,
        detail: `step ${index} payload exceeded the recorder byte limit`,
      });
    }
    if (step.payloadRedacted) {
      issues.push({
        code: "redacted_payload",
        stepIndex: index,
        detail: `step ${index} payload was redacted`,
      });
    }
    const payload = evidence.get(index);
    if (step.payloadPresent && !payload?.hashPresent) {
      issues.push({
        code: "missing_payload_hash",
        stepIndex: index,
        detail: `step ${index} payload has no integrity hash`,
      });
    } else if (payload && !payload.hashValid) {
      issues.push({
        code: "payload_hash_mismatch",
        stepIndex: index,
        detail: `step ${index} payload does not match its recorded hash`,
      });
    }
    if (payload && !payload.identityValid) {
      issues.push({
        code: "payload_identity_mismatch",
        stepIndex: index,
        detail: `step ${index} payload identity or schema does not match its span`,
      });
    }
    if (step.kind === "tool" && !step.toolCallId) {
      issues.push({
        code: "missing_tool_call_id",
        stepIndex: index,
        detail: `tool step ${index} has no provider tool-call id`,
      });
    }
    if (payload && !payload.toolCallValid) {
      issues.push({
        code: "tool_call_mismatch",
        stepIndex: index,
        detail: `tool step ${index} span and payload tool-call ids do not match`,
      });
    }
    if (payload && !payload.argsHashValid) {
      issues.push({
        code: "tool_args_hash_mismatch",
        stepIndex: index,
        detail: `tool step ${index} arguments do not match the span hash`,
      });
    }
  }
  validateToolCallSequence(run, steps, issues);
  return { complete: issues.length === 0, schemaVersion: run.schemaVersion, issues };
}

function validateToolCallSequence(
  run: RunSummary,
  steps: RunStep[],
  issues: CheckpointIssue[],
): void {
  const pending = new Set<string>();
  for (const step of [...steps].sort((a, b) => a.index - b.index)) {
    if (step.kind === "llm") {
      pending.clear();
      const response = step.response as { toolCalls?: unknown } | undefined;
      if (Array.isArray(response?.toolCalls)) {
        for (const call of response.toolCalls) {
          const id =
            call && typeof call === "object"
              ? str((call as Record<string, unknown>).id)
              : undefined;
          if (id) pending.add(id);
        }
      }
      continue;
    }
    if (
      run.forkOf &&
      step.index === run.forkPoint &&
      step.index === steps[0]?.index
    ) {
      continue;
    }
    if (step.toolCallId && !pending.delete(step.toolCallId)) {
      issues.push({
        code: "tool_call_mismatch",
        stepIndex: step.index,
        detail: `tool step ${step.index} was not announced by the preceding LLM response`,
      });
    }
  }
}

function hashPayload(log: PayloadLogInput): string {
  const body =
    log.kind === "llm"
      ? { request: log.request, response: log.response }
      : { args: log.args, output: log.output, toolCallId: log.toolCallId };
  return createHash("sha256").update(JSON.stringify(body)).digest("hex");
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

function readLlmRequest(v: unknown): {
  messages?: ChatMessage[];
  system?: string;
  model?: string;
  provider?: string;
  temperature?: number;
  maxTokens?: number;
} {
  // v0 payloads stored the message array directly.
  if (Array.isArray(v)) return { messages: asChatMessages(v) };
  if (!v || typeof v !== "object") return {};
  const request = v as Record<string, unknown>;
  return {
    messages: asChatMessages(request.messages),
    system: str(request.system),
    model: str(request.model),
    provider: str(request.provider),
    temperature: num(request.temperature),
    maxTokens: num(request.maxTokens),
  };
}

function bool(v: unknown): boolean | undefined {
  if (typeof v === "boolean") return v;
  if (v === "true") return true;
  if (v === "false") return false;
  return undefined;
}
