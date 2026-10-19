// Scraper Playwright minimal (issue #209) : le process ne sert QUE des manuels.
// Plain HTTPS, SANS auth (décision utilisateur du 2026-10-11 : "Plain HTTPS, no
// auth at all").
//
// RISQUE ACCEPTÉ, documenté, hors périmètre : sans auth, quiconque connaît
// l'URL pilote Playwright — SSRF vers le réseau du scraper + brûlage de
// session portail (un tiers peut épuiser le compte éditeur). Suivi recommandé :
// loopback + reverse-proxy avec auth devant le scraper. Cette issue construit
// le HTTPS nu spécifié, rien de plus.
//
// Routes : GET /v1/health (sonde), POST /v1/manuals/scrape (page -> ManualDoc).
// Tout le reste = 404 : les anciennes routes métier et le chemin de capture TS
// sont supprimés. Le processus sert uniquement les deux routes du scraper.
//
// Credentials portail (platform/username/password/startUrl) injectés par
// l'appelant dans le corps (writeOnly) : jamais en env, jamais commités,
// jamais journalisés — seuls compteurs et codes d'erreur sortent dans les
// logs. Seul le cookie jar Playwright vit sur disque (gitignoré, réutilisé
// entre runs) : son CHEMIN n'est plus choisi par l'appelant, seulement son
// NOM (#362) — le serveur impose le répertoire du jar.
// I8 inchangé : `PORT`/`HOST` + chemins TLS = seules variables lues,
// uniquement dans `start()`.
import { readFileSync } from "node:fs";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import {
  MANUALS_SCRAPE_MAX_BODY_CHARS,
  MANUALS_SCRAPE_PATH,
  isManualsScrapeDoc,
  isManualsScrapeRequest,
} from "../../shared/contracts/api";
import type { ManualDoc } from "./manuals";
import { DEFAULT_AUTH_FILE, ScrapeManualsError, scrapeManuals } from "./manuals-scrape";

const DEFAULT_PORT = 3000;

export interface ScraperDeps {
  /**
   * Fonction de scrape injectée. Défaut = vrai `scrapeManuals` (Playwright) ;
   * tests = fake pur, aucun navigateur, aucun réseau.
   * `signal` = annulation : le scraper doit tuer le navigateur quand le
   * signal passe à `aborted` (délai dépassé ou client parti).
   */
  readonly scrape?: (
    config: { readonly platform: string; readonly username: string; readonly password: string },
    opts: {
      readonly startUrl: string;
      readonly authFile?: string;
      readonly defaultAuthFile?: string;
      readonly headless?: boolean;
      readonly signal?: AbortSignal;
    },
  ) => Promise<ManualDoc[]>;
  /**
   * Jar de session par DÉFAUT, choisi par le serveur (jamais par l'appelant de
   * l'API) : chemin libre, sous la responsabilité de l'exploitant.
   */
  readonly authFile?: string;
  /** Délai d'attente du scrape (défaut 30 s) ; injectable pour les tests. */
  readonly timeoutMs?: number;
}

export interface App {
  readonly handler: (req: Request) => Promise<Response>;
  /** Scrapes en vol (plafond de concurrence) : observabilité, tests. */
  readonly inFlightScrapes: () => number;
}

/**
 * POST /v1/manuals/scrape : corps borné AVANT parse (route ouverte : ne jamais
 * y bufferiser un corps arbitraire), validé par le contrat, credentials
 * transmis au scraper sans transiter par un log. Réponse = docs validés un par
 * un : une page d'erreur ne devient jamais un ManualDoc.
 * Plafond de concurrence : 2 scrapes en vol, le reste = 503 (l'endpoint est
 * public par conception, cf. I8 — un tiers ne doit pas pouvoir empiler des
 * Chromium, ~300 Mo chacun).
 * ponytail: borne 30s + cap 2 concurrents, compteur seul en memoire.
 * Upgrade: file persistante si multi-instances.
 */
const SCRAPE_TIMEOUT_MS = 30_000;
const MAX_CONCURRENT_SCRAPES = 2;

/** Compteur de scrapes en vol, par application (jamais global). */
interface ScrapeState {
  inFlight: number;
}

