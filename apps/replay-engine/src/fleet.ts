import type { AgentFleetStat, RunSummary } from "@hindsight/shared";

/**
 * Fleet rollup for "today" (local midnight). Runs come from SigNoz; open
 * incidents are joined in from the SQLite store by agentId. Agents with open
 * incidents but no runs today still appear (with zeroed run stats).
 */
export function computeFleetStats(
  runs: RunSummary[],
  openIncidentsByAgent: Map<string, number>,
  now: Date = new Date(),
): AgentFleetStat[] {
  const startOfDay = new Date(now);
  startOfDay.setHours(0, 0, 0, 0);
  const todayMs = startOfDay.getTime();

  const byAgent = new Map<string, RunSummary[]>();
  for (const run of runs) {
    const list = byAgent.get(run.agentId) ?? [];
    list.push(run);
    byAgent.set(run.agentId, list);
  }
  for (const agentId of openIncidentsByAgent.keys()) {
    if (!byAgent.has(agentId)) byAgent.set(agentId, []);
  }

  return [...byAgent.entries()]
    .map(([agentId, agentRuns]) => {
      const today = agentRuns.filter((r) => Date.parse(r.startTime) >= todayMs);
      const successes = today.filter((r) => r.outcome === "success").length;
      return {
        agentId,
        runsToday: today.length,
        successRate: today.length > 0 ? successes / today.length : 0,
        costTodayUsd: today.some((r) => r.costUsd === null)
          ? null
          : today.reduce((n, r) => n + (r.costUsd ?? 0), 0),
        openIncidents: openIncidentsByAgent.get(agentId) ?? 0,
      };
    })
    .sort((a, b) => a.agentId.localeCompare(b.agentId));
}
