import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { RunGraph } from "@hindsight/shared";
import { api, signozTraceUrl } from "../api";
import { shortId } from "../format";
import { Badge, OutcomeBadge } from "../components/Badge";
import { ErrorNote } from "../components/ErrorNote";
import { StepScrubber } from "../components/StepScrubber";
import { StepCard } from "../components/StepCard";
import { ForkPanel } from "../components/ForkPanel";

export function RunDetailScreen() {
  const { traceId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const incidentId = searchParams.get("incident") ?? undefined;
  const [graph, setGraph] = useState<RunGraph | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selected, setSelected] = useState<number | null>(null);
  const [forkAt, setForkAt] = useState<number | null>(null);
  const cardRefs = useRef(new Map<number, HTMLElement>());

  useEffect(() => {
    let alive = true;
    setGraph(null);
    setError(null);
    setSelected(null);
    setForkAt(null);
    api
      .getRun(traceId)
      .then((g) => {
        if (!alive) return;
        setGraph(g);
        const firstFailed = g.steps.find((s) => s.error);
        setSelected(firstFailed ? firstFailed.index : g.steps[0]?.index ?? null);
      })
      .catch((e) => alive && setError(e));
    return () => {
      alive = false;
    };
  }, [traceId]);

  const registerRef = useCallback((index: number) => {
    return (el: HTMLElement | null) => {
      if (el) cardRefs.current.set(index, el);
      else cardRefs.current.delete(index);
    };
  }, []);

  const handleSelect = useCallback((index: number) => {
    setSelected(index);
    cardRefs.current.get(index)?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, []);

  // Keyboard scrubbing: ←/→ move between steps, `f` forks the selected step.
  // Ignored while typing in a form control (e.g. the fork prompt editor).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (!graph) return;
      const ordered = [...graph.steps].sort((a, b) => a.index - b.index);
      if (ordered.length === 0) return;
      if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
        e.preventDefault();
        const pos = ordered.findIndex((s) => s.index === selected);
        const cur = pos < 0 ? 0 : pos;
        const next = e.key === "ArrowRight" ? Math.min(cur + 1, ordered.length - 1) : Math.max(cur - 1, 0);
        handleSelect(ordered[next].index);
      } else if ((e.key === "f" || e.key === "F") && selected !== null) {
        e.preventDefault();
        setForkAt((cur) => (cur === selected ? null : selected));
      } else if (e.key === "g" || e.key === "G") {
        const firstFailed = ordered.find((s) => s.error);
        if (firstFailed) {
          e.preventDefault();
          handleSelect(firstFailed.index);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [graph, selected, handleSelect]);

  if (error) {
    return (
      <div className="page">
        <ErrorNote error={error} />
        <Link to="/runs" className="trace-link">← all runs</Link>
      </div>
    );
  }
  if (!graph) {
    return (
      <div className="page">
        <div className="loading">reconstructing run from SigNoz…</div>
      </div>
    );
  }

  const { run } = graph;
  const steps = [...graph.steps].sort((a, b) => a.index - b.index);
  const tools = [
    ...new Set(steps.filter((s) => s.kind === "tool").map((s) => s.toolName ?? s.name)),
  ].sort();

  return (
    <div className="page run-page">
      <div className="page-head">
        <div className="eyebrow">Causal trace</div>
        <div className="row">
          <h1>
            {run.agentId} <span className="muted mono" style={{ fontSize: 16 }}>· {shortId(run.traceId)}</span>
          </h1>
          <span className="spacer" />
          <Link to={incidentId ? "/incidents" : "/runs"} className="trace-link">
            ← {incidentId ? "incident queue" : "all runs"}
          </Link>
          <a className="btn btn-ghost btn-sm" href={signozTraceUrl(run.traceId)} target="_blank" rel="noreferrer">
            Open in SigNoz ↗
          </a>
        </div>
        {run.error && (
          <div className="run-error" role="alert">
            <div className="run-error-title">
              {run.error === "OllamaError" ? "Model request failed" : "Run failed"}
            </div>
            <div className="run-error-copy">
              Inspect the failed step below, then test a different model, prompt, or tool result.
            </div>
          </div>
        )}
      </div>

      <div className="run-sticky">
        <StepScrubber steps={steps} selected={selected} onSelect={handleSelect} />
        <div className="run-strip-footer">
          <div className="summary-strip">
            <OutcomeBadge outcome={run.outcome} />
            <span className="run-stat">{steps.length} {steps.length === 1 ? "step" : "steps"}</span>
            {run.forkOf && (
              <Badge tone="ember">
                <Link to={`/runs/${run.forkOf}`}>fork of {shortId(run.forkOf)}</Link>
              </Badge>
            )}
          </div>
          <div className="kbd-hint">
            <kbd>←</kbd> <kbd>→</kbd> navigate · <kbd>f</kbd> test · <kbd>g</kbd> failure
          </div>
        </div>
      </div>

      {steps.length === 0 && (
        <div className="loading">no recorded steps for this run</div>
      )}

      <div className="transcript">
        {steps.map((step) => (
          <StepCard
            key={step.spanId}
            step={step}
            selected={selected === step.index}
            forkOpen={forkAt === step.index}
            onSelect={() => setSelected(step.index)}
            onToggleFork={() => setForkAt(forkAt === step.index ? null : step.index)}
            registerRef={registerRef(step.index)}
            forkPanel={
              <ForkPanel
                traceId={run.traceId}
                agentId={run.agentId}
                agentRevision={run.agentRevision}
                checkpoint={graph.checkpoint}
                incidentId={incidentId}
                step={step}
                tools={tools}
              />
            }
          />
        ))}
      </div>
    </div>
  );
}
