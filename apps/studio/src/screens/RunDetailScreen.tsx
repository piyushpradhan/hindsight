import { useCallback, useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import type { RunGraph } from "@hindsight/shared";
import { api, signozTraceUrl } from "../api";
import { fmtMs, fmtTokens, fmtUsd, runDurationMs, shortId } from "../format";
import { Badge, OutcomeBadge } from "../components/Badge";
import { ErrorNote } from "../components/ErrorNote";
import { StepScrubber } from "../components/StepScrubber";
import { StepCard } from "../components/StepCard";
import { ForkPanel } from "../components/ForkPanel";

export function RunDetailScreen() {
  const { traceId = "" } = useParams();
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
  const duration = runDurationMs(run);

  return (
    <div className="page">
      <div className="page-head">
        <div className="eyebrow">Run timeline</div>
        <div className="row">
          <h1>
            {run.agentId} <span className="muted mono" style={{ fontSize: 16 }}>· {shortId(run.traceId)}</span>
          </h1>
          <span className="spacer" />
          <Link to="/runs" className="trace-link">← all runs</Link>
          <a className="btn btn-ghost btn-sm" href={signozTraceUrl(run.traceId)} target="_blank" rel="noreferrer">
            Open in SigNoz ↗
          </a>
        </div>
        {run.error && <div className="error-note">{run.error}</div>}
      </div>

      <StepScrubber steps={steps} selected={selected} onSelect={handleSelect} />

      <div className="summary-strip">
        <OutcomeBadge outcome={run.outcome} />
        <Badge>{steps.length} steps</Badge>
        <Badge>{fmtTokens(run.totalTokens)} tokens</Badge>
        <Badge>{fmtUsd(run.costUsd)}</Badge>
        {duration !== null && <Badge>{fmtMs(duration)}</Badge>}
        {run.taskId && <Badge>task {run.taskId}</Badge>}
        {run.forkOf && (
          <Badge tone="ember">
            <Link to={`/runs/${run.forkOf}`}>fork of {shortId(run.forkOf)}</Link>
          </Badge>
        )}
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
            forkPanel={<ForkPanel traceId={run.traceId} step={step} tools={tools} />}
          />
        ))}
      </div>
    </div>
  );
}
