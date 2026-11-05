import { useEffect, useRef, useState } from "react";
import {
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useNavigationType,
} from "react-router-dom";
import { useApp } from "./AppContext";
import { bridge } from "../bridge/client";
import { Avatar } from "./components";
import { GlassBackdrop } from "./GlassBackdrop";
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
  IconBook,
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
import { scrollDecision, scrollKey, type ScrollPosition } from "./scrollMemory";

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
  "/help": { title: "Aide", back: "/settings" },
  "/about": { title: "À propos", back: "/settings" },
  "/licenses": { title: "Licences", back: "/about" },
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
export function metaFor(pathname: string): RouteMeta {
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
  const navigationType = useNavigationType();
  const navigate = useNavigate();
  const go = useViewNavigate();
  const { refresh, refreshTick, busy, notify, authLost, sessionClosed, scheme, partial } = useApp();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const titleFocusedOnce = useRef(false);
  const scrollMemory = useRef(new Map<string, number>());
  const lastScroll = useRef<ScrollPosition | null>(null);
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

  // Le navigateur restaure le scroll de traversée en parallèle du nôtre ;
  // on garde la main pour appliquer la position de l'entrée d'historique.
  useEffect(() => {
    window.history.scrollRestoration = "manual";
  }, []);

  // La position quittée n'est pas celle du rendu d'arrivée (souvent déjà 0) :
  // un écouteur passif garde `lastScroll` à jour pendant le défilement.
  useEffect(() => {
    const onScroll = () => {
      const current = lastScroll.current;
      if (!current) return;
      // La mémoire est mise à jour PENDANT le défilement : même si le nouveau
      // rendu borne `scrollY` avant l'effet de navigation, la position quittée
      // reste la dernière réellement vue.
      scrollMemory.current.set(current.key, window.scrollY);
      lastScroll.current = { ...current, y: window.scrollY };
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // POP restaure la position de l'entrée ; une query seule (semaine, période)
  // ne remonte pas l'écran ; un nouveau pathname repart en haut.
  useEffect(() => {
    const key = scrollKey(location.pathname, location.search);
    const tracked = lastScroll.current;
    // La position de l'entrée précédente vient de la mémoire de défilement,
    // pas du `scrollY` du rendu d'arrivée.
    const previous = tracked
      ? { ...tracked, y: scrollMemory.current.get(tracked.key) ?? tracked.y }
      : null;
    const decision = scrollDecision({
      navigationType,
      previous,
      key,
      pathname: location.pathname,
      saved: scrollMemory.current.get(key),
    });
    for (const entry of decision.save) scrollMemory.current.set(entry.key, entry.y);
    if (decision.restore !== null) window.scrollTo(0, decision.restore);
    lastScroll.current = {
      key,
      pathname: location.pathname,
      y: decision.restore ?? window.scrollY,
    };
  }, [location.key, location.pathname, location.search, navigationType]);

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
      {scheme === "liquid-glass" || scheme === "frutiger-aero" ? <GlassBackdrop /> : null}
      <header className={isHome ? "topbar topbar--home" : "topbar"}>
        <div className="topbar__inner">
          {isHome ? (
            <button
              type="button"
              className="topbar__identity"
              onClick={() => go("/profile")}
            >
              <span className="sr-only">Ouvrir le profil</span>
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
              <IconBook size={24} />
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
              className={`icon-btn${busy ? " icon-btn--spin" : ""}`}
              aria-label="Actualiser"
              aria-busy={busy}
              onClick={refresh}
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
        {partial ? (
          <p className="partial-notice" role="status">
            Certaines informations n’ont pas pu être lues : l’affichage est partiel.
          </p>
        ) : null}
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
