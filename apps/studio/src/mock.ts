import type {
  AgentFleetStat,
  ChatMessage,
  CompareResult,
  ForkRequest,
  ForkResult,
  Incident,
  RunGraph,
  RunStep,
  RunSummary,
} from "@hindsight/shared";

export const MOCK_ORIGINAL_TRACE = "9f1c2b7a4d6e4803b5a1c9e2f7d30618";
export const MOCK_FORK_TRACE = "2b7d4e9f1a3c4856b0d2e7f9a1c40635";
export const MOCK_OK_TRACE = "77aa10bc52d94e8f9c3d6b1a04e7f259";
export const MOCK_TIMEOUT_TRACE = "c58e04a1b62d47f3a90c1e5d8b2f6037";

/* ------------------------- failed research-agent run ------------------------ */

const sys: ChatMessage = {
  role: "system",
  content:
    "You are ResearchAgent. Answer valuation questions precisely. Always adjust for venue trading fees when the user asks for a net figure. Cite the tools you used.",
};
const usr: ChatMessage = {
  role: "user",
  content: "What is 0.35 BTC worth in EUR right now? I trade on Kraken, so include their fee in the estimate.",
};
const asst0: ChatMessage = {
  role: "assistant",
  content: {
    content: "I'll pull the current BTC/EUR price first.",
    toolCalls: [{ name: "web_search", arguments: { query: "bitcoin price eur" } }],
  },
};
const tool1: ChatMessage = {
  role: "tool",
  content: JSON.stringify({
    results: [
      { title: "BTC to EUR | CoinDesk", snippet: "Bitcoin trades at €61,245.50, up 1.8% in 24h.", url: "https://coindesk.com/price/bitcoin" },
      { title: "Kraken BTC/EUR", snippet: "Last: €61,244.90 · 24h vol 412 BTC.", url: "https://kraken.com/prices/bitcoin" },
    ],
  }),
};
const asst2: ChatMessage = {
  role: "assistant",
  content: {
    content: "BTC is trading around €61,245.50. I'll calculate the gross value for 0.35 BTC.",
    toolCalls: [{ name: "calculator", arguments: { expression: "0.35 * 61245.50" } }],
  },
};
const tool3: ChatMessage = { role: "tool", content: JSON.stringify({ result: 21435.925 }) };
const asst4: ChatMessage = {
  role: "assistant",
  content: {
    content: "Gross value is €21,435.93. Now I need Kraken's current taker fee.",
    toolCalls: [{ name: "web_search", arguments: { query: "kraken trading fee btc eur taker" } }],
  },
};
const malformed5 =
  '{"results":[{"title":"Kraken fee schedule","snippet":"Taker fees start at 0.25% for monthly volume under';
const tool5: ChatMessage = { role: "tool", content: malformed5 };

