import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createServer } from "vite";
import type { RunStep, RunSummary } from "@hindsight/shared";
import { stepEvidenceLabels } from "../src/components/StepCard";

const run: RunSummary = {
  runId: "run-1",
  traceId: "trace-1",
  agentId: "research-agent",
  agentRevision: "research-agent@abc123",
  startTime: "2026-07-25T00:00:00.000Z",
  outcome: "success",
  stepCount: 1,
  totalTokens: 10,
  costUsd: 0.001,
};

const step: RunStep = {
  index: 1,
  kind: "llm",
  spanId: "span-1",
  name: "llama3.2",
  startTime: run.startTime,
  latencyMs: 12,
  costUsd: 0,
  provider: "ollama",
  payloadPresent: true,
  payloadRedacted: false,
  payloadTruncated: false,
};

test("landing labels preview evidence as illustrative", () => {
  const source = readFileSync(
    new URL("../src/screens/LandingPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(source, /Illustrative Hindsight product preview/);
  assert.match(source, /ILLUSTRATIVE \/ COUNTERFACTUAL/);
});

test("step labels expose recorded provenance without calling the replay live", () => {
  assert.deepEqual(stepEvidenceLabels(step), [
    "recorded · live provider ollama",
    "payload complete",
  ]);
  assert.deepEqual(
    stepEvidenceLabels({ ...step, provider: "mock", payloadRedacted: true }),
    ["recorded · mock provider", "payload redacted"],
  );
});

test("run labels expose checkpoint and revision", async () => {
  const vite = await createServer({
    root: fileURLToPath(new URL("..", import.meta.url)),
    appType: "custom",
    logLevel: "silent",
    server: { middlewareMode: true },
  });
  try {
    const { runEvidenceLabels } = await vite.ssrLoadModule(
      "/src/screens/RunDetailScreen.tsx",
    );
    assert.deepEqual(
      runEvidenceLabels(run, { complete: true, schemaVersion: "1", issues: [] }),
      [
        "recorded telemetry",
        "agent revision · research-agent@abc123",
        "checkpoint complete · schema version 1",
      ],
    );
  } finally {
    await vite.close();
  }
});
