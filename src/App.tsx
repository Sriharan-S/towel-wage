import { Suspense, lazy } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { AppShell } from "./components/layout/AppShell";
import { Spinner } from "./components/ui";
import DailyEntry from "./pages/DailyEntry";
import Week from "./pages/Week";
import Workers from "./pages/Workers";
import WorkTypes from "./pages/WorkTypes";
import HistoryPage from "./pages/History";
import Settings from "./pages/Settings";

// The charting library is a large dependency and only two screens need it.
// Splitting it out keeps the daily entry screen — the one opened every day on a
// phone, often on mobile data — off that download path.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const WorkerDetail = lazy(() => import("./pages/WorkerDetail"));

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/entry" element={<DailyEntry />} />
          <Route path="/entry/:date" element={<DailyEntry />} />
          <Route path="/week/:weekStart" element={<Week />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/workers" element={<Workers />} />
          <Route path="/workers/:workerId" element={<WorkerDetail />} />
          <Route path="/types" element={<WorkTypes />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
