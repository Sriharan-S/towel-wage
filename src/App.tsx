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
import Advances from "./pages/Advances";
import WorkerWage from "./pages/WorkerWage";
import { useRole } from "./lib/role";

// The charting library is a large dependency and only two screens need it.
// Splitting it out keeps the daily entry screen — the one opened every day on a
// phone, often on mobile data — off that download path.
const Dashboard = lazy(() => import("./pages/Dashboard"));
const WorkerDetail = lazy(() => import("./pages/WorkerDetail"));

/**
 * Keeps a manager off the admin-only screens even if they type the URL.
 *
 * The Worker refuses the requests regardless — this only avoids showing a page
 * that would sit there full of 403s.
 */
function AdminOnly({ children }: { children: React.ReactNode }) {
  const { isAdmin } = useRole();
  return isAdmin ? <>{children}</> : <Navigate to="/" replace />;
}

export default function App() {
  return (
    <AppShell>
      <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/entry" element={<DailyEntry />} />
          <Route path="/entry/:date" element={<DailyEntry />} />
          <Route path="/week/:weekStart" element={<Week />} />
          <Route path="/week/:weekStart/:workerId" element={<WorkerWage />} />
          <Route path="/advances" element={<Advances />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route
            path="/workers"
            element={
              <AdminOnly>
                <Workers />
              </AdminOnly>
            }
          />
          <Route
            path="/workers/:workerId"
            element={
              <AdminOnly>
                <WorkerDetail />
              </AdminOnly>
            }
          />
          <Route
            path="/types"
            element={
              <AdminOnly>
                <WorkTypes />
              </AdminOnly>
            }
          />
          <Route
            path="/settings"
            element={
              <AdminOnly>
                <Settings />
              </AdminOnly>
            }
          />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Suspense>
    </AppShell>
  );
}
