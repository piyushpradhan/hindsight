import { spawnSync } from "node:child_process";
import { access } from "node:fs/promises";
import { connect } from "node:net";

const signozUrl = (process.env.SIGNOZ_URL ?? "http://localhost:8080").replace(/\/$/, "");
const apiKey = process.env.SIGNOZ_API_KEY?.trim();
const webhookSecret = process.env.SIGNOZ_WEBHOOK_SECRET?.trim();
const todoProvider = process.env.HINDSIGHT_TODO_PROVIDER ?? "ollama";
const failures: string[] = [];

await check("Node.js 20+", Number(process.versions.node.split(".")[0]) >= 20);

const pnpm = spawnSync("pnpm", ["--version"], { encoding: "utf8" });
await check("pnpm", pnpm.status === 0, pnpm.stdout.trim());

for (const file of ["casting.yaml", "casting.yaml.lock", ".env.example"]) {
  await check(file, await exists(file));
}

const version = await getJson(`${signozUrl}/api/v1/version`);
await check(
  "SigNoz v0.133.x",
  typeof version?.version === "string" && version.version.startsWith("v0.133."),
  String(version?.version ?? "unreachable"),
);
await check("OTLP/HTTP :4318", await portOpen(new URL(signozUrl).hostname, 4318));
await check("SIGNOZ_API_KEY", !!apiKey, apiKey ? "set" : "missing");
await check("SIGNOZ_WEBHOOK_SECRET", !!webhookSecret, webhookSecret ? "set" : "missing");
await check(
  "Taskline provider",
  ["offline", "anthropic", "ollama"].includes(todoProvider),
  todoProvider,
);

if (todoProvider === "ollama") {
  const ollamaUrl = (process.env.OLLAMA_HOST ?? "http://127.0.0.1:11434").replace(
    /\/$/,
    "",
  );
  const ollamaModel = process.env.OLLAMA_MODEL?.trim() || "gemma3:1b";
  const tags = await getJson(`${ollamaUrl}/api/tags`);
  const models = Array.isArray(tags?.models)
    ? tags.models.flatMap((model) =>
        model && typeof model === "object" && typeof (model as { name?: unknown }).name === "string"
          ? [(model as { name: string }).name]
          : [],
      )
    : [];
  await check("Ollama", !!tags, tags ? ollamaUrl : "unreachable");
  await check(
    `Ollama model ${ollamaModel}`,
    models.includes(ollamaModel),
    models.join(", ") || "missing",
  );
}

if (todoProvider === "anthropic") {
  await check(
    "ANTHROPIC_API_KEY",
    !!process.env.ANTHROPIC_API_KEY,
    process.env.ANTHROPIC_API_KEY ? "set" : "missing",
  );
}

if (apiKey) {
  const response = await fetch(`${signozUrl}/api/v1/dashboards`, {
    headers: { "SIGNOZ-API-KEY": apiKey },
  }).catch(() => undefined);
  await check("SigNoz API authentication", response?.ok === true, String(response?.status ?? "unreachable"));
}

if (failures.length) {
  console.error(`\nDoctor found ${failures.length} blocker${failures.length === 1 ? "" : "s"}.`);
  process.exitCode = 1;
} else {
  console.log("\nReady for `make demo`.");
}

async function check(name: string, ok: boolean, detail = ""): Promise<void> {
  console.log(`${ok ? "✓" : "✗"} ${name}${detail ? ` (${detail})` : ""}`);
  if (!ok) failures.push(name);
}

async function exists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function getJson(url: string): Promise<Record<string, unknown> | undefined> {
  try {
    const response = await fetch(url);
    return response.ok ? (await response.json()) as Record<string, unknown> : undefined;
  } catch {
    return undefined;
  }
}

function portOpen(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host, port });
    socket.setTimeout(2_000);
    socket.once("connect", () => {
      socket.destroy();
      resolve(true);
    });
    socket.once("timeout", () => {
      socket.destroy();
      resolve(false);
    });
    socket.once("error", () => resolve(false));
  });
}
