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
//  2. le jar de session n'est plus choisi par l'appelant : d'abord un chemin
//     (écriture de fichier arbitraire), puis un NOM de jar — mais le nom
//     suffit à appeler la session d'un autre tenant.
// #538 : le jar est celui du SERVEUR, et lui seul. Plus de nom de jar à
//  résoudre : le navigateur ne monte jamais la session d'un autre tenant,
//  et le corps qui demande un jar est refusé par le serveur (message dédié).
// #419 : la garde ne s'arrête plus au NOM — le nom est RÉSOLU
//  (server/infrastructure/ssrf.ts) et chaque adresse obtenue est testée
//  contre les plages privées : un nom public qui pointe vers une IP interne
//  (rebinding) est refusé AVANT la navigation, avec un motif explicite.
//  Il reste la fenêtre TOCTOU : le navigateur résout de son côté, au moment
//  de la connexion (cf. ssrf.ts) — un nom rebindé entre la vérification et la
//  connexion peut donc encore partir vers une IP interne.
// #422 : le HTML RÉCUPÉRÉ est borné (plafond de caractères AVANT le reparse
//  cheerio) et la lecture a un DÉLAI : `page.content()` lit TOUTE la page en
//  mémoire (50 Mo => des centaines de Mo au reparse, x2 scrapes simultanés)
//  et n'a aucun délai natif (une page qui ne finit pas de streamer survit au
//  délai HTTP et garde le Chromium vivant).
import { join } from "node:path";
import { load } from "cheerio";
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
export type ScrapeRefusal = "private_host" | "unresolved_host" | "timeout" | "generic";

export class ScrapeManualsError extends Error {
  /** Motif du refus : `private_host` = garde SSRF (403), `timeout` = 504, `generic` = 502. */
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
   * Jar de session du SERVEUR (chemin choisi par l'exploitant). Jamais celui
   * d'un appelant : le nom du jar ne se déduisait pas du contenu de la
   * session, mais l'appelait — un appelant pouvait donc naviguer avec la
   * session d'un autre tenant (#538). Absent = jar serveur par défaut.
   */
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
  /**
   * Délai de LECTURE du HTML (défaut 10 s) : `page.content()` n'a pas de
   * délai à lui — une page qui ne finit pas de streamer bloquerait le scrape
   * et garderait le Chromium vivant au-delà du délai HTTP.
   */
  readonly contentTimeoutMs?: number;
}

/** Répertoire des jars, côté serveur (gitignoré). */
export const AUTH_DIR = "playwright/.auth";
export const DEFAULT_AUTH_FILE = join(AUTH_DIR, "manuals.json");
const DEFAULT_TIMEOUT_MS = 30_000;
/**
 * Plafond du HTML RÉCUPÉRÉ (caractères), appliqué AVANT le reparse cheerio
 * (#422) : le coût du parse est linéaire (plusieurs fois la taille du HTML),
 * donc une page de 50 Mo épuisait la mémoire du serveur — multiplié par le
 * plafond de concurrence (2), des centaines de Mo pour un extrait de 4 000
 * caractères.
 * ponytail: 1 Mo de HTML suffit largement à une page de manuel (l'extrait
 * final est tronqué à 4 000 caractères).
 */
export const MAX_HTML_CHARS = 1_000_000;
/** Délai de lecture du HTML : `page.content()` n'en a pas (#422). */
export const CONTENT_TIMEOUT_MS = 10_000;

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
/**
 * Nombre de sauts que la garde suit À LA MAIN.
 *
 * DOIT couvrir le plafond de Chromium (20 redirections, `ERR_TOO_MANY_REDIRECTS`) :
 * le navigateur suit les redirections SANS repasser par le route handler, donc
 * un saut de plus que la garde = une cible PRIVÉE atteinte à l'aveugle. Avec un
 * plafond plus petit que celui du navigateur, la garde s'arrêtait trop tôt et
 * la cible privée du dernier saut partait quand même (#487).
 */
const MAX_REDIRECT_HOPS = 20;

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
 * #487 : la garde suit autant de sauts que le navigateur peut en suivre
 * (20) et REFUSE au-delà (fail-closed) ; un délai de vérification est un
 * refus, jamais une navigation à l'aveugle. En dessous du plafond du
 * navigateur, le dernier saut partait vers une cible privée sans être
 * vérifié.
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
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    await assertPublicUrl(current, "redirection", resolve);
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", signal });
    } catch {
      // Délai de la garde : la chaîne est INCONNUE, donc on ne navigue pas à
      // l'aveugle (fail-closed, #487). Une simple erreur réseau (hôte
      // injoignable) laisse le navigateur trancher : il n'atteindra rien
      // non plus.
      if (signal.aborted) {
        throw new ScrapeManualsError("verification des redirections interrompue", "timeout");
      }
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
    if (hop === MAX_REDIRECT_HOPS) {
      // Le navigateur dépasserait son propre plafond : la cible suivante n'est
      // pas vérifiée. On REFUSE (fail-closed) au lieu de laisser partir une
      // cible non contrôlée.
      throw new ScrapeManualsError("trop de redirections (chaine non verifiee)", "private_host");
    }
  }
}

