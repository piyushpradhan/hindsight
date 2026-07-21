import { test } from "node:test";
import assert from "node:assert/strict";
import { buildRunGraph, summarizeSpans } from "./builder.js";
import { TRACE_ID, fixturePayloadLogs, fixtureSpans } from "./builder.test-fixture.js";

const graph = buildRunGraph(TRACE_ID, fixtureSpans(), fixturePayloadLogs());

test("steps are sorted by step index with kinds and names", () => {
  assert.deepEqual(
    graph.steps.map((s) => [s.index, s.kind, s.name]),
    [
      [0, "llm", "gpt-4o"],
      [1, "tool", "search"],
      [2, "llm", "gpt-4o"],
      [3, "tool", "write_file"],
    ],
  );
});

test("run summary: tokens, cost (attr + pricing fallback), outcome, counts", () => {
  const { run } = graph;
  assert.equal(run.runId, "run-1");
  assert.equal(run.traceId, TRACE_ID);
  assert.equal(run.agentId, "agent-1");
  assert.equal(run.taskId, "task-9");
  assert.equal(run.outcome, "failure");
  assert.equal(run.stepCount, 4);
  assert.equal(run.totalTokens, 430);
  assert.ok(Math.abs(run.costUsd - 0.00205) < 1e-9, `costUsd=${run.costUsd}`);
  assert.equal(run.forkOf, undefined);
  assert.equal(run.startTime, "2026-07-20T10:00:00.000Z");
  assert.equal(run.endTime, "2026-07-20T10:00:05.000Z");
});

test("payload logs merge onto steps via payloadRef", () => {
  const [llm0, tool1, llm2, tool3] = graph.steps;
  assert.equal(llm0.requestMessages?.length, 2);
  assert.equal(llm0.requestMessages?.[0].role, "system");
  assert.deepEqual(llm0.response, { role: "assistant", content: "I'll search first." });
  assert.deepEqual(tool1.args, { query: "hindsight" });
  assert.deepEqual(tool1.toolOutput, ["result-1", "result-2"]);
  assert.equal(llm2.requestMessages, undefined); // no payload ref on step 2
  assert.deepEqual(tool3.args, { path: "/tmp/out.txt" });
  assert.equal(tool3.toolOutput, undefined); // failed tool emitted no output
});

test("per-step economics and error propagation", () => {
  const [llm0, tool1, llm2, tool3] = graph.steps;
  assert.ok(Math.abs(llm0.costUsd - 0.00075) < 1e-12);
  assert.equal(llm0.inputTokens, 100);
  assert.equal(llm0.outputTokens, 50);
  assert.equal(tool1.argsHash, "h1");
  assert.equal(tool1.latencyMs, 200);
  assert.ok(Math.abs(llm2.costUsd - 0.0013) < 1e-12, "pricing fallback");
  assert.equal(tool3.error, "ToolError");
});

test("summarizeSpans works without payload logs (run-list path)", () => {
  const run = summarizeSpans(TRACE_ID, fixtureSpans());
  assert.equal(run.stepCount, 4);
  assert.equal(run.totalTokens, 430);
  assert.equal(run.outcome, "failure");
});
