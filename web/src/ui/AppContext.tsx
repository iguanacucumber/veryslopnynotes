import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { bridge } from "../bridge/client";
import { BridgeCallError, type ResourceKey } from "../bridge/types";
import { forceReload, type LoadSignature } from "../lib/refresh";
import { beginLoad, canUseCached, invalidateOnRequestChange, requestId, visibleResource, type ResourceStatus } from "../lib/resource";
import { cssVarsOf, paletteOf, parseScheme } from "../lib/schemes";

type Theme = "SYSTEM" | "LIGHT" | "DARK";
type NoticeKind = "info" | "error";

interface AppContextValue {
  theme: Theme;
  dark: boolean;
  setTheme: (theme: Theme) => void;
  /** Id de palette de `lib/schemes.ts` ; la variante vient de `dark`. */
  scheme: string;
  setScheme: (scheme: string) => void;
  refreshTick: number;
  refresh: () => void;
  notify: (message: string, kind?: NoticeKind) => void;
  authLost: boolean;
  /** Session ouverte : le statut lu au démarrage est périmé, sinon retour à
   *  l'écran d'appairage malgré une session native ouverte. */
  sessionOpen: boolean;
  /** Session fermée : le natif a purgé les caches, sinon l'app montrerait
   *  l'accueil vide d'un compte déconnecté. */
  sessionClosed: boolean;
  /** Ouvre la session ; annule aussi « session expirée ». */
  openSession: () => void;
  /** Ferme la session ; annule aussi « session expirée ». */
  closeSession: () => void;
  /** Keystore indisponible : session et clé de l'assistant non conservées sur
   *  l'appareil (repli mémoire). */
  storageUnavailable: boolean;
  reportStorage: (unavailable: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => {
    const stored = localStorage.getItem("vsn:theme");
    return stored === "LIGHT" || stored === "DARK" || stored === "SYSTEM" ? stored : "SYSTEM";
  });
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [scheme, setSchemeState] = useState<string>(() => parseScheme(localStorage.getItem("vsn:scheme")));
  const [refreshTick, setRefreshTick] = useState(0);
  const [authLost, setAuthLost] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const noticeTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  const [notice, setNotice] = useState<{ message: string; kind: NoticeKind; leaving: boolean } | null>(null);

  const dark = theme === "DARK" || (theme === "SYSTEM" && systemDark);
  const palette = paletteOf(scheme, dark);

  useEffect(() => {
    document.documentElement.dataset["theme"] = dark ? "dark" : "light";
  }, [dark]);

  // Palette posée en variables CSS sur `<html>` : un seul point d'écriture,
  // aucun re-rendu des écrans (elles lisent `var(--…)`).
  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(cssVarsOf(palette, dark))) {
      root.style.setProperty(name, value);
    }
  }, [palette, dark]);

  // Publiée en `data-scheme` : le skin décoratif (`styles/madoka.css`) cible
  // `:root[data-scheme="madoka"]`, les autres palettes ne voient rien.
  useEffect(() => {
    document.documentElement.dataset["scheme"] = scheme;
  }, [scheme]);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // C'est le NATIF qui répare : au rejet, il invalide la session et purge les
  // caches ; l'interface ne fait que renvoyer vers l'appairage. Appeler
  // `session.logout` ici serait une SECONDE purge, qui pourrait effacer une
  // session re-ouverte entre-temps.
  useEffect(() => {
    const onAuth = () => setAuthLost(true);
    window.addEventListener("vsn:auth", onAuth);
    return () => window.removeEventListener("vsn:auth", onAuth);
  }, []);

  // Une session rouverte annule « session expirée », levé seulement sur 401 :
  // sinon le garde-fou renverrait vers /pairing pour toujours.
  const openSession = useCallback(() => {
    setSessionOpen(true);
    setSessionClosed(false);
    setAuthLost(false);
  }, []);

  // Déconnexion : le natif a invalidé la session et purgé les caches. Sans ce
  // drapeau, l'accueil afficherait « aucune donnée en cache ».
  const closeSession = useCallback(() => {
    setSessionOpen(false);
    setSessionClosed(true);
    setAuthLost(false);
  }, []);

  // Keystore mort = repli mémoire : l'interface doit le dire, sinon l'app
  // laisse croire que tout est enregistré.
  const reportStorage = useCallback((unavailable: boolean) => {
    setStorageUnavailable(unavailable);
  }, []);

  // Notice : entrée, lecture, sortie animée. `leaving` est un état à part pour
  // que la disparition soit animée au lieu d'un retrait sec.
  const notify = useCallback((message: string, kind: NoticeKind = "info") => {
    window.clearTimeout(noticeTimer.current);
    window.clearTimeout(leaveTimer.current);
    setNotice({ message, kind, leaving: false });
    noticeTimer.current = window.setTimeout(() => {
      setNotice((current) => (current ? { ...current, leaving: true } : current));
      leaveTimer.current = window.setTimeout(() => setNotice(null), 200);
    }, 4200);
  }, []);

  useEffect(
    () => () => {
      window.clearTimeout(noticeTimer.current);
      window.clearTimeout(leaveTimer.current);
    },
    [],
  );

  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    localStorage.setItem("vsn:theme", next);
    void bridge.setTheme(next).catch(() => undefined);
  }, []);

  // Le choix de palette reste local à la WebView : c'est une couleur, pas une
  // donnée de session.
  const setScheme = useCallback((next: string) => {
    const id = parseScheme(next);
    setSchemeState(id);
    localStorage.setItem("vsn:scheme", id);
  }, []);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  const value = useMemo<AppContextValue>(
    () => ({
      theme,
      dark,
      setTheme,
      scheme,
      setScheme,
      refreshTick,
      refresh,
      notify,
      authLost,
      sessionOpen,
      sessionClosed,
      openSession,
      closeSession,
      storageUnavailable,
      reportStorage,
    }),
    [
      theme,
      dark,
      setTheme,
      scheme,
      setScheme,
      refreshTick,
      refresh,
      notify,
      authLost,
      sessionOpen,
      sessionClosed,
      openSession,
      closeSession,
      storageUnavailable,
      reportStorage,
    ],
  );

  return (
    <AppContext.Provider value={value}>
      {children}
      {notice ? (
        <div
          className={`notice${notice.kind === "error" ? " notice--error" : ""}${notice.leaving ? " notice--leaving" : ""}`}
          role={notice.kind === "error" ? "alert" : "status"}
          aria-live={notice.kind === "error" ? "assertive" : "polite"}
        >
          {notice.message}
        </div>
      ) : null}
    </AppContext.Provider>
  );
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error("AppProvider absent");
  return ctx;
}

