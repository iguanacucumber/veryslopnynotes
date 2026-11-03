// Scrape manuels via Playwright : page -> ManualDoc.
// Aucun credential : startUrl vient de l'appelant, jamais d'env ni du dépôt.
// Playwright en import dynamique : e2e skippé sans navigateur.
// Contenu brut = Untrusted avant l'IA.
//
// Garde SSRF (I8) : hôte normalisé WHATWG, résolu avant la navigation, chaîne
// de redirections suivie à la main (autant que Chromium), URL finale
// re-vérifiée, TOUTES les pages du contexte routées (popups comprises et
// fermées), schéma non http(s) coupé, sous-ressources privées coupées,
// WebSocket gardés et service workers bloqués. Les hôtes du document et de la
// chaîne de redirections sont ÉPINGLÉS dans Chromium (adresse validée) ; les
// sous-ressources gardent la fenêtre TOCTOU, fermée au niveau réseau par la
// politique d'égression (docs/architecture/SERVER-EGRESS.md).
// Jar de session : celui du SERVEUR uniquement (I24) ; un corps qui demande
// `authFile` est refusé. Répertoire 0700, jar 0600, une seule sauvegarde.
// Le scraper ne s'authentifie pas : `username`/`password` sont refusés, et une
// page de connexion (HTTP 200) n'est jamais ingérée.
// HTML sérialisé de façon BORNÉE dans le navigateur, borné en caractères avant
// reparse et refusé sur un `content-length` trop grand, avec délai : jamais
// `outerHTML` ni `page.content()` en entier.
import { join } from "node:path";
import { load } from "cheerio";
import { saveJar } from "./jar-store";
import { truncateManualText } from "./manuals";
import type { ManualDoc } from "./manuals";
import { checkPublicHost, resolvePublicHost, systemResolver } from "./ssrf";
import type { HostResolver } from "./ssrf";

/**
 * Playwright désactive le sandbox de Chromium par défaut. Le scraper visite
 * des pages publiques non fiables : le renderer doit rester sandboxé. Sans
 * user namespaces (hôte ou profil seccomp), le lancement échoue — aucun repli
 * silencieux vers un navigateur non sandboxé.
 */
export const CHROMIUM_LAUNCH_OPTIONS = {
  headless: true,
  chromiumSandbox: true,
} as const;

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
   * d'un appelant, qui pourrait sinon naviguer avec la session d'un autre
   * tenant. Absent = jar serveur par défaut.
   */
  readonly defaultAuthFile?: string;
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
   * Page imprimée demandée (ouvrage = sommaire). Le serveur résout la page
   * dans le sommaire avant la navigation ; absente = page de départ.
   */
  readonly page?: number;
  /**
   * Monter le jar de session du serveur ? Défaut = oui (manuel). La page web
   * passe `false` : aucune authentification, aucun cookie.
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
 * Plafond du HTML RÉCUPÉRÉ (caractères), appliqué AVANT le reparse cheerio :
 * le parse coûte plusieurs fois la taille du HTML, et 2 scrapes concurrents
 * peuvent épuiser la mémoire.
 * ponytail: 1 Mo suffit à une page de manuel (l'extrait final fait 4 000
 * caractères).
 */
export const MAX_HTML_CHARS = 1_000_000;
/**
 * Plafond du HTML en OCTETS annoncé par `content-length`.
 *
 * 4× le plafond de caractères (pire cas UTF-8). Au-delà, la page est REFUSÉE
 * sans être lue : un refus tôt et pas cher. L'en-tête mesure le corps
 * COMPRESSÉ et peut mentir ou manquer (chunked) : la vraie borne reste la
 * sérialisation bornée dans le navigateur (`BOUNDED_HTML`).
 */
export const MAX_HTML_BYTES = 4 * MAX_HTML_CHARS;
/** Délai de lecture du HTML : `page.content()` n'en a pas. */
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

