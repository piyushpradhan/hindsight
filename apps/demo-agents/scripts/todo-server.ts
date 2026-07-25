import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { createRecorder } from "@hindsight/recorder";
import {
  CEREBRAS_BASE_URL,
  CEREBRAS_DEFAULT_MODEL,
  TODO_AGENT,
  buildTodoPlan,
  createAnthropicHttpProvider,
  createOllamaProvider,
  createOpenAiCompatProvider,
  listTodoTasks,
  runAgentSpec,
  toggleTodoTask,
} from "../src/index.js";

const MODES = ["offline", "anthropic", "ollama", "openai"] as const;
type ProviderMode = (typeof MODES)[number];

const port = Number(process.env.HINDSIGHT_TODO_PORT ?? 4174);
const engineUrl = (process.env.HINDSIGHT_ENGINE_URL ?? "http://localhost:4123").replace(/\/$/, "");
const studioUrl = (process.env.HINDSIGHT_STUDIO_URL ?? "http://localhost:5173").replace(/\/$/, "");
const envMode = process.env.HINDSIGHT_TODO_PROVIDER ?? "offline";
const ollamaModel = process.env.OLLAMA_MODEL ?? "gemma3:1b";
const envOpenAiKey = process.env.CEREBRAS_API_KEY ?? process.env.OPENAI_API_KEY;
const envOpenAiBaseUrl = process.env.OPENAI_BASE_URL ?? CEREBRAS_BASE_URL;
const envOpenAiModel = process.env.OPENAI_MODEL ?? CEREBRAS_DEFAULT_MODEL;
const html = readFileSync(new URL("../todo/index.html", import.meta.url), "utf8");

if (!isMode(envMode)) {
  throw new Error(`unsupported HINDSIGHT_TODO_PROVIDER: ${envMode}`);
}
if (envMode === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required when HINDSIGHT_TODO_PROVIDER=anthropic");
}

/**
 * Per-session provider overrides entered through the Taskline UI. This lives in
 * process memory only: it is never written to .env or SQLite, never emitted to
 * a payload log, and never returned to the browser. Restarting Taskline drops
 * it and the process falls back to the environment.
 */
const session: { mode?: ProviderMode; apiKey?: string; model?: string; baseUrl?: string } = {};

interface Settings {
  mode: ProviderMode;
  model?: string;
  baseUrl?: string;
  apiKey?: string;
  /** Whether the active provider config came from the UI or the environment. */
  source: "session" | "env";
}

function settings(): Settings {
  const mode = session.mode ?? (envMode as ProviderMode);
  const source = session.mode ? "session" : "env";
  if (mode === "ollama") return { mode, model: session.model ?? ollamaModel, source };
  if (mode === "anthropic") {
    return { mode, apiKey: session.apiKey ?? process.env.ANTHROPIC_API_KEY, source };
  }
  if (mode === "openai") {
    return {
      mode,
      model: session.model ?? envOpenAiModel,
      baseUrl: session.baseUrl ?? envOpenAiBaseUrl,
      apiKey: session.apiKey ?? envOpenAiKey,
      source,
    };
  }
  return { mode, source };
}

/** The browser-safe projection: everything except the key itself. */
function publicSettings(): Record<string, unknown> {
  const active = settings();
  return {
    mode: active.mode,
    model: active.model,
    baseUrl: active.baseUrl,
    hasKey:
      active.mode === "openai" || active.mode === "anthropic" ? !!active.apiKey : undefined,
    source: active.source,
    modes: MODES,
    defaults: { baseUrl: CEREBRAS_BASE_URL, model: CEREBRAS_DEFAULT_MODEL },
  };
}

