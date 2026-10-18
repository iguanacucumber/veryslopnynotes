import { useEffect } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "./AppContext";
import { IconBack, IconBell, IconCalendar, IconGrades, IconHome, IconRefresh, IconTasks, IconUser } from "./icons";

interface RouteMeta {
  title: string;
  back?: string;
  tab?: boolean;
}

export const ROUTE_META: Record<string, RouteMeta> = {
  "/": { title: "Accueil", tab: true },
  "/calendar": { title: "Cours", tab: true },
  "/tasks": { title: "Tâches", tab: true },
  "/grades": { title: "Notes", tab: true },
  "/profile": { title: "Profil", back: "/" },
  "/settings": { title: "Réglages", back: "/profile" },
  "/news": { title: "Actualités", back: "/" },
  "/canteen": { title: "Cantine", back: "/" },
  "/attendance": { title: "Vie scolaire", back: "/profile" },
  "/sanctions": { title: "Sanctions", back: "/attendance" },
  "/messages": { title: "Messagerie", back: "/profile" },
  "/alerts": { title: "Alertes", back: "/" },
  "/fiches": { title: "Fiches de révision", back: "/profile" },
};

const TABS = [
  { to: "/", label: "Accueil", Icon: IconHome },
  { to: "/calendar", label: "Cours", Icon: IconCalendar },
  { to: "/tasks", label: "Tâches", Icon: IconTasks },
  { to: "/grades", label: "Notes", Icon: IconGrades },
];

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const { refresh, notify, authLost } = useApp();
  const meta = ROUTE_META[location.pathname] ?? { title: "VerySlopyNyNotes" };

  useEffect(() => {
    if (authLost && location.pathname !== "/pairing") {
      notify("Session expirée : rescanne le QR de l’établissement.", "error");
      navigate("/pairing", { replace: true });
    }
  }, [authLost, location.pathname, navigate, notify]);

  return (
    <div className="shell">
      <header className="topbar">
        {meta.back ? (
          <button
            type="button"
            className="icon-btn"
            aria-label="Retour"
            onClick={() => {
              if (window.history.length > 1) navigate(-1);
              else navigate(meta.back!);
            }}
          >
            <IconBack />
          </button>
        ) : null}
        <h1 className="topbar__title t-title" style={{ margin: 0 }}>
          {meta.title}
        </h1>
        <div className="topbar__actions">
          <button type="button" className="icon-btn" aria-label="Actualiser" onClick={refresh}>
            <IconRefresh />
          </button>
          <button type="button" className="icon-btn" aria-label="Alertes" onClick={() => navigate("/alerts")}>
            <IconBell />
          </button>
          <button
            type="button"
            className="icon-btn icon-btn--accent"
            aria-label="Profil"
            onClick={() => navigate("/profile")}
          >
            <IconUser />
          </button>
        </div>
      </header>

      <main className="main">
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Navigation principale">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink key={to} to={to} end={to === "/"} className="tab">
            <Icon size={22} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
