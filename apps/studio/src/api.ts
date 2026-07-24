import type {
  AgentFleetStat,
  Capabilities,
  CompareResult,
  ForkRequest,
  ForkResult,
  Incident,
  RunGraph,
  RunSummary,
} from "@hindsight/shared";
import {
  mockCompareResult,
  mockCreateIncident,
  mockFleet,
  mockForkResult,
  mockGraphFor,
  mockIncidents,
  mockPatchIncident,
  mockPostmortem,
  mockRuns,
} from "./mock";

// Mirrors DEFAULTS.signozUrl in @hindsight/shared.
export const SIGNOZ_URL = "http://localhost:8080";
export const signozTraceUrl = (traceId: string) => `${SIGNOZ_URL}/trace/${traceId}`;
export const SIGNOZ_DASHBOARDS_URL = `${SIGNOZ_URL}/dashboards`;

/**
 * Base URL for the replay-engine REST contract. Empty string = same-origin:
 * the Vite dev proxy forwards /api + /hooks to localhost:4123, and a
 * production deployment is expected to reverse-proxy the engine on the same
 * origin. Override at build time, e.g. VITE_API_BASE=https://engine.example.com
 */
const API_BASE = ((import.meta.env.VITE_API_BASE as string | undefined) ?? "").replace(/\/+$/, "");

/**
 * Explicit fixture mode — OFF by default; the real API is always the default.
 * Enable by opening Studio with ?mock=1 (persisted in localStorage), disable
 * with ?mock=0. While active the header shows a "mock data" pill.
 */
const MOCK_KEY = "hindsight:mock";
try {
  const q = new URLSearchParams(window.location.search).get("mock");
  if (q === "1") window.localStorage.setItem(MOCK_KEY, "1");
  else if (q === "0") window.localStorage.removeItem(MOCK_KEY);
} catch {
  // storage unavailable (private mode) — fall through to in-memory default
}
export const MOCK_MODE = (() => {
  try {
    return window.localStorage.getItem(MOCK_KEY) === "1";
  } catch {
    return false;
  }
})();

/** Error codes emitted by replay-engine (apps/replay-engine/src/routes.ts). */
export const ERR = {
  signozAuthMissing: "signoz_auth_missing",
  signozUnavailable: "signoz_unavailable",
  runnerUnavailable: "runner_unavailable",
  runnerTimeout: "runner_timeout",
  runnerRejected: "runner_rejected",
  runnerProtocolError: "runner_protocol_error",
  incompleteRecord: "incomplete_record",
  unsupportedMutation: "unsupported_mutation",
  invalidMutationTarget: "invalid_mutation_target",
  idempotencyConflict: "idempotency_conflict",
  verifiedResolutionRequired: "verified_resolution_required",
  incidentTraceMismatch: "incident_trace_mismatch",
  incidentNotOpen: "incident_not_open",
  dismissalReasonRequired: "dismissal_reason_required",
  runNotFound: "run_not_found",
  incidentNotFound: "incident_not_found",
  invalidStatusTransition: "invalid_status_transition",
  invalidForkRequest: "invalid_fork_request",
  invalidBody: "invalid_body",
  missingQueryParams: "missing_query_params",
  /** Client-side: engine did not answer at all (network down / proxy 502). */
  engineUnreachable: "engine_unreachable",
  unknown: "unknown",
} as const;

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly detail?: string;

  constructor(status: number, code: string, detail?: string) {
    super(detail ? `${code}: ${detail}` : code);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.detail = detail;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API_BASE}${path}`, {
      headers: { "content-type": "application/json" },
      ...init,
    });
  } catch {
    throw new ApiError(
      0,
      ERR.engineUnreachable,
      `no response from replay-engine (${API_BASE || "same-origin /api"})`,
    );
  }
  const text = await res.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : undefined;
  } catch {
    body = undefined;
  }
  if (!res.ok) {
    // The Vite dev proxy answers 502 when the engine process is down.
    if (res.status === 502) {
      throw new ApiError(res.status, ERR.engineUnreachable, "replay-engine is not running on :4123");
    }
    const rec = (body ?? {}) as { error?: unknown; detail?: unknown };
    const code = typeof rec.error === "string" ? rec.error : ERR.unknown;
    const detail =
      typeof rec.detail === "string" ? rec.detail : body === undefined ? res.statusText : undefined;
    throw new ApiError(res.status, code, detail);
  }
  return body as T;
}

/** Small delay so fixture mode still exercises the loading states. */
async function mockResolve<T>(fn: () => T): Promise<T> {
  await new Promise((r) => setTimeout(r, 90));
  return fn();
}

export const api = {
  health: () =>
    MOCK_MODE
      ? mockResolve(() => ({ ok: true as const, signozAuthed: true }))
      : request<{ ok: boolean; signozAuthed?: boolean }>("/api/health"),

  capabilities: () =>
    MOCK_MODE
      ? mockResolve((): Capabilities => ({
          schemaVersion: "1",
          liveSideEffects: false,
          runners: [
            {
              agentId: "research-agent",
              revision: "fixture-runner@1",
              available: true,
              mutations: ["model_swap", "prompt_edit", "tool_output_override", "params"],
              safeLiveTools: [],
            },
          ],
        }))
      : request<Capabilities>("/api/capabilities"),

  listRuns: (agentId?: string, limit?: number) => {
    if (MOCK_MODE) return mockResolve(mockRuns);
    const params = new URLSearchParams();
    if (agentId) params.set("agentId", agentId);
    if (limit) params.set("limit", String(limit));
    const qs = params.toString();
    return request<RunSummary[]>(`/api/runs${qs ? `?${qs}` : ""}`);
  },

  getRun: (traceId: string) =>
    MOCK_MODE
      ? mockResolve(() => mockGraphFor(traceId))
      : request<RunGraph>(`/api/runs/${encodeURIComponent(traceId)}`),

  createFork: (body: ForkRequest) =>
    MOCK_MODE
      ? mockResolve(() => mockForkResult(body))
      : request<ForkResult>("/api/forks", { method: "POST", body: JSON.stringify(body) }),

  compare: (original: string, fork: string) =>
    MOCK_MODE
      ? mockResolve(mockCompareResult)
      : request<CompareResult>(
          `/api/compare?original=${encodeURIComponent(original)}&fork=${encodeURIComponent(fork)}`,
        ),

  listIncidents: () =>
    MOCK_MODE ? mockResolve(mockIncidents) : request<Incident[]>("/api/incidents"),

  createIncident: (body: { traceId: string; agentId?: string; alertName?: string }) =>
    MOCK_MODE
      ? mockResolve(() => mockCreateIncident(body))
      : request<Incident>("/api/incidents", { method: "POST", body: JSON.stringify(body) }),

  patchIncident: (id: string, patch: Partial<Incident>) =>
    MOCK_MODE
      ? mockResolve(() => mockPatchIncident(id, patch))
      : request<Incident>(`/api/incidents/${encodeURIComponent(id)}`, {
          method: "PATCH",
          body: JSON.stringify(patch),
        }),

  postmortem: (id: string) =>
    MOCK_MODE
      ? mockResolve(() => mockPostmortem(id))
      : request<{ markdown: string }>(`/api/incidents/${encodeURIComponent(id)}/postmortem`, {
          method: "POST",
        }),

  fleet: () => (MOCK_MODE ? mockResolve(mockFleet) : request<AgentFleetStat[]>("/api/fleet")),
};