export interface ResourceState {
  payload: string | null;
  fetchedAt: number;
  stale: boolean;
  error: string | null;
  loading: boolean;
  refresh: () => void;
}

/** Lecture offline-first : cache d'abord, puis natif. Le cache s'affiche sans
 *  spinner ; un échec le garde et expose `error`. Le payload est RATTACHÉ à sa
 *  requête : changer de requête l'invalide, même si le chargement échoue. */
export function useResource(key: ResourceKey, query = ""): ResourceState {
  const { refreshTick } = useApp();
  const request = requestId(key, query);
  const [status, setStatus] = useState<ResourceStatus>({
    request,
    payload: null,
    fetchedAt: 0,
    stale: false,
    error: null,
    loading: true,
  });
  const [manual, setManual] = useState(0);
  const alive = useRef(true);
  // Le geste est un DELTA : on retient la signature du dernier chargement.
  // Un compteur monotone forcerait à chaque ouverture d'écran, et une requête
  // nouvelle ne forcerait jamais.
  const lastLoad = useRef<LoadSignature | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Signature consommée par ce chargement : le prochain comparera à celle-ci.
    const signature: LoadSignature = { query, manual, tick: refreshTick };
    const force = forceReload(lastLoad.current, signature);
    lastLoad.current = signature;
    const run = async () => {
      // Changement de requête : l'état est vidé, le payload précédent devient
      // invalide. Même requête : le cache reste affiché pendant la relecture.
      setStatus((s) => beginLoad(s, request));
      try {
        const cached = await bridge.cached(key, query);
        if (cancelled) return;
        if (cached.payload) {
          // Le natif dit déjà si le cache est périmé (`stale`), on ne le
          // devine pas.
          setStatus({
            request,
            payload: cached.payload,
            fetchedAt: cached.fetchedAt,
            stale: cached.stale,
            error: null,
            loading: false,
          });
          // Cache frais : le natif rendrait la même donnée, on ne relit pas.
          if (canUseCached(cached, force)) return;
        }
      } catch {
        // Cache indisponible : on tente le natif.
      }
      if (cancelled) return;
      try {
        const result = await bridge.load({ key, query, force }, controller.signal);
        if (cancelled) return;
        setStatus({
          request,
          payload: result.payload,
          fetchedAt: result.fetchedAt,
          stale: result.stale,
          error: result.error,
          loading: false,
        });
      } catch (e) {
        if (cancelled) return;
        if (e instanceof BridgeCallError && e.code === "auth_required") {
          window.dispatchEvent(new Event("vsn:auth"));
        }
        setStatus((s) => ({
          // L'échec porte sur la requête COURANTE : son cache reste affiché,
          // celui d'une autre requête jamais.
          ...invalidateOnRequestChange(s, request),
          loading: false,
          error: e instanceof Error ? e.message : "lecture indisponible",
        }));
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [key, query, manual, refreshTick]);

  const refresh = useCallback(() => setManual((n) => n + 1), []);
  // La vue est PROJETÉE à chaque rendu : entre le changement de requête et
  // l'effet qui recharge, l'ancien payload est déjà invisible.
  return { ...visibleResource(status, request), refresh };
}

/** Appel ponctuel (action utilisateur, appairage, réglages). */
export function useAsync<T>() {
  const [state, setState] = useState<{ data: T | null; error: string | null; loading: boolean }>({
    data: null,
    error: null,
    loading: false,
  });
  const run = useCallback(async (fn: () => Promise<T>): Promise<T | null> => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const data = await fn();
      setState({ data, error: null, loading: false });
      return data;
    } catch (e) {
      if (e instanceof BridgeCallError && e.code === "auth_required") {
        window.dispatchEvent(new Event("vsn:auth"));
      }
      setState({ data: null, error: e instanceof Error ? e.message : "action impossible", loading: false });
      return null;
    }
  }, []);
  return { ...state, run };
}
