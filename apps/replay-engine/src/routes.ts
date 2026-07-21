/**
 * REST contract implementation (see packages/shared/src/types.ts). Route
 * handlers only orchestrate: SigNoz access via SignozClient, persistence via
 * IncidentStore, all computation in pure modules.
 */
import type { FastifyInstance, FastifyReply } from "fastify";
import type { ForkRequest, ForkResult, Incident, MockPolicy, Mutation } from "@hindsight/shared";
import type { Config } from "./config.js";
import { SignozClient, SignozError } from "./signoz/client.js";
import { InvalidTransitionError, IncidentStore } from "./incidents/store.js";
import { buildRunGraph, summarizeSpans, type SpanInput } from "./rungraph/builder.js";
import { compareRuns } from "./compare/diff.js";
import { computeFleetStats } from "./fleet.js";
import { generatePostmortem } from "./postmortem.js";
import { handleSignozWebhook } from "./webhooks/signoz.js";

/**
 * SEAM for the fork-executor follow-up: implement this interface (replay
 * steps 0..forkAtStep from the original RunGraph with the mutation applied,
 * record a new trace tagged hindsight.fork.of) and inject it at server
 * startup. Routes stay unchanged.
 */
export interface ForkExecutor {
  execute(request: ForkRequest): Promise<ForkResult>;
}

export interface RouteDeps {
  config: Config;
  signoz: SignozClient;
  incidents: IncidentStore;
  forkExecutor?: ForkExecutor;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export function registerRoutes(app: FastifyInstance, deps: RouteDeps): void {
  const { config, signoz, incidents } = deps;

  app.get("/api/health", async () => ({ ok: true, signozAuthed: signoz.authed }));

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
      const logs = await signoz.getPayloadLogs(req.params.traceId);
      return buildRunGraph(req.params.traceId, spans, logs);
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

  app.post("/api/forks", async (req, reply) => {
    const parsed = validateForkRequest(req.body);
    if (!parsed.ok) {
      return reply.code(400).send({ error: "invalid_fork_request", detail: parsed.detail });
    }
    // SEAM: the fork executor drops in via RouteDeps.forkExecutor. It will
    // need SigNoz (requireSignoz) once implemented; for now the pending
    // stub answers without touching the query API.
    if (!deps.forkExecutor) {
      return reply.code(501).send({ error: "fork_executor_pending" });
    }
    if (!requireSignoz(signoz, reply)) return;
    return deps.forkExecutor.execute(parsed.value);
  });

  app.get("/api/incidents", async () => incidents.list());

  app.post("/api/incidents", async (req, reply) => {
    const body = req.body as { traceId?: unknown; agentId?: unknown; alertName?: unknown } | null;
    if (!body || typeof body.traceId !== "string" || body.traceId === "") {
      return reply.code(400).send({ error: "invalid_body", detail: "traceId (string) is required" });
    }
    return incidents.create({
      traceId: body.traceId,
      agentId: typeof body.agentId === "string" ? body.agentId : undefined,
      alertName: typeof body.alertName === "string" ? body.alertName : undefined,
    });
  });

  app.patch<{ Params: { id: string } }>("/api/incidents/:id", async (req, reply) => {
    if (!req.body || typeof req.body !== "object") {
      return reply.code(400).send({ error: "invalid_body" });
    }
    try {
      const updated = incidents.update(req.params.id, req.body as Partial<Incident>);
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
    return { markdown: generatePostmortem({ incident, runGraph, compare, signozUrl: config.signozUrl }) };
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
    const outcome = handleSignozWebhook(req.body, incidents);
    if (!outcome.ok) {
      return reply
        .code(400)
        .send({ error: "unrecognized_alert_payload", received: req.body ?? null });
    }
    return outcome.incidents.length === 1 ? outcome.incidents[0] : { incidents: outcome.incidents };
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
const MOCK_POLICIES: MockPolicy[] = ["strict", "hybrid", "live"];

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
