/**
 * Resumable agent loop. Drives provider ⇄ tools through the recorder:
 *
 *   1. send messages → provider.create (recorded as an llm step)
 *   2. if the completion has tool calls, run each (recorded as a tool step),
 *      append results to the conversation, and repeat
 *   3. otherwise finish
 *
 * Resumability is the point: starting from a given `initialMessages` array and a
 * provider/tool set reproduces or continues a run. The fork executor calls this
 * with messages rebuilt from steps [0..forkAtStep), one mutation applied, and a
 * tool layer that answers from recordings by argsHash — that's the `toolResolver`
 * seam below.
 */
import type { RunOutcome } from "@hindsight/shared";
import type { ForkInfo, Recorder, Run } from "@hindsight/recorder";
import type { ChatMessage, Completion, Provider, ToolRegistry } from "./types.js";
import type { PlanStep } from "./mock-provider.js";
import {
  MalformedToolJsonError,
  ToolTimeoutError,
  type ChaosMode,
} from "./chaos.js";

export interface RunAgentOptions {
  agentId: string;
  taskId?: string;
  recorder: Recorder;
  provider: Provider;
  tools: ToolRegistry;
  /** System prompt (may be mutated by the fork executor's prompt_edit). */
  system?: string;
  /** Seed messages. Defaults to a single user message from `task`. */
  initialMessages?: ChatMessage[];
  task?: string;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Mock plan handed to the mock provider (per-agent multi-step script). */
  plan?: PlanStep[];
  seed?: number;
  /** Safety cap on loop iterations. */
  maxTurns?: number;
  /** Active chaos mode, if any. */
  chaos?: ChaosMode;
  /**
   * Fork lineage: when set, the run is recorded as a counterfactual — tagged
   * hindsight.fork.of and span-linked to the original. Set by the fork executor.
   */
  fork?: ForkInfo;
  /**
   * Fork seam: answer a tool call from recordings instead of executing it.
   * Return undefined to fall through to the real tool. Keyed by (name, args).
   */
  toolResolver?: (name: string, args: Record<string, unknown>) => Promise<unknown> | unknown;
}

export interface AgentResult {
  runId: string;
  traceId: string;
  outcome: RunOutcome;
  finalContent: string;
  steps: number;
  error?: string;
}

const DEFAULT_MODEL = "claude-haiku-4-5";
const DEFAULT_MAX_TURNS = 12;

export async function runAgent(opts: RunAgentOptions): Promise<AgentResult> {
  const model = opts.model ?? DEFAULT_MODEL;
  const temperature = opts.temperature ?? 0;
  const maxTokens = opts.maxTokens ?? 1024;
  const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;

  const messages: ChatMessage[] = opts.initialMessages
    ? [...opts.initialMessages]
    : [{ role: "user", content: opts.task ?? "Complete the task." }];

  const run: Run = opts.recorder.startRun({
    agentId: opts.agentId,
    taskId: opts.taskId,
    fork: opts.fork,
  });

  let finalContent = "";
  let turns = 0;

  try {
    while (turns < maxTurns) {
      turns++;
      const completion = await run.llm<Completion>(
        () =>
          opts.provider.create({
            model,
            messages,
            temperature,
            max_tokens: maxTokens,
            system: opts.system,
            // Mock-provider extras; ignored by other providers.
            ...(opts.plan ? { plan: opts.plan } : {}),
            ...(opts.seed !== undefined ? { seed: opts.seed } : {}),
          } as never),
        { model, messages, temperature, max_tokens: maxTokens, system: opts.system, provider: opts.provider.name },
      );

      messages.push({ role: "assistant", content: completion.content });

      if (completion.stopReason === "end" || completion.toolCalls.length === 0) {
        finalContent = completion.content;
        break;
      }

      for (const tc of completion.toolCalls) {
        const output = await run.tool(tc.name, tc.args, () =>
          executeTool(opts, tc.name, tc.args, run),
        );
        messages.push({
          role: "tool",
          content: { toolCallId: tc.id, name: tc.name, output },
        });
      }

      applyContextFlood(opts.chaos, messages);
    }

    if (!finalContent) finalContent = "(max turns reached)";
    run.end({ outcome: "success" });
    return {
      runId: run.runId,
      traceId: run.traceId,
      outcome: "success",
      finalContent,
      steps: turns,
    };
  } catch (err) {
    const outcome: RunOutcome = err instanceof ToolTimeoutError ? "timeout" : "failure";
    run.end({ outcome });
    return {
      runId: run.runId,
      traceId: run.traceId,
      outcome,
      finalContent,
      steps: turns,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

/* ------------------------------ tool execution ---------------------------- */

async function executeTool(
  opts: RunAgentOptions,
  name: string,
  args: Record<string, unknown>,
  run: Run,
): Promise<unknown> {
  // Fork seam: recordings answer first (mock policy lives in the resolver).
  if (opts.toolResolver) {
    const fromRecording = await opts.toolResolver(name, args);
    if (fromRecording !== undefined) return fromRecording;
  }

  injectToolChaos(opts.chaos, name, run);

  const def = opts.tools[name];
  if (!def) throw new Error(`unknown tool: ${name}`);
  return def.run(args);
}

/* --------------------------------- chaos ---------------------------------- */

function injectToolChaos(chaos: ChaosMode | undefined, name: string, run: Run): void {
  if (chaos === "malformed_tool_json") {
    throw new MalformedToolJsonError();
  }
  if (chaos === "tool_timeout") {
    throw new ToolTimeoutError(name);
  }
  // wrong_tool_loop is expressed through the plan (same tool+args repeated);
  // once the loop score trips we fail the run to mimic a stuck agent.
  if (chaos === "wrong_tool_loop" && run.loopScore() >= 3) {
    throw new Error(`loop detected on ${name} (score ${run.loopScore()})`);
  }
}

function applyContextFlood(chaos: ChaosMode | undefined, messages: ChatMessage[]): void {
  if (chaos !== "context_flood") return;
  // Balloon the conversation so later turns carry a huge, useless context.
  const filler = "lorem ipsum ".repeat(500);
  messages.push({ role: "user", content: filler });
}
