import {
  type ChatMessage,
  type Mutation,
  type RunnerForkRequest,
  type RunnerForkResponse,
  type RunStep,
} from "@hindsight/shared";
import { createRecorder, hashToolArgs, type Recorder } from "@hindsight/recorder";
import { runAgent } from "./agent-loop.js";
import { AGENTS } from "./agents.js";
import { createAnthropicHttpProvider } from "./anthropic-provider.js";
import { createMockProvider, type PlanStep } from "./mock-provider.js";
import { isSafe } from "./tools.js";
import type { Completion, Provider, ToolCall } from "./types.js";

export const SUPPORTED_MUTATIONS: Mutation["type"][] = [
  "model_swap",
  "prompt_edit",
  "tool_output_override",
  "params",
];

export interface DemoRunnerOptions {
  otlpHttpUrl: string;
  anthropicApiKey?: string;
  anthropicBaseUrl?: string;
  recorderFactory?: () => Recorder;
}

export async function executeRunnerFork(
  request: RunnerForkRequest,
  options: DemoRunnerOptions,
): Promise<RunnerForkResponse> {
  const spec = AGENTS[request.checkpoint.agentId];
  if (!spec) throw new Error(`unsupported agent: ${request.checkpoint.agentId}`);
  if (request.checkpoint.agentRevision !== spec.revision) {
    throw new Error(
      `runner revision ${spec.revision} does not match recording ${request.checkpoint.agentRevision}`,
    );
  }
  if (!SUPPORTED_MUTATIONS.includes(request.mutation.type)) {
    throw new Error(`unsupported mutation: ${request.mutation.type}`);
  }
  if (hashToolArgs(request.mutation) !== request.mutationHash) {
    throw new Error("mutation hash does not match mutation body");
  }

  const steps = [...request.checkpoint.steps].sort((a, b) => a.index - b.index);
  const branchStep = steps.find((step) => step.index === request.checkpoint.forkAtStep);
  if (!branchStep) throw new Error(`fork step ${request.checkpoint.forkAtStep} is missing`);
  if (
    request.mutation.type === "tool_output_override" &&
    (branchStep.kind !== "tool" ||
      request.mutation.stepIndex !== request.checkpoint.forkAtStep)
  ) {
    throw new Error("tool override must target the tool fork point");
  }
  const initialMessages = messagesBefore(steps, request.checkpoint.forkAtStep);
  const pendingToolCalls =
    branchStep.kind === "tool" ? [toolCallFor(branchStep)] : undefined;
  const llm =
    steps.find(
      (step) => step.kind === "llm" && step.index >= request.checkpoint.forkAtStep,
    ) ??
    [...steps].reverse().find((step) => step.kind === "llm");
  if (!llm) throw new Error("checkpoint has no LLM request");

  let model = llm.model;
  let system = llm.systemPrompt;
  let temperature = llm.temperature;
  let maxTokens = llm.maxTokens;
  switch (request.mutation.type) {
    case "model_swap":
      model = request.mutation.model;
      break;
    case "prompt_edit":
      system = request.mutation.newSystemPrompt;
      break;
    case "params":
      temperature = request.mutation.temperature ?? temperature;
      maxTokens = request.mutation.maxTokens ?? maxTokens;
      break;
    case "tool_output_override":
      break;
    case "disable_tool":
      throw new Error("disable_tool is not supported by the reference runner");
  }

  const recorder =
    options.recorderFactory?.() ??
    createRecorder({
      otlpHttpUrl: options.otlpHttpUrl,
      recordPayloads: "always",
      payloadMode: "redacted",
      serviceName: "hindsight-demo-runner",
      register: false,
    });
  try {
    const result = await runAgent({
      agentId: spec.agentId,
      agentRevision: spec.revision,
      recorder,
      provider: providerFor(
        llm.provider,
        options.anthropicApiKey,
        options.anthropicBaseUrl,
      ),
      tools: spec.tools,
      system,
      model,
      temperature,
      maxTokens,
      initialMessages,
      pendingToolCalls,
      startStepIndex: request.checkpoint.forkAtStep,
      plan: recordedPlan(steps),
      toolResolver: recordedToolResolver(request, steps, spec.tools),
      fork: {
        of: request.checkpoint.originalTraceId,
        point: request.checkpoint.forkAtStep,
        mutation: request.mutation,
        mutationHash: request.mutationHash,
        incidentId: request.incidentId,
        originalSpanContext: {
          traceId: request.checkpoint.originalTraceId,
          spanId: request.checkpoint.originalSpanId,
          traceFlags: 1,
          isRemote: true,
        },
      },
    });
    return {
      forkRunId: result.runId,
      forkTraceId: result.traceId,
      outcome: result.outcome,
      stepCount: result.steps,
      runnerRevision: spec.revision,
      appliedMutationHash: request.mutationHash,
      error: result.error,
    };
  } finally {
    await recorder.shutdown();
  }
}

