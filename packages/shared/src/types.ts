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
  startTime: string; // ISO 8601
  endTime?: string; // ISO 8601
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
  startTime: string; // ISO 8601
  latencyMs: number;
  costUsd: number;
  error?: string;

  // llm steps
  model?: string;
  temperature?: number;
  inputTokens?: number;
  outputTokens?: number;
  requestMessages?: ChatMessage[];
  response?: unknown;

  // tool steps
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

/* ---------------------------------- fork ---------------------------------- */

export type MockPolicy = "strict" | "hybrid" | "live";

/** Exactly one mutation per fork — that discipline is the product. */
export type Mutation =
  | { type: "model_swap"; model: string }
  | { type: "prompt_edit"; newSystemPrompt: string }
  | { type: "tool_output_override"; stepIndex: number; output: unknown }
  | { type: "params"; temperature?: number; maxTokens?: number }
  | { type: "disable_tool"; toolName: string };

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

/* -------------------------------- compare ---------------------------------- */

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

/* -------------------------------- incidents -------------------------------- */

export type IncidentStatus = "open" | "diagnosed" | "resolved_via_fork" | "dismissed";

export interface Incident {
  id: string;
  createdAt: string; // ISO 8601
  agentId: string;
  traceId: string;
  alertName: string;
  severity?: string;
  status: IncidentStatus;
  forkTraceId?: string;
  notes?: string;
}

/* ---------------------------------- fleet ---------------------------------- */

export interface AgentFleetStat {
  agentId: string;
  runsToday: number;
  successRate: number; // 0..1
  costTodayUsd: number;
  openIncidents: number;
}

/* ------------------------------- REST contract ------------------------------
 * Implemented by apps/replay-engine, consumed by apps/studio.
 *
 *   GET    /api/health                     -> { ok: true }
 *   GET    /api/runs?agentId=&limit=       -> RunSummary[]
 *   GET    /api/runs/:traceId              -> RunGraph
 *   POST   /api/forks        (ForkRequest) -> ForkResult
 *   GET    /api/compare?original=&fork=    -> CompareResult
 *   GET    /api/incidents                  -> Incident[]
 *   POST   /api/incidents { traceId, agentId?, alertName? } -> Incident
 *   PATCH  /api/incidents/:id (Partial<Incident>)           -> Incident
 *   POST   /api/incidents/:id/postmortem   -> { markdown: string }
 *   GET    /api/fleet                      -> AgentFleetStat[]
 *   POST   /hooks/signoz                   -> SigNoz alert webhook receiver
 * --------------------------------------------------------------------------- */

/** Default endpoints for local development. */
export const DEFAULTS = {
  signozUrl: "http://localhost:8080",
  otlpHttpUrl: "http://localhost:4318",
  otlpGrpcUrl: "localhost:4317",
  replayEnginePort: 4123,
} as const;
