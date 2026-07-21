/**
 * The two demo agents, expressed as (tools + mock plan + task) bundles plus a
 * thin runner over the shared agent loop. Plans are deterministic multi-step
 * scripts so both agents produce realistic multi-step runs offline.
 */
import type { Recorder } from "@hindsight/recorder";
import { runAgent, type AgentResult, type RunAgentOptions } from "./agent-loop.js";
import { createMockProvider, type PlanStep } from "./mock-provider.js";
import { RESEARCH_TOOLS, SUPPORT_TOOLS } from "./tools.js";
import type { ChaosMode } from "./chaos.js";
import type { Provider, ToolRegistry } from "./types.js";

export interface AgentSpec {
  agentId: string;
  system: string;
  tools: ToolRegistry;
  task: string;
  /** Deterministic mock plan: the sequence of tool calls then a final answer. */
  plan: PlanStep[];
}

/** Research agent: web_search + calculator, three tool steps then an answer. */
export const RESEARCH_AGENT: AgentSpec = {
  agentId: "research",
  system: "You are a research assistant. Use web_search and calculator, then answer.",
  tools: RESEARCH_TOOLS,
  task: "How many GWh does a 4.2 MW turbine produce in a 30-day month at 40% capacity?",
  plan: [
    { kind: "tool", name: "web_search", args: { query: "turbine capacity factor GWh" } },
    { kind: "tool", name: "calculator", args: { expression: "4.2*24*30*0.4" } },
    { kind: "final", content: "A 4.2 MW turbine at 40% capacity yields about 1209.6 MWh (~1.21 GWh)." },
  ],
};

/** Support-triage agent: ticket_lookup, then a resolution. */
export const SUPPORT_AGENT: AgentSpec = {
  agentId: "support-triage",
  system: "You are a support triage agent. Look up the ticket, then triage it.",
  tools: SUPPORT_TOOLS,
  task: "Triage ticket T-1001 and recommend next action.",
  plan: [
    { kind: "tool", name: "ticket_lookup", args: { ticketId: "T-1001" } },
    { kind: "final", content: "T-1001 is high priority (login failure). Escalate to auth team." },
  ],
};

export const AGENTS: Record<string, AgentSpec> = {
  [RESEARCH_AGENT.agentId]: RESEARCH_AGENT,
  [SUPPORT_AGENT.agentId]: SUPPORT_AGENT,
};

export interface RunSpecOptions {
  recorder: Recorder;
  chaos?: ChaosMode;
  seed?: number;
  taskId?: string;
  /** Provide a real provider (e.g. Anthropic) to override the mock default. */
  provider?: Provider;
  /** Extra loop overrides (e.g. toolResolver for forks). */
  overrides?: Partial<RunAgentOptions>;
}

/**
 * Run an agent spec through the loop. Defaults to the deterministic mock
 * provider (temperature 0); pass `provider` to use a real one.
 */
export function runAgentSpec(spec: AgentSpec, opts: RunSpecOptions): Promise<AgentResult> {
  const seed = opts.seed ?? 0;
  const provider = opts.provider ?? createMockProvider({ seed });
  const plan = chaosPlan(spec, opts.chaos);
  return runAgent({
    agentId: spec.agentId,
    taskId: opts.taskId,
    recorder: opts.recorder,
    provider,
    tools: spec.tools,
    system: spec.system,
    task: spec.task,
    temperature: 0,
    seed,
    plan,
    chaos: opts.chaos,
    ...opts.overrides,
  });
}

/**
 * wrong_tool_loop rewrites the plan to call the same tool with identical args
 * repeatedly so the recorder's loop score trips (>=3). Other chaos modes keep
 * the normal plan and inject at tool-execution time.
 */
function chaosPlan(spec: AgentSpec, chaos: ChaosMode | undefined): PlanStep[] {
  if (chaos !== "wrong_tool_loop") return spec.plan;
  const firstTool = spec.plan.find((s) => s.kind === "tool");
  if (!firstTool || firstTool.kind !== "tool") return spec.plan;
  const repeat: PlanStep = { kind: "tool", name: firstTool.name, args: firstTool.args };
  return [repeat, repeat, repeat, repeat, { kind: "final", content: "stuck" }];
}
