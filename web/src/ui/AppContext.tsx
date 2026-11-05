import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import type { ReactNode } from "react";
import { bridge } from "../bridge/client";
import { BridgeCallError, type ResourceKey, type SessionStatus, type TextSizeChoice } from "../bridge/types";
import { beginBusy, isBusy, subscribeBusy } from "../lib/busy";
import { clearNewsReadIds } from "../features/news/readState";
import { failureCause, isFreshnessCause, isOnline, type FreshnessCause } from "../lib/freshness";
import { forceReload, type LoadSignature } from "../lib/refresh";
import { beginLoad, canUseCached, invalidateOnRequestChange, requestId, visibleResource, type ResourceStatus } from "../lib/resource";
import { cssVarsOf, paletteOf, parseScheme } from "../lib/schemes";
import { isLargeText, parseTextSize } from "../lib/textScale";

type Theme = "SYSTEM" | "LIGHT" | "DARK";
type NoticeKind = "info" | "error";

/** Une réponse native peut porter sa cause ; sinon le réseau de l'appareil
 *  tranche entre hors-ligne et établissement injoignable. */
function resultCause(result: {
  error: string | null;
  cause?: "network" | "offline" | "other";
}): FreshnessCause | null {
  return failureCause(result.error, undefined, isFreshnessCause(result.cause) ? result.cause : null);
}

function thrownCause(error: unknown): FreshnessCause {
  if (
    error instanceof BridgeCallError &&
    (error.code === "auth_required" || error.code === "bad_request" || error.code === "unknown")
  ) {
    return "other";
  }
  return isOnline() ? "network" : "offline";
}

interface AppContextValue {
  theme: Theme;
  dark: boolean;
  setTheme: (theme: Theme) => void;
  /** Id de palette de `lib/schemes.ts` ; la variante vient de `dark`. */
  scheme: string;
  setScheme: (scheme: string) => void;
  /** `SYSTEM` suit le réglage Android ; 100/125/150 le remplacent. */
  textSize: TextSizeChoice;
  setTextSize: (size: TextSizeChoice) => void;
  refreshTick: number;
  refresh: () => void;
  /** Au moins une lecture de ressource est en cours. */
  busy: boolean;
  notify: (message: string, kind?: NoticeKind) => void;
  /** Statut de session lu au démarrage (ou après un échec du pont). */
  sessionStatus: SessionStatus | null;
  reportSession: (status: SessionStatus | null) => void;
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
  /** Au moins une ressource affichée est PARTIELLE (une section illisible). */
  partial: boolean;
  reportPartial: (id: string, partial: boolean) => void;
}

const AppContext = createContext<AppContextValue | null>(null);

/** Thème stocké : seule la valeur connue compte, le reste suit le système. */
function parseTheme(raw: string | null): Theme {
  return raw === "LIGHT" || raw === "DARK" || raw === "SYSTEM" ? raw : "SYSTEM";
}

/** Le stockage de la WebView peut être absent, plein ou refusé (SecurityError) :
 *  l'état mémoire reste la source, jamais une exception pendant le rendu. */
function readStored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Quota ou stockage indisponible : le choix reste appliqué en mémoire.
  }
}

