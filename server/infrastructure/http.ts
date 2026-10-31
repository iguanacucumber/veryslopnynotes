// Scraper Playwright minimal : GET /v1/health,
// POST /v1/manuals/scrape, POST /v1/web/scrape ; tout le reste = 404.
// Plain HTTPS, SANS auth : risque accepté et documenté (I8) — loopback ou
// reverse-proxy authentifié, jamais exposé.
// platform/startUrl viennent du corps (writeOnly), jamais d'env ni du dépôt ;
// username/password sont refusés. Le jar est choisi par le serveur : seul son
// nom vient de l'exploitant.
// Navigation gardée : hôte public, nom résolu, redirections et URL finale
// re-vérifiées.
// I8 : PORT/HOST + chemins TLS = seules variables lues, dans start().
import { readFileSync } from "node:fs";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import {
  MANUALS_SCRAPE_MAX_BODY_CHARS,
  MANUALS_SCRAPE_PATH,
  WEB_SCRAPE_MAX_BODY_CHARS,
  WEB_SCRAPE_PATH,
  isManualsScrapeDoc,
  isManualsScrapeRequest,
  isWebScrapeDoc,
  isWebScrapeRequest,
} from "../../shared/contracts/api";
import type { ManualDoc } from "./manuals";
import { DEFAULT_AUTH_FILE, ScrapeManualsError, scrapeManuals } from "./manuals-scrape";
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
      /**
       * Jar de session du SERVEUR (jamais choisi par l'appelant) : chemin
       * libre, sous la responsabilité de l'exploitant.
       */
      readonly defaultAuthFile?: string;
      readonly headless?: boolean;
      readonly signal?: AbortSignal;
      readonly resolveHost?: HostResolver;
    },
  ) => Promise<ManualDoc[]>;
  /**
   * Scrape d'une PAGE WEB : même moteur, SANS jar de session. Défaut = vrai
   * `scrapeWebPage` ; tests = fake pur.
   */
  readonly scrapeWeb?: (
    opts: {
      readonly startUrl: string;
      readonly headless?: boolean;
      readonly signal?: AbortSignal;
      readonly resolveHost?: HostResolver;
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
}

export interface App {
  readonly handler: (req: Request) => Promise<Response>;
  readonly inFlightScrapes: () => number;
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

interface ScrapeState {
  inFlight: number;
}

export function createApp(deps: ScraperDeps = {}): App {
  const log = (message: string) => console.log(`[server] ${message}`);
  const runScrape = deps.scrape ?? scrapeManuals;
  const runWebScrape = deps.scrapeWeb ?? scrapeWebPage;
  const defaultJar = deps.authFile ?? DEFAULT_AUTH_FILE;
  const timeoutMs = deps.timeoutMs ?? SCRAPE_TIMEOUT_MS;
  // Compteur PAR APP : un test qui laisse un scrape en vol n'empoisonne pas
  // les suivants (le serveur réel n'a qu'une instance).
  const state: ScrapeState = { inFlight: 0 };

  return {
    handler: async (req: Request): Promise<Response> => {
      try {
        const url = new URL(req.url);
        const path = url.pathname;
        if (path === "/v1/health" && (req.method === "GET" || req.method === "HEAD")) {
          const res = Response.json({ status: "ok", version: CONTRACTS_VERSION });
          return req.method === "HEAD" ? new Response(null, { status: res.status, headers: res.headers }) : res;
        }
        if (path === MANUALS_SCRAPE_PATH && req.method === "POST") {
          return await handleScrape(req, runScrape, defaultJar, log, state, timeoutMs, deps.resolveHost);
        }
        if (path === WEB_SCRAPE_PATH && req.method === "POST") {
          return await handleWebScrape(req, runWebScrape, log, state, timeoutMs, deps.resolveHost);
        }
        if (path === "/v1/health" || path === MANUALS_SCRAPE_PATH || path === WEB_SCRAPE_PATH) {
          return error("method_not_allowed", 405, `${req.method} not allowed on ${path}`, {
            allow: path === "/v1/health" ? "GET" : "POST",
          });
        }
        return error("not_found", 404, `unknown path ${path}`);
      } catch {
        return error("internal", 500, "unexpected failure");
      }
    },
    inFlightScrapes: () => state.inFlight,
  };
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

async function handleScrape(
  req: Request,
  runScrape: NonNullable<ScraperDeps["scrape"]>,
  defaultJar: string,
  log: (message: string) => void,
  state: ScrapeState,
  timeoutMs: number,
  resolveHost?: HostResolver,
): Promise<Response> {
  // Plafond AVANT tout `await` : incrémenter après une lecture de corps
  // laissait une fenêtre où N requêtes passaient toutes le contrôle.
  if (state.inFlight >= MAX_CONCURRENT_SCRAPES) {
    return error("busy", 503, "scraper occupe, reessayer plus tard", { "retry-after": "5" });
  }
  state.inFlight += 1;
  // Annulation : le délai dépassé ou le client parti doivent TUER le
  // navigateur, pas seulement rejeter la promesse (Chromium fantôme).
  const controller = new AbortController();
  let done = false;
  try {
    let text: string;
    try {
      text = await req.text();
    } catch {
      return error("bad_request", 400, "invalid JSON body");
    }
    if (text.length > MANUALS_SCRAPE_MAX_BODY_CHARS) return error("bad_request", 400, "invalid body");
    let body: unknown;
    try {
      body = JSON.parse(text);
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
    if (req.signal?.aborted) return error("school_unreachable", 502, "scrape impossible");
    let docs: ManualDoc[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onClientAbort: (() => void) | undefined;
    try {
      const scrapeP = runScrape(
        { platform: body.platform },
        {
          startUrl: body.startUrl,
          // Le SEUL jar monté est celui du serveur.
          defaultAuthFile: defaultJar,
          headless: body.headless,
          // La garde SSRF résout le nom d'hôte avant la navigation. Le
          // résolveur est celui du serveur (jamais celui de l'appelant) ;
          // les tests injectent un faux résolveur.
          resolveHost,
          // Le délai dépassé ou le client parti tuent le navigateur.
          signal: controller.signal,
        },
      );
      // La course peut être perdue (délai, abandon) : la rejection tardive du
      // scrape ne doit pas devenir une rejection non geree.
      scrapeP.catch(() => {});
      const timeoutP = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          // Rejetter PUIS annuler : la course tranche sur le délai, pas sur
          // l'erreur du navigateur fermé.
          reject(timeoutError(timeoutMs));
          controller.abort();
        }, timeoutMs);
      });
      const abortP = new Promise<never>((_, reject) => {
        if (!req.signal) return;
        onClientAbort = () => {
          reject(new ScrapeManualsError("client aborte"));
          controller.abort();
        };
        if (req.signal.aborted) {
          onClientAbort();
          return;
        }
        req.signal.addEventListener("abort", onClientAbort, { once: true });
      });
      try {
        docs = await Promise.race([scrapeP, timeoutP, abortP]);
        done = true;
      } finally {
        if (timer) clearTimeout(timer);
        if (onClientAbort) req.signal?.removeEventListener("abort", onClientAbort);
      }
    } catch (err) {
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
    state.inFlight = Math.max(0, state.inFlight - 1);
    // Scrape non terminé (erreur, exception) : on annule pour ne pas laisser
    // un Chromium orphelin en arrière-plan.
    if (!done) controller.abort();
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
): Promise<Response> {
  if (state.inFlight >= MAX_CONCURRENT_SCRAPES) {
    return error("busy", 503, "scraper occupe, reessayer plus tard", { "retry-after": "5" });
  }
  state.inFlight += 1;
  const controller = new AbortController();
  let done = false;
  try {
    let text: string;
    try {
      text = await req.text();
    } catch {
      return error("bad_request", 400, "invalid JSON body");
    }
    if (text.length > WEB_SCRAPE_MAX_BODY_CHARS) return error("bad_request", 400, "invalid body");
    let body: unknown;
    try {
      body = JSON.parse(text);
    } catch {
      return error("bad_request", 400, "invalid JSON body");
    }
    if (!isWebScrapeRequest(body)) return error("bad_request", 400, "invalid web scrape request");
    if (req.signal?.aborted) return error("school_unreachable", 502, "scrape impossible");
    let docs: WebDoc[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onClientAbort: (() => void) | undefined;
    try {
      const scrapeP = runScrape({
        startUrl: body.url,
        headless: true,
        resolveHost,
        signal: controller.signal,
      });
      scrapeP.catch(() => {});
      const timeoutP = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(timeoutError(timeoutMs));
          controller.abort();
        }, timeoutMs);
      });
      const abortP = new Promise<never>((_, reject) => {
        if (!req.signal) return;
        onClientAbort = () => {
          reject(new ScrapeManualsError("client aborte"));
          controller.abort();
        };
        if (req.signal.aborted) {
          onClientAbort();
          return;
        }
        req.signal.addEventListener("abort", onClientAbort, { once: true });
      });
      try {
        docs = await Promise.race([scrapeP, timeoutP, abortP]);
        done = true;
      } finally {
        if (timer) clearTimeout(timer);
        if (onClientAbort) req.signal?.removeEventListener("abort", onClientAbort);
      }
    } catch (err) {
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
    state.inFlight = Math.max(0, state.inFlight - 1);
    if (!done) controller.abort();
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

function error(code: string, status: number, message: string, extraHeaders?: Record<string, string>): Response {
  return Response.json({ error: { code, message } }, { status, headers: extraHeaders });
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

/** Corps HTTP maximal : la seule route JSON est bornée à quelques ko. */
const MAX_REQUEST_BODY_BYTES = 1_048_576;

function envValue(env: Record<string, string | undefined>, key: string): string {
  return (env[key] ?? "").trim();
}

/**
 * TLS : `TLS_CERT_FILE` + `TLS_KEY_FILE` = HTTPS, rien = HTTP (tests et
 * Docker). Chemins vers du matériel local, pas des credentials : rien à
 * commiter, clé générée hors dépôt. Une seule des deux = REFUS explicite,
 * jamais un repli silencieux en clair (l'app interdit le clairtext).
 */
function tlsFromEnv(env: Record<string, string | undefined>): { cert: string; key: string } | null {
  const cert = envValue(env, "TLS_CERT_FILE");
  const key = envValue(env, "TLS_KEY_FILE");
  if (!cert && !key) return null;
  if (!cert || !key) {
    throw new Error(
      "TLS incomplet: TLS_CERT_FILE et TLS_KEY_FILE doivent etre definis ensemble " +
        "(ou absents tous les deux pour un serveur en clair)",
    );
  }
  return { cert: readPem(cert, "TLS_CERT_FILE"), key: readPem(key, "TLS_KEY_FILE") };
}

function readPem(path: string, variable: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch {
    throw new Error(`${variable} illisible (${path}) : fichier PEM absent ou non lisible`);
  }
}

/**
 * Démarre le scraper (CLI). `HOST` explicite requis pour exposer hors loopback.
 */
export function start(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): ReturnType<typeof Bun.serve> {
  const app = createApp();
  const port = parsePort(envValue(env, "PORT"));
  const hostname = envValue(env, "HOST") || "127.0.0.1";
  const tls = tlsFromEnv(env);
  if (!tls) {
    // Le repli en clair doit être BRUYANT, pas une ligne discrète : le scraper
    // est sans auth (I8), un opérateur qui croit démarrer en HTTPS ne doit pas
    // se retrouver en clair sans le savoir.
    console.warn(
      "[server] ATTENTION : service en CLAIR (http) — aucun TLS_CERT_FILE/TLS_KEY_FILE. " +
        "Le scraper est sans authentification (I8) : ne l'exposez que sur un réseau de confiance.",
    );
  }
  const server = Bun.serve({
    port,
    hostname,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    idleTimeout: 30,
    fetch: app.handler,
    ...(tls ? { tls } : {}),
    error: () => Response.json({ error: { code: "bad_request", message: "invalid body" } }, { status: 413 }),
  });
  console.log(`[server] scraper (manuels + pages web) sur ${tls ? "https" : "http"}://${hostname}:${server.port}`);
  const shutdown = (signal: string) => {
    console.log(`[server] ${signal} -> arret`);
    try {
      server.stop(true);
    } catch {
      try {
        server.stop();
      } catch {
        /* noop */
      }
    }
  };
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));
  return server;
}

if (import.meta.main) start();
