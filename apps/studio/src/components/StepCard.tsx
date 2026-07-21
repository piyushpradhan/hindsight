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
    <div className="msg">
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
  const cls = ["card", "step-card", step.error ? "failed" : "", selected ? "selected" : ""]
    .filter(Boolean)
    .join(" ");
  return (
    <article className={cls} ref={registerRef} data-step={step.index}>
      <div className="step-head" onClick={onSelect}>
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
      </div>

      {step.kind === "llm" ? <LlmBody step={step} /> : <ToolBody step={step} />}

      {step.error && <div className="step-error">{step.error}</div>}

      <div className="step-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={onToggleFork}>
          {forkOpen ? "Close fork panel" : "Fork from this step"}
        </button>
      </div>
      {forkOpen && forkPanel}
    </article>
  );
}