const failedSteps: RunStep[] = [
  {
    index: 0,
    kind: "llm",
    spanId: "sp-9f1c-00",
    name: "claude-haiku-4-5",
    startTime: "2026-07-20T14:32:01.220Z",
    latencyMs: 1840,
    costUsd: 0.0041,
    model: "claude-haiku-4-5",
    temperature: 0.7,
    inputTokens: 612,
    outputTokens: 148,
    requestMessages: [sys, usr],
    response: asst0.content,
  },
  {
    index: 1,
    kind: "tool",
    spanId: "sp-9f1c-01",
    name: "web_search",
    startTime: "2026-07-20T14:32:03.140Z",
    latencyMs: 812,
    costUsd: 0.0004,
    toolName: "web_search",
    args: { query: "bitcoin price eur" },
    argsHash: "sha256:3fa9c1e07b2d4a88f0c6e5d1b3a2975c8e14f6a2b9d0c3e7f5a1b2c4d6e8f0a1",
    toolOutput: JSON.parse(tool1.content as string),
  },
  {
    index: 2,
    kind: "llm",
    spanId: "sp-9f1c-02",
    name: "claude-haiku-4-5",
    startTime: "2026-07-20T14:32:04.010Z",
    latencyMs: 1610,
    costUsd: 0.0038,
    model: "claude-haiku-4-5",
    temperature: 0.7,
    inputTokens: 980,
    outputTokens: 122,
    requestMessages: [sys, usr, asst0, tool1],
    response: asst2.content,
  },
  {
    index: 3,
    kind: "tool",
    spanId: "sp-9f1c-03",
    name: "calculator",
    startTime: "2026-07-20T14:32:05.680Z",
    latencyMs: 96,
    costUsd: 0,
    toolName: "calculator",
    args: { expression: "0.35 * 61245.50" },
    argsHash: "sha256:9be17d2c40a5f6b1830e9c2d5a7f41c6b8e03d9a2f4c6e10b5d8a3c7f1e9b204",
    toolOutput: { result: 21435.925 },
  },
  {
    index: 4,
    kind: "llm",
    spanId: "sp-9f1c-04",
    name: "claude-haiku-4-5",
    startTime: "2026-07-20T14:32:05.830Z",
    latencyMs: 1730,
    costUsd: 0.004,
    model: "claude-haiku-4-5",
    temperature: 0.7,
    inputTokens: 1180,
    outputTokens: 156,
    requestMessages: [sys, usr, asst0, tool1, asst2, tool3],
    response: asst4.content,
  },
  {
    index: 5,
    kind: "tool",
    spanId: "sp-9f1c-05",
    name: "web_search",
    startTime: "2026-07-20T14:32:07.610Z",
    latencyMs: 1204,
    costUsd: 0.0004,
    error: "malformed_tool_json: unexpected end of JSON input (position 187)",
    toolName: "web_search",
    args: { query: "kraken trading fee btc eur taker" },
    argsHash: "sha256:c41d8f02a6b3e591d70c4a2f8e1b96d305a7c4e8f2b9d1c6a3e5f708b4d2a916",
    toolOutput: malformed5,
  },
  {
    index: 6,
    kind: "llm",
    spanId: "sp-9f1c-06",
    name: "claude-haiku-4-5",
    startTime: "2026-07-20T14:32:08.870Z",
    latencyMs: 2050,
    costUsd: 0.0058,
    model: "claude-haiku-4-5",
    temperature: 0.7,
    inputTokens: 1640,
    outputTokens: 210,
    requestMessages: [sys, usr, asst0, tool1, asst2, tool3, asst4, tool5],
    response: {
      content: "The fee lookup returned malformed data, so I couldn't parse it. Retrying the same query.",
      toolCalls: [{ name: "web_search", arguments: { query: "kraken trading fee btc eur taker" } }],
    },
  },
  {
    index: 7,
    kind: "tool",
    spanId: "sp-9f1c-07",
    name: "web_search",
    startTime: "2026-07-20T14:32:10.980Z",
    latencyMs: 1188,
    costUsd: 0.0004,
    error: "malformed_tool_json: unexpected end of JSON input (position 187)",
    toolName: "web_search",
    args: { query: "kraken trading fee btc eur taker" },
    argsHash: "sha256:c41d8f02a6b3e591d70c4a2f8e1b96d305a7c4e8f2b9d1c6a3e5f708b4d2a916",
    toolOutput: malformed5,
  },
];

const failedRun: RunSummary = {
  runId: "run_9f1c2b7a",
  traceId: MOCK_ORIGINAL_TRACE,
  agentId: "research-agent",
  taskId: "btc-eur-valuation",
  startTime: "2026-07-20T14:32:01.220Z",
  endTime: "2026-07-20T14:32:24.860Z",
  outcome: "failure",
  stepCount: 8,
  totalTokens: 5048,
  costUsd: 0.0189,
  schemaVersion: "1",
  payloadComplete: true,
  agentRevision: "fixture-runner@1",
  error: "malformed_tool_json: web_search returned invalid JSON on 2 consecutive calls",
};

