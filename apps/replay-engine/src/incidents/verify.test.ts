import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForkResult, Incident, RunGraph } from "@hindsight/shared";
import { verifyForkResolution } from "./verify.js";

const original = graph("original", "failure", {
  error: "ToolError",
});
const fork = graph("fork", "success", {
  forkOf: "original",
  incidentId: "incident",
  mutationHash: "mutation",
  agentRevision: "runner@1",
});
const incident: Incident = {
  id: "incident",
  createdAt: "2026-07-24T00:00:00.000Z",
  agentId: "research",
  traceId: "original",
  alertName: "failed",
  status: "verifying",
  forkTraceId: "fork",
  mutation: { type: "model_swap", model: "new" },
  mutationHash: "mutation",
};
const result: ForkResult = {
  forkRunId: "fork-run",
  forkTraceId: "fork",
  originalTraceId: "original",
  outcome: "success",
  stepCount: 1,
  mutation: incident.mutation!,
  mutationHash: "mutation",
  runnerRevision: "runner@1",
  checkpoint: { complete: true, issues: [] },
  idempotencyKey: "key",
};

test("verification requires lineage, incident link, mutation proof, and removed failure", () => {
  const verification = verifyForkResolution({ incident, original, fork, result });
  assert.equal(verification.verified, true);
});

test("unrelated successful fork cannot resolve the incident", () => {
  const verification = verifyForkResolution({
    incident,
    original,
    fork: graph("fork", "success", { forkOf: "somewhere-else" }),
    result,
  });
  assert.equal(verification.verified, false);
  assert.match(verification.reason, /lineage|linked|mutation/);
});

function graph(
  traceId: string,
  outcome: RunGraph["run"]["outcome"],
  extra: Partial<RunGraph["run"]> = {},
): RunGraph {
  return {
    run: {
      runId: `${traceId}-run`,
      traceId,
      agentId: "research",
      startTime: "2026-07-24T00:00:00.000Z",
      endTime: "2026-07-24T00:00:01.000Z",
      outcome,
      stepCount: 0,
      totalTokens: 0,
      costUsd: 0,
      payloadComplete: true,
      ...extra,
    },
    steps: [],
    checkpoint: { complete: true, issues: [] },
  };
}
