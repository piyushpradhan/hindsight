import { useEffect, useRef, useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type {
  CheckpointReport,
  ForkRunnerCapability,
  MockPolicy,
  Mutation,
  RunStep,
} from "@hindsight/shared";
import { api } from "../api";
import { friendlyError } from "./ErrorNote";

const MUTATION_TYPES: Mutation["type"][] = [
  "model_swap",
  "prompt_edit",
  "tool_output_override",
  "params",
  "disable_tool",
];

const MUTATION_LABELS: Record<Mutation["type"], string> = {
  model_swap: "Swap model",
  prompt_edit: "Edit prompt",
  tool_output_override: "Override tool output",
  params: "Params",
  disable_tool: "Disable tool",
};

const MODEL_SUGGESTIONS = [
  "claude-haiku-4-5",
  "claude-sonnet-4-5",
  "claude-opus-4-5",
  "gpt-4o-mini",
  "gpt-4o",
];

const POLICY_HINTS: Record<MockPolicy, string> = {
  strict: "All tools answered from recordings (args-hash match). Unmatched call → fail fast. Pure test of the model's reasoning.",
  hybrid: "Hash match → mock. No match → run live if the tool is safe; side-effectful tools (send, write, pay) return a dry-run stub.",
};

interface Props {
  traceId: string;
  agentId: string;
  agentRevision?: string;
  checkpoint?: CheckpointReport;
  incidentId?: string;
  step: RunStep;
  /** Distinct tool names seen in this run — feeds the disable_tool select. */
  tools: string[];
}

function systemPromptOf(step: RunStep): string {
  const sys = step.requestMessages?.find((m) => m.role === "system");
  if (!sys) return "";
  return typeof sys.content === "string" ? sys.content : JSON.stringify(sys.content, null, 2);
}

export function ForkPanel({
  traceId,
  agentId,
  agentRevision,
  checkpoint,
  incidentId,
  step,
  tools,
}: Props) {
  const navigate = useNavigate();
  const [type, setType] = useState<Mutation["type"]>(
    step.kind === "tool" && step.error ? "tool_output_override" : "model_swap",
  );
  const [model, setModel] = useState(step.model ?? "");
  const [prompt, setPrompt] = useState(() => systemPromptOf(step));
  const [outputText, setOutputText] = useState(() => {
    if (step.kind === "tool" && step.toolOutput !== undefined) {
      return typeof step.toolOutput === "string"
        ? step.toolOutput
        : JSON.stringify(step.toolOutput, null, 2);
    }
    return "";
  });
  const [temperature, setTemperature] = useState(
    step.temperature !== undefined ? String(step.temperature) : "",
  );
  const [maxTokens, setMaxTokens] = useState("");
  const [toolName, setToolName] = useState(step.toolName ?? "");
  const [policy, setPolicy] = useState<MockPolicy>("hybrid");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [runner, setRunner] = useState<ForkRunnerCapability | null>(null);
  const [capabilitiesLoaded, setCapabilitiesLoaded] = useState(false);
  const idempotencyKey = useRef(crypto.randomUUID());

  useEffect(() => {
    let alive = true;
    api.capabilities()
      .then((capabilities) => {
        if (!alive) return;
        setRunner(
          capabilities.runners.find(
            (candidate) =>
              candidate.agentId === agentId &&
              (!agentRevision || candidate.revision === agentRevision),
          ) ?? null,
        );
        setCapabilitiesLoaded(true);
      })
      .catch((err) => {
        if (!alive) return;
        setError(friendlyError(err).title);
        setCapabilitiesLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [agentId, agentRevision]);

  const mutationTypes = MUTATION_TYPES.filter(
    (candidate) =>
      runner?.mutations.includes(candidate) &&
      (candidate !== "tool_output_override" || step.kind === "tool"),
  );
  useEffect(() => {
    if (mutationTypes.length > 0 && !mutationTypes.includes(type)) {
      setType(mutationTypes[0]);
    }
  }, [mutationTypes, type]);

  const canFork =
    capabilitiesLoaded &&
    runner?.available === true &&
    checkpoint?.complete === true &&
    mutationTypes.length > 0;

  const replayNote =
    step.index <= 0
      ? "The registered agent runtime starts at step #0 with recorded tool dependencies."
      : `The runner rebuilds recorded state before #${step.index}, then executes the branch with the selected policy.`;

  const buildMutation = (): Mutation => {
    switch (type) {
      case "model_swap": {
        if (!model.trim()) throw new Error("model is required for model_swap");
        return { type, model: model.trim() };
      }
      case "prompt_edit": {
        if (!prompt.trim()) throw new Error("new system prompt is required for prompt_edit");
        return { type, newSystemPrompt: prompt };
      }
      case "tool_output_override": {
        let output: unknown;
        try {
          output = JSON.parse(outputText);
        } catch (e) {
          throw new Error(`tool output is not valid JSON: ${(e as Error).message}`);
        }
        return { type, stepIndex: step.index, output };
      }
      case "params": {
        const t = temperature.trim() === "" ? undefined : Number(temperature);
        const m = maxTokens.trim() === "" ? undefined : Number(maxTokens);
        if (t === undefined && m === undefined) throw new Error("set temperature and/or maxTokens");
        if (t !== undefined && Number.isNaN(t)) throw new Error("temperature must be a number");
        if (m !== undefined && (!Number.isInteger(m) || m <= 0)) throw new Error("maxTokens must be a positive integer");
        return { type, temperature: t, maxTokens: m };
      }
      case "disable_tool": {
        if (!toolName.trim()) throw new Error("pick a tool to disable");
        return { type, toolName: toolName.trim() };
      }
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    let mutation: Mutation;
    try {
      mutation = buildMutation();
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setBusy(true);
    try {
      const result = await api.createFork({
        traceId,
        forkAtStep: step.index,
        mutation,
        mockPolicy: policy,
        incidentId,
        idempotencyKey: idempotencyKey.current,
      });
      navigate(
        `/compare?original=${encodeURIComponent(traceId)}&fork=${encodeURIComponent(result.forkTraceId)}`,
        { state: { verification: result.verification } },
      );
    } catch (err) {
      const info = friendlyError(err);
      setError(info.hint ? `${info.title} — ${info.hint}` : info.title);
      setBusy(false);
    }
  };

  return (
    <form className="fork-panel" onSubmit={submit}>
      <div className="fork-context">
        fork at step #{step.index} — state is rebuilt up to (not including) this step; exactly one
        mutation is applied.
      </div>

      <div className="policy-hint">
        checkpoint {checkpoint?.complete ? "complete" : "incomplete"} · schema{" "}
        {checkpoint?.schemaVersion ?? "unknown"} · revision {agentRevision ?? "unknown"} · runner{" "}
        {!capabilitiesLoaded ? "checking…" : runner?.available ? "available" : "unavailable"}
      </div>
      {!checkpoint?.complete && (
        <div className="form-error">
          Fork disabled: {checkpoint?.issues.map((issue) => issue.detail).join("; ") || "checkpoint evidence is missing"}.
        </div>
      )}
      {capabilitiesLoaded && !runner?.available && (
        <div className="form-error">
          Fork disabled: no available runner matches {agentId} revision{" "}
          {agentRevision ?? "unknown"}.
        </div>
      )}
      {capabilitiesLoaded && runner?.available && mutationTypes.length === 0 && (
        <div className="form-error">
          Fork disabled: this runner has no supported mutation for the selected step.
        </div>
      )}

      <div className="mutation-tabs">
        {mutationTypes.map((t) => (
          <button
            key={t}
            type="button"
            className={`mtab ${t === type ? "selected" : ""}`}
            onClick={() => setType(t)}
          >
            {MUTATION_LABELS[t]}
          </button>
        ))}
      </div>

      <div className="fork-grid">
        {type === "model_swap" && (
          <div>
            <label className="field-label" htmlFor="fork-model">model</label>
            <input
              id="fork-model"
              className="input"
              list="model-suggestions"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="claude-sonnet-4-5"
              spellCheck={false}
            />
            <datalist id="model-suggestions">
              {MODEL_SUGGESTIONS.map((m) => (
                <option key={m} value={m} />
              ))}
            </datalist>
          </div>
        )}

        {type === "prompt_edit" && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="field-label" htmlFor="fork-prompt">new system prompt</label>
            <textarea
              id="fork-prompt"
              className="input"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="You are ResearchAgent. …"
            />
          </div>
        )}

        {type === "tool_output_override" && (
          <div style={{ gridColumn: "1 / -1" }}>
            <label className="field-label" htmlFor="fork-output">
              override output for step #{step.index} (JSON)
            </label>
            <textarea
              id="fork-output"
              className="input"
              value={outputText}
              onChange={(e) => setOutputText(e.target.value)}
              placeholder='{"result": 21382.34}'
              spellCheck={false}
            />
            {step.kind !== "tool" && (
              <div className="policy-hint">
                note: step #{step.index} is an llm step — overrides usually target a tool step.
              </div>
            )}
          </div>
        )}

        {type === "params" && (
          <>
            <div>
              <label className="field-label" htmlFor="fork-temp">temperature</label>
              <input
                id="fork-temp"
                className="input"
                type="number"
                step="0.1"
                min="0"
                max="2"
                value={temperature}
                onChange={(e) => setTemperature(e.target.value)}
                placeholder="0"
              />
            </div>
            <div>
              <label className="field-label" htmlFor="fork-max-tokens">max tokens</label>
              <input
                id="fork-max-tokens"
                className="input"
                type="number"
                step="1"
                min="1"
                value={maxTokens}
                onChange={(e) => setMaxTokens(e.target.value)}
                placeholder="1024"
              />
            </div>
          </>
        )}

        {type === "disable_tool" && (
          <div>
            <label className="field-label" htmlFor="fork-tool">tool to disable</label>
            {tools.length > 0 ? (
              <select
                id="fork-tool"
                className="input"
                value={toolName}
                onChange={(e) => setToolName(e.target.value)}
              >
                <option value="" disabled>
                  select a tool…
                </option>
                {tools.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            ) : (
              <div className="policy-hint">this run has no tool steps to disable.</div>
            )}
          </div>
        )}
      </div>

      <label className="field-label">mock policy</label>
      <div className="radio-row">
        {(["strict", "hybrid"] as MockPolicy[]).map((p) => (
          <label key={p} className={`radio-pill ${policy === p ? "selected" : ""}`}>
            <input
              type="radio"
              name="mock-policy"
              value={p}
              checked={policy === p}
              onChange={() => setPolicy(p)}
            />
            {p}
          </label>
        ))}
      </div>
      <div className="policy-hint">{POLICY_HINTS[policy]}</div>

      <div className="fork-run">
        <button className="btn btn-ember" type="submit" disabled={busy || !canFork}>
          {busy ? "Running fork…" : "Run fork"}
        </button>
        <span className="fork-run-note">{replayNote}</span>
      </div>
      {error && <div className="form-error">{error}</div>}
    </form>
  );
}
