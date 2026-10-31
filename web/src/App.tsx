import { Component, useEffect, useState, type ReactNode } from "react";
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
import RevisionSheetsRoute from "./routes/revision-sheets";
import CourseNotesRoute from "./routes/course-notes";
import ProfRoute from "./routes/prof";

/** Écran de secours : message borné (aucune pile, aucun texte d'exception qui
 *  peut contenir une donnée scolaire), seul recours = recharger. `#main` reste
 *  la cible d'évitement même sans coquille. */
function ErrorFallback() {
  return (
    <div className="shell">
      <main id="main" tabIndex={-1} className="main">
        <div className="card card--danger" role="alert">
          <h1 className="t-headline" style={{ margin: 0 }}>
            L’interface n’a pas pu s’afficher
          </h1>
          <p className="t-body-m" style={{ margin: "8px 0 16px", color: "var(--danger-ink)" }}>
            Une erreur inattendue a interrompu le rendu. Recharge l’application pour reprendre.
          </p>
          <button type="button" className="btn" onClick={() => window.location.reload()}>
            Recharger
          </button>
        </div>
      </main>
    </div>
  );
}

/** Boundary global : jamais de WebView blanche, et le message de l'exception
 *  n'est jamais rendu (il peut contenir une donnée scolaire). En DEV, une
 *  ligne bornée au journal. */
class ErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError(): { failed: boolean } {
    return { failed: true };
  }

  componentDidCatch(): void {
    if (import.meta.env.DEV) {
      console.error("ErrorBoundary : rendu interrompu, écran de secours affiché.");
    }
  }

  render() {
    return this.state.failed ? <ErrorFallback /> : this.props.children;
  }
}

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
        // Le statut porte l'état du stockage chiffré : Keystore mort = dégradé
        // (rien n'est conservé), l'interface l'affiche.
        reportStorage(storageUnavailable(s));
      })
      .catch(() => {
        if (alive) setSession({ state: "offline", message: "téléphone injoignable" });
      });
    return () => {
      alive = false;
    };
  }, [reportStorage]);

  // Le statut lu au démarrage est périmé après appairage ou déconnexion :
  // sans ces drapeaux, retour à /pairing à tort ou accueil d'un compte fermé.
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
    <ErrorBoundary>
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
              <Route path="/revision-sheets" element={<RevisionSheetsRoute />} />
              <Route path="/course-notes" element={<CourseNotesRoute />} />
              <Route path="/prof" element={<ProfRoute />} />
              {/* Alias : anciens liens profonds et routes enregistrées. */}
              <Route path="/fiches" element={<Navigate to="/revision-sheets" replace />} />
              <Route path="/cahier" element={<Navigate to="/course-notes" replace />} />
            </Route>
            <Route path="/pairing" element={<PairingRoute />} />
            <Route path="*" element={<Navigate to="/" replace />} />
          </Routes>
        </Gate>
      </AppProvider>
    </ErrorBoundary>
  );
}
