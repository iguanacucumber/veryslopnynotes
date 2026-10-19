// Scrape manuels via Playwright (issue #25, phase 8).
// 0.7.0 : le compte éditeur n'est PLUS lu dans l'environnement (le serveur ne
// détient aucun credential). `ManualsConfig` est fourni par l'appelant — donc
// la seule façon de l'obtenir est de le faire vivre avec le processus.
// Aucune URL/credential en dur : startUrl fourni par l'appelant (humain,
// jamais commité), plateforme = nom symbolique. Playwright en import
// dynamique optionnel : zéro dépendance ajoutée, e2e skippé sans navigateur.
// Contenu retourné = brut à marquer Untrusted (markManualsUntrusted) avant IA.
// ponytail: squelette extraction texte générique, pas de sélecteurs par éditeur.
// Upgrade: sélecteurs par plateforme + pagination + PDF-detect si corpus réel.
//
// #362 : deux garde-fous ajoutés, tous deux testés (tests/unit/scraper-ssrf.test.ts).
//  1. SSRF, trois couches : hôte analysé APRÈS normalisation WHATWG (IPv4-mapped
//     IPv6, entiers, hex), chaîne de redirections vérifiée AVANT le navigateur
//     (Chromium suit un 302 sans repasser par le route handler), URL FINALE
//     re-vérifiée après navigation, sous-ressources privées coupées.
//  2. `authFile` n'est plus un chemin piloté par l'appelant : c'est un NOM de
//     jar, placé par le serveur sous SON répertoire (playwright/.auth/).
// #419 : la garde ne s'arrête plus au NOM — le nom est RÉSOLU
//  (server/infrastructure/ssrf.ts) et chaque adresse obtenue est testée
//  contre les plages privées : un nom public qui pointe vers une IP interne
//  (rebinding) est refusé AVANT la navigation, avec un motif explicite.
//  Il reste la fenêtre TOCTOU : le navigateur résout de son côté, au moment
//  de la connexion (cf. ssrf.ts) — un nom rebindé entre la vérification et la
//  connexion peut donc encore partir vers une IP interne.
import { dirname, join, resolve } from "node:path";
import { load } from "cheerio";
import { MANUALS_SCRAPE_AUTH_FILE_RE } from "../../shared/contracts/api";
import { truncateManualText } from "./manuals";
import type { ManualDoc } from "./manuals";
import { checkPublicHost, systemResolver } from "./ssrf";
import type { HostResolver } from "./ssrf";

export interface ManualsConfig {
  readonly platform: string;
  readonly username: string;
  readonly password: string;
}

/** Motif de refus typé : le serveur l'expose à l'appelant (jamais l'URL). */
export type ScrapeRefusal = "private_host" | "unresolved_host" | "generic";

export class ScrapeManualsError extends Error {
  /** Motif du refus : `private_host` = garde SSRF (403), `generic` = 502. */
  readonly reason: ScrapeRefusal;
  constructor(message: string, reason: ScrapeRefusal = "generic") {
    super(message);
    this.name = "ScrapeManualsError";
    this.reason = reason;
  }
}

export interface ScrapeOptions {
  /** URL de départ fournie par l'humain (jamais committée). */
  readonly startUrl: string;
  /**
   * NOM du jar de session demandé (jamais un chemin) : le serveur impose son
   * répertoire. Absent = jar serveur par défaut.
   */
  readonly authFile?: string;
  /** Jar par défaut du serveur (chemin choisi par l'exploitant). */
  readonly defaultAuthFile?: string;
  /** false = première connexion interactive visible. */
  readonly headless?: boolean;
  readonly timeoutMs?: number;
  readonly logger?: (message: string) => void;
  /**
   * Résolution DNS de l'hôte (injectable : les tests ne touchent pas le
   * réseau). Défaut = résolveur du système.
   */
  readonly resolveHost?: HostResolver;
  /**
   * Annulation (délai HTTP dépassé, client parti) : le navigateur doit
   * RÉELLEMENT mourir, sinon le Chromium continue en arrière-plan (~300 Mo)
   * alors que la requête a déjà rendu son verdict.
   */
  readonly signal?: AbortSignal;
}

