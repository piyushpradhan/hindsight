/**
 * The recorder: wraps an agent's LLM calls and tool calls in OTel spans, emits
 * correlated payload log records, and drives the Hindsight metrics. The public
 * surface (createRecorder / startRun / Run.llm / Run.tool / Run.end) is a
 * frozen contract — the demo agents and the future fork executor depend on it.
 *
 * Provider-agnostic by design: `run.llm` takes a thunk that produces a
 * completion, so no provider SDK is imported here.
 */
import {
  SpanStatusCode,
  context as otelContext,
  trace,
  type Counter,
  type Gauge,
  type Histogram,
  type Meter,
  type Span,
  type SpanContext,
  type Tracer,
} from "@opentelemetry/api";
import { SeverityNumber, type Logger } from "@opentelemetry/api-logs";
import {
  ATTR,
  DEFAULTS,
  EVENT_LOG_MARKER,
  GENAI_ATTR,
  HINDSIGHT_SCHEMA_VERSION,
  METRIC,
  PAYLOAD_LOG_MARKER,
  PRICE_TABLE_VERSION,
  RECORDER_VERSION,
  computeCostUsd,
  type ChatMessage,
  type RunOutcome,
} from "@hindsight/shared";
import { hashToolArgs } from "./hash.js";
import { initOtel, type OtelHandles } from "./otel.js";
import {
  protectPayload,
  runIsSampled,
  shouldRecordPayload,
  type PayloadMode,
  type RecordPayloadsPolicy,
} from "./payload-policy.js";

/* -------------------------------- options --------------------------------- */

export interface RecorderOptions {
  otlpHttpUrl?: string;
  recordPayloads?: RecordPayloadsPolicy;
  /** Extra/override model prices. Unknown models remain unknown. */
  priceTable?: Record<string, { inputPer1M: number; outputPer1M: number }>;
  /** off records no payloads; redacted is the safe default; full stores raw payloads. */
  payloadMode?: PayloadMode;
  maxPayloadBytes?: number;
  redactPayload?: (value: unknown) => unknown;
  /** Fixed service name; defaults to a shared "hindsight-recorder". */
  serviceName?: string;
  /**
   * Register as the global OTel providers (default true). Set false when the
   * host process already owns the globals (e.g. the fork executor inside the
   * replay-engine) so the recorder runs purely off its own handles.
   */
  register?: boolean;
}

export interface LlmParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  system?: string;
  /** Provider label for gen_ai.system; defaults to "mock". */
  provider?: string;
}

/** Minimal shape the recorder reads off a completion to fill token attrs. */
export interface LlmUsageLike {
  usage?: {
    input_tokens?: number;
    output_tokens?: number;
    prompt_tokens?: number;
    completion_tokens?: number;
  };
  model?: string;
}

export interface StartRunOptions {
  agentId: string;
  agentRevision?: string;
  taskId?: string;
  /** Fork branches preserve the original timeline index. */
  startStepIndex?: number;
  fork?: ForkInfo;
}

export interface ForkInfo {
  /** Trace id of the original run. */
  of: string;
  /** Step index the fork diverges at. */
  point: number;
  mutation: object;
  mutationHash: string;
  incidentId?: string;
  /** Original run's root span context, for a proper OTel span link. */
  originalSpanContext?: SpanContext;
}

/* --------------------------- module-level state --------------------------- */

/** Loop-detection window: repeats within the last N steps count toward score. */
const LOOP_WINDOW = 8;

/** Monotonic run ordinal, drives the "sampled" payload policy. */
let RUN_ORDINAL = 0;

/* -------------------------------- recorder -------------------------------- */

export interface Recorder {
  startRun(opts: StartRunOptions): Run;
  shutdown(): Promise<void>;
}

interface Metrics {
  runs: Counter;
  tokens: Counter;
  cost: Counter;
  stepDuration: Histogram;
  toolErrors: Counter;
  loopScore: Gauge;
}

export function createRecorder(options: RecorderOptions = {}): Recorder {
  const otel = initOtel({
    otlpHttpUrl: options.otlpHttpUrl ?? DEFAULTS.otlpHttpUrl,
    serviceName: options.serviceName,
    register: options.register,
  });
  return recorderFromOtel(otel, options.recordPayloads ?? "always", options);
}

/**
 * Build a Recorder around pre-wired OTel handles. Used by createRecorder and,
 * in tests, with in-memory exporters so assertions never touch live SigNoz.
 */
