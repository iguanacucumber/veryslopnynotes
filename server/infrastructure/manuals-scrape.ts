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
import { load } from "cheerio";
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
  /** Fichier local réutilisé entre runs (gitignoré). */
  readonly authFile?: string;
  /** false = première connexion interactive visible. */
  readonly headless?: boolean;
  readonly timeoutMs?: number;
  readonly logger?: (message: string) => void;
}

export const DEFAULT_AUTH_FILE = "playwright/.auth/manuals.json";
const DEFAULT_TIMEOUT_MS = 30_000;

function isHttpUrl(v: string): boolean {
  return /^https?:\/\//i.test(v);
}

// ponytail: bloque loopback + RFC1918 + link-local + metadata, sans dep.
// Upgrade: allowlist editeurs si corpus reel fige les hotes.
function isBlockedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "");
  if (h === "localhost" || h === "0.0.0.0" || h === "::" || h === "::1") return true;
  if (h === "169.254.169.254" || h.startsWith("169.254.")) return true;
  if (/^127\./.test(h) || h.startsWith("10.") || /^192\.168\./.test(h)) return true;
  const m172 = /^172\.(\d+)\./.exec(h);
  if (m172 && Number(m172[1]) >= 16 && Number(m172[1]) <= 31) return true;
  if (h === "2130706433" || h === "0x7f000001") return true;
  return false;
}

function assertPublicStartUrl(startUrl: string): void {
  let u: URL;
  try {
    u = new URL(startUrl);
  } catch {
    throw new ScrapeManualsError("startUrl http(s) requise (fournie par humain, jamais committée)");
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ScrapeManualsError("startUrl http(s) requise (fournie par humain, jamais committée)");
  }
  if (isBlockedHost(u.hostname)) {
    throw new ScrapeManualsError("startUrl privee/interne refusee");
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
  if (!isHttpUrl(opts.startUrl)) throw new ScrapeManualsError("startUrl http(s) requise (fournie par humain, jamais committée)");
  assertPublicStartUrl(opts.startUrl);
  const authFile = opts.authFile ?? DEFAULT_AUTH_FILE;
  if (authFile.includes("..") || authFile.startsWith("/") || authFile.trim().length === 0) {
    throw new ScrapeManualsError("authFile relatif sans .. requis");
  }
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
    log(`scrape ${config.platform} -> 1 page`);
    // Statut HTTP vérifié AVANT toute extraction : une page d'erreur (404/500)
    // ou un mur de connexion ne doit jamais devenir un ManualDoc (le corpus
    // citerait sinon « Page introuvable » comme source de corrigé).
    const response = await page.goto(opts.startUrl, { timeout: timeoutMs }).catch(() => null);
    const status = typeof response?.status === "function" ? response.status() : 0;
    const ok = typeof response?.ok === "function" ? response.ok() : status < 400;
    if (!response || !ok || status >= 400) {
      throw new ScrapeManualsError(
        `réponse HTTP ${status || "inconnue"} sur ${config.platform} — page non ingérée`,
      );
    }
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
