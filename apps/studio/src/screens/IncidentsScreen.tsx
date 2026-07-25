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

function incidentUrl(incident: Incident): string {
  if (incident.status === "resolved" && incident.forkTraceId) {
    return `/compare?original=${encodeURIComponent(incident.traceId)}&fork=${encodeURIComponent(incident.forkTraceId)}`;
  }
  return `/runs/${incident.traceId}?incident=${encodeURIComponent(incident.id)}`;
}

function nextAction(incident: Incident): string {
  if (incident.status === "resolved") return "View verified fix";
  if (incident.status === "dismissed") return "Review incident";
  if (incident.forkTraceId) return "Review and try again";
  return "Inspect failure";
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
        <div className="eyebrow">Start here</div>
        <h1>Resolve an agent failure</h1>
        <p className="page-sub">
          Choose an open incident below. Hindsight preserves the original run while you test and
          verify a fix.
        </p>
      </div>

      <section className="workflow-guide" aria-labelledby="workflow-title">
        <div className="workflow-copy">
          <h2 id="workflow-title">Your path to a verified fix</h2>
          <p>Follow the failure from recorded evidence to a tested outcome.</p>
        </div>
        <ol className="workflow-steps">
          <li>
            <span className="workflow-number">1</span>
            <span><strong>Inspect</strong><small>Find the failed step</small></span>
          </li>
          <li>
            <span className="workflow-number">2</span>
            <span><strong>Test a change</strong><small>Model, prompt, or tool result</small></span>
          </li>
          <li>
            <span className="workflow-number">3</span>
            <span><strong>Compare</strong><small>Verify the failure is gone</small></span>
          </li>
        </ol>
      </section>

      {error ? <ErrorNote error={error} /> : null}
      {actionError ? <ErrorNote error={actionError} /> : null}
      {!incidents && !error && <div className="loading">loading incidents…</div>}

      {incidents && incidents.length === 0 && (
        <div className="empty-onboard">
          <h2>No incidents yet</h2>
          <p>
            Failed instrumented runs appear here automatically. For the local demo, create a
            deliberate failure in Taskline and return to this queue.
          </p>
          <a className="btn btn-ember" href="http://localhost:4174/" target="_blank" rel="noreferrer">
            Create a demo failure in Taskline ↗
          </a>
        </div>
      )}

      {incidents && incidents.length > 0 && (
        <div className="queue-section">
          <div className="queue-head">
            <div>
              <h2>Incident queue</h2>
              <p>Open incidents need a tested fix. Resolved incidents keep the proof.</p>
            </div>
            <span className="queue-count">
              {incidents.filter((incident) => incident.status === "open").length} open
            </span>
          </div>
          <div className="table-shell">
            <table className="table incident-table">
              <thead>
                <tr>
                  <th>Incident</th>
                  <th>Detected</th>
                  <th>Status</th>
                  <th>Next step</th>
                </tr>
              </thead>
              <tbody>
                {incidents.map((inc) => (
                  <tr
                    key={inc.id}
                    tabIndex={0}
                    onClick={() => navigate(incidentUrl(inc))}
                    onKeyDown={(e) => {
                      if (e.target !== e.currentTarget) return;
                      if (e.key === "Enter") navigate(incidentUrl(inc));
                    }}
                  >
                    <td>
                      <div className="incident-title">{inc.alertName}</div>
                      <div className="incident-meta">
                        <span>{inc.agentId}</span>
                        <SeverityBadge severity={inc.severity} />
                        <span className="td-mono">{shortId(inc.traceId)}…</span>
                      </div>
                      {inc.notes && <div className="inc-notes">{inc.notes}</div>}
                    </td>
                    <td className="td-mono muted">{timeAgo(inc.createdAt)}</td>
                    <td><IncidentStatusBadge status={inc.status} /></td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="inc-actions">
                        {inc.status === "verifying" ? (
                          <span className="muted td-mono">Checking test…</span>
                        ) : (
                          <Link
                            className={`btn btn-sm ${inc.status === "open" ? "btn-ember" : "btn-ghost"}`}
                            to={incidentUrl(inc)}
                          >
                            {nextAction(inc)} <span aria-hidden="true">→</span>
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
        </div>
      )}

      <details className="manual-trace">
        <summary>Open a trace manually</summary>
        <p>Use this when you have a SigNoz trace ID that is not already in the queue.</p>
        <TraceLookup onCreateIncident={createIncident} />
      </details>

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
