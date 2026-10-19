import { useEffect, useState, type ReactNode } from "react";
import { Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import { bridge } from "./bridge/client";
import type { SessionStatus } from "./bridge/types";
import { AppProvider, useApp } from "./ui/AppContext";
import { Shell } from "./ui/AppShell";
import { mustPair, storageUnavailable } from "./lib/session";
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
  const { authLost, sessionOpen, sessionClosed, reportStorage } = useApp();

  useEffect(() => {
    let alive = true;
    void bridge
      .restore()
      .then((s) => {
        if (!alive) return;
        setSession(s);
        // #401 : le statut porte l'état du stockage chiffré. Un Keystore
        // mort est un état dégradé (rien n'est conservé) : l'interface
        // l'affiche au lieu de croire en silence que tout va bien.
        reportStorage(storageUnavailable(s));
      })
      .catch(() => {
        if (alive) setSession({ state: "offline", message: "téléphone injoignable" });
      });
    return () => {
      alive = false;
    };
  }, [reportStorage]);

  // Un appairage réussi ouvre la session : le statut lu au démarrage
  // (« pas de session ») est périmé. Sans cette information, le garde-fou
  // ci-dessous renverrait l'utilisateur vers /pairing alors que la session
  // native est ouverte — il faudrait redémarrer l'app pour sortir (#357).
  // Symétriquement, une déconnexion ferme la session : le statut lu au
  // démarrage (« session vivante ») est périmé, il faut ré-appairer (#360).
  useEffect(() => {
    if (location.pathname === "/pairing") return;
    if (mustPair({ status: session, open: sessionOpen, expired: authLost, closed: sessionClosed })) {
      navigate("/pairing", { replace: true });
    }
  }, [session, sessionOpen, authLost, sessionClosed, location.pathname, navigate]);

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
