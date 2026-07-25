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
  /** null means the provider did not report enough usage to calculate it. */
  totalTokens: number | null;
  /** null means usage or model pricing was unavailable. */
  costUsd: number | null;
  schemaVersion?: string;
  payloadComplete?: boolean;
  agentRevision?: string;
  /** If this run is a counterfactual fork, the trace id of the original. */
  forkOf?: string;
  forkPoint?: number;
  incidentId?: string;
  mutationHash?: string;
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
  costUsd: number | null;
  error?: string;
  payloadPresent?: boolean;
  payloadTruncated?: boolean;
  payloadRedacted?: boolean;

  // llm steps
  model?: string;
  provider?: string;
  systemPrompt?: string;
  temperature?: number;
  maxTokens?: number;
  inputTokens?: number;
  outputTokens?: number;
  requestMessages?: ChatMessage[];
  response?: unknown;

  // tool steps
  toolName?: string;
  args?: unknown;
  argsHash?: string;
  toolCallId?: string;
  toolOutput?: unknown;
}

export type CheckpointIssueCode =
  | "legacy_schema"
  | "root_marked_incomplete"
  | "missing_step"
  | "missing_payload"
  | "truncated_payload"
  | "redacted_payload"
  | "missing_payload_hash"
  | "payload_hash_mismatch"
  | "payload_identity_mismatch"
  | "missing_agent_revision"
  | "missing_tool_call_id"
  | "tool_call_mismatch"
  | "tool_args_hash_mismatch";

export interface CheckpointIssue {
  code: CheckpointIssueCode;
  stepIndex?: number;
  detail: string;
}

export interface CheckpointReport {
  complete: boolean;
  schemaVersion?: string;
  issues: CheckpointIssue[];
}

export interface RunEvent {
  event: string;
  runId?: string;
  agentId?: string;
  errorType?: string;
  toolName?: string;
  score?: number;
  timestamp?: string;
}

/** A full run reconstructed from SigNoz spans + correlated payload logs. */
export interface RunGraph {
  run: RunSummary;
  steps: RunStep[];
  events?: RunEvent[];
  checkpoint?: CheckpointReport;
}

/* ---------------------------------- fork ---------------------------------- */

export type MockPolicy = "strict" | "hybrid";

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
  incidentId?: string;
  idempotencyKey?: string;
}

export interface ForkResult {
  forkRunId: string;
  forkTraceId: string;
  originalTraceId: string;
  outcome: RunOutcome;
  stepCount: number;
  mutation: Mutation;
  mutationHash: string;
  runnerRevision: string;
  checkpoint: CheckpointReport;
  idempotencyKey: string;
  verification?: IncidentVerification;
  incident?: Incident;
  error?: string;
}

export interface ForkRunnerCapability {
  agentId: string;
  revision: string;
  available: boolean;
  mutations: Mutation["type"][];
  safeLiveTools: string[];
}

export interface Capabilities {
  schemaVersion: string;
  liveSideEffects: false;
  runners: ForkRunnerCapability[];
}

export interface RunnerCheckpoint {
  schemaVersion: string;
  originalTraceId: string;
  originalSpanId: string;
  runId: string;
  agentId: string;
  agentRevision: string;
  forkAtStep: number;
  steps: RunStep[];
}

export interface RunnerForkRequest {
  idempotencyKey: string;
  incidentId?: string;
  mutation: Mutation;
  mutationHash: string;
  mockPolicy: MockPolicy;
  checkpoint: RunnerCheckpoint;
}

export interface RunnerForkResponse {
  forkRunId: string;
  forkTraceId: string;
  outcome: RunOutcome;
  stepCount: number;
  runnerRevision: string;
  appliedMutationHash: string;
  error?: string;
}

export interface ReplayResult {
  traceId: string;
  checkpoint: CheckpointReport;
  steps: RunStep[];
  liveCalls: 0;
}

/* -------------------------------- compare ---------------------------------- */

