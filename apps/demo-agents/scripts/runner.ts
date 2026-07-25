import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AGENTS, isSafe } from "../src/index.js";
import {
  executeRunnerFork,
  SUPPORTED_MUTATIONS,
} from "../src/fork-runner.js";
import type { RunnerForkRequest } from "@hindsight/shared";

const port = numberEnv("HINDSIGHT_RUNNER_PORT", 4124);
const otlpHttpUrl = process.env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "http://localhost:4318";
const inFlight = new Map<string, Promise<unknown>>();

const server = createServer(async (request, response) => {
  try {
    if (request.method === "GET" && request.url === "/hindsight/capabilities") {
      return json(response, 200, {
        runners: Object.values(AGENTS).map((agent) => ({
          agentId: agent.agentId,
          revision: agent.revision,
          available: true,
          mutations: SUPPORTED_MUTATIONS,
          safeLiveTools: Object.keys(agent.tools).filter((name) => isSafe(agent.tools, name)),
        })),
      });
    }
    if (request.method === "POST" && request.url === "/hindsight/forks") {
      const body = (await readJson(request)) as RunnerForkRequest;
      if (!body?.idempotencyKey) return json(response, 400, { error: "missing_idempotency_key" });
      let execution = inFlight.get(body.idempotencyKey);
      if (!execution) {
        execution = executeRunnerFork(body, {
          otlpHttpUrl,
          anthropicApiKey: process.env.ANTHROPIC_API_KEY,
          ollamaBaseUrl: process.env.OLLAMA_HOST,
        });
        inFlight.set(body.idempotencyKey, execution);
        if (inFlight.size > 1_000) {
          inFlight.delete(inFlight.keys().next().value as string);
        }
      }
      return json(response, 200, await execution);
    }
    return json(response, 404, { error: "not_found" });
  } catch (error) {
    return json(response, 422, {
      error: "runner_rejected",
      detail: error instanceof Error ? error.message : String(error),
    });
  }
});

server.listen(port, "127.0.0.1", () => {
  console.log(`[hindsight-demo-runner] listening on http://127.0.0.1:${port}`);
});

function json(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "content-type": "application/json" });
  response.end(JSON.stringify(body));
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let bytes = 0;
  for await (const chunk of request) {
    const buffer = Buffer.from(chunk);
    bytes += buffer.length;
    if (bytes > 2 * 1024 * 1024) throw new Error("request body exceeds 2 MiB");
    chunks.push(buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function numberEnv(name: string, fallback: number): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isInteger(value) || value <= 0 || value > 65535) {
    throw new Error(`invalid ${name}`);
  }
  return value;
}
