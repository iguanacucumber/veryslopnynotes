import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import { bridge } from "../bridge/client";
import { BridgeCallError, type ResourceKey } from "../bridge/types";
import { forceReload, type LoadSignature } from "../lib/refresh";
import { cssVarsOf, paletteOf, parseScheme } from "../lib/schemes";

type Theme = "SYSTEM" | "LIGHT" | "DARK";
type NoticeKind = "info" | "error";

interface AppContextValue {
  theme: Theme;
  dark: boolean;
  setTheme: (theme: Theme) => void;
  /** Palette (#335) : id de `lib/schemes.ts`, variante donnée par `dark`. */
  scheme: string;
  setScheme: (scheme: string) => void;
  refreshTick: number;
  refresh: () => void;
  notify: (message: string, kind?: NoticeKind) => void;
  authLost: boolean;
  /**
   * Une session est ouverte (appairage réussi). Le statut lu au démarrage
   * est alors périmé : sans ce drapeau, l'app renverrait vers l'écran
   * d'appairage alors que la session native est ouverte (#357).
   */
  sessionOpen: boolean;
  /**
   * La session a été fermée (déconnexion) : le natif a invalidé la session
   * et purgé les caches. Sans ce drapeau, l'app afficherait l'accueil d'un
   * compte déconnecté (« aucune donnée en cache ») au lieu de renvoyer vers
   * l'appairage (#360).
   */
  sessionClosed: boolean;
  /** Ouvre la session (appairage réussi) : annule aussi « session expirée ». */
  openSession: () => void;
  /** Ferme la session (déconnexion) : annule aussi « session expirée ». */
  closeSession: () => void;
  /**
   * Le stockage CHIFFRÉ est indisponible (Keystore mort) : la session et la
   * clé de l'assistant ne sont PAS conservées sur l'appareil. Sans ce
   * signal, l'app croyait ne pas être appairée, sans explication (#401).
   */
  storageUnavailable: boolean;
  /** Signale l'état du stockage lu au démarrage. */
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

  // La palette est posée en variables CSS sur `<html>` : un seul point
  // d'écriture, aucun re-rendu des écrans (elles lisent `var(--…)`).
  useEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(cssVarsOf(palette, dark))) {
      root.style.setProperty(name, value);
    }
  }, [palette, dark]);

  useEffect(() => {
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = (e: MediaQueryListEvent) => setSystemDark(e.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  // #397 : c'est le NATIF qui répare, pas l'interface. Au moment du rejet
  // (jeton tourné), le pont invalide la session ET purge les caches par le
  // chemin EXISTANT (`accounts.logout()`), puis la réponse porte
  // `auth_required` : l'interface n'a plus qu'à renvoyer vers l'appairage.
  // Appeler `session.logout` depuis ici serait une SECONDE purge, en retard
  // sur le rejeu — elle pourrait même effacer une session re-ouverte
  // entre-temps (l'app se ré-appaire).
  useEffect(() => {
    const onAuth = () => setAuthLost(true);
    window.addEventListener("vsn:auth", onAuth);
    return () => window.removeEventListener("vsn:auth", onAuth);
  }, []);

  // Une session rouverte (appairage) annule l'état « session expirée » : il
  // n'est levé que sur 401, jamais reposté. Sans cette remise à zéro, le
  // garde-fou renverrait vers /pairing pour toujours (#357).
  const openSession = useCallback(() => {
    setSessionOpen(true);
    setSessionClosed(false);
    setAuthLost(false);
  }, []);

  // Déconnexion : la session est fermée pour de vrai côté natif (session
  // invalidée, caches purgés). L'interface doit le savoir : le statut lu au
  // démarrage disait « session vivante », sinon l'accueil afficherait
  // « aucune donnée en cache » pour un compte déconnecté (#360).
  const closeSession = useCallback(() => {
    setSessionOpen(false);
    setSessionClosed(true);
    setAuthLost(false);
  }, []);

  // Le stockage chiffré est PUBLIE par le natif au démarrage (Keystore
  // mort -> repli mémoire) : l'interface doit le dire, sinon l'app laisse
  // croire que tout est enregistré alors que rien ne l'est (#401).
  const reportStorage = useCallback((unavailable: boolean) => {
    setStorageUnavailable(unavailable);
  }, []);

  // Notice : entrée, temps de lecture, sortie animée (#336). La sortie est un
  // état à part pour que la disparition soit animée au lieu d'un retrait sec.
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

  // Le choix de palette reste local à la WebView (#335) : c'est une couleur,
  // pas une donnée de session, et le natif n'a pas à la connaître.
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

/** Lecture offline-first : cache d'abord, puis réseau natif. Le cache est
 *  affiché sans spinner ; un échec garde le cache et expose `error`. */
export function useResource(key: ResourceKey, query = ""): ResourceState {
  const { refreshTick } = useApp();
  const [state, setState] = useState<Omit<ResourceState, "refresh">>({
    payload: null,
    fetchedAt: 0,
    stale: false,
    error: null,
    loading: true,
  });
  const [manual, setManual] = useState(0);
  const alive = useRef(true);
  // #365 : le geste est un DELTA. On retient la signature du dernier
  // chargement : forcer = le geste ou la requête a changé DEPUIS. Un compteur
  // jamais remis à zéro forcerait à chaque ouverture d'écran (le compteur
  // `manual`/`refreshTick` est monotone), et une requête nouvelle ne forcerait
  // jamais.
  const lastLoad = useRef<LoadSignature | null>(null);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Signature consommée par ce chargement : le prochain comparera à celle-ci.
    const signature: LoadSignature = { query, manual, tick: refreshTick };
    const force = forceReload(lastLoad.current, signature);
    lastLoad.current = signature;
    const run = async () => {
      setState((s) => (s.payload ? s : { ...s, loading: true }));
      try {
        const cached = await bridge.cached(key, query);
        if (!cancelled && cached.payload) {
          // Le cache frais ne doit pas faire clignoter « hors-ligne » : le
          // natif dit déjà s'il est périmé (`stale`), on ne le devine pas.
          setState({
            payload: cached.payload,
            fetchedAt: cached.fetchedAt,
            stale: cached.stale,
            error: null,
            loading: false,
          });
        }
      } catch {
        // cache indisponible : on tente le natif
      }
      try {
        const result = await bridge.load({ key, query, force });
        if (cancelled) return;
        setState({
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
        setState((s) => ({
          ...s,
          loading: false,
          error: e instanceof Error ? e.message : "lecture indisponible",
        }));
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [key, query, manual, refreshTick]);

  const refresh = useCallback(() => setManual((n) => n + 1), []);
  return { ...state, refresh };
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