export type AlignmentStatus = "same" | "changed" | "added" | "removed";
export type ComparisonVerdict =
  | "improved"
  | "unchanged"
  | "regressed"
  | "not_verifiable";
export type ComparedField =
  | "prompt"
  | "model"
  | "params"
  | "tool"
  | "output"
  | "tokens"
  | "duration"
  | "cost";
export type FieldComparisonStatus =
  | "same"
  | "changed"
  | "added"
  | "removed";

export interface FieldComparison {
  field: ComparedField;
  status: FieldComparisonStatus;
  original?: string | number;
  fork?: string | number;
}

export interface StepAlignment {
  originalIndex?: number;
  forkIndex?: number;
  status: AlignmentStatus;
  /** True when the fork inherited this immutable step rather than re-executing it. */
  sharedPrefix?: boolean;
  /** Recorded fields compared for this aligned pair. */
  fields?: FieldComparison[];
}

export interface CompareResult {
  original: RunSummary;
  fork: RunSummary;
  deltaTokens: number | null;
  deltaCostUsd: number | null;
  deltaLatencyMs: number;
  deltaSteps: number;
  outcomeChanged: boolean;
  alignments: StepAlignment[];
  /** Present for lineage-aware comparisons; optional for older API fixtures. */
  branchPoint?: number;
  sharedPrefixSteps?: number;
  verdict?: ComparisonVerdict;
  verdictReason?: string;
  /** Unified-ish text diff of final outputs (plain string, may be empty). */
  outputDiff: string;
}

/* -------------------------------- incidents -------------------------------- */

export type IncidentStatus = "open" | "verifying" | "resolved" | "dismissed";
export type IncidentSortField = "incident" | "severity" | "agent" | "detected" | "status";
export type IncidentSortDirection = "asc" | "desc";

export interface IncidentVerification {
  verified: boolean;
  checkedAt: string;
  reason: string;
  originalOutcome?: RunOutcome;
  forkOutcome?: RunOutcome;
  originalFailure?: string;
  comparison?: CompareResult;
}

export interface IncidentForkAttempt {
  createdAt: string;
  forkTraceId: string;
  mutation: Mutation;
  mutationHash: string;
  outcome: RunOutcome;
  runnerRevision: string;
  idempotencyKey: string;
  error?: string;
  verification?: IncidentVerification;
}

export interface Incident {
  id: string;
  createdAt: string; // ISO 8601
  agentId: string;
  traceId: string;
  runId?: string;
  source?: string;
  alertName: string;
  severity?: string;
  status: IncidentStatus;
  alertFingerprint?: string;
  failureCondition?: string;
  forkTraceId?: string;
  mutation?: Mutation;
  mutationHash?: string;
  verification?: IncidentVerification;
  resolvedAt?: string;
  resolutionMs?: number;
  forkAttempts?: IncidentForkAttempt[];
  notes?: string;
}

export interface IncidentPage {
  items: Incident[];
  hasMore: boolean;
  totalCount: number;
  openCount: number;
  severities: string[];
}

/* ---------------------------------- fleet ---------------------------------- */

export interface AgentFleetStat {
  agentId: string;
  runsToday: number;
  successRate: number; // 0..1
  costTodayUsd: number | null;
  openIncidents: number;
}

/* ------------------------------- REST contract ------------------------------
 * Implemented by apps/replay-engine, consumed by apps/studio.
 *
 *   GET    /api/health                     -> { ok: true }
 *   GET    /api/runs?agentId=&limit=       -> RunSummary[]
 *   GET    /api/runs/:traceId              -> RunGraph
 *   POST   /api/replays { traceId }         -> ReplayResult
 *   GET    /api/capabilities                -> Capabilities
 *   POST   /api/forks        (ForkRequest) -> ForkResult
 *   GET    /api/compare?original=&fork=    -> CompareResult
 *   GET    /api/incidents                  -> Incident[]
 *   GET    /api/incidents/page             -> IncidentPage
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
