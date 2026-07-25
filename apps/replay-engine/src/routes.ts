/**
 * REST contract implementation (see packages/shared/src/types.ts). Route
 * handlers only orchestrate: SigNoz access via SignozClient, persistence via
 * IncidentStore, all computation in pure modules.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import { timingSafeEqual } from "node:crypto";
import type {
  Capabilities,
  ForkRequest,
  ForkResult,
  Incident,
  MockPolicy,
  Mutation,
  RunGraph,
} from "@hindsight/shared";
import type { Config } from "./config.js";
import { SignozClient, SignozError } from "./signoz/client.js";
import { InvalidTransitionError, IncidentStore } from "./incidents/store.js";
import { buildRunGraph, summarizeSpans, type SpanInput } from "./rungraph/builder.js";
import { compareRuns } from "./compare/diff.js";
import { computeFleetStats } from "./fleet.js";
import { generatePostmortem } from "./postmortem.js";
import { handleSignozWebhook } from "./webhooks/signoz.js";
import { ForkExecutionError } from "./fork/executor.js";
import { IncompleteRecordError, replayRun } from "./replay/replay.js";
import { verifyForkResolution } from "./incidents/verify.js";
import type { EngineMetrics } from "./otel.js";
import { ATTR } from "@hindsight/shared";

/** Runner-backed fork execution boundary injected by the server. */
export interface ForkExecutor {
  execute(request: ForkRequest): Promise<ForkResult>;
  capabilities(): Promise<Capabilities>;
}

