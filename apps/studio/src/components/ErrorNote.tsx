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
      case ERR.runnerUnavailable:
        return {
          title: "No compatible runner is available",
          hint: err.detail ?? "Register this agent and revision in HINDSIGHT_RUNNERS, then start its runner.",
        };
      case ERR.runnerTimeout:
        return { title: "The agent runner timed out", hint: err.detail };
      case ERR.runnerRejected:
      case ERR.runnerProtocolError:
        return { title: "The agent runner rejected the fork", hint: err.detail };
      case ERR.incompleteRecord:
        return {
          title: "This recording is incomplete",
          hint: err.detail ?? "A fork needs every recorded request, response, tool-call ID, and matching payload hash.",
        };
      case ERR.unsupportedMutation:
      case ERR.invalidMutationTarget:
        return { title: "That mutation cannot be applied here", hint: err.detail };
      case ERR.idempotencyConflict:
        return { title: "This fork request conflicts with an earlier attempt", hint: err.detail };
      case ERR.verifiedResolutionRequired:
        return { title: "A verified fork is required", hint: err.detail };
      case ERR.incidentTraceMismatch:
      case ERR.incidentNotOpen:
        return { title: "This incident cannot accept that fork", hint: err.detail };
      case ERR.dismissalReasonRequired:
        return { title: "A dismissal reason is required", hint: err.detail };
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
          title: "Live data is temporarily unavailable",
          hint: "We couldn't connect to the incident service. Please try again in a moment.",
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
