import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ATTR,
  GENAI_ATTR,
  HINDSIGHT_SCHEMA_VERSION,
  METRIC,
  PAYLOAD_LOG_MARKER,
  computeCostUsd,
} from "@hindsight/shared";
import { recorderFromOtel } from "./recorder.js";
import { createInMemoryOtel } from "./testutil/inmemory.js";

function mockCompletion(input: number, output: number) {
  return {
    id: "cmp_1",
    model: "claude-haiku-4-5",
    content: "ok",
    usage: { input_tokens: input, output_tokens: output },
  };
}

test("llm step: span attributes, cost, and payload log with marker", async () => {
  const mem = createInMemoryOtel();
  const rec = recorderFromOtel(mem.handles, "always");
  const run = rec.startRun({
    agentId: "research",
    agentRevision: "research@abc123",
    taskId: "t-1",
  });

  const params = {
    model: "claude-haiku-4-5",
    messages: [{ role: "user", content: "hello" }],
    temperature: 0,
    max_tokens: 256,
    provider: "mock",
  };
  await run.llm(async () => mockCompletion(100, 20), params);
  run.end({ outcome: "success" });
  await mem.handles.shutdown();

  const spans = mem.spans.getFinishedSpans();
  const root = spans.find((s) => s.attributes[ATTR.OUTCOME] !== undefined);
  const llm = spans.find((s) => s.attributes[ATTR.STEP_KIND] === "llm");
  assert.ok(root, "root span exists");
  assert.ok(llm, "llm step span exists");

  // Root attributes.
  assert.equal(root!.attributes[ATTR.AGENT_ID], "research");
  assert.equal(root!.attributes[ATTR.TASK_ID], "t-1");
  assert.equal(root!.attributes[ATTR.OUTCOME], "success");
  assert.equal(root!.attributes[ATTR.SCHEMA_VERSION], HINDSIGHT_SCHEMA_VERSION);
  assert.equal(root!.attributes[ATTR.AGENT_REVISION], "research@abc123");
  assert.equal(root!.attributes[ATTR.RUN_STEP_COUNT], 1);
  assert.equal(root!.attributes[ATTR.RUN_TOKENS_TOTAL], 120);
  assert.equal(root!.attributes[ATTR.PAYLOAD_COMPLETE], true);
  assert.equal(typeof root!.attributes[ATTR.RUN_ID], "string");

  // Child is parented on the root.
  assert.equal(llm!.parentSpanContext?.spanId, root!.spanContext().spanId);

  // LLM step attributes.
  assert.equal(llm!.attributes[ATTR.STEP_INDEX], 0);
  assert.equal(llm!.name, "claude-haiku-4-5");
  assert.equal(llm!.attributes[GENAI_ATTR.SYSTEM], "mock");
  assert.equal(llm!.attributes[GENAI_ATTR.REQUEST_MODEL], "claude-haiku-4-5");
  assert.equal(llm!.attributes[GENAI_ATTR.TEMPERATURE], 0);
  assert.equal(llm!.attributes[GENAI_ATTR.MAX_TOKENS], 256);
  assert.equal(llm!.attributes[GENAI_ATTR.INPUT_TOKENS], 100);
  assert.equal(llm!.attributes[GENAI_ATTR.OUTPUT_TOKENS], 20);
  assert.equal(
    llm!.attributes[ATTR.COST_USD],
    computeCostUsd("claude-haiku-4-5", 100, 20),
  );
  const payloadRef = llm!.attributes[ATTR.PAYLOAD_REF];
  assert.equal(typeof payloadRef, "string");

  // Payload log record.
  const records = mem.logsExporter
    .getFinishedLogRecords()
    .filter((record) => JSON.parse(String(record.body)).marker === PAYLOAD_LOG_MARKER);
  assert.equal(records.length, 1);
  const body = JSON.parse(String(records[0].body));
  assert.equal(body.marker, PAYLOAD_LOG_MARKER);
  assert.equal(body.payloadRef, payloadRef);
  assert.equal(body.stepIndex, 0);
  assert.equal(body.kind, "llm");
  assert.deepEqual(body.request.messages, params.messages);
  assert.equal(body.request.model, params.model);
  assert.equal(body.request.provider, params.provider);
  assert.equal(body.response.usage.input_tokens, 100);
  // Log inherits the step span's trace/span ids.
  assert.equal(records[0].spanContext?.traceId, run.traceId);
  assert.equal(records[0].spanContext?.spanId, llm!.spanContext().spanId);
});

