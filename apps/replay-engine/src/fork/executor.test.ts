import assert from "node:assert/strict";
import { createServer } from "node:http";
import { test } from "node:test";
import type { ForkRequest, RunnerForkRequest } from "@hindsight/shared";
import {
  ForkExecutionError,
  HttpForkExecutor,
  type SignozReader,
} from "./executor.js";
import {
  TRACE_ID,
  fixturePayloadLogs,
  fixtureSpans,
} from "../rungraph/builder.test-fixture.js";

const FORK_TRACE = "22222222222222222222222222222222";

test("HTTP runner receives a complete checkpoint and idempotent retries run once", async (t) => {
  let posts = 0;
  let received: RunnerForkRequest | undefined;
  const server = createServer(async (request, response) => {
    if (request.url === "/hindsight/capabilities") {
      response.setHeader("content-type", "application/json");
      response.end(
        JSON.stringify({
          runners: [
            {
              agentId: "agent-1",
              revision: "agent-1@abc123",
              available: true,
              mutations: ["model_swap", "tool_output_override", "prompt_edit", "params"],
              safeLiveTools: [],
            },
          ],
        }),
      );
      return;
    }
    posts++;
    received = JSON.parse(await body(request)) as RunnerForkRequest;
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        forkRunId: "fork-run",
        forkTraceId: FORK_TRACE,
        outcome: "success",
        stepCount: 2,
        runnerRevision: "agent-1@abc123",
        appliedMutationHash: received.mutationHash,
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");

  const executor = new HttpForkExecutor(reader(), {
    runners: {
      "agent-1": {
        url: `http://127.0.0.1:${address.port}`,
        revision: "agent-1@abc123",
      },
    },
    timeoutMs: 2_000,
  });
  const request = {
    traceId: TRACE_ID,
    forkAtStep: 0,
    mutation: { type: "model_swap" as const, model: "claude-sonnet-4-5" },
    mockPolicy: "strict" as const,
    idempotencyKey: "same-request",
  };
  const first = await executor.execute(request);
  const second = await executor.execute(request);

  assert.equal(posts, 1);
  assert.deepEqual(second, first);
  assert.equal(first.forkTraceId, FORK_TRACE);
  assert.equal(received?.checkpoint.originalSpanId, "root01");
  assert.equal(received?.checkpoint.steps.length, 4);
  assert.equal(received?.checkpoint.agentRevision, "agent-1@abc123");
});

test("missing payload fails closed before a runner is contacted", async () => {
  const executor = new HttpForkExecutor(reader(fixturePayloadLogs().slice(1)), {
    runners: {},
    timeoutMs: 100,
  });
  await assert.rejects(
    executor.execute({
      traceId: TRACE_ID,
      forkAtStep: 0,
      mutation: { type: "model_swap", model: "claude-sonnet-4-5" },
      mockPolicy: "strict",
    }),
    (error: unknown) =>
      error instanceof ForkExecutionError &&
      error.code === "incomplete_record" &&
      /step 0/.test(error.message),
  );
});

test("nonexistent tool-output target is rejected", async (t) => {
  const server = createServer((_request, response) => {
    response.setHeader("content-type", "application/json");
    response.end(
      JSON.stringify({
        runners: [
          {
            agentId: "agent-1",
            revision: "agent-1@abc123",
            available: true,
            mutations: ["tool_output_override"],
            safeLiveTools: [],
          },
        ],
      }),
    );
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const executor = new HttpForkExecutor(reader(), {
    runners: {
      "agent-1": {
        url: `http://127.0.0.1:${address.port}`,
        revision: "agent-1@abc123",
      },
    },
    timeoutMs: 1_000,
  });
  await assert.rejects(
    executor.execute({
      traceId: TRACE_ID,
      forkAtStep: 99,
      mutation: { type: "tool_output_override", stepIndex: 99, output: "fixed" },
      mockPolicy: "strict",
    }),
    (error: unknown) =>
      error instanceof ForkExecutionError && error.code === "invalid_mutation_target",
  );
});

test("no-op mutations are rejected before contacting the runner", async () => {
  const executor = new HttpForkExecutor(reader(), {
    runners: {
      "agent-1": {
        url: "http://127.0.0.1:1",
        revision: "agent-1@abc123",
      },
    },
    timeoutMs: 100,
  });
  const noOps: ForkRequest["mutation"][] = [
    { type: "model_swap", model: "gpt-4o" },
    { type: "prompt_edit", newSystemPrompt: "You are a demo agent." },
    { type: "params", temperature: 0.2, maxTokens: 512 },
    {
      type: "tool_output_override",
      stepIndex: 1,
      output: ["result-1", "result-2"],
    },
  ];
  for (const mutation of noOps) {
    await assert.rejects(
      executor.execute({
        traceId: TRACE_ID,
        forkAtStep: mutation.type === "tool_output_override" ? 1 : 0,
        mutation,
        mockPolicy: "strict",
        idempotencyKey: `no-op-${mutation.type}`,
      }),
      (error: unknown) =>
        error instanceof ForkExecutionError &&
        error.code === "invalid_mutation_target",
    );
  }
});

function reader(logs = fixturePayloadLogs()): SignozReader {
  return {
    async getSpansForTrace() {
      return fixtureSpans();
    },
    async getPayloadLogs() {
      return logs;
    },
  };
}

async function body(request: import("node:http").IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks).toString("utf8");
}
