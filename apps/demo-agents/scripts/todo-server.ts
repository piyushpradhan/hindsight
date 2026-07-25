import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { readFileSync } from "node:fs";
import { createRecorder } from "@hindsight/recorder";
import {
  TODO_AGENT,
  buildTodoPlan,
  createAnthropicHttpProvider,
  createOllamaProvider,
  listTodoTasks,
  runAgentSpec,
  toggleTodoTask,
} from "../src/index.js";

const port = Number(process.env.HINDSIGHT_TODO_PORT ?? 4174);
const engineUrl = (process.env.HINDSIGHT_ENGINE_URL ?? "http://localhost:4123").replace(/\/$/, "");
const studioUrl = (process.env.HINDSIGHT_STUDIO_URL ?? "http://localhost:5173").replace(/\/$/, "");
const providerMode = process.env.HINDSIGHT_TODO_PROVIDER ?? "offline";
const ollamaModel = process.env.OLLAMA_MODEL ?? "gemma3:1b";
const html = readFileSync(new URL("../todo/index.html", import.meta.url), "utf8");

if (!["offline", "anthropic", "ollama"].includes(providerMode)) {
  throw new Error(`unsupported HINDSIGHT_TODO_PROVIDER: ${providerMode}`);
}
if (providerMode === "anthropic" && !process.env.ANTHROPIC_API_KEY) {
  throw new Error("ANTHROPIC_API_KEY is required when HINDSIGHT_TODO_PROVIDER=anthropic");
}

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/") {
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      return response.end(html);
    }
    if (request.method === "GET" && request.url === "/api/tasks") {
      return json(response, 200, {
        tasks: listTodoTasks(),
        mode: providerMode,
        model: providerMode === "ollama" ? ollamaModel : undefined,
      });
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
      try {
        const result = await runAgentSpec(spec, {
          recorder,
          taskId: `todo-${Date.now()}`,
          provider:
            providerMode === "anthropic"
              ? createAnthropicHttpProvider(process.env.ANTHROPIC_API_KEY as string)
              : providerMode === "ollama"
                ? createOllamaProvider(process.env.OLLAMA_HOST)
                : undefined,
          overrides: providerMode === "ollama" ? { model: ollamaModel } : undefined,
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
          mode: providerMode,
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
  console.log(
    `[hindsight-todo-demo] provider=${
      providerMode === "offline" ? "offline deterministic" : providerMode
    }${providerMode === "ollama" ? ` model=${ollamaModel}` : ""}`,
  );
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