/** Répertoire des jars, côté serveur (gitignoré). */
export const AUTH_DIR = "playwright/.auth";
export const DEFAULT_AUTH_FILE = join(AUTH_DIR, "manuals.json");
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Résout le jar de session. `requested` = NOM de fichier (contrat) : le
 * chemin final est IMPOSÉ par le serveur (répertoire + nom), donc l'appelant
 * ne peut plus écrire où il veut. Un chemin (séparateur, « .. », absolu) est
 * refusé explicitement, jamais réécrit en silence.
 * ponytail: un seul niveau (pas d'arborescence) : un jar = un fichier.
 */
export function resolveAuthFile(requested?: string, fallback: string = DEFAULT_AUTH_FILE): string {
  if (requested === undefined) return fallback;
  const name = requested.trim();
  if (name === "" || name.includes("..") || !MANUALS_SCRAPE_AUTH_FILE_RE.test(name)) {
    throw new ScrapeManualsError("authFile invalide (nom de jar attendu, chemin refuse)");
  }
  const resolved = join(AUTH_DIR, name);
  if (resolve(dirname(resolved)) !== resolve(AUTH_DIR)) {
    throw new ScrapeManualsError("authFile hors du repertoire serveur");
  }
  return resolved;
}

/**
 * Hôte d'une URL http(s) (null si l'URL est illisible). Utilisé par le route
 * handler, qui voit des URL de requêtes (sous-ressources comprises).
 */
function hostOf(raw: string): string | null {
  try {
    const u = new URL(raw);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.hostname;
  } catch {
    return null;
  }
}

/**
 * Hôte public APRÈS résolution DNS (#419). Un nom qui résout vers une IP
 * privée/interne est refusé (motif explicite : `private_host`), un nom
 * introuvable aussi (jamais un silence : le navigateur n'atteindrait rien).
 * Le message ne contient ni l'URL ni l'adresse obtenue : les logs du serveur
 * ne doivent rien laisser filtrer (cf. I8).
 */
async function assertPublicHost(hostname: string, label: string, resolve: HostResolver): Promise<void> {
  const verdict = await checkPublicHost(hostname, resolve);
  if (verdict === "private") {
    throw new ScrapeManualsError(`${label} : hote prive refuse`, "private_host");
  }
  if (verdict === "unresolved") {
    throw new ScrapeManualsError(`${label} : hote introuvable (resolution DNS)`, "unresolved_host");
  }
}

/**
 * URL http(s) PUBLIQUE exigée : protocole, hôte littéral non privé, et nom
 * RÉSOLU (#419) — un nom public qui pointe vers une IP interne est refusé.
 * Le message ne contient jamais l'URL : les logs du serveur ne doivent rien
 * laisser filtrer (cf. I8).
 */
async function assertPublicUrl(raw: string, label: string, resolve: HostResolver): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ScrapeManualsError(`${label} http(s) requise (jamais journalisee)`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ScrapeManualsError(`${label} http(s) requise (jamais journalisee)`);
  }
  await assertPublicHost(u.hostname, label, resolve);
}

/** Budget de la vérification de redirection, et nombre de sauts suivis. */
const REDIRECT_CHECK_TIMEOUT_MS = 5_000;
const MAX_REDIRECT_HOPS = 3;

/**
 * Vérifie la chaîne de redirections AVANT de lancer le navigateur.
 *
 * Pourquoi : Chromium suit les redirections SANS repasser par le route
 * handler de Playwright (mesuré sur Playwright 1.64 : le handler voit la
 * requête initiale, jamais la cible du 302). Sans cette vérification, une
 * URL publique en 302 vers http://169.254.169.254/… atteint quand même le
 * service interne (SSRF « à l'aveugle » : le contenu ne fuit plus, la
 * requête part quand même). On suit donc la chaîne à la main (au plus
 * MAX_REDIRECT_HOPS sauts) et on refuse dès qu'un maillon est privé.
 *
 * #419 : chaque maillon est aussi RÉSOLU (nom -> adresses) avant le `fetch` :
 * une redirection vers un nom public qui pointe vers l'IP interne est
 * refusée elle aussi.
 *
 * ponytail: lecture seule, sans cookie ni JS : le navigateur peut voir une
 * chaîne différente — d'où la re-vérification de l'URL finale après
 * navigation (le filet qui protège le contenu).
 */
