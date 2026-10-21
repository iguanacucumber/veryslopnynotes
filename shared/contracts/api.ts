// Contrats v1 — scraper manuels + validateurs de données (source de vérité, issue #4).
// Table de routes : le process ne sert plus que GET /v1/health et
// POST /v1/manuals/scrape (#209, #210). Les 31 routes métier du serveur
// applicatif (appairage, lectures, écritures, médias, sync, messagerie, IA)
// sont supprimées avec leurs handlers : l'app est device-only (ADR-003).
// Les garde-fous de RÉPONSE (`isGradesResponse`, `isDiscussionsResponse`, …)
// restent : les miroirs `tests/unit/android-*.test.ts` s'en servent pour
// valider la logique Kotlin rejouée en TS.
// Doit rester en sync avec shared/contracts/api.openapi.yaml (test contracts
// l'impose).

import type { AbsenceRecord, Assignment, AttendancePeriod, AveragesReport, CanteenBalance, CanteenMenu, Discussion, Grade, Message, NewsItem, Period, Punishment, Recipient, SubjectPrefs, TimetableEntry } from "./models";
import { isAbsenceRecord, isAssignment, isAttendancePeriod, isAveragesReport, isCanteenBalance, isCanteenMenu, isDiscussion, isGrade, isMessage, isNewsItem, isPeriod, isPunishment, isRecipient, isSubjectPrefs, isTimetableEntry, SUBJECT_PREFS_MAX_COUNT } from "./models";
import { isPublicHttpUrl } from "./net";


export interface ApiRoute {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
}

export const API_ROUTES: readonly ApiRoute[] = [
  { method: "GET", path: "/v1/health" },
  // #209 : scraper Playwright minimal — le process ne sert QUE des manuels
  // (plain HTTPS, sans auth : décision utilisateur du 2026-10-11, risque
  // accepté documenté côté server/infrastructure/http.ts). Credentials portail
  // + startUrl injectés par l'appelant dans le corps (writeOnly), jamais en
  // env ni commités. Les 31 routes métier du serveur applicatif sont
  // supprimées en #210 (app device-only, ADR-003).
  { method: "POST", path: "/v1/manuals/scrape" },
] as const;

export interface HealthResponse {
  readonly status: "ok";
  readonly version: string;
}

// #74 : /v1/grades enrichi du rapport de moyennes (fournie/estimée, algorithme
// choisi par query `?algorithm=`, période par `?periodId=`). Breaking 0.1.0→0.2.0.
export interface GradesResponse {
  readonly grades: Grade[];
  readonly averages: AveragesReport;
}
export interface AssignmentsResponse {
  readonly assignments: Assignment[];
}

export interface TimetableResponse {
  readonly entries: TimetableEntry[];
}
/** Périodes (#74) : libellés des onglets, les notes ne portant que periodId. */
export interface PeriodsResponse {
  readonly periods: Period[];
}

// #81 cantine : menus de la fenêtre from/to (semaine courante par défaut).
// Tableau vide = aucun menu publié sur la fenêtre (module cantine absent de
// l'établissement ou hors périmètre) : l'app masque alors l'onglet, sans erreur.
// balance absent = solde non publié (Turboself/ARD non branché).
export interface CanteenMenusResponse {
  readonly menus: CanteenMenu[];
  readonly balance?: CanteenBalance;
}

// Devoirs generate (issue #27, phase 9) — JSON validé, sources citées.
// Requête = question + sources déjà récupérées (cours + manuels) ;
// réponse = corrigé sourcé ou refus propre si insuffisant.
// Aucun effet métier : RENDER/push = phases suivantes, jamais ici (I7).
export const HOMEWORK_MAX_QUESTION_CHARS = 2000;
/** Nombre maximal de sources jointes à la question. */
export const HOMEWORK_MAX_SOURCES = 8;
export const HOMEWORK_MAX_SOURCE_CHARS = 2000;
export const HOMEWORK_MAX_SOURCE_LABEL_CHARS = 200;
/**
 * 0.7.0 : clé du fournisseur LLM, ENVOYÉE PAR L'APP à chaque appel. Le serveur
 * n'en détient aucune (ni .env, ni variable, ni disque) : elle vit dans le
 * corps de la requête, part dans l'en-tête `Authorization` de l'appel
 * fournisseur, et n'est ni journalisée nipersistée. Bornée comme un credential.
 */
export const HOMEWORK_MAX_API_KEY_CHARS = 512;
/**
 * Longueur maximale du corrigé. Miroir de `Homework.MAX_ANSWER_CHARS`
 * (`android/core/.../Homework.kt`), où elle est DÉRIVÉE du plafond de sortie
 * I5 (moins l'enveloppe JSON) : les deux bornes ne peuvent pas dériver
 * l'une de l'autre (#411 — le test `kotlin-llm-budget.test.ts` les compare).
 */
export const HOMEWORK_MAX_ANSWER_CHARS = 8000;

export interface HomeworkOkResponse {
  readonly status: "ok";
  readonly answer: string;
  readonly steps: string[];
  readonly sources: string[];
}

