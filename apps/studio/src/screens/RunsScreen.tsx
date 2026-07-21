import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RunSummary } from "@hindsight/shared";
import { api } from "../api";
import { fmtTime, fmtTokens, fmtUsd, shortId } from "../format";
import { Badge, OutcomeBadge } from "../components/Badge";
import { ErrorNote } from "../components/ErrorNote";

export function RunsScreen() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();

  useEffect(() => {
    let alive = true;
    api
      .listRuns()
      .then((rows) => alive && setRuns(rows))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">Flight recorder</div>
        <h1>Runs</h1>
        <p className="page-sub">Every agent run, reconstructable from SigNoz spans and payload logs.</p>
      </div>

      {error ? <ErrorNote error={error} /> : null}
      {!runs && !error && <div className="loading">loading runs…</div>}

      {runs && runs.length === 0 && <div className="loading">no runs recorded yet</div>}

      {runs && runs.length > 0 && (
        <table className="table">
          <thead>
            <tr>
              <th>Agent</th>
              <th>Outcome</th>
              <th>Steps</th>
              <th>Tokens</th>
              <th>Cost</th>
              <th>Started</th>
              <th>Trace</th>
            </tr>
          </thead>
          <tbody>
            {runs.map((run) => (
              <tr key={run.traceId} onClick={() => navigate(`/runs/${run.traceId}`)}>
                <td className="td-mono">
                  {run.agentId}
                  {run.forkOf && (
                    <>
                      {" "}
                      <Badge>fork of {shortId(run.forkOf)}</Badge>
                    </>
                  )}
                </td>
                <td><OutcomeBadge outcome={run.outcome} /></td>
                <td className="td-mono">{run.stepCount}</td>
                <td className="td-mono">{fmtTokens(run.totalTokens)}</td>
                <td className="td-mono">{fmtUsd(run.costUsd)}</td>
                <td className="td-mono muted">{fmtTime(run.startTime)}</td>
                <td>
                  <span className="trace-link">{shortId(run.traceId)}…</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
