import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import type { Incident, IncidentStatus } from "@hindsight/shared";
import { api } from "../api";
import { shortId, timeAgo } from "../format";
import { IncidentStatusBadge, SeverityBadge } from "../components/Badge";
import { TraceLookup } from "../components/TraceLookup";
import { ErrorNote } from "../components/ErrorNote";
import { PostmortemModal } from "../components/PostmortemModal";

/** Plain status transitions the engine allows (apps/replay-engine incidents/store.ts). */
function transitionsFor(status: IncidentStatus): Array<{ label: string; to: IncidentStatus }> {
  switch (status) {
    case "open":
      return [{ label: "Dismiss", to: "dismissed" }];
    case "dismissed":
      return [{ label: "Reopen", to: "open" }];
    case "verifying":
    case "resolved":
      return [];
  }
}

export function IncidentsScreen() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [postmortemId, setPostmortemId] = useState<string | null>(null);
  const [undo, setUndo] = useState<{ id: string; prev: IncidentStatus; label: string } | null>(null);
  const undoTimer = useRef<number | undefined>(undefined);
  const navigate = useNavigate();

  const reload = useCallback(async () => {
    setIncidents(await api.listIncidents());
  }, []);

  useEffect(() => {
    let alive = true;
    api
      .listIncidents()
      .then((rows) => alive && setIncidents(rows))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, []);

  const createIncident = async (traceId: string) => {
    await api.createIncident({ traceId });
    await reload();
  };

  const patch = async (id: string, p: Partial<Incident>) => {
    setActionError(null);
    try {
      await api.patchIncident(id, p);
      await reload();
    } catch (e) {
      setActionError(e);
    }
  };

  // Status changes fire instantly, so every transition leaves an Undo behind for
  // a few seconds instead of asking for confirmation up front.
  const transition = async (inc: Incident, to: IncidentStatus, label: string) => {
    const prev = inc.status;
    let notes: string | undefined;
    if (to === "dismissed") {
      notes = window.prompt("Why is this incident being dismissed?")?.trim();
      if (!notes) return;
    }
    await patch(inc.id, { status: to, ...(notes ? { notes } : {}) });
    setUndo({ id: inc.id, prev, label });
    window.clearTimeout(undoTimer.current);
    undoTimer.current = window.setTimeout(() => setUndo(null), 6000);
  };

  const doUndo = async () => {
    if (!undo) return;
    window.clearTimeout(undoTimer.current);
    const target = undo;
    setUndo(null);
    await patch(target.id, { status: target.prev });
  };

  useEffect(() => () => window.clearTimeout(undoTimer.current), []);

  return (
    <div className="page incidents-page">
      <div className="page-head">
        <div className="eyebrow">Incident queue</div>
        <h1>Find the break. Prove the fix.</h1>
        <p className="page-sub">SigNoz alerts become replayable cases: inspect, fork, compare, resolve.</p>
      </div>

      <TraceLookup onCreateIncident={createIncident} />

      {error ? <ErrorNote error={error} /> : null}
      {actionError ? <ErrorNote error={actionError} /> : null}
      {!incidents && !error && <div className="loading">loading incidents…</div>}

      {incidents && incidents.length === 0 && (
        <div className="empty-onboard">
          <p className="page-sub">
            No incidents — the fleet is quiet. Wire an agent with the recorder SDK and every run
            becomes a replayable trace:
          </p>
          <pre className="json">{`const run = hindsight.startRun({ agentId: "researcher", taskId });
const resp = await run.llm(() => anthropic.messages.create(params), params);
const out  = await run.tool("web_search", args, () => webSearch(args));
run.end({ outcome: "success" });`}</pre>
          <p className="page-sub">…or paste a trace_id above to replay any past run for $0.00.</p>
        </div>
      )}

      {incidents && incidents.length > 0 && (
        <div className="table-shell">
          <table className="table">
            <thead>
              <tr>
                <th>Severity</th>
                <th>Agent</th>
                <th>Alert</th>
                <th>Age</th>
                <th>Status</th>
                <th>Trace</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {incidents.map((inc) => (
                <tr
                  key={inc.id}
                  tabIndex={0}
                  onClick={() =>
                    navigate(`/runs/${inc.traceId}?incident=${encodeURIComponent(inc.id)}`)
                  }
                  onKeyDown={(e) => {
                    if (e.target !== e.currentTarget) return;
                    if (e.key === "Enter") {
                      navigate(`/runs/${inc.traceId}?incident=${encodeURIComponent(inc.id)}`);
                    }
                  }}
                >
                  <td><SeverityBadge severity={inc.severity} /></td>
                  <td className="td-mono">{inc.agentId}</td>
                  <td>
                    {inc.alertName}
                    {inc.notes && <div className="inc-notes">{inc.notes}</div>}
                  </td>
                  <td className="td-mono muted">{timeAgo(inc.createdAt)}</td>
                  <td><IncidentStatusBadge status={inc.status} /></td>
                  <td>
                    <span className="trace-link">{shortId(inc.traceId)}…</span>
                  </td>
                  <td onClick={(e) => e.stopPropagation()}>
                    <div className="inc-actions">
                      {inc.status === "verifying" && (
                        <span className="muted td-mono">verifying fork…</span>
                      )}
                      {inc.forkTraceId && (
                        <Link
                          className="btn btn-ghost btn-sm"
                          to={`/compare?original=${encodeURIComponent(inc.traceId)}&fork=${encodeURIComponent(inc.forkTraceId)}`}
                        >
                          Compare
                        </Link>
                      )}
                      <details className="act-menu">
                        <summary className="btn btn-ghost btn-sm act-menu-btn" aria-label="more actions">⋯</summary>
                        <div className="act-pop">
                          {inc.status === "resolved" && inc.verification?.verified && (
                            <button type="button" onClick={() => setPostmortemId(inc.id)}>
                              Postmortem
                            </button>
                          )}
                          {transitionsFor(inc.status).map((t) => (
                            <button key={t.to} type="button" onClick={() => void transition(inc, t.to, t.label)}>
                              {t.label}
                            </button>
                          ))}
                        </div>
                      </details>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {postmortemId && (
        <PostmortemModal incidentId={postmortemId} onClose={() => setPostmortemId(null)} />
      )}
      {undo && (
        <div className="toast" role="status">
          <span>{undo.label} · {shortId(undo.id)}</span>
          <button className="toast-undo" type="button" onClick={() => void doUndo()}>
            Undo
          </button>
        </div>
      )}
    </div>
  );
}
