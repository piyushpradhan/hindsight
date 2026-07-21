/** Shared types for the demo agents, mock provider, and tool registry. */
import type { ChatMessage } from "@hindsight/shared";

export type { ChatMessage };

/** A tool call requested by the model. */
export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/**
 * A model completion. Mirrors just enough of a real provider response for the
 * recorder (usage → tokens/cost) and the agent loop (text vs tool calls).
 */
export interface Completion {
  id: string;
  model: string;
  /** Assistant text (present when the model is done / not calling tools). */
  content: string;
  /** Tool calls to execute before the next turn (empty when done). */
  toolCalls: ToolCall[];
  /** "tool_use" while looping through tools, "end" when finished. */
  stopReason: "tool_use" | "end";
  usage: { input_tokens: number; output_tokens: number };
}

/** LLM request parameters (recorder.LlmParams-compatible). */
export interface LlmRequest {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
  system?: string;
}

/**
 * A provider turns a request into a completion. Deterministic providers must be
 * pure functions of (messages, system, seed, temperature).
 */
export interface Provider {
  readonly name: string;
  create(req: LlmRequest): Promise<Completion>;
}

/** Whether a tool has observable external effects (send/write/pay). */
export type ToolEffect = "safe" | "side_effectful";

export interface ToolDef {
  name: string;
  description: string;
  effect: ToolEffect;
  /** Execute the tool. Deterministic given args for reproducible demos. */
  run(args: Record<string, unknown>): Promise<unknown>;
}

export type ToolRegistry = Record<string, ToolDef>;