export interface HomeworkRefusedResponse {
  readonly status: "refused";
  readonly reason: string;
  readonly sources: string[];
}

export type HomeworkGenerateResponse = HomeworkOkResponse | HomeworkRefusedResponse;


function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export function isHealthResponse(v: unknown): v is HealthResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return r["status"] === "ok" && typeof r["version"] === "string" && (r["version"] as string).length > 0;
}

export function isGradesResponse(v: unknown): v is GradesResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const g = r["grades"];
  return Array.isArray(g) && g.every(isGrade) && isAveragesReport(r["averages"]);
}

export function isAssignmentsResponse(v: unknown): v is AssignmentsResponse {
  if (typeof v !== "object" || v === null) return false;
  const a = (v as Record<string, unknown>)["assignments"];
  return Array.isArray(a) && a.every(isAssignment);
}

export function isPeriodsResponse(v: unknown): v is PeriodsResponse {
  if (typeof v !== "object" || v === null) return false;
  const p = (v as Record<string, unknown>)["periods"];
  return Array.isArray(p) && p.every(isPeriod);
}

export function isTimetableResponse(v: unknown): v is TimetableResponse {
  if (typeof v !== "object" || v === null) return false;
  const e = (v as Record<string, unknown>)["entries"];
  return Array.isArray(e) && e.every(isTimetableEntry);
}

export function isCanteenMenusResponse(v: unknown): v is CanteenMenusResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const m = r["menus"];
  if (!Array.isArray(m) || !m.every(isCanteenMenu)) return false;
  return r["balance"] === undefined || isCanteenBalance(r["balance"]);
}

function isBoundedNonEmptyString(v: unknown, max: number): v is string {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max;
}

export function isHomeworkGenerateResponse(v: unknown): v is HomeworkGenerateResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r["status"] === "ok") {
    return (
      isBoundedNonEmptyString(r["answer"], HOMEWORK_MAX_ANSWER_CHARS) &&
      Array.isArray(r["steps"]) &&
      (r["steps"] as unknown[]).every((s) => typeof s === "string") &&
      Array.isArray(r["sources"]) &&
      (r["sources"] as unknown[]).length > 0 &&
      (r["sources"] as unknown[]).every((s) => isNonEmptyString(s))
    );
  }
  if (r["status"] === "refused") {
    return (
      isNonEmptyString(r["reason"]) &&
      Array.isArray(r["sources"]) &&
      (r["sources"] as unknown[]).every((s) => typeof s === "string")
    );
  }
  return false;
}

// #83 préférences matière : liste des préférences connues, clé = nom de matière.

/** Liste des préférences connues, clé = nom de matière. */
export interface SubjectPrefsResponse {
  readonly prefs: SubjectPrefs[];
}

export function isSubjectPrefsResponse(v: unknown): v is SubjectPrefsResponse {
  if (typeof v !== "object" || v === null) return false;
  const p = (v as Record<string, unknown>)["prefs"];
  return Array.isArray(p) && p.length <= SUBJECT_PREFS_MAX_COUNT && p.every(isSubjectPrefs);
}


// Actualités établissement (#79) : liste la plus récente d'abord.
// Onglet non actif côté établissement = liste vide (200), jamais 500.
export interface NewsResponse {
  readonly news: NewsItem[];
}

export function isNewsResponse(v: unknown): v is NewsResponse {
  if (typeof v !== "object" || v === null) return false;
  const n = (v as Record<string, unknown>)["news"];
  return Array.isArray(n) && n.every(isNewsItem);
}


// #77 vie scolaire : `absences` porte absences ET retards (champ `kind`),
// `periods` = compteurs dérivés par période. Onglet vie scolaire absent de
// l'établissement = deux listes vides (200), jamais 500.
export interface AttendanceResponse {
  readonly absences: AbsenceRecord[];
  readonly periods: AttendancePeriod[];
}

export interface PunishmentsResponse {
  readonly punishments: Punishment[];
}

export function isAttendanceResponse(v: unknown): v is AttendanceResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const a = r["absences"];
  const p = r["periods"];
  return (
    Array.isArray(a) &&
    a.every(isAbsenceRecord) &&
    Array.isArray(p) &&
    p.every(isAttendancePeriod)
  );
}

export function isPunishmentsResponse(v: unknown): v is PunishmentsResponse {
  if (typeof v !== "object" || v === null) return false;
  const p = (v as Record<string, unknown>)["punishments"];
  return Array.isArray(p) && p.every(isPunishment);
}

// --- #80 messagerie : garde-fous de lecture ---
// Les contrats d'écriture (une route explicite par action) sont supprimés avec
// le serveur (#210) ; restent les validateurs de LISTES, utilisés par les
// miroirs Android des écrans Discussions.

export interface DiscussionsResponse {
  readonly discussions: Discussion[];
}

export interface DiscussionMessagesResponse {
  readonly messages: Message[];
}

export interface DiscussionRecipientsResponse {
  readonly recipients: Recipient[];
}

export function isDiscussionsResponse(v: unknown): v is DiscussionsResponse {
  if (typeof v !== "object" || v === null) return false;
  const d = (v as Record<string, unknown>)["discussions"];
  return Array.isArray(d) && d.every(isDiscussion);
}