export function recorderFromOtel(
  otel: OtelHandles,
  policy: RecordPayloadsPolicy,
  options: Pick<
    RecorderOptions,
    "priceTable" | "payloadMode" | "maxPayloadBytes" | "redactPayload"
  > = {},
): Recorder {
  const m = buildMetrics(otel.meter);

  return {
    startRun(opts: StartRunOptions): Run {
      return new Run(opts, policy, otel, m, options);
    },
    async shutdown(): Promise<void> {
      await otel.shutdown();
    },
  };
}

function buildMetrics(meter: Meter): Metrics {
  return {
    runs: meter.createCounter(METRIC.RUNS_TOTAL, { description: "Runs by outcome" }),
    tokens: meter.createCounter(METRIC.TOKENS_TOTAL, { description: "Tokens by direction" }),
    cost: meter.createCounter(METRIC.COST_USD_TOTAL, { description: "USD cost" }),
    stepDuration: meter.createHistogram(METRIC.STEP_DURATION, {
      description: "Step duration (ms)",
      unit: "ms",
    }),
    toolErrors: meter.createCounter(METRIC.TOOL_ERRORS_TOTAL, { description: "Tool errors" }),
    loopScore: meter.createGauge(METRIC.LOOP_SCORE, { description: "Current loop score" }),
  };
}

/* ----------------------------------- run ---------------------------------- */

export class Run {
  readonly runId: string;
  readonly traceId: string;
  private readonly root: Span;
  private readonly rootCtx: ReturnType<typeof trace.setSpan>;
  private readonly agentId: string;
  private readonly tracer: Tracer;
  private readonly logger: Logger;
  private stepIndex: number;
  private stepsRecorded = 0;
  private ended = false;
  private readonly startedAt = Date.now();
  private readonly runSampled: boolean;
  private totalTokens = 0;
  private tokensKnown = true;
  private totalCostUsd = 0;
  private costKnown = true;
  private payloadComplete = true;
  private lastErrorType?: string;
  private loopEventEmitted = false;
  /** Rolling window of (toolName + argsHash) fingerprints for loop scoring. */
  private readonly toolWindow: string[] = [];

  constructor(
    opts: StartRunOptions,
    private readonly policy: RecordPayloadsPolicy,
    private readonly otel: OtelHandles,
    private readonly metrics: Metrics,
    private readonly options: Pick<
      RecorderOptions,
      "priceTable" | "payloadMode" | "maxPayloadBytes" | "redactPayload"
    >,
  ) {
    this.runId = randomUuid();
    this.agentId = opts.agentId;
    this.stepIndex = opts.startStepIndex ?? 0;
    this.tracer = this.otel.tracer;
    this.logger = this.otel.logger;
    this.runSampled = runIsSampled(RUN_ORDINAL++);

    const attributes: Record<string, string | number> = {
      [ATTR.SCHEMA_VERSION]: HINDSIGHT_SCHEMA_VERSION,
      [ATTR.RECORDER_VERSION]: RECORDER_VERSION,
      [ATTR.RUN_ID]: this.runId,
      [ATTR.AGENT_ID]: opts.agentId,
    };
    if (opts.agentRevision) attributes[ATTR.AGENT_REVISION] = opts.agentRevision;
    if (opts.taskId) attributes[ATTR.TASK_ID] = opts.taskId;
    if (opts.fork) {
      attributes[ATTR.FORK_OF] = opts.fork.of;
      attributes[ATTR.FORK_POINT] = opts.fork.point;
      attributes[ATTR.FORK_MUTATION] = JSON.stringify(opts.fork.mutation);
      attributes[ATTR.FORK_MUTATION_HASH] = opts.fork.mutationHash;
      if (opts.fork.incidentId) attributes[ATTR.INCIDENT_ID] = opts.fork.incidentId;
    }

    const links =
      opts.fork?.originalSpanContext !== undefined
        ? [{ context: opts.fork.originalSpanContext }]
        : undefined;

    this.root = this.tracer.startSpan(
      `run ${opts.agentId}`,
      { attributes, links },
      otelContext.active(),
    );
    this.rootCtx = trace.setSpan(otelContext.active(), this.root);
    this.traceId = this.root.spanContext().traceId;
  }

  /** OTel span context of this run's root — passed to forks as a link target. */
  spanContext(): SpanContext {
    return this.root.spanContext();
  }

  recordedStepCount(): number {
    return this.stepsRecorded;
  }

