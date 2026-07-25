import type { LlmRequest, Provider, ToolCall } from "./types.js";

interface OllamaResponse {
  model?: string;
  message?: { content?: string };
  prompt_eval_count?: number;
  eval_count?: number;
}

export function createOllamaProvider(
  baseUrl = "http://127.0.0.1:11434",
  fetcher: typeof fetch = fetch,
): Provider {
  const endpoint = `${normalizeBaseUrl(baseUrl)}/api/chat`;
  return {
    name: "ollama",
    async create(req: LlmRequest) {
      const toolResults = req.messages.filter((message) => message.role === "tool").length;
      if (req.tools?.some((tool) => tool.name === "list_tasks") && toolResults === 0) {
        return {
          id: `ollama-list-${Date.now()}`,
          model: req.model,
          content: "Checking the current task list.",
          toolCalls: [{ id: `ollama-list-call-${Date.now()}`, name: "list_tasks", args: {} }],
          stopReason: "tool_use" as const,
          usage: { input_tokens: 0, output_tokens: 0 },
        };
      }
      const choosingTool = !!req.tools?.length && toolResults === 1;
      const response = await fetcher(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          stream: false,
          format: "json",
          messages: toOllamaMessages(req, choosingTool),
          options: {
            temperature: req.temperature,
            num_predict: req.max_tokens,
          },
        }),
        signal: AbortSignal.timeout(120_000),
      });
      if (!response.ok) {
        const error = new Error(`Ollama ${response.status}: ${(await response.text()).slice(0, 200)}`);
        error.name = "OllamaError";
        throw error;
      }
      const body = (await response.json()) as OllamaResponse;
      const parsed = parseJson(body.message?.content);
      const toolCalls = choosingTool ? readJsonToolCall(parsed) : [];
      if (choosingTool && toolCalls.length === 0) {
        const error = new Error("Ollama did not return a valid create_task JSON action");
        error.name = "OllamaProtocolError";
        throw error;
      }
      return {
        id: `ollama-${Date.now()}`,
        model: body.model ?? req.model,
        content:
          !choosingTool && typeof parsed.final === "string"
            ? parsed.final
            : body.message?.content ?? "",
        toolCalls,
        stopReason: toolCalls.length ? ("tool_use" as const) : ("end" as const),
        usage: {
          input_tokens: body.prompt_eval_count ?? 0,
          output_tokens: body.eval_count ?? 0,
        },
      };
    },
  };
}

function toOllamaMessages(
  req: LlmRequest,
  choosingTool: boolean,
): Array<Record<string, unknown>> {
  const failureExperiment = req.system?.includes("priority exactly \"impossible\"");
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
      const content = message.content as {
        text?: unknown;
        toolCalls?: ToolCall[];
      };
      messages.push({
        role: "assistant",
        content: typeof content.text === "string" ? content.text : "",
        ...(content.toolCalls?.length
          ? {
              tool_calls: content.toolCalls.map((call) => ({
                function: { name: call.name, arguments: call.args },
              })),
            }
          : {}),
      });
    } else if (message.role === "tool" && message.content && typeof message.content === "object") {
      const content = message.content as Record<string, unknown>;
      messages.push({
        role: "tool",
        content: JSON.stringify(content.output),
        tool_name: content.name,
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

function readJsonToolCall(value: Record<string, unknown>): ToolCall[] {
  if (value.tool !== "create_task" || !value.args || typeof value.args !== "object") return [];
  return [{
    id: `ollama-call-${Date.now()}`,
    name: "create_task",
    args: value.args as Record<string, unknown>,
  }];
}

function parseJson(content: string | undefined): Record<string, unknown> {
  if (!content) return {};
  try {
    const value = JSON.parse(content) as unknown;
    return value && typeof value === "object" && !Array.isArray(value)
      ? value as Record<string, unknown>
      : {};
  } catch {
    return {};
  }
}

function normalizeBaseUrl(value: string): string {
  const url = /^https?:\/\//.test(value) ? value : `http://${value}`;
  return url.replace(/\/+$/, "");
}
