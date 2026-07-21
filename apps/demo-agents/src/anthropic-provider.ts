/**
 * Optional real-provider seam. The demo runs fully offline on the mock
 * provider; this exists so a live Anthropic client can be dropped in when
 * ANTHROPIC_API_KEY is set, WITHOUT adding a hard SDK dependency to the offline
 * path. The caller passes an already-constructed messages-create function.
 */
import type { Completion, LlmRequest, Provider } from "./types.js";

/** Minimal shape of an Anthropic-style messages.create call. */
export interface AnthropicLike {
  messages: {
    create(body: {
      model: string;
      max_tokens: number;
      temperature?: number;
      system?: string;
      messages: Array<{ role: string; content: unknown }>;
    }): Promise<{
      model: string;
      content: Array<{ type: string; text?: string }>;
      stop_reason?: string;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

/**
 * Wrap a real Anthropic client as a Provider. Only used when ANTHROPIC_API_KEY
 * is present and the SDK is installed by the caller. Tool-use wiring is left
 * minimal on purpose — the mock provider is the supported, tested path.
 */
export function createAnthropicProvider(client: AnthropicLike): Provider {
  return {
    name: "anthropic",
    async create(req: LlmRequest): Promise<Completion> {
      const res = await client.messages.create({
        model: req.model,
        max_tokens: req.max_tokens ?? 1024,
        temperature: req.temperature,
        system: req.system,
        messages: req.messages.map((m) => ({ role: m.role, content: m.content })),
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      return {
        id: "anthropic",
        model: res.model,
        content: text,
        toolCalls: [],
        stopReason: "end",
        usage: res.usage,
      };
    },
  };
}

/** True when a real Anthropic run is possible (key present). */
export function anthropicAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}
