import { useEffect, useState } from "react";
import { Link, NavLink, useLocation } from "react-router-dom";
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
          setTitle("Live data connected, but monitoring is not fully configured");
        } else {
          setState("ok");
          setTitle("Live data connected");
        }
      })
      .catch(() => {
        if (!alive) return;
        setState("down");
        setTitle("Live data connection unavailable");
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
  const isLanding = useLocation().pathname === "/";

  return (
    <header className={`app-header${isLanding ? " landing-header" : ""}`}>
      <div className="header-inner">
        <Link to="/" className="wordmark">
          <img className="wordmark-mark" src="/favicon.svg" alt="" />
          <span>
            HINDSIGHT
            <small>Flight recorder</small>
          </span>
        </Link>
        {!isLanding && (
          <nav className="nav-links" aria-label="Primary navigation">
            <NavLink to="/incidents" className={({ isActive }) => (isActive ? "active" : "")}>
              Incidents
            </NavLink>
            <NavLink to="/runs" className={({ isActive }) => (isActive ? "active" : "")}>
              Runs
            </NavLink>
          </nav>
        )}
        <div className="header-system">
          {isLanding ? (
            <>
              <a
                className="header-link landing-github"
                href="https://github.com/piyushpradhan/hindsight"
                target="_blank"
                rel="noreferrer"
              >
                GitHub <span aria-hidden="true">↗</span>
              </a>
              <Link className="btn btn-light btn-sm" to="/incidents">Open app</Link>
            </>
          ) : (
            <>
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
                SigNoz <span aria-hidden="true">↗</span>
              </a>
            </>
          )}
        </div>
      </div>
      {!isLanding && (
        <div className="header-telemetry">
          <span
            className="telemetry-label"
            title={MOCK_MODE ? "Fixture fleet totals for today" : "Live fleet totals for today"}
          >
            FLEET / TODAY{MOCK_MODE ? " / FIXTURE" : ""}
          </span>
          <FleetStrip />
        </div>
      )}
    </header>
  );
}
