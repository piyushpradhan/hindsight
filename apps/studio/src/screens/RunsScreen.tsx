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
  const [q, setQ] = useState("");
  const [copiedTraceId, setCopiedTraceId] = useState<string | null>(null);
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

  const copyTraceId = async (traceId: string) => {
    try {
      await navigator.clipboard.writeText(traceId);
      setCopiedTraceId(traceId);
      window.setTimeout(
        () => setCopiedTraceId((current) => (current === traceId ? null : current)),
        1400,
      );
    } catch {
      setCopiedTraceId(null);
    }
  };

  return (
    <div className="page runs-page">
      <div className="page-head">
        <div className="eyebrow">Recording archive</div>
        <h1>All agent runs</h1>
        <p className="page-sub">
          Browse every recording from SigNoz. To investigate and resolve a failure, start in the
          incident queue.
        </p>
      </div>

      {error ? <ErrorNote error={error} /> : null}
      {!runs && !error && <div className="loading">loading runs…</div>}

      {runs && runs.length === 0 && <div className="loading">no runs recorded yet</div>}

      {runs &&
        runs.length > 0 &&
        (() => {
          const needle = q.trim().toLowerCase();
          const filtered = needle
            ? runs.filter(
                (r) =>
                  r.agentId.toLowerCase().includes(needle) ||
                  r.traceId.toLowerCase().includes(needle),
              )
            : runs;
          return (
            <>
              <div className="trace-lookup">
                <input
                  className="input"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="filter by agent or trace id…"
                  spellCheck={false}
                  aria-label="filter runs"
                />
              </div>
              {filtered.length === 0 ? (
                <div className="loading">no runs match “{q.trim()}”</div>
              ) : (
                <div className="table-shell">
                  <table className="table runs-table">
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
                      {filtered.map((run) => (
                        <tr
                          key={run.traceId}
                          tabIndex={0}
                          onClick={() => navigate(`/runs/${run.traceId}`)}
                          onKeyDown={(e) => {
                            if (e.target !== e.currentTarget) return;
                            if (e.key === "Enter") navigate(`/runs/${run.traceId}`);
                          }}
                        >
                          <td className="td-mono" data-label="Agent">
                            <div className="run-agent">
                              <span>{run.agentId}</span>
                              {run.forkOf && (
                                <Badge>fork of {shortId(run.forkOf)}</Badge>
                              )}
                            </div>
                          </td>
                          <td data-label="Outcome">
                            <OutcomeBadge outcome={run.outcome} />
                          </td>
                          <td className="td-mono" data-label="Steps">{run.stepCount}</td>
                          <td className="td-mono" data-label="Tokens">{fmtTokens(run.totalTokens)}</td>
                          <td className="td-mono" data-label="Cost">{fmtUsd(run.costUsd)}</td>
                          <td className="td-mono muted" data-label="Started">{fmtTime(run.startTime)}</td>
                          <td data-label="Trace">
                            <button
                              className="trace-copy"
                              type="button"
                              title={copiedTraceId === run.traceId ? "Trace ID copied" : "Copy full trace ID"}
                              aria-label={`${copiedTraceId === run.traceId ? "Copied" : "Copy"} trace ID ${run.traceId}`}
                              onClick={(event) => {
                                event.stopPropagation();
                                void copyTraceId(run.traceId);
                              }}
                            >
                              <span>{run.traceId}</span>
                              <span className="trace-copy-icon" aria-hidden="true">
                                {copiedTraceId === run.traceId ? (
                                  <svg viewBox="0 0 14 14">
                                    <path d="m2.5 7.5 3 3 6-7" />
                                  </svg>
                                ) : (
                                  <svg viewBox="0 0 14 14">
                                    <rect x="5" y="5" width="7" height="7" />
                                    <path d="M3 9H2V2h7v1" />
                                  </svg>
                                )}
                              </span>
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          );
        })()}
    </div>
  );
}