test("tool step: name on span, args hash, payload with args+output", async () => {
  const mem = createInMemoryOtel();
  const rec = recorderFromOtel(mem.handles, "always");
  const run = rec.startRun({ agentId: "research" });

  const args = { query: "otel", limit: 5 };
  await run.tool("web_search", args, async () => ({ hits: ["a", "b"] }));
  run.end({ outcome: "success" });
  await mem.handles.shutdown();

  const tool = mem.spans
    .getFinishedSpans()
    .find((s) => s.attributes[ATTR.STEP_KIND] === "tool");
  assert.ok(tool);
  assert.equal(tool!.name, "web_search");
  assert.equal(typeof tool!.attributes[ATTR.ARGS_HASH], "string");

  const body = JSON.parse(String(mem.logsExporter.getFinishedLogRecords()[0].body));
  assert.equal(body.kind, "tool");
  assert.deepEqual(body.args, args);
  assert.deepEqual(body.output, { hits: ["a", "b"] });
});

test("loop score reaches >=3 when a tool is called 3x with identical args", async () => {
  const mem = createInMemoryOtel();
  const rec = recorderFromOtel(mem.handles, "always");
  const run = rec.startRun({ agentId: "loopy" });

  const args = { q: "same" };
  for (let i = 0; i < 3; i++) {
    await run.tool("ticket_lookup", args, async () => ({ ok: true }));
  }
  assert.ok(run.loopScore() >= 3, `loop score was ${run.loopScore()}`);
  run.end({ outcome: "failure" });
  await mem.handles.shutdown();
});

test("error step sets error.type, records exception, and rethrows", async () => {
  const mem = createInMemoryOtel();
  const rec = recorderFromOtel(mem.handles, "always");
  const run = rec.startRun({ agentId: "research" });

  await assert.rejects(
    run.tool("web_search", { q: "x" }, async () => {
      throw new TypeError("boom");
    }),
    /boom/,
  );
  run.end({ outcome: "failure" });
  await mem.handles.shutdown();

  const tool = mem.spans
    .getFinishedSpans()
    .find((s) => s.attributes[ATTR.STEP_KIND] === "tool");
  assert.equal(tool!.attributes[GENAI_ATTR.ERROR_TYPE], "TypeError");
  assert.ok(tool!.events.some((e) => e.name === "exception"));
});

test("onError policy only records failed steps", async () => {
  const mem = createInMemoryOtel();
  const rec = recorderFromOtel(mem.handles, "onError");
  const run = rec.startRun({ agentId: "research" });

  await run.tool("ok_tool", { a: 1 }, async () => ({ ok: true }));
  await assert.rejects(
    run.tool("bad_tool", { a: 2 }, async () => {
      throw new Error("nope");
    }),
  );
  run.end({ outcome: "failure" });
  await mem.handles.shutdown();

  const records = mem.logsExporter
    .getFinishedLogRecords()
    .filter((record) => JSON.parse(String(record.body)).marker === PAYLOAD_LOG_MARKER);
  assert.equal(records.length, 1);
  const body = JSON.parse(String(records[0].body));
  assert.equal(body.kind, "tool");
  assert.equal(body.stepIndex, 1);
});

