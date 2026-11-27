// Pipeline des routes POST de scrape : corps borné, échéance absolue, plafond
// de concurrence et mapping d'erreur. Aucune lecture d'environnement ici.
import {
  MANUALS_SCRAPE_MAX_BODY_CHARS,
  WEB_SCRAPE_MAX_BODY_CHARS,
  isManualsScrapeDoc,
  isManualsScrapeRequest,
  isWebScrapeDoc,
  isWebScrapeRequest,
} from "../../shared/contracts/api";
import type { ManualDoc } from "./manuals";
import { ScrapeManualsError } from "./manuals-scrape";
import type { HostResolver } from "./ssrf";
import {
  type ReadJsonBody,
  abortedResponse,
  abortRejection,
  error,
  isMissingBrowserError,
  isSandboxUnavailableError,
  readJsonBody,
  startRequestDeadline,
} from "./http-request";
import type { WebDoc } from "./web-scrape";

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
export const SCRAPE_TIMEOUT_MS = 30_000;
export const MAX_CONCURRENT_SCRAPES = 2;

export interface ScrapeState {
  inFlight: number;
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

export async function handleScrape(
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
export async function handleWebScrape(
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
