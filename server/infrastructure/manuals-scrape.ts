// Scrape manuels via Playwright (#25, #634) : page -> ManualDoc.
// Aucun credential : startUrl vient de l'appelant, jamais d'env ni du dépôt.
// Playwright en import dynamique : e2e skippé sans navigateur.
// Contenu brut = Untrusted avant l'IA.
//
// Garde SSRF (I8, #362/#419/#487) : hôte normalisé WHATWG, résolu avant la
// navigation, chaîne de redirections suivie à la main (autant que Chromium),
// URL finale re-vérifiée, sous-ressources privées coupées. Reste la fenêtre
// TOCTOU de la résolution côté navigateur (cf. ssrf.ts).
// Jar de session : celui du SERVEUR uniquement (#538/I24) ; un corps qui
// demande `authFile` est refusé.
// Le scraper ne s'authentifie pas : `username`/`password` sont refusés (#526),
// et une page de connexion (HTTP 200) n'est jamais ingérée.
// HTML borné en caractères AVANT reparse et en octets avant lecture, avec
// délai (#422/#525) : jamais `page.content()` entier.
import { join } from "node:path";
import { load } from "cheerio";
import { truncateManualText } from "./manuals";
import type { ManualDoc } from "./manuals";
import { checkPublicHost, systemResolver } from "./ssrf";
import type { HostResolver } from "./ssrf";

export interface ManualsConfig {
  readonly platform: string;
}

/** Motif de refus typé : le serveur l'expose à l'appelant (jamais l'URL). */
export type ScrapeRefusal =
  | "private_host"
  | "unresolved_host"
  | "timeout"
  | "login_required"
  | "too_large"
  | "not_text"
  | "generic";

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
  /**
   * Monter le jar de session du serveur ? Défaut = oui (manuel). La page web
   * (#634) passe `false` : aucune authentification, aucun cookie.
   */
  readonly useSession?: boolean;
  /**
   * Refuser un contenu non textuel (page web) ? Défaut = non (manuel). Le
   * `content-type` est lu sur la réponse de navigation ; absent = inconnu,
   * donc on laisse la lecture bornée trancher.
   */
  readonly textOnly?: boolean;
}