function providerFor(
  name: string | undefined,
  anthropicApiKey: string | undefined,
  anthropicBaseUrl?: string,
): Provider {
  if (!name || name === "mock") return createMockProvider({ seed: 0 });
  if (name === "anthropic") {
    if (!anthropicApiKey) throw new Error("ANTHROPIC_API_KEY is required for this recording");
    return createAnthropicHttpProvider(anthropicApiKey, anthropicBaseUrl);
  }
  throw new Error(`unsupported recorded provider: ${name}`);
}

function messagesBefore(steps: RunStep[], forkAtStep: number): ChatMessage[] {
  const firstLlm = steps.find((step) => step.kind === "llm" && step.requestMessages);
  if (!firstLlm?.requestMessages) throw new Error("first LLM request messages are missing");
  const messages = structuredClone(firstLlm.requestMessages);
  for (const step of steps) {
    if (step.index < firstLlm.index || step.index >= forkAtStep) continue;
    if (step.kind === "llm") {
      const completion = asCompletion(step.response);
      messages.push({
        role: "assistant",
        content: { text: completion.content, toolCalls: completion.toolCalls },
      });
    } else {
      messages.push({
        role: "tool",
        content: {
          toolCallId: step.toolCallId,
          name: step.toolName ?? step.name,
          output: step.toolOutput,
        },
      });
    }
  }
  return messages;
}

function toolCallFor(step: RunStep): ToolCall {
  if (!step.toolCallId) throw new Error(`tool step ${step.index} has no tool-call id`);
  if (step.args === undefined) throw new Error(`tool step ${step.index} has no arguments`);
  return {
    id: step.toolCallId,
    name: step.toolName ?? step.name,
    args: asArgs(step.args),
  };
}

function recordedPlan(steps: RunStep[]): PlanStep[] {
  const plan: PlanStep[] = steps
    .filter((step) => step.kind === "tool")
    .map((step) => ({
      kind: "tool",
      name: step.toolName ?? step.name,
      args: asArgs(step.args),
    }));
  const lastLlm = [...steps].reverse().find((step) => step.kind === "llm");
  if (lastLlm) {
    const completion = asCompletion(lastLlm.response);
    if (completion.stopReason === "end") {
      plan.push({ kind: "final", content: completion.content });
    }
  }
  return plan;
}

function recordedToolResolver(
  request: RunnerForkRequest,
  steps: RunStep[],
  tools: (typeof AGENTS)[string]["tools"],
): (name: string, args: Record<string, unknown>) => unknown {
  const queues = new Map<string, RunStep[]>();
  for (const step of steps) {
    if (step.kind !== "tool" || step.index < request.checkpoint.forkAtStep) continue;
    const key = toolKey(step.toolName ?? step.name, step.args);
    const queue = queues.get(key) ?? [];
    queue.push(step);
    queues.set(key, queue);
  }
  return (name, args) => {
    const queue = queues.get(toolKey(name, args));
    const recorded = queue?.shift();
    if (
      request.mutation.type === "tool_output_override" &&
      recorded?.index === request.mutation.stepIndex
    ) {
      return request.mutation.output;
    }
    if (recorded) {
      if (recorded.error) {
        const error = new Error(`recorded failure: ${recorded.error}`);
        error.name = recorded.error;
        throw error;
      }
      return recorded.toolOutput;
    }
    if (request.mockPolicy === "strict") {
      throw new Error(`strict mock policy: no exact recording for tool "${name}"`);
    }
    if (!isSafe(tools, name)) {
      throw new Error(`side-effectful tool "${name}" cannot run live`);
    }
    return undefined;
  };
}

function toolKey(name: string, args: unknown): string {
  return `${name}\0${hashToolArgs(args)}`;
}

function asCompletion(value: unknown): Completion {
  if (!value || typeof value !== "object") {
    return {
      id: "recorded",
      model: "",
      content: typeof value === "string" ? value : "",
      toolCalls: [],
      stopReason: "end",
      usage: { input_tokens: 0, output_tokens: 0 },
    };
  }
  const response = value as Partial<Completion>;
  return {
    id: typeof response.id === "string" ? response.id : "recorded",
    model: typeof response.model === "string" ? response.model : "",
    content: typeof response.content === "string" ? response.content : "",
    toolCalls: Array.isArray(response.toolCalls) ? response.toolCalls : [],
    stopReason: response.stopReason === "tool_use" ? "tool_use" : "end",
    usage: response.usage ?? { input_tokens: 0, output_tokens: 0 },
  };
}

function asArgs(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
