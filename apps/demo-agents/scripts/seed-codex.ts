/**
 * Seed a personal Hindsight workspace from the Codex sessions that built it.
 *
 * Runs are stored in SigNoz. Incidents are opened through the replay-engine,
 * matching the application's real storage split. Re-running is idempotent.
 */
import { randomUUID } from "node:crypto";
import { createRecorder } from "@hindsight/recorder";
import type { Incident, RunGraph, RunSummary } from "@hindsight/shared";
import {
  CODEX_AGENT,
  runAgentSpec,
  type AgentResult,
  type AgentSpec,
  type PlanStep,
} from "../src/index.js";

const ENGINE = (process.env.HINDSIGHT_ENGINE_URL ?? "http://localhost:4123").replace(/\/$/, "");

interface Session {
  taskId: string;
  task: string;
  final: string;
  files: string[];
  summary: string;
  checks: string[];
  tests: number;
  errorType?: string;
  error?: string;
}

const sessions: Session[] = [
  {
    taskId: "codex-initial-architecture",
    task: "Build Hindsight as a replay and fork debugger for AI agents on SigNoz.",
    final: "Implemented the recorder, replay engine, reference agents, Studio, and SigNoz templates.",
    files: ["packages/recorder", "apps/replay-engine", "apps/studio", "infra"],
    summary: "Created the initial end-to-end Hindsight architecture.",
    checks: ["build", "typecheck", "tests"],
    tests: 31,
  },
  {
    taskId: "codex-telemetry-contract",
    task: "Make the recorder and SigNoz queries share one versioned telemetry contract.",
    final: "Unified hindsight.* attributes and made run summaries report measured steps, tokens, and cost.",
    files: ["packages/shared/src/telemetry.ts", "packages/recorder/src/recorder.ts", "apps/replay-engine/src/signoz/client.ts"],
    summary: "Unified telemetry names and root-span aggregates.",
    checks: ["recorder tests", "infra validation", "typecheck"],
    tests: 18,
  },
  {
    taskId: "codex-checkpoint-validation",
    task: "Make replay fail closed when payload evidence is incomplete or tampered with.",
    final: "Added integrity hashes, continuity checks, and machine-readable checkpoint issues.",
    files: ["packages/recorder/src/payload-policy.ts", "apps/replay-engine/src/rungraph/builder.ts", "apps/replay-engine/src/replay/replay.ts"],
    summary: "Added complete checkpoint validation and offline replay.",
    checks: ["checkpoint tests", "payload policy tests", "typecheck"],
    tests: 24,
  },
  {
    taskId: "codex-reference-runner",
    task: "Replace simulated forks with a registered runner that resumes the real agent loop.",
    final: "Implemented the runner protocol, exact tool mocks, mutation validation, lineage, and idempotency.",
    files: ["apps/demo-agents/src/fork-runner.ts", "apps/replay-engine/src/fork/executor.ts", "apps/demo-agents/scripts/runner.ts"],
    summary: "Connected forks to the registered reference runtime.",
    checks: ["runner tests", "executor tests", "typecheck"],
    tests: 29,
  },
  {
    taskId: "codex-studio-polish",
    task: "Polish Studio with keyboard scrubbing, sticky timelines, and strong first-run states.",
    final: "Added keyboard navigation, sticky step context, loading states, and responsive polish.",
    files: ["apps/studio/src/components/StepScrubber.tsx", "apps/studio/src/screens/RunDetailScreen.tsx", "apps/studio/src/styles.css"],
    summary: "Improved the run-inspection workflow and first-run experience.",
    checks: ["studio build", "typecheck"],
    tests: 7,
  },
  {
    taskId: "codex-verified-resolution",
    task: "Implement incident verification so only a proven linked fork can resolve an incident.",
    final: "Added open → verifying → resolved lifecycle, evidence checks, fork attempts, and postmortems.",
    files: ["apps/replay-engine/src/incidents/store.ts", "apps/replay-engine/src/incidents/verify.ts", "apps/replay-engine/src/routes.ts"],
    summary: "Implemented evidence-backed incident resolution.",
    checks: ["incident tests", "route tests", "typecheck"],
    tests: 36,
  },
  {
    taskId: "codex-infra-validation",
    task: "Validate that dashboards and alerts only reference emitted hindsight.* fields.",
    final: "Added config validation and aligned dashboard and alert templates with the shared contract.",
    files: ["scripts/validate-infra.ts", "infra/alerts", "infra/dashboards"],
    summary: "Kept observability configuration aligned with emitted telemetry.",
    checks: ["validate:infra", "typecheck"],
    tests: 9,
  },
  {
    taskId: "codex-product-truthfulness",
    task: "Audit the product language so unsupported or incomplete behavior is never presented as working.",
    final: "Updated the README, product plan, capability states, and errors to match real behavior.",
    files: ["README.md", "PRODUCT.md", "IMPLEMENTATION_PLAN.md", "apps/studio/src/components/ErrorNote.tsx"],
    summary: "Made product claims and UI states evidence-based.",
    checks: ["build", "documentation review"],
    tests: 4,
  },
  {
    taskId: "codex-schema-mismatch",
    task: "Fix live SigNoz runs showing zero steps, tokens, and cost after the schema migration.",
    final: "",
    files: ["apps/replay-engine/src/rungraph/builder.ts", "apps/replay-engine/src/signoz/client.ts"],
    summary: "Investigated legacy and current root-span selection.",
    checks: ["live query fixture", "builder tests"],
    tests: 0,
    errorType: "SchemaMismatchError",
    error: "live run summary still selected a legacy span and reported stepCount=0",
  },
  {
    taskId: "codex-alert-provisioning",
    task: "Provision and verify the trace-correlated alert rules against SigNoz v0.133.",
    final: "",
    files: ["infra/alerts/run-failures.json", "infra/alerts/loop-tripwire.json"],
    summary: "Validated templates but could not prove installation in the local SigNoz instance.",
    checks: ["SigNoz rule lookup"],
    tests: 0,
    errorType: "AlertProvisioningError",
    error: "alert templates are valid but remain uninstalled",
  },
  {
    taskId: "codex-compare-shared-prefix",
    task: "Change Compare to show the shared prefix once and diff only the fork branch.",
    final: "",
    files: ["apps/replay-engine/src/compare/diff.ts", "apps/studio/src/screens/CompareScreen.tsx"],
    summary: "Traced the compare flow; the branch-aware verdict model is not implemented yet.",
    checks: ["compare tests"],
    tests: 0,
    errorType: "NotImplementedError",
    error: "compare still aligns the full original and fork timelines",
  },
];

