import { DEFAULTS } from "@hindsight/shared";

export interface Config {
  port: number;
  signozUrl: string;
  signozApiKey?: string;
  sqlitePath: string;
  otlpHttpUrl: string;
  serviceName: string;
  runners: Record<string, RunnerConfig>;
  runnerTimeoutMs: number;
  verificationTimeoutMs: number;
  signozWebhookSecret?: string;
}

export interface RunnerConfig {
  url: string;
  revision: string;
  secret?: string;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const port = Number(env.PORT ?? DEFAULTS.replayEnginePort);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid PORT: ${env.PORT}`);
  }
  return {
    port,
    signozUrl: (env.SIGNOZ_URL ?? DEFAULTS.signozUrl).replace(/\/$/, ""),
    signozApiKey: env.SIGNOZ_API_KEY?.trim() || undefined,
    sqlitePath: env.SQLITE_PATH ?? "./hindsight.db",
    otlpHttpUrl: (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? DEFAULTS.otlpHttpUrl).replace(/\/$/, ""),
    serviceName: "hindsight-replay-engine",
    runners: parseRunners(env.HINDSIGHT_RUNNERS),
    runnerTimeoutMs: positiveInt(env.HINDSIGHT_RUNNER_TIMEOUT_MS, 60_000),
    verificationTimeoutMs: positiveInt(env.HINDSIGHT_VERIFICATION_TIMEOUT_MS, 10_000),
    signozWebhookSecret: env.SIGNOZ_WEBHOOK_SECRET?.trim() || undefined,
  };
}

function parseRunners(raw: string | undefined): Record<string, RunnerConfig> {
  if (!raw?.trim()) return {};
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("HINDSIGHT_RUNNERS must be valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("HINDSIGHT_RUNNERS must be an object keyed by agent id");
  }
  const runners: Record<string, RunnerConfig> = {};
  for (const [agentId, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (
      !/^[A-Za-z0-9._:-]{1,128}$/.test(agentId) ||
      !value ||
      typeof value !== "object" ||
      Array.isArray(value)
    ) {
      throw new Error(`invalid runner config for ${agentId || "(empty agent id)"}`);
    }
    const runner = value as Record<string, unknown>;
    if (
      typeof runner.url !== "string" ||
      typeof runner.revision !== "string" ||
      !runner.revision.trim() ||
      runner.revision.length > 256
    ) {
      throw new Error(`runner ${agentId} requires url and revision`);
    }
    const url = new URL(runner.url);
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new Error(`runner ${agentId} URL must use http or https`);
    }
    if (url.username || url.password || url.search || url.hash) {
      throw new Error(`runner ${agentId} URL cannot contain credentials, query, or fragment`);
    }
    runners[agentId] = {
      url: url.toString().replace(/\/$/, ""),
      revision: runner.revision,
      secret:
        typeof runner.secret === "string" && runner.secret.trim()
          ? runner.secret
          : undefined,
    };
  }
  return runners;
}

function positiveInt(raw: string | undefined, fallback: number): number {
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) throw new Error(`invalid positive integer: ${raw}`);
  return value;
}