/* ------------------------------- fork run (fix) ---------------------------- */

const forkTool0Output = {
  results: [
    {
      title: "Kraken fee schedule | Kraken",
      snippet: "Taker fee: 0.25% for 30-day volume under $50,000. Maker: 0.16%.",
      url: "https://www.kraken.com/features/fee-schedule",
    },
  ],
};
const forkTool0Msg: ChatMessage = { role: "tool", content: JSON.stringify(forkTool0Output) };

const forkSteps: RunStep[] = [
  {
    index: 0,
    kind: "tool",
    spanId: "sp-2b7d-00",
    name: "web_search",
    startTime: "2026-07-20T14:41:03.510Z",
    latencyMs: 12,
    costUsd: 0,
    toolName: "web_search",
    args: { query: "kraken trading fee btc eur taker" },
    argsHash: "sha256:c41d8f02a6b3e591d70c4a2f8e1b96d305a7c4e8f2b9d1c6a3e5f708b4d2a916",
    toolOutput: forkTool0Output,
  },
  {
    index: 1,
    kind: "llm",
    spanId: "sp-2b7d-01",
    name: "claude-haiku-4-5",
    startTime: "2026-07-20T14:41:03.540Z",
    latencyMs: 1490,
    costUsd: 0.0036,
    model: "claude-haiku-4-5",
    temperature: 0,
    inputTokens: 1710,
    outputTokens: 178,
    requestMessages: [sys, usr, asst0, tool1, asst2, tool3, asst4, forkTool0Msg],
    response: {
      content: "Kraken's taker fee is 0.25%. I'll subtract the €53.59 fee from €21,435.93.",
      toolCalls: [{ name: "calculator", arguments: { expression: "21435.925 * (1 - 0.0025)" } }],
    },
  },
  {
    index: 2,
    kind: "tool",
    spanId: "sp-2b7d-02",
    name: "calculator",
    startTime: "2026-07-20T14:41:05.050Z",
    latencyMs: 88,
    costUsd: 0,
    toolName: "calculator",
    args: { expression: "21435.925 * (1 - 0.0025)" },
    argsHash: "sha256:77e0b3c9d1a4f628b5c0e7d3a9f21468cb015e8a3d6f9b2c4e70a185d3f6c902",
    toolOutput: { result: 21382.335187 },
  },
  {
    index: 3,
    kind: "llm",
    spanId: "sp-2b7d-03",
    name: "claude-haiku-4-5",
    startTime: "2026-07-20T14:41:05.160Z",
    latencyMs: 1320,
    costUsd: 0.0031,
    model: "claude-haiku-4-5",
    temperature: 0,
    inputTokens: 1960,
    outputTokens: 204,
    requestMessages: [
      sys,
      usr,
      asst0,
      tool1,
      asst2,
      tool3,
      asst4,
      forkTool0Msg,
      {
        role: "assistant",
        content: {
          content: "Kraken's taker fee is 0.25%. I'll subtract the €53.59 fee from €21,435.93.",
          toolCalls: [{ name: "calculator", arguments: { expression: "21435.925 * (1 - 0.0025)" } }],
        },
      },
      { role: "tool", content: JSON.stringify({ result: 21382.335187 }) },
    ],
    response: {
      content:
        "0.35 BTC ≈ €21,382.34 net of Kraken's 0.25% taker fee (gross €21,435.93 at €61,245.50/BTC; fee ≈ €53.59). Sources: web_search, calculator.",
    },
  },
];

const forkRun: RunSummary = {
  runId: "run_2b7d4e9f",
  traceId: MOCK_FORK_TRACE,
  agentId: "research-agent",
  taskId: "btc-eur-valuation",
  startTime: "2026-07-20T14:41:03.510Z",
  endTime: "2026-07-20T14:41:06.450Z",
  outcome: "success",
  stepCount: 4,
  totalTokens: 4052,
  costUsd: 0.0069,
  schemaVersion: "1",
  payloadComplete: true,
  agentRevision: "fixture-runner@1",
  forkOf: MOCK_ORIGINAL_TRACE,
};

