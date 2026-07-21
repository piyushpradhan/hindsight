import Fastify from "fastify";
import cors from "@fastify/cors";
import { loadConfig } from "./config.js";
import { IncidentStore } from "./incidents/store.js";
import { initTelemetry, registerTraceHooks } from "./otel.js";
import { registerRoutes } from "./routes.js";
import { SignozClient } from "./signoz/client.js";
import { DemoForkExecutor } from "./fork/executor.js";

const config = loadConfig();

const telemetry = initTelemetry({ serviceName: config.serviceName, endpoint: config.otlpHttpUrl });
const signoz = new SignozClient({ baseUrl: config.signozUrl, apiKey: config.signozApiKey });
const incidents = new IncidentStore(config.sqlitePath);

if (!signoz.authed) {
  console.warn(
    "[hindsight] SIGNOZ_API_KEY is not set — SigNoz-dependent routes " +
      "(/api/runs, /api/compare, /api/fleet, /api/forks) will return 503 " +
      "{ error: \"signoz_auth_missing\" }. Incident routes and /hooks/signoz work regardless.",
  );
}

const app = Fastify({ logger: true });
await app.register(cors, { origin: true });
const forkExecutor = new DemoForkExecutor(signoz, { otlpHttpUrl: config.otlpHttpUrl });

registerTraceHooks(app, telemetry);
registerRoutes(app, { config, signoz, incidents, forkExecutor });

const shutdown = async (signal: string) => {
  app.log.info(`received ${signal}, shutting down`);
  await app.close();
  incidents.close();
  await telemetry.shutdown();
  process.exit(0);
};
process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

await app.listen({ port: config.port, host: "0.0.0.0" });
