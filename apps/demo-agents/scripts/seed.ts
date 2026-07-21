/**
 * Seed ~30 mixed runs (mostly success, a few chaos failures across both agents)
 * to the live SigNoz so dashboards look alive. Prints each run's traceId.
 *
 *   pnpm --filter @hindsight/demo-agents seed
 */
import { createRecorder } from "@hindsight/recorder";
import {
  RESEARCH_AGENT,
  SUPPORT_AGENT,
  runAgentSpec,
  CHAOS_MODES,
  type AgentSpec,
  type ChaosMode,
} from "../src/index.js";

const TOTAL = 30;

async function main(): Promise<void> {
  const recorder = createRecorder({ recordPayloads: "always" });

  const agents: AgentSpec[] = [RESEARCH_AGENT, SUPPORT_AGENT];
  // A handful of chaos runs sprinkled across the batch (indices → mode).
  const chaosAt: Record<number, ChaosMode> = {
    5: "malformed_tool_json",
    11: "tool_timeout",
    17: "wrong_tool_loop",
    23: "context_flood",
    28: "malformed_tool_json",
  };

  const results: Array<{ i: number; agent: string; outcome: string; traceId: string; chaos?: ChaosMode }> = [];

  for (let i = 0; i < TOTAL; i++) {
    const spec = agents[i % agents.length];
    const chaos = chaosAt[i];
    const res = await runAgentSpec(spec, {
      recorder,
      chaos,
      seed: i,
      taskId: `${spec.agentId}-task-${i}`,
    });
    results.push({ i, agent: spec.agentId, outcome: res.outcome, traceId: res.traceId, chaos });
    console.log(
      `run ${String(i).padStart(2, "0")}  ${spec.agentId.padEnd(14)}  ${res.outcome.padEnd(7)}  ${chaos ?? ""}  trace=${res.traceId}`,
    );
  }

  await recorder.shutdown();

  const failures = results.filter((r) => r.outcome !== "success").length;
  console.log(`\nseeded ${TOTAL} runs (${failures} failures) across ${agents.length} agents.`);
  console.log(`chaos modes used: ${[...new Set(Object.values(chaosAt))].join(", ")}`);
  console.log(`(available chaos modes: ${CHAOS_MODES.join(", ")})`);
  console.log("\nfirst 5 traceIds:");
  for (const r of results.slice(0, 5)) console.log(`  ${r.traceId}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
