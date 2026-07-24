/**
 * Deterministic mock LLM provider. Output is a pure function of (messages,
 * system, seed, temperature); at temperature 0 it is fully reproducible. No
 * network — this is the explicit offline test/demo provider.
 *
 * The provider "plans" by counting how many tool results are already in the
 * conversation and emitting the next tool call from a fixed plan, or finishing.
 * Plans are attached per request via the `plan` field so the same provider
 * drives different agents. This is exactly the seam the fork executor reuses:
 * feed it a rebuilt message array + plan and it reproduces the next step.
 */
import type { ChatMessage, Completion, LlmRequest, Provider, ToolCall } from "./types.js";

/** One planned step: call this tool with these args, or finish with text. */
export type PlanStep =
  | { kind: "tool"; name: string; args: Record<string, unknown> }
  | { kind: "final"; content: string };

export interface MockProviderOptions {
  seed?: number;
  /**
   * Fixed plan of steps. The provider emits plan[k] where k = number of tool
   * results already present in the conversation. When the plan is exhausted it
   * emits a final text answer.
   */
  plan?: PlanStep[];
}

/** A request may carry its own plan (per-agent), overriding the default. */
export interface MockLlmRequest extends LlmRequest {
  plan?: PlanStep[];
  seed?: number;
}

/**
 * Build a deterministic mock provider. `create` is pure over its inputs; token
 * counts are derived from a stable hash so cost/metrics are reproducible.
 */
export function createMockProvider(options: MockProviderOptions = {}): Provider {
  const baseSeed = options.seed ?? 0;
  const basePlan = options.plan ?? [];

  return {
    name: "mock",
    async create(req: LlmRequest): Promise<Completion> {
      const r = req as MockLlmRequest;
      const plan = r.plan ?? basePlan;
      const seed = r.seed ?? baseSeed;
      const priorToolResults = countToolResults(req.messages);
      const step: PlanStep | undefined = plan[priorToolResults];

      const promptHash = hashConversation(req.messages, req.system, seed);
      const inputTokens = 40 + (promptHash % 400);

      if (!step || step.kind === "final") {
        const content = step?.content ?? finalAnswer(req.messages, promptHash);
        return {
          id: `cmp_${promptHash.toString(16)}`,
          model: req.model,
          content,
          toolCalls: [],
          stopReason: "end",
          usage: { input_tokens: inputTokens, output_tokens: 20 + (promptHash % 120) },
        };
      }

      const toolCall: ToolCall = {
        id: `call_${priorToolResults}_${(promptHash % 9973).toString(16)}`,
        name: step.name,
        args: step.args,
      };
      return {
        id: `cmp_${promptHash.toString(16)}`,
        model: req.model,
        content: `Calling ${step.name}`,
        toolCalls: [toolCall],
        stopReason: "tool_use",
        usage: { input_tokens: inputTokens, output_tokens: 12 + (promptHash % 40) },
      };
    },
  };
}

/* -------------------------------- helpers --------------------------------- */

/** Count "tool" role messages — the model's proxy for "how far am I". */
function countToolResults(messages: ChatMessage[]): number {
  return messages.filter((m) => m.role === "tool").length;
}

function finalAnswer(messages: ChatMessage[], h: number): string {
  const firstUser = messages.find((m) => m.role === "user");
  const task = typeof firstUser?.content === "string" ? firstUser.content : "the task";
  return `Done: ${task} (resolved deterministically, ref ${h.toString(16)}).`;
}

/** Stable FNV-1a hash over the conversation + system + seed. */
function hashConversation(messages: ChatMessage[], system: string | undefined, seed: number): number {
  const serialized = JSON.stringify({ messages, system: system ?? "", seed });
  let h = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i++) {
    h ^= serialized.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
