import { randomUUID } from "node:crypto";
import {
  HINDSIGHT_SCHEMA_VERSION,
  type Capabilities,
  type ForkRequest,
  type ForkResult,
  type ForkRunnerCapability,
  type Mutation,
  type RunnerForkRequest,
  type RunnerForkResponse,
} from "@hindsight/shared";
import { hashToolArgs } from "@hindsight/recorder";
import type { RunnerConfig } from "../config.js";
import {
  buildRunGraph,
  type PayloadLogInput,
  type SpanInput,
} from "../rungraph/builder.js";
import type { ForkExecutor } from "../routes.js";

export interface SignozReader {
  getSpansForTrace(traceId: string): Promise<SpanInput[]>;
  getPayloadLogs(traceId: string): Promise<PayloadLogInput[]>;
}

export type ForkExecutionErrorCode =
  | "original_not_found"
  | "incomplete_record"
  | "runner_unavailable"
  | "unsupported_mutation"
  | "invalid_mutation_target"
  | "runner_rejected"
  | "runner_timeout"
  | "runner_protocol_error"
  | "idempotency_conflict";

export class ForkExecutionError extends Error {
  constructor(
    readonly code: ForkExecutionErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ForkExecutionError";
  }
}

interface IdempotentExecution {
  requestHash: string;
  result: Promise<ForkResult>;
}

export class HttpForkExecutor implements ForkExecutor {
  private readonly executions = new Map<string, IdempotentExecution>();

  constructor(
    private readonly signoz: SignozReader,
    private readonly options: {
      runners: Record<string, RunnerConfig>;
      timeoutMs: number;
    },
  ) {}

  async capabilities(): Promise<Capabilities> {
    const runners = await Promise.all(
      Object.entries(this.options.runners).map(([agentId, runner]) =>
        this.runnerCapability(agentId, runner),
      ),
    );
    return {
      schemaVersion: HINDSIGHT_SCHEMA_VERSION,
      liveSideEffects: false,
      runners,
    };
  }

  execute(request: ForkRequest): Promise<ForkResult> {
    const idempotencyKey = request.idempotencyKey?.trim() || randomUUID();
    const requestHash = hashToolArgs({ ...request, idempotencyKey: undefined });
    const existing = this.executions.get(idempotencyKey);
    if (existing) {
      if (existing.requestHash !== requestHash) {
        throw new ForkExecutionError(
          "idempotency_conflict",
          "idempotency key was already used for a different fork",
          409,
        );
      }
      return existing.result;
    }

    const result = this.executeOnce({ ...request, idempotencyKey });
    this.executions.set(idempotencyKey, { requestHash, result });
    if (this.executions.size > 1_000) {
      this.executions.delete(this.executions.keys().next().value as string);
    }
    return result;
  }

