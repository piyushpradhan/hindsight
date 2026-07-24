/**
 * Hand-written fixture: one FAILED run ("run-1", agent-1) of 5 spans
 * (root + llm, tool, llm, tool) and 4 payload logs. Step 2 deliberately
 * omits ATTR.COST_USD to exercise the known-price fallback (same value:
 * gpt-4o, 200 in / 80 out -> $0.0013). Totals: 430 tokens, $0.00205.
 */
import {
  ATTR,
  GENAI_ATTR,
  HINDSIGHT_SCHEMA_VERSION,
  PAYLOAD_LOG_MARKER,
} from "@hindsight/shared";
import { createHash } from "node:crypto";
import { hashToolArgs } from "@hindsight/recorder";
import type { PayloadLogInput, SpanInput } from "./builder.js";

export const TRACE_ID = "11111111111111111111111111111111";

const T0 = Date.parse("2026-07-20T10:00:00.000Z");
const iso = (offsetMs: number) => new Date(T0 + offsetMs).toISOString();
const ns = (ms: number) => ms * 1e6;

const RUN_ATTRS = {
  [ATTR.RUN_ID]: "run-1",
  [ATTR.AGENT_ID]: "agent-1",
} as const;

export function fixtureSpans(): SpanInput[] {
  return [
    {
      traceId: TRACE_ID,
      spanId: "root01",
      name: "agent.run",
      serviceName: "hindsight-agent-agent-1",
      startTime: iso(0),
      durationNano: ns(5000),
      attributes: {
        ...RUN_ATTRS,
        [ATTR.SCHEMA_VERSION]: HINDSIGHT_SCHEMA_VERSION,
        [ATTR.AGENT_REVISION]: "agent-1@abc123",
        [ATTR.TASK_ID]: "task-9",
        [ATTR.OUTCOME]: "failure",
        [ATTR.RUN_STEP_COUNT]: 4,
        [ATTR.RUN_TOKENS_TOTAL]: 430,
        [ATTR.RUN_COST_USD]: 0.00205,
        [ATTR.PAYLOAD_COMPLETE]: true,
      },
    },
    {
      traceId: TRACE_ID,
      spanId: "s0",
      parentSpanId: "root01",
      name: "llm.completion",
      startTime: iso(100),
      durationNano: ns(800),
      attributes: {
        [ATTR.STEP_INDEX]: 0,
        [ATTR.STEP_KIND]: "llm",
        [ATTR.PAYLOAD_REF]: "p0",
        [ATTR.SCHEMA_VERSION]: HINDSIGHT_SCHEMA_VERSION,
        [ATTR.COST_USD]: 0.00075,
        [GENAI_ATTR.REQUEST_MODEL]: "gpt-4o",
        [GENAI_ATTR.TEMPERATURE]: 0.2,
        [GENAI_ATTR.INPUT_TOKENS]: 100,
        [GENAI_ATTR.OUTPUT_TOKENS]: 50,
      },
    },
    {
      traceId: TRACE_ID,
      spanId: "s1",
      parentSpanId: "root01",
      name: "search",
      startTime: iso(1000),
      durationNano: ns(200),
      attributes: {
        [ATTR.STEP_INDEX]: 1,
        [ATTR.STEP_KIND]: "tool",
        [ATTR.PAYLOAD_REF]: "p1",
        [ATTR.SCHEMA_VERSION]: HINDSIGHT_SCHEMA_VERSION,
        [ATTR.TOOL_CALL_ID]: "call-1",
        [ATTR.ARGS_HASH]: hashToolArgs({ query: "hindsight" }),
        [ATTR.COST_USD]: 0,
      },
    },
    {
      traceId: TRACE_ID,
      spanId: "s2",
      parentSpanId: "root01",
      name: "llm.completion",
      startTime: iso(1300),
      durationNano: ns(900),
      attributes: {
        [ATTR.STEP_INDEX]: 2,
        [ATTR.STEP_KIND]: "llm",
        [ATTR.PAYLOAD_REF]: "p2",
        [ATTR.SCHEMA_VERSION]: HINDSIGHT_SCHEMA_VERSION,
        [GENAI_ATTR.REQUEST_MODEL]: "gpt-4o",
        [GENAI_ATTR.INPUT_TOKENS]: 200,
        [GENAI_ATTR.OUTPUT_TOKENS]: 80,
      },
    },
    {
      traceId: TRACE_ID,
      spanId: "s3",
      parentSpanId: "root01",
      name: "write_file",
      startTime: iso(2300),
      durationNano: ns(150),
      attributes: {
        [ATTR.STEP_INDEX]: 3,
        [ATTR.STEP_KIND]: "tool",
        [ATTR.PAYLOAD_REF]: "p3",
        [ATTR.SCHEMA_VERSION]: HINDSIGHT_SCHEMA_VERSION,
        [ATTR.TOOL_CALL_ID]: "call-3",
        [ATTR.ARGS_HASH]: hashToolArgs({ path: "/tmp/out.txt" }),
        [ATTR.COST_USD]: 0,
        [GENAI_ATTR.ERROR_TYPE]: "ToolError",
      },
    },
  ];
}

