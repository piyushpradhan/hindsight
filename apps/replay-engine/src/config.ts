import { DEFAULTS } from "@hindsight/shared";

export interface Config {
  port: number;
  signozUrl: string;
  signozApiKey?: string;
  sqlitePath: string;
  otlpHttpUrl: string;
  serviceName: string;
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
  };
}
