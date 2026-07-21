import type { RunStep } from "@hindsight/shared";

interface Props {
  steps: RunStep[];
  selected: number | null;
  onSelect: (index: number) => void;
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
            title={`#${s.index} ${s.kind} · ${s.name}${s.error ? " · failed" : ""}`}
            onClick={() => onSelect(s.index)}
          >
            {s.index}
          </button>
        );
      })}
    </div>
  );
}
