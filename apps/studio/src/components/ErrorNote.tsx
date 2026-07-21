import { ApiError, ERR } from "../api";

export interface FriendlyError {
  title: string;
  hint?: string;
}

/** Maps engine error codes (and client-side failures) to judge-readable copy. */
export function friendlyError(err: unknown): FriendlyError {
  if (err instanceof ApiError) {
    switch (err.code) {
      case ERR.signozAuthMissing:
        return {
          title: "SigNoz API key not configured on the engine",
          hint: "Set SIGNOZ_API_KEY on replay-engine and restart it — runs, compare, and fleet all read from the SigNoz query API.",
        };
      case ERR.signozUnavailable:
        return {
          title: "SigNoz is unreachable from the engine",
          hint: err.detail ?? "Check that SigNoz is up at http://localhost:8080.",
        };
      case ERR.forkExecutorPending:
        return {
          title: "Fork executor is starting up — try again shortly",
          hint: "The engine answered 501: the fork executor is not wired in yet.",
        };
      case ERR.runNotFound:
        return {
          title: "Run not found",
          hint: "No spans in SigNoz for this trace_id. Check the id, or record a run first.",
        };
      case ERR.incidentNotFound:
        return { title: "Incident not found", hint: "It may have been removed from the engine's store." };
      case ERR.invalidStatusTransition:
        return { title: "That status change isn't allowed", hint: err.detail };
      case ERR.invalidForkRequest:
      case ERR.invalidBody:
      case ERR.missingQueryParams:
        return { title: "The engine rejected the request", hint: err.detail };
      case ERR.engineUnreachable:
        return {
          title: "replay-engine is not reachable",
          hint: "Start it on :4123 (pnpm --filter @hindsight/replay-engine dev), or open Studio with ?mock=1 to browse fixture data.",
        };
      default:
        return { title: err.message };
    }
  }
  if (err instanceof Error) return { title: err.message };
  return { title: String(err) };
}

export function ErrorNote({ error }: { error: unknown }) {
  const { title, hint } = friendlyError(error);
  return (
    <div className="error-note">
      <div className="error-title">{title}</div>
      {hint && <div className="error-hint">{hint}</div>}
    </div>
  );
}
