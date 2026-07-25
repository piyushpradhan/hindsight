/**
 * Pure compare engine: lineage-aware step alignment, recorded-field deltas,
 * a conservative verdict, and a hand-rolled final-output diff.
 */
import type {
  CompareResult,
  ComparisonVerdict,
  FieldComparison,
  RunGraph,
  RunStep,
  StepAlignment,
} from "@hindsight/shared";

/** Stable execution identity. Model changes must not turn one LLM step into remove+add. */
function stepKey(step: RunStep): string {
  return step.kind === "tool" ? `tool:${step.toolName ?? step.name}` : "llm";
}

export function alignSteps(
  original: RunStep[],
  fork: RunStep[],
  branchPoint?: number,
): StepAlignment[] {
  if (branchPoint === undefined) return alignSequence(original, fork);

  const prefix = original
    .filter((step) => step.index < branchPoint)
    .map((step): StepAlignment => ({
      originalIndex: step.index,
      forkIndex: step.index,
      status: "same",
      sharedPrefix: true,
      fields: compareFields(step, step),
    }));
  const originalBranch = original.filter((step) => step.index >= branchPoint);
  const forkBranch = fork.filter((step) => step.index >= branchPoint);

  // The fork point is the one deliberate mutation, so pair it even when its
  // model/tool identity changed; align only the remaining branch with LCS.
  if (originalBranch[0]?.index === branchPoint && forkBranch[0]?.index === branchPoint) {
    return [
      ...prefix,
      paired(originalBranch[0], forkBranch[0]),
      ...alignSequence(originalBranch.slice(1), forkBranch.slice(1)),
    ];
  }
  return [...prefix, ...alignSequence(originalBranch, forkBranch)];
}

function alignSequence(original: RunStep[], fork: RunStep[]): StepAlignment[] {
  const n = original.length;
  const m = fork.length;
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
      alignments.push(paired(original[i++], fork[j++]));
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      alignments.push(unpaired(original[i++], undefined, "removed"));
    } else {
      alignments.push(unpaired(undefined, fork[j++], "added"));
    }
  }
  while (i < n) alignments.push(unpaired(original[i++], undefined, "removed"));
  while (j < m) alignments.push(unpaired(undefined, fork[j++], "added"));
  return alignments;
}

function paired(original: RunStep, fork: RunStep): StepAlignment {
  const fields = compareFields(original, fork);
  return {
    originalIndex: original.index,
    forkIndex: fork.index,
    status: fields.some((field) => field.status !== "same") ? "changed" : "same",
    fields,
  };
}

function unpaired(
  original: RunStep | undefined,
  fork: RunStep | undefined,
  status: "added" | "removed",
): StepAlignment {
  return {
    ...(original ? { originalIndex: original.index } : {}),
    ...(fork ? { forkIndex: fork.index } : {}),
    status,
    fields: compareFields(original, fork),
  };
}

export function compareRuns(original: RunGraph, fork: RunGraph): CompareResult {
  const branchPoint = validBranchPoint(original, fork);
  const originalMetrics = metrics(original, branchPoint);
  const forkMetrics = metrics(fork, branchPoint);
  const deltaTokens = subtract(forkMetrics.tokens, originalMetrics.tokens);
  const deltaCostUsd = subtract(forkMetrics.cost, originalMetrics.cost);
  const deltaLatencyMs = forkMetrics.duration - originalMetrics.duration;
  const deltaSteps = forkMetrics.steps - originalMetrics.steps;
  const originalOutput = finalOutput(original);
  const forkOutput = finalOutput(fork);
  const verdict = verdictFor(original, fork, {
    branchPoint,
    deltaTokens,
    deltaCostUsd,
    deltaLatencyMs,
    deltaSteps,
    originalOutput,
    forkOutput,
  });

  return {
    original: original.run,
    fork: fork.run,
    deltaTokens,
    deltaCostUsd,
    deltaLatencyMs,
    deltaSteps,
    outcomeChanged: fork.run.outcome !== original.run.outcome,
    alignments: alignSteps(original.steps, fork.steps, branchPoint),
    branchPoint,
    sharedPrefixSteps:
      branchPoint === undefined
        ? undefined
        : original.steps.filter((step) => step.index < branchPoint).length,
    verdict: verdict.value,
    verdictReason: verdict.reason,
    outputDiff: lineDiff(originalOutput, forkOutput),
  };
}

interface VerdictEvidence {
  branchPoint?: number;
  deltaTokens: number | null;
  deltaCostUsd: number | null;
  deltaLatencyMs: number;
  deltaSteps: number;
  originalOutput: string;
  forkOutput: string;
}

