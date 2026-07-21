/**
 * Fork executor check: a failed original run, forked at the poisoned tool step
 * with a corrected output, re-executes to success. Uses a stub SigNoz reader so
 * no live instance is needed; the recorder exports to a dead OTLP endpoint,
 * which fails silently (allSettled) and does not affect the computed outcome.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { ATTR, GENAI_ATTR, PAYLOAD_LOG_MARKER, type ForkRequest } from "@hindsight/shared";
import { hashToolArgs } from "@hindsight/recorder";
import { DemoForkExecutor, type SignozReader } from "./executor.js";
import type { PayloadLogInput, SpanInput } from "../rungraph/builder.js";

const TRACE = "aaaabbbbccccdddd";
const ARGS = { query: "turbine capacity factor GWh" };
const ARGS_HASH = hashToolArgs(ARGS);

const spans: SpanInput[] = [
  {
    traceId: TRACE,
    spanId: "root",
    name: "run research",
    startTime: "2026-07-21T00:00:00.000Z",
    durationNano: 1_000_000_000,
    attributes: {
      [ATTR.RUN_ID]: "r1",
      [ATTR.AGENT_ID]: "research",
      [ATTR.OUTCOME]: "failure",
    },
  },
  {
    traceId: TRACE,
    spanId: "s0",
    parentSpanId: "root",
    name: "claude-haiku-4-5",
    startTime: "2026-07-21T00:00:00.100Z",
    durationNano: 200_000_000,
    attributes: {
      [ATTR.STEP_INDEX]: 0,
      [ATTR.STEP_KIND]: "llm",
      [ATTR.PAYLOAD_REF]: "r1:0",
      [GENAI_ATTR.REQUEST_MODEL]: "claude-haiku-4-5",
      [GENAI_ATTR.INPUT_TOKENS]: 40,
      [GENAI_ATTR.OUTPUT_TOKENS]: 12,
    },
  },
  {
    traceId: TRACE,
    spanId: "s1",
    parentSpanId: "root",
    name: "web_search",
    startTime: "2026-07-21T00:00:00.400Z",
    durationNano: 100_000_000,
    attributes: {
      [ATTR.STEP_INDEX]: 1,
      [ATTR.STEP_KIND]: "tool",
      [ATTR.PAYLOAD_REF]: "r1:1",
      [ATTR.ARGS_HASH]: ARGS_HASH,
      [GENAI_ATTR.ERROR_TYPE]: "MalformedToolJsonError",
    },
  },
];

const logs: PayloadLogInput[] = [
  {
    marker: PAYLOAD_LOG_MARKER,
    payloadRef: "r1:0",
    stepIndex: 0,
    kind: "llm",
    request: [{ role: "user", content: "How many GWh?" }],
    response: { content: "Calling web_search" },
    spanId: "s0",
  },
  {
    marker: PAYLOAD_LOG_MARKER,
    payloadRef: "r1:1",
    stepIndex: 1,
    kind: "tool",
    args: ARGS,
    output: { error: "malformed JSON from tool" },
    spanId: "s1",
  },
];

const stubSignoz: SignozReader = {
  async getSpansForTrace() {
    return spans;
  },
  async getPayloadLogs() {
    return logs;
  },
};

test("fork of a failed run with corrected tool output re-executes to success", async () => {
  const exec = new DemoForkExecutor(stubSignoz, { otlpHttpUrl: "http://127.0.0.1:4318" });
  const request: ForkRequest = {
    traceId: TRACE,
    forkAtStep: 1,
    mutation: {
      type: "tool_output_override",
      stepIndex: 1,
      output: { query: ARGS.query, results: [{ title: "valid", snippet: "0.4 capacity factor" }] },
    },
    mockPolicy: "hybrid",
  };

  const result = await exec.execute(request);

  assert.equal(result.originalTraceId, TRACE);
  assert.equal(result.outcome, "success", "fork should pass where the original failed");
  assert.ok(result.forkTraceId.length > 0, "fork must produce a new trace id");
  assert.notEqual(result.forkTraceId, TRACE, "fork trace must differ from the original");
  assert.ok(result.stepCount >= 1);
});

test("missing original run returns a graceful failure result", async () => {
  const empty: SignozReader = {
    async getSpansForTrace() {
      return [];
    },
    async getPayloadLogs() {
      return [];
    },
  };
  const exec = new DemoForkExecutor(empty, { otlpHttpUrl: "http://127.0.0.1:4318" });
  const result = await exec.execute({
    traceId: "missing",
    forkAtStep: 0,
    mutation: { type: "model_swap", model: "claude-sonnet-4-5" },
    mockPolicy: "strict",
  });
  assert.equal(result.outcome, "failure");
  assert.equal(result.error, "original run not found");
});
