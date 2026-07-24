import { useEffect, useState } from "react";
import { Link, NavLink } from "react-router-dom";
import { api, MOCK_MODE, SIGNOZ_DASHBOARDS_URL } from "../api";
import { FleetStrip } from "./FleetStrip";

type EngineState = "ok" | "warn" | "down";

function EngineStatus() {
  const [state, setState] = useState<EngineState | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => {
    let alive = true;
    api
      .health()
      .then((h) => {
        if (!alive) return;
        if (h.signozAuthed === false) {
          setState("warn");
          setTitle("replay-engine up · SigNoz API key missing (SIGNOZ_API_KEY)");
        } else {
          setState("ok");
          setTitle("replay-engine up · SigNoz connected");
        }
      })
      .catch(() => {
        if (!alive) return;
        setState("down");
        setTitle("replay-engine unreachable on :4123 — start it or use ?mock=1");
      });
    return () => {
      alive = false;
    };
  }, []);

  if (!state) return null;
  return (
    <span className={`engine-status ${state}`} title={title}>
      <span className="dot" />
      engine
    </span>
  );
}

export function AppHeader() {
  return (
    <header className="app-header">
      <div className="sidebar-inner">
        <Link to="/" className="wordmark">
          <span className="wordmark-mark">H</span>
          <span>
            Hindsight
            <small>Flight recorder</small>
          </span>
        </Link>
        <nav className="nav-links" aria-label="Primary navigation">
          <NavLink to="/incidents" className={({ isActive }) => (isActive ? "active" : "")}>
            Incidents
          </NavLink>
          <NavLink to="/runs" className={({ isActive }) => (isActive ? "active" : "")}>
            Runs
          </NavLink>
        </nav>
        <div className="sidebar-section">
          <div className="sidebar-label">Fleet health</div>
          <FleetStrip />
        </div>
        <div className="sidebar-footer">
          <div className="sidebar-label">System</div>
          {MOCK_MODE ? (
            <a
              className="mock-pill"
              href="?mock=0"
              title="Studio is serving fixture data (?mock=1). Click to switch back to the live API."
            >
              <span className="dot" />
              fixture data
            </a>
          ) : (
            <EngineStatus />
          )}
          <a className="signoz-link" href={SIGNOZ_DASHBOARDS_URL} target="_blank" rel="noreferrer">
            Open SigNoz <span aria-hidden="true">↗</span>
          </a>
        </div>
      </div>
    </header>
  );
}
