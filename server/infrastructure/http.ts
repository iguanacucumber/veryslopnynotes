// Scraper Playwright minimal : GET /v1/health, GET /v1/ready,
// POST /v1/manuals/scrape, POST /v1/web/scrape ; tout le reste = 404.
// Loopback = sans auth ; hors loopback = opt-in ALLOW_PUBLIC=1 + jeton Bearer
// obligatoire (I8), seau par jeton et file bornée (429 + Retry-After), jamais
// un service public muet.
// platform/startUrl viennent du corps (writeOnly), jamais d'env ni du dépôt ;
// username/password sont refusés. Le jar est choisi par le serveur : seul son
// nom vient de l'exploitant.
// Navigation gardée : hôte public, nom résolu, redirections et URL finale
// re-vérifiées.
// I8 : PORT/HOST, chemins TLS et jeton public = seules variables lues, dans start().
import { createHash, timingSafeEqual } from "node:crypto";
import { accessSync, constants, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import {
  HEALTH_PATH,
  MANUALS_SCRAPE_MAX_BODY_CHARS,
  MANUALS_SCRAPE_PATH,
  MAX_SCRAPE_BODY_BYTES,
  READY_PATH,
  WEB_SCRAPE_MAX_BODY_CHARS,
  WEB_SCRAPE_PATH,
  isManualsScrapeDoc,
  isManualsScrapeRequest,
  isWebScrapeDoc,
  isWebScrapeRequest,
} from "../../shared/contracts/api";
import { prepareJarStore } from "./jar-store";
import type { ManualDoc } from "./manuals";
import { CHROMIUM_LAUNCH_OPTIONS, DEFAULT_AUTH_FILE, ScrapeManualsError, scrapeManuals } from "./manuals-scrape";
import { PublicAdmission } from "./rate-limit";
import type { HostResolver } from "./ssrf";
import { scrapeWebPage } from "./web-scrape";
import type { WebDoc } from "./web-scrape";

const DEFAULT_PORT = 3000;

export interface ScraperDeps {
  /**
   * Fonction de scrape injectée. Défaut = vrai `scrapeManuals` (Playwright) ;
   * tests = fake pur, aucun navigateur, aucun réseau.
   * `signal` = annulation : le scraper doit tuer le navigateur quand le
   * signal passe à `aborted` (délai dépassé ou client parti).
   */
  readonly scrape?: (
    config: { readonly platform: string },
    opts: {
      readonly startUrl: string;
      /** Page imprimée à résoudre dans le sommaire (manuel). */
      readonly page?: number;
      /**
       * Jar de session du SERVEUR (jamais choisi par l'appelant) : chemin
       * libre, sous la responsabilité de l'exploitant.
       */
      readonly defaultAuthFile?: string;
      readonly signal?: AbortSignal;
      readonly resolveHost?: HostResolver;
      /** Temps restant avant l'échéance HTTP absolue. */
      readonly timeoutMs?: number;
      /** Journal du serveur (compteurs seulement, jamais l'URL). */
      readonly logger?: (message: string) => void;
    },
  ) => Promise<ManualDoc[]>;
  /**
   * Scrape d'une PAGE WEB : même moteur, SANS jar de session. Défaut = vrai
   * `scrapeWebPage` ; tests = fake pur.
   */
  readonly scrapeWeb?: (
    opts: {
      readonly startUrl: string;
      readonly signal?: AbortSignal;
      readonly resolveHost?: HostResolver;
      readonly timeoutMs?: number;
      readonly logger?: (message: string) => void;
    },
  ) => Promise<WebDoc[]>;
  /**
   * Jar de session du serveur : le seul jar monté par le navigateur, choisi
   * par l'exploitant (jamais par l'appelant de l'API).
   */
  readonly authFile?: string;
  /** Délai d'attente du scrape (défaut 30 s) ; injectable pour les tests. */
  readonly timeoutMs?: number;
  /**
   * Résolution DNS de l'hôte (garde SSRF). Défaut = résolveur du système ;
   * les tests injectent un faux résolveur (aucun réseau).
   */
  readonly resolveHost?: HostResolver;
  /**
   * Jeton Bearer exigé sur TOUTES les routes quand il est défini. Le mode
   * loopback sans jeton reste ouvert ; le mode public l'impose dans start().
   */
  readonly token?: string;
  /**
   * Limites du mode public : seau par jeton et file FIFO des scrapes. Les
   * défauts sont calibrés pour un seul Chromium séquentiel ; les tests les
   * rétrécissent et injectent `now` (aucune horloge réelle).
   */
  readonly rateLimit?: {
    readonly burst?: number;
    readonly refillPerSecond?: number;
    readonly maxQueue?: number;
    readonly now?: () => number;
  };
  /**
   * Sonde de disponibilité RÉELLE (`/v1/ready`) : chaque contrôle vrai = prêt.
   * Défaut = jar inscriptible + Chromium installé ; les tests injectent une
   * sonde déterministe (aucun fichier, aucun navigateur).
   */
  readonly readiness?: () => Readonly<Record<string, boolean>> | Promise<Readonly<Record<string, boolean>>>;
}

export interface App {
  readonly handler: (req: Request) => Promise<Response>;
  readonly inFlightScrapes: () => number;
  /** Retire l'instance du trafic AVANT l'arrêt : `/v1/ready` répond 503. */
  readonly markDraining: () => void;
}

/** Le drain laisse finir un scrape de 30 s, avec une marge de 5 s. */
export const DRAIN_TIMEOUT_MS = 35_000;

type Closable = { readonly stop: (closeActiveConnections?: boolean) => Promise<void> | void };

/**
 * Sonde réelle : le jar doit être inscriptible et Chromium doit POUVOIR
 * DÉMARRER. `existsSync` ne suffit pas : un seccomp qui refuse les user
 * namespaces laisse le binaire en place et fait échouer chaque scrape.
 * Le lancement est court et mis en cache : `/v1/ready` reste une sonde, pas
 * un scrape déguisé.
 */
const READY_BROWSER_LAUNCH_TIMEOUT_MS = 3_000;
const READY_BROWSER_PROBE_TTL_MS = 60_000;
let browserProbeCache: { readonly at: number; readonly ok: boolean } | null = null;
let browserProbePending: Promise<boolean> | null = null;

async function defaultReadiness(authFile: string): Promise<Record<string, boolean>> {
  return {
    jar: jarWritable(authFile),
    browser: await browserLaunchable(),
  };
}

function jarWritable(authFile: string): boolean {
  try {
    accessSync(dirname(authFile), constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

async function browserLaunchable(): Promise<boolean> {
  const now = Date.now();
  if (browserProbeCache !== null && now - browserProbeCache.at < READY_BROWSER_PROBE_TTL_MS) {
    return browserProbeCache.ok;
  }
  // Un seul lancement à la fois : deux HEALTHCHECK simultanés ne doivent pas
  // empiler deux Chromium.
  if (browserProbePending !== null) return browserProbePending;
  browserProbePending = probeBrowserLaunch()
    .then((ok) => {
      browserProbeCache = { at: Date.now(), ok };
      return ok;
    })
    .finally(() => {
      browserProbePending = null;
    });
  return browserProbePending;
}

/** Lance puis ferme Chromium ; toute erreur (binaire, sandbox, délai) = faux. */
async function probeBrowserLaunch(): Promise<boolean> {
  let browser: { close: () => Promise<void> } | undefined;
  try {
    const pw = (await import("playwright")) as {
      chromium: { launch: (options: Record<string, unknown>) => Promise<{ close: () => Promise<void> }> };
    };
    browser = await pw.chromium.launch({
      ...CHROMIUM_LAUNCH_OPTIONS,
      timeout: READY_BROWSER_LAUNCH_TIMEOUT_MS,
    });
    return true;
  } catch {
    return false;
  } finally {
    if (browser !== undefined) await browser.close().catch(() => {});
  }
}

/**
 * POST /v1/manuals/scrape : corps borné AVANT parse (route ouverte : ne jamais
 * y bufferiser un corps arbitraire), validé par le contrat, credentials
 * refusés avant tout log. Réponse = docs validés un par un : une page d'erreur
 * ne devient jamais un ManualDoc.
 * Plafond de concurrence : 2 scrapes en vol, le reste = 503 (l'endpoint est
 * public par conception, cf. I8 — un tiers ne doit pas pouvoir empiler des
 * Chromium, ~300 Mo chacun). Délai dépassé = 504 (le code exact), pas 502 :
 * le portail n'est pas en cause, c'est le temps qui manque.
 * ponytail: borne 30s + cap 2 concurrents, compteur seul en memoire.
 * Upgrade: file persistante si multi-instances.
 */
const SCRAPE_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_SCRAPES = 2;
// Mode public : 6 scrapes en rafale puis 10/min par jeton, 4 en file. Un scrape
// coûte ~300 Mo : la rafale remplit deux Chromium et la file, jamais plus.
// ponytail: constantes en code ; l'exploitant les change avec le reste du
// dimensionnement (cf. cgroup dans server/README.md).
// Upgrade: variables d'environnement si des profils de charge divergent.
const PUBLIC_RATE_BURST = 6;
const PUBLIC_RATE_REFILL_PER_SECOND = 10 / 60;
const PUBLIC_QUEUE_MAX = 4;

interface ScrapeState {
  inFlight: number;
}

export function createApp(deps: ScraperDeps = {}): App {
  const log = (message: string) => console.log(`[server] ${message}`);
  const runScrape = deps.scrape ?? scrapeManuals;
  const runWebScrape = deps.scrapeWeb ?? scrapeWebPage;
  const defaultJar = deps.authFile ?? DEFAULT_AUTH_FILE;
  const timeoutMs = deps.timeoutMs ?? SCRAPE_TIMEOUT_MS;
  const token = deps.token?.trim() ?? "";
  const admission = token
    ? new PublicAdmission(
        {
          burst: deps.rateLimit?.burst ?? PUBLIC_RATE_BURST,
          refillPerSecond: deps.rateLimit?.refillPerSecond ?? PUBLIC_RATE_REFILL_PER_SECOND,
          maxConcurrent: MAX_CONCURRENT_SCRAPES,
          maxQueue: deps.rateLimit?.maxQueue ?? PUBLIC_QUEUE_MAX,
        },
        deps.rateLimit?.now,
      )
    : null;
  // Clé de seau = empreinte : le jeton lui-même n'est jamais une clé en mémoire.
  const admissionKey = token ? createHash("sha256").update(token).digest("hex") : "";
  const readiness = deps.readiness ?? (() => defaultReadiness(defaultJar));
  // Compteur PAR APP : un test qui laisse un scrape en vol n'empoisonne pas
  // les suivants (le serveur réel n'a qu'une instance).
  const state: ScrapeState = { inFlight: 0 };
  let draining = false;

  return {
    handler: async (req: Request): Promise<Response> => {
      if (token && !hasBearer(req, token)) {
        return error("unauthorized", 401, "bearer token required", { "www-authenticate": "Bearer" });
      }
      try {
        const url = new URL(req.url);
        const path = url.pathname;
        if (path === HEALTH_PATH && (req.method === "GET" || req.method === "HEAD")) {
          const res = Response.json({ status: "ok", version: CONTRACTS_VERSION });
          return req.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
        }
        if (path === READY_PATH && (req.method === "GET" || req.method === "HEAD")) {
          return await readyResponse(req.method, readiness, draining);
        }
        if (path === MANUALS_SCRAPE_PATH && req.method === "POST") {
          return await admitPublic(req, admission, admissionKey, (onSettled) =>
            handleScrape(req, runScrape, defaultJar, log, state, timeoutMs, deps.resolveHost, onSettled),
          );
        }
        if (path === WEB_SCRAPE_PATH && req.method === "POST") {
          return await admitPublic(req, admission, admissionKey, (onSettled) =>
            handleWebScrape(req, runWebScrape, log, state, timeoutMs, deps.resolveHost, onSettled),
          );
        }
        if (path === HEALTH_PATH || path === READY_PATH || path === MANUALS_SCRAPE_PATH || path === WEB_SCRAPE_PATH) {
          return error("method_not_allowed", 405, `${req.method} not allowed on ${path}`, {
            allow: path === HEALTH_PATH || path === READY_PATH ? "GET" : "POST",
          });
        }
        return error("not_found", 404, `unknown path ${path}`);
      } catch {
        return error("internal", 500, "unexpected failure");
      }
    },
    inFlightScrapes: () => state.inFlight,
    markDraining: () => {
      draining = true;
    },
  };
}

/**
 * Mode public : seau par jeton puis file des scrapes. Sans jeton (loopback),
 * aucune admission : le comportement 503 d'origine reste intact.
 */
async function admitPublic(
  req: Request,
  admission: PublicAdmission | null,
  key: string,
  run: (onSettled: () => void) => Promise<Response>,
): Promise<Response> {
  if (!admission) return await run(() => {});
  const result = await admission.acquire(key, req.signal);
  if (!result.ok) {
    discardBody(req);
    return rateLimited(result.retryAfterMs);
  }
  let released = false;
  const release = () => {
    if (released) return;
    released = true;
    result.admission.release();
  };
  try {
    // La réponse peut partir AVANT la fin réelle du scrape (délai dépassé) :
    // le slot reste tenu jusqu'à `onSettled`, pas jusqu'au retour du handler.
    return await run(release);
  } catch (err) {
    release();
    throw err;
  }
}

/**
 * `/v1/health` = vivacité (le process répond) ; `/v1/ready` = disponibilité
 * RÉELLE (jar, navigateur, pas en drain). Une sonde qui lève n'est jamais un
 * 500 : elle est indisponible, pas en panne.
 */
async function readyResponse(
  method: string,
  readiness: () => Readonly<Record<string, boolean>> | Promise<Readonly<Record<string, boolean>>>,
  draining: boolean,
): Promise<Response> {
  let checks: Record<string, boolean>;
  try {
    checks = { ...(await readiness()), accepting: !draining };
  } catch {
    checks = { probe: false, accepting: !draining };
  }
  const ready = Object.values(checks).every(Boolean);
  const res = Response.json(
    { status: ready ? "ready" : "not_ready", checks },
    { status: ready ? 200 : 503, headers: { "cache-control": "no-store" } },
  );
  return method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
}

function timeoutError(ms: number): Error {
  // Motif `timeout` : 504 (le code exact), pas 502 qui ferait croire à une
  // panne du portail.
  return new ScrapeManualsError(`scrape timeout ${ms}ms`, "timeout");
}

/**
 * Le corps porte-t-il un champ `authFile` ?
 *
 * Le contrat ne connaît PLUS ce champ : le jar de session est choisi par le
 * serveur. On le refuse par son NOM plutôt que par un 400 générique, pour que
 * l'appelant sache quoi retirer de sa requête.
 */
function hasAuthFileField(body: unknown): boolean {
  return typeof body === "object" && body !== null && "authFile" in body;
}

/**
 * Le corps porte-t-il des identifiants de portail ?
 *
 * Le scraper ne s'authentifie PAS : le navigateur monte le jar de session du
 * SERVEUR (I24). Un corps qui les porte est REFUSÉ (message dédié) : mieux
 * vaut un 400 franc qu'un credential collecté pour rien, jamais journalisé,
 * jamais transmis au scraper.
 */
function hasCredentialFields(body: unknown): boolean {
  return (
    typeof body === "object" &&
    body !== null &&
    ("username" in body || "password" in body)
  );
}

type ReadJsonBody = { readonly ok: true; readonly text: string } | { readonly ok: false; readonly response: Response };

/** Coupe le flux dès le refus : le client n'a pas à finir d'envoyer un corps inutile. */
function discardBody(req: Request): void {
  if (!req.body || req.body.locked) return;
  void req.body.cancel().catch(() => {});
}

/** Course d'une promesse contre l'échéance : un corps lent n'immobilise pas le slot. */
function readWithAbort<T>(pending: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return pending;
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        signal.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}

/**
 * Corps JSON lu EN STREAMING et borné en OCTETS : un `req.text()` bufferisait
 * tout le corps avant de mesurer, donc une route ouverte pouvait être remplie
 * avec une taille arbitraire. Le `content-type` est exigé AVANT toute lecture ;
 * au-delà du plafond, la lecture s'arrête et le flux est annulé.
 */
async function readJsonBody(req: Request, signal?: AbortSignal): Promise<ReadJsonBody> {
  const mediaType = (req.headers.get("content-type") ?? "").split(";", 1)[0]?.trim().toLowerCase();
  if (signal?.aborted) throw signal.reason;
  if (mediaType !== "application/json") {
    discardBody(req);
    return {
      ok: false,
      response: error("bad_request", 415, "content-type application/json requis"),
    };
  }
  const announced = Number(req.headers.get("content-length") ?? "");
  if (Number.isFinite(announced) && announced > MAX_SCRAPE_BODY_BYTES) {
    discardBody(req);
    return { ok: false, response: error("too_large", 413, "corps trop volumineux") };
  }
  if (!req.body) return { ok: true, text: "" };
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { done, value } = await readWithAbort(reader.read(), signal);
      if (done) break;
      if (!value || value.byteLength === 0) continue;
      size += value.byteLength;
      if (size > MAX_SCRAPE_BODY_BYTES) {
        await reader.cancel().catch(() => {});
        return { ok: false, response: error("too_large", 413, "corps trop volumineux") };
      }
      chunks.push(value);
    }
  } catch (err) {
    await reader.cancel().catch(() => {});
    if (signal?.aborted) throw signal.reason;
    return { ok: false, response: error("bad_request", 400, "invalid JSON body") };
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, text: new TextDecoder().decode(bytes) };
}

interface RequestDeadline {
  readonly controller: AbortController;
  /** Temps restant avant l'échéance absolue (jamais 0). */
  readonly remainingMs: () => number;
  readonly dispose: () => void;
}

/**
 * UNE échéance pour tout le handler : lecture du corps, résolution DNS, scrape
 * et lecture du HTML. `idleTimeout` de Bun ne borne que l'inactivité du
 * transport : un corps qui goutte indéfiniment ne déclenche jamais ce délai.
 */
function startRequestDeadline(req: Request, timeoutMs: number): RequestDeadline {
  const controller = new AbortController();
  const deadlineAt = Date.now() + timeoutMs;
  const timer = setTimeout(() => controller.abort(timeoutError(timeoutMs)), timeoutMs);
  const onClientAbort = () => controller.abort(new ScrapeManualsError("client aborte"));
  if (req.signal) {
    if (req.signal.aborted) onClientAbort();
    else req.signal.addEventListener("abort", onClientAbort, { once: true });
  }
  return {
    controller,
    remainingMs: () => Math.max(1, deadlineAt - Date.now()),
    dispose: () => {
      clearTimeout(timer);
      req.signal?.removeEventListener("abort", onClientAbort);
    },
  };
}

/** Annulation avant le scrape : client parti = 502, échéance = 504. */
function abortedResponse(req: Request, controller: AbortController): Response {
  if (req.signal?.aborted) return error("school_unreachable", 502, "scrape impossible");
  const reason = controller.signal.reason;
  if (reason instanceof ScrapeManualsError && reason.reason !== "timeout") {
    return error("school_unreachable", 502, "scrape impossible");
  }
  return error("timeout", 504, "delai de scrape depasse");
}

/** Rejette avec le motif de l'abandon (délai typé, client, navigateur). */
function abortRejection(controller: AbortController, timeoutMs: number): Promise<never> {
  return new Promise<never>((_, reject) => {
    const onAbort = () => {
      const reason = controller.signal.reason;
      reject(reason instanceof Error ? reason : timeoutError(timeoutMs));
    };
    if (controller.signal.aborted) {
      onAbort();
      return;
    }
    controller.signal.addEventListener("abort", onAbort, { once: true });
  });
}

async function handleScrape(
  req: Request,
  runScrape: NonNullable<ScraperDeps["scrape"]>,
  defaultJar: string,
  log: (message: string) => void,
  state: ScrapeState,
  timeoutMs: number,
  resolveHost?: HostResolver,
  onSettled: () => void = () => {},
): Promise<Response> {
  // Plafond AVANT tout `await` : incrémenter après une lecture de corps
  // laissait une fenêtre où N requêtes passaient toutes le contrôle.
  if (state.inFlight >= MAX_CONCURRENT_SCRAPES) {
    onSettled(); // aucun scrape lancé : l'admission ne doit pas rester tenue
    return error("busy", 503, "scraper occupe, reessayer plus tard", { "retry-after": "5" });
  }
  state.inFlight += 1;
  // Le slot n'est rendu qu'à la fin RÉELLE du scrape : au timeout, la réponse
  // part mais Chromium met encore du temps à mourir ; libérer ici laissait
  // démarrer un 3e navigateur alors que les deux premiers tournaient encore.
  let slotReleased = false;
  const releaseSlot = () => {
    if (slotReleased) return;
    slotReleased = true;
    state.inFlight = Math.max(0, state.inFlight - 1);
    onSettled();
  };
  let scrapeStarted = false;
  // Échéance ABSOLUE dès l'arrivée de la requête : le corps lent, le DNS et
  // le scrape partagent le même budget. Sans elle, `idleTimeout` (inactivité)
  // laissait un corps goutte-à-goutte tenir le slot indéfiniment.
  const deadline = startRequestDeadline(req, timeoutMs);
  // Annulation : le délai dépassé ou le client parti doivent TUER le
  // navigateur, pas seulement rejeter la promesse (Chromium fantôme).
  const controller = deadline.controller;
  let done = false;
  try {
    let read: ReadJsonBody;
    try {
      read = await readJsonBody(req, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return abortedResponse(req, controller);
      throw err;
    }
    if (!read.ok) return read.response;
    if (read.text.length > MANUALS_SCRAPE_MAX_BODY_CHARS) {
      return error("bad_request", 400, "invalid body");
    }
    let body: unknown;
    try {
      body = JSON.parse(read.text);
    } catch {
      return error("bad_request", 400, "invalid JSON body");
    }
    if (!isManualsScrapeRequest(body)) return error("bad_request", 400, "invalid scrape request");
    // Le scraper ne s'authentifie pas (la session est le jar du serveur, I24).
    // Des identifiants dans le corps seraient collectés pour rien : le corps
    // est REFUSÉ, et rien n'est transmis au scraper.
    if (hasCredentialFields(body)) {
      return error(
        "bad_request",
        400,
        "username/password : le scraper ne s'authentifie pas (session du serveur)",
      );
    }
    // Le jar de session est CHOISI par le serveur. Un corps qui le demande
    // est REFUSÉ (message dédié) : un appelant pouvait sinon naviguer avec la
    // session d'un autre tenant.
    if (hasAuthFileField(body)) {
      return error("bad_request", 400, "authFile : le jar de session est choisi par le serveur");
    }
    if (controller.signal.aborted) return abortedResponse(req, controller);
    let docs: ManualDoc[];
    try {
      const scrapeP = runScrape(
        { platform: body.platform },
        {
          startUrl: body.startUrl,
          page: body.page,
          // Le SEUL jar monté est celui du serveur.
          defaultAuthFile: defaultJar,
          // La garde SSRF résout le nom d'hôte avant la navigation. Le
          // résolveur est celui du serveur (jamais celui de l'appelant) ;
          // les tests injectent un faux résolveur.
          resolveHost,
          // Le délai dépassé ou le client parti tuent le navigateur.
          signal: controller.signal,
          // Budget RESTANT : le corps déjà lu ne rallonge pas le scrape.
          timeoutMs: deadline.remainingMs(),
          logger: log,
        },
      );
      // La course peut être perdue (délai, abandon) : la rejection tardive du
      // scrape ne doit pas devenir une rejection non geree.
      scrapeP.catch(() => {});
      // Le slot suit la promesse RÉELLE, pas la course : au timeout la réponse
      // part vite, mais le slot reste tenu tant que le navigateur n'a pas fini.
      scrapeStarted = true;
      void scrapeP.then(releaseSlot, releaseSlot);
      // L'échéance est déjà armée : elle rejette avec le motif `timeout` (504).
      docs = await Promise.race([scrapeP, abortRejection(controller, timeoutMs)]);
      done = true;
    } catch (err) {
      // Le sandbox est une exigence, pas une option : un hôte qui refuse les
      // user namespaces fait échouer le lancement. On le dit franchement,
      // jamais un repli vers un Chromium non sandboxé.
      if (isSandboxUnavailableError(err)) {
        return error("not_implemented", 501, "sandbox Chromium indisponible");
      }
      // Navigateur absent = capability manquante (501 franc), pas un faux
      // succès ni un 500 « unexpected failure » : le message Playwright réel
      // (exécutable absent, install-deps) est conservé.
      if (isMissingBrowserError(err)) {
        return error("not_implemented", 501, "scraper sans navigateur");
      }
      if (err instanceof ScrapeManualsError) {
        // Le refus de la garde SSRF est EXPLICITE (hôte privé), pas un 502
        // muet qui laisserait croire à une panne du portail.
        if (err.reason === "private_host") return error("private_host", 403, "hote prive refuse");
        // Nom d'hôte introuvable : le scraping n'est pas en cause, le DNS
        // l'est — le code le dit (jamais un « scrape impossible » trompeur).
        if (err.reason === "unresolved_host") return error("unresolved_host", 502, "nom d'hote introuvable");
        // Délai dépassé = 504 (le code exact), pas 502. Le délai HTTP ET le
        // délai de lecture du HTML finissent ici.
        if (err.reason === "timeout") return error("timeout", 504, "delai de scrape depasse");
        // Le portail a renvoyé sa PAGE DE CONNEXION (HTTP 200) : la session
        // du jar n'est plus valable. Le code le dit, jamais un « scrape
        // impossible » trompeur.
        if (err.reason === "login_required") {
          return error("login_required", 502, "page de connexion detectee (session a renouveler)");
        }
        return error("school_unreachable", 502, "scrape impossible");
      }
      // Client parti : le 500 serait un faux diagnostic.
      if (req.signal?.aborted) return error("school_unreachable", 502, "scrape impossible");
      return error("internal", 500, "unexpected failure");
    }
    // Compteurs seuls : ni credentials, ni URL d'appelant dans les logs.
    log(`scrape -> ${docs.length} doc(s)`);
    const payload = { docs };
    if (!Array.isArray(docs) || !docs.every(isManualsScrapeDoc)) return error("internal", 500, "invalid payload");
    return Response.json(payload);
  } finally {
    deadline.dispose();
    // Scrape non terminé (erreur, exception) : on annule pour ne pas laisser
    // un Chromium orphelin en arrière-plan.
    if (!done) controller.abort();
    // Aucun scrape lancé (corps invalide, refus) : le slot est rendu ici.
    // Sinon il l'est par `releaseSlot` à la fin réelle de la promesse.
    if (!scrapeStarted) releaseSlot();
  }
}

/**
 * POST /v1/web/scrape : même garde SSRF, même plafond de concurrence, SANS
 * jar de session. Le corps est borné AVANT parse et validé par le contrat
 * partagé ; la réponse ne contient jamais l'URL demandée.
 */
async function handleWebScrape(
  req: Request,
  runScrape: NonNullable<ScraperDeps["scrapeWeb"]>,
  log: (message: string) => void,
  state: ScrapeState,
  timeoutMs: number,
  resolveHost?: HostResolver,
  onSettled: () => void = () => {},
): Promise<Response> {
  if (state.inFlight >= MAX_CONCURRENT_SCRAPES) {
    onSettled();
    return error("busy", 503, "scraper occupe, reessayer plus tard", { "retry-after": "5" });
  }
  state.inFlight += 1;
  let slotReleased = false;
  const releaseSlot = () => {
    if (slotReleased) return;
    slotReleased = true;
    state.inFlight = Math.max(0, state.inFlight - 1);
    onSettled();
  };
  let scrapeStarted = false;
  // Même échéance ABSOLUE que le scrape de manuel : corps + DNS + scrape.
  const deadline = startRequestDeadline(req, timeoutMs);
  const controller = deadline.controller;
  let done = false;
  try {
    let read: ReadJsonBody;
    try {
      read = await readJsonBody(req, controller.signal);
    } catch (err) {
      if (controller.signal.aborted) return abortedResponse(req, controller);
      throw err;
    }
    if (!read.ok) return read.response;
    if (read.text.length > WEB_SCRAPE_MAX_BODY_CHARS) {
      return error("bad_request", 400, "invalid body");
    }
    let body: unknown;
    try {
      body = JSON.parse(read.text);
    } catch {
      return error("bad_request", 400, "invalid JSON body");
    }
    if (!isWebScrapeRequest(body)) return error("bad_request", 400, "invalid web scrape request");
    if (controller.signal.aborted) return abortedResponse(req, controller);
    let docs: WebDoc[];
    try {
      const scrapeP = runScrape({
        startUrl: body.url,
        resolveHost,
        signal: controller.signal,
        timeoutMs: deadline.remainingMs(),
        logger: log,
      });
      scrapeP.catch(() => {});
      // Le slot suit la fin RÉELLE du scrape, pas le retour de la course.
      scrapeStarted = true;
      void scrapeP.then(releaseSlot, releaseSlot);
      docs = await Promise.race([scrapeP, abortRejection(controller, timeoutMs)]);
      done = true;
    } catch (err) {
      // Le sandbox est une exigence, pas une option : un hôte qui refuse les
      // user namespaces fait échouer le lancement. On le dit franchement,
      // jamais un repli vers un Chromium non sandboxé.
      if (isSandboxUnavailableError(err)) {
        return error("not_implemented", 501, "sandbox Chromium indisponible");
      }
      if (isMissingBrowserError(err)) {
        return error("not_implemented", 501, "scraper sans navigateur");
      }
      if (err instanceof ScrapeManualsError) {
        if (err.reason === "private_host") return error("private_host", 403, "hote prive refuse");
        if (err.reason === "unresolved_host") return error("unresolved_host", 502, "nom d'hote introuvable");
        if (err.reason === "timeout") return error("timeout", 504, "delai de scrape depasse");
        if (err.reason === "too_large") return error("too_large", 413, "page trop volumineuse");
        if (err.reason === "not_text") return error("not_text", 415, "contenu non textuel refuse");
        // Une page de connexion n'a aucun sens pour une page web publique :
        // elle reste refusée, avec un code générique (aucun cookie monté).
        if (err.reason === "login_required") {
          return error("login_required", 502, "page de connexion detectee");
        }
        return error("school_unreachable", 502, "scrape impossible");
      }
      if (req.signal?.aborted) return error("school_unreachable", 502, "scrape impossible");
      return error("internal", 500, "unexpected failure");
    }
    log(`scrape web -> ${docs.length} doc(s)`);
    const payload = { docs };
    if (!Array.isArray(docs) || !docs.every(isWebScrapeDoc)) return error("internal", 500, "invalid payload");
    return Response.json(payload);
  } finally {
    deadline.dispose();
    if (!done) controller.abort();
    if (!scrapeStarted) releaseSlot();
  }
}

/**
 * Navigateur Playwright ABSENT = capability manquante (501 franc), pas un
 * faux 500 « unexpected failure ». Le message réel varie selon la version et
 * la cause : on matche une LISTE de motifs, jamais une chaîne fragile.
 * ponytail: regex sur le message, pas de dépendance ni de parsing de sortie.
 * Upgrade: une erreur stable de Playwright si elle existe un jour.
 */
const MISSING_BROWSER_PATTERNS: readonly RegExp[] = [
  /playwright non install/i, // module absent (message interne du scraper)
  /executable doesn't exist/i, // binaire du navigateur non téléchargé
  /download new browsers/i, // Playwright invite à télécharger le navigateur
  /playwright install/i, // commande d'installation citée dans le message
  /host system is missing dependencies/i, // libs système absentes
  /navigateur (?:absent|manquant|introuvable)/i,
];

function isMissingBrowserError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return MISSING_BROWSER_PATTERNS.some((re) => re.test(message));
}

/**
 * Chromium refuse de démarrer plutôt que de tourner sans sandbox ; Playwright
 * remonte le diagnostic complet. Ces motifs sont ceux du binaire, pas une
 * promesse de stabilité : un motif absent laisse un 500, jamais un faux succès.
 */
const SANDBOX_UNAVAILABLE_PATTERNS: readonly RegExp[] = [
  /chromium sandboxing failed/i,
  /no usable sandbox/i,
];

function isSandboxUnavailableError(err: unknown): boolean {
  const message = err instanceof Error ? err.message : typeof err === "string" ? err : "";
  return SANDBOX_UNAVAILABLE_PATTERNS.some((re) => re.test(message));
}

function error(code: string, status: number, message: string, extraHeaders?: Record<string, string>): Response {
  return Response.json({ error: { code, message } }, { status, headers: extraHeaders });
}

/** `Retry-After` en secondes entières (RFC 9110), jamais 0. */
function rateLimited(retryAfterMs: number): Response {
  const seconds = Math.max(1, Math.ceil(retryAfterMs / 1000));
  return error("rate_limited", 429, "quota epuise, reessayer plus tard", {
    "retry-after": String(seconds),
    "cache-control": "no-store",
  });
}

/** `PORT` : absent -> défaut ; `0` conservé (port éphémère) ; hors plage -> refus explicite. */
function parsePort(raw: string | null): number {
  if (raw === null) return DEFAULT_PORT;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`PORT invalide: ${JSON.stringify(raw)} (entier attendu dans 0..65535)`);
  }
  return port;
}

