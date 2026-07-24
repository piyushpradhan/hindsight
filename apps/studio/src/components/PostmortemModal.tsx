import { Dialog } from "@base-ui/react/dialog";
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
    <Dialog.Root open onOpenChange={(open) => !open && onClose()}>
      <Dialog.Portal>
        <Dialog.Viewport className="modal-overlay">
          <Dialog.Popup className="modal-card">
            <div className="modal-head">
              <Dialog.Title className="eyebrow modal-eyebrow">
                postmortem · {shortId(incidentId)}
              </Dialog.Title>
              <span className="spacer" />
              <button
                className="btn btn-ghost btn-sm"
                type="button"
                onClick={() => void copy()}
                disabled={!markdown}
              >
                {copied ? "Copied ✓" : "Copy markdown"}
              </button>
              <Dialog.Close className="btn btn-ghost btn-sm">Close</Dialog.Close>
            </div>
            {error ? <ErrorNote error={error} /> : null}
            {!markdown && !error && <div className="loading">generating postmortem…</div>}
            {markdown && <pre className="json md-block">{markdown}</pre>}
          </Dialog.Popup>
        </Dialog.Viewport>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
