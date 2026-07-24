import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import {
  HINDSIGHT_SCHEMA_VERSION,
  type RunnerForkRequest,
  type RunStep,
} from "@hindsight/shared";
import { hashToolArgs, recorderFromOtel } from "@hindsight/recorder";
import { createInMemoryOtel } from "@hindsight/recorder/test";
import { executeRunnerFork } from "./fork-runner.js";

const ORIGINAL_TRACE = "11111111111111111111111111111111";
const ORIGINAL_SPAN = "1111111111111111";
const toolArgs = { query: "turbine capacity factor GWh" };

const steps: RunStep[] = [
  {
    index: 0,
    kind: "llm",
    spanId: "step-0",
    name: "claude-haiku-4-5",
    startTime: "2026-07-24T00:00:00.000Z",
    latencyMs: 10,
    costUsd: 0.001,
    payloadPresent: true,
    model: "claude-haiku-4-5",
    provider: "mock",
    systemPrompt: "You are a research assistant.",
    temperature: 0,
    maxTokens: 256,
    requestMessages: [{ role: "user", content: "How many GWh?" }],
    response: {
      id: "completion-0",
      model: "claude-haiku-4-5",
      content: "Calling web_search",
      toolCalls: [{ id: "call-0", name: "web_search", args: toolArgs }],
      stopReason: "tool_use",
      usage: { input_tokens: 10, output_tokens: 5 },
    },
  },
  {
    index: 1,
    kind: "tool",
    spanId: "step-1",
    name: "web_search",
    toolName: "web_search",
    toolCallId: "call-0",
    startTime: "2026-07-24T00:00:00.020Z",
    latencyMs: 2,
    costUsd: 0,
    payloadPresent: true,
    args: toolArgs,
    argsHash: hashToolArgs(toolArgs),
    toolOutput: { error: "malformed JSON" },
    error: "MalformedToolJsonError",
  },
];

test("irrelevant mutation preserves the recorded tool failure", async () => {
  const mem = createInMemoryOtel();
  const request = runnerRequest({ type: "model_swap", model: "claude-sonnet-4-5" });
  const result = await executeRunnerFork(request, {
    otlpHttpUrl: "http://127.0.0.1:4318",
    recorderFactory: () => recorderFromOtel(mem.handles, "always", { payloadMode: "full" }),
  });
  assert.equal(result.outcome, "failure");
  assert.match(result.error ?? "", /recorded failure/);
});

test("exact tool-output override fixes the failed branch and emits lineage", async () => {
  const mem = createInMemoryOtel();
  const request = runnerRequest({
    type: "tool_output_override",
    stepIndex: 1,
    output: { results: [{ title: "valid", snippet: "40% capacity" }] },
  });
  const result = await executeRunnerFork(request, {
    otlpHttpUrl: "http://127.0.0.1:4318",
    recorderFactory: () => recorderFromOtel(mem.handles, "always", { payloadMode: "full" }),
  });
  assert.equal(result.outcome, "success");
  assert.equal(result.appliedMutationHash, request.mutationHash);
  const root = mem.spans.getFinishedSpans().find((span) => !span.parentSpanContext);
  assert.ok(root);
  assert.equal(root.links[0]?.context.traceId, ORIGINAL_TRACE);
  assert.equal(root.links[0]?.context.spanId, ORIGINAL_SPAN);
  assert.deepEqual(
    mem.spans
      .getFinishedSpans()
      .filter((span) => span.attributes["hindsight.step.kind"])
      .map((span) => span.attributes["hindsight.step.index"])
      .sort(),
    [1, 2],
  );
});

test("recorded Anthropic runs resume through the real HTTP provider adapter", async (t) => {
  let requestBody: Record<string, unknown> | undefined;
  const server = createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
      string,
      unknown
    >;
    assert.equal(request.headers["x-api-key"], "test-key");
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "anthropic-response",
        model: "claude-haiku-4-5",
        content: [{ type: "text", text: "fixed" }],
        stop_reason: "end_turn",
        usage: { input_tokens: 12, output_tokens: 3 },
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => new Promise<void>((resolve) => server.close(() => resolve())));
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const mem = createInMemoryOtel();
  const mutation = { type: "params" as const, temperature: 0.4 };
  const request = runnerRequest(mutation);
  request.checkpoint.forkAtStep = 0;
  request.checkpoint.steps = [
    {
      ...steps[0],
      provider: "anthropic",
      response: {
        id: "recorded",
        model: "claude-haiku-4-5",
        content: "recorded",
        toolCalls: [],
        stopReason: "end",
        usage: { input_tokens: 10, output_tokens: 2 },
      },
    },
  ];
  const result = await executeRunnerFork(request, {
    otlpHttpUrl: "http://127.0.0.1:4318",
    anthropicApiKey: "test-key",
    anthropicBaseUrl: `http://127.0.0.1:${address.port}`,
    recorderFactory: () =>
      recorderFromOtel(mem.handles, "always", { payloadMode: "full" }),
  });

  assert.equal(result.outcome, "success");
  assert.equal(requestBody?.temperature, 0.4);
  assert.equal(result.runnerRevision, "demo-research@1");
});

function runnerRequest(mutation: RunnerForkRequest["mutation"]): RunnerForkRequest {
  return {
    idempotencyKey: "runner-test",
    mutation,
    mutationHash: hashToolArgs(mutation),
    mockPolicy: "strict",
    checkpoint: {
      schemaVersion: HINDSIGHT_SCHEMA_VERSION,
      originalTraceId: ORIGINAL_TRACE,
      originalSpanId: ORIGINAL_SPAN,
      runId: "original-run",
      agentId: "research",
      agentRevision: "demo-research@1",
      forkAtStep: 1,
      steps,
    },
  };
}
