import type {
  ForkResult,
  Incident,
  IncidentVerification,
  RunGraph,
} from "@hindsight/shared";
import { compareRuns } from "../compare/diff.js";

export function verifyForkResolution(input: {
  incident: Incident;
  original: RunGraph;
  fork: RunGraph;
  result: ForkResult;
  checkedAt?: string;
}): IncidentVerification {
  const { incident, original, fork, result } = input;
  const checkedAt = input.checkedAt ?? new Date().toISOString();
  const originalFailure =
    original.run.error ??
    original.steps.find((step) => step.error)?.error ??
    (original.run.outcome === "success" ? undefined : `outcome:${original.run.outcome}`);
  const reasons: string[] = [];
  const originalSignals = failureSignals(original);
  const forkSignals = failureSignals(fork);
  const failureCondition = incident.failureCondition ?? originalFailure;
  if (incident.traceId !== original.run.traceId) reasons.push("incident trace does not match original");
  if (result.originalTraceId !== original.run.traceId) {
    reasons.push("runner result does not identify the original trace");
  }
  if (
    result.forkTraceId !== fork.run.traceId ||
    incident.forkTraceId !== fork.run.traceId
  ) {
    reasons.push("fork trace does not match the linked attempt");
  }
  if (original.run.outcome === "success") reasons.push("original run did not fail");
  if (result.outcome !== "success" || fork.run.outcome !== "success") {
    reasons.push("fork did not complete successfully");
  }
  if (fork.run.forkOf !== original.run.traceId) reasons.push("fork lineage does not match original");
  if (fork.run.incidentId !== incident.id) reasons.push("fork is not linked to this incident");
  if (fork.run.agentRevision !== result.runnerRevision) {
    reasons.push("fork telemetry does not confirm the runner revision");
  }
  if (!result.checkpoint.complete || !fork.checkpoint?.complete) {
    reasons.push("fork evidence is incomplete");
  }
  if (
    result.mutationHash !== incident.mutationHash ||
    fork.run.mutationHash !== result.mutationHash
  ) {
    reasons.push("fork mutation evidence does not match the requested mutation");
  }
  const forkFailures = [
    fork.run.error,
    ...fork.steps.map((step) => step.error),
  ].filter((value): value is string => !!value);
  if (
    failureCondition &&
    !originalSignals.some((signal) => sameFailure(signal, failureCondition))
  ) {
    reasons.push(`original trace does not contain the alert condition: ${failureCondition}`);
  }
  if (
    failureCondition &&
    forkSignals.some((signal) => sameFailure(signal, failureCondition))
  ) {
    reasons.push(`original failure is still present: ${failureCondition}`);
  }
  if (forkFailures.length) reasons.push(`fork contains errors: ${forkFailures.join(", ")}`);

  return {
    verified: reasons.length === 0,
    checkedAt,
    reason:
      reasons.length === 0
        ? "linked fork succeeded, confirmed the mutation, and removed the original failure"
        : reasons.join("; "),
    originalOutcome: original.run.outcome,
    forkOutcome: fork.run.outcome,
    originalFailure,
    comparison: compareRuns(original, fork),
  };
}

function failureSignals(graph: RunGraph): string[] {
  return [
    graph.run.error,
    ...graph.steps.map((step) => step.error),
    ...((graph.events ?? []).flatMap((event) => [event.event, event.errorType])),
    graph.run.outcome === "success" ? undefined : `outcome:${graph.run.outcome}`,
  ].filter((value): value is string => !!value);
}

function sameFailure(left: string, right: string): boolean {
  const a = left.toLowerCase();
  const b = right.toLowerCase();
  return a === b || a.includes(b) || b.includes(a);
}