export interface RouteDeps {
  config: Config;
  signoz: SignozClient;
  incidents: IncidentStore;
  forkExecutor?: ForkExecutor;
  metrics?: EngineMetrics;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, signoz, incidents } = deps;

  app.get("/api/health", async () => ({ ok: true, signozAuthed: signoz.authed }));
  app.get("/api/capabilities", async () =>
    deps.forkExecutor
      ? deps.forkExecutor.capabilities()
      : { schemaVersion: "1", liveSideEffects: false, runners: [] },
  );

  app.get<{ Querystring: { agentId?: string; limit?: string } }>("/api/runs", async (req, reply) => {
    if (!requireSignoz(signoz, reply)) return;
    const limit = clampInt(req.query.limit, 1, 200, 50);
    // fetch extra spans so grouping by trace still yields `limit` full runs
    const spans = await withSignozErrors(reply, () =>
      signoz.listRunSpans({ agentId: req.query.agentId, limit: Math.min(limit * 10, 1000) }),
    );
    if (!spans) return;
    const byTrace = groupByTrace(spans);
    const runs = [...byTrace.entries()]
      .map(([traceId, traceSpans]) => summarizeSpans(traceId, traceSpans))
      .sort((a, b) => b.startTime.localeCompare(a.startTime))
      .slice(0, limit);
    return runs;
  });

  app.get<{ Params: { traceId: string } }>("/api/runs/:traceId", async (req, reply) => {
    if (!requireSignoz(signoz, reply)) return;
    const result = await withSignozErrors(reply, async () => {
      const spans = await signoz.getSpansForTrace(req.params.traceId);
      if (spans.length === 0) return null;
      const [logs, events] = await Promise.all([
        signoz.getPayloadLogs(req.params.traceId),
        signoz.getRunEvents(req.params.traceId),
      ]);
      return buildRunGraph(req.params.traceId, spans, logs, events);
    });
    if (result === undefined) return;
    if (result === null) return reply.code(404).send({ error: "run_not_found" });
    return result;
  });

  app.get<{ Querystring: { original?: string; fork?: string } }>("/api/compare", async (req, reply) => {
    const { original, fork } = req.query;
    if (!original || !fork) {
      return reply.code(400).send({ error: "missing_query_params", detail: "original and fork are required" });
    }
    if (!requireSignoz(signoz, reply)) return;
    const graphs = await withSignozErrors(reply, async () => {
      const [origSpans, forkSpans] = await Promise.all([
        signoz.getSpansForTrace(original),
        signoz.getSpansForTrace(fork),
      ]);
      if (origSpans.length === 0 || forkSpans.length === 0) return null;
      const [origLogs, forkLogs] = await Promise.all([
        signoz.getPayloadLogs(original),
        signoz.getPayloadLogs(fork),
      ]);
      return {
        original: buildRunGraph(original, origSpans, origLogs),
        fork: buildRunGraph(fork, forkSpans, forkLogs),
      };
    });
    if (graphs === undefined) return;
    if (graphs === null) return reply.code(404).send({ error: "run_not_found" });
    return compareRuns(graphs.original, graphs.fork);
  });

  app.post("/api/replays", async (req, reply) => {
    const body = req.body as { traceId?: unknown } | null;
    if (!body || typeof body.traceId !== "string" || body.traceId === "") {
      return reply.code(400).send({ error: "invalid_body", detail: "traceId is required" });
    }
    if (!requireSignoz(signoz, reply)) return;
    const graph = await withSignozErrors(reply, async () => {
      const spans = await signoz.getSpansForTrace(body.traceId as string);
      if (spans.length === 0) return null;
      return buildRunGraph(
        body.traceId as string,
        spans,
        await signoz.getPayloadLogs(body.traceId as string),
      );
    });
    if (graph === undefined) return;
    if (graph === null) return reply.code(404).send({ error: "run_not_found" });
    try {
      return replayRun(graph);
    } catch (error) {
      if (error instanceof IncompleteRecordError) {
        return reply.code(409).send({
          error: "incomplete_record",
          detail: error.message,
          checkpoint: graph.checkpoint,
        });
      }
      throw error;
    }
  });

  app.post("/api/forks", async (req, reply) => {
    const parsed = validateForkRequest(req.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: "invalid_fork_request", detail: parsed.detail });
    }
    if (!deps.forkExecutor) {
      return reply.code(503).send({ error: "runner_unavailable" });
    }
    if (!requireSignoz(signoz, reply)) return;
    const incident = parsed.value.incidentId
      ? incidents.get(parsed.value.incidentId)
      : undefined;
    if (parsed.value.incidentId && !incident) {
      return reply.code(404).send({ error: "incident_not_found" });
    }
    if (incident && incident.traceId !== parsed.value.traceId) {
      return reply
        .code(409)
        .send({ error: "incident_trace_mismatch", detail: "incident is anchored to another trace" });
    }
    if (incident && incident.status !== "open") {
      return reply.code(409).send({
        error: "incident_not_open",
        detail: `incident status is ${incident.status}`,
      });
    }
    try {
      const result = await deps.forkExecutor.execute(parsed.value);
      deps.metrics?.forks.add(1, {
        [ATTR.AGENT_ID]: incident?.agentId ?? "unknown",
        [ATTR.OUTCOME]: result.outcome,
      });
      if (!incident) return result;
      incidents.startVerification(incident.id, {
        forkTraceId: result.forkTraceId,
        mutation: result.mutation,
        mutationHash: result.mutationHash,
      }, {
        createdAt: new Date().toISOString(),
        outcome: result.outcome,
        runnerRevision: result.runnerRevision,
        idempotencyKey: result.idempotencyKey,
        error: result.error,
      });
      let verification;
      try {
        const [original, fork] = await Promise.all([
          loadGraph(signoz, incident.traceId),
          waitForGraph(signoz, result.forkTraceId, config.verificationTimeoutMs),
        ]);
        if (!original || !fork) {
          verification = {
            verified: false as const,
            checkedAt: new Date().toISOString(),
            reason: "fork telemetry was not queryable before the verification timeout",
            originalOutcome: original?.run.outcome,
            forkOutcome: fork?.run.outcome,
          };
        } else {
          const verifyingIncident = incidents.get(incident.id);
          if (!verifyingIncident) throw new Error("incident disappeared during verification");
          verification = verifyForkResolution({
            incident: verifyingIncident,
            original,
            fork,
            result,
          });
        }
      } catch (error) {
        verification = {
          verified: false as const,
          checkedAt: new Date().toISOString(),
          reason: `verification query failed: ${
            error instanceof Error ? error.message : String(error)
          }`,
          originalOutcome: incident.verification?.originalOutcome,
        };
      }
      const updated = incidents.finishVerification(incident.id, verification);
      if (updated?.status === "resolved") {
        deps.metrics?.resolved.add(1, { [ATTR.AGENT_ID]: updated.agentId });
        if (updated.resolutionMs !== undefined) {
          deps.metrics?.resolutionDuration.record(updated.resolutionMs, {
            [ATTR.AGENT_ID]: updated.agentId,
          });
        }
      }
      return { ...result, verification, incident: updated };
    } catch (error) {
      if (error instanceof ForkExecutionError) {
        deps.metrics?.forks.add(1, {
          [ATTR.AGENT_ID]: incident?.agentId ?? "unknown",
          [ATTR.OUTCOME]: "failure",
        });
        return reply.code(error.status).send({ error: error.code, detail: error.message });
      }
      throw error;
    }
  });

  app.get("/api/incidents", async () => incidents.list());

  app.post("/api/incidents", async (req, reply) => {
    const body = req.body as {
      traceId?: unknown;
      runId?: unknown;
      source?: unknown;
      agentId?: unknown;
      alertName?: unknown;
      severity?: unknown;
      failureCondition?: unknown;
    } | null;
    if (!body || typeof body.traceId !== "string" || body.traceId === "") {
      return reply.code(400).send({ error: "invalid_body", detail: "traceId (string) is required" });
    }
    return incidents.create({
      traceId: body.traceId,
      runId: typeof body.runId === "string" ? body.runId : undefined,
      source: typeof body.source === "string" ? body.source : undefined,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
      alertName: typeof body.alertName === "string" ? body.alertName : undefined,
      severity: typeof body.severity === "string" ? body.severity : undefined,
      failureCondition:
        typeof body.failureCondition === "string" ? body.failureCondition : undefined,
    });
  });

  app.patch<{ Params: { id: string } }>("/api/incidents/:id", async (req, reply) => {
    if (!req.body || typeof req.body !== "object") {
      return reply.code(400).send({ error: "invalid_body" });
    }
    const patch = req.body as Partial<Incident>;
    if (
      patch.status !== undefined &&
      patch.status !== "open" &&
      patch.status !== "dismissed"
    ) {
      return reply.code(403).send({
        error: "verified_resolution_required",
        detail: "verifying and resolved states are controlled by fork verification",
      });
    }
    if (patch.status === "dismissed" && !patch.notes?.trim()) {
      return reply.code(400).send({
        error: "dismissal_reason_required",
        detail: "notes must explain why the incident is dismissed",
      });
    }
    const allowedKeys = new Set(["status", "notes"]);
    if (Object.keys(patch).some((key) => !allowedKeys.has(key))) {
      return reply.code(400).send({
        error: "invalid_body",
        detail: "only status and notes may be changed manually",
      });
    }
    try {
      const updated = incidents.update(req.params.id, patch);
      if (!updated) return reply.code(404).send({ error: "incident_not_found" });
      return updated;
    } catch (err) {
      if (err instanceof InvalidTransitionError) {
        return reply
          .code(400)
          .send({ error: "invalid_status_transition", from: err.from, to: err.to });
      }
      throw err;
    }
  });

  app.post<{ Params: { id: string } }>("/api/incidents/:id/postmortem", async (req, reply) => {
    const incident = incidents.get(req.params.id);
    if (!incident) return reply.code(404).send({ error: "incident_not_found" });
    if (incident.status !== "resolved" || !incident.verification?.verified) {
      return reply.code(409).send({
        error: "verified_resolution_required",
        detail: "postmortems are generated after a fork is verified",
      });
    }
    // Best effort: a postmortem is still useful without live SigNoz data.
    let runGraph;
    let compare;
    if (signoz.authed) {
      try {
        const spans = await signoz.getSpansForTrace(incident.traceId);
        if (spans.length > 0) {
          const logs = await signoz.getPayloadLogs(incident.traceId);
          runGraph = buildRunGraph(incident.traceId, spans, logs);
        }
        if (incident.forkTraceId) {
          const forkSpans = await signoz.getSpansForTrace(incident.forkTraceId);
          if (runGraph && forkSpans.length > 0) {
            const forkLogs = await signoz.getPayloadLogs(incident.forkTraceId);
            compare = compareRuns(runGraph, buildRunGraph(incident.forkTraceId, forkSpans, forkLogs));
          }
        }
      } catch (err) {
        req.log.warn({ err }, "postmortem: SigNoz fetch failed, generating partial markdown");
      }
    }
    return {
      markdown: generatePostmortem({
        incident,
        runGraph,
        compare: compare ?? incident.verification?.comparison,
        signozUrl: config.signozUrl,
      }),
    };
  });

  app.get("/api/fleet", async (_req, reply) => {
    if (!requireSignoz(signoz, reply)) return;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const spans = await withSignozErrors(reply, () =>
      signoz.listRunSpans({ sinceMs: startOfDay.getTime() - DAY_MS, limit: 1000 }),
    );
    if (!spans) return;
    const runs = [...groupByTrace(spans).entries()].map(([traceId, traceSpans]) =>
      summarizeSpans(traceId, traceSpans),
    );
    return computeFleetStats(runs, incidents.openCountsByAgent());
  });

  app.post("/hooks/signoz", async (req, reply) => {
    if (!config.signozWebhookSecret) {
      return reply.code(503).send({ error: "webhook_secret_missing" });
    }
    const authorization = req.headers.authorization;
    if (!sameSecret(webhookCredential(authorization), config.signozWebhookSecret)) {
      return reply.code(401).send({ error: "webhook_unauthorized" });
    }
    const outcome = handleSignozWebhook(req.body, incidents);
    if (!outcome.ok) {
      return reply
        .code(400)
        .send({ error: "unrecognized_alert_payload", received: req.body ?? null });
    }
    for (const incident of outcome.created) {
      deps.metrics?.incidents.add(1, { [ATTR.AGENT_ID]: incident.agentId });
    }
    return outcome.incidents.length === 1 && outcome.ignored === 0
      ? outcome.incidents[0]
      : { incidents: outcome.incidents, ignored: outcome.ignored };
  });
}