  private async executeOnce(request: ForkRequest & { idempotencyKey: string }): Promise<ForkResult> {
    const spans = await this.signoz.getSpansForTrace(request.traceId);
    if (spans.length === 0) {
      throw new ForkExecutionError(
        "original_not_found",
        `original trace ${request.traceId} was not found`,
        404,
      );
    }
    const graph = buildRunGraph(
      request.traceId,
      spans,
      await this.signoz.getPayloadLogs(request.traceId),
    );
    if (!graph.checkpoint?.complete || !graph.run.agentRevision || !graph.run.schemaVersion) {
      throw new ForkExecutionError(
        "incomplete_record",
        graph.checkpoint?.issues.map((issue) => issue.detail).join("; ") ??
          "checkpoint report is missing",
        409,
      );
    }
    const registration = this.options.runners[graph.run.agentId];
    if (!registration) {
      throw new ForkExecutionError(
        "runner_unavailable",
        `no runner is registered for ${graph.run.agentId}`,
        503,
      );
    }
    if (registration.revision !== graph.run.agentRevision) {
      throw new ForkExecutionError(
        "runner_unavailable",
        `registered revision ${registration.revision} does not match recording ${graph.run.agentRevision}`,
        409,
      );
    }
    validateMutationTarget(request, graph.steps);
    const capability = await this.runnerCapability(graph.run.agentId, registration);
    if (!capability.available) {
      throw new ForkExecutionError(
        "runner_unavailable",
        `runner for ${graph.run.agentId} is unavailable`,
        503,
      );
    }
    if (!capability.mutations.includes(request.mutation.type)) {
      throw new ForkExecutionError(
        "unsupported_mutation",
        `runner does not support ${request.mutation.type}`,
        422,
      );
    }
    const root =
      spans.find((span) => !span.parentSpanId) ??
      spans.find((span) => span.attributes["hindsight.run.outcome"] !== undefined);
    if (!root) {
      throw new ForkExecutionError(
        "incomplete_record",
        "original root span is missing",
        409,
      );
    }
    const mutationHash = hashToolArgs(request.mutation);
    const runnerRequest: RunnerForkRequest = {
      idempotencyKey: request.idempotencyKey,
      incidentId: request.incidentId,
      mutation: request.mutation,
      mutationHash,
      mockPolicy: request.mockPolicy,
      checkpoint: {
        schemaVersion: graph.run.schemaVersion,
        originalTraceId: request.traceId,
        originalSpanId: root.spanId,
        runId: graph.run.runId,
        agentId: graph.run.agentId,
        agentRevision: graph.run.agentRevision,
        forkAtStep: request.forkAtStep,
        steps: graph.steps,
      },
    };
    const response = await this.callRunner(registration, runnerRequest);
    if (
      response.runnerRevision !== registration.revision ||
      response.appliedMutationHash !== mutationHash
    ) {
      throw new ForkExecutionError(
        "runner_protocol_error",
        "runner did not confirm the requested revision and mutation",
        502,
      );
    }
    return {
      forkRunId: response.forkRunId,
      forkTraceId: response.forkTraceId,
      originalTraceId: request.traceId,
      outcome: response.outcome,
      stepCount: response.stepCount,
      mutation: request.mutation,
      mutationHash,
      runnerRevision: response.runnerRevision,
      checkpoint: graph.checkpoint,
      idempotencyKey: request.idempotencyKey,
      error: response.error,
    };
  }

  private async runnerCapability(
    agentId: string,
    registration: RunnerConfig,
  ): Promise<ForkRunnerCapability> {
    try {
      const response = await fetch(`${registration.url}/hindsight/capabilities`, {
        headers: runnerHeaders(registration),
        signal: AbortSignal.timeout(Math.min(this.options.timeoutMs, 2_000)),
      });
      if (!response.ok) throw new Error(`status ${response.status}`);
      const body = (await response.json()) as { runners?: ForkRunnerCapability[] };
      const capability = body.runners?.find((candidate) => candidate.agentId === agentId);
      if (!capability || capability.revision !== registration.revision) {
        throw new Error("agent or revision missing from capability response");
      }
      return { ...capability, available: true };
    } catch {
      return {
        agentId,
        revision: registration.revision,
        available: false,
        mutations: [],
        safeLiveTools: [],
      };
    }
  }

