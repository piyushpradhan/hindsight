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
  RUN_ID: "hindsight.run.id",
  AGENT_ID: "hindsight.agent.id",
  TASK_ID: "hindsight.task.id",
  STEP_INDEX: "hindsight.step.index",
  STEP_KIND: "hindsight.step.kind",
  PAYLOAD_REF: "hindsight.payload.ref",
  ARGS_HASH: "hindsight.args.hash",
  COST_USD: "hindsight.cost.usd",
  OUTCOME: "hindsight.run.outcome",
  FORK_OF: "hindsight.fork.of",
  FORK_POINT: "hindsight.fork.point",
  FORK_MUTATION: "hindsight.fork.mutation",
} as const;

/** GenAI semantic-convention attribute names we rely on. */
export const GENAI_ATTR = {
  SYSTEM: "gen_ai.system",
  REQUEST_MODEL: "gen_ai.request.model",
  RESPONSE_MODEL: "gen_ai.response.model",
  INPUT_TOKENS: "gen_ai.usage.input_tokens",
  OUTPUT_TOKENS: "gen_ai.usage.output_tokens",
  TEMPERATURE: "gen_ai.request.temperature",
  MAX_TOKENS: "gen_ai.request.max_tokens",
  ERROR_TYPE: "error.type",
} as const;

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
} as const;

/** Payload log record marker — body JSON always includes this field. */
export const PAYLOAD_LOG_MARKER = "hindsight.payload";

/** Service name used by demo agents / forks when emitting telemetry. */
export const serviceNameForAgent = (agentId: string) => `hindsight-agent-${agentId}`;