  /**
   * Wrap an LLM call. `params` supplies request metadata; `call` performs the
   * actual completion (a thunk, so no provider SDK is coupled in here).
   */
  async llm<T extends LlmUsageLike>(call: () => Promise<T>, params: LlmParams): Promise<T> {
    const index = this.stepIndex++;
    this.stepsRecorded++;
    const payloadRef = this.payloadRef(index);
    const provider = params.provider ?? "mock";
    const span = this.tracer.startSpan(
      params.model,
      {
        attributes: {
          [ATTR.STEP_INDEX]: index,
          [ATTR.STEP_KIND]: "llm",
          [ATTR.PAYLOAD_REF]: payloadRef,
          [ATTR.SCHEMA_VERSION]: HINDSIGHT_SCHEMA_VERSION,
          [GENAI_ATTR.OPERATION_NAME]: "chat",
          [GENAI_ATTR.PROVIDER_NAME]: provider,
          // Keep the legacy provider key for the v0 → v1 read window.
          [GENAI_ATTR.SYSTEM]: provider,
          [GENAI_ATTR.REQUEST_MODEL]: params.model,
          ...(params.temperature !== undefined
            ? { [GENAI_ATTR.TEMPERATURE]: params.temperature }
            : {}),
          ...(params.max_tokens !== undefined
            ? { [GENAI_ATTR.MAX_TOKENS]: params.max_tokens }
            : {}),
        },
      },
      this.rootCtx,
    );
    const spanCtx = trace.setSpan(this.rootCtx, span);
    const startedAt = Date.now();

    try {
      const response = await otelContext.with(spanCtx, call);
      const inputTokens = readTokens(response, "input");
      const outputTokens = readTokens(response, "output");
      const cost =
        inputTokens !== undefined && outputTokens !== undefined
          ? computeCostUsd(params.model, inputTokens, outputTokens, this.options.priceTable)
          : undefined;

      if (inputTokens !== undefined) span.setAttribute(GENAI_ATTR.INPUT_TOKENS, inputTokens);
      if (outputTokens !== undefined) span.setAttribute(GENAI_ATTR.OUTPUT_TOKENS, outputTokens);
      if (cost !== undefined) {
        span.setAttribute(ATTR.COST_USD, cost);
        span.setAttribute(ATTR.PRICE_SOURCE, "recorder");
        span.setAttribute(ATTR.PRICE_VERSION, PRICE_TABLE_VERSION);
      } else {
        span.setAttribute(ATTR.PRICE_SOURCE, "unknown");
        span.setAttribute(ATTR.PRICE_VERSION, PRICE_TABLE_VERSION);
      }
      if (response.model) span.setAttribute(GENAI_ATTR.RESPONSE_MODEL, response.model);

      if (inputTokens === undefined || outputTokens === undefined) {
        this.tokensKnown = false;
      } else {
        this.totalTokens += inputTokens + outputTokens;
        this.metrics.tokens.add(inputTokens, {
          [ATTR.AGENT_ID]: this.agentId,
          [GENAI_ATTR.REQUEST_MODEL]: params.model,
          [ATTR.TOKEN_DIRECTION]: "input",
        });
        this.metrics.tokens.add(outputTokens, {
          [ATTR.AGENT_ID]: this.agentId,
          [GENAI_ATTR.REQUEST_MODEL]: params.model,
          [ATTR.TOKEN_DIRECTION]: "output",
        });
      }
      if (cost === undefined) {
        this.costKnown = false;
      } else {
        this.totalCostUsd += cost;
        this.metrics.cost.add(cost, {
          [ATTR.AGENT_ID]: this.agentId,
          [GENAI_ATTR.REQUEST_MODEL]: params.model,
        });
      }

      this.emitPayload(spanCtx, {
        payloadRef,
        stepIndex: index,
        kind: "llm",
        errored: false,
        body: {
          request: {
            messages: params.messages,
            system: params.system,
            model: params.model,
            temperature: params.temperature,
            maxTokens: params.max_tokens,
            provider,
          },
          response,
        },
      });
      this.finishStep(span, "llm", startedAt, false);
      return response;
    } catch (err) {
      this.tokensKnown = false;
      this.costKnown = false;
      this.recordError(span, err);
      this.emitPayload(spanCtx, {
        payloadRef,
        stepIndex: index,
        kind: "llm",
        errored: true,
        body: {
          request: {
            messages: params.messages,
            system: params.system,
            model: params.model,
            temperature: params.temperature,
            maxTokens: params.max_tokens,
            provider,
          },
          response: errorPayload(err),
        },
      });
      this.finishStep(span, "llm", startedAt, true);
      throw err;
    }
  }

