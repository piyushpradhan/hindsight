import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunGraph, RunStep } from "@hindsight/shared";
import { alignSteps, compareRuns, lineDiff } from "./diff.js";

function step(partial: Partial<RunStep> & Pick<RunStep, "index" | "kind" | "name">): RunStep {
  return {
    spanId: `span-${partial.index}`,
    startTime: "2026-07-20T10:00:00.000Z",
    latencyMs: 100,
    costUsd: 0.001,
    ...partial,
  };
}

function graph(steps: RunStep[], overrides: Partial<RunGraph["run"]> = {}): RunGraph {
  return {
    steps,
    run: {
      runId: "run-x",
      traceId: "trace-x",
      agentId: "agent-1",
      startTime: "2026-07-20T10:00:00.000Z",
      endTime: "2026-07-20T10:00:01.000Z",
      outcome: "success",
      stepCount: steps.length,
      totalTokens: steps.reduce((n, s) => n + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0),
      costUsd: steps.reduce((n, s) => n + s.costUsd, 0),
      ...overrides,
    },
  };
}

const originalSteps: RunStep[] = [
  step({ index: 0, kind: "llm", name: "gpt-4o", model: "gpt-4o", inputTokens: 10, outputTokens: 5 }),
  step({ index: 1, kind: "tool", name: "search", toolName: "search", argsHash: "a1" }),
  step({ index: 2, kind: "tool", name: "write_file", toolName: "write_file", argsHash: "b2" }),
];
const forkSteps: RunStep[] = [
  step({ index: 0, kind: "llm", name: "gpt-4o", model: "gpt-4o", inputTokens: 12, outputTokens: 5 }),
  step({ index: 1, kind: "tool", name: "search", toolName: "search", argsHash: "a9" }),
];

test("alignSteps: same / changed / removed across 3 vs 2 steps", () => {
  assert.deepEqual(alignSteps(originalSteps, forkSteps), [
    { originalIndex: 0, forkIndex: 0, status: "same" },
    { originalIndex: 1, forkIndex: 1, status: "changed" },
    { originalIndex: 2, status: "removed" },
  ]);
});

test("alignSteps: added steps appear with forkIndex only", () => {
  const grown = [...forkSteps, step({ index: 2, kind: "tool", name: "notify", toolName: "notify" })];
  const alignments = alignSteps(forkSteps, grown);
  assert.deepEqual(alignments[alignments.length - 1], { forkIndex: 2, status: "added" });
});

test("lineDiff: prefixes removed/added/common lines", () => {
  const diff = lineDiff("alpha\nbeta\ngamma", "alpha\nBETA\ngamma");
  assert.equal(diff, "  alpha\n- beta\n+ BETA\n  gamma");
  assert.equal(lineDiff("same", "same"), "");
});

test("compareRuns: deltas, outcome flip, alignment, output diff", () => {
  originalSteps[2]!.toolOutput = "failed: disk full";
  const original = graph(originalSteps, { traceId: "t-orig", outcome: "failure" });
  const fork = graph(
    forkSteps.map((s, i) => (i === 1 ? { ...s, toolOutput: "wrote /tmp/out.txt" } : s)),
    { traceId: "t-fork", outcome: "success", endTime: "2026-07-20T10:00:02.000Z" },
  );
  const result = compareRuns(original, fork);
  assert.equal(result.deltaTokens, 2);
  assert.ok(result.deltaCostUsd < 0, "fork dropped a paid step");
  assert.equal(result.deltaSteps, -1);
  assert.equal(result.deltaLatencyMs, 1000);
  assert.equal(result.outcomeChanged, true);
  assert.equal(result.alignments.length, 3);
  assert.equal(result.original.traceId, "t-orig");
  assert.equal(result.fork.traceId, "t-fork");
  assert.match(result.outputDiff, /- failed: disk full/);
  assert.match(result.outputDiff, /\+ wrote \/tmp\/out\.txt/);
});
