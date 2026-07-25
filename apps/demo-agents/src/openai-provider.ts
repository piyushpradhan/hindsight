/**
 * OpenAI-compatible chat-completions provider. One implementation covers every
 * vendor that speaks `/v1/chat/completions` — Cerebras (the Taskline default),
 * Groq, OpenRouter, Together, Mistral, and Gemini's compatibility endpoint —
 * so a reviewer can exercise the real-provider path with whichever free key
 * they can get, without installing a local runtime.
 *
 * Like the Ollama provider this speaks the JSON action protocol rather than
 * native tool calling: no `tools` array is ever sent, only `response_format`.
 * That is the portable path across vendors, several of which reject requests
 * carrying both fields.
 */
import type { LlmRequest, Provider, ToolCall } from "./types.js";

export const CEREBRAS_BASE_URL = "https://api.cerebras.ai/v1";
export const CEREBRAS_DEFAULT_MODEL = "gpt-oss-120b";

interface OpenAiResponse {
  model?: string;
  choices?: Array<{ message?: { content?: string } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export interface OpenAiCompatOptions {
  apiKey: string;
  /** Chat-completions root, e.g. https://api.cerebras.ai/v1. */
  baseUrl?: string;
  /** Recorded as `step.provider`; defaults to a label derived from the host. */
  name?: string;
}

export function createOpenAiCompatProvider(
  options: OpenAiCompatOptions,
  fetcher: typeof fetch = fetch,
): Provider {
  const baseUrl = normalizeBaseUrl(options.baseUrl ?? CEREBRAS_BASE_URL);
  const endpoint = `${baseUrl}/chat/completions`;
  const name = options.name ?? providerLabel(baseUrl);
  return {
    name,
    async create(req: LlmRequest) {
      // Step 0 is always the same list_tasks probe, mirroring the Ollama path,
      // so the recorded step graph is comparable across providers.
      const toolResults = req.messages.filter((message) => message.role === "tool").length;
      if (req.tools?.some((tool) => tool.name === "list_tasks") && toolResults === 0) {
        return {
          id: `${name}-list-${Date.now()}`,
          model: req.model,
          content: "Checking the current task list.",
          toolCalls: [{ id: `${name}-list-call-${Date.now()}`, name: "list_tasks", args: {} }],
          stopReason: "tool_use" as const,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      }
      const choosingTool = !!req.tools?.length && toolResults === 1;
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${options.apiKey}`,
        },
        body: JSON.stringify({
          model: req.model,
          stream: false,
          response_format: { type: "json_object" },
          temperature: req.temperature,
          max_tokens: req.max_tokens,
          messages: toOpenAiMessages(req, choosingTool),
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        // The body can echo request fields; never include the Authorization
        // header or the key itself in the thrown message.
        const error = new Error(
          `${name} ${response.status}: ${redact((await response.text()).slice(0, 200), options.apiKey)}`,
        );
        error.name = "OpenAiCompatError";
        throw error;
      }
      const body = (await response.json()) as OpenAiResponse;
      const content = body.choices?.[0]?.message?.content;
      const parsed = parseJson(content);
      const toolCalls = choosingTool ? readJsonToolCall(parsed, name) : [];
      if (choosingTool && toolCalls.length === 0) {
        const error = new Error(`${name} did not return a valid create_task JSON action`);
        error.name = "OpenAiCompatProtocolError";
        throw error;
      }
      return {
        id: `${name}-${Date.now()}`,
        model: body.model ?? req.model,
        content:
          !choosingTool && typeof parsed.final === "string" ? parsed.final : content ?? "",
        toolCalls,
        stopReason: toolCalls.length ? ("tool_use" as const) : ("end" as const),
        usage: {
          input_tokens: body.usage?.prompt_tokens ?? 0,
          output_tokens: body.usage?.completion_tokens ?? 0,
        },
      };
    },
  };
}

/**
 * Tool results are folded into user turns rather than emitted as `role: "tool"`
 * messages. Strict OpenAI-compatible servers reject a tool message that has no
 * preceding assistant `tool_calls` entry with a matching `tool_call_id`, and
 * this protocol never sends one.
 */
function toOpenAiMessages(
  req: LlmRequest,
  choosingTool: boolean,
): Array<Record<string, unknown>> {
  const failureExperiment = req.system?.includes('priority exactly "impossible"');
  const instruction = choosingTool
    ? `Return only JSON in this shape: {"tool":"create_task","args":{"title":"task title","priority":"${
        failureExperiment ? "impossible" : "low, medium, or high"
      }","dueDate":"optional date"}}. Infer useful fields from the original user request.`
    : 'Return only JSON in this shape: {"final":"brief confirmation of the result"}.';
  const messages: Array<Record<string, unknown>> = [
    { role: "system", content: `${req.system ?? ""}\n${instruction}`.trim() },
  ];
  for (const message of req.messages) {
    if (message.role === "assistant" && message.content && typeof message.content === "object") {
      const content = message.content as { text?: unknown; toolCalls?: ToolCall[] };
      const calls = content.toolCalls?.length
        ? ` Called: ${content.toolCalls.map((call) => `${call.name}(${JSON.stringify(call.args)})`).join(", ")}`
        : "";
      messages.push({
        role: "assistant",
        content: `${typeof content.text === "string" ? content.text : ""}${calls}`.trim(),
      });
    } else if (message.role === "tool" && message.content && typeof message.content === "object") {
      const content = message.content as Record<string, unknown>;
      messages.push({
        role: "user",
        content: `Result of ${String(content.name)}: ${JSON.stringify(content.output)}`,
      });
    } else {
      messages.push({
        role: message.role === "assistant" ? "assistant" : "user",
        content:
          typeof message.content === "string"
            ? message.content
            : JSON.stringify(message.content),
      });
    }
  }
  return messages;
}

function readJsonToolCall(value: Record<string, unknown>, name: string): ToolCall[] {
  if (value.tool !== "create_task" || !value.args || typeof value.args !== "object") return [];
  return [{
    id: `${name}-call-${Date.now()}`,
    name: "create_task",
    args: value.args as Record<string, unknown>,
  }];
}

function parseJson(content: string | undefined): Record<string, unknown> {
  if (!content) return {};
  try {
    const value = JSON.parse(content) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : {};
  } catch {
    return {};
  }
}

/** api.cerebras.ai → "cerebras"; api.groq.com → "groq". */
function providerLabel(baseUrl: string): string {
  try {
    const parts = new URL(baseUrl).hostname.split(".").filter((part) => part !== "api");
    return parts.length > 1 ? parts[parts.length - 2] : parts[0] ?? "openai";
  } catch {
    return "openai";
  }
}

function redact(text: string, apiKey: string): string {
  return apiKey ? text.split(apiKey).join("***") : text;
}

function normalizeBaseUrl(value: string): string {
  const url = /^https?:\/\//.test(value) ? value : `https://${value}`;
  return url.replace(/\/+$/, "");
}