export function AppProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(() => parseTheme(readStored("vsn:theme")));
  const [systemDark, setSystemDark] = useState(() => matchMedia("(prefers-color-scheme: dark)").matches);
  const [scheme, setSchemeState] = useState<string>(() => parseScheme(readStored("vsn:scheme")));
  const [textSize, setTextSizeState] = useState<TextSizeChoice>("SYSTEM");
  const [textZoom, setTextZoom] = useState(100);
  const [refreshTick, setRefreshTick] = useState(0);
  const [sessionStatus, setSessionStatus] = useState<SessionStatus | null>(null);
  const [authLost, setAuthLost] = useState(false);
  const [sessionOpen, setSessionOpen] = useState(false);
  const [sessionClosed, setSessionClosed] = useState(false);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  const [partialKeys, setPartialKeys] = useState<Set<string>>(() => new Set());
  const noticeTimer = useRef<number | undefined>(undefined);
  const leaveTimer = useRef<number | undefined>(undefined);
  const [notice, setNotice] = useState<{ message: string; kind: NoticeKind; leaving: boolean } | null>(null);
  const busy = useSyncExternalStore(subscribeBusy, isBusy, isBusy);

  const dark = theme === "DARK" || (theme === "SYSTEM" && systemDark);
  const palette = paletteOf(scheme, dark);

  useEffect(() => {
    document.documentElement.dataset["theme"] = dark ? "dark" : "light";
  }, [dark]);

  // Palette posée en variables CSS sur `<html>` : un seul point d'écriture,
  // aucun re-rendu des écrans (elles lisent `var(--…)`).
  useEffect(() => {
    const root = document.documentElement;
    const vars = cssVarsOf(palette, dark);
    for (const [name, value] of Object.entries(vars)) {
      root.style.setProperty(name, value);
    }
    // La barre système suit la palette RÉELLEMENT posée : changer de palette
    // change `--page` sans changer `dark`, donc elle ne peut pas dépendre de lui seul.
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute("content", palette.page);
  }, [palette, dark]);

  // Publiée en `data-scheme` : chaque matière (`styles/liquid-glass.css`,
  // `styles/frutiger-aero.css`) cible sa valeur, les autres palettes ne voient rien.
  useEffect(() => {
    document.documentElement.dataset["scheme"] = scheme;
  }, [scheme]);

  // Le natif applique déjà `textZoom` ; l'attribut sert au CSS à laisser les
  // libellés passer à la ligne à partir de 150 %.
  useEffect(() => {
    document.documentElement.dataset["textZoom"] = isLargeText(textZoom) ? "large" : "normal";
  }, [textZoom]);

  useEffect(() => {
    let alive = true;
    void bridge
      .textSize()
      .then((state) => {
        if (!alive) return;
        setTextSizeState(parseTextSize(state.size));
        setTextZoom(state.zoom);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  // La purge globale de la WebView (job de fond, sans instance) efface le DOM
  // storage : le thème natif reste la source, on le réécrit s'il a disparu.
  // Le natif est déjà l'écrivain de `app.setTheme` ; ici on ne fait que réparer
  // un cache local effacé par une purge de compte (I16).
  useEffect(() => {
    if (readStored("vsn:theme") !== null) return;
    let alive = true;
    void bridge
      .theme()
      .then((state) => {
        if (!alive) return;
        const restored = parseTheme(state.theme);
        setThemeState(restored);
        writeStored("vsn:theme", restored);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

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
    // Appairage ou démo : le compte change (ou est remplacé) ; les actualités
    // lues du précédent ne s'appliquent pas. Le natif purge le DOM storage,
    // cette écriture remet aussi le cache local à vide.
    clearNewsReadIds();
    setSessionOpen(true);
    setSessionClosed(false);
    setAuthLost(false);
  }, []);

  // Déconnexion : le natif a invalidé la session et purgé les caches. Sans ce
  // drapeau, l'accueil afficherait « aucune donnée en cache ».
  const closeSession = useCallback(() => {
    clearNewsReadIds();
    setSessionOpen(false);
    setSessionClosed(true);
    setAuthLost(false);
  }, []);

  // Keystore mort = repli mémoire : l'interface doit le dire, sinon l'app
  // laisse croire que tout est enregistré.
  const reportStorage = useCallback((unavailable: boolean) => {
    setStorageUnavailable(unavailable);
  }, []);

  const reportSession = useCallback((status: SessionStatus | null) => {
    setSessionStatus(status);
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
    writeStored("vsn:theme", next);
    void bridge.setTheme(next).catch(() => undefined);
  }, []);

  // Le choix de palette reste local à la WebView : c'est une couleur, pas une
  // donnée de session.
  const setScheme = useCallback((next: string) => {
    const id = parseScheme(next);
    setSchemeState(id);
    writeStored("vsn:scheme", id);
  }, []);

  // Le natif reste l'écrivain : il persiste le choix et applique `textZoom`.
  const setTextSize = useCallback((next: TextSizeChoice) => {
    const size = parseTextSize(next);
    setTextSizeState(size);
    void bridge
      .setTextSize(size)
      .then((state) => setTextZoom(state.zoom))
      .catch(() => undefined);
  }, []);

  const refresh = useCallback(() => setRefreshTick((n) => n + 1), []);

  const reportPartial = useCallback((id: string, partial: boolean) => {
    setPartialKeys((prev) => {
      if (prev.has(id) === partial) return prev;
      const next = new Set(prev);
      if (partial) next.add(id);
      else next.delete(id);
      return next;
    });
  }, []);

  const value = useMemo<AppContextValue>(
    () => ({
      theme,
      dark,
      setTheme,
      scheme,
      setScheme,
      textSize,
      setTextSize,
      refreshTick,
      refresh,
      busy,
      notify,
      sessionStatus,
      reportSession,
      authLost,
      sessionOpen,
      sessionClosed,
      openSession,
      closeSession,
      storageUnavailable,
      reportStorage,
      partial: partialKeys.size > 0,
      reportPartial,
    }),
    [
      theme,
      dark,
      setTheme,
      scheme,
      setScheme,
      textSize,
      setTextSize,
      refreshTick,
      refresh,
      busy,
      notify,
      sessionStatus,
      reportSession,
      authLost,
      sessionOpen,
      sessionClosed,
      openSession,
      closeSession,
      storageUnavailable,
      reportStorage,
      partialKeys,
      reportPartial,
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
  cause: FreshnessCause | null;
  loading: boolean;
  refresh: () => void;
}

/** Lecture offline-first : cache d'abord, puis natif. Le cache s'affiche sans
 *  spinner ; un échec le garde et expose `error`. Le payload est RATTACHÉ à sa
 *  requête : changer de requête l'invalide, même si le chargement échoue. */
export function useResource(key: ResourceKey, query = ""): ResourceState {
  const { refreshTick, reportPartial } = useApp();
  const hookId = useId();
  const request = requestId(key, query);
  const [status, setStatus] = useState<ResourceStatus>({
    request,
    payload: null,
    fetchedAt: 0,
    stale: false,
    partial: false,
    error: null,
    cause: null,
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

  // L'écran ne doit JAMAIS présenter un payload partiel comme complet : le
  // drapeau remonte au bandeau global tant que cette lecture est montée.
  useEffect(() => {
    reportPartial(hookId, status.partial ?? false);
  }, [hookId, status.partial, reportPartial]);

  useEffect(() => () => reportPartial(hookId, false), [hookId, reportPartial]);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    // Signature consommée par ce chargement : le prochain comparera à celle-ci.
    const signature: LoadSignature = { query, manual, tick: refreshTick };
    const force = forceReload(lastLoad.current, signature);
    lastLoad.current = signature;
    // Le démontage termine aussi la lecture : sans cela le compteur resterait
    // bloqué et l'en-tête tournerait pour toujours.
    const finishBusy = beginBusy();
    let settled = false;
    const settleBusy = () => {
      if (settled) return;
      settled = true;
      finishBusy();
    };
    const run = async () => {
      // Changement de requête : l'état est vidé, le payload précédent devient
      // invalide. Même requête : le cache reste affiché pendant la relecture.
      setStatus((s) => beginLoad(s, request));
      try {
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
              partial: cached.partial ?? false,
              error: null,
              cause: null,
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
            partial: result.partial ?? false,
            error: result.error,
            cause: resultCause(result),
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
            cause: thrownCause(e),
          }));
        }
      } finally {
        settleBusy();
      }
    };
    void run();
    return () => {
      cancelled = true;
      controller.abort();
      settleBusy();
    };
  }, [key, query, manual, refreshTick]);

  const refresh = useCallback(() => setManual((n) => n + 1), []);
  // La vue est PROJETÉE à chaque rendu : entre le changement de requête et
  // l'effet qui recharge, l'ancien payload est déjà invisible.
  return { ...visibleResource(status, request), refresh };
}