test("metrics: runs, tokens, cost, and tool errors are emitted", async () => {
  const mem = createInMemoryOtel();
  const rec = recorderFromOtel(mem.handles, "always");
  const run = rec.startRun({ agentId: "research" });

  await run.llm(async () => mockCompletion(10, 5), {
    model: "claude-haiku-4-5",
    messages: [{ role: "user", content: "hi" }],
  });
  await assert.rejects(
    run.tool("web_search", { q: "x" }, async () => {
      throw new Error("fail");
    }),
  );
  run.end({ outcome: "failure" });

  await mem.meterProvider.forceFlush();
  const metricNames = collectMetricNames(mem);
  assert.ok(metricNames.has(METRIC.RUNS_TOTAL));
  assert.ok(metricNames.has(METRIC.TOKENS_TOTAL));
  assert.ok(metricNames.has(METRIC.COST_USD_TOTAL));
  assert.ok(metricNames.has(METRIC.STEP_DURATION));
  assert.ok(metricNames.has(METRIC.TOOL_ERRORS_TOTAL));
  const points = collectMetricPoints(mem);
  assert.ok(
    points.some(
      (point) =>
        point.name === METRIC.RUNS_TOTAL &&
        point.attributes[ATTR.AGENT_ID] === "research" &&
        point.attributes[ATTR.OUTCOME] === "failure",
    ),
  );
  assert.ok(
    points.some(
      (point) =>
        point.name === METRIC.TOOL_ERRORS_TOTAL &&
        point.attributes[ATTR.TOOL_NAME] === "web_search",
    ),
  );
  await mem.handles.shutdown();
});

test("unknown pricing stays unknown and a supplied price table is honored", async () => {
  const unknown = createInMemoryOtel();
  const unknownRecorder = recorderFromOtel(unknown.handles, "always", {
    payloadMode: "full",
  });
  const unknownRun = unknownRecorder.startRun({
    agentId: "research",
    agentRevision: "research@1",
  });
  await unknownRun.llm(async () => mockCompletion(1_000, 500), {
    model: "unknown-model",
    messages: [],
  });
  unknownRun.end({ outcome: "success" });
  await unknown.handles.shutdown();
  const unknownSpans = unknown.spans.getFinishedSpans();
  const unknownRoot = unknownSpans.find((span) => span.attributes[ATTR.OUTCOME] !== undefined);
  const unknownStep = unknownSpans.find((span) => span.attributes[ATTR.STEP_KIND] === "llm");
  assert.equal(unknownRoot?.attributes[ATTR.RUN_COST_USD], undefined);
  assert.equal(unknownStep?.attributes[ATTR.COST_USD], undefined);
  assert.equal(unknownStep?.attributes[ATTR.PRICE_SOURCE], "unknown");

  const custom = createInMemoryOtel();
  const customRecorder = recorderFromOtel(custom.handles, "always", {
    payloadMode: "full",
    priceTable: { "custom-model": { inputPer1M: 2, outputPer1M: 4 } },
  });
  const customRun = customRecorder.startRun({
    agentId: "research",
    agentRevision: "research@1",
  });
  await customRun.llm(async () => mockCompletion(1_000, 500), {
    model: "custom-model",
    messages: [],
  });
  customRun.end({ outcome: "success" });
  await custom.handles.shutdown();
  const customRoot = custom.spans
    .getFinishedSpans()
    .find((span) => span.attributes[ATTR.OUTCOME] !== undefined);
  assert.equal(customRoot?.attributes[ATTR.RUN_COST_USD], 0.004);
});

function collectMetricNames(mem: ReturnType<typeof createInMemoryOtel>): Set<string> {
  const names = new Set<string>();
  for (const rm of mem.metricsExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const metric of sm.metrics) names.add(metric.descriptor.name);
    }
  }
  return names;
}

function collectMetricPoints(mem: ReturnType<typeof createInMemoryOtel>) {
  const points: Array<{ name: string; attributes: Record<string, unknown> }> = [];
  for (const rm of mem.metricsExporter.getMetrics()) {
    for (const sm of rm.scopeMetrics) {
      for (const metric of sm.metrics) {
        for (const point of metric.dataPoints) {
          points.push({ name: metric.descriptor.name, attributes: point.attributes });
        }
      }
    }
  }
  return points;
}