/* ------------------------------- helpers ---------------------------------- */

function requireSignoz(signoz: SignozClient, reply: FastifyReply): boolean {
  if (signoz.authed) return true;
  reply.code(503).send({ error: "signoz_auth_missing" });
  return false;
}

/** Maps SignozError to friendly 503s; returns undefined when it replied. */
async function withSignozErrors<T>(reply: FastifyReply, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof SignozError) {
      const error = err.kind === "auth" ? "signoz_auth_missing" : "signoz_unavailable";
      reply.code(503).send({ error, detail: err.message });
      return undefined;
    }
    throw err;
  }
}

function groupByTrace(spans: SpanInput[]): Map<string, SpanInput[]> {
  const map = new Map<string, SpanInput[]>();
  for (const span of spans) {
    const list = map.get(span.traceId) ?? [];
    list.push(span);
    map.set(span.traceId, list);
  }
  return map;
}

function clampInt(v: string | undefined, min: number, max: number, dflt: number): number {
  const n = v === undefined ? NaN : Number(v);
  if (Number.isNaN(n)) return dflt;
  return Math.min(max, Math.max(min, Math.floor(n)));
}

const MUTATION_TYPES = ["model_swap", "prompt_edit", "tool_output_override", "params", "disable_tool"];
const MOCK_POLICIES: MockPolicy[] = ["strict", "hybrid"];