export function createApp(deps: ScraperDeps = {}): App {
  const log = (message: string) => console.log(`[server] ${message}`);
  const runScrape = deps.scrape ?? scrapeManuals;
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
          return await handleScrape(req, runScrape, defaultJar, log, state, timeoutMs);
        }
        if (path === "/v1/health" || path === MANUALS_SCRAPE_PATH) {
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
  return new ScrapeManualsError(`scrape timeout ${ms}ms`);
}

async function handleScrape(
  req: Request,
  runScrape: NonNullable<ScraperDeps["scrape"]>,
  defaultJar: string,
  log: (message: string) => void,
  state: ScrapeState,
  timeoutMs: number,
): Promise<Response> {
  // Plafond AVANT tout `await` : incrémenter après une lecture de corps
  // laissait une fenêtre où N requêtes passaient toutes le contrôle (#363).
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
    if (req.signal?.aborted) return error("school_unreachable", 502, "scrape impossible");
    let docs: ManualDoc[];
    let timer: ReturnType<typeof setTimeout> | undefined;
    let onClientAbort: (() => void) | undefined;
    try {
      const scrapeP = runScrape(
        { platform: body.platform, username: body.username, password: body.password },
        {
          startUrl: body.startUrl,
          // #362 : le corps ne fournit plus un CHEMIN de jar, seulement un NOM.
          // Le serveur impose son répertoire : l'appelant ne peut plus écrire
          // de fichier n'importe où.
          authFile: body.authFile,
          defaultAuthFile: defaultJar,
          headless: body.headless,
          // #363 : le délai dépassé ou le client parti tuent le navigateur.
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
      // Navigateur absent = capability manquante (501 franc), pas un faux succès
      // ni un 500 « unexpected failure » : motifs multiples, message Playwright
      // réel compris (exécutable absent, install-deps, invite à installer).
      if (isMissingBrowserError(err)) {
        return error("not_implemented", 501, "scraper sans navigateur");
      }
      if (err instanceof ScrapeManualsError) return error("school_unreachable", 502, "scrape impossible");
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
 * Navigateur Playwright ABSENT = capability manquante (501 franc), pas un
 * faux 500 « unexpected failure ». Le message réel de Playwright change selon
 * la version et la cause (« Executable doesn't exist at … », « Please run the
 * following command to download new browsers », « Host system is missing
 * dependencies… », « playwright install ») : on matche une LISTE de motifs,
 * jamais une chaîne fragile. ponytail: regex sur le message, pas de
 * dépendance et pas de parsing de sortie d'outil.
 * Upgrade: appellate d'erreur stable de Playwright si un jour elle existe.
 */
const MISSING_BROWSER_PATTERNS: readonly RegExp[] = [
  /playwright non install/i, // module absent (message interne du scraper)
  /executable doesn't exist/i, // binaire du navigateur non téléchargé
  /download new browsers/i, // Playwright invite à télécharger le navigateur
  /playwright install/i, // commande d'installation citée dans le message
  /host system is missing dependencies/i, // libs système absentes
  /navigateur (?:absent|manquant|introuvable)/i,
];

/** L'erreur signifie-t-elle « pas de navigateur utilisable » ? */
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
 * TLS : `TLS_CERT_FILE` + `TLS_KEY_FILE` = HTTPS, rien = HTTP (borne aux tests
 * et à Docker). Chemins vers du matériel local, pas des credentials : rien à
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
 * Type de retour : `ReturnType<typeof Bun.serve`.
 */
export function start(
  env: Record<string, string | undefined> = Bun.env as Record<string, string | undefined>,
): ReturnType<typeof Bun.serve> {
  const app = createApp();
  const port = parsePort(envValue(env, "PORT"));
  const hostname = envValue(env, "HOST") || "127.0.0.1";
  const tls = tlsFromEnv(env);
  const server = Bun.serve({
    port,
    hostname,
    maxRequestBodySize: MAX_REQUEST_BODY_BYTES,
    idleTimeout: 30,
    fetch: app.handler,
    ...(tls ? { tls } : {}),
    error: () => Response.json({ error: { code: "bad_request", message: "invalid body" } }, { status: 413 }),
  });
  console.log(`[server] scraper manuels sur ${tls ? "https" : "http"}://${hostname}:${server.port}`);
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