/** Seul http(s) sort : `file:`, `ftp:`, `data:` et `blob:` sont coupés. */
function isHttpUrl(raw: string): boolean {
  try {
    const protocol = new URL(raw).protocol;
    return protocol === "http:" || protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * Hôte public APRÈS résolution DNS. Un nom qui résout vers une IP
 * privée/interne est refusé (motif explicite : `private_host`), un nom
 * introuvable aussi. Le message ne contient ni l'URL ni l'adresse obtenue :
 * les logs du serveur ne doivent rien laisser filtrer (cf. I8).
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
 * RÉSOLU — un nom public qui pointe vers une IP interne est refusé.
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
 * DOIT couvrir le plafond de Chromium (20 redirections) : le navigateur suit
 * les redirections SANS repasser par le route handler, donc un saut de plus
 * que la garde = une cible PRIVÉE atteinte à l'aveugle.
 */
const MAX_REDIRECT_HOPS = 20;

/**
 * Arguments Chromium du proxy d'égression imposé par l'exploitant.
 *
 * `SCRAPER_EGRESS_PROXY` n'est PAS un paramètre d'appelant : il vient de
 * l'environnement du service. Un proxy absent laisse la garde réseau faire foi
 * (`SERVER-EGRESS.md`) ; un proxy illisible REFUSE le scrape plutôt que de
 * partir en direct. `<-loopback>` retire le contournement implicite de la
 * boucle locale : même `127.0.0.1` passe par le proxy contrôlé.
 */
export function chromiumEgressArgs(proxy: string | undefined): readonly string[] {
  const value = proxy?.trim();
  if (!value) return [];
  let protocol: string;
  try {
    protocol = new URL(value).protocol;
  } catch {
    throw new ScrapeManualsError("proxy d'egression illisible", "generic");
  }
  if (protocol !== "http:" && protocol !== "https:") {
    throw new ScrapeManualsError("proxy d'egression http(s) requis", "generic");
  }
  return [`--proxy-server=${value}`, "--proxy-bypass-list=<-loopback>"];
}

/**
 * Règles `--host-resolver-rules` épinglant chaque hôte vérifié à une adresse
 * DÉJÀ validée.
 *
 * Chromium résout de son côté au moment de la connexion : sans épinglage, un
 * enregistrement DNS qui change entre la garde et la navigation ferait partir
 * la requête vers une IP interne (rebinding). Une seule adresse est retenue
 * (la première publique) ; une résolution qui échoue ou devient privée REFUSE
 * le scrape (fail-closed). Les littéraux publics n'ont rien à épingler.
 *
 * Les sous-ressources restent hors de ces règles (hôte inconnu au lancement) :
 * voir `SERVER-EGRESS.md` pour la fermeture réseau.
 */
export async function chromiumResolverRules(
  hosts: readonly string[],
  resolve: HostResolver = systemResolver,
): Promise<readonly string[]> {
  const rules: string[] = [];
  for (const host of new Set(hosts)) {
    const resolution = await resolvePublicHost(host, resolve);
    if (resolution.verdict === "private") {
      throw new ScrapeManualsError("epinglage : hote prive refuse", "private_host");
    }
    if (resolution.verdict === "unresolved") {
      throw new ScrapeManualsError("epinglage : hote introuvable (resolution DNS)", "unresolved_host");
    }
    const address = resolution.addresses[0];
    if (!address) continue; // littéral public : connexion directe
    rules.push(`MAP ${host} ${address.includes(":") ? `[${address}]` : address}`);
  }
  return rules;
}

/**
 * Vérifie la chaîne de redirections AVANT de lancer le navigateur.
 *
 * Chromium suit les redirections SANS repasser par le route handler de
 * Playwright (mesuré sur Playwright 1.64) : sans cette vérification, une URL
 * publique en 302 vers http://169.254.169.254/… atteint le service interne.
 * On suit donc la chaîne à la main et on refuse dès qu'un maillon est privé ;
 * chaque maillon est aussi RÉSOLU (nom -> adresses) avant le `fetch`.
 *
 * Rend les hôtes rencontrés (dédoublonnés) : ils sont épinglés dans Chromium
 * avant le lancement, sinon le navigateur re-résoudrait ces noms.
 *
 * Au-delà de MAX_REDIRECT_HOPS, REFUS (fail-closed) : un délai de vérification
 * est un refus, jamais une navigation à l'aveugle.
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
): Promise<readonly string[]> {
  const signal = AbortSignal.timeout(timeoutMs);
  const hosts = new Set<string>();
  const remember = (raw: string): void => {
    try {
      hosts.add(new URL(raw).hostname);
    } catch {
      /* URL illisible : assertPublicUrl refusera */
    }
  };
  let current = startUrl;
  for (let hop = 0; hop <= MAX_REDIRECT_HOPS; hop += 1) {
    remember(current);
    await assertPublicUrl(current, "redirection", resolve, rejectCredentials);
    let res: Response;
    try {
      res = await fetch(current, { redirect: "manual", signal });
    } catch {
      // Délai de la garde : la chaîne est INCONNUE, donc on ne navigue pas à
      // l'aveugle (fail-closed).
      if (signal.aborted) {
        throw new ScrapeManualsError("verification des redirections interrompue", "timeout");
      }
      // Réseau/DNS indisponible : la chaîne n'est pas vérifiable. Laisser le
      // navigateur partir serait atteindre une cible non contrôlée (fail-closed).
      throw new ScrapeManualsError("redirections non verifiables (reseau indisponible)", "generic");
    }
    if (res.status < 300 || res.status >= 400) return [...hosts]; // pas de redirection
    const location = res.headers.get("location");
    if (!location) return [...hosts];
    let target: string;
    try {
      target = new URL(location, current).toString();
    } catch {
      return [...hosts];
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
  return [...hosts];
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
  // Un lecteur de manuel met le sommaire ET la page dans le DOM : le texte
  // complet commençait par la navigation et la page réelle était coupée par
  // le budget de source. Le contenu du document passe en premier ; les sites
  // sans ce conteneur gardent le texte complet d'avant.
  const document = $(".lls-new-viewer-document-root").first();
  const text = document.length > 0 ? document.text() : $.root().text();
  return text.replace(/\s+/g, " ").trim();
}

/**
 * La page est-elle un FORMULAIRE DE CONNEXION ?
 *
 * Un portail qui ne reconnaît pas la session renvoie sa page de login en
 * HTTP 200 : elle deviendrait un ManualDoc citable. Le signal retenu : un
 * champ MOT DE PASSE — le formulaire d'authentification en a toujours un, une
 * page de manuel jamais.
 *
 * ponytail: un seul signal, testable sans connaître le HTML d'un vrai portail.
 * Un formulaire masqué en JavaScript n'est pas détecté : défaut ACCEPTÉ, pas
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
 * Taille ANNONCÉE de la réponse, en OCTETS (`content-length`), 0 si inconnue.
 *
 * Pré-contrôle bon marché, pas la borne : l'en-tête décrit le corps COMPRESSÉ
 * et manque en chunked. La sérialisation bornée dans le navigateur reste
 * l'autorité.
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
 * La lecture passe par `evaluate` : la borne est appliquée DANS le navigateur,
 * donc la chaîne qui traverse le pont ne dépasse jamais le plafond (+1
 * caractère témoin). `content()` lisait TOUTE la page en mémoire — le plafond
 * ne protégeait que le REPARSE, pas l'ALLOCATION.
 */
interface HtmlPage {
  evaluate: (fn: (max: number) => string, max: number) => Promise<string>;
}

/**
 * Sérialisation BORNÉE de la page, exécutée DANS le navigateur.
 *
 * Le DOM tient déjà en mémoire ; c'est la SÉRIALISATION qui coûte des
 * centaines de Mo (une seule chaîne) et la chaîne qui traverse le pont. On
 * parcourt donc les nœuds et on s'arrête dès `max` caractères produits
 * (+1 témoin de troncature) : ni `outerHTML` ni `innerHTML` ne sont lus,
 * même pour un seul attribut géant (la valeur est tranchée AVANT échappement).
 *
 * Fonction AUTONOME : Playwright la sérialise dans la page, elle ne peut
 * référencer aucune liaison du module. Testée hors navigateur avec un faux
 * `document` (tests/unit/scraper-limits.test.ts).
 */
export const BOUNDED_HTML = (max: number): string => {
  const ELEMENT_NODE = 1;
  const TEXT_NODE = 3;
  const CDATA_NODE = 4;
  const COMMENT_NODE = 8;
  type NodeLike = {
    nodeType?: number;
    nodeName?: string;
    nodeValue?: string | null;
    childNodes?: ArrayLike<NodeLike | null>;
    attributes?: ArrayLike<{ name?: string; value?: string } | null>;
  };
  const doc = (globalThis as unknown as { document?: { documentElement?: NodeLike | null } }).document;
  const root = doc && doc.documentElement;
  if (!root) return "";
  let out = "";
  let full = false;
  let visited = 0;
  const escape = (value: string, attribute: boolean): string =>
    value.replace(
      attribute ? /[&<>"]/g : /[&<>]/g,
      (c) => (c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : "&quot;"),
    );
  const append = (chunk: string): void => {
    if (full || chunk.length === 0) return;
    const room = max + 1 - out.length;
    if (room <= 0) {
      full = true;
      return;
    }
    out += chunk.length > room ? chunk.slice(0, room) : chunk;
    if (out.length > max) full = true;
  };
  /** Tranche AVANT d'échapper : une valeur de 100 Mo n'est jamais recopiée. */
  const appendValue = (value: string, attribute: boolean): void => {
    if (full) return;
    const room = max + 1 - out.length;
    if (room <= 0) {
      full = true;
      return;
    }
    const kept = value.length > room ? value.slice(0, room) : value;
    append(escape(kept, attribute));
    if (kept.length < value.length) full = true;
  };
  // Pile de FRAMES, pas de récursion : l'imbrication peut être profonde. La
  // pile suit la profondeur du DOM, pas sa largeur (un nœud à 10 000 enfants
  // n'empile pas 10 000 frames).
  type Frame = { node: NodeLike | null; close: string | null; index: number };
  const stack: Frame[] = [{ node: root, close: null, index: 0 }];
  while (stack.length > 0 && !full) {
    const frame = stack[stack.length - 1]!;
    if (frame.close !== null) {
      const children = frame.node && frame.node.childNodes;
      if (children && frame.index < children.length) {
        const child = children[frame.index];
        frame.index += 1;
        if (child) stack.push({ node: child, close: null, index: 0 });
        continue;
      }
      append(frame.close);
      stack.pop();
      continue;
    }
    visited += 1;
    // Garde des millions de nœuds VIDES (texte vide, commentaire vide) : ils
    // ne produisent aucun caractère et ne doivent pas faire tourner la boucle.
    if (visited > max + 1) {
      full = true;
      break;
    }
    const node = frame.node;
    if (!node) {
      stack.pop();
      continue;
    }
    const type = node.nodeType;
    if (type === TEXT_NODE || type === CDATA_NODE) {
      appendValue(String(node.nodeValue ?? ""), false);
      stack.pop();
      continue;
    }
    if (type === COMMENT_NODE) {
      append("<!--");
      appendValue(String(node.nodeValue ?? ""), false);
      append("-->");
      stack.pop();
      continue;
    }
    if (type !== ELEMENT_NODE) {
      stack.pop();
      continue;
    }
    const name = String(node.nodeName ?? "").toLowerCase();
    append("<" + name);
    const attributes = node.attributes;
    for (let i = 0; attributes && i < attributes.length && !full; i += 1) {
      const attribute = attributes[i];
      if (!attribute) continue;
      // Nom et valeur passent par la borne : un attribut géant ne doit pas
      // être recopié avant la coupe.
      append(" ");
      appendValue(String(attribute.name ?? ""), true);
      append('="');
      appendValue(String(attribute.value ?? ""), true);
      append('"');
    }
    append(">");
    frame.close = "</" + name + ">";
    frame.index = 0;
  }
  return out;
};

/**
 * Lecture du HTML BORNÉE : la lecture a un DÉLAI et la chaîne reçue est bornée.
 *  - délai propre : la course tranche et le refus porte le motif `timeout`
 *    (=> 504 côté HTTP) ; sans lui, une page qui ne finit pas de streamer
 *    survit au délai HTTP et garde le Chromium vivant ;
 *  - plafond de caractères AVANT le reparse cheerio : le coût du parse est
 *    linéaire, donc on borne la chaîne qu'il va reparcourir ;
 *  - la borne est appliquée DANS le navigateur (`BOUNDED_HTML`) : le processus
 *    ne matérialise jamais une page de plusieurs centaines de Mo.
 * La course peut être perdue (délai) : la rejection tardive ne doit pas
 * devenir une rejection non gérée.
 */
async function readHtml(page: HtmlPage, timeoutMs: number, log: (message: string) => void): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const contentP: Promise<string> = (async () => {
    try {
      // La borne est appliquée AU NAVIGATEUR : la chaîne qui traverse le pont
      // ne dépasse jamais le plafond (+1 caractère témoin).
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
   * Refuser les identifiants userinfo dans l'URL ? Page web = oui. Accepté via
   * `credentials: "none"` (appel web) ou le drapeau explicite (appel manuel).
   */
  readonly rejectCredentials?: boolean;
  /** `"none"` = aucune authentification : identifiants userinfo REFUSÉS. */
  readonly credentials?: "none";
}

/**
 * Moteur commun page -> titre + texte borné.
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
  // Le nom de l'hôte est RÉSOLU : un nom public qui pointe vers une IP
  // interne est refusé ici, AVANT la navigation.
  await assertPublicUrl(opts.startUrl, "startUrl", resolve, rejectCredentials);
  // La chaîne de redirections est vérifiée AVANT le navigateur : Chromium
  // suit un 302 sans repasser par le route handler, la cible interne serait
  // donc atteinte (requête à l'aveugle) si on attendait la navigation.
  const chainHosts = await assertPublicRedirectChain(
    opts.startUrl,
    Math.min(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS, REDIRECT_CHECK_TIMEOUT_MS),
    resolve,
    rejectCredentials,
  );
  // Chaque hôte validé est ÉPINGLÉ à son adresse dans Chromium : le navigateur
  // ne peut plus rebinder le document ni un saut de redirection.
  const resolverRules = await chromiumResolverRules(chainHosts, resolve);
  const chromiumArgs = [
    ...(resolverRules.length > 0
      ? [`--host-resolver-rules=${resolverRules.join(",")}`]
      : []),
    ...chromiumEgressArgs(process.env.SCRAPER_EGRESS_PROXY),
  ];
  // Le jar est celui du SERVEUR, et lui seul : le navigateur ne monte jamais
  // la session d'un autre tenant. La page web n'en monte AUCUN.
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
  const browser = await pw.chromium.launch({
    ...CHROMIUM_LAUNCH_OPTIONS,
    // Les règles viennent de la garde et de l'exploitant : jamais d'un appelant.
    ...(chromiumArgs.length > 0 ? { args: chromiumArgs } : {}),
    timeout: timeoutMs,
  });
  // Annulation RÉELLE : le navigateur est un processus externe, pas une
  // promesse — sans cette fermeture, un délai dépassé laisse tourner un
  // Chromium orphelin (épuisement mémoire).
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
    // `serviceWorkers: "block"` : `page.route` ne voit PAS les requêtes émises
    // par un service worker. Sans ce refus d'enregistrement, une page pouvait
    // fetcher un hôte interne et recopier la réponse dans son DOM.
    // `acceptDownloads: false` : une page ne dépose jamais de fichier sur le
    // disque du serveur (le téléchargement est annulé par le navigateur).
    const contextOptions = { serviceWorkers: "block" as const, acceptDownloads: false };
    context =
      (jar
        ? await browser.newContext({ ...contextOptions, storageState: jar }).catch(
            // Premier run : pas de fichier local, contexte frais pour login interactif.
            async () => browser.newContext(contextOptions),
          )
        : await browser.newContext(contextOptions)) ?? null;
    // Playwright route les WebSocket via `routeWebSocket`, jamais via
    // `page.route` : sans cette garde, une page ouvrait `ws://192.168.x.x` et
    // recopiait la réponse dans son DOM. Aucune socket n'est ouverte avant le
    // verdict ; `close()` coupe les deux côtés.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await context.routeWebSocket("**/*", async (socket: any) => {
      const raw = typeof socket?.url === "function" ? socket.url() : "";
      let host: string | null = null;
      try {
        const parsed = new URL(raw);
        if (parsed.protocol === "ws:" || parsed.protocol === "wss:") host = parsed.hostname;
      } catch {
        host = null;
      }
      const verdict = host === null ? "private" : await checkPublicHost(host, resolve);
      if (verdict === "public") {
        // `connectToServer()` n'est appelé qu'APRÈS la garde : le DNS est
        // résolu avant que la socket réelle parte.
        socket.connectToServer();
        return;
      }
      await socket.close().catch(() => {});
    });
    let blockedTarget = false;
    // `context.route` couvre TOUTES les pages du contexte, y compris celles
    // qu'un `window.open` crée : `page.route` seul laissait une popup naviguer
    // hors garde. Enregistré avant la première page, donc aucun trou.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    await context.route("**/*", async (route: any) => {
      // API Playwright : `route.request()` est une MÉTHODE.
      const request = typeof route?.request === "function" ? route.request() : null;
      const target = typeof request?.url === "function" ? request.url() : "";
      const kind = typeof request?.resourceType === "function" ? request.resourceType() : "document";
      if (!isHttpUrl(target)) {
        // `file:`, `ftp:`, `data:` et `blob:` ne sortent pas : seul http(s) a
        // une raison d'être servi à une page non fiable (`ws` a son routeur).
        await route.abort().catch(() => {});
        return;
      }
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
      await route.continue().catch(() => {});
    });
    const page = await context.newPage();
    // Une popup est FERMÉE dès sa création : même routée, une page ouverte par
    // le contenu hostile n'a aucun rôle dans un scrape d'une seule page.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    context.on("page", (other: any) => {
      if (other === page) return;
      try {
        void other.close().catch(() => {});
      } catch {
        /* noop */
      }
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
    // Une page web NON TEXTUELLE (PDF, image, binaire) est refusée avant
    // extraction. Le `content-type` absent reste inconnu : la lecture bornée
    // tranche (une réponse en morceaux n'a pas toujours l'en-tête).
    const contentType = contentTypeOf(response);
    if (config.textOnly && !isTextContentType(contentType)) {
      throw new ScrapeManualsError("contenu non textuel refuse", "not_text");
    }
    const title = truncateManualText(
      ((await page.title().catch(() => config.label)) || config.label).trim(),
      200,
    );
    // La TAILLE annoncée (`content-length`) est un pré-contrôle : au-delà du
    // plafond, la page est refusée sans être lue. L'en-tête peut manquer
    // (chunked) ou décrire le corps COMPRESSÉ : la vraie borne est la
    // sérialisation bornée dans le navigateur, ci-dessous.
    const contentLength = contentLengthOf(response);
    if (contentLength > MAX_HTML_BYTES) {
      throw new ScrapeManualsError(
        `page trop volumineuse (${contentLength} octets, maximum ${MAX_HTML_BYTES}) — scrape refuse`,
        config.textOnly ? "too_large" : "generic",
      );
    }
    // HTML borné PENDANT la sérialisation (plafond de caractères) et lecture à
    // DÉLAI : le navigateur n'écrit jamais la page entière, seule la chaîne
    // bornée (+1 témoin) traverse le pont.
    const html = await readHtml(page, opts.contentTimeoutMs ?? CONTENT_TIMEOUT_MS, log);
    // Une PAGE DE CONNEXION (HTTP 200) n'est JAMAIS une source : le refus
    // arrive AVANT l'extraction ET avant l'écriture du jar, pour ne pas
    // écraser la session du serveur avec un mur de connexion.
    if (isLoginPage(html)) {
      throw new ScrapeManualsError(
        "page de connexion detectee (session du scraper a renouveler)",
        "login_required",
      );
    }
    const text = truncateManualText(stripTags(html), 4000);
    if (jar) {
      await saveJar(context, jar, log).catch(() => {
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

/**
 * Matière de l'OUVRAGE, prise sur la page sommaire : le titre de la page
 * résolue (« Activités | … ») ne nomme pas la matière, et la fiche d'ouvrage
 * précis s'en sert pour refuser un manuel d'une autre discipline (fail-closed).
 */
export function manualBookSubject(html: string): string | null {
  const $ = load(html);
  const og = $('meta[property="og:title"]').attr("content")?.trim();
  if (og) return og;
  const title = $("title").first().text().trim();
  return title || null;
}

/**
 * Page du sommaire qui contient `requested`, à partir du HTML de l'ouvrage.
 *
 * Le slug vient d'un contenu EXTERNE : seuls `page/<chiffres>` sont acceptés,
 * et l'URL est reconstruite sur l'origine déjà validée. Un slug absolu ou
 * privé ne peut donc pas détourner la navigation (I8).
 */
export function manualPageFromHtml(html: string, requested: number, baseUrl: string): string | null {
  if (!Number.isInteger(requested) || requested < 1) return null;
  const $ = load(html);
  const script = $("#id-initial-state").first().text().trim();
  const marker = script.indexOf("window.__PRELOADED_STATE__");
  if (marker < 0) return null;
  const eq = script.indexOf("=", marker);
  if (eq < 0) return null;
  let state: unknown;
  try {
    state = JSON.parse(script.slice(eq + 1).trim().replace(/;\s*$/, ""));
  } catch {
    return null;
  }
  let found: string | null = null;
  const visit = (node: unknown): void => {
    if (found !== null || node === null || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;
    const element = obj["element"];
    if (obj["type"] === "Page" && element !== null && typeof element === "object") {
      const el = element as Record<string, unknown>;
      const start = el["page"];
      const count = el["nbPages"];
      const slug = el["slug"];
      const span = typeof count === "number" && count > 0 ? count : 1;
      if (
        typeof start === "number" &&
        typeof slug === "string" &&
        requested >= start &&
        requested < start + span &&
        /^page\/\d+$/.test(slug)
      ) {
        found = new URL(`/${slug}`, baseUrl).toString();
        return;
      }
    }
    for (const value of Object.values(obj)) visit(value);
  };
  visit(state);
  return found;
}

/**
 * Résout une page d'ouvrage avant le scrape (sommaire lisible sans JS).
 *
 * `null` = sommaire sans cette page (ou format inconnu) : l'appelant garde
 * l'adresse de départ. Un site sans sommaire lisible ne perd donc pas sa
 * source ; un manuel lelivrescolaire résout la page exacte.
 */
async function resolveManualPageUrl(
  startUrl: string,
  requested: number,
  opts: ScrapeOptions,
): Promise<{ url: string; subject: string | null } | null> {
  const resolve = opts.resolveHost ?? systemResolver;
  await assertPublicRedirectChain(startUrl, opts.timeoutMs, resolve, false);
  const res = await fetch(startUrl, {
    redirect: "follow",
    signal: AbortSignal.timeout(opts.timeoutMs ?? DEFAULT_TIMEOUT_MS),
  });
  if (!res.ok) throw new ScrapeManualsError(`réponse HTTP ${res.status} sur le sommaire`);
  await assertPublicUrl(res.url, "sommaire final", resolve, false);
  const announced = Number(res.headers.get("content-length") ?? "0");
  if (announced > MAX_HTML_BYTES) {
    throw new ScrapeManualsError("sommaire trop volumineux", "too_large");
  }
  const html = (await res.text()).slice(0, MAX_HTML_CHARS);
  const url = manualPageFromHtml(html, requested, res.url);
  return url === null ? null : { url, subject: manualBookSubject(html) };
}

// Scrape manuel v1 : une page -> un ManualDoc (titre + texte).
// Ne logue jamais l'URL ni aucun credential : seulement plateforme + compteurs.
export async function scrapeManuals(config: ManualsConfig | null, opts: ScrapeOptions): Promise<ManualDoc[]> {
  if (!config) throw new ScrapeManualsError("manuels non configurés (plateforme absente)");
  const resolved = opts.page === undefined
    ? null
    : await resolveManualPageUrl(opts.startUrl, opts.page, opts);
  const startUrl = resolved?.url ?? opts.startUrl;
  const page = await scrapePage(
    {
      label: config.platform,
      useSession: opts.useSession ?? true,
      textOnly: opts.textOnly ?? false,
      rejectCredentials: false,
    },
    { ...opts, startUrl },
  );
  if (!page) return [];
  return [
    {
      id: `scrape-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
      platform: config.platform,
      title: page.title,
      // Le contrat borne `subject` à 100 : un titre plus long (100–200) ne doit
      // pas faire rejeter un scrape réussi (500 « invalid payload »).
      subject: truncateManualText(resolved?.subject ?? page.title, 100),
      page: resolved !== null ? opts.page ?? 1 : 1,
      excerpt: page.text,
    },
  ];
}
