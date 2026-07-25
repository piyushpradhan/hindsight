import { Link, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { IncidentsScreen } from "./screens/IncidentsScreen";
import { RunsScreen } from "./screens/RunsScreen";
import { RunDetailScreen } from "./screens/RunDetailScreen";
import { CompareScreen } from "./screens/CompareScreen";
import { LandingPage } from "./screens/LandingPage";

export function App() {
  return (
    <div className="app-shell">
      <a className="skip-link" href="#main-content">Skip to content</a>
      <AppHeader />
      <main className="app-main" id="main-content">
        <Routes>
          <Route path="/" element={<LandingPage />} />
          <Route path="/incidents" element={<IncidentsScreen />} />
          <Route path="/runs" element={<RunsScreen />} />
          <Route path="/runs/:traceId" element={<RunDetailScreen />} />
          <Route path="/compare" element={<CompareScreen />} />
          <Route
            path="*"
            element={
              <div className="page not-found">
                <div className="eyebrow">404 / Route not found</div>
                <h1>This trace goes nowhere.</h1>
                <p className="page-sub">The page moved, or the address was never recorded.</p>
                <Link className="btn btn-light" to="/">Return home</Link>
              </div>
            }
          />
        </Routes>
      </main>
    </div>
  );
}
