import { useEffect, useState } from "react";
import type { AgentFleetStat } from "@hindsight/shared";
import { api } from "../api";
import { fmtUsd } from "../format";

export function FleetStrip() {
  const [stats, setStats] = useState<AgentFleetStat[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let alive = true;
    api
      .fleet()
      .then((s) => alive && setStats(s))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, []);

  if (failed) {
    return (
      <div className="fleet-strip">
        <span
          className="fleet-chip faint-chip"
          title="GET /api/fleet failed — replay-engine or SigNoz unavailable"
        >
          fleet unavailable
        </span>
      </div>
    );
  }

  if (!stats) return null;

  return (
    <div className="fleet-strip">
      {stats.length === 0 && (
        <span className="fleet-chip faint-chip" title="No runs recorded today">
          no agents reporting yet
        </span>
      )}
      {stats.map((s) => {
        const pct = Math.round(s.successRate * 100);
        const rateCls = pct >= 90 ? "f-ok" : pct < 75 ? "f-bad" : "";
        return (
          <span
            key={s.agentId}
            className="fleet-chip"
            title={`${s.runsToday} runs today · ${pct}% success · ${fmtUsd(s.costTodayUsd)} cost today · ${s.openIncidents} open incidents`}
            aria-label={`${s.agentId}: ${s.runsToday} runs today, ${pct}% success, ${fmtUsd(s.costTodayUsd)} cost today, ${s.openIncidents} open incidents`}
          >
            <span className="f-id">{s.agentId}</span>
            <span>{s.runsToday} runs</span>
            <span className={rateCls}>{pct}% pass</span>
            <span>{fmtUsd(s.costTodayUsd)} cost</span>
            {s.openIncidents > 0 && <span className="f-bad">{s.openIncidents} open</span>}
          </span>
        );
      })}
    </div>
  );
}
