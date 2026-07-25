import { useEffect, useState } from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type {
  CompareResult,
  FieldComparison,
  IncidentVerification,
  RunGraph,
  RunStep,
} from "@hindsight/shared";
import { api, signozTraceUrl } from "../api";
import { fmtMs, fmtTokens, fmtUsd, shortId } from "../format";
import { Badge, OutcomeBadge, type BadgeTone } from "../components/Badge";
import { ErrorNote } from "../components/ErrorNote";
import { MiniStepCell } from "../components/MiniStepCell";

/** Alignments reference RunStep.index values, not array positions. */
function byIndex(steps: RunStep[]): Map<number, RunStep> {
  return new Map(steps.map((s) => [s.index, s]));
}

function DeltaStat({ label, value, suffix }: { label: string; value: number | null; suffix: "usd" | "tok" | "steps" | "ms" }) {
  if (value === null) {
    return (
      <div className="delta-stat">
        <div className="d-label">{label}</div>
        <div className="d-value zero">unknown</div>
      </div>
    );
  }
  const cls = value < 0 ? "ok" : value > 0 ? "bad" : "zero";
  const sign = value > 0 ? "+" : value < 0 ? "-" : "";
  const abs = Math.abs(value);
  const text =
    suffix === "usd"
      ? `${sign}${fmtUsd(abs)}`
      : suffix === "tok"
        ? `${sign}${fmtTokens(abs)}`
        : suffix === "ms"
          ? `${sign}${fmtMs(abs)}`
          : `${sign}${abs}`;
  return (
    <div className="delta-stat">
      <div className="d-label">{label}</div>
      <div className={`d-value ${cls}`}>{text}</div>
    </div>
  );
}

function verdictCopy(verdict: NonNullable<CompareResult["verdict"]>): {
  label: string;
  title: string;
  tone: BadgeTone;
} {
  switch (verdict) {
    case "improved":
      return { label: "improved", title: "The tested branch improved the run", tone: "ok" };
    case "unchanged":
      return { label: "unchanged", title: "No measurable change", tone: "muted" };
    case "regressed":
      return { label: "regressed", title: "The tested branch regressed the run", tone: "ember" };
    case "not_verifiable":
      return {
        label: "not verifiable",
        title: "No defensible overall verdict",
        tone: "muted",
      };
  }
}

function fieldValue(value: FieldComparison["original"]): string {
  return value === undefined ? "not recorded" : String(value);
}

