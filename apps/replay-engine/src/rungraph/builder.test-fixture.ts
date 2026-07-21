/**
 * Hand-written fixture: one FAILED run ("run-1", agent-1) of 5 spans
 * (root + llm, tool, llm, tool) and 3 payload logs. Step 2 deliberately
 * omits ATTR.COST_USD to exercise the computeCostUsd fallback (same value:
 * gpt-4o, 200 in / 80 out -> $0.0013). Totals: 430 tokens, $0.00205.
 */
import { ATTR, GENAI_ATTR, PAYLOAD_LOG_MARKER } from "@hindsight/shared";
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
        [ATTR.TASK_ID]: "task-9",
        [ATTR.OUTCOME]: "failure",
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
        ...RUN_ATTRS,
        [ATTR.STEP_INDEX]: 0,
        [ATTR.STEP_KIND]: "llm",
        [ATTR.PAYLOAD_REF]: "p0",
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
        ...RUN_ATTRS,
        [ATTR.STEP_INDEX]: 1,
        [ATTR.STEP_KIND]: "tool",
        [ATTR.PAYLOAD_REF]: "p1",
        [ATTR.ARGS_HASH]: "h1",
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
        ...RUN_ATTRS,
        [ATTR.STEP_INDEX]: 2,
        [ATTR.STEP_KIND]: "llm",
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
        ...RUN_ATTRS,
        [ATTR.STEP_INDEX]: 3,
        [ATTR.STEP_KIND]: "tool",
        [ATTR.PAYLOAD_REF]: "p2",
        [ATTR.ARGS_HASH]: "h2",
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
      payloadRef: "p0",
      stepIndex: 0,
      kind: "llm",
      traceId: TRACE_ID,
      spanId: "s0",
      request: [
        { role: "system", content: "You are a demo agent." },
        { role: "user", content: "Summarize the repo." },
      ],
      response: { role: "assistant", content: "I'll search first." },
    },
    {
      marker: PAYLOAD_LOG_MARKER,
      payloadRef: "p1",
      stepIndex: 1,
      kind: "tool",
      traceId: TRACE_ID,
      spanId: "s1",
      args: { query: "hindsight" },
      output: ["result-1", "result-2"],
    },
    {
      marker: PAYLOAD_LOG_MARKER,
      payloadRef: "p2",
      stepIndex: 3,
      kind: "tool",
      traceId: TRACE_ID,
      spanId: "s3",
      args: { path: "/tmp/out.txt" },
      // no output: the tool call failed
    },
  ];
}
