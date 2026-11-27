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
import { readFileSync } from "node:fs";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import {
  HEALTH_PATH,
  MANUALS_SCRAPE_PATH,
  MAX_SCRAPE_BODY_BYTES,
  READY_PATH,
  WEB_SCRAPE_PATH,
} from "../../shared/contracts/api";
import { prepareJarStore } from "./jar-store";
import { DEFAULT_AUTH_FILE, scrapeManuals } from "./manuals-scrape";
import { PublicAdmission } from "./rate-limit";
import { scrapeWebPage } from "./web-scrape";
import {
  MAX_CONCURRENT_SCRAPES,
  SCRAPE_TIMEOUT_MS,
  type ScrapeState,
  type ScraperDeps,
  handleScrape,
  handleWebScrape,
} from "./http-handlers";
import { defaultReadiness } from "./http-readiness";
import { discardBody, error, rateLimited } from "./http-request";

export type { ScraperDeps };

const DEFAULT_PORT = 3000;

export interface App {
  readonly handler: (req: Request) => Promise<Response>;
  readonly inFlightScrapes: () => number;
  /** Retire l'instance du trafic AVANT l'arrêt : `/v1/ready` répond 503. */
  readonly markDraining: () => void;
}

/** Le drain laisse finir un scrape de 30 s, avec une marge de 5 s. */
export const DRAIN_TIMEOUT_MS = 35_000;

type Closable = { readonly stop: (closeActiveConnections?: boolean) => Promise<void> | void };

// Mode public : 6 scrapes en rafale puis 10/min par jeton, 4 en file. Un scrape
// coûte ~300 Mo : la rafale remplit deux Chromium et la file, jamais plus.
// ponytail: constantes en code ; l'exploitant les change avec le reste du
// dimensionnement (cf. cgroup dans server/README.md).
// Upgrade: variables d'environnement si des profils de charge divergent.
const PUBLIC_RATE_BURST = 6;
const PUBLIC_RATE_REFILL_PER_SECOND = 10 / 60;
const PUBLIC_QUEUE_MAX = 4;

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
