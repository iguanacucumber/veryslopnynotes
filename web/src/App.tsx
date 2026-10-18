import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { bridge } from "./bridge/client";
import type { SessionStatus } from "./bridge/types";
import { AppProvider, useApp } from "./ui/AppContext";
import { Shell } from "./ui/AppShell";
import IndexRoute from "./routes/index";
import CalendarRoute from "./routes/calendar";
import GradesRoute from "./routes/grades";
import TasksRoute from "./routes/tasks";
import ProfileRoute from "./routes/profile";
import SettingsRoute from "./routes/settings";
import PairingRoute from "./routes/pairing";
import MessagesRoute from "./routes/messages";
import AttendanceRoute from "./routes/attendance";
import SanctionsRoute from "./routes/sanctions";
import NewsRoute from "./routes/news";
import CanteenRoute from "./routes/canteen";
import AlertsRoute from "./routes/alerts";
import FichesRoute from "./routes/fiches";

function Gate({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<SessionStatus | null>(null);
  const location = useLocation();
  const navigate = useNavigate();
  const { authLost } = useApp();

  useEffect(() => {
    let alive = true;
    void bridge
      .restore()
      .then((s) => {
        if (alive) setSession(s);
      })
      .catch(() => {
        if (alive) setSession({ state: "offline", message: "téléphone injoignable" });
      });
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!session) return;
    const needsPairing = session.state === "no_session" || session.state === "dead";
    if ((needsPairing || authLost) && location.pathname !== "/pairing") {
      navigate("/pairing", { replace: true });
    }
  }, [session, authLost, location.pathname, navigate]);

  return <>{children}</>;
}

export function App() {
  return (
    <AppProvider>
      <Gate>
        <Routes>
          <Route element={<Shell />}>
            <Route path="/" element={<IndexRoute />} />
            <Route path="/calendar" element={<CalendarRoute />} />
            <Route path="/grades" element={<GradesRoute />} />
            <Route path="/tasks" element={<TasksRoute />} />
            <Route path="/profile" element={<ProfileRoute />} />
            <Route path="/settings" element={<SettingsRoute />} />
            <Route path="/messages" element={<MessagesRoute />} />
            <Route path="/attendance" element={<AttendanceRoute />} />
            <Route path="/sanctions" element={<SanctionsRoute />} />
            <Route path="/news" element={<NewsRoute />} />
            <Route path="/canteen" element={<CanteenRoute />} />
            <Route path="/alerts" element={<AlertsRoute />} />
            <Route path="/fiches" element={<FichesRoute />} />
          </Route>
          <Route path="/pairing" element={<PairingRoute />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Gate>
    </AppProvider>
  );
}
