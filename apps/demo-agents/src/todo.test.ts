import assert from "node:assert/strict";
import { test } from "node:test";
import { buildTodoPlan, listTodoTasks, resetTodoTasks, TODO_TOOLS, toggleTodoTask } from "./todo.js";
import { createOllamaProvider } from "./ollama-provider.js";

test("todo agent creates, lists, toggles, and rejects invalid priorities", async () => {
  resetTodoTasks();
  const plan = buildTodoPlan("Remind me to prepare demo slides tomorrow with high priority");
  const create = plan[1];
  assert.equal(create.kind, "tool");
  if (create.kind !== "tool") return;
  const result = await TODO_TOOLS.create_task.run(create.args);
  assert.equal((result as { created: { priority: string } }).created.priority, "high");
  assert.equal(listTodoTasks().length, 1);
  assert.equal(toggleTodoTask(1)?.done, true);

  const failure = buildTodoPlan("Create a broken task", true)[1];
  assert.equal(failure.kind, "tool");
  if (failure.kind !== "tool") return;
  await assert.rejects(() => TODO_TOOLS.create_task.run(failure.args), {
    name: "InvalidPriorityError",
  });
});

test("Ollama responses map tool calls and token usage into the agent provider contract", async () => {
  const provider = createOllamaProvider("127.0.0.1:11434", async () =>
    new Response(
      JSON.stringify({
        model: "gemma3:4b",
        message: { content: "{\"tool\":\"create_task\",\"args\":{\"title\":\"Demo\",\"priority\":\"high\"}}" },
        prompt_eval_count: 42,
        eval_count: 7,
      }),
    ),
  );
  const completion = await provider.create({
    model: "gemma3",
    messages: [
      { role: "user", content: "Add a task" },
      { role: "tool", content: { name: "list_tasks", output: { tasks: [] } } },
    ],
    tools: [{ name: "create_task", description: "Create a task" }],
  });
  assert.equal(completion.stopReason, "tool_use");
  assert.equal(completion.toolCalls[0]?.name, "create_task");
  assert.equal(completion.toolCalls[0]?.args.priority, "high");
  assert.deepEqual(completion.usage, { input_tokens: 42, output_tokens: 7 });
});
