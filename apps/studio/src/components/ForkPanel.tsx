import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import type { MockPolicy, Mutation, RunStep } from "@hindsight/shared";
import { api } from "../api";
import { friendlyError } from "./ErrorNote";

const MUTATION_TYPES: Mutation["type"][] = [
  "model_swap",
  "prompt_edit",
  "tool_output_override",
  "params",
  "disable_tool",
];

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
  live: "Everything live; side-effectful tools still gated behind a confirm.",
};

interface Props {
  traceId: string;
  step: RunStep;
  /** Distinct tool names seen in this run — feeds the disable_tool select. */
  tools: string[];
}

function systemPromptOf(step: RunStep): string {
  const sys = step.requestMessages?.find((m) => m.role === "system");
  if (!sys) return "";
  return typeof sys.content === "string" ? sys.content : JSON.stringify(sys.content, null, 2);
}

export function ForkPanel({ traceId, step, tools }: Props) {
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
      });
      navigate(`/compare?original=${encodeURIComponent(traceId)}&fork=${encodeURIComponent(result.forkTraceId)}`);
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

      <div className="mutation-tabs">
        {MUTATION_TYPES.map((t) => (
          <button
            key={t}
            type="button"
            className={`mtab ${t === type ? "selected" : ""}`}
            onClick={() => setType(t)}
          >
            {t}
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
        {(["strict", "hybrid", "live"] as MockPolicy[]).map((p) => (
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

      <div className="row">
        <button className="btn btn-ember" type="submit" disabled={busy}>
          {busy ? "Running fork…" : "Run fork"}
        </button>
      </div>
      {error && <div className="form-error">{error}</div>}
    </form>
  );
}
