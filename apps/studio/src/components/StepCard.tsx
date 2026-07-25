import type { ReactNode } from "react";
import type { ChatMessage, RunStep } from "@hindsight/shared";
import { fmtMs, fmtTokens, fmtUsd } from "../format";
import { Badge } from "./Badge";
import { JsonBlock, SmartPayload } from "./JsonBlock";

interface Props {
  step: RunStep;
  selected: boolean;
  forkOpen: boolean;
  onSelect: () => void;
  onToggleFork: () => void;
  registerRef: (el: HTMLElement | null) => void;
  forkPanel?: ReactNode;
}

function MessageView({ msg }: { msg: ChatMessage }) {
  const roleCls =
    msg.role === "system"
      ? "role-system"
      : msg.role === "user"
        ? "role-user"
        : msg.role === "assistant"
          ? "role-assistant"
          : "role-tool";
  return (
    <div className={`msg ${roleCls}`}>
      <div className={`msg-role ${roleCls}`}>{msg.role}</div>
      <SmartPayload value={msg.content} />
    </div>
  );
}

function LlmBody({ step }: { step: RunStep }) {
  return (
    <>
      <div className="section-label">request</div>
      {(step.requestMessages ?? []).map((m, i) => (
        <MessageView key={i} msg={m} />
      ))}
      <div className="section-label">response</div>
      {step.response === undefined ? (
        <p className="muted">—</p>
      ) : (
        <SmartPayload value={step.response} />
      )}
    </>
  );
}

function ToolBody({ step }: { step: RunStep }) {
  return (
    <>
      <div className="section-label">args</div>
      <JsonBlock value={step.args ?? null} />
      {step.argsHash && <div className="hash">{step.argsHash.slice(0, 19)}…</div>}
      <div className="section-label">output</div>
      {step.toolOutput === undefined ? (
        <p className="muted">—</p>
      ) : (
        <SmartPayload value={step.toolOutput} />
      )}
    </>
  );
}

export function StepCard({ step, selected, forkOpen, onSelect, onToggleFork, registerRef, forkPanel }: Props) {
  // Payloads are long, so a step stays collapsed to its head row unless it's
  // the one you're looking at or it failed — the failed step (which is selected
  // by default) opens itself, so the failure is never buried under other steps' JSON.
  const expanded = selected || !!step.error;
  const cls = ["card", "step-card", step.kind, step.error ? "failed" : "", selected ? "selected" : "", expanded ? "" : "collapsed"]
    .filter(Boolean)
    .join(" ");
  return (
    <article className={cls} ref={registerRef} data-step={step.index} id={`step-${step.index}`}>
      <button
        className="step-head"
        type="button"
        onClick={onSelect}
        aria-expanded={expanded}
        aria-label={`${expanded ? "Inspecting" : "Inspect"} step ${step.index}: ${step.name}`}
      >
        <span className={`step-caret ${expanded ? "open" : ""}`} aria-hidden="true">›</span>
        <Badge tone="ink">#{step.index}</Badge>
        <Badge>{step.kind}</Badge>
        <span className="step-title">{step.name}</span>
        <span className="spacer" />
        {step.inputTokens !== undefined && (
          <Badge>{fmtTokens(step.inputTokens)}→{fmtTokens(step.outputTokens ?? 0)} tok</Badge>
        )}
        <Badge>{fmtMs(step.latencyMs)}</Badge>
        <Badge>{fmtUsd(step.costUsd)}</Badge>
        {step.error && <Badge tone="ember">error</Badge>}
      </button>

      {expanded && (
        <>
          {step.kind === "llm" ? <LlmBody step={step} /> : <ToolBody step={step} />}

          {step.error && <div className="step-error">{step.error}</div>}

          <div className="step-actions">
            {/* Testing a branch is the product's whole point, so its trigger is the ember
                primary on the step you're looking at — quiet ghost everywhere else,
                so exactly one test invitation reads as the peak (the failed step by
                default). Once the panel is open it steps back to a close control. */}
            <button
              type="button"
              className={selected && !forkOpen ? "btn btn-ember" : "btn btn-ghost btn-sm"}
              onClick={onToggleFork}
            >
              {forkOpen
                ? "Close test panel"
                : selected
                  ? (step.error ? "Test a fix from this step →" : "Test a change from this step →")
                  : "Test a change"}
            </button>
          </div>
          {forkOpen && forkPanel}
        </>
      )}
    </article>
  );
}