export function CompareScreen() {
  const [params] = useSearchParams();
  const location = useLocation();
  const stateVerification = (
    location.state as { verification?: IncidentVerification } | null
  )?.verification;
  const original = params.get("original") ?? "";
  const fork = params.get("fork") ?? "";
  const [compare, setCompare] = useState<CompareResult | null>(null);
  const [origGraph, setOrigGraph] = useState<RunGraph | null>(null);
  const [forkGraph, setForkGraph] = useState<RunGraph | null>(null);
  const [verification, setVerification] = useState<IncidentVerification | undefined>(
    stateVerification,
  );
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    if (!original || !fork) return;
    let alive = true;
    Promise.all([
      api.compare(original, fork),
      api.getRun(original),
      api.getRun(fork),
      api.listIncidents(),
    ])
      .then(([cmp, og, fg, incidents]) => {
        if (!alive) return;
        setCompare(cmp);
        setOrigGraph(og);
        setForkGraph(fg);
        setVerification(
          stateVerification ??
            incidents.find(
              (incident) =>
                incident.traceId === original && incident.forkTraceId === fork,
            )?.verification,
        );
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [original, fork, stateVerification]);

  if (!original || !fork) {
    return (
      <div className="page">
        <ErrorNote error={new Error("missing query params — expected /compare?original=TRACE&fork=TRACE")} />
      </div>
    );
  }
  if (error) {
    return (
      <div className="page">
        <ErrorNote error={error} />
      </div>
    );
  }
  if (!compare || !origGraph || !forkGraph) {
    return (
      <div className="page">
        <div className="loading">aligning steps…</div>
      </div>
    );
  }

  const origSteps = byIndex(origGraph.steps);
  const forkSteps = byIndex(forkGraph.steps);
  const verdict = compare.verdict ?? "not_verifiable";
  const verdictText = verdictCopy(verdict);
  const fieldChanges = compare.alignments.flatMap((alignment) =>
    (alignment.fields ?? [])
      .filter((field) => field.status !== "same")
      .map((field) => ({ alignment, field })),
  );

  return (
    <div className="page compare-page">
      <div className="page-head">
        <div className="eyebrow">Counterfactual comparison</div>
        <h1>Compare outcomes</h1>
        <p className="page-sub">
          See exactly what changed when Hindsight tested one alternate path.
        </p>
      </div>

      {verification && (
        <div className={`resolution-banner ${verification.verified ? "verified" : "unverified"}`}>
          <div>
            <div className="resolution-title">
            {verification.verified
                ? "Fix verified"
                : "Test completed, but the incident is still open"}
            </div>
            <div className="resolution-copy">
              {verification.verified
                ? "The tested branch succeeded and the original failure is gone."
                : verification.reason}
            </div>
          </div>
          <Link className="btn btn-ghost btn-sm" to="/incidents">Back to incident queue</Link>
        </div>
      )}

      <div className="card verdict-card">
        <div>
          <div className="verdict-title">{verdictText.title}</div>
          <div className="verdict-outcomes">
            <Badge tone={verdictText.tone}>{verdictText.label}</Badge>
            <OutcomeBadge outcome={compare.original.outcome} />
            <span className="verdict-arrow">── test ──▶</span>
            <OutcomeBadge outcome={compare.fork.outcome} />
          </div>
          <div className="mini-meta">
            {compare.verdictReason ?? "This comparison predates recorded verdict evidence."}
            {compare.branchPoint !== undefined
              ? ` Branch point #${compare.branchPoint}; ${compare.sharedPrefixSteps ?? 0} inherited prefix steps.`
              : ""}
          </div>
        </div>
        <div className="delta-grid">
          <DeltaStat label="Δ cost" value={compare.deltaCostUsd} suffix="usd" />
          <DeltaStat label="Δ tokens" value={compare.deltaTokens} suffix="tok" />
          <DeltaStat label="Δ steps" value={compare.deltaSteps} suffix="steps" />
          <DeltaStat label="Δ latency" value={compare.deltaLatencyMs} suffix="ms" />
        </div>
      </div>

      <div className="compare-cols">
        <div className="compare-col-head">
          original · <b>{shortId(compare.original.traceId)}</b> · {compare.original.agentId}
        </div>
        <div className="compare-col-head">
          fork · <b>{shortId(compare.fork.traceId)}</b> · {compare.fork.agentId}
        </div>
      </div>

      <div className="align-grid">
        {compare.alignments.map((a, i) => {
          const oStep = a.originalIndex !== undefined ? origSteps.get(a.originalIndex) : undefined;
          const fStep = a.sharedPrefix
            ? oStep
            : a.forkIndex !== undefined
              ? forkSteps.get(a.forkIndex)
              : undefined;
          const changedFields = (a.fields ?? []).filter((field) => field.status !== "same");
          return [
            <MiniStepCell
              key={`o-${i}`}
              step={oStep}
              status={a.status}
              emptyLabel="not present in original"
            />,
            <span key={`s-${i}`} className={`status-tag status-${a.status}`}>
              {a.sharedPrefix ? "shared" : a.status}
              {changedFields.length ? ` · ${changedFields.map((field) => field.field).join(", ")}` : ""}
            </span>,
            <MiniStepCell
              key={`f-${i}`}
              step={fStep}
              status={a.status}
              emptyLabel="not executed in fork"
            />,
          ];
        })}
      </div>

      {fieldChanges.length > 0 && (
        <>
          <div className="section-label">recorded field changes</div>
          <div className="card">
            <ul className="field-change-list">
              {fieldChanges.map(({ alignment, field }, index) => (
                <li key={`${alignment.originalIndex}-${alignment.forkIndex}-${field.field}-${index}`}>
                  <code>
                    step {alignment.originalIndex ?? "—"} → {alignment.forkIndex ?? "—"} ·{" "}
                    {field.field} · {field.status}
                  </code>
                  : {fieldValue(field.original)} → {fieldValue(field.fork)}
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {compare.outputDiff && (
        <>
          <div className="section-label">output diff</div>
          <pre className="diff-block">
            {compare.outputDiff.split("\n").map((line, i) => {
              const cls = line.startsWith("+")
                ? line.startsWith("+++")
                  ? "diff-meta"
                  : "diff-add"
                : line.startsWith("-")
                  ? line.startsWith("---")
                    ? "diff-meta"
                    : "diff-del"
                  : "";
              return (
                <div key={i} className={cls}>
                  {line}
                </div>
              );
            })}
          </pre>
        </>
      )}

      <div className="row">
        <Link className="btn btn-ghost" to="/incidents">
          Back to incident queue
        </Link>
        <a className="btn btn-ghost" href={signozTraceUrl(compare.original.traceId)} target="_blank" rel="noreferrer">
          Open original trace in SigNoz ↗
        </a>
        <a className="btn btn-ghost" href={signozTraceUrl(compare.fork.traceId)} target="_blank" rel="noreferrer">
          Open fork trace in SigNoz ↗
        </a>
      </div>
    </div>
  );
}
