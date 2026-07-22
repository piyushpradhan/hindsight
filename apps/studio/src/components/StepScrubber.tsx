import type { RunStep } from "@hindsight/shared";
import { fmtMs, fmtUsd } from "../format";

interface Props {
  steps: RunStep[];
  selected: number | null;
  onSelect: (index: number) => void;
}

function tooltip(s: RunStep): string {
  const parts = [`#${s.index}`, s.kind, s.name, fmtMs(s.latencyMs), fmtUsd(s.costUsd)];
  if (s.error) parts.push("FAILED");
  return parts.join(" · ");
}

export function StepScrubber({ steps, selected, onSelect }: Props) {
  return (
    <div className="scrubber" role="tablist" aria-label="run steps">
      {steps.map((s) => {
        const cls = [
          "step-dot",
          s.kind === "tool" ? "tool" : "",
          s.error ? "failed" : "",
          selected === s.index ? "selected" : "",
        ]
          .filter(Boolean)
          .join(" ");
        return (
          <button
            key={s.spanId}
            type="button"
            className={cls}
            role="tab"
            aria-selected={selected === s.index}
            title={tooltip(s)}
            onClick={() => onSelect(s.index)}
          >
            {s.index}
          </button>
        );
      })}
    </div>
  );
}
