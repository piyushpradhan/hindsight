/**
 * Anthropic provider adapter used by the reference runner for recordings whose
 * provider is "anthropic". The fetch implementation keeps the offline mock
 * demo dependency-free while preserving a tested real-provider path.
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
      messages: Array<{ role: "user" | "assistant"; content: unknown }>;
      tools?: Array<{
        name: string;
        description: string;
        input_schema: { type: "object"; additionalProperties: true };
      }>;
    }): Promise<{
      id?: string;
      model: string;
      content: Array<{
        type: string;
        text?: string;
        id?: string;
        name?: string;
        input?: Record<string, unknown>;
      }>;
      stop_reason?: string;
      usage: { input_tokens: number; output_tokens: number };
    }>;
  };
}

/**
 * Wrap an Anthropic-compatible client as the agent loop's Provider contract.
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
        messages: toAnthropicMessages(req.messages),
        tools: req.tools?.map((tool) => ({
          ...tool,
          input_schema: { type: "object", additionalProperties: true },
        })),
      });
      const text = res.content
        .filter((b) => b.type === "text")
        .map((b) => b.text ?? "")
        .join("");
      return {
        id: res.id ?? "anthropic",
        model: res.model,
        content: text,
        toolCalls: res.content
          .filter((block) => block.type === "tool_use" && block.id && block.name)
          .map((block) => ({
            id: block.id as string,
            name: block.name as string,
            args: block.input ?? {},
          })),
        stopReason: res.stop_reason === "tool_use" ? "tool_use" : "end",
        usage: res.usage,
      };
    },
  };
}

/** Real provider path without making the offline demo depend on an SDK. */
export function createAnthropicHttpProvider(
  apiKey: string,
  baseUrl = "https://api.anthropic.com",
): Provider {
  return createAnthropicProvider({
    messages: {
      async create(body) {
        const response = await fetch(`${baseUrl.replace(/\/+$/, "")}/v1/messages`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "anthropic-version": "2023-06-01",
            "x-api-key": apiKey,
          },
          body: JSON.stringify(body),
        });
        if (!response.ok) {
          throw new Error(`Anthropic ${response.status}: ${(await response.text()).slice(0, 200)}`);
        }
        return (await response.json()) as Awaited<
          ReturnType<AnthropicLike["messages"]["create"]>
        >;
      },
    },
  });
}

/** True when a real Anthropic run is possible (key present). */
export function anthropicAvailable(): boolean {
  return !!process.env.ANTHROPIC_API_KEY;
}

function toAnthropicMessages(
  messages: LlmRequest["messages"],
): Array<{ role: "user" | "assistant"; content: unknown }> {
  return messages.map((message) => {
    if (message.role === "tool") {
      const content =
        message.content && typeof message.content === "object"
          ? (message.content as Record<string, unknown>)
          : {};
      return {
        role: "user" as const,
        content: [
          {
            type: "tool_result",
            tool_use_id: String(content.toolCallId ?? ""),
            content: JSON.stringify(content.output),
          },
        ],
      };
    }
    if (message.role === "assistant" && message.content && typeof message.content === "object") {
      const content = message.content as {
        text?: unknown;
        toolCalls?: Array<{ id: string; name: string; args: Record<string, unknown> }>;
      };
      return {
        role: "assistant" as const,
        content: [
          ...(typeof content.text === "string" && content.text
            ? [{ type: "text", text: content.text }]
            : []),
          ...(content.toolCalls ?? []).map((call) => ({
            type: "tool_use",
            id: call.id,
            name: call.name,
            input: call.args,
          })),
        ],
      };
    }
    return {
      role: message.role === "assistant" ? ("assistant" as const) : ("user" as const),
      content: message.content,
    };
  });
}