/* ------------------------------ healthy run ------------------------------- */

const okUser: ChatMessage = {
  role: "user",
  content: "What is the 7-day change of the ETH/BTC ratio? Round to two decimals.",
};
const okAsst0: ChatMessage = {
  role: "assistant",
  content: {
    content: "I'll fetch the current ETH/BTC ratio and the 7-day history.",
    toolCalls: [{ name: "web_search", arguments: { query: "eth btc ratio 7 day change" } }],
  },
};
const okTool1: ChatMessage = {
  role: "tool",
  content: JSON.stringify({
    results: [
      { title: "ETH/BTC | TradingView", snippet: "Ratio 0.0521, down from 0.0548 a week ago.", url: "https://tradingview.com/symbols/ETHBTC" },
    ],
  }),
};
const okAsst2: ChatMessage = {
  role: "assistant",
  content: {
    content: "The ratio moved from 0.0548 to 0.0521 over 7 days. Computing the percentage change.",
    toolCalls: [{ name: "calculator", arguments: { expression: "(0.0521 - 0.0548) / 0.0548 * 100" } }],
  },
};
const okTool3: ChatMessage = { role: "tool", content: JSON.stringify({ result: -4.927007 }) };

const okSteps: RunStep[] = [
  {
    index: 0,
    kind: "llm",
    spanId: "sp-77aa-00",
    name: "claude-haiku-4-5",
    startTime: "2026-07-20T11:05:12.020Z",
    latencyMs: 1420,
    costUsd: 0.0029,
    model: "claude-haiku-4-5",
    temperature: 0.7,
    inputTokens: 540,
    outputTokens: 118,
    requestMessages: [sys, okUser],
    response: okAsst0.content,
  },
  {
    index: 1,
    kind: "tool",
    spanId: "sp-77aa-01",
    name: "web_search",
    startTime: "2026-07-20T11:05:13.470Z",
    latencyMs: 764,
    costUsd: 0.0004,
    toolName: "web_search",
    args: { query: "eth btc ratio 7 day change" },
    argsHash: "sha256:1b2c4d6e8f0a1357b9d0e2f4a6c8e1b3d5f709a2c4e6b8d0f2a4c6e8b1d3f507",
    toolOutput: JSON.parse(okTool1.content as string),
  },
  {
    index: 2,
    kind: "llm",
    spanId: "sp-77aa-02",
    name: "claude-haiku-4-5",
    startTime: "2026-07-20T11:05:14.260Z",
    latencyMs: 1230,
    costUsd: 0.0028,
    model: "claude-haiku-4-5",
    temperature: 0.7,
    inputTokens: 890,
    outputTokens: 104,
    requestMessages: [sys, okUser, okAsst0, okTool1],
    response: okAsst2.content,
  },
  {
    index: 3,
    kind: "tool",
    spanId: "sp-77aa-03",
    name: "calculator",
    startTime: "2026-07-20T11:05:15.510Z",
    latencyMs: 82,
    costUsd: 0,
    toolName: "calculator",
    args: { expression: "(0.0521 - 0.0548) / 0.0548 * 100" },
    argsHash: "sha256:5d3f709a2c4e6b8d0f2a4c6e8b1d3f5079a2c4e6b8d0f2a4c6e8b1d3f5079a2c",
    toolOutput: { result: -4.927007 },
  },
  {
    index: 4,
    kind: "llm",
    spanId: "sp-77aa-04",
    name: "claude-haiku-4-5",
    startTime: "2026-07-20T11:05:15.610Z",
    latencyMs: 1090,
    costUsd: 0.0027,
    model: "claude-haiku-4-5",
    temperature: 0.7,
    inputTokens: 1120,
    outputTokens: 132,
    requestMessages: [sys, okUser, okAsst0, okTool1, okAsst2, okTool3],
    response: { content: "The ETH/BTC ratio fell 4.93% over the last 7 days (0.0548 → 0.0521)." },
  },
];