function validateForkRequest(
  body: unknown,
): { ok: true; value: ForkRequest } | { ok: false; detail: string } {
  const fail = (detail: string) => ({ ok: false as const, detail });
  if (!body || typeof body !== "object") return fail("body must be an object");
  const b = body as Record<string, unknown>;
  if (typeof b.traceId !== "string" || b.traceId === "") return fail("traceId must be a non-empty string");
  if (!Number.isInteger(b.forkAtStep) || (b.forkAtStep as number) < 0) {
    return fail("forkAtStep must be an integer >= 0");
  }
  if (typeof b.mockPolicy !== "string" || !MOCK_POLICIES.includes(b.mockPolicy as MockPolicy)) {
    return fail(`mockPolicy must be one of ${MOCK_POLICIES.join(", ")}`);
  }
  const mutationError = validateMutation(b.mutation);
  if (mutationError) return fail(mutationError);
  return {
    ok: true,
    value: {
      traceId: b.traceId,
      forkAtStep: b.forkAtStep as number,
      mockPolicy: b.mockPolicy as MockPolicy,
      mutation: b.mutation as Mutation,
      incidentId: typeof b.incidentId === "string" ? b.incidentId : undefined,
      idempotencyKey: typeof b.idempotencyKey === "string" ? b.idempotencyKey : undefined,
    },
  };
}

