import type { ReplayResult, RunGraph } from "@hindsight/shared";

export class IncompleteRecordError extends Error {
  constructor(readonly graph: RunGraph) {
    super(
      graph.checkpoint?.issues.map((issue) => issue.detail).join("; ") ??
        "checkpoint report is missing",
    );
    this.name = "IncompleteRecordError";
  }
}

/** Playback is deliberately data-only: no provider or tool seam exists here. */
export function replayRun(graph: RunGraph): ReplayResult {
  if (!graph.checkpoint?.complete) throw new IncompleteRecordError(graph);
  return {
    traceId: graph.run.traceId,
    checkpoint: structuredClone(graph.checkpoint),
    steps: structuredClone(graph.steps),
    liveCalls: 0,
  };
}
