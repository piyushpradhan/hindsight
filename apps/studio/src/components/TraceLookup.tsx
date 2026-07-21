import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { ErrorNote } from "./ErrorNote";

interface Props {
  /** When provided, a second button files the pasted trace as a manual incident. */
  onCreateIncident?: (traceId: string) => Promise<void>;
}

export function TraceLookup({ onCreateIncident }: Props) {
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const navigate = useNavigate();

  const open = (e: FormEvent) => {
    e.preventDefault();
    const traceId = value.trim();
    if (traceId) navigate(`/runs/${traceId}`);
  };

  const create = async () => {
    if (!onCreateIncident) return;
    const traceId = value.trim();
    if (!traceId) return;
    setBusy(true);
    setError(null);
    try {
      await onCreateIncident(traceId);
      setValue("");
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="lookup-block">
      <form className="trace-lookup" onSubmit={open}>
        <input
          className="input"
          placeholder="paste a trace_id — replay it, or file it as an incident…"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
        />
        <button className="btn btn-ghost" type="submit">
          Open trace
        </button>
        {onCreateIncident && (
          <button
            className="btn btn-ember"
            type="button"
            disabled={busy || !value.trim()}
            onClick={() => void create()}
          >
            {busy ? "Creating…" : "+ Incident"}
          </button>
        )}
      </form>
      {error ? <ErrorNote error={error} /> : null}
    </div>
  );
}
