/**
 * Smoke test: emit ONE tiny run (1 llm step + 1 tool step) to the live SigNoz
 * OTLP endpoint, then shut down (force-flush). Prints the trace id so you can
 * find it in the SigNoz UI. Run: pnpm --filter @hindsight/recorder smoke
 */
import { createRecorder } from "../src/index.js";

async function main(): Promise<void> {
  const hindsight = createRecorder({ recordPayloads: "always" });
  const run = hindsight.startRun({ agentId: "smoke", taskId: "smoke-1" });

  await run.llm(
    async () => ({
      model: "claude-haiku-4-5",
      content: "hello from smoke",
      usage: { input_tokens: 42, output_tokens: 7 },
    }),
    {
      model: "claude-haiku-4-5",
      messages: [{ role: "user", content: "ping" }],
      temperature: 0,
      max_tokens: 64,
      provider: "mock",
    },
  );

  await run.tool("web_search", { query: "hindsight" }, async () => ({
    results: ["ok"],
  }));

  run.end({ outcome: "success" });
  console.log(`smoke run emitted. traceId=${run.traceId}`);

  await hindsight.shutdown();
  console.log("flushed and shut down.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