function envValue(env: Record<string, string | undefined>, key: string): string {
  return (env[key] ?? "").trim();
}

/**
 * Comparaison à temps constant : un jeton public ne doit pas fuiter sa
 * longueur ni son préfixe par le temps de réponse.
 */
function hasBearer(req: Request, expected: string): boolean {
  const header = req.headers.get("authorization");
  const match = header === null ? null : /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (match === null) return false;
  const given = createHash("sha256").update(match[1]!).digest();
  const want = createHash("sha256").update(expected).digest();
  return timingSafeEqual(given, want);
}

/**
 * Un bind non-loopback par défaut exposerait un scraper qui monte la session
 * du serveur (I8). `localhost`, 127.0.0.0/8 et `::1` restent locaux ; tout le
 * reste exige un opt-in explicite et un jeton.
 */
function isLoopbackHost(hostname: string): boolean {
  const host = hostname.trim().replace(/^\[|\]$/g, "").toLowerCase();
  return (
    host === "localhost" ||
    host === "::1" ||
    host === "0:0:0:0:0:0:0:1" ||
    /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(host)
  );
}

interface Binding {
  readonly hostname: string;
  readonly token: string | null;
}

/**
 * Boucle locale par défaut. Hors loopback : `ALLOW_PUBLIC=1` ET un
 * `SCRAPER_TOKEN` non vide, sinon refus au démarrage (jamais un bind public
 * silencieux ni un service public sans jeton).
 */