export function fixturePayloadLogs(): PayloadLogInput[] {
  return [
    {
      marker: PAYLOAD_LOG_MARKER,
      schemaVersion: HINDSIGHT_SCHEMA_VERSION,
      payloadRef: "p0",
      stepIndex: 0,
      kind: "llm",
      traceId: TRACE_ID,
      spanId: "s0",
      request: {
        messages: [
          { role: "system", content: "You are a demo agent." },
          { role: "user", content: "Summarize the repo." },
        ],
        system: "You are a demo agent.",
        model: "gpt-4o",
        provider: "openai",
        temperature: 0.2,
        maxTokens: 512,
      },
      response: {
        role: "assistant",
        content: "I'll search first.",
        toolCalls: [{ id: "call-1", name: "search", args: { query: "hindsight" } }],
      },
      truncated: false,
      redacted: false,
    },
    {
      marker: PAYLOAD_LOG_MARKER,
      schemaVersion: HINDSIGHT_SCHEMA_VERSION,
      payloadRef: "p1",
      stepIndex: 1,
      kind: "tool",
      traceId: TRACE_ID,
      spanId: "s1",
      args: { query: "hindsight" },
      output: ["result-1", "result-2"],
      toolCallId: "call-1",
      truncated: false,
      redacted: false,
    },
    {
      marker: PAYLOAD_LOG_MARKER,
      schemaVersion: HINDSIGHT_SCHEMA_VERSION,
      payloadRef: "p2",
      stepIndex: 2,
      kind: "llm",
      traceId: TRACE_ID,
      spanId: "s2",
      request: {
        messages: [
          { role: "system", content: "You are a demo agent." },
          { role: "user", content: "Summarize the repo." },
          { role: "assistant", content: "I'll search first." },
          { role: "tool", content: ["result-1", "result-2"] },
        ],
        system: "You are a demo agent.",
        model: "gpt-4o",
        provider: "openai",
        temperature: 0.2,
        maxTokens: 512,
      },
      response: {
        role: "assistant",
        content: "Writing result.",
        toolCalls: [{ id: "call-3", name: "write_file", args: { path: "/tmp/out.txt" } }],
      },
      truncated: false,
      redacted: false,
    },
    {
      marker: PAYLOAD_LOG_MARKER,
      schemaVersion: HINDSIGHT_SCHEMA_VERSION,
      payloadRef: "p3",
      stepIndex: 3,
      kind: "tool",
      traceId: TRACE_ID,
      spanId: "s3",
      args: { path: "/tmp/out.txt" },
      output: { error: "disk full" },
      toolCallId: "call-3",
      truncated: false,
      redacted: false,
    },
  ].map((log) => {
    const body =
      log.kind === "llm"
        ? { request: log.request, response: log.response }
        : { args: log.args, output: log.output, toolCallId: log.toolCallId };
    const json = JSON.stringify(body);
    return {
      ...log,
      bytes: Buffer.byteLength(json),
      hash: createHash("sha256").update(json).digest("hex"),
    } as PayloadLogInput;
  });
}
