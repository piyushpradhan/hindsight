/**
 * Pure compare engine: step alignment (LCS), metric deltas, and a hand-rolled
 * line diff of final outputs. No I/O — the fork executor will reuse this to
 * score counterfactual runs.
 */
import type { CompareResult, RunGraph, RunStep, StepAlignment } from "@hindsight/shared";

/** Coarse identity used for LCS: what the step IS, ignoring its inputs. */
function stepKey(step: RunStep): string {
  return `${step.kind}:${step.kind === "tool" ? step.toolName ?? step.name : step.model ?? step.name}`;
}

/** Fine identity: args hash when recorded, else stable-stringified args. */
function argsKey(step: RunStep): string | undefined {
  if (step.argsHash) return step.argsHash;
  if (step.args !== undefined) return stableStringify(step.args);
  return undefined;
}

export function alignSteps(original: RunStep[], fork: RunStep[]): StepAlignment[] {
  const n = original.length;
  const m = fork.length;
  // dp[i][j] = LCS length of original[i:] and fork[j:]
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        stepKey(original[i]) === stepKey(fork[j])
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const alignments: StepAlignment[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (stepKey(original[i]) === stepKey(fork[j])) {
      const a = argsKey(original[i]);
      const b = argsKey(fork[j]);
      const changed = a !== undefined && b !== undefined && a !== b;
      alignments.push({
        originalIndex: original[i].index,
        forkIndex: fork[j].index,
        status: changed ? "changed" : "same",
      });
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      alignments.push({ originalIndex: original[i].index, status: "removed" });
      i++;
    } else {
      alignments.push({ forkIndex: fork[j].index, status: "added" });
      j++;
    }
  }
  while (i < n) alignments.push({ originalIndex: original[i++].index, status: "removed" });
  while (j < m) alignments.push({ forkIndex: fork[j++].index, status: "added" });
  return alignments;
}

export function compareRuns(original: RunGraph, fork: RunGraph): CompareResult {
  return {
    original: original.run,
    fork: fork.run,
    deltaTokens:
      fork.run.totalTokens === null || original.run.totalTokens === null
        ? null
        : fork.run.totalTokens - original.run.totalTokens,
    deltaCostUsd:
      fork.run.costUsd === null || original.run.costUsd === null
        ? null
        : fork.run.costUsd - original.run.costUsd,
    deltaLatencyMs: latencyMs(fork.run) - latencyMs(original.run),
    deltaSteps: fork.run.stepCount - original.run.stepCount,
    outcomeChanged: fork.run.outcome !== original.run.outcome,
    alignments: alignSteps(original.steps, fork.steps),
    outputDiff: lineDiff(finalOutput(original), finalOutput(fork)),
  };
}

/** Hand-rolled unified-ish line diff ("+"/"-"/" " prefixes). */
export function lineDiff(a: string, b: string): string {
  if (a === b) return "";
  const al = a.split("\n");
  const bl = b.split("\n");
  const n = al.length;
  const m = bl.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = al[i] === bl[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (al[i] === bl[j]) out.push(`  ${al[i++]}`), j++;
    else if (dp[i + 1][j] >= dp[i][j + 1]) out.push(`- ${al[i++]}`);
    else out.push(`+ ${bl[j++]}`);
  }
  while (i < n) out.push(`- ${al[i++]}`);
  while (j < m) out.push(`+ ${bl[j++]}`);
  return out.join("\n");
}

function finalOutput(graph: RunGraph): string {
  const last = graph.steps[graph.steps.length - 1];
  if (!last) return "";
  const v = last.kind === "tool" ? last.toolOutput : (last.response ?? last.toolOutput);
  if (v === undefined) return "";
  return typeof v === "string" ? v : JSON.stringify(v, null, 2);
}

function latencyMs(run: RunGraph["run"]): number {
  if (!run.endTime) return 0;
  return Date.parse(run.endTime) - Date.parse(run.startTime);
}

function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(stableStringify).join(",")}]`;
  const rec = v as Record<string, unknown>;
  return `{${Object.keys(rec)
    .sort()
    .map((k) => `${JSON.stringify(k)}:${stableStringify(rec[k])}`)
    .join(",")}}`;
}