function bindingFromEnv(env: Record<string, string | undefined>): Binding {
  const hostname = envValue(env, "HOST") || "127.0.0.1";
  const token = envValue(env, "SCRAPER_TOKEN");
  if (isLoopbackHost(hostname)) return { hostname, token: token || null };
  if (envValue(env, "ALLOW_PUBLIC") !== "1") {
    throw new Error(
      `HOST non-loopback refuse: ${JSON.stringify(hostname)} (boucle locale attendue). ` +
        "Exposition publique = ALLOW_PUBLIC=1 et SCRAPER_TOKEN.",
    );
  }
  if (!token) {
    throw new Error(
      "mode public refuse: SCRAPER_TOKEN (Bearer) est requis quand ALLOW_PUBLIC=1 hors boucle locale.",
    );
  }
  return { hostname, token };
}

/**
 * TLS : `TLS_CERT_FILE` + `TLS_KEY_FILE` = HTTPS, rien = HTTP sur la boucle
 * locale (tests et usage local). Chemins vers du matériel local, pas des
 * credentials : rien à commiter, clé générée hors dépôt. Une seule des deux,
 * ou deux valeurs blanches, = REFUS explicite, jamais un repli silencieux en
 * clair (l'app interdit le clairtext).
 */
function tlsFromEnv(env: Record<string, string | undefined>): { cert: string; key: string } | null {
  const cert = envValue(env, "TLS_CERT_FILE");
  const key = envValue(env, "TLS_KEY_FILE");
  // Blanc explicite (espaces seuls) = intention TLS incomplète : refus, pas
  // un retour silencieux au clair (le shell `-z` de l'image le laisserait passer).
  if ((env["TLS_CERT_FILE"] ?? "") !== "" && !cert) {
    throw new Error("TLS_CERT_FILE blanc : chemin PEM vide");
  }
  if ((env["TLS_KEY_FILE"] ?? "") !== "" && !key) {
    throw new Error("TLS_KEY_FILE blanc : chemin PEM vide");
  }
  if (!cert && !key) return null;
  if (!cert || !key) {
    throw new Error(
      "TLS incomplet: TLS_CERT_FILE et TLS_KEY_FILE doivent etre definis ensemble " +
        "(ou absents tous les deux pour un serveur en clair)",
    );
  }
  return { cert: readPem(cert, "TLS_CERT_FILE"), key: readPem(key, "TLS_KEY_FILE") };
}