function verdictFor(
  original: RunGraph,
  fork: RunGraph,
  evidence: VerdictEvidence,
): { value: ComparisonVerdict; reason: string } {
  if (evidence.branchPoint === undefined) {
    return {
      value: "not_verifiable",
      reason: "Fork lineage or branch-point evidence is missing.",
    };
  }
  if (original.checkpoint?.complete !== true || fork.checkpoint?.complete !== true) {
    return {
      value: "not_verifiable",
      reason: "Recorded checkpoint evidence is missing or incomplete.",
    };
  }
  if (original.run.outcome !== fork.run.outcome) {
    if (fork.run.outcome === "success") {
      return { value: "improved", reason: "The recorded branch changed a failed run to success." };
    }
    if (original.run.outcome === "success") {
      return { value: "regressed", reason: "The recorded branch changed a successful run to failure." };
    }
    return {
      value: "not_verifiable",
      reason: "Failure and timeout outcomes have no reliable quality ordering.",
    };
  }
  if (!evidence.originalOutput || !evidence.forkOutput) {
    return {
      value: "not_verifiable",
      reason: "A final output is missing, so equal outcome labels are insufficient.",
    };
  }
  if (evidence.originalOutput !== evidence.forkOutput) {
    return {
      value: "not_verifiable",
      reason: "Outputs differ without a recorded quality score.",
    };
  }

  const deltas = [
    evidence.deltaTokens,
    evidence.deltaCostUsd,
    evidence.deltaLatencyMs,
    evidence.deltaSteps,
  ].filter((value): value is number => value !== null);
  const lower = deltas.some((value) => value < -Number.EPSILON);
  const higher = deltas.some((value) => value > Number.EPSILON);
  if (lower && !higher) {
    return {
      value: "improved",
      reason: "Outcome and output match while every changed measured resource is lower.",
    };
  }
  if (higher && !lower) {
    return {
      value: "regressed",
      reason: "Outcome and output match while every changed measured resource is higher.",
    };
  }
  if (!lower && !higher) {
    return {
      value: "unchanged",
      reason: "Outcome, output, and all recorded resource measures are unchanged.",
    };
  }
  return {
    value: "not_verifiable",
    reason: "Recorded resource deltas conflict, so no overall direction is defensible.",
  };
}

function validBranchPoint(original: RunGraph, fork: RunGraph): number | undefined {
  const point = fork.run.forkPoint;
  return fork.run.forkOf === original.run.traceId &&
    Number.isInteger(point) &&
    (point as number) >= 0 &&
    original.steps.some((step) => step.index === point) &&
    fork.steps.some((step) => step.index === point)
    ? point
    : undefined;
}

interface RunMetrics {
  tokens: number | null;
  cost: number | null;
  duration: number;
  steps: number;
}

function metrics(graph: RunGraph, branchPoint: number | undefined): RunMetrics {
  if (branchPoint === undefined) {
    return {
      tokens: graph.run.totalTokens,
      cost: graph.run.costUsd,
      duration: latencyMs(graph.run),
      steps: graph.run.stepCount,
    };
  }
  const steps = graph.steps.filter((step) => step.index >= branchPoint);
  const llmSteps = steps.filter((step) => step.kind === "llm");
  return {
    tokens: llmSteps.some(
      (step) => step.inputTokens === undefined && step.outputTokens === undefined,
    )
      ? null
      : llmSteps.reduce(
          (total, step) => total + (step.inputTokens ?? 0) + (step.outputTokens ?? 0),
          0,
        ),
    cost: steps.some((step) => step.costUsd === null)
      ? null
      : steps.reduce((total, step) => total + (step.costUsd ?? 0), 0),
    duration: steps.reduce((total, step) => total + step.latencyMs, 0),
    steps: steps.length,
  };
}

function subtract(a: number | null, b: number | null): number | null {
  return a === null || b === null ? null : a - b;
}

function compareFields(
  original: RunStep | undefined,
  fork: RunStep | undefined,
): FieldComparison[] {
  const fields: FieldComparison["field"][] = [
    "prompt",
    "model",
    "params",
    "tool",
    "output",
    "tokens",
    "duration",
    "cost",
  ];
  return fields.flatMap((field) => {
    const a = fieldValue(original, field);
    const b = fieldValue(fork, field);
    if (!a && !b) return [];
    return [{
      field,
      status: !a ? "added" : !b ? "removed" : a.key === b.key ? "same" : "changed",
      ...(a ? { original: a.display } : {}),
      ...(b ? { fork: b.display } : {}),
    }];
  });
}

function fieldValue(
  step: RunStep | undefined,
  field: FieldComparison["field"],
): { key: string; display: string | number } | undefined {
  if (!step) return undefined;
  let value: unknown;
  switch (field) {
    case "prompt":
      if (step.systemPrompt === undefined && step.requestMessages === undefined) return undefined;
      value = { system: step.systemPrompt, messages: step.requestMessages };
      break;
    case "model":
      value = step.model;
      break;
    case "params":
      if (step.temperature === undefined && step.maxTokens === undefined) return undefined;
      value = { temperature: step.temperature, maxTokens: step.maxTokens };
      break;
    case "tool":
      if (step.kind !== "tool") return undefined;
      value = {
        name: step.toolName ?? step.name,
        args: step.args ?? step.argsHash,
      };
      break;
    case "output":
      value = step.kind === "tool" ? step.toolOutput : step.response;
      break;
    case "tokens":
      if (step.inputTokens === undefined && step.outputTokens === undefined) return undefined;
      value = (step.inputTokens ?? 0) + (step.outputTokens ?? 0);
      break;
    case "duration":
      value = step.latencyMs;
      break;
    case "cost":
      value = step.costUsd ?? undefined;
      break;
  }
  if (value === undefined) return undefined;
  const key = stableStringify(value);
  return {
    key,
    display: typeof value === "number" ? value : truncate(key),
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
  const value = last.kind === "tool" ? last.toolOutput : last.response;
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value, null, 2);
}

function latencyMs(run: RunGraph["run"]): number {
  if (!run.endTime) return 0;
  return Date.parse(run.endTime) - Date.parse(run.startTime);
}

function truncate(value: string): string {
  return value.length > 160 ? `${value.slice(0, 157)}...` : value;
}

function stableStringify(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .filter((key) => record[key] !== undefined)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`)
    .join(",")}}`;
}
