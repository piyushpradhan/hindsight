import { test } from "node:test";
import assert from "node:assert/strict";
import { recorderFromOtel } from "@hindsight/recorder";
import { createInMemoryOtel } from "@hindsight/recorder/test";
import { buildRunGraph, summarizeSpans } from "./builder.js";
import { hashToolArgs } from "@hindsight/recorder";
import { TRACE_ID, fixturePayloadLogs, fixtureSpans } from "./builder.test-fixture.js";
import { parsePayloadLogBody } from "../payload-shape.js";

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
  assert.ok(run.costUsd !== null && Math.abs(run.costUsd - 0.00205) < 1e-9, `costUsd=${run.costUsd}`);
  assert.equal(run.forkOf, undefined);
  assert.equal(run.startTime, "2026-07-20T10:00:00.000Z");
  assert.equal(run.endTime, "2026-07-20T10:00:05.000Z");
});

test("payload logs merge onto steps via payloadRef", () => {
  const [llm0, tool1, llm2, tool3] = graph.steps;
  assert.equal(llm0.requestMessages?.length, 2);
  assert.equal(llm0.requestMessages?.[0].role, "system");
  assert.equal((llm0.response as { content: string }).content, "I'll search first.");
  assert.deepEqual(tool1.args, { query: "hindsight" });
  assert.deepEqual(tool1.toolOutput, ["result-1", "result-2"]);
  assert.equal(llm2.requestMessages?.length, 4);
  assert.deepEqual(tool3.args, { path: "/tmp/out.txt" });
  assert.deepEqual(tool3.toolOutput, { error: "disk full" });
});

test("per-step economics and error propagation", () => {
  const [llm0, tool1, llm2, tool3] = graph.steps;
  assert.ok(llm0.costUsd !== null && Math.abs(llm0.costUsd - 0.00075) < 1e-12);
  assert.equal(llm0.inputTokens, 100);
  assert.equal(llm0.outputTokens, 50);
  assert.equal(tool1.argsHash, hashToolArgs({ query: "hindsight" }));
  assert.equal(tool1.latencyMs, 200);
  assert.ok(llm2.costUsd !== null && Math.abs(llm2.costUsd - 0.0013) < 1e-12, "pricing fallback");
  assert.equal(tool3.error, "ToolError");
});

test("summarizeSpans works without payload logs (run-list path)", () => {
  const run = summarizeSpans(TRACE_ID, fixtureSpans());
  assert.equal(run.stepCount, 4);
  assert.equal(run.totalTokens, 430);
  assert.equal(run.outcome, "failure");
});

test("checkpoint rejects missing and tampered payload evidence", () => {
  const missing = buildRunGraph(TRACE_ID, fixtureSpans(), fixturePayloadLogs().slice(1));
  assert.equal(missing.checkpoint?.complete, false);
  assert.ok(missing.checkpoint?.issues.some((issue) => issue.code === "missing_payload"));

  const tampered = fixturePayloadLogs();
  tampered[0] = { ...tampered[0], response: { content: "changed" } };
  const graph = buildRunGraph(TRACE_ID, fixtureSpans(), tampered);
  assert.equal(graph.checkpoint?.complete, false);
  assert.ok(graph.checkpoint?.issues.some((issue) => issue.code === "payload_hash_mismatch"));
});

test("builder reconstructs a complete checkpoint from the real recorder contract", async () => {
  const memory = createInMemoryOtel();
  const recorder = recorderFromOtel(memory.handles, "always", { payloadMode: "full" });
  const run = recorder.startRun({ agentId: "agent-live", agentRevision: "agent-live@1" });
  await run.llm(
    async () => ({
      model: "gpt-4o",
      content: "searching",
      toolCalls: [{ id: "call-live", name: "search", args: { q: "hindsight" } }],
      usage: { input_tokens: 10, output_tokens: 5 },
    }),
    {
      model: "gpt-4o",
      provider: "mock",
      messages: [{ role: "user", content: "search" }],
    },
  );
  await run.tool(
    "search",
    { q: "hindsight" },
    async () => ({ hits: 1 }),
    { toolCallId: "call-live" },
  );
  run.end({ outcome: "success" });
  await memory.handles.shutdown();

  const spans = memory.spans.getFinishedSpans().map((span) => ({
    traceId: span.spanContext().traceId,
    spanId: span.spanContext().spanId,
    parentSpanId: span.parentSpanContext?.spanId,
    name: span.name,
    startTime: new Date(hrTimeMs(span.startTime)).toISOString(),
    durationNano: span.duration[0] * 1e9 + span.duration[1],
    attributes: Object.fromEntries(
      Object.entries(span.attributes).filter(
        (entry): entry is [string, string | number | boolean] =>
          typeof entry[1] === "string" ||
          typeof entry[1] === "number" ||
          typeof entry[1] === "boolean",
      ),
    ),
  }));
  const logs = memory.logsExporter
    .getFinishedLogRecords()
    .map((record) => {
      const payload = parsePayloadLogBody(record.body);
      return payload
        ? {
            ...payload,
            traceId: record.spanContext?.traceId,
            spanId: record.spanContext?.spanId,
          }
        : null;
    })
    .filter((log): log is NonNullable<typeof log> => log !== null);
  const graph = buildRunGraph(run.traceId, spans, logs);

  assert.equal(graph.checkpoint?.complete, true);
  assert.equal(graph.run.totalTokens, 15);
  assert.equal(graph.steps[1].toolCallId, "call-live");
  assert.deepEqual(graph.steps[1].toolOutput, { hits: 1 });
});

function hrTimeMs(time: [number, number]): number {
  return time[0] * 1_000 + time[1] / 1e6;
}
