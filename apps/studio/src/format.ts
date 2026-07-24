import type { RunSummary } from "@hindsight/shared";

export function fmtUsd(n: number | null): string {
  if (n === null) return "unknown";
  const abs = Math.abs(n);
  const s = abs >= 1 ? n.toFixed(2) : n.toFixed(4);
  return `$${s}`;
}

export function fmtTokens(n: number | null): string {
  if (n === null) return "unknown";
  return n.toLocaleString("en-US");
}

export function fmtMs(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

export function shortId(id: string): string {
  return id.length > 8 ? id.slice(0, 8) : id;
}

export function fmtTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
  const time = d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit" });
  return `${date}, ${time}`;
}

export function timeAgo(iso: string): string {
  const secs = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return `${Math.floor(secs)}s ago`;
  const mins = secs / 60;
  if (mins < 60) return `${Math.floor(mins)}m ago`;
  const hours = mins / 60;
  if (hours < 24) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

/** Wall-clock duration of a run, or null if it never finished. */
export function runDurationMs(run: RunSummary): number | null {
  if (!run.endTime) return null;
  return new Date(run.endTime).getTime() - new Date(run.startTime).getTime();
}
