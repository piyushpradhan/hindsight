/**
 * Fork executor — the product's identity. Reconstructs an original run from
 * SigNoz, rebuilds its conversation state up to `forkAtStep`, applies exactly
 * one Mutation, and re-executes live from there. Unchanged tool calls are
 * answered from the recording (the mock policy); the counterfactual is recorded
 * as a brand-new trace, tagged hindsight.fork.of and span-linked to the original.
 *
 * Re-use over re-implementation: the actual agent loop, deterministic mock
 * provider, and tool registry come from @hindsight/demo-agents — the fork just
 * feeds them a rebuilt message prefix + a plan derived from the original run.
 *
 * ponytail: the reconstructed plan is the original run's tool sequence; the mock
 * provider auto-emits a final answer once it's exhausted. Because chaos is not
 * re-injected, a fork of a failed run completes — the mutation is the fix under
 * test. Generalizing beyond the demo agents (arbitrary recorded agents) is the
 * upgrade path if this ever leaves the hackathon.
 */
import { TraceFlags, type SpanContext } from "@opentelemetry/api";
import {
  ATTR,
  type ChatMessage,
  type ForkRequest,
  type ForkResult,
  type MockPolicy,
  type Mutation,
} from "@hindsight/shared";
import { createRecorder, hashToolArgs, type Recorder } from "@hindsight/recorder";
import {
  AGENTS,
  ALL_TOOLS,
  createMockProvider,
  isSafe,
  runAgent,
  type PlanStep,
  type ToolRegistry,
} from "@hindsight/demo-agents";
import { buildRunGraph, type PayloadLogInput, type SpanInput } from "../rungraph/builder.js";
import type { ForkExecutor } from "../routes.js";

/** Just the slice of SignozClient the executor needs (keeps it unit-testable). */
export interface SignozReader {
  getSpansForTrace(traceId: string): Promise<SpanInput[]>;
  getPayloadLogs(traceId: string): Promise<PayloadLogInput[]>;
}

export interface ForkExecutorOptions {
  otlpHttpUrl: string;
  /** Override the recorder (tests inject an in-memory one). */
  recorderFactory?: () => Recorder;
}

export class DemoForkExecutor implements ForkExecutor {
  constructor(
    private readonly signoz: SignozReader,
    private readonly opts: ForkExecutorOptions,
  ) {}

  async execute(request: ForkRequest): Promise<ForkResult> {
    const spans = await this.signoz.getSpansForTrace(request.traceId);
    if (spans.length === 0) {
      return notFound(request.traceId);
    }
    const logs = await this.signoz.getPayloadLogs(request.traceId);
    const graph = buildRunGraph(request.traceId, spans, logs);

    const originalSpanContext = rootSpanContext(request.traceId, spans);
    const recordings = recordingsByHash(graph.steps);
    const override = overrideFor(request.mutation, graph.steps);

    // Rebuild the conversation prefix for steps [0, forkAtStep).
    const initialMessages: ChatMessage[] = [];
    for (const s of graph.steps) {
      if (s.index >= request.forkAtStep) break;
      initialMessages.push(
        s.kind === "llm"
          ? { role: "assistant", content: textOf(s.response) }
          : { role: "tool", content: { name: s.toolName ?? s.name, output: s.toolOutput } },
      );
    }

    // Plan = the original run's tool sequence (mock provider finalizes after).
    let plan: PlanStep[] = graph.steps
      .filter((s) => s.kind === "tool")
      .map((s) => ({ kind: "tool", name: s.toolName ?? s.name, args: asArgs(s.args) }));

    // Defaults from the recorded run / known agent spec, then mutation on top.
    const spec = AGENTS[graph.run.agentId];
    let model = graph.steps.find((s) => s.kind === "llm")?.model ?? "claude-haiku-4-5";
    let system = spec?.system;
    let temperature: number | undefined;
    let maxTokens: number | undefined;
    let tools: ToolRegistry = ALL_TOOLS;

    switch (request.mutation.type) {
      case "model_swap":
        model = request.mutation.model;
        break;
      case "prompt_edit":
        system = request.mutation.newSystemPrompt;
        break;
      case "params":
        temperature = request.mutation.temperature;
        maxTokens = request.mutation.maxTokens;
        break;
      case "disable_tool": {
        const disabled = request.mutation.toolName;
        tools = { ...ALL_TOOLS };
        delete tools[disabled];
        plan = plan.filter((p) => p.kind !== "tool" || p.name !== disabled);
        break;
      }
      case "tool_output_override":
        // Applied through the resolver (`override`) — no re-drive changes here.
        break;
    }

    const resolver = makeResolver(request.mockPolicy, recordings, override);

    const recorder = this.opts.recorderFactory
      ? this.opts.recorderFactory()
      : createRecorder({ otlpHttpUrl: this.opts.otlpHttpUrl, register: false });

    try {
      const result = await runAgent({
        agentId: graph.run.agentId,
        recorder,
        provider: createMockProvider({ seed: 0 }),
        tools,
        system,
        model,
        temperature,
        maxTokens,
        task: spec?.task ?? "Re-run the agent.",
        initialMessages: initialMessages.length ? initialMessages : undefined,
        plan,
        seed: 0,
        toolResolver: resolver,
        fork: {
          of: request.traceId,
          point: request.forkAtStep,
          mutation: request.mutation,
          originalSpanContext,
        },
      });
      return {
        forkRunId: result.runId,
        forkTraceId: result.traceId,
        originalTraceId: request.traceId,
        outcome: result.outcome,
        stepCount: result.steps,
        error: result.error,
      };
    } finally {
      await recorder.shutdown();
    }
  }
}

