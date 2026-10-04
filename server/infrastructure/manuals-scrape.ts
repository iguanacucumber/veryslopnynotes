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

// Import dynamique : false si Playwright absent (CI sans navigateur).
// Specifier non-littéral volontaire : évite TS2307 sans ajouter la dép lourde.
export async function isPlaywrightAvailable(): Promise<boolean> {
  try {
    await import("play" + "wright");
    return true;
  } catch {
    return false;
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
  const authFile = opts.authFile ?? DEFAULT_AUTH_FILE;
  const log = opts.logger ?? (() => {});
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let pw: any;
  try {
    pw = (await import("play" + "wright")) as any;
  } catch {
    throw new ScrapeManualsError("Playwright non installé — e2e manuals skippé (aucune dép ajoutée v1)");
  }
  const browser = await pw.chromium.launch({ headless: opts.headless ?? true });
  try {
    const context = await browser.newContext({ ...(authFile ? { storageState: authFile } : {}) }).catch(
      // Premier run : pas de fichier local, contexte frais pour login interactif.
      async () => browser.newContext(),
    );
    const page = await context.newPage();
    log(`scrape ${config.platform} -> 1 page`);
    // Statut HTTP vérifié AVANT toute extraction : une page d'erreur (404/500)
    // ou un mur de connexion ne doit jamais devenir un ManualDoc (le corpus
    // citerait sinon « Page introuvable » comme source de corrigé).
    const response = await page
      .goto(opts.startUrl, { timeout: opts.timeoutMs ?? DEFAULT_TIMEOUT_MS })
      .catch(() => null);
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
    await context.storageState({ path: authFile }).catch(() => {});
    await context.close().catch(() => {});
    if (!text) return [];
    return [{ id: `scrape-${Date.now()}`, platform: config.platform, title, subject: title, page: 1, excerpt: text }];
  } finally {
    await browser.close().catch(() => {});
  }
}