async function main(): Promise<void> {
  const existing = await api<RunSummary[]>(`/api/runs?agentId=${CODEX_AGENT.agentId}&limit=200`);
  const byTask = new Map(existing.map((run) => [run.taskId, run]));
  const recorder = createRecorder({
    recordPayloads: "always",
    payloadMode: "full",
    serviceName: "hindsight-codex-sessions",
  });
  const runs = new Map<string, RunSummary | AgentResult>();

  try {
    for (const [index, session] of sessions.entries()) {
      const prior = byTask.get(session.taskId);
      if (prior) {
        runs.set(session.taskId, prior);
        console.log(`skip  ${session.taskId}  trace=${prior.traceId}`);
        continue;
      }
      const result = await runAgentSpec(specFor(session), {
        recorder,
        seed: index,
        taskId: session.taskId,
      });
      runs.set(session.taskId, result);
      console.log(
        `${result.outcome.padEnd(7)} ${session.taskId}  steps=${result.steps}  trace=${result.traceId}`,
      );
    }
  } finally {
    await recorder.shutdown();
  }

  for (const run of runs.values()) await waitForRun(run.traceId);

  const schemaIncident = await openIncident(
    runs.get("codex-schema-mismatch")!,
    "Hindsight: recorded run failed",
    "SchemaMismatchError",
    "critical",
  );
  if (schemaIncident.status === "open") {
    await api("/api/forks", {
      method: "POST",
      body: JSON.stringify({
        traceId: schemaIncident.traceId,
        forkAtStep: 5,
        mutation: {
          type: "tool_output_override",
          stepIndex: 5,
          output: { passed: true, checks: ["live query fixture", "builder tests"], tests: 12 },
        },
        mockPolicy: "strict",
        incidentId: schemaIncident.id,
        idempotencyKey: `seed-codex-schema-${schemaIncident.traceId}`,
      }),
    });
  }

  await openIncident(
    runs.get("codex-compare-shared-prefix")!,
    "Hindsight: recorded run failed",
    "NotImplementedError",
    "warning",
  );

  const alertIncident = await openIncident(
    runs.get("codex-alert-provisioning")!,
    "Hindsight: recorded run failed",
    "AlertProvisioningError",
    "info",
  );
  if (alertIncident.status === "open") {
    await api(`/api/incidents/${alertIncident.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        status: "dismissed",
        notes: "Environment setup remains in the implementation plan; this was not an agent-runtime regression.",
      }),
    });
  }

  const incidents = await api<Incident[]>("/api/incidents");
  const personal = incidents.filter((incident) => incident.agentId === CODEX_AGENT.agentId);
  const resolved = personal.filter((incident) => incident.status === "resolved").length;
  const open = personal.filter((incident) => incident.status === "open").length;
  const dismissed = personal.filter((incident) => incident.status === "dismissed").length;
  if (resolved !== 1 || open !== 1 || dismissed !== 1) {
    throw new Error(`unexpected incident mix: ${resolved} resolved, ${open} open, ${dismissed} dismissed`);
  }
  console.log(`\nseeded ${sessions.length} Codex sessions + 1 verified fork`);
  console.log(`incidents: ${resolved} resolved, ${open} open, ${dismissed} dismissed`);
}

function specFor(session: Session): AgentSpec {
  const plan: PlanStep[] = [
    {
      kind: "tool",
      name: "repo_search",
      args: {
        query: session.task,
        files: session.files,
        summary: `Found ${session.files.length} relevant paths.`,
      },
    },
    {
      kind: "tool",
      name: "apply_patch",
      args: {
        files: session.files,
        additions: 18 + session.tests,
        deletions: Math.max(2, Math.floor(session.tests / 3)),
        summary: session.summary,
      },
    },
    {
      kind: "tool",
      name: "run_checks",
      args: {
        checks: session.checks,
        tests: session.tests,
        errorType: session.errorType,
        error: session.error,
      },
    },
  ];
  if (!session.error) plan.push({ kind: "final", content: session.final });
  return { ...CODEX_AGENT, task: session.task, plan };
}

async function openIncident(
  run: RunSummary | AgentResult,
  alertName: string,
  failureCondition: string,
  severity: string,
): Promise<Incident> {
  const incidents = await api<Incident[]>("/api/incidents");
  const existing = incidents.find(
    (incident) => incident.traceId === run.traceId && incident.agentId === CODEX_AGENT.agentId,
  );
  if (existing) return existing;
  const payload = {
    status: "firing",
    alerts: [
      {
        status: "firing",
        labels: {
          alertname: alertName,
          severity,
          trace_id: run.traceId,
          "hindsight.agent.id": CODEX_AGENT.agentId,
          "hindsight.run.id": run.runId,
          "error.type": failureCondition,
        },
        annotations: { summary: `${CODEX_AGENT.agentId} run failed: ${failureCondition}` },
        fingerprint: `seed-${failureCondition.toLowerCase()}-${run.traceId}`,
      },
    ],
  };
  if (process.env.SIGNOZ_WEBHOOK_SECRET) {
    return api<Incident>("/hooks/signoz", {
      method: "POST",
      headers: { authorization: `Bearer ${process.env.SIGNOZ_WEBHOOK_SECRET}` },
      body: JSON.stringify(payload),
    });
  }
  return api<Incident>("/api/incidents", {
    method: "POST",
    body: JSON.stringify({
      traceId: run.traceId,
      runId: run.runId,
      source: "codex-seed",
      agentId: CODEX_AGENT.agentId,
      alertName,
      severity,
      failureCondition,
    }),
  });
}

async function waitForRun(traceId: string): Promise<RunGraph> {
  for (let attempt = 0; attempt < 40; attempt++) {
    try {
      const graph = await api<RunGraph>(`/api/runs/${traceId}`);
      if (graph.run.stepCount > 0 && graph.checkpoint?.complete) return graph;
    } catch {
      // SigNoz ingestion is eventually consistent.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`run ${traceId} was not queryable with a complete checkpoint`);
}

async function api<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${ENGINE}${path}`, {
    headers: { "content-type": "application/json", ...init?.headers },
    ...init,
  });
  const body = (await response.json()) as T & { error?: string; detail?: string };
  if (!response.ok) {
    throw new Error(`${response.status} ${body.error ?? "request_failed"}: ${body.detail ?? ""}`);
  }
  return body;
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