function validateMutation(m: unknown): string | null {
  if (!m || typeof m !== "object") return "mutation must be an object";
  const mutation = m as Record<string, unknown>;
  if (typeof mutation.type !== "string" || !MUTATION_TYPES.includes(mutation.type)) {
    return `mutation.type must be one of ${MUTATION_TYPES.join(", ")}`;
  }
  switch (mutation.type) {
    case "model_swap":
      return typeof mutation.model === "string" && mutation.model !== ""
        ? null
        : "model_swap requires model (string)";
    case "prompt_edit":
      return typeof mutation.newSystemPrompt === "string"
        ? null
        : "prompt_edit requires newSystemPrompt (string)";
    case "tool_output_override":
      return Number.isInteger(mutation.stepIndex) && "output" in mutation
        ? null
        : "tool_output_override requires stepIndex (int) and output";
    case "params":
      return mutation.temperature === undefined && mutation.maxTokens === undefined
        ? "params requires temperature and/or maxTokens"
        : null;
    case "disable_tool":
      return typeof mutation.toolName === "string" && mutation.toolName !== ""
        ? null
        : "disable_tool requires toolName (string)";
    default:
      return "unknown mutation type";
  }
}

async function loadGraph(signoz: SignozClient, traceId: string): Promise<RunGraph | null> {
  const spans = await signoz.getSpansForTrace(traceId);
  if (!spans.some((span) => span.attributes[ATTR.OUTCOME] !== undefined)) return null;
  const [payloads, events] = await Promise.all([
    signoz.getPayloadLogs(traceId),
    signoz.getRunEvents(traceId),
  ]);
  return buildRunGraph(traceId, spans, payloads, events);
}

async function waitForGraph(
  signoz: SignozClient,
  traceId: string,
  timeoutMs: number,
): Promise<RunGraph | null> {
  const deadline = Date.now() + timeoutMs;
  do {
    const graph = await loadGraph(signoz, traceId);
    if (graph) return graph;
    await new Promise((resolve) => setTimeout(resolve, 250));
  } while (Date.now() < deadline);
  return null;
}

function webhookCredential(authorization: string | undefined): string | undefined {
  if (authorization?.startsWith("Bearer ")) return authorization.slice("Bearer ".length);
  if (!authorization?.startsWith("Basic ")) return undefined;
  const decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString();
  return decoded.startsWith(":") ? decoded.slice(1) : undefined;
}

function sameSecret(actual: string | undefined, expected: string): boolean {
  if (actual === undefined) return false;
  const actualBytes = Buffer.from(actual);
  const expectedBytes = Buffer.from(expected);
  return (
    actualBytes.length === expectedBytes.length &&
    timingSafeEqual(actualBytes, expectedBytes)
  );
}
