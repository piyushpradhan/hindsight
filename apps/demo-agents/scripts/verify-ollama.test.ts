import assert from "node:assert/strict";
import { test } from "node:test";
import type { ForkResult, RunGraph } from "@hindsight/shared";
import {
  redactSecrets,
  validateVerifiedOllamaResolution,
} from "./verify-ollama.js";

const original = graph("original", "failure", "ollama");
const fork = graph("fork", "success", "ollama");
const result = {
  forkTraceId: "fork",
  verification: { verified: true, reason: "failure removed" },
  incident: { id: "incident", status: "resolved" },
} as ForkResult;
const triage = {
  runId: "run",
  traceId: "original",
  outcome: "failure",
  incidentId: "incident",
  mode: "ollama",
};

test("accepts only a verified Ollama-backed resolution", () => {
  assert.doesNotThrow(() =>
    validateVerifiedOllamaResolution({ triage, original, result, fork }),
  );
});

test("rejects a verified fork whose provider is mock", () => {
  assert.throws(
    () =>
      validateVerifiedOllamaResolution({
        triage,
        original,
        result,
        fork: graph("fork", "success", "mock"),
      }),
    /non-mock provider/,
  );
});

test("rejects an unverified incident", () => {
  assert.throws(
    () =>
      validateVerifiedOllamaResolution({
        triage,
        original,
        result: {
          ...result,
          verification: {
            verified: false,
            checkedAt: "2026-07-25T00:00:00.000Z",
            reason: "fork still failed",
          },
        },
        fork,
      }),
    /not verified/,
  );
});

test("redacts credentials from failures", () => {
  assert.equal(
    redactSecrets(
      "Bearer abc123 https://x.test?api_key=visible token=super-secret",
      { API_TOKEN: "super-secret" },
    ),
    "Bearer [REDACTED] https://x.test?api_key=[REDACTED] token=[REDACTED]",
  );
});

function graph(
  traceId: string,
  outcome: RunGraph["run"]["outcome"],
  provider: string,
): RunGraph {
  return {
    run: {
      runId: `${traceId}-run`,
      traceId,
      agentId: "todo-triage",
      startTime: "2026-07-25T00:00:00.000Z",
      outcome,
      stepCount: 1,
      totalTokens: null,
      costUsd: null,
    },
    steps: [
      {
        index: 4,
        kind: "llm",
        spanId: "span",
        name: "gemma3:1b",
        startTime: "2026-07-25T00:00:00.000Z",
        latencyMs: 1,
        costUsd: 0,
        payloadPresent: true,
        provider,
      },
    ],
    checkpoint: { complete: true, issues: [] },
  };
}
