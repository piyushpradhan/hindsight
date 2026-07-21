/** Core domain types shared by recorder, replay-engine, and studio. */
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
};
//# sourceMappingURL=types.js.map