export function isDiscussionMessagesResponse(v: unknown): v is DiscussionMessagesResponse {
  if (typeof v !== "object" || v === null) return false;
  const m = (v as Record<string, unknown>)["messages"];
  return Array.isArray(m) && m.every(isMessage);
}

export function isDiscussionRecipientsResponse(v: unknown): v is DiscussionRecipientsResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = (v as Record<string, unknown>)["recipients"];
  return Array.isArray(r) && r.every(isRecipient);
}

// --- #209 scraper Playwright minimal (page -> ManualDoc) ---
// Corps POST borné AVANT parse comme les autres routes ouvertes : sans borne,
// un POST non authentifié de taille arbitraire est entièrement bufferisé.
// `password`/`username`/`startUrl` sont writeOnly : jamais journalisés, jamais
// persistés, jamais renvoyés (seul le cookie jar Playwright vit sur disque,
// hors dépôt).
//
// LE JAR DE SESSION EST CHOISI PAR LE SERVEUR (#538). Il ne l'est plus par
// l'appelant, même indirectement : `authFile` a d'abord été un CHEMIN (écriture
// de fichier arbitraire, #362), puis un NOM de jar — mais le nom suffit à
// demander la session d'un AUTRE tenant : le répertoire était imposé, pas
// l'isolation. Le champ n'existe donc plus dans le contrat, et le serveur
// REFUSE explicitement un corps qui le porte (message dédié, pas un 400
// générique).
export const MANUALS_SCRAPE_PATH = "/v1/manuals/scrape";
export const MANUALS_SCRAPE_MAX_BODY_CHARS = 8192;
export const MANUALS_SCRAPE_PLATFORM_MAX_CHARS = 100;
export const MANUALS_SCRAPE_CREDENTIAL_MAX_CHARS = 512;
export const MANUALS_SCRAPE_URL_MAX_CHARS = 2000;

export interface ManualsScrapeRequest {
  readonly platform: string;
  readonly username: string;
  /** Credential de l'appelant : `writeOnly`, jamais renvoyé ni journalisé. */
  readonly password: string;
  /** URL de départ fournie par l'humain (jamais committée). */
  readonly startUrl: string;
  /** false = première connexion interactive visible. */
  readonly headless?: boolean;
}

/**
 * Miroir contrat de `ManualDoc` (server/infrastructure/manuals.ts) : le
 * contrat partagé ne remonte pas vers server/ (sens des dépendances).
 */
export interface ManualsScrapeDoc {
  readonly id: string;
  readonly platform: string;
  readonly title: string;
  readonly subject: string;
  readonly page: number;
  readonly excerpt: string;
}

export interface ManualsScrapeResponse {
  readonly docs: ManualsScrapeDoc[];
}

export function isManualsScrapeRequest(v: unknown): v is ManualsScrapeRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!isBoundedNonEmptyString(r["platform"], MANUALS_SCRAPE_PLATFORM_MAX_CHARS)) return false;
  if (!isBoundedNonEmptyString(r["username"], MANUALS_SCRAPE_CREDENTIAL_MAX_CHARS)) return false;
  if (!isBoundedNonEmptyString(r["password"], MANUALS_SCRAPE_CREDENTIAL_MAX_CHARS)) return false;
  if (!isBoundedNonEmptyString(r["startUrl"], MANUALS_SCRAPE_URL_MAX_CHARS)) return false;
  if (!/^https?:\/\//i.test(r["startUrl"] as string)) return false;
  // Garde SSRF partagée avec le serveur (shared/contracts/net.ts) : IPv4
  // littéral/entier/hex, IPv4-mapped IPv6, loopback, RFC1918, link-local,
  // métadonnées, ULA IPv6. Cette garde est LITTÉRALE (validateur synchrone) :
  // un nom DNS public passe ICI, mais le SERVEUR le résout avant la
  // navigation et refuse le nom dont une adresse est privée
  // (server/infrastructure/ssrf.ts, issue #419).
  if (!isPublicHttpUrl(r["startUrl"] as string)) return false;
  const headless = r["headless"];
  return headless === undefined || typeof headless === "boolean";
}

export function isManualsScrapeDoc(v: unknown): v is ManualsScrapeDoc {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isBoundedNonEmptyString(r["id"], 200) &&
    isBoundedNonEmptyString(r["platform"], MANUALS_SCRAPE_PLATFORM_MAX_CHARS) &&
    isBoundedNonEmptyString(r["title"], 200) &&
    isBoundedNonEmptyString(r["subject"], 100) &&
    Number.isInteger(r["page"]) &&
    (r["page"] as number) >= 1 &&
    typeof r["excerpt"] === "string" &&
    (r["excerpt"] as string).length <= 8000
  );
}

export function isManualsScrapeResponse(v: unknown): v is ManualsScrapeResponse {
  if (typeof v !== "object" || v === null) return false;
  const d = (v as Record<string, unknown>)["docs"];
  return Array.isArray(d) && d.every(isManualsScrapeDoc);
}
