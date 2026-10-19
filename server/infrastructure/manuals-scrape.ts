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
import { dirname, join, resolve } from "node:path";
import { load } from "cheerio";
import { MANUALS_SCRAPE_AUTH_FILE_RE } from "../../shared/contracts/api";
import { isBlockedHost, isPublicHttpUrl } from "../../shared/contracts/net";
import { truncateManualText } from "./manuals";
import type { ManualDoc } from "./manuals";

export interface ManualsConfig {
  readonly platform: string;
  readonly username: string;
  readonly password: string;
}

export class ScrapeManualsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ScrapeManualsError";
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
 * URL http(s) PUBLIQUE exigée. Le message ne contient jamais l'URL : les
 * logs du serveur ne doivent rien laisser filtrer (cf. I8).
 */
function assertPublicUrl(raw: string, label: string): void {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ScrapeManualsError(`${label} http(s) requise (jamais journalisee)`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ScrapeManualsError(`${label} http(s) requise (jamais journalisee)`);
  }
  if (isBlockedHost(u.hostname)) {
    throw new ScrapeManualsError(`${label} privee/interne refusee`);
  }
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
 * ponytail: lecture seule, sans cookie ni JS : le navigateur peut voir une
 * chaîne différente — d'où la re-vérification de l'URL finale après
 * navigation (le filet qui protège le contenu).
 */
export async function assertPublicRedirectChain(startUrl: string, timeoutMs = REDIRECT_CHECK_TIMEOUT_MS): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = startUrl;
  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    if (!isPublicHttpUrl(current)) {
      throw new ScrapeManualsError("redirection vers une cible privee/interne refusee");
    }
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
    if (!isPublicHttpUrl(target)) {
      throw new ScrapeManualsError("redirection vers une cible privee/interne refusee");
    }
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
  assertPublicUrl(opts.startUrl, "startUrl");
  // La chaîne de redirections est vérifiée AVANT le navigateur : Chromium
  // suit un 302 sans repasser par le route handler, la cible interne serait
  // donc atteinte (requête à l'aveugle) si on attendait la navigation.
  await assertPublicRedirectChain(opts.startUrl, Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, REDIRECT_CHECK_TIMEOUT_MS));
  // Le jar est résolu AVANT le navigateur : un authFile hors périmètre est
  // refusé sans rien écrire, sans lancer Playwright.
  const authFile = resolveAuthFile(opts.authFile, opts.defaultAuthFile ?? DEFAULT_AUTH_FILE);
  const log = opts.logger ?? (() => {});
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pw: any;
  try {
    pw = (await import("play" + "wright")) as any;
  } catch {
    throw new ScrapeManualsError("Playwright non installé — e2e manuals skippé (aucune dép ajoutée v1)");
  }
  const browser = await pw.chromium.launch({ headless: opts.headless ?? true, timeout: timeoutMs });
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
    let blockedTarget = false;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await page.route("**/*", async (route: any) => {
      // API Playwright : `route.request()` est une MÉTHODE.
      const request = typeof route?.request === "function" ? route.request() : null;
      const target = typeof request?.url === "function" ? request.url() : "";
      const kind = typeof request?.resourceType === "function" ? request.resourceType() : "document";
      if (/^https?:\/\//i.test(target) && !isPublicHttpUrl(target)) {
        // Navigation (document) bloquée = scrape refusé ; sous-ressource
        // bloquée = simple accusé de réception (une image d'un réseau privé
        // ne doit pas faire échouer le scrape).
        if (kind === "document") blockedTarget = true;
        await route.abort().catch(() => {});
        return;
      }
      await route.continue().catch(() => {});
    });
    log(`scrape ${config.platform} -> 1 page`);
    // Statut HTTP vérifié AVANT toute extraction : une page d'erreur (404/500)
    // ou un mur de connexion ne doit jamais devenir un ManualDoc (le corpus
    // citerait sinon « Page introuvable » comme source de corrigé).
    const response = await page.goto(opts.startUrl, { timeout: timeoutMs }).catch(() => null);
    if (blockedTarget) {
      throw new ScrapeManualsError("cible privee/interne refusee (redirection)");
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
    assertPublicUrl(typeof page.url === "function" ? page.url() : opts.startUrl, "cible finale");
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
    if (context !== null) {
      await context.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}
