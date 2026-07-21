import { useCallback, useEffect, useState } from "react";
import type { FormEvent } from "react";
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
      return [
        { label: "Mark diagnosed", to: "diagnosed" },
        { label: "Dismiss", to: "dismissed" },
      ];
    case "diagnosed":
      return [
        { label: "Reopen", to: "open" },
        { label: "Dismiss", to: "dismissed" },
      ];
    case "dismissed":
      return [{ label: "Reopen", to: "open" }];
    case "resolved_via_fork":
      return [];
  }
}

function ResolveViaForkModal({
  incident,
  onClose,
  onDone,
}: {
  incident: Incident;
  onClose: () => void;
  onDone: () => Promise<void>;
}) {
  const [forkTraceId, setForkTraceId] = useState(incident.forkTraceId ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const confirm = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patchIncident(incident.id, {
        status: "resolved_via_fork",
        ...(forkTraceId.trim() ? { forkTraceId: forkTraceId.trim() } : {}),
      });
      await onDone();
      onClose();
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <form className="modal-card" onSubmit={confirm} onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="eyebrow modal-eyebrow">resolve via fork</span>
          <span className="spacer" />
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="modal-text">
          Mark incident <b>{shortId(incident.id)}</b> as resolved-via-fork. Link the counterfactual
          trace that proves the fix — run a fork from the run timeline first, then paste its trace
          id here.
        </p>
        <label className="field-label" htmlFor="resolve-fork-trace">
          fork trace id
        </label>
        <input
          id="resolve-fork-trace"
          className="input"
          value={forkTraceId}
          onChange={(e) => setForkTraceId(e.target.value)}
          placeholder="2b7d4e9f1a3c4856…"
          spellCheck={false}
        />
        {error ? <ErrorNote error={error} /> : null}
        <div className="row modal-actions">
          <button className="btn btn-ember" type="submit" disabled={busy}>
            {busy ? "Saving…" : "Mark resolved via fork"}
          </button>
        </div>
      </form>
    </div>
  );
}

export function IncidentsScreen() {
  const [incidents, setIncidents] = useState<Incident[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<unknown>(null);
  const [postmortemId, setPostmortemId] = useState<string | null>(null);
  const [resolving, setResolving] = useState<Incident | null>(null);
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

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">Inbox</div>
        <h1>Incidents</h1>
        <p className="page-sub">SigNoz alerts open cases here. Scrub the run, fork it, prove the fix.</p>
      </div>

      <TraceLookup onCreateIncident={createIncident} />

      {error ? <ErrorNote error={error} /> : null}
      {actionError ? <ErrorNote error={actionError} /> : null}
      {!incidents && !error && <div className="loading">loading incidents…</div>}

      {incidents && incidents.length === 0 && (
        <div className="loading">no incidents — the fleet is quiet</div>
      )}

      {incidents && incidents.length > 0 && (
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
              <tr key={inc.id} onClick={() => navigate(`/runs/${inc.traceId}`)}>
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
                <td className="inc-actions" onClick={(e) => e.stopPropagation()}>
                  <button
                    className="btn btn-ghost btn-sm"
                    type="button"
                    onClick={() => setPostmortemId(inc.id)}
                  >
                    Postmortem
                  </button>
                  {(inc.status === "open" || inc.status === "diagnosed") && (
                    <button
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => setResolving(inc)}
                    >
                      Resolve via fork
                    </button>
                  )}
                  {inc.forkTraceId && (
                    <Link
                      className="btn btn-ghost btn-sm"
                      to={`/compare?original=${encodeURIComponent(inc.traceId)}&fork=${encodeURIComponent(inc.forkTraceId)}`}
                    >
                      Compare
                    </Link>
                  )}
                  {transitionsFor(inc.status).map((t) => (
                    <button
                      key={t.to}
                      className="btn btn-ghost btn-sm"
                      type="button"
                      onClick={() => void patch(inc.id, { status: t.to })}
                    >
                      {t.label}
                    </button>
                  ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {postmortemId && (
        <PostmortemModal incidentId={postmortemId} onClose={() => setPostmortemId(null)} />
      )}
      {resolving && (
        <ResolveViaForkModal
          incident={resolving}
          onClose={() => setResolving(null)}
          onDone={reload}
        />
      )}
    </div>
  );
}
