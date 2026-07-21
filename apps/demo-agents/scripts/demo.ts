/**
 * Deterministic demo mode: temperature 0, fixed seeds, mock tool outputs.
 * Runs one clean pass of each agent plus one chaos run so a live demo can't
 * faceplant. Every invocation produces identical step shapes.
 *
 *   pnpm --filter @hindsight/demo-agents demo
 *   CHAOS=wrong_tool_loop pnpm --filter @hindsight/demo-agents demo
 */
import { createRecorder } from "@hindsight/recorder";
import {
  RESEARCH_AGENT,
  SUPPORT_AGENT,
  runAgentSpec,
  parseChaos,
} from "../src/index.js";

async function main(): Promise<void> {
  const recorder = createRecorder({ recordPayloads: "always" });
  const chaos = parseChaos(process.env.CHAOS);

  for (const spec of [RESEARCH_AGENT, SUPPORT_AGENT]) {
    const res = await runAgentSpec(spec, { recorder, seed: 0, taskId: `${spec.agentId}-demo` });
    console.log(`[${spec.agentId}] outcome=${res.outcome} steps=${res.steps} trace=${res.traceId}`);
    console.log(`   final: ${res.finalContent}`);
  }

  if (chaos) {
    const res = await runAgentSpec(RESEARCH_AGENT, { recorder, seed: 0, chaos, taskId: "chaos-demo" });
    console.log(`[chaos:${chaos}] outcome=${res.outcome} error=${res.error ?? "-"} trace=${res.traceId}`);
  }

  await recorder.shutdown();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
