import { test } from "node:test";
import assert from "node:assert/strict";
import type { RunGraph, RunOutcome, RunStep, StepAlignment } from "@hindsight/shared";
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
    checkpoint: { complete: true, issues: [] },
    run: {
      runId: "run-x",
      traceId: "trace-x",
      agentId: "agent-1",
      startTime: "2026-07-20T10:00:00.000Z",
      endTime: "2026-07-20T10:00:01.000Z",
      outcome: "success",
      stepCount: steps.length,
      totalTokens: steps.reduce((n, s) => n + (s.inputTokens ?? 0) + (s.outputTokens ?? 0), 0),
      costUsd: steps.reduce((n, s) => n + (s.costUsd ?? 0), 0),
      ...overrides,
    },
  };
}

function shape(alignments: StepAlignment[]) {
  return alignments.map(({ fields: _fields, ...alignment }) => alignment);
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

test("alignSteps keeps compatible whole-run alignment for non-forks", () => {
  assert.deepEqual(shape(alignSteps(originalSteps, forkSteps)), [
    { originalIndex: 0, forkIndex: 0, status: "changed" },
    { originalIndex: 1, forkIndex: 1, status: "changed" },
    { originalIndex: 2, status: "removed" },
  ]);
});

test("alignSteps retains added suffix steps", () => {
  const grown = [...forkSteps, step({ index: 2, kind: "tool", name: "notify", toolName: "notify" })];
  const alignments = alignSteps(forkSteps, grown);
  assert.deepEqual(shape(alignments).at(-1), { forkIndex: 2, status: "added" });
});

test("alignSteps synthesizes the inherited prefix and pairs a mutated branch point", () => {
  const original = [
    step({ index: 0, kind: "llm", name: "old", model: "old", response: "prefix" }),
    step({ index: 1, kind: "tool", name: "search", toolName: "search", args: { q: "x" } }),
    step({ index: 2, kind: "llm", name: "old", model: "old", systemPrompt: "old prompt" }),
    step({ index: 3, kind: "tool", name: "write", toolName: "write" }),
  ];
  const fork = [
    step({ index: 2, kind: "llm", name: "new", model: "new", systemPrompt: "new prompt" }),
    step({ index: 3, kind: "tool", name: "write", toolName: "write" }),
  ];

  const alignments = alignSteps(original, fork, 2);
  assert.deepEqual(shape(alignments), [
    { originalIndex: 0, forkIndex: 0, status: "same", sharedPrefix: true },
    { originalIndex: 1, forkIndex: 1, status: "same", sharedPrefix: true },
    { originalIndex: 2, forkIndex: 2, status: "changed" },
    { originalIndex: 3, forkIndex: 3, status: "same" },
  ]);
  assert.deepEqual(
    alignments[2]?.fields?.filter((field) => field.status === "changed").map((field) => field.field),
    ["prompt", "model"],
  );
});

test("compareRuns reports every recorded comparison field on the branch", () => {
  const original = graph([
    step({ index: 0, kind: "tool", name: "prefix", toolName: "prefix", toolOutput: "kept" }),
    step({
      index: 1,
      kind: "llm",
      name: "old-model",
      model: "old-model",
      systemPrompt: "old prompt",
      temperature: 0,
      maxTokens: 100,
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 120,
      costUsd: 0.004,
      response: "draft",
    }),
    step({
      index: 2,
      kind: "tool",
      name: "search",
      toolName: "search",
      args: { query: "old" },
      toolOutput: "old result",
      latencyMs: 80,
      costUsd: 0,
    }),
    step({
      index: 3,
      kind: "llm",
      name: "old-model",
      model: "old-model",
      inputTokens: 5,
      outputTokens: 2,
      response: "final answer",
    }),
  ], { traceId: "original", outcome: "failure" });
  const fork = graph([
    step({
      index: 1,
      kind: "llm",
      name: "new-model",
      model: "new-model",
      systemPrompt: "new prompt",
      temperature: 0.2,
      maxTokens: 80,
      inputTokens: 7,
      outputTokens: 3,
      latencyMs: 90,
      costUsd: 0.002,
      response: "better draft",
    }),
    step({
      index: 2,
      kind: "tool",
      name: "search",
      toolName: "search",
      args: { query: "new" },
      toolOutput: "new result",
      latencyMs: 60,
      costUsd: 0,
    }),
    step({
      index: 3,
      kind: "llm",
      name: "new-model",
      model: "new-model",
      inputTokens: 5,
      outputTokens: 2,
      response: "final answer",
    }),
  ], {
    traceId: "fork",
    forkOf: "original",
    forkPoint: 1,
    outcome: "success",
  });

  const result = compareRuns(original, fork);
  assert.equal(result.branchPoint, 1);
  assert.equal(result.sharedPrefixSteps, 1);
  assert.equal(result.verdict, "improved");
  assert.equal(result.deltaTokens, -5);
  assert.equal(result.deltaCostUsd, -0.002);
  assert.equal(result.deltaLatencyMs, -50);
  assert.equal(result.deltaSteps, 0);
  assert.deepEqual(
    result.alignments[1]?.fields?.map((field) => field.field),
    ["prompt", "model", "params", "output", "tokens", "duration", "cost"],
  );
  assert.deepEqual(
    result.alignments[2]?.fields?.map((field) => field.field),
    ["tool", "output", "duration", "cost"],
  );
});

test("compareRuns returns unchanged only for equal output and resource evidence", () => {
  const [original, fork] = branchPair("success", "success", "same", "same");
  const result = compareRuns(original, fork);
  assert.equal(result.verdict, "unchanged");
  assert.match(result.verdictReason ?? "", /unchanged/);
});

test("compareRuns returns improved when equal output uses no more recorded resources", () => {
  const [original, fork] = branchPair("success", "success", "same", "same");
  fork.steps[0] = {
    ...fork.steps[0]!,
    inputTokens: 3,
    latencyMs: 80,
    costUsd: 0.0005,
  };
  assert.equal(compareRuns(original, fork).verdict, "improved");
});

test("compareRuns returns not_verifiable for conflicting resource deltas", () => {
  const [original, fork] = branchPair("success", "success", "same", "same");
  fork.steps[0] = { ...fork.steps[0]!, latencyMs: 80, costUsd: 0.002 };
  const result = compareRuns(original, fork);
  assert.equal(result.verdict, "not_verifiable");
  assert.match(result.verdictReason ?? "", /conflict/);
});

test("compareRuns returns regressed for a success-to-failure branch", () => {
  const [original, fork] = branchPair("success", "failure", "answer", "error");
  assert.equal(compareRuns(original, fork).verdict, "regressed");
});

test("compareRuns returns not_verifiable when outputs differ without quality evidence", () => {
  const [original, fork] = branchPair("success", "success", "answer A", "answer B");
  const result = compareRuns(original, fork);
  assert.equal(result.verdict, "not_verifiable");
  assert.match(result.verdictReason ?? "", /quality score/);
});

test("compareRuns returns not_verifiable without fork lineage", () => {
  const [original, fork] = branchPair("success", "success", "same", "same");
  delete fork.run.forkOf;
  assert.equal(compareRuns(original, fork).verdict, "not_verifiable");
});

test("compareRuns returns not_verifiable without an explicitly complete original checkpoint", () => {
  const [original, fork] = branchPair("failure", "success", "error", "answer");
  delete original.checkpoint;
  const result = compareRuns(original, fork);
  assert.equal(result.verdict, "not_verifiable");
  assert.match(result.verdictReason ?? "", /checkpoint evidence/);
});

test("compareRuns returns not_verifiable without an explicitly complete fork checkpoint", () => {
  const [original, fork] = branchPair("failure", "success", "error", "answer");
  delete fork.checkpoint;
  const result = compareRuns(original, fork);
  assert.equal(result.verdict, "not_verifiable");
  assert.match(result.verdictReason ?? "", /checkpoint evidence/);
});

test("lineDiff prefixes removed, added, and common lines", () => {
  const diff = lineDiff("alpha\nbeta\ngamma", "alpha\nBETA\ngamma");
  assert.equal(diff, "  alpha\n- beta\n+ BETA\n  gamma");
  assert.equal(lineDiff("same", "same"), "");
});

function branchPair(
  originalOutcome: RunOutcome,
  forkOutcome: RunOutcome,
  originalOutput: string,
  forkOutput: string,
): [RunGraph, RunGraph] {
  const original = graph([
    step({ index: 0, kind: "tool", name: "prefix", toolName: "prefix", toolOutput: "prefix" }),
    step({
      index: 1,
      kind: "llm",
      name: "model",
      model: "model",
      inputTokens: 4,
      outputTokens: 2,
      response: originalOutput,
    }),
  ], { traceId: "original", outcome: originalOutcome });
  const fork = graph([
    step({
      index: 1,
      kind: "llm",
      name: "model",
      model: "model",
      inputTokens: 4,
      outputTokens: 2,
      response: forkOutput,
    }),
  ], {
    traceId: "fork",
    forkOf: "original",
    forkPoint: 1,
    outcome: forkOutcome,
  });
  return [original, fork];
}