function isMode(value: unknown): value is ProviderMode {
  return typeof value === "string" && (MODES as readonly string[]).includes(value);
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html);
    }
    if (request.method === "GET" && request.url === "/api/tasks") {
      return json(response, 200, { tasks: listTodoTasks(), ...publicSettings() });
    }
    if (request.method === "GET" && request.url === "/api/settings") {
      return json(response, 200, publicSettings());
    }
    if (request.method === "POST" && request.url === "/api/settings") {
      const body = (await readJson(request)) as {
        mode?: unknown;
        apiKey?: unknown;
        model?: unknown;
        baseUrl?: unknown;
        reset?: unknown;
      };
      if (body.reset === true) {
        delete session.mode;
        delete session.apiKey;
        delete session.model;
        delete session.baseUrl;
        return json(response, 200, publicSettings());
      }
      if (!isMode(body.mode)) {
        return json(response, 400, { error: "unsupported_mode", modes: MODES });
      }
      const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
      if (body.mode === "openai" && !apiKey && !envOpenAiKey) {
        return json(response, 400, { error: "api_key_required" });
      }
      if (body.mode === "anthropic" && !apiKey && !process.env.ANTHROPIC_API_KEY) {
        return json(response, 400, { error: "api_key_required" });
      }
      session.mode = body.mode;
      if (apiKey) session.apiKey = apiKey;
      session.model = typeof body.model === "string" && body.model.trim() ? body.model.trim() : undefined;
      session.baseUrl =
        typeof body.baseUrl === "string" && body.baseUrl.trim() ? body.baseUrl.trim() : undefined;
      return json(response, 200, publicSettings());
    }
    const toggle = request.url?.match(/^\/api\/tasks\/(\d+)\/toggle$/);
    if (request.method === "POST" && toggle) {
      const task = toggleTodoTask(Number(toggle[1]));
      return task
        ? json(response, 200, { task })
        : json(response, 404, { error: "task_not_found" });
    }
    if (request.method === "POST" && request.url === "/api/triage") {
      const body = (await readJson(request)) as { text?: unknown; fail?: unknown };
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) return json(response, 400, { error: "text_required" });

      const recorder = createRecorder({
        recordPayloads: "always",
        payloadMode: "full",
        serviceName: "hindsight-todo-demo",
        register: false,
      });
      const spec = {
        ...TODO_AGENT,
        task: text,
        system:
          body.fail === true
            ? `${TODO_AGENT.system} For this failure experiment, call create_task with priority exactly "impossible".`
            : TODO_AGENT.system,
        plan: buildTodoPlan(text, body.fail === true),
      };
      const active = settings();
      if ((active.mode === "openai" || active.mode === "anthropic") && !active.apiKey) {
        return json(response, 400, { error: "api_key_required", mode: active.mode });
      }
      try {
        const result = await runAgentSpec(spec, {
          recorder,
          taskId: `todo-${Date.now()}`,
          provider:
            active.mode === "anthropic"
              ? createAnthropicHttpProvider(active.apiKey as string)
              : active.mode === "ollama"
                ? createOllamaProvider(process.env.OLLAMA_HOST)
                : active.mode === "openai"
                  ? createOpenAiCompatProvider({
                      apiKey: active.apiKey as string,
                      baseUrl: active.baseUrl,
                    })
                  : undefined,
          overrides: active.model ? { model: active.model } : undefined,
        });
        let incidentId: string | undefined;
        if (result.outcome !== "success") {
          incidentId = await createIncident(
            result.traceId,
            result.runId,
            body.fail === true ? "InvalidPriorityError" : "ProviderError",
          );
        }
        return json(response, 200, {
          ...result,
          incidentId,
          mode: active.mode,
          model: active.model,
          tasks: listTodoTasks(),
          studioRunUrl: `${studioUrl}/runs/${result.traceId}${incidentId ? `?incident=${incidentId}` : ""}`,
        });
      } finally {
        await recorder.shutdown();
      }
    }
    return json(response, 404, { error: "not_found" });
  } catch (error) {
    return json(response, 500, {
      error: error instanceof Error ? error.name : "Error",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[hindsight-todo-demo] listening on http://127.0.0.1:${port}`);
  const active = settings();
  console.log(
    `[hindsight-todo-demo] provider=${
      active.mode === "offline" ? "offline deterministic" : active.mode
    }${active.model ? ` model=${active.model}` : ""}`,
  );
  console.log("[hindsight-todo-demo] provider and key are switchable from the Taskline UI");
});

process.on("SIGINT", () => server.close());
process.on("SIGTERM", () => server.close());

async function createIncident(
  traceId: string,
  runId: string,
  failureCondition: string,
): Promise<string | undefined> {
  try {
    const response = await fetch(`${engineUrl}/api/incidents`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        traceId,
        runId,
        source: "todo-demo",
        agentId: TODO_AGENT.agentId,
        alertName: "Todo agent rejected a tool call",
        severity: "warning",
        failureCondition,
      }),
    });
    if (!response.ok) return undefined;
    return ((await response.json()) as { id?: string }).id;
  } catch {
    return undefined;
  }
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}
