import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { IncidentStore, InvalidTransitionError } from "./store.js";

test("alert fingerprint and trace deduplicate repeated webhook delivery", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);
  const input = {
    traceId: "11111111111111111111111111111111",
    agentId: "research",
    alertName: "run failed",
    alertFingerprint: "fingerprint-1",
  };
  const first = store.createOrGet(input);
  const second = store.createOrGet(input);
  assert.equal(second.id, first.id);
  assert.equal(store.list().length, 1);
});

test("only verification can persist a resolved incident", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);
  const incident = store.create({
    traceId: "11111111111111111111111111111111",
  });
  assert.throws(
    () => store.update(incident.id, { status: "resolved" }),
    InvalidTransitionError,
  );
  store.startVerification(
    incident.id,
    {
      forkTraceId: "22222222222222222222222222222222",
      mutation: { type: "model_swap", model: "claude-sonnet-4-5" },
      mutationHash: "hash",
    },
    {
      createdAt: new Date().toISOString(),
      outcome: "success",
      runnerRevision: "research@1",
      idempotencyKey: "attempt-1",
    },
  );
  const resolved = store.finishVerification(incident.id, {
    verified: true,
    checkedAt: new Date().toISOString(),
    reason: "linked fork removed the original failure",
    originalOutcome: "failure",
    forkOutcome: "success",
    originalFailure: "ToolError",
  });
  assert.equal(resolved?.status, "resolved");
  assert.equal(resolved?.verification?.verified, true);
  assert.ok(resolved?.resolvedAt);
  assert.equal(typeof resolved?.resolutionMs, "number");
  assert.equal(resolved?.forkAttempts?.length, 1);
  assert.equal(resolved?.forkAttempts?.[0].verification?.verified, true);
});

test("failed verification returns the incident to open", (t) => {
  const { store, cleanup } = tempStore();
  t.after(cleanup);
  const incident = store.create({
    traceId: "11111111111111111111111111111111",
  });
  store.startVerification(incident.id, {
    forkTraceId: "22222222222222222222222222222222",
    mutation: { type: "params", temperature: 0 },
    mutationHash: "hash",
  });
  const reopened = store.finishVerification(incident.id, {
    verified: false,
    checkedAt: new Date().toISOString(),
    reason: "fork still failed",
    originalOutcome: "failure",
    forkOutcome: "failure",
  });
  assert.equal(reopened?.status, "open");
  assert.equal(reopened?.verification?.verified, false);
});

function tempStore(): { store: IncidentStore; cleanup: () => void } {
  const directory = mkdtempSync(join(tmpdir(), "hindsight-incidents-"));
  const store = new IncidentStore(join(directory, "test.db"));
  return {
    store,
    cleanup: () => {
      store.close();
      rmSync(directory, { recursive: true, force: true });
    },
  };
}
