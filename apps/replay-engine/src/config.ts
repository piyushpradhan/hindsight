import { DEFAULTS } from "@hindsight/shared";
import { timingSafeEqual } from "node:crypto";

export interface Config {
  host: string;
  port: number;
  corsOrigins: string[];
  apiToken?: string;
  allowUnauthenticatedLocalhost: boolean;
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
    host: env.HOST?.trim() || "127.0.0.1",
    port,
    corsOrigins: parseCorsOrigins(env.HINDSIGHT_CORS_ORIGINS),
    apiToken: env.HINDSIGHT_API_TOKEN?.trim() || undefined,
    allowUnauthenticatedLocalhost: parseBoolean(
      env.HINDSIGHT_ALLOW_UNAUTHENTICATED_LOCALHOST,
      false,
    ),
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

export function requiresApiAuth(method: string, url: string): boolean {
  const path = url.split("?", 1)[0];
  return method !== "OPTIONS" && path.startsWith("/api/") && path !== "/api/health";
}

export function isApiRequestAuthorized(
  config: Pick<Config, "host" | "apiToken" | "allowUnauthenticatedLocalhost">,
  authorization: string | undefined,
  remoteAddress: string,
): boolean {
  const bearer = authorization?.match(/^Bearer ([^\s]+)$/i)?.[1];
  if (config.apiToken && bearer && sameSecret(bearer, config.apiToken)) return true;
  return (
    config.allowUnauthenticatedLocalhost &&
    isLoopbackAddress(config.host) &&
    isLoopbackAddress(remoteAddress)
  );
}

function parseCorsOrigins(raw: string | undefined): string[] {
  const origins = raw?.split(",").map((origin) => origin.trim()).filter(Boolean) ?? [
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
  for (const origin of origins) {
    const url = new URL(origin);
    if (
      (url.protocol !== "http:" && url.protocol !== "https:") ||
      url.origin !== origin ||
      url.username ||
      url.password
    ) {
      throw new Error(`invalid CORS origin: ${origin}`);
    }
  }
  return [...new Set(origins)];
}

function parseBoolean(raw: string | undefined, fallback: boolean): boolean {
  if (raw === undefined) return fallback;
  if (raw === "true") return true;
  if (raw === "false") return false;
  throw new Error(`invalid boolean: ${raw}`);
}

function isLoopbackAddress(address: string): boolean {
  const normalized = address.toLowerCase().replace(/^\[|\]$/g, "").replace(/^::ffff:/, "");
  return normalized === "localhost" || normalized === "::1" || normalized.startsWith("127.");
}

function sameSecret(received: string, expected: string): boolean {
  const left = Buffer.from(received);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
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
