import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { RunSummary } from "@hindsight/shared";
import { api } from "../api";
import { fmtTime, fmtTokens, fmtUsd, shortId } from "../format";
import { Badge, OutcomeBadge } from "../components/Badge";
import { ErrorNote } from "../components/ErrorNote";
import {
  compareValues,
  MobileSort,
  nextSort,
  SortableHeader,
  type SortState,
} from "../components/SortableHeader";

type RunSortKey = "agent" | "outcome" | "steps" | "tokens" | "cost" | "started" | "trace";

export function RunsScreen() {
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [q, setQ] = useState("");
  const [outcome, setOutcome] = useState("all");
  const [sort, setSort] = useState<SortState<RunSortKey>>({
    key: "started",
    direction: "desc",
  });
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

  const needle = q.trim().toLowerCase();
  const filteredRuns = (runs ?? [])
    .filter(
      (run) =>
        (outcome === "all" || run.outcome === outcome) &&
        (!needle ||
          [
            run.agentId,
            run.traceId,
            run.runId,
            run.taskId,
            run.outcome,
            run.error,
          ].some((value) => value?.toLowerCase().includes(needle))),
    )
    .sort((a, b) => {
      const value = (run: RunSummary) => {
        switch (sort.key) {
          case "agent":
            return run.agentId;
          case "outcome":
            return run.outcome;
          case "steps":
            return run.stepCount;
          case "tokens":
            return run.totalTokens;
          case "cost":
            return run.costUsd;
          case "started":
            return Date.parse(run.startTime);
          case "trace":
            return run.traceId;
        }
      };
      return compareValues(value(a), value(b), sort.direction);
    });
  const sortHeader = (key: RunSortKey, label: string) => (
    <SortableHeader
      label={label}
      active={sort.key === key}
      direction={sort.direction}
      onSort={() => setSort((current) => nextSort(current, key))}
    />
  );

  return (
    <div className="page runs-page">
      <div className="page-head">
        <div className="eyebrow">Recording archive</div>
        <h1>All agent runs</h1>
        <p className="page-sub">
          These recordings come from SigNoz. If you're working a failure, open it from the incident
          queue so the fork stays tied to the case.
        </p>
      </div>

      {error ? <ErrorNote error={error} /> : null}
      {!runs && !error && <div className="loading">loading runs…</div>}

      {runs && runs.length === 0 && <div className="loading">no runs recorded yet</div>}

      {runs && runs.length > 0 && (
        <>
          <div className="table-controls">
            <input
              className="input table-search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="filter runs…"
              spellCheck={false}
              aria-label="Search runs"
            />
            <select
              className="input table-filter"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
              aria-label="Filter runs by outcome"
            >
              <option value="all">All outcomes</option>
              <option value="success">Success</option>
              <option value="failure">Failure</option>
              <option value="timeout">Timeout</option>
            </select>
            <MobileSort
              label="Sort runs by"
              options={[
                { key: "agent", label: "agent" },
                { key: "outcome", label: "outcome" },
                { key: "steps", label: "steps" },
                { key: "tokens", label: "tokens" },
                { key: "cost", label: "cost" },
                { key: "started", label: "started" },
                { key: "trace", label: "trace" },
              ]}
              sort={sort}
              onChange={setSort}
            />
            <span className="table-result-count" aria-live="polite">
              {filteredRuns.length} of {runs.length}
            </span>
          </div>
          {filteredRuns.length === 0 ? (
            <div className="loading">no runs match these filters</div>
          ) : (
            <div className="table-shell">
              <table className="table runs-table">
                <thead>
                  <tr>
                    {sortHeader("agent", "Agent")}
                    {sortHeader("outcome", "Outcome")}
                    {sortHeader("steps", "Steps")}
                    {sortHeader("tokens", "Tokens")}
                    {sortHeader("cost", "Cost")}
                    {sortHeader("started", "Started")}
                    {sortHeader("trace", "Trace")}
                  </tr>
                </thead>
                <tbody>
                  {filteredRuns.map((run) => (
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
                          {run.forkOf && <Badge>fork of {shortId(run.forkOf)}</Badge>}
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
      )}
    </div>
  );
}
