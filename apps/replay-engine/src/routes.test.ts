import assert from "node:assert/strict";
import Fastify from "fastify";
import { test } from "node:test";
import {
  ATTR,
  HINDSIGHT_SCHEMA_VERSION,
  type Capabilities,
  type ForkRequest,
  type ForkResult,
} from "@hindsight/shared";
import type { Config } from "./config.js";
import { IncidentStore } from "./incidents/store.js";
import { registerRoutes, type ForkExecutor } from "./routes.js";
import {
  TRACE_ID,
  fixturePayloadLogs,
  fixtureSpans,
} from "./rungraph/builder.test-fixture.js";
import { SignozClient } from "./signoz/client.js";
import type { PayloadLogInput, SpanInput } from "./rungraph/builder.js";

const FORK_TRACE = "22222222222222222222222222222222";
const MUTATION = { type: "model_swap" as const, model: "claude-sonnet-4-5" };
const MUTATION_HASH = "verified-mutation";

test("incident fork resolves only after linked fork telemetry is verified", async (t) => {
  const incidents = new IncidentStore(":memory:");
  const incident = incidents.create({
    traceId: TRACE_ID,
    agentId: "agent-1",
    alertName: "run failed",
  });
  const app = await testApp(incidents, forkSpans(incident.id), incident.id);
  t.after(async () => {
    await app.close();
    incidents.close();
  });

  const response = await app.inject({
    method: "POST",
    url: "/api/forks",
    payload: {
      traceId: TRACE_ID,
      forkAtStep: 0,
      mutation: MUTATION,
      mockPolicy: "strict",
      incidentId: incident.id,
      idempotencyKey: "route-test",
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  const body = response.json<ForkResult>();
  assert.equal(body.verification?.verified, true);
  assert.equal(body.incident?.status, "resolved");
  const stored = incidents.get(incident.id);
  assert.equal(stored?.status, "resolved");
  assert.equal(stored?.verification?.comparison?.fork.traceId, FORK_TRACE);
  assert.equal(stored?.forkAttempts?.[0].forkTraceId, FORK_TRACE);
  assert.equal(stored?.forkAttempts?.[0].verification?.verified, true);
});

test("successful but unrelated fork reopens the incident with failed verification", async (t) => {
  const incidents = new IncidentStore(":memory:");
  const incident = incidents.create({ traceId: TRACE_ID });
  const spans = forkSpans("another-incident");
  const app = await testApp(incidents, spans, incident.id);
  t.after(async () => {
    await app.close();
    incidents.close();
  });
  const response = await app.inject({
    method: "POST",
    url: "/api/forks",
    payload: {
      traceId: TRACE_ID,
      forkAtStep: 0,
      mutation: MUTATION,
      mockPolicy: "strict",
      incidentId: incident.id,
    },
  });
  assert.equal(response.statusCode, 200, response.body);
  assert.equal(response.json<ForkResult>().verification?.verified, false);
  assert.equal(incidents.get(incident.id)?.status, "open");
});

test("manual resolution and unauthenticated webhooks are rejected", async (t) => {
  const incidents = new IncidentStore(":memory:");
  const incident = incidents.create({ traceId: TRACE_ID });
  const app = await testApp(incidents, forkSpans(incident.id), incident.id);
  t.after(async () => {
    await app.close();
    incidents.close();
  });
  const patch = await app.inject({
    method: "PATCH",
    url: `/api/incidents/${incident.id}`,
    payload: { status: "resolved" },
  });
  assert.equal(patch.statusCode, 403);

  const webhook = await app.inject({
    method: "POST",
    url: "/hooks/signoz",
    payload: {
      alerts: [{ labels: { alertname: "failed", trace_id: TRACE_ID }, annotations: {} }],
    },
  });
  assert.equal(webhook.statusCode, 401);

  const created = await app.inject({
    method: "POST",
    url: "/api/incidents",
    payload: {
      traceId: FORK_TRACE,
      runId: "seed-run",
      source: "codex-seed",
      agentId: "codex",
      alertName: "recorded run failed",
      severity: "warning",
      failureCondition: "NotImplementedError",
    },
  });
  assert.equal(created.statusCode, 200);
  assert.equal(created.json().severity, "warning");
  assert.equal(created.json().failureCondition, "NotImplementedError");
});

async function testApp(
  incidents: IncidentStore,
  fork: SpanInput[],
  incidentId: string,
) {
  const signoz = new SignozClient({ baseUrl: "http://unused", apiKey: "test" });
  signoz.getSpansForTrace = async (traceId: string) =>
    traceId === TRACE_ID ? fixtureSpans() : traceId === FORK_TRACE ? fork : [];
  signoz.getPayloadLogs = async (traceId: string): Promise<PayloadLogInput[]> =>
    traceId === TRACE_ID ? fixturePayloadLogs() : [];
  signoz.getRunEvents = async () => [];
  const executor: ForkExecutor = {
    async capabilities(): Promise<Capabilities> {
      return { schemaVersion: "1", liveSideEffects: false, runners: [] };
    },
    async execute(_request: ForkRequest): Promise<ForkResult> {
      return {
        forkRunId: "fork-run",
        forkTraceId: FORK_TRACE,
        originalTraceId: TRACE_ID,
        outcome: "success",
        stepCount: 0,
        mutation: MUTATION,
        mutationHash: MUTATION_HASH,
        runnerRevision: "agent-1@abc123",
        checkpoint: { complete: true, schemaVersion: "1", issues: [] },
        idempotencyKey: "route-test",
      };
    },
  };
  const app = Fastify();
  registerRoutes(app, {
    config: config(),
    signoz,
    incidents,
    forkExecutor: executor,
  });
  await app.ready();
  assert.ok(incidentId);
  return app;
}

function forkSpans(incidentId: string): SpanInput[] {
  return [
    {
      traceId: FORK_TRACE,
      spanId: "forkroot",
      name: "run agent-1",
      startTime: "2026-07-24T00:00:00.000Z",
      durationNano: 1_000_000,
      attributes: {
        [ATTR.SCHEMA_VERSION]: HINDSIGHT_SCHEMA_VERSION,
        [ATTR.RUN_ID]: "fork-run",
        [ATTR.AGENT_ID]: "agent-1",
        [ATTR.AGENT_REVISION]: "agent-1@abc123",
        [ATTR.OUTCOME]: "success",
        [ATTR.RUN_STEP_COUNT]: 0,
        [ATTR.RUN_TOKENS_TOTAL]: 0,
        [ATTR.RUN_COST_USD]: 0,
        [ATTR.PAYLOAD_COMPLETE]: true,
        [ATTR.FORK_OF]: TRACE_ID,
        [ATTR.FORK_POINT]: 0,
        [ATTR.FORK_MUTATION_HASH]: MUTATION_HASH,
        [ATTR.INCIDENT_ID]: incidentId,
      },
    },
  ];
}

function config(): Config {
  return {
    port: 4123,
    signozUrl: "http://localhost:8080",
    signozApiKey: "test",
    sqlitePath: ":memory:",
    otlpHttpUrl: "http://localhost:4318",
    serviceName: "test",
    runners: {},
    runnerTimeoutMs: 1_000,
    verificationTimeoutMs: 20,
    signozWebhookSecret: "webhook-secret",
  };
}
