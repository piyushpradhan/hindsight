import { pathToFileURL } from "node:url";
import type { ForkResult, Incident, RunGraph, RunStep } from "@hindsight/shared";

const engineUrl = urlEnv("HINDSIGHT_ENGINE_URL", "http://127.0.0.1:4123");
const tasklineUrl = urlEnv("HINDSIGHT_TODO_URL", "http://127.0.0.1:4174");
const runnerUrl = urlEnv("HINDSIGHT_RUNNER_URL", "http://127.0.0.1:4124");
const ollamaUrl = urlEnv("OLLAMA_HOST", "http://127.0.0.1:11434");

interface TriageResult {
  runId: string;
  traceId: string;
  outcome: string;
  error?: string;
  incidentId?: string;
  mode?: string;
}

interface VerificationEvidence {
  triage: TriageResult;
  original: RunGraph;
  result: ForkResult;
  fork: RunGraph;
}

export async function main(): Promise<void> {
  const model = await preflight();
  const triage = await api<TriageResult>(`${tasklineUrl}/api/triage`, {
    method: "POST",
    body: JSON.stringify({ text: "Create task call mom", fail: true }),
  });
  if (
    triage.mode !== "ollama" ||
    triage.outcome !== "failure" ||
    !isTraceId(triage.traceId) ||
    !triage.incidentId
  ) {
    throw new Error(
      `Taskline did not produce an Ollama-backed incident (mode=${triage.mode ?? "unknown"}, outcome=${triage.outcome ?? "unknown"})`,
    );
  }

  const original = await waitForRun(triage.traceId);
  const failedStep = failedCreateTaskStep(original);
  const title = stringArg(failedStep.args, "title") || "Call mom";
  const result = await api<ForkResult>(`${engineUrl}/api/forks`, {
    method: "POST",
    body: JSON.stringify({
      traceId: triage.traceId,
      forkAtStep: failedStep.index,
      mutation: {
        type: "tool_output_override",
        stepIndex: failedStep.index,
        output: {
          created: { id: 0, title, priority: "medium", done: false },
        },
      },
      mockPolicy: "strict",
      incidentId: triage.incidentId,
      idempotencyKey: `ollama-verification-${triage.traceId}`,
    }),
  });
  const fork = await waitForRun(result.forkTraceId);
  validateVerifiedOllamaResolution({ triage, original, result, fork });

  console.log("Ollama provider verification passed.");
  console.log(`provider=ollama model=${model}`);
  console.log(`incident=${triage.incidentId}`);
  console.log(`original_trace=${triage.traceId}`);
  console.log(`fork_trace=${result.forkTraceId}`);
}

export function validateVerifiedOllamaResolution(evidence: VerificationEvidence): void {
  const { triage, original, result, fork } = evidence;
  if (triage.mode !== "ollama") throw new Error("Taskline did not report Ollama mode");
  if (!original.steps.some((step) => step.kind === "llm" && step.provider === "ollama")) {
    throw new Error("original trace does not record provider=ollama");
  }
  if (result.verification?.verified !== true || result.incident?.status !== "resolved") {
    throw new Error(
      `incident was not verified as resolved: ${result.verification?.reason ?? "missing verification evidence"}`,
    );
  }
  if (result.incident.id !== triage.incidentId || result.forkTraceId !== fork.run.traceId) {
    throw new Error("verified result identifiers do not match the recorded incident and fork");
  }
  const providers = [
    ...new Set(
      fork.steps
        .filter((step) => step.kind === "llm")
        .map((step) => step.provider)
        .filter((provider): provider is string => !!provider),
    ),
  ];
  if (!providers.includes("ollama") || providers.includes("mock")) {
    throw new Error(
      `verified fork did not exclusively exercise the expected non-mock provider (providers=${providers.join(",") || "none"})`,
    );
  }
}

export function redactSecrets(value: string, env: NodeJS.ProcessEnv = process.env): string {
  let redacted = value
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [REDACTED]")
    .replace(/([?&](?:api_?key|token|secret|password)=)[^&\s]+/gi, "$1[REDACTED]");
  for (const [name, secret] of Object.entries(env)) {
    if (!secret || secret.length < 4 || !/(?:KEY|TOKEN|SECRET|PASSWORD)/i.test(name)) continue;
    redacted = redacted.split(secret).join("[REDACTED]");
  }
  return redacted;
}

function failedCreateTaskStep(graph: RunGraph): RunStep {
  if (!graph.checkpoint?.complete) throw new Error("original checkpoint is incomplete");
  const step = graph.steps.find(
    (candidate) =>
      candidate.kind === "tool" &&
      candidate.toolName === "create_task" &&
      candidate.error,
  );
  if (!step) throw new Error("original run has no failed create_task tool step to override");
  return step;
}

async function preflight(): Promise<string> {
  const tags = await api<{ models?: Array<{ name?: string }> }>(`${ollamaUrl}/api/tags`);
  const taskline = await api<{ mode?: string; model?: string }>(`${tasklineUrl}/api/tasks`);
  const engine = await api<{ ok?: boolean }>(`${engineUrl}/api/health`);
  const capabilities = await api<{
    runners?: Array<{ agentId?: string; available?: boolean }>;
  }>(`${runnerUrl}/hindsight/capabilities`);
  if (!engine.ok) throw new Error("replay engine is unhealthy");
  if (taskline.mode !== "ollama" || !taskline.model) {
    throw new Error(`Taskline must run in Ollama mode (reported ${taskline.mode ?? "unknown"})`);
  }
  if (!tags.models?.some((model) => model.name === taskline.model)) {
    throw new Error(`Taskline model ${taskline.model} is not installed in Ollama`);
  }
  const runner = capabilities.runners?.find((candidate) => candidate.agentId === "todo-triage");
  if (!runner?.available) throw new Error("todo-triage fork runner is unavailable");
  return taskline.model;
}

async function waitForRun(traceId: string): Promise<RunGraph> {
  for (let attempt = 0; attempt < 80; attempt++) {
    try {
      const graph = await api<RunGraph>(`${engineUrl}/api/runs/${traceId}`);
      if (graph.run.stepCount > 0 && graph.checkpoint?.complete) return graph;
    } catch {
      // SigNoz ingestion is eventually consistent.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`trace ${traceId} was not queryable with a complete checkpoint`);
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, {
      ...init,
      headers: { "content-type": "application/json", ...init?.headers },
      signal: AbortSignal.timeout(150_000),
    });
  } catch (error) {
    throw new Error(
      `request failed for ${new URL(url).origin}: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
  const text = await response.text();
  let body: unknown;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    body = {};
  }
  if (!response.ok) {
    const detail =
      body && typeof body === "object"
        ? String((body as { detail?: unknown; error?: unknown }).detail ??
          (body as { error?: unknown }).error ??
          response.statusText)
        : response.statusText;
    throw new Error(`${response.status} from ${new URL(url).origin}: ${detail}`);
  }
  return body as T;
}

function urlEnv(name: string, fallback: string): string {
  const value = process.env[name]?.trim() || fallback;
  const url = /^https?:\/\//.test(value) ? value : `http://${value}`;
  return url.replace(/\/+$/, "");
}

function stringArg(args: unknown, key: string): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  const value = (args as Record<string, unknown>)[key];
  return typeof value === "string" ? value : undefined;
}

function isTraceId(value: string): boolean {
  return /^[0-9a-f]{32}$/i.test(value);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(redactSecrets(error instanceof Error ? error.message : String(error)));
    process.exitCode = 1;
  });
}
