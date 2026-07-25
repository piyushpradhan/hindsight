import assert from "node:assert/strict";
import { test } from "node:test";
import { createOpenAiCompatProvider } from "./openai-provider.js";
import type { LlmRequest } from "./types.js";

const TOOLS = [
  { name: "list_tasks", description: "list" },
  { name: "create_task", description: "create" },
];

function reply(content: string, status = 200): typeof fetch {
  return (async () =>
    new Response(
      JSON.stringify({
        model: "gpt-oss-120b",
        choices: [{ message: { content } }],
        usage: { prompt_tokens: 11, completion_tokens: 7 },
      }),
      { status, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
}

function request(overrides: Partial<LlmRequest> = {}): LlmRequest {
  return {
    model: "gpt-oss-120b",
    system: "You are a task agent.",
    tools: TOOLS,
    messages: [{ role: "user", content: "Buy milk tomorrow" }],
    ...overrides,
  } as LlmRequest;
}

test("first step probes list_tasks without calling the network", async () => {
  let called = false;
  const provider = createOpenAiCompatProvider(
    { apiKey: "k" },
    (async () => {
      called = true;
      return new Response("{}");
    }) as unknown as typeof fetch,
  );
  const completion = await provider.create(request());
  assert.equal(called, false, "step 0 must not hit the provider");
  assert.equal(completion.toolCalls?.[0]?.name, "list_tasks");
  assert.equal(completion.stopReason, "tool_use");
});

test("provider name is derived from the base URL host", () => {
  assert.equal(createOpenAiCompatProvider({ apiKey: "k" }).name, "cerebras");
  assert.equal(
    createOpenAiCompatProvider({ apiKey: "k", baseUrl: "https://api.groq.com/openai/v1" }).name,
    "groq",
  );
  assert.equal(createOpenAiCompatProvider({ apiKey: "k", name: "custom" }).name, "custom");
});

test("a JSON action is parsed into a create_task tool call", async () => {
  const provider = createOpenAiCompatProvider(
    { apiKey: "k" },
    reply(JSON.stringify({ tool: "create_task", args: { title: "Buy milk", priority: "low" } })),
  );
  const completion = await provider.create(
    request({
      messages: [
        { role: "user", content: "Buy milk tomorrow" },
        { role: "tool", content: { name: "list_tasks", output: [] } },
      ],
    } as Partial<LlmRequest>),
  );
  assert.equal(completion.toolCalls?.length, 1);
  assert.equal(completion.toolCalls?.[0]?.name, "create_task");
  assert.deepEqual(completion.toolCalls?.[0]?.args, { title: "Buy milk", priority: "low" });
  assert.equal(completion.usage?.input_tokens, 11);
  assert.equal(completion.usage?.output_tokens, 7);
});

test("a response that is not a valid action fails loudly instead of silently finishing", async () => {
  const provider = createOpenAiCompatProvider({ apiKey: "k" }, reply('{"final":"I gave up"}'));
  await assert.rejects(
    provider.create(
      request({
        messages: [
          { role: "user", content: "Buy milk" },
          { role: "tool", content: { name: "list_tasks", output: [] } },
        ],
      } as Partial<LlmRequest>),
    ),
    /did not return a valid create_task JSON action/,
  );
});

test("no tools array is sent and tool results are folded into user turns", async () => {
  let body: Record<string, unknown> = {};
  const provider = createOpenAiCompatProvider(
    { apiKey: "k" },
    (async (_url: string, init: RequestInit) => {
      body = JSON.parse(String(init.body));
      return new Response(
        JSON.stringify({ choices: [{ message: { content: '{"final":"done"}' } }] }),
      );
    }) as unknown as typeof fetch,
  );
  await provider.create(
    request({
      tools: undefined,
      messages: [
        { role: "user", content: "Buy milk" },
        { role: "tool", content: { name: "create_task", output: { id: 1 } } },
      ],
    } as Partial<LlmRequest>),
  );
  assert.equal(body.tools, undefined, "tools must never be sent; several vendors reject it");
  assert.deepEqual(body.response_format, { type: "json_object" });
  const messages = body.messages as Array<{ role: string; content: string }>;
  assert.ok(!messages.some((message) => message.role === "tool"), "no bare tool role messages");
  assert.ok(messages.some((message) => message.content.includes("Result of create_task")));
});

test("an error response never echoes the API key", async () => {
  const provider = createOpenAiCompatProvider(
    { apiKey: "csk-SECRET" },
    (async () =>
      new Response("invalid key csk-SECRET supplied", { status: 401 })) as unknown as typeof fetch,
  );
  await assert.rejects(
    provider.create(
      request({
        messages: [
          { role: "user", content: "Buy milk" },
          { role: "tool", content: { name: "list_tasks", output: [] } },
        ],
      } as Partial<LlmRequest>),
    ),
    (error: Error) => {
      assert.ok(!error.message.includes("csk-SECRET"), "key must be redacted from errors");
      assert.match(error.message, /\*\*\*/);
      return true;
    },
  );
});
