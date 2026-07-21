import { Navigate, Route, Routes } from "react-router-dom";
import { AppHeader } from "./components/AppHeader";
import { IncidentsScreen } from "./screens/IncidentsScreen";
import { RunsScreen } from "./screens/RunsScreen";
import { RunDetailScreen } from "./screens/RunDetailScreen";
import { CompareScreen } from "./screens/CompareScreen";

export function App() {
  return (
    <div>
      <AppHeader />
      <main className="wrap">
        <Routes>
          <Route path="/" element={<Navigate to="/incidents" replace />} />
          <Route path="/incidents" element={<IncidentsScreen />} />
          <Route path="/runs" element={<RunsScreen />} />
          <Route path="/runs/:traceId" element={<RunDetailScreen />} />
          <Route path="/compare" element={<CompareScreen />} />
          <Route path="*" element={<Navigate to="/incidents" replace />} />
        </Routes>
      </main>
    </div>
  );
}