  private async callRunner(
    registration: RunnerConfig,
    request: RunnerForkRequest,
  ): Promise<RunnerForkResponse> {
    let response: Response;
    try {
      response = await fetch(`${registration.url}/hindsight/forks`, {
        method: "POST",
        headers: {
          ...runnerHeaders(registration),
          "content-type": "application/json",
          "idempotency-key": request.idempotencyKey,
        },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(this.options.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === "TimeoutError") {
        throw new ForkExecutionError("runner_timeout", "runner request timed out", 504);
      }
      throw new ForkExecutionError(
        "runner_unavailable",
        `runner request failed: ${error instanceof Error ? error.message : String(error)}`,
        503,
      );
    }
    if (!response.ok) {
      const body = (await response.text()).slice(0, 500);
      throw new ForkExecutionError(
        "runner_rejected",
        `runner returned ${response.status}: ${body}`,
        422,
      );
    }
    const body = (await response.json()) as Partial<RunnerForkResponse>;
    if (
      typeof body.forkRunId !== "string" ||
      !/^[0-9a-f]{32}$/i.test(body.forkTraceId ?? "") ||
      (body.outcome !== "success" && body.outcome !== "failure" && body.outcome !== "timeout") ||
      typeof body.stepCount !== "number" ||
      typeof body.runnerRevision !== "string" ||
      typeof body.appliedMutationHash !== "string"
    ) {
      throw new ForkExecutionError(
        "runner_protocol_error",
        "runner returned an invalid response",
        502,
      );
    }
    return body as RunnerForkResponse;
  }
}

function validateMutationTarget(
  request: ForkRequest,
  steps: RunnerForkRequest["checkpoint"]["steps"],
): void {
  const branch = steps.find((step) => step.index === request.forkAtStep);
  if (!branch) {
    throw new ForkExecutionError(
      "invalid_mutation_target",
      `fork step ${request.forkAtStep} does not exist`,
      422,
    );
  }
  const mutation = request.mutation;
  switch (mutation.type) {
    case "tool_output_override": {
      const target = steps.find((step) => step.index === mutation.stepIndex);
      if (!target || target.kind !== "tool" || mutation.stepIndex !== request.forkAtStep) {
        throw new ForkExecutionError(
          "invalid_mutation_target",
          "tool override must target the tool step used as the fork point",
          422,
        );
      }
      if (hashToolArgs(target.toolOutput) === hashToolArgs(mutation.output)) {
        throw new ForkExecutionError(
          "invalid_mutation_target",
          "tool override must change the recorded tool output",
          422,
        );
      }
      break;
    }
    case "model_swap": {
      const current = nextLlm(steps, request.forkAtStep)?.model;
      if (!current || current === mutation.model) {
        throw new ForkExecutionError(
          "invalid_mutation_target",
          "model swap must change the next recorded model",
          422,
        );
      }
      break;
    }
    case "prompt_edit": {
      const current = nextLlm(steps, request.forkAtStep)?.systemPrompt;
      if (current === undefined || current === mutation.newSystemPrompt) {
        throw new ForkExecutionError(
          "invalid_mutation_target",
          "prompt edit requires a different recorded system prompt",
          422,
        );
      }
      break;
    }
    case "params": {
      if (
        mutation.temperature !== undefined &&
        (!Number.isFinite(mutation.temperature) ||
          mutation.temperature < 0 ||
          mutation.temperature > 2)
      ) {
        throw new ForkExecutionError(
          "invalid_mutation_target",
          "temperature must be between 0 and 2",
          422,
        );
      }
      if (
        mutation.maxTokens !== undefined &&
        (!Number.isInteger(mutation.maxTokens) || mutation.maxTokens <= 0)
      ) {
        throw new ForkExecutionError(
          "invalid_mutation_target",
          "maxTokens must be a positive integer",
          422,
        );
      }
      const current = nextLlm(steps, request.forkAtStep);
      if (
        !current ||
        (mutation.temperature === undefined && mutation.maxTokens === undefined) ||
        (mutation.temperature === undefined || mutation.temperature === current.temperature) &&
          (mutation.maxTokens === undefined || mutation.maxTokens === current.maxTokens)
      ) {
        throw new ForkExecutionError(
          "invalid_mutation_target",
          "parameter mutation must change the next LLM request",
          422,
        );
      }
      break;
    }
    case "disable_tool":
      throw new ForkExecutionError(
        "unsupported_mutation",
        "disable_tool is not supported in v1",
        422,
      );
  }
}

function nextLlm(
  steps: RunnerForkRequest["checkpoint"]["steps"],
  forkAtStep: number,
) {
  return steps.find((step) => step.kind === "llm" && step.index >= forkAtStep);
}

function runnerHeaders(registration: RunnerConfig): Record<string, string> {
  return registration.secret ? { authorization: `Bearer ${registration.secret}` } : {};
}
