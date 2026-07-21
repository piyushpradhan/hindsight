import type { ReactNode } from "react";
import type { IncidentStatus, RunOutcome } from "@hindsight/shared";

export type BadgeTone = "ok" | "ember" | "muted" | "ink";

export function Badge({ tone = "muted", children }: { tone?: BadgeTone; children: ReactNode }) {
  const cls = tone === "muted" ? "badge" : `badge badge-${tone}`;
  return <span className={cls}>{children}</span>;
}

export function OutcomeBadge({ outcome }: { outcome: RunOutcome }) {
  const tone: BadgeTone = outcome === "success" ? "ok" : outcome === "failure" ? "ember" : "muted";
  return <Badge tone={tone}>{outcome}</Badge>;
}

export function IncidentStatusBadge({ status }: { status: IncidentStatus }) {
  const tone: BadgeTone =
    status === "resolved_via_fork" ? "ok" : status === "open" ? "ember" : "muted";
  return <Badge tone={tone}>{status.replace(/_/g, " ")}</Badge>;
}

export function SeverityBadge({ severity }: { severity?: string }) {
  const sev = (severity ?? "info").toLowerCase();
  const tone: BadgeTone = sev === "critical" || sev === "high" ? "ember" : "muted";
  return <Badge tone={tone}>{sev}</Badge>;
}