  /**
   * Wrap a tool call. `name` is the tool name (also the span name — the replay
   * builder reads the tool name off span.name). `args` are hashed for loop
   * detection and mock matching; `call` runs the tool.
   */
  async tool<T>(
    name: string,
    args: unknown,
    call: () => Promise<T>,
    metadata: { toolCallId?: string } = {},
  ): Promise<T> {
    const index = this.stepIndex++;
    this.stepsRecorded++;
    const payloadRef = this.payloadRef(index);
    const argsHash = hashToolArgs(args);
    this.observeLoop(name, argsHash);

    const span = this.tracer.startSpan(
      name,
      {
        attributes: {
          [ATTR.STEP_INDEX]: index,
          [ATTR.STEP_KIND]: "tool",
          [ATTR.PAYLOAD_REF]: payloadRef,
          [ATTR.SCHEMA_VERSION]: HINDSIGHT_SCHEMA_VERSION,
          [ATTR.TOOL_NAME]: name,
          [ATTR.ARGS_HASH]: argsHash,
          ...(metadata.toolCallId ? { [ATTR.TOOL_CALL_ID]: metadata.toolCallId } : {}),
        },
      },
      this.rootCtx,
    );
    const spanCtx = trace.setSpan(this.rootCtx, span);
    const startedAt = Date.now();

    try {
      const output = await otelContext.with(spanCtx, call);
      this.emitPayload(spanCtx, {
        payloadRef,
        stepIndex: index,
        kind: "tool",
        errored: false,
        body: { args, output, toolCallId: metadata.toolCallId },
      });
      this.finishStep(span, "tool", startedAt, false);
      return output;
    } catch (err) {
      this.recordError(span, err);
      this.metrics.toolErrors.add(1, {
        [ATTR.AGENT_ID]: this.agentId,
        [ATTR.TOOL_NAME]: name,
      });
      this.emitPayload(spanCtx, {
        payloadRef,
        stepIndex: index,
        kind: "tool",
        errored: true,
        body: { args, output: errorPayload(err), toolCallId: metadata.toolCallId },
      });
      this.finishStep(span, "tool", startedAt, true);
      throw err;
    }
  }

  /** Current loop score: max repeat count of any fingerprint in the window. */
  loopScore(): number {
    const counts = new Map<string, number>();
    let max = 0;
    for (const fp of this.toolWindow) {
      const n = (counts.get(fp) ?? 0) + 1;
      counts.set(fp, n);
      if (n > max) max = n;
    }
    return max;
  }

  /** Finalize the run. Sets outcome, emits the runs metric, ends the root span. */
  end(result: { outcome: RunOutcome }): void {
    if (this.ended) return;
    this.ended = true;
    this.root.setAttribute(ATTR.OUTCOME, result.outcome);
    this.root.setAttribute(ATTR.RUN_STEP_COUNT, this.stepsRecorded);
    this.root.setAttribute(ATTR.RUN_DURATION_MS, Date.now() - this.startedAt);
    this.root.setAttribute(ATTR.PAYLOAD_COMPLETE, this.payloadComplete);
    this.root.setAttribute(ATTR.PAYLOAD_CAPTURE_POLICY, this.options.payloadMode ?? "redacted");
    if (this.tokensKnown) this.root.setAttribute(ATTR.RUN_TOKENS_TOTAL, this.totalTokens);
    if (this.costKnown) this.root.setAttribute(ATTR.RUN_COST_USD, this.totalCostUsd);
    if (this.lastErrorType) this.root.setAttribute(GENAI_ATTR.ERROR_TYPE, this.lastErrorType);
    if (result.outcome !== "success") {
      this.root.setStatus({ code: SpanStatusCode.ERROR });
      this.emitEvent(
        this.rootCtx,
        "run_failed",
        {
          outcome: result.outcome,
          errorType: this.lastErrorType ?? "unknown",
        },
        SeverityNumber.ERROR,
      );
    }
    this.metrics.runs.add(1, {
      [ATTR.AGENT_ID]: this.agentId,
      [ATTR.OUTCOME]: result.outcome,
    });
    this.root.end();
  }

  /* ------------------------------ internals ------------------------------ */

  private payloadRef(index: number): string {
    return `${this.runId}:${index}`;
  }