// Extraction texte : script/style retirés, entités HTML DÉCODÉES (« &eacute; »,
// « &nbsp; » laissés tels quels = extrait illisible et introuvable à la
// recherche). Cheerio déjà dépendance, zéro ajoutée.
// Espace ajouté après chaque élément : sinon deux paragraphes se collent.
// L'entrée est DÉJÀ bornée (readHtml) : le parse est linéaire, donc c'est
// l'appelant qui borne, pas cette fonction.
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

/** Page Playwright : seule la lecture du HTML nous intéresse ici. */
interface HtmlPage {
  content: () => Promise<string>;
}

/**
 * Lecture du HTML BORNÉE (#422) : `page.content()` lit TOUTE la page en
 * mémoire et n'a aucun délai.
 *  - délai propre : la course tranche et le refus porte le motif `timeout`
 *    (=> 504 côté HTTP) ; sans lui, une page qui ne finit pas de streamer
 *    survit au délai HTTP et garde le Chromium vivant ;
 *  - plafond de caractères AVANT le reparse cheerio : le coût du parse est
 *    linéaire, donc on borne la chaîne qu'il va reparcourir.
 * La course peut être perdue (délai) : la rejection tardive de la lecture ne
 * doit pas devenir une rejection non geree.
 */
async function readHtml(page: HtmlPage, timeoutMs: number, log: (message: string) => void): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const contentP: Promise<string> = (async () => {
    try {
      return await page.content();
    } catch {
      // Navigateur (ou page) mort pendant la lecture : un échec de scrape,
      // pas une panne du serveur (502 « scrape impossible », jamais 500).
      // Message FIXE : le message de Playwright peut contenir l'URL, et les
      // logs du serveur ne doivent rien laisser filtrer (cf. I8).
      throw new ScrapeManualsError("lecture du HTML impossible");
    }
  })();
  contentP.catch(() => {});
  try {
    const html = await Promise.race([
      contentP,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new ScrapeManualsError("lecture du HTML trop longue (delai depasse)", "timeout")),
          timeoutMs,
        );
      }),
    ]);
    if (typeof html !== "string") return "";
    if (html.length <= MAX_HTML_CHARS) return html;
    // Plafond atteint : on tronque (le reste de la page est perdu, mais le
    // serveur ne réexplore pas 50 Mo de HTML pour un extrait de 4 000
    // caractères). Compteur seul dans le log : ni URL, ni credential.
    log(`scrape -> html plafonne (${MAX_HTML_CHARS} caracteres maximum)`);
    return html.slice(0, MAX_HTML_CHARS);
  } finally {
    if (timer) clearTimeout(timer);
  }
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
  // Le jar est celui du SERVEUR, et lui seul (#538) : il n'y a plus de nom
  // de jar à résoudre, donc plus rien à refuser ici — le navigateur ne
  // monte jamais la session d'un autre tenant.
  const jar = opts.defaultAuthFile ?? DEFAULT_AUTH_FILE;
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
      (await browser.newContext({ ...(jar ? { storageState: jar } : {}) }).catch(
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
    // #422 : HTML borné (plafond de caractères) et lecture à DÉLAI : sans
    // ça, `page.content()` lisait toute la page en mémoire (reparse cheerio
    // = plusieurs fois sa taille) et une page qui ne finit pas de streamer
    // bloquait le scrape au-delà du délai HTTP.
    const html = await readHtml(page, opts.contentTimeoutMs ?? CONTENT_TIMEOUT_MS, log);
    const text = truncateManualText(stripTags(html), 4000);
    await context.storageState({ path: jar }).catch(() => {
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
