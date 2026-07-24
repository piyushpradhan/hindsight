import type { CompareResult, Incident, RunGraph } from "@hindsight/shared";

export interface PostmortemInput {
  incident: Incident;
  runGraph?: RunGraph;
  compare?: CompareResult;
  signozUrl: string;
}

const money = (usd: number | null) => (usd === null ? "unknown" : `$${usd.toFixed(6)}`);

export function generatePostmortem({ incident, runGraph, compare, signozUrl }: PostmortemInput): string {
  const lines: string[] = [];
  lines.push(`# Postmortem: ${incident.alertName}`);
  lines.push("");
  lines.push(`- **Incident**: \`${incident.id}\` (${incident.status})`);
  lines.push(`- **Agent**: \`${incident.agentId}\``);
  lines.push(`- **Trace**: [${incident.traceId}](${signozUrl}/trace/${incident.traceId})`);
  lines.push(`- **Opened**: ${incident.createdAt}`);
  if (incident.severity) lines.push(`- **Severity**: ${incident.severity}`);
  lines.push("");

  lines.push("## What failed");
  lines.push("");
  if (runGraph) {
    const { run } = runGraph;
    lines.push(
      `Run \`${run.runId}\` finished with outcome **${run.outcome}**` +
        `${run.error ? ` (${run.error})` : ""} after ${run.stepCount} steps, ` +
        `${run.totalTokens ?? "unknown"} tokens, ${money(run.costUsd)}.`,
    );
    const failed = runGraph.steps.filter((s) => s.error);
    for (const s of failed) {
      lines.push(`- Step ${s.index} (\`${s.name}\`) error: **${s.error}**`);
    }
  } else {
    lines.push("_RunGraph unavailable — is SigNoz reachable and SIGNOZ_API_KEY set?_");
  }
  lines.push("");

  if (runGraph && runGraph.steps.length > 0) {
    lines.push("## Steps");
    lines.push("");
    lines.push("| # | kind | name | latency | tokens | cost | error |");
    lines.push("|---|------|------|---------|--------|------|-------|");
    for (const s of runGraph.steps) {
      const tokens =
        s.kind === "llm" &&
        (s.inputTokens === undefined || s.outputTokens === undefined)
          ? "unknown"
          : String((s.inputTokens ?? 0) + (s.outputTokens ?? 0));
      lines.push(
        `| ${s.index} | ${s.kind} | \`${s.name}\` | ${s.latencyMs.toFixed(0)}ms | ${tokens} | ${money(s.costUsd)} | ${s.error ?? ""} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Root cause");
  lines.push("");
  lines.push(
    "Unknown. The verified fork proves the recorded mutation removed the failure condition; it does not by itself prove a broader causal explanation.",
  );
  lines.push("");

  if (incident.verification?.verified) {
    lines.push("## Resolution evidence");
    lines.push("");
    lines.push(`- Verified: ${incident.verification.checkedAt}`);
    if (incident.resolutionMs !== undefined) {
      lines.push(`- Resolution duration: ${incident.resolutionMs}ms`);
    }
    if (incident.mutation) {
      lines.push(`- Winning mutation: \`${JSON.stringify(incident.mutation)}\``);
    }
    lines.push(`- Verification: ${incident.verification.reason}`);
    lines.push("");
  }

  lines.push("## Counterfactual fork");
  lines.push("");
  if (compare) {
    lines.push(
      `Fork [${compare.fork.traceId}](${signozUrl}/trace/${compare.fork.traceId}) ` +
        `vs original [${compare.original.traceId}](${signozUrl}/trace/${compare.original.traceId}):`,
    );
    lines.push("");
    lines.push("| metric | before | after | delta |");
    lines.push("|--------|--------|-------|-------|");
    lines.push(`| outcome | ${compare.original.outcome} | ${compare.fork.outcome} | ${compare.outcomeChanged ? "**changed**" : "same"} |`);
    lines.push(`| steps | ${compare.original.stepCount} | ${compare.fork.stepCount} | ${signed(compare.deltaSteps)} |`);
    lines.push(`| tokens | ${compare.original.totalTokens ?? "unknown"} | ${compare.fork.totalTokens ?? "unknown"} | ${signed(compare.deltaTokens)} |`);
    lines.push(`| cost | ${money(compare.original.costUsd)} | ${money(compare.fork.costUsd)} | ${signed(compare.deltaCostUsd, 6)} |`);
    lines.push(`| latency | ${compare.original.endTime ? latency(compare.original) + "ms" : "?"} | ${compare.fork.endTime ? latency(compare.fork) + "ms" : "?"} | ${signed(compare.deltaLatencyMs)}ms |`);
    lines.push("");
    const counts = countStatuses(compare.alignments);
    lines.push(
      `Step alignment: ${counts.same} same, ${counts.changed} changed, ` +
        `${counts.added} added, ${counts.removed} removed.`,
    );
    if (compare.outputDiff) {
      lines.push("");
      lines.push("```diff");
      lines.push(compare.outputDiff);
      lines.push("```");
    }
  } else if (incident.forkTraceId) {
    lines.push(`Fork trace: [${incident.forkTraceId}](${signozUrl}/trace/${incident.forkTraceId})`);
  } else {
    lines.push("_No fork executed yet._");
  }
  lines.push("");

  if (incident.notes) {
    lines.push("## Notes");
    lines.push("");
    lines.push(incident.notes);
    lines.push("");
  }
  return lines.join("\n");
}

const signed = (n: number | null, digits = 0) =>
  n === null ? "unknown" : `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
const latency = (run: { startTime: string; endTime?: string }) =>
  Date.parse(run.endTime as string) - Date.parse(run.startTime);

function countStatuses(alignments: CompareResult["alignments"]) {
  const counts = { same: 0, changed: 0, added: 0, removed: 0 };
  for (const a of alignments) counts[a.status]++;
  return counts;
}