const okRun: RunSummary = {
  runId: "run_77aa10bc",
  traceId: MOCK_OK_TRACE,
  agentId: "research-agent",
  taskId: "eth-btc-ratio",
  startTime: "2026-07-20T11:05:12.020Z",
  endTime: "2026-07-20T11:05:20.380Z",
  outcome: "success",
  stepCount: 5,
  totalTokens: 3212,
  costUsd: 0.0098,
  schemaVersion: "1",
  payloadComplete: true,
  agentRevision: "fixture-runner@1",
};

const timeoutRun: RunSummary = {
  runId: "run_c58e04a1",
  traceId: MOCK_TIMEOUT_TRACE,
  agentId: "support-triage",
  taskId: "ticket-lookup-4412",
  startTime: "2026-07-20T09:18:44.100Z",
  endTime: "2026-07-20T09:20:44.320Z",
  outcome: "timeout",
  stepCount: 11,
  totalTokens: 18940,
  costUsd: 0.0521,
  error: "run exceeded 120s step budget",
};

/* --------------------------------- exports --------------------------------- */

const graphs: Record<string, RunGraph> = {
  [MOCK_ORIGINAL_TRACE]: {
    run: failedRun,
    steps: failedSteps,
    checkpoint: { complete: true, schemaVersion: "1", issues: [] },
  },
  [MOCK_FORK_TRACE]: {
    run: forkRun,
    steps: forkSteps,
    checkpoint: { complete: true, schemaVersion: "1", issues: [] },
  },
  [MOCK_OK_TRACE]: {
    run: okRun,
    steps: okSteps,
    checkpoint: { complete: true, schemaVersion: "1", issues: [] },
  },
};

export function mockGraphFor(traceId: string): RunGraph {
  const known = graphs[traceId];
  if (known) return structuredClone(known);
  // Unknown trace in fixture mode: show the failed run so the timeline still demos.
  const clone = structuredClone(graphs[MOCK_ORIGINAL_TRACE]);
  clone.run = { ...clone.run, traceId, runId: `run_${traceId.slice(0, 8)}` };
  return clone;
}

export function mockRuns(): RunSummary[] {
  return structuredClone([forkRun, failedRun, okRun, timeoutRun]);
}

/**
 * Incident fixtures live in a module-level store so fixture mode stays
 * interactive across refetches: create/patch behave like the real engine
 * (minus SQLite and status-transition validation).
 */
let incidentState: Incident[] | null = null;

function incidentStore(): Incident[] {
  if (!incidentState) {
    incidentState = [
      {
        id: "inc_8f3k2m01",
        createdAt: "2026-07-20T14:33:02.000Z",
        agentId: "research-agent",
        traceId: MOCK_ORIGINAL_TRACE,
        alertName: "research-agent: run failure rate > 20% (5m)",
        severity: "critical",
        status: "open",
      },
      {
        id: "inc_2m9q1x77",
        createdAt: "2026-07-20T09:20:11.000Z",
        agentId: "support-triage",
        traceId: MOCK_TIMEOUT_TRACE,
        alertName: "support-triage: step duration p95 anomaly",
        severity: "warning",
        status: "verifying",
        notes: "Suspected loop in ticket_lookup; awaiting counterfactual fork.",
      },
    ];
  }
  return incidentState!;
}

export function mockIncidents(): Incident[] {
  return structuredClone(incidentStore());
}