/** Page lue par le moteur commun : titre + texte déjà borné. */
export interface ScrapedPage {
  readonly title: string;
  readonly text: string;
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
/**
 * Plafond du HTML en OCTETS, mesuré par l'en-tête `content-length` (#525).
 *
 * 4× le plafond de caractères : le pire cas UTF-8 (4 octets par caractère).
 * Au-delà, la page est REFUSÉE SANS ÊTRE LUE — elle serait de toute façon
 * tronquée au plafond de caractères, et la sérialiser coûterait des centaines
 * de Mo de mémoire (le plafond ne protégeait que le REPARSE, pas
 * l'allocation).
 */
export const MAX_HTML_BYTES = 4 * MAX_HTML_CHARS;
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
async function assertPublicUrl(
  raw: string,
  label: string,
  resolve: HostResolver,
  rejectCredentials = false,
): Promise<void> {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    throw new ScrapeManualsError(`${label} http(s) requise (jamais journalisee)`);
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ScrapeManualsError(`${label} http(s) requise (jamais journalisee)`);
  }
  // Une page web n'a aucune raison de porter des identifiants : le scraper ne
  // s'authentifie pas. Le userinfo ne doit pas servir de leurre (même refus
  // que `ManualUrl.kt`).
  if (rejectCredentials && (u.username !== "" || u.password !== "")) {
    throw new ScrapeManualsError(`${label} avec identifiants refusee (jamais journalisee)`);
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
  rejectCredentials = false,
): Promise<void> {
  const signal = AbortSignal.timeout(timeoutMs);
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    await assertPublicUrl(current, "redirection", resolve, rejectCredentials);
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
    await assertPublicUrl(target, "redirection", resolve, rejectCredentials);
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

/**
 * La page est-elle un FORMULAIRE DE CONNEXION ? (#526)
 *
 * Un portail qui ne reconnaît pas la session renvoie sa page de login en
 * HTTP 200 : `ok = status < 400` passait, la page devenait un ManualDoc et
 * l'assistant pouvait la citer comme source (« Se connecter »). Le signal
 * retenu : un champ MOT DE PASSE — le formulaire d'authentification en a
 * toujours un, une page de manuel jamais.
 *
 * ponytail: un seul signal (le champ mot de passe), pour rester testable
 * sans connaître le HTML d'un vrai portail. Un portail qui masque son
 * formulaire (JavaScript) n'est pas détecté : c'est un défaut ACCEPTÉ, pas
 * un trou silencieux (le refus reste visible : 502 « login_required »).
 */
export function isLoginPage(html: string): boolean {
  const $ = load(html);
  let login = false;
  $("input").each((_i, el) => {
    const type = ($(el).attr("type") ?? "").toLowerCase();
    const name = ($(el).attr("name") ?? "").toLowerCase();
    if (type === "password" || name === "password") login = true;
  });
  return login;
}

/**
 * Taille de la réponse, en OCTETS (en-tête `content-length`), 0 si inconnue.
 *
 * C'est la MESURE AVANT la matérialisation (#525) : la pile réseau la donne
 * sans construire la page. Une réponse en morceaux (pas d'en-tête) donne 0 :
 * c'est alors la lecture BORNÉE qui s'applique.
 */
function responseHeadersOf(response: unknown): Record<string, string> {
  const res = response as { headers?: () => Record<string, string> } | null;
  if (!res || typeof res.headers !== "function") return {};
  try {
    return res.headers() ?? {};
  } catch {
    return {};
  }
}

function contentLengthOf(response: unknown): number {
  const headers = responseHeadersOf(response);
  const raw = headers["content-length"] ?? headers["Content-Length"];
  const size = Number(raw);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/** Types textuels acceptés pour une page web ; absent = inconnu (on lit). */
function isTextContentType(value: string): boolean {
  const type = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type === "") return true;
  if (type.startsWith("text/")) return true;
  return type === "application/xhtml+xml" || type === "application/xml";
}

/** `content-type` de la réponse de navigation (vide si absent). */
function contentTypeOf(response: unknown): string {
  const headers = responseHeadersOf(response);
  return headers["content-type"] ?? headers["Content-Type"] ?? "";
}

/**
 * Page Playwright : seule la lecture du HTML nous intéresse ici.
 *
 * La lecture passe par `evaluate` : la borne est appliquée DANS le
 * navigateur, donc la chaîne qui traverse le pont ne dépasse jamais le
 * plafond (+1 caractère témoin : « la page est plus grande que ça »). Avant,
 * `content()` lisait TOUTE la page en mémoire — le plafond ne protégeait que
 * le REPARSE, pas l'ALLOCATION (#525).
 */
interface HtmlPage {
  evaluate: (fn: (max: number) => string, max: number) => Promise<string>;
}

/**
 * Sérialisation BORNÉE de la page, exécutée DANS le navigateur (#525).
 *
 * Le DOM tient déjà en mémoire (Chromium l'a construit) ; c'est la
 * SÉRIALISATION qui coûtait des centaines de Mo, et la chaîne qui traverse
 * le pont. Ici, seul le plafond (+1 caractère témoin) sort du navigateur.
 */
const BOUNDED_HTML = (max: number): string => {
  const full = document.documentElement.outerHTML;
  return full.length > max ? full.slice(0, max + 1) : full;
};

/**
 * Lecture du HTML BORNÉE (#422, #525) : la lecture a un DÉLAI et la chaîne
 * reçue est bornée.
 *  - délai propre : la course tranche et le refus porte le motif `timeout`
 *    (=> 504 côté HTTP) ; sans lui, une page qui ne finit pas de streamer
 *    survit au délai HTTP et garde le Chromium vivant ;
 *  - plafond de caractères AVANT le reparse cheerio : le coût du parse est
 *    linéaire, donc on borne la chaîne qu'il va reparcourir ;
 *  - la borne est demandée AU NAVIGATEUR (`evaluate`) : le processus ne
 *    matérialise jamais une page de plusieurs centaines de Mo (#525).
 * La course peut être perdue (délai) : la rejection tardive de la lecture ne
 * doit pas devenir une rejection non geree.
 */
async function readHtml(page: HtmlPage, timeoutMs: number, log: (message: string) => void): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const contentP: Promise<string> = (async () => {
    try {
      // #525 : la borne est demandée AU NAVIGATEUR : la chaîne qui traverse
      // le pont ne dépasse jamais le plafond (+1 caractère témoin).
      return await page.evaluate(BOUNDED_HTML, MAX_HTML_CHARS);
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

/** Réglages du moteur commun : libellé + session + refus de contenu non textuel. */
export interface ScrapePageConfig {
  /** Nom symbolique (jamais une URL) : plateforme ou « web ». */
  readonly label: string;
  /** Monter le jar du SERVEUR ? Manuel = oui ; page web = non. */
  readonly useSession: boolean;
  /** Refuser un `content-type` non textuel ? Page web = oui. */
  readonly textOnly: boolean;
  /**
   * Refuser les identifiants userinfo dans l'URL ? Page web = oui. Les deux
   * formes sont acceptées : `credentials: "none"` (appel web) ou le drapeau
   * explicite (appel manuel).
   */
  readonly rejectCredentials?: boolean;
  /** `"none"` = aucune authentification : identifiants userinfo REFUSÉS. */
  readonly credentials?: "none";
}

/**
 * Moteur commun page -> titre + texte borné (#209, #634).
 *
 * Le manuel et la page web partagent TOUT le chemin risqué : garde SSRF
 * littérale + résolution DNS + chaîne de redirections, statut HTTP, taille
 * mesurée avant lecture, HTML borné dans le navigateur, page de login. Seuls
 * changent le libellé, le jar de session et le refus du contenu non textuel.
 * Lève `ScrapeManualsError` (motif typé) ; ne logue jamais l'URL.
 */
export async function scrapePage(
  config: ScrapePageConfig,
  opts: ScrapeOptions,
): Promise<ScrapedPage | null> {
  // Annulation AVANT toute résolution DNS : un client parti ne doit pas
  // déclencher de requête réseau.
  if (opts.signal?.aborted) throw new ScrapeManualsError("scrape annulé");
  const resolve = opts.resolveHost ?? systemResolver;
  const rejectCredentials = config.rejectCredentials ?? config.credentials === "none";
  // Le nom de l'hôte est RÉSOLU (#419) : un nom public qui pointe vers une
  // IP interne est refusé ici, AVANT la navigation.
  await assertPublicUrl(opts.startUrl, "startUrl", resolve, rejectCredentials);
  // La chaîne de redirections est vérifiée AVANT le navigateur : Chromium
  // suit un 302 sans repasser par le route handler, la cible interne serait
  // donc atteinte (requête à l'aveugle) si on attendait la navigation.
  await assertPublicRedirectChain(
    opts.startUrl,
    Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, REDIRECT_CHECK_TIMEOUT_MS),
    resolve,
    rejectCredentials,
  );
  // Le jar est celui du SERVEUR, et lui seul (#538) : il n'y a plus de nom
  // de jar à résoudre, donc plus rien à refuser ici — le navigateur ne
  // monte jamais la session d'un autre tenant. La page web n'en monte AUCUN.
  const jar = config.useSession ? opts.defaultAuthFile ?? DEFAULT_AUTH_FILE : null;
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
      (jar
        ? await browser.newContext({ storageState: jar }).catch(
            // Premier run : pas de fichier local, contexte frais pour login interactif.
            async () => browser.newContext(),
          )
        : await browser.newContext()) ?? null;
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
    log(`scrape ${config.label} -> 1 page`);
    // Statut HTTP vérifié AVANT toute extraction : une page d'erreur (404/500)
    // ou un mur de connexion ne doit jamais devenir une source (le corpus
    // citerait sinon « Page introuvable » comme source de corrigé).
    const response = await page.goto(opts.startUrl, { timeout: timeoutMs }).catch(() => null);
    if (blockedTarget) {
      throw new ScrapeManualsError("cible privee/interne refusee (redirection)", "private_host");
    }
    const status = typeof response?.status === "function" ? response.status() : 0;
    const ok = typeof response?.ok === "function" ? response.ok() : status < 400;
    if (!response || !ok || status >= 400) {
      throw new ScrapeManualsError(
        `réponse HTTP ${status || "inconnue"} sur ${config.label} — page non ingérée`,
      );
    }
    // URL FINALE (redirections suivies) : re-vérifiée AVANT toute extraction.
    // Sans cette re-vérification, une redirection vers une cible interne
    // ferait entrer le corps du service interne dans l'extrait.
    await assertPublicUrl(
      typeof page.url === "function" ? page.url() : opts.startUrl,
      "cible finale",
      resolve,
      rejectCredentials,
    );
    // #634 : une page web NON TEXTUELLE (PDF, image, binaire) est refusée
    // avant extraction. Le `content-type` absent reste inconnu : la lecture
    // bornée tranche (une réponse en morceaux n'a pas toujours l'en-tête).
    const contentType = contentTypeOf(response);
    if (config.textOnly && !isTextContentType(contentType)) {
      throw new ScrapeManualsError("contenu non textuel refuse", "not_text");
    }
    const title = truncateManualText(
      ((await page.title().catch(() => config.label)) || config.label).trim(),
      200,
    );
    // #525 : la TAILLE est mesurée AVANT la lecture (en-tête `content-length`) :
    // une page de plusieurs centaines de Mo est REFUSÉE sans être sérialisée
    // ni transférée — elle serait de toute façon tronquée au plafond de
    // caractères, et la sérialiser coûtait des centaines de Mo de mémoire.
    // Sans en-tête (réponse en morceaux), c'est la lecture BORNÉE qui s'applique.
    const contentLength = contentLengthOf(response);
    if (contentLength > MAX_HTML_BYTES) {
      throw new ScrapeManualsError(
        `page trop volumineuse (${contentLength} octets, maximum ${MAX_HTML_BYTES}) — scrape refuse`,
        config.textOnly ? "too_large" : "generic",
      );
    }
    // #422 : HTML borné (plafond de caractères) et lecture à DÉLAI : sans
    // ça, `page.content()` lisait toute la page en mémoire (reparse cheerio
    // = plusieurs fois sa taille) et une page qui ne finit pas de streamer
    // bloquait le scrape au-delà du délai HTTP.
    // #525 : la borne est appliquée DANS le navigateur (`evaluate`) : la
    // chaîne qui traverse le pont est bornée, donc le processus ne
    // matérialise jamais une page de plusieurs centaines de Mo.
    const html = await readHtml(page, opts.contentTimeoutMs ?? CONTENT_TIMEOUT_MS, log);
    // #526 : une PAGE DE CONNEXION (HTTP 200) n'est JAMAIS une source. Avant,
    // le mur de connexion passait le test HTTP (`ok = status < 400`) et
    // devenait un ManualDoc — l'assistant le citait comme source. Le refus
    // arrive AVANT l'extraction ET avant l'écriture du jar : une page de
    // login ne doit pas non plus écraser la session du serveur.
    if (isLoginPage(html)) {
      throw new ScrapeManualsError(
        "page de connexion detectee (session du scraper a renouveler)",
        "login_required",
      );
    }
    const text = truncateManualText(stripTags(html), 4000);
    if (jar) {
      await context.storageState({ path: jar }).catch(() => {
        log(`scrape ${config.label} -> jar non persiste`);
      });
    }
    await context.close().catch(() => {
      log(`scrape ${config.label} -> contexte non ferme`);
    });
    context = null;
    if (!text) return null;
    return { title, text };
  } finally {
    signal?.removeEventListener("abort", abortBrowser);
    if (context !== null) {
      await context.close().catch(() => {});
    }
    await browser.close().catch(() => {});
  }
}

// Scrape manuel v1 : une page -> un ManualDoc (titre + texte).
// Lève ScrapeManualsError si config incomplète, URL invalide ou navigateur absent.
// Ne logue jamais l'URL ni aucun credential : seulement plateforme + compteurs.
export async function scrapeManuals(config: ManualsConfig | null, opts: ScrapeOptions): Promise<ManualDoc[]> {
  if (!config) throw new ScrapeManualsError("manuels non configurés (plateforme absente)");
  const page = await scrapePage(
    {
      label: config.platform,
      useSession: opts.useSession ?? true,
      textOnly: opts.textOnly ?? false,
      rejectCredentials: false,
    },
    opts,
  );
  if (!page) return [];
  return [
    {
      id: `scrape-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      platform: config.platform,
      title: page.title,
      subject: page.title,
      page: 1,
      excerpt: page.text,
    },
  ];
}
