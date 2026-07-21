import { useEffect, useState } from "react";
import { api } from "../api";
import { shortId } from "../format";
import { ErrorNote } from "./ErrorNote";

interface Props {
  incidentId: string;
  onClose: () => void;
}

export function PostmortemModal({ incidentId, onClose }: Props) {
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    setMarkdown(null);
    setError(null);
    api
      .postmortem(incidentId)
      .then((r) => alive && setMarkdown(r.markdown))
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [incidentId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const copy = async () => {
    if (!markdown) return;
    try {
      await navigator.clipboard.writeText(markdown);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch {
      // clipboard API unavailable (non-secure context) — user can select the text
    }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span className="eyebrow modal-eyebrow">postmortem · {shortId(incidentId)}</span>
          <span className="spacer" />
          <button
            className="btn btn-ghost btn-sm"
            type="button"
            onClick={() => void copy()}
            disabled={!markdown}
          >
            {copied ? "Copied ✓" : "Copy markdown"}
          </button>
          <button className="btn btn-ghost btn-sm" type="button" onClick={onClose}>
            Close
          </button>
        </div>
        {error ? <ErrorNote error={error} /> : null}
        {!markdown && !error && <div className="loading">generating postmortem…</div>}
        {markdown && <pre className="json md-block">{markdown}</pre>}
      </div>
    </div>
  );
}
