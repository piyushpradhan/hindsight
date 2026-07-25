/**
 * Public surface of @hindsight/demo-agents. The fork executor imports the mock
 * provider, tool registry, and the resumable agent loop from here rather than
 * reimplementing them.
 */

// Core types.
export type {
  ChatMessage,
  Completion,
  LlmRequest,
  Provider,
  ToolCall,
  ToolDef,
  ToolEffect,
  ToolRegistry,
} from "./types.js";

// Deterministic mock LLM provider (messages + seed + temperature → completion).
export { createMockProvider } from "./mock-provider.js";
export type { MockProviderOptions, MockLlmRequest, PlanStep } from "./mock-provider.js";

// Tool registry / implementations, keyed by name, flagged safe vs side-effectful.
export {
  RESEARCH_TOOLS,
  SUPPORT_TOOLS,
  CODEX_TOOLS,
  ALL_TOOLS,
  index as indexTools,
  isSafe,
} from "./tools.js";

// Resumable agent loop.
export { runAgent } from "./agent-loop.js";
export type { RunAgentOptions, AgentResult } from "./agent-loop.js";

// Agents + convenience runner.
export {
  RESEARCH_AGENT,
  SUPPORT_AGENT,
  CODEX_AGENT,
  TODO_AGENT,
  AGENTS,
  runAgentSpec,
} from "./agents.js";
export type { AgentSpec, RunSpecOptions } from "./agents.js";

// Chaos.
export {
  CHAOS_MODES,
  parseChaos,
  MalformedToolJsonError,
  ToolTimeoutError,
} from "./chaos.js";
export type { ChaosMode } from "./chaos.js";

export {
  TODO_TOOLS,
  buildTodoPlan,
  listTodoTasks,
  resetTodoTasks,
  toggleTodoTask,
} from "./todo.js";
export type { TodoTask } from "./todo.js";

// Optional real-provider seam.
export {
  createAnthropicHttpProvider,
  createAnthropicProvider,
  anthropicAvailable,
} from "./anthropic-provider.js";
export type { AnthropicLike } from "./anthropic-provider.js";

export { createOllamaProvider } from "./ollama-provider.js";

export {
  createOpenAiCompatProvider,
  CEREBRAS_BASE_URL,
  CEREBRAS_DEFAULT_MODEL,
} from "./openai-provider.js";
export type { OpenAiCompatOptions } from "./openai-provider.js";

export { executeRunnerFork, SUPPORTED_MUTATIONS } from "./fork-runner.js";
export type { DemoRunnerOptions } from "./fork-runner.js";