export async function assertPublicRedirectChain(
  startUrl: string,
  timeoutMs = REDIRECT_CHECK_TIMEOUT_MS,
  resolve: HostResolver = systemResolver,
): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = startUrl;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    await assertPublicUrl(current, "redirection", resolve);
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", signal });
    } catch {
      return; // DNS/réseau indisponible : le navigateur tranchera
    }
    if (res.status < 300 || res.status >= 400) return; // pas de redirection
    const location = res.headers.get("location");
    if (!location) return;
    let target: string;
    try {
      target = new URL(location, current).toString();
    } catch {
      return;
    }
    await assertPublicUrl(target, "redirection", resolve);
    current = target;
  }
}

// Extraction texte : script/style retirés, entités HTML DÉCODÉES (« &eacute; »,
// « &nbsp; » laissés tels quels = extrait illisible et introuvable à la
// recherche). Cheerio déjà dépendance, zéro ajoutée.
// Espace ajouté après chaque élément : sinon deux paragraphes se collent.
function stripTags(html: string): string {
  const $ = load(html);
  $("script,style").remove();
  $("*").each((_i, el) => {
    $(el).append(" ");
  });
  return $.root()
    .text()
    .replace(/\s+/g, " ")
    .trim();
}

// Scrape générique v1 : une page -> un ManualDoc (titre + texte).
// Lève ScrapeManualsError si config incomplète, URL invalide ou navigateur absent.
// Ne logue jamais username/password, seulement plateforme + compteurs.
export async function scrapeManuals(config: ManualsConfig | null, opts: ScrapeOptions): Promise<ManualDoc[]> {
  if (!config) throw new ScrapeManualsError("manuels non configurés (aucun compte éditeur fourni par l'appelant)");
  // Annulation AVANT toute résolution DNS : un client parti ne doit pas
  // déclencher de requête réseau.
  if (opts.signal?.aborted) throw new ScrapeManualsError("scrape annulé");
  const resolve = opts.resolveHost ?? systemResolver;
  // Le nom de l'hôte est RÉSOLU (#419) : un nom public qui pointe vers une
  // IP interne est refusé ici, AVANT la navigation.
  await assertPublicUrl(opts.startUrl, "startUrl", resolve);
  // La chaîne de redirections est vérifiée AVANT le navigateur : Chromium
  // suit un 302 sans repasser par le route handler, la cible interne serait
  // donc atteinte (requête à l'aveugle) si on attendait la navigation.
  await assertPublicRedirectChain(
    opts.startUrl,
    Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, REDIRECT_CHECK_TIMEOUT_MS),
    resolve,
  );
  // Le jar est résolu AVANT le navigateur : un authFile hors périmètre est
  // refusé sans rien écrire, sans lancer Playwright.
  const authFile = resolveAuthFile(opts.authFile, opts.defaultAuthFile ?? DEFAULT_AUTH_FILE);
  const log = opts.logger ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const signal = opts.signal;
  if (signal?.aborted) throw new ScrapeManualsError("scrape annulé");
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pw: any;
  try {
    pw = (await import("play" + "wright")) as any;
  } catch {
    throw new ScrapeManualsError("Playwright non installé — e2e manuals skippé (aucune dép ajoutée v1)");
  }
  const browser = await pw.chromium.launch({ headless: opts.headless ?? true, timeout: timeoutMs });
  // Annulation RÉELLE : le navigateur est un processus externe, pas une
  // promesse — sans cette fermeture, un délai dépassé laissait tourner un
  // Chromium orphelin (épuisement mémoire, cf. #363).
  const abortBrowser = () => {
    try {
      void browser.close().catch(() => {});
    } catch {
      /* noop */
    }
  };
  if (signal?.aborted) {
    await browser.close().catch(() => {});
    throw new ScrapeManualsError("scrape annulé");
  }
  signal?.addEventListener("abort", abortBrowser, { once: true });
  let context: any = null;
  try {
    context =
      (await browser.newContext({ ...(authFile ? { storageState: authFile } : {}) }).catch(
        // Premier run : pas de fichier local, contexte frais pour login interactif.
        async () => browser.newContext(),
      )) ?? null;
    const page = await context.newPage();
    // #362 : le navigateur suit les redirections. Une URL publique qui
    // répond 302 vers http://169.254.169.254/… est donc atteinte si on ne
    // coupe pas la navigation : la requête vers la cible privée est
    // INTERROMPUE (abort) avant d'atteindre le réseau interne.
    // #419 : le nom est RÉSOLU ici aussi — un nom public qui pointe vers une
    // IP interne est coupé AVANT que la requête parte (rebinding).
    let blockedTarget = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.route("**/*", async (route: any) => {
      // API Playwright : `route.request()` est une MÉTHODE.
      const request = typeof route?.request === "function" ? route.request() : null;
      const target = typeof request?.url === "function" ? request.url() : "";
      const kind = typeof request?.resourceType === "function" ? request.resourceType() : "document";
      if (/^https?:\/\//i.test(target)) {
        const host = hostOf(target);
        // Nom illisible ou privé (littéral OU nom qui résout vers une IP
        // privée) : la requête est coupée.
        const verdict = host === null ? "private" : await checkPublicHost(host, resolve);
        if (verdict !== "public") {
          // Navigation (document) bloquée = scrape refusé ; sous-ressource
          // bloquée = simple accusé de réception (une image d'un réseau privé
          // ne doit pas faire échouer le scrape). Un nom INTROUVABLE n'est pas
          // un hôte privé : la navigation échoue, sans motif SSRF.
          if (kind === "document" && verdict === "private") blockedTarget = true;
          await route.abort().catch(() => {});
          return;
        }
      }
      await route.continue().catch(() => {});
    });
    log(`scrape ${config.platform} -> 1 page`);
    // Statut HTTP vérifié AVANT toute extraction : une page d'erreur (404/500)
    // ou un mur de connexion ne doit jamais devenir un ManualDoc (le corpus
    // citerait sinon « Page introuvable » comme source de corrigé).
    const response = await page.goto(opts.startUrl, { timeout: timeoutMs }).catch(() => null);
    if (blockedTarget) {
      throw new ScrapeManualsError("cible privee/interne refusee (redirection)", "private_host");
    }
    const status = typeof response?.status === "function" ? response.status() : 0;
    const ok = typeof response?.ok === "function" ? response.ok() : status < 400;
    if (!response || !ok || status >= 400) {
      throw new ScrapeManualsError(
        `réponse HTTP ${status || "inconnue"} sur ${config.platform} — page non ingérée`,
      );
    }
    // URL FINALE (redirections suivies) : re-vérifiée AVANT toute extraction.
    // Sans cette re-vérification, une redirection vers une cible interne
    // ferait entrer le corps du service interne dans l'extrait.
    await assertPublicUrl(typeof page.url === "function" ? page.url() : opts.startUrl, "cible finale", resolve);
    const title = (await page.title().catch(() => config.platform)) || config.platform;
    const html: string = await page.content().catch(() => "");
    const text = truncateManualText(stripTags(html), 4000);
    await context.storageState({ path: authFile }).catch(() => {
      log(`scrape ${config.platform} -> jar non persiste`);
    });
    await context.close().catch(() => {
      log(`scrape ${config.platform} -> contexte non ferme`);
    });
    context = null;
    if (!text) return [];
    return [
      {
        id: `scrape-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
        platform: config.platform,
        title,
        subject: title,
        page: 1,
        excerpt: text,
      },
    ];
  } finally {
    signal?.removeEventListener("abort", abortBrowser);
    if (context !== null) {
      await context.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}
