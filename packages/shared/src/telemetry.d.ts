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
export declare const ATTR: {
    readonly RUN_ID: "hindsight.run.id";
    readonly AGENT_ID: "hindsight.agent.id";
    readonly TASK_ID: "hindsight.task.id";
    readonly STEP_INDEX: "hindsight.step.index";
    readonly STEP_KIND: "hindsight.step.kind";
    readonly PAYLOAD_REF: "hindsight.payload.ref";
    readonly ARGS_HASH: "hindsight.args.hash";
    readonly COST_USD: "hindsight.cost.usd";
    readonly OUTCOME: "hindsight.run.outcome";
    readonly FORK_OF: "hindsight.fork.of";
    readonly FORK_POINT: "hindsight.fork.point";
    readonly FORK_MUTATION: "hindsight.fork.mutation";
};
/** GenAI semantic-convention attribute names we rely on. */
export declare const GENAI_ATTR: {
    readonly SYSTEM: "gen_ai.system";
    readonly REQUEST_MODEL: "gen_ai.request.model";
    readonly RESPONSE_MODEL: "gen_ai.response.model";
    readonly INPUT_TOKENS: "gen_ai.usage.input_tokens";
    readonly OUTPUT_TOKENS: "gen_ai.usage.output_tokens";
    readonly TEMPERATURE: "gen_ai.request.temperature";
    readonly MAX_TOKENS: "gen_ai.request.max_tokens";
    readonly ERROR_TYPE: "error.type";
};
/** Metric names emitted by the recorder. */
export declare const METRIC: {
    readonly RUNS_TOTAL: "hindsight.runs.total";
    readonly TOKENS_TOTAL: "hindsight.tokens.total";
    readonly COST_USD_TOTAL: "hindsight.cost.usd.total";
    readonly STEP_DURATION: "hindsight.step.duration";
    readonly TOOL_ERRORS_TOTAL: "hindsight.tool.errors.total";
    readonly LOOP_SCORE: "hindsight.loop.score";
    readonly INCIDENTS_TOTAL: "hindsight.incidents.total";
    readonly FORKS_TOTAL: "hindsight.forks.total";
    readonly FORKS_RESOLVED_TOTAL: "hindsight.forks.resolved.total";
};
/** Payload log record marker — body JSON always includes this field. */
export declare const PAYLOAD_LOG_MARKER = "hindsight.payload";
/** Service name used by demo agents / forks when emitting telemetry. */
export declare const serviceNameForAgent: (agentId: string) => string;