/* -------------------------------- helpers --------------------------------- */

function notFound(traceId: string): ForkResult {
  return {
    forkRunId: "",
    forkTraceId: "",
    originalTraceId: traceId,
    outcome: "failure",
    stepCount: 0,
    error: "original run not found",
  };
}

/** The root span's context, so the fork can OTel-link back to the original. */
function rootSpanContext(traceId: string, spans: SpanInput[]): SpanContext | undefined {
  const root =
    spans.find((s) => s.attributes[ATTR.OUTCOME] !== undefined) ??
    spans.find((s) => !s.parentSpanId) ??
    spans[0];
  if (!root) return undefined;
  return { traceId, spanId: root.spanId, traceFlags: TraceFlags.SAMPLED, isRemote: true };
}

/** argsHash → recorded tool output (first occurrence wins). */
function recordingsByHash(steps: ReturnType<typeof buildRunGraph>["steps"]): Map<string, unknown> {
  const map = new Map<string, unknown>();
  for (const s of steps) {
    if (s.kind !== "tool") continue;
    const h = s.argsHash ?? hashToolArgs(s.args);
    if (!map.has(h)) map.set(h, s.toolOutput);
  }
  return map;
}

/** For a tool_output_override mutation: (argsHash of the target step → new output). */
function overrideFor(
  mutation: Mutation,
  steps: ReturnType<typeof buildRunGraph>["steps"],
): { hash: string; value: unknown } | undefined {
  if (mutation.type !== "tool_output_override") return undefined;
  const target = steps.find((s) => s.index === mutation.stepIndex && s.kind === "tool");
  if (!target) return undefined;
  return { hash: target.argsHash ?? hashToolArgs(target.args), value: mutation.output };
}

/**
 * The mock policy, as a toolResolver. Returning undefined falls through to the
 * live tool in the agent loop. A tool_output_override always wins.
 */
function makeResolver(
  policy: MockPolicy,
  recordings: Map<string, unknown>,
  override: { hash: string; value: unknown } | undefined,
): (name: string, args: Record<string, unknown>) => unknown {
  return (name, args) => {
    const h = hashToolArgs(args);
    if (override && h === override.hash) return override.value;
    const safe = isSafe(ALL_TOOLS, name);
    const dryRun = { dryRun: true, tool: name, args };
    switch (policy) {
      case "strict":
        if (recordings.has(h)) return recordings.get(h);
        throw new Error(`strict mock policy: no recording for tool "${name}"`);
      case "live":
        return safe ? undefined : dryRun; // everything live; side effects stubbed
      case "hybrid":
      default:
        if (recordings.has(h)) return recordings.get(h);
        return safe ? undefined : dryRun;
    }
  };
}

function asArgs(v: unknown): Record<string, unknown> {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

/** Pull assistant text off a recorded completion for the message prefix. */
function textOf(response: unknown): string {
  if (response && typeof response === "object" && typeof (response as { content?: unknown }).content === "string") {
    return (response as { content: string }).content;
  }
  return "";
}