export function mockCreateIncident(body: {
  traceId: string;
  agentId?: string;
  alertName?: string;
}): Incident {
  const incident: Incident = {
    id: `inc_${Math.random().toString(36).slice(2, 10)}`,
    createdAt: new Date().toISOString(),
    agentId: body.agentId ?? "unknown",
    traceId: body.traceId,
    alertName: body.alertName ?? "manual trace entry",
    status: "open",
  };
  incidentStore().unshift(incident);
  return structuredClone(incident);
}

export function mockPatchIncident(id: string, patch: Partial<Incident>): Incident {
  const found = incidentStore().find((i) => i.id === id);
  if (!found) {
    return {
      id,
      createdAt: new Date().toISOString(),
      agentId: "unknown",
      traceId: "",
      alertName: "",
      status: "open",
      ...patch,
    };
  }
  Object.assign(found, patch);
  return structuredClone(found);
}

export function mockFleet(): AgentFleetStat[] {
  return structuredClone([
    { agentId: "research-agent", runsToday: 31, successRate: 0.84, costTodayUsd: 4.17, openIncidents: 1 },
    { agentId: "support-triage", runsToday: 18, successRate: 0.94, costTodayUsd: 1.26, openIncidents: 1 },
    { agentId: "code-review-bot", runsToday: 7, successRate: 1, costTodayUsd: 0.41, openIncidents: 0 },
  ]);
}

export function mockForkResult(req: ForkRequest): ForkResult {
  const mutationHash = "fixture-mutation-hash";
  return {
    forkRunId: "run_2b7d4e9f",
    forkTraceId: MOCK_FORK_TRACE,
    originalTraceId: req.traceId,
    outcome: "success",
    stepCount: 4,
    mutation: req.mutation,
    mutationHash,
    runnerRevision: "fixture-runner@1",
    checkpoint: { complete: true, schemaVersion: "1", issues: [] },
    idempotencyKey: req.idempotencyKey ?? "fixture-idempotency-key",
  };
}

export function mockCompareResult(): CompareResult {
  return structuredClone({
    original: failedRun,
    fork: forkRun,
    deltaTokens: -996,
    deltaCostUsd: -0.012,
    deltaLatencyMs: -20700,
    deltaSteps: -4,
    outcomeChanged: true,
    alignments: [
      { originalIndex: 0, status: "removed" },
      { originalIndex: 1, status: "removed" },
      { originalIndex: 2, status: "removed" },
      { originalIndex: 3, status: "removed" },
      { originalIndex: 4, status: "removed" },
      { originalIndex: 5, forkIndex: 0, status: "changed" },
      { originalIndex: 6, forkIndex: 1, status: "changed" },
      { originalIndex: 7, status: "removed" },
      { forkIndex: 2, status: "added" },
      { forkIndex: 3, status: "added" },
    ],
    outputDiff: [
      "--- original (failed)",
      "+++ fork (success)",
      "- Run failed: malformed_tool_json. web_search returned invalid JSON on 2 consecutive calls and produced no final answer.",
      "+ 0.35 BTC ≈ €21,382.34 net of Kraken's 0.25% taker fee (gross €21,435.93 at €61,245.50/BTC; fee ≈ €53.59).",
    ].join("\n"),
  });
}

export function mockPostmortem(incidentId: string): { markdown: string } {
  return {
    markdown: [
      `# Postmortem ${incidentId}`,
      "",
      "## Summary",
      "research-agent failed a BTC/EUR valuation run: web_search returned malformed JSON twice and the run aborted.",
      "",
      "## Counterfactual",
      "Fork from step 5, mutation tool_output_override (corrected fee JSON), mock policy hybrid.",
      "Result: success in 4 steps, $0.0069 vs $0.0189 (−$0.0120), −996 tokens, −20.7s.",
      "",
      `Original trace: http://localhost:8080/trace/${MOCK_ORIGINAL_TRACE}`,
      `Fork trace: http://localhost:8080/trace/${MOCK_FORK_TRACE}`,
    ].join("\n"),
  };
}
