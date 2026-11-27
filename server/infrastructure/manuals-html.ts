// Extraction HTML du scraper, sans réseau ni orchestration : le HTML reçu est
// DÉJÀ borné par `readHtml`, jamais la page entière.
import { decode } from "he";
import { ScrapeManualsError } from "./manuals-error";

/**
 * Plafond du HTML RÉCUPÉRÉ (caractères), appliqué AVANT l'extraction :
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

/** Résultat d'un parse HTML borné, sans DOM ni dépendance de parsing. */
export interface ExtractedHtml {
  readonly text: string;
  readonly title: string;
  readonly ogTitle: string | null;
  readonly login: boolean;
  readonly initialState: string;
}

const normalizeText = (value: string): string =>
  decode(value).replace(/\s+/g, " ").trim();

/**
 * Extrait en une passe les quatre signaux utiles au scraper.
 *
 * HTMLRewriter est fourni par Bun : pas de DOM complet, pas de dépendance de
 * parsing. `he` ne décode que les entités du texte déjà borné. Le contenu est
 * TOUJOURS l'entrée bornée de `readHtml`, jamais la page entière.
 *
 * Un lecteur de manuel met le sommaire ET la page dans le DOM : le texte du
 * conteneur de document passe en premier ; les sites sans ce conteneur gardent
 * le texte complet. Un espace est ajouté à chaque élément pour ne pas coller
 * deux paragraphes, puis les blancs sont normalisés.
 */
export async function extractHtml(html: string): Promise<ExtractedHtml> {
  let title = "";
  let ogTitle: string | null = null;
  let login = false;
  let initialState = "";
  await new HTMLRewriter()
    .on("title", {
      text(chunk) {
        title += chunk.text;
      },
    })
    .on('meta[property="og:title"]', {
      element(element) {
        ogTitle = element.getAttribute("content");
      },
    })
    .on("input", {
      element(element) {
        const type = (element.getAttribute("type") ?? "").toLowerCase();
        const name = (element.getAttribute("name") ?? "").toLowerCase();
        if (type === "password" || name === "password") login = true;
      },
    })
    .on("#id-initial-state", {
      text(chunk) {
        initialState += chunk.text;
      },
    })
    .transform(new Response(html))
    .text();

  const cleaned = await new HTMLRewriter()
    .on("script, style, title", {
      element(element) {
        element.remove();
      },
    })
    .transform(new Response(html))
    .text();

  let full = "";
  let documentText = "";
  await new HTMLRewriter()
    .on(".lls-new-viewer-document-root", {
      text(chunk) {
        documentText += chunk.text;
      },
    })
    .on("*", {
      element() {
        full += " ";
        documentText += " ";
      },
      text(chunk) {
        full += chunk.text;
      },
    })
    .transform(new Response(cleaned))
    .text();

  const rawText = documentText.trim() ? documentText : full;
  return {
    text: normalizeText(rawText),
    title: normalizeText(title),
    ogTitle: ogTitle === null ? null : normalizeText(ogTitle),
    login,
    initialState,
  };
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
export async function isLoginPage(html: string): Promise<boolean> {
  return (await extractHtml(html)).login;
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

export function contentLengthOf(response: unknown): number {
  const headers = responseHeadersOf(response);
  const raw = headers["content-length"] ?? headers["Content-Length"];
  const size = Number(raw);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

/** Types textuels acceptés pour une page web ; absent = inconnu (on lit). */
export function isTextContentType(value: string): boolean {
  const type = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (type === "") return true;
  if (type.startsWith("text/")) return true;
  return type === "application/xhtml+xml" || type === "application/xml";
}

/** `content-type` de la réponse de navigation (vide si absent). */
export function contentTypeOf(response: unknown): string {
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

/** Page Playwright réduite à la lecture bornée du titre. */
interface TitleHandle {
  jsonValue?: () => Promise<unknown>;
  dispose?: () => Promise<void>;
}

interface TitlePage {
  title: () => Promise<string>;
  evaluateHandle?: (fn: () => string) => Promise<TitleHandle | null>;
}

/**
 * Titre lu DANS la page et borné AVANT le pont CDP : `page.title()` renvoie
 * toute la chaîne, et un `<title>` chunked peut faire des mégaoctets.
 * `evaluateHandle` n'est utilisé que s'il existe ; les faux de test n'ont que
 * `title`, d'où le repli (le vrai Playwright a toujours `evaluateHandle`).
 */
export async function readBoundedTitle(page: TitlePage, fallback: string): Promise<string> {
  if (typeof page?.evaluateHandle === "function") {
    try {
      const handle = await page.evaluateHandle(() => {
        const doc = (globalThis as unknown as { document?: { title?: string } }).document;
        return (doc?.title ?? "").slice(0, 201);
      });
      try {
        const value = await handle?.jsonValue?.();
        if (typeof value === "string") return value;
      } finally {
        try {
          await handle?.dispose?.();
        } catch {
          /* noop */
        }
      }
    } catch {
      // Page morte ou lecture impossible : le libellé suffit, jamais la
      // chaîne non bornée de `page.title()`.
      return fallback;
    }
    return fallback;
  }
  if (typeof page?.title === "function") {
    return await page.title().catch(() => fallback);
  }
  return fallback;
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
 *  - plafond de caractères AVANT l'extraction : le coût du parse est
 *    linéaire, donc on borne la chaîne qu'il va reparcourir ;
 *  - la borne est appliquée DANS le navigateur (`BOUNDED_HTML`) : le processus
 *    ne matérialise jamais une page de plusieurs centaines de Mo.
 * La course peut être perdue (délai) : la rejection tardive ne doit pas
 * devenir une rejection non gérée.
 */
export async function readHtml(
  page: HtmlPage,
  timeoutMs: number,
  log: (message: string) => void,
): Promise<string> {
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