/**
 * Clair hors boucle locale = session du serveur exposée. Seul un override
 * NOMMÉ, réservé aux tests, peut l'ouvrir ; un opérateur qui oublie TLS
 * échoue au démarrage, pas en silence.
 */
function testCleartextAllowed(env: Record<string, string | undefined>): boolean {
  return env["VSN_TEST_ALLOW_CLEARTEXT"] === "1";
}

function readPem(path: string, variable: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`${variable} illisible (${path}) : fichier PEM absent ou non lisible`);
  }
}

/**
 * Drain gracieux : la sonde passe 503, le serveur cesse d'accepter, les
 * requêtes en cours (un scrape va jusqu'à 30 s) finissent. Au-delà du délai,
 * arrêt forcé pour ne pas bloquer un redéploiement.
 */
export function createShutdown(
  app: App,
  server: Closable,
  log: (message: string) => void,
  timeoutMs = DRAIN_TIMEOUT_MS,
): (signal: string) => Promise<void> {
  let started = false;
  return async (signal: string): Promise<void> => {
    if (started) return;
    started = true;
    app.markDraining();
    log(`${signal} -> drain (${timeoutMs} ms max)`);
    const timer = setTimeout(() => {
      log(`drain depasse ${timeoutMs} ms -> arret force`);
      void Promise.resolve(server.stop(true)).catch(() => {});
    }, timeoutMs);
    timer.unref?.();
    try {
      await server.stop();
    } catch {
      await Promise.resolve(server.stop(true)).catch(() => {});
    } finally {
      clearTimeout(timer);
    }
  };
}

