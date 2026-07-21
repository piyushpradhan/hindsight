/** Core domain types shared by recorder, replay-engine, and studio. */
export type StepKind = "llm" | "tool";
export type RunOutcome = "success" | "failure" | "timeout";
export interface ChatMessage {
    role: string;
    content: unknown;
}
export interface RunSummary {
    /** hindsight.run.id */
    runId: string;
    /** OTel trace id of the run's root span. */
    traceId: string;
    agentId: string;
    taskId?: string;
    startTime: string;
    endTime?: string;
    outcome: RunOutcome;
    stepCount: number;
    totalTokens: number;
    costUsd: number;
    /** If this run is a counterfactual fork, the trace id of the original. */
    forkOf?: string;
    error?: string;
}
export interface RunStep {
    index: number;
    kind: StepKind;
    spanId: string;
    /** Tool name for tool steps, model name for llm steps. */
    name: string;
    startTime: string;
    latencyMs: number;
    costUsd: number;
    error?: string;
    model?: string;
    temperature?: number;
    inputTokens?: number;
    outputTokens?: number;
    requestMessages?: ChatMessage[];
    response?: unknown;
    toolName?: string;
    args?: unknown;
    argsHash?: string;
    toolOutput?: unknown;
}
/** A full run reconstructed from SigNoz spans + correlated payload logs. */
export interface RunGraph {
    run: RunSummary;
    steps: RunStep[];
}
export type MockPolicy = "strict" | "hybrid" | "live";
/** Exactly one mutation per fork — that discipline is the product. */
export type Mutation = {
    type: "model_swap";
    model: string;
} | {
    type: "prompt_edit";
    newSystemPrompt: string;
} | {
    type: "tool_output_override";
    stepIndex: number;
    output: unknown;
} | {
    type: "params";
    temperature?: number;
    maxTokens?: number;
} | {
    type: "disable_tool";
    toolName: string;
};
export interface ForkRequest {
    /** Trace id of the original run to fork from. */
    traceId: string;
    /** Step index to fork from: state is rebuilt up to (not including) this step. */
    forkAtStep: number;
    mutation: Mutation;
    mockPolicy: MockPolicy;
}
export interface ForkResult {
    forkRunId: string;
    forkTraceId: string;
    originalTraceId: string;
    outcome: RunOutcome;
    stepCount: number;
    error?: string;
}
export type AlignmentStatus = "same" | "changed" | "added" | "removed";
export interface StepAlignment {
    originalIndex?: number;
    forkIndex?: number;
    status: AlignmentStatus;
}
export interface CompareResult {
    original: RunSummary;
    fork: RunSummary;
    deltaTokens: number;
    deltaCostUsd: number;
    deltaLatencyMs: number;
    deltaSteps: number;
    outcomeChanged: boolean;
    alignments: StepAlignment[];
    /** Unified-ish text diff of final outputs (plain string, may be empty). */
    outputDiff: string;
}
export type IncidentStatus = "open" | "diagnosed" | "resolved_via_fork" | "dismissed";
export interface Incident {
    id: string;
    createdAt: string;
    agentId: string;
    traceId: string;
    alertName: string;
    severity?: string;
    status: IncidentStatus;
    forkTraceId?: string;
    notes?: string;
}
export interface AgentFleetStat {
    agentId: string;
    runsToday: number;
    successRate: number;
    costTodayUsd: number;
    openIncidents: number;
}
/** Default endpoints for local development. */
export declare const DEFAULTS: {
    readonly signozUrl: "http://localhost:8080";
    readonly otlpHttpUrl: "http://localhost:4318";
    readonly otlpGrpcUrl: "localhost:4317";
    readonly replayEnginePort: 4123;
};
