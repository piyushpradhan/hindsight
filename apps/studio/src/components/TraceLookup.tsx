import { useState } from "react";
import type { FormEvent } from "react";
import { useNavigate } from "react-router-dom";

export function TraceLookup() {
  const [value, setValue] = useState("");
  const navigate = useNavigate();

  const open = (e: FormEvent) => {
    e.preventDefault();
    const traceId = value.trim();
    if (traceId) navigate(`/runs/${traceId}`);
  };

  return (
    <div className="lookup-block">
      <form className="trace-lookup" onSubmit={open}>
        <input
          className="input"
          placeholder="Paste trace ID"
          aria-label="SigNoz trace ID"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          spellCheck={false}
        />
        <button className="btn btn-ghost" type="submit">
          Open trace
        </button>
      </form>
    </div>
  );
}
