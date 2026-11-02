import { useEffect, useRef, useState } from "react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useApp } from "./AppContext";
import { bridge } from "../bridge/client";
import { Avatar } from "./components";
import { HomeWallpaper } from "./HomeWallpaper";
import { isCurrentWeek, weekStartFromParam } from "../features/timetable/week";
import {
  isSafePhotoDataUrl,
  parseProfilePayload,
  profileSubtitle,
  type Profile,
} from "../features/profile/model";
import {
  IconBack,
  IconButterfly,
  IconCalendar,
  IconChevronDown,
  IconGrades,
  IconHome,
  IconRefresh,
  IconSettings,
  IconSparkles,
  IconTasks,
  IconUser,
} from "./icons";
import { useViewNavigate } from "./viewTransition";

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
  "/messages/new": { title: "Nouveau message", back: "/messages" },
  "/messages/:id": { title: "Discussion", back: "/messages" },
  "/alerts": { title: "Alertes", back: "/" },
  "/revision-sheets": { title: "Révisions", back: "/profile" },
  "/course-notes": { title: "Cahier", back: "/profile" },
  "/prof": { title: "Professeur", tab: true },
};

/** Le fil porte un id : la table exacte ne peut pas le nommer. */
function metaFor(pathname: string): RouteMeta {
  return (
    ROUTE_META[pathname] ??
    (pathname.startsWith("/messages/") ? ROUTE_META["/messages/:id"]! : { title: "VerySlopyNyNotes" })
  );
}

const TABS = [
  { to: "/", label: "Accueil", Icon: IconHome },
  { to: "/calendar", label: "Cours", Icon: IconCalendar },
  { to: "/tasks", label: "Tâches", Icon: IconTasks },
  { to: "/grades", label: "Notes", Icon: IconGrades },
  { to: "/prof", label: "Prof", Icon: IconSparkles },
];

export function Shell() {
  const location = useLocation();
  const navigate = useNavigate();
  const go = useViewNavigate();
  const { refresh, refreshTick, notify, authLost, sessionClosed } = useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleFocusedOnce = useRef(false);
  const isHome = location.pathname === "/";
  const meta = metaFor(location.pathname);
  // Papillon nomme l'en-tête par son contenu : la date pour le calendrier.
  // Les notes portent leur période dans les contrôles, pas deux fois.
  const now = new Date();
  const calendarWeek = weekStartFromParam(new URLSearchParams(location.search).get("week"), now);
  const calendarTitle = calendarWeek.toLocaleDateString("fr-FR", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const headerTitle =
    location.pathname === "/calendar"
      ? calendarTitle.charAt(0).toUpperCase() + calendarTitle.slice(1)
      : meta.title;
  const headerSubtitle =
    location.pathname === "/calendar" && isCurrentWeek(calendarWeek, now)
      ? "Aujourd’hui"
      : undefined;
  const identitySub = profile ? profileSubtitle(profile) : "";

  // Le focus passe au titre pour qu'un lecteur d'écran annonce la page, sauf
  // au premier rendu.
  useEffect(() => {
    let alive = true;
    void bridge
      .me()
      .then((result) => {
        if (alive) setProfile(parseProfilePayload(result.payload));
      })
      .catch(() => {
        if (alive) setProfile(null);
      });
    void bridge
      .photo()
      .then((result) => {
        if (alive) setPhoto(isSafePhotoDataUrl(result.dataUrl) ? result.dataUrl : null);
      })
      .catch(() => {
        if (alive) setPhoto(null);
      });
    return () => {
      alive = false;
    };
  }, [refreshTick]);

  useEffect(() => {
    document.title = `${meta.title} · VerySlopyNyNotes`;
    if (!titleFocusedOnce.current) {
      titleFocusedOnce.current = true;
      return;
    }
    titleRef.current?.focus({ preventScroll: true });
  }, [location.pathname, meta.title]);

  // Seul le CHANGEMENT D'ÉCRAN remonte la page : changer de semaine est une
  // query, pas une nouvelle page. Le focus du titre reste en `preventScroll`.
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [location.pathname]);

  useEffect(() => {
    // Session fermée par l'utilisateur ≠ session expirée : le bandeau
    // « session expirée » mentirait.
    if (!authLost || sessionClosed) return;
    if (location.pathname !== "/pairing") {
      notify("Session expirée : rescanne le QR de l'établissement.", "error");
      navigate("/pairing", { replace: true });
    }
  }, [authLost, sessionClosed, location.pathname, navigate, notify]);

  return (
    <div className={isHome ? "shell shell--home" : "shell"}>
      {isHome ? <HomeWallpaper /> : null}
      <header className={isHome ? "topbar topbar--home" : "topbar"}>
        <div className="topbar__inner">
          {isHome ? (
            <button
              type="button"
              className="topbar__identity"
              aria-label="Ouvrir le profil"
              onClick={() => go("/profile")}
            >
              <Avatar name={profile?.displayName ?? "?"} size={40} src={photo} />
              <span className="topbar__identity-text">
                <span className="topbar__identity-name">{profile?.displayName ?? "Mon relevé"}</span>
                {identitySub ? (
                  <span className="topbar__identity-sub">{identitySub}</span>
                ) : null}
              </span>
              <IconChevronDown className="topbar__chevron" size={20} />
            </button>
          ) : meta.back ? (
            <button
              type="button"
              className="icon-btn"
              aria-label="Retour"
              onClick={() => {
                // Entrée initiale (deep link, restauration) : `back` de la
                // route, pas un historique qui peut sortir de l'app.
                if (location.key !== "default" && window.history.length > 1) go(-1);
                else go(meta.back!);
              }}
            >
              <IconBack size={24} />
            </button>
          ) : meta.tab ? (
            <span className="topbar__mark" aria-hidden="true">
              <IconButterfly size={24} />
            </span>
          ) : null}
          <div className="topbar__heading">
            <h1
              ref={titleRef}
              tabIndex={-1}
              className={isHome ? "sr-only" : "topbar__title"}
            >
              {isHome ? meta.title : headerTitle}
            </h1>
            {!isHome && headerSubtitle ? (
              <span className="topbar__subtitle">{headerSubtitle}</span>
            ) : null}
          </div>
          <div className="topbar__actions">
            <button
              type="button"
              className={`icon-btn${spinning ? " icon-btn--spin" : ""}`}
              aria-label="Actualiser"
              onClick={() => {
                refresh();
                setSpinning(true);
                window.setTimeout(() => setSpinning(false), 650);
              }}
            >
              <IconRefresh size={isHome ? 26 : 24} />
            </button>
            {isHome ? (
              <button
                type="button"
                className="icon-btn icon-btn--accent"
                aria-label="Réglages"
                onClick={() => go("/settings")}
              >
                <IconSettings size={26} />
              </button>
            ) : location.pathname !== "/profile" ? (
              <button
                type="button"
                className="icon-btn icon-btn--accent"
                aria-label="Profil"
                onClick={() => go("/profile")}
              >
                <IconUser size={24} />
              </button>
            ) : null}
          </div>
        </div>
      </header>

      <main id="main" tabIndex={-1} className={isHome ? "main main--home" : "main"}>
        <Outlet />
      </main>

      <nav className="tabbar" aria-label="Navigation principale">
        {TABS.map(({ to, label, Icon }) => (
          <NavLink
            key={to}
            to={to}
            end={to === "/"}
            className="tab"
            onClick={(event) => {
              if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
              event.preventDefault();
              go(to);
            }}
          >
            <Icon size={24} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
