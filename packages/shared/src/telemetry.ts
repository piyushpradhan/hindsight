/**
 * Telemetry data contract.
 *
 * Spans follow the OpenTelemetry GenAI semantic conventions for everything
 * standard (gen_ai.*). Hindsight extensions live under `hindsight.*`.
 *
 * Key architectural decision: span attributes have practical size limits, so
 * full payloads (LLM messages, tool I/O) are written as OTel *log records*
 * correlated by trace_id/span_id, and spans carry metadata + hashes only.
 */

/** Hindsight-specific span attribute names. */
export const ATTR = {
  SCHEMA_VERSION: "hindsight.schema.version",
  RECORDER_VERSION: "hindsight.recorder.version",
  RUN_ID: "hindsight.run.id",
  AGENT_ID: "hindsight.agent.id",
  AGENT_REVISION: "hindsight.agent.revision",
  TASK_ID: "hindsight.task.id",
  RUN_STEP_COUNT: "hindsight.run.step_count",
  RUN_TOKENS_TOTAL: "hindsight.run.tokens.total",
  RUN_COST_USD: "hindsight.run.cost.usd",
  RUN_DURATION_MS: "hindsight.run.duration.ms",
  STEP_INDEX: "hindsight.step.index",
  STEP_KIND: "hindsight.step.kind",
  TOOL_NAME: "hindsight.tool.name",
  TOOL_CALL_ID: "hindsight.tool.call.id",
  TOKEN_DIRECTION: "hindsight.token.direction",
  EVENT_NAME: "hindsight.event.name",
  PAYLOAD_REF: "hindsight.payload.ref",
  PAYLOAD_COMPLETE: "hindsight.payload.complete",
  PAYLOAD_BYTES: "hindsight.payload.bytes",
  PAYLOAD_TRUNCATED: "hindsight.payload.truncated",
  PAYLOAD_REDACTED: "hindsight.payload.redacted",
  PAYLOAD_CAPTURE_POLICY: "hindsight.payload.capture_policy",
  ARGS_HASH: "hindsight.args.hash",
  COST_USD: "hindsight.cost.usd",
  PRICE_SOURCE: "hindsight.price.source",
  PRICE_VERSION: "hindsight.price.version",
  OUTCOME: "hindsight.run.outcome",
  FORK_OF: "hindsight.fork.of",
  FORK_POINT: "hindsight.fork.point",
  FORK_MUTATION: "hindsight.fork.mutation",
  FORK_MUTATION_HASH: "hindsight.fork.mutation_hash",
  INCIDENT_ID: "hindsight.incident.id",
} as const;

/** GenAI semantic-convention attribute names we rely on. */
export const GENAI_ATTR = {
  OPERATION_NAME: "gen_ai.operation.name",
  PROVIDER_NAME: "gen_ai.provider.name",
  /** Legacy read alias emitted during the v0 → v1 migration window. */
  SYSTEM: "gen_ai.system",
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
  INPUT_TOKENS: "gen_ai.usage.input_tokens",
  OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  TEMPERATURE: "gen_ai.request.temperature",
  MAX_TOKENS: "gen_ai.request.max_tokens",
  ERROR_TYPE: "error.type",
} as const;

export const HINDSIGHT_SCHEMA_VERSION = "1";
export const RECORDER_VERSION = "0.1.0";
export const PRICE_TABLE_VERSION = "2026-07-24";

/** Metric names emitted by the recorder. */
export const METRIC = {
  RUNS_TOTAL: "hindsight.runs.total",
  TOKENS_TOTAL: "hindsight.tokens.total",
  COST_USD_TOTAL: "hindsight.cost.usd.total",
  STEP_DURATION: "hindsight.step.duration",
  TOOL_ERRORS_TOTAL: "hindsight.tool.errors.total",
  LOOP_SCORE: "hindsight.loop.score",
  INCIDENTS_TOTAL: "hindsight.incidents.total",
  FORKS_TOTAL: "hindsight.forks.total",
  FORKS_RESOLVED_TOTAL: "hindsight.forks.resolved.total",
  INCIDENT_RESOLUTION_DURATION: "hindsight.incident.resolution.duration",
} as const;

/** Payload log record marker — body JSON always includes this field. */
export const PAYLOAD_LOG_MARKER = "hindsight.payload";
export const EVENT_LOG_MARKER = "hindsight.event";