  private observeLoop(name: string, argsHash: string): void {
    this.toolWindow.push(`${name} ${argsHash}`);
    if (this.toolWindow.length > LOOP_WINDOW) this.toolWindow.shift();
    const score = this.loopScore();
    this.metrics.loopScore.record(score, {
      [ATTR.AGENT_ID]: this.agentId,
      [ATTR.RUN_ID]: this.runId,
    });
    if (score >= 3 && !this.loopEventEmitted) {
      this.loopEventEmitted = true;
      this.emitEvent(
        this.rootCtx,
        "loop_detected",
        { toolName: name, argsHash, score },
        SeverityNumber.ERROR,
      );
    }
  }

  private finishStep(span: Span, kind: string, startedAt: number, errored: boolean): void {
    this.metrics.stepDuration.record(Date.now() - startedAt, {
      [ATTR.AGENT_ID]: this.agentId,
      [ATTR.STEP_KIND]: kind,
    });
    if (!errored) span.setStatus({ code: SpanStatusCode.OK });
    span.end();
  }

  private recordError(span: Span, err: unknown): void {
    const type = errorType(err);
    this.lastErrorType = type;
    span.setAttribute(GENAI_ATTR.ERROR_TYPE, type);
    span.recordException(err instanceof Error ? err : new Error(String(err)));
    span.setStatus({ code: SpanStatusCode.ERROR, message: type });
  }

  private emitPayload(
    ctx: ReturnType<typeof trace.setSpan>,
    p: {
      payloadRef: string;
      stepIndex: number;
      kind: "llm" | "tool";
      errored: boolean;
      body: Record<string, unknown>;
    },
  ): void {
    const record =
      (this.options.payloadMode ?? "redacted") !== "off" &&
      shouldRecordPayload({
        policy: this.policy,
        errored: p.errored,
        runSampled: this.runSampled,
      });
    if (!record) {
      this.payloadComplete = false;
      return;
    }
    const payload = protectPayload(p.body, {
      mode: this.options.payloadMode ?? "redacted",
      maxBytes: this.options.maxPayloadBytes,
      redact: this.options.redactPayload,
    });
    this.payloadComplete &&= payload.complete;
    const body = JSON.stringify({
      marker: PAYLOAD_LOG_MARKER,
      schemaVersion: HINDSIGHT_SCHEMA_VERSION,
      payloadRef: p.payloadRef,
      stepIndex: p.stepIndex,
      kind: p.kind,
      bytes: payload.bytes,
      hash: payload.hash,
      truncated: payload.truncated,
      redacted: payload.redacted,
      ...(payload.body ?? {}),
    });
    // Pass the step span's context explicitly so the log record inherits its
    // trace_id/span_id (also correct without a registered ContextManager).
    this.logger.emit({
      context: ctx,
      severityNumber: p.errored ? SeverityNumber.ERROR : SeverityNumber.INFO,
      body,
      attributes: { [PAYLOAD_LOG_MARKER]: true },
    });
  }

  private emitEvent(
    ctx: ReturnType<typeof trace.setSpan>,
    event: string,
    detail: Record<string, unknown>,
    severityNumber: SeverityNumber,
  ): void {
    this.logger.emit({
      context: ctx,
      severityNumber,
      body: JSON.stringify({
        marker: EVENT_LOG_MARKER,
        schemaVersion: HINDSIGHT_SCHEMA_VERSION,
        event,
        runId: this.runId,
        agentId: this.agentId,
        ...detail,
      }),
      attributes: {
        [EVENT_LOG_MARKER]: true,
        [ATTR.RUN_ID]: this.runId,
        [ATTR.AGENT_ID]: this.agentId,
        [ATTR.EVENT_NAME]: event,
        ...(typeof detail.errorType === "string"
          ? { [GENAI_ATTR.ERROR_TYPE]: detail.errorType }
          : {}),
        ...(typeof detail.toolName === "string"
          ? { [ATTR.TOOL_NAME]: detail.toolName }
          : {}),
        ...(typeof detail.score === "number"
          ? { [METRIC.LOOP_SCORE]: detail.score }
          : {}),
      },
    });
  }
}

/* -------------------------------- helpers --------------------------------- */

function randomUuid(): string {
  return globalThis.crypto.randomUUID();
}

function readTokens(resp: LlmUsageLike, dir: "input" | "output"): number | undefined {
  const u = resp.usage ?? {};
  if (dir === "input") return num(u.input_tokens) ?? num(u.prompt_tokens);
  return num(u.output_tokens) ?? num(u.completion_tokens);
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

function errorType(err: unknown): string {
  if (err instanceof Error) return err.name === "Error" ? err.message.slice(0, 64) : err.name;
  return String(err).slice(0, 64);
}

function errorPayload(err: unknown): { error: string } {
  return { error: err instanceof Error ? err.message : String(err) };
}