/**
 * Démarre le scraper (CLI). `HOST` explicite hors loopback exige
 * `ALLOW_PUBLIC=1` et `SCRAPER_TOKEN` ; tout refus arrive avant le bind.
 */
export function start(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): ReturnType<typeof Bun.serve> {
  const port = parsePort(envValue(env, "PORT"));
  const binding = bindingFromEnv(env);
  const tls = tlsFromEnv(env);
  if (!tls && !isLoopbackHost(binding.hostname) && !testCleartextAllowed(env)) {
    throw new Error(
      `TLS obligatoire hors boucle locale (HOST=${JSON.stringify(binding.hostname)}) : ` +
        "un bind non-loopback en clair expose la session du serveur (I8). " +
        "Fournir TLS_CERT_FILE/TLS_KEY_FILE, ou rester sur 127.0.0.1 devant un proxy TLS.",
    );
  }
  prepareJarStore(DEFAULT_AUTH_FILE, (message) => console.log(`[server] ${message}`));
  const app = createApp(binding.token ? { token: binding.token } : {});
  if (!tls) {
    // Le repli en clair doit être BRUYANT, pas une ligne discrète : un opérateur
    // qui croit démarrer en HTTPS ne doit pas se retrouver en clair sans le savoir.
    console.warn(
      "[server] ATTENTION : service en CLAIR (http) — aucun TLS_CERT_FILE/TLS_KEY_FILE. " +
        "Ne l'exposez que sur la boucle locale ou derrière un proxy TLS.",
    );
  }
  const server = Bun.serve({
    port,
    hostname: binding.hostname,
    // Même plafond au transport : le handler refuse aussi en streaming, mais
    // aucun corps plus gros n'est accepté avant lui.
    maxRequestBodySize: MAX_SCRAPE_BODY_BYTES,
    idleTimeout: 30,
    fetch: app.handler,
    ...(tls ? { tls } : {}),
    error: () => Response.json({ error: { code: "bad_request", message: "invalid body" } }, { status: 413 }),
  });
  console.log(`[server] scraper (manuels + pages web) sur ${tls ? "https" : "http"}://${binding.hostname}:${server.port}`);
  const shutdown = createShutdown(app, server, (message) => console.log(`[server] ${message}`));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  return server;
}

if (import.meta.main) start();
