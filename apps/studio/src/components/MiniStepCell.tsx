import type { AlignmentStatus, RunStep } from "@hindsight/shared";
import { fmtMs, fmtUsd } from "../format";
import { Badge } from "./Badge";

interface Props {
  step?: RunStep;
  status: AlignmentStatus;
  emptyLabel: string;
}

export function MiniStepCell({ step, status, emptyLabel }: Props) {
  if (!step) {
    return <div className="cell-empty">{emptyLabel}</div>;
  }
  const cls = [
    "mini-step",
    step.error ? "err" : "",
    status === "added" ? "added" : "",
    status === "removed" ? "removed" : "",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <div className={cls}>
      <div className="mini-head">
        <Badge tone="ink">#{step.index}</Badge>
        <Badge>{step.kind}</Badge>
        <span className="mini-name">{step.name}</span>
        {step.error && <Badge tone="ember">error</Badge>}
      </div>
      <div className="mini-meta">
        {fmtMs(step.latencyMs)} · {fmtUsd(step.costUsd)}
        {step.error ? ` · ${step.error}` : ""}
      </div>
    </div>
  );
}
