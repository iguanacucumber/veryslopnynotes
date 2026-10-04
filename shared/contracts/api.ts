// Contrats v0 — routes API app↔serveur (source de vérité, issue #4).
// Table de routes + types requête/réponse. Doit rester en sync avec
// shared/contracts/api.openapi.yaml (test contracts l'impose).

import type { AbsenceRecord, Assignment, AttendancePeriod, AveragesReport, CanteenBalance, CanteenMenu, Capabilities, CompetenceSummary, Device, Discussion, Evaluation, Grade, Message, NewsItem, Period, Punishment, Recipient, RevisionSheet, Skill, SubjectPrefs, TimetableEntry, UserInfo } from "./models";
import { DISCUSSION_ID_MAX_CHARS, DISCUSSION_MAX_RECIPIENTS, DISCUSSION_SUBJECT_MAX_CHARS, isAbsenceRecord, isAssignment, isAttendancePeriod, isAveragesReport, isCanteenBalance, isCanteenMenu, isCapabilities, isCompetenceSummary, isDevice, isDiscussion, isEvaluation, isGrade, isMessage, isNewsItem, isPeriod, isPunishment, isRecipient, isRevisionSheet, isSkill, isSubjectPrefs, isTimetableEntry, isUserInfo, MESSAGE_BODY_MAX_CHARS, SUBJECT_PREFS_MAX_COUNT } from "./models";
import type { CacheInvalidatedData, ContractEvent, SecurityAlertData } from "./events";
import { isContractEvent, isSecurityAlertData } from "./events";


// --- Dates affichées : jour LOCAL, pas jour UTC ---
/** Fuseau du dépôt (élève, établissement, serveur) : Europe/Paris. */
export const APP_TIME_ZONE = "Europe/Paris";
const appDayFormatter = new Intl.DateTimeFormat("en-CA", { timeZone: APP_TIME_ZONE });

/**
 * Jour civil d'un instant ISO, « AAAA-MM-JJ », vu par l'élève. Une date
 * affichée = jour local : tronquer l'ISO (`slice(0, 10)`) donne le JOUR UTC et
 * date du 14 un DS du 15 à 00h30 locales. Source unique pour tout ce qui est
 * montré (titre de fiche, PDF, push). Instant illisible = texte d'origine.
 */
export function localDay(iso: string): string {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? iso.slice(0, 10) : appDayFormatter.format(at);
}

export interface ApiRoute {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
}

export const API_ROUTES: readonly ApiRoute[] = [
  { method: "GET", path: "/v1/health" },
  { method: "POST", path: "/v1/pairing/start" },
  { method: "POST", path: "/v1/pairing/confirm" },
  // #118 : setup EN UN APPEL (compte école + jeton de device). L'appairage
  // QR+PIN reste pour le ré-appairage ; au premier lancement l'app appelle
  // cette route, qui ouvre la session Pronote AVANT de rendre le jeton.
  { method: "POST", path: "/v1/setup" },
  { method: "GET", path: "/v1/grades" },
  { method: "GET", path: "/v1/periods" },
  { method: "GET", path: "/v1/assignments" },
  // #75 : toggle "fait" = ÉCRITURE vers Pronote, action CONFIRMÉE par l'app
  // uniquement (I7). Jamais déclenchée par une sortie libre LLM.
  { method: "POST", path: "/v1/assignments/toggle" },
  // #75 : proxy de pièces jointes. L'app n'a jamais d'URL Pronote : elle passe
  // une `ref` opaque (règle d'or média, I1). Jamais de WebView distante.
  { method: "GET", path: "/v1/timetable" },
  { method: "GET", path: "/v1/events" },
  { method: "GET", path: "/v1/security/alerts" },
  { method: "POST", path: "/v1/homework/generate" },
  { method: "GET", path: "/v1/revision-sheets" },
  { method: "GET", path: "/v1/revision-sheets/pdf" },
  // #83 préférences matière : GET liste / PUT upsert (clé = nom de matière).
  { method: "GET", path: "/v1/subjects/prefs" },
  { method: "PUT", path: "/v1/subjects/prefs" },
  // #78 : évaluations par compétences (chips + détail).
  { method: "GET", path: "/v1/evaluations" },
  // #79 : actualités établissement.
  { method: "GET", path: "/v1/news" },

  // #81 cantine : menus de la semaine + solde compte (optionnel).
  { method: "GET", path: "/v1/menus" },

  // #77 vie scolaire : absences + retards unifiés (kind) + compteurs par période.
  { method: "GET", path: "/v1/attendance" },
  { method: "GET", path: "/v1/punishments" },
  // #82 profil : infos du compte appairé (nom, classe, période, photo opaque).
  { method: "GET", path: "/v1/me" },
  // #82/#84 : résolution serveur d'une réf opaque (photo, PJ). L'app n'a
  // jamais d'URL Pronote : c'est le serveur qui télécharge (I1, règle d'or média).
  { method: "GET", path: "/v1/media" },

  // #87 : capacités dynamiques (onglets Pronote actifs) + pull-refresh manuel
  // (app → serveur → Pronote). Le refresh renvoie les événements de sync, tous
  // de types EXISTANTS (GradeCreated, TimetableUpdated, SyncCompleted,
  // CacheInvalidated) : aucun type d'événement nouveau.
  { method: "GET", path: "/v1/capabilities" },
  { method: "POST", path: "/v1/sync/refresh" },


  // #80 : messagerie (parité Papillon, onglet Discussions). Lectures pures
  // (onglet Discussions absent de l'établissement = listes VIDES, 200) et
  // écritures = ACTIONS APP CONFIRMÉES, une route explicite par action (I7) :
  // jamais déclenchées par une sortie LLM.
  // ponytail: `delete` est un POST et non un DELETE (ApiRoute n'accepte que
  // GET/POST/PUT, aucun appelant HTTP n'a besoin d'un vrai DELETE). Le corps
  // reste borné + validé comme les autres actions.
  { method: "GET", path: "/v1/discussions" },
  { method: "POST", path: "/v1/discussions" },
  { method: "GET", path: "/v1/discussions/messages" },
  { method: "GET", path: "/v1/discussions/recipients" },
  { method: "POST", path: "/v1/discussions/reply" },
  { method: "POST", path: "/v1/discussions/read-state" },
  { method: "POST", path: "/v1/discussions/delete" },
] as const;

export interface HealthResponse {
  readonly status: "ok";
  readonly version: string;
}

export interface PairingStartRequest {
  readonly deviceName: string;
}
export interface PairingStartResponse {
  readonly sessionId: string;
  /** Code PIN à 6 chiffres affiché en QR (jamais commité avec valeur réelle). */
  readonly code: string;
}

export interface PairingConfirmRequest {
  readonly sessionId: string;
  readonly code: string;
}
// 0.4.0 : le secret du device sort UNE SEULE FOIS, ici. Avant, la réponse ne
// portait que `Device` = { id, tokenHash } : l'app ne connaissait JAMAIS le
// token, donc ne pouvait présenter aucun bearer sur les routes protégé.
export interface PairingConfirmResponse {
  readonly device: Device;
  /** Secret du device, renvoyé UNE SEULE FOIS, ici, à l'appairage. */
  readonly token: string;
}
/** Borne du token d'app dans la réponse d'appairage (32 octets base64url = 43). */
export const PAIRING_TOKEN_MAX_CHARS = 512;

// #118 : POST /v1/setup — le flux « tout marche » en un appel.
// L'app envoie l'URL du serveur sur une autre requête (hors contrat), puis ici
// TOUT ce qui identifie l'établissement, et reçoit le jeton de device.
// 0.7.0 : UNE seule méthode — le QR de l'app Pronote. Le serveur ne détient
// aucun credential (ni .env, ni variable) : le QR vient de l'app à chaque
// session, `qr.login` + `qr.jeton` + `pin` en sont la preuve de détention.
export const SETUP_URL_MAX_CHARS = 300;
export const SETUP_CREDENTIAL_MAX_CHARS = 256;
/** login/jeton sont des hex AES : long, mais borné. */
export const SETUP_QR_FIELD_MAX_CHARS = 1024;
/** PIN de validation : clé de déchiffrement du QR, pas un code à 6 chiffres. */
export const SETUP_PIN_MAX_CHARS = 64;

/** Payload du QR Pronote de l'établissement (`login` + `jeton` chiffrés). */
export interface SetupQr {
  readonly login: string;
  readonly jeton: string;
  /** URL portée par le QR ; absente = `SetupRequest.schoolUrl`. */
  readonly url?: string;
}

export interface SetupRequest {
  readonly deviceName: string;
  /**
   * Adresse de l'établissement, saisie par l'utilisateur. Volontairement
   * `schoolUrl` et non `pronoteUrl` : le vocabulaire de l'établissement ne
   * doit pas atteindre le client (invariant I1 — l'app ne connaît que son
   * serveur). Le serveur, lui, sait ce que c'est.
   */
  readonly schoolUrl: string;
  /** QR affiché par l'app Pronote : la seule preuve de détention acceptée. */
  readonly qr: SetupQr;
  /** PIN de validation associé au QR (clé de déchiffrement). */
  readonly pin: string;
}

/**
 * 0.5.0 : comme `PairingConfirmResponse` — le jeton sort UNE SEULE FOIS, ici.
 * Le serveur ne rend jamais le jeton sur une autre route, ni en cas d'erreur.
 */
export interface SetupResponse {
  readonly device: Device;
  readonly token: string;
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

// --- #75 : toggle fait (action confirmée par l'app, I7) ---
// accountId : borne, et OPTIONNEL — absent = serveur mono-compte, qui résout sa
// session appairée côté intégration. done = état demandé ; la réponse fait foi.
export const ASSIGNMENT_TOGGLE_ID_MAX_CHARS = 64;

export interface AssignmentsToggleRequest {
  readonly accountId?: string;
  readonly assignmentId: string;
  readonly done: boolean;
}

export interface AssignmentsToggleResponse {
  readonly assignment: Assignment;
  /** Événement SSE `AssignmentUpdated` : l'app invalide son cache `assignments`. */
  readonly event: ContractEvent<"AssignmentUpdated", Assignment>;
}

export function isAssignmentsToggleRequest(v: unknown): v is AssignmentsToggleRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const account = r["accountId"];
  if (account !== undefined && !isBoundedNonEmptyString(account, ASSIGNMENT_TOGGLE_ID_MAX_CHARS)) return false;
  return (
    isBoundedNonEmptyString(r["assignmentId"], ASSIGNMENT_TOGGLE_ID_MAX_CHARS) &&
    typeof r["done"] === "boolean"
  );
}

export function isAssignmentsToggleResponse(v: unknown): v is AssignmentsToggleResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return isAssignment(r["assignment"]) && isContractEvent(r["event"]);
}

export interface TimetableResponse {
  readonly entries: TimetableEntry[];
}
/** Périodes (#74) : libellés des onglets, les notes ne portant que periodId. */
export interface PeriodsResponse {
  readonly periods: Period[];
}
export interface RevisionSheetsResponse {
  readonly sheets: RevisionSheet[];
}

/**
 * #78 : évaluations par compétences. `summary` = agrégat par compétence
 * (moyenne des notes DÉFINIES seulement, `value: null` si non notée).
 * Établissement sans évaluations par compétences = trois listes vides.
 */
export interface EvaluationsResponse {
  readonly skills: Skill[];
  readonly evaluations: Evaluation[];
  readonly summary: CompetenceSummary[];
}


// #81 cantine : menus de la fenêtre from/to (semaine courante par défaut).
// Tableau vide = aucun menu publié sur la fenêtre (module cantine absent de
// l'établissement ou hors périmètre) : l'app masque alors l'onglet, sans erreur.
// balance absent = solde non publié (Turboself/ARD non branché).
export interface CanteenMenusResponse {
  readonly menus: CanteenMenu[];
  readonly balance?: CanteenBalance;
}

// Alertes sécurité phase 6 (#21) : liste d'injections neutralisées (I6).
// Excerpt affiché comme donnée, jamais interprété côté app.
export interface SecurityAlertsResponse {
  readonly alerts: SecurityAlertData[];
}


// Devoirs generate (issue #27, phase 9) — JSON validé, sources citées.
// Requête = question + sources déjà récupérées (cours + manuels) ;
// réponse = corrigé sourcé ou refus propre si insuffisant.
// Aucun effet métier : RENDER/push = phases suivantes, jamais ici (I7).
export const HOMEWORK_MAX_QUESTION_CHARS = 2000;
/**
 * Corps POST /v1/homework/generate borné AVANT parse, comme les autres routes
 * d'écriture. Le contrat n'interdit pas les clés inconnues (`bourrage: …`) :
 * sans cette borne, un POST non authentifié de taille arbitraire est
 * entièrement bufferisé, puis accepté, et part quand même au LLM.
 * Marge au-dessus du pire cas utile : question 2000 + 8×(2000 + 200) + clé 512.
 */
export const HOMEWORK_MAX_BODY_CHARS = 65536;
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

export interface HomeworkSource {
  readonly text: string;
  readonly source: string;
}

export interface HomeworkGenerateRequest {
  readonly question: string;
  readonly sources: HomeworkSource[];
  /** Credential de l'appelant : `writeOnly`, jamais renvoyé ni journalisé. */
  readonly apiKey: string;
}

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

export function isPairingStartRequest(v: unknown): v is PairingStartRequest {
  if (typeof v !== "object" || v === null) return false;
  return isNonEmptyString((v as Record<string, unknown>)["deviceName"]);
}

export function isPairingStartResponse(v: unknown): v is PairingStartResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return isNonEmptyString(r["sessionId"]) && typeof r["code"] === "string" && /^\d{6}$/.test(r["code"] as string);
}

export function isPairingConfirmRequest(v: unknown): v is PairingConfirmRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return isNonEmptyString(r["sessionId"]) && typeof r["code"] === "string" && /^\d{6}$/.test(r["code"] as string);
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

export function isSecurityAlertsResponse(v: unknown): v is SecurityAlertsResponse {
  if (typeof v !== "object" || v === null) return false;
  const a = (v as Record<string, unknown>)["alerts"];
  return Array.isArray(a) && a.every(isSecurityAlertData);
}

export function isRevisionSheetsResponse(v: unknown): v is RevisionSheetsResponse {
  if (typeof v !== "object" || v === null) return false;
  const s = (v as Record<string, unknown>)["sheets"];
  return Array.isArray(s) && s.every(isRevisionSheet);
}

export function isPairingConfirmResponse(v: unknown): v is PairingConfirmResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return isDevice(r["device"]) && isBoundedNonEmptyString(r["token"], PAIRING_TOKEN_MAX_CHARS);
}

function isSetupQr(v: unknown): v is SetupQr {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const url = r["url"];
  return (
    isBoundedNonEmptyString(r["login"], SETUP_QR_FIELD_MAX_CHARS) &&
    isBoundedNonEmptyString(r["jeton"], SETUP_QR_FIELD_MAX_CHARS) &&
    (url === undefined || isBoundedNonEmptyString(url, SETUP_URL_MAX_CHARS))
  );
}

/**
 * #118 : valide la forme ET l'exploitabilité — le trio `qr` + `pin` EST la
 * méthode, donc il est requis. Un setup incomplet ne consomme pas de tentative
 * contre l'établissement : 400 direct, l'app garde l'utilisateur sur l'écran du
 * setup. Mieux vaut une erreur franche qu'un login à moitié fait.
 */
export function isSetupRequest(v: unknown): v is SetupRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!isBoundedNonEmptyString(r["deviceName"], SETUP_CREDENTIAL_MAX_CHARS)) return false;
  if (!isBoundedNonEmptyString(r["schoolUrl"], SETUP_URL_MAX_CHARS)) return false;
  if (!isSetupQr(r["qr"])) return false;
  return isBoundedNonEmptyString(r["pin"], SETUP_PIN_MAX_CHARS);
}

export function isSetupResponse(v: unknown): v is SetupResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return isDevice(r["device"]) && isBoundedNonEmptyString(r["token"], PAIRING_TOKEN_MAX_CHARS);
}

export function isEvaluationsResponse(v: unknown): v is EvaluationsResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const s = r["skills"];
  const e = r["evaluations"];
  const m = r["summary"];
  return (
    Array.isArray(s) &&
    s.every(isSkill) &&
    Array.isArray(e) &&
    e.every(isEvaluation) &&
    Array.isArray(m) &&
    m.every(isCompetenceSummary)
  );
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

export function isHomeworkSource(v: unknown): v is HomeworkSource {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    isBoundedNonEmptyString(r["text"], HOMEWORK_MAX_SOURCE_CHARS) &&
    isBoundedNonEmptyString(r["source"], HOMEWORK_MAX_SOURCE_LABEL_CHARS)
  );
}

export function isHomeworkGenerateRequest(v: unknown): v is HomeworkGenerateRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!isBoundedNonEmptyString(r["apiKey"], HOMEWORK_MAX_API_KEY_CHARS)) return false;
  if (!isBoundedNonEmptyString(r["question"], HOMEWORK_MAX_QUESTION_CHARS)) return false;
  const sources = r["sources"];
  if (!Array.isArray(sources) || sources.length > HOMEWORK_MAX_SOURCES) return false;
  return sources.every(isHomeworkSource);
}

export function isHomeworkGenerateResponse(v: unknown): v is HomeworkGenerateResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r["status"] === "ok") {
    return (
      isBoundedNonEmptyString(r["answer"], 8000) &&
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

// #83 préférences matière : corps PUT borné (4 champs, pas d'entrée arbitraire).
export const SUBJECT_PREFS_MAX_BODY_CHARS = 2048;

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


// --- #82 profil + média ---
// Bornes des paramètres d'entrée de /v1/media (ref opaque, accountId).
export const MEDIA_REF_MAX_CHARS = 200;

/**
 * Infos du compte appairé. `user: null` = compte appairé dont l'établissement
 * ne publie aucune info (état vide propre côté app), jamais un nom d'exemple.
 * Les périodes de l'année sont déjà servies par `/v1/periods` (#74).
 */
export interface MeResponse {
  readonly user: UserInfo | null;
}

export function isMeResponse(v: unknown): v is MeResponse {
  if (typeof v !== "object" || v === null) return false;
  const u = (v as Record<string, unknown>)["user"];
  return u === null || isUserInfo(u);
}

// --- #87 capacités dynamiques + pull-refresh ---
// `capabilities: null` = capacités NON déterminées (session absente, adaptateur
// sans détection) : l'app garde son affichage par défaut, elle ne masque rien.
// Liste présente = source de vérité : un onglet absent est désactivé.
export interface CapabilitiesResponse {
  readonly capabilities: Capabilities | null;
}

export function isCapabilitiesResponse(v: unknown): v is CapabilitiesResponse {
  if (typeof v !== "object" || v === null) return false;
  const c = (v as Record<string, unknown>)["capabilities"];
  return c === null || isCapabilities(c);
}

// Pull-refresh : l'app demande une relecture Pronote immédiate. La réponse
// porte les événements de sync (types existants) pour invalider les caches,
// plus un `SyncCompleted` et, si les onglets actifs ont changé, un
// `CacheInvalidated` (resource capabilities). Aucun événement novel, aucune
// donnée inventée : liste vide = rien n'a changé.
export const SYNC_REFRESH_MAX_EVENTS = 200;

export interface SyncRefreshResponse {
  readonly events: ContractEvent[];
}

export function isSyncRefreshResponse(v: unknown): v is SyncRefreshResponse {
  if (typeof v !== "object" || v === null) return false;
  const e = (v as Record<string, unknown>)["events"];
  return Array.isArray(e) && e.length <= SYNC_REFRESH_MAX_EVENTS && e.every(isContractEvent);
}

/** Corps du pull-refresh : `accountId` optionnel (absent = serveur mono-compte). */
export const SYNC_REFRESH_ACCOUNT_ID_MAX_CHARS = 64;

export function isSyncRefreshRequest(v: unknown): v is { readonly accountId?: string } {
  if (typeof v !== "object" || v === null || Array.isArray(v)) return false;
  const account = (v as Record<string, unknown>)["accountId"];
  return account === undefined || isBoundedNonEmptyString(account, SYNC_REFRESH_ACCOUNT_ID_MAX_CHARS);
}



// --- #80 messagerie : lectures + actions APP confirmées (I7) ---
// Lectures : `discussions` (liste des fils), `messages` d'un fil, `recipients`
// (destinataires possibles d'une nouvelle discussion). Onglet Discussions inactif
// côté établissement = listes VIDES (200), jamais une erreur.
// Écritures : chaque action a SA route explicite et ne part que d'un geste de
// l'utilisateur ; le corps est borné AVANT parse puis validé par is*Request.
// La réponse est `{ ok, event }` où `event` est l'événement EXISTANT
// CacheInvalidated (resource `discussions`) : aucun type d'événement nouveau,
// l'app purge son cache de messagerie et recharge.

/** Corps d'action borné AVANT parse : sujet + 4000 + ids de destinataires. */
export const DISCUSSION_MAX_BODY_CHARS = 8192;

/** accountId absent = serveur mono-compte, il résout sa session appairée. */
function isOptionalAccountId(v: unknown): boolean {
  return v === undefined || isBoundedNonEmptyString(v, DISCUSSION_ID_MAX_CHARS);
}

/** Liste d'ids de destinataires : bornée, sans doublon, jamais vide. */
function isRecipientIdList(v: unknown): v is string[] {
  if (!Array.isArray(v) || v.length === 0 || v.length > DISCUSSION_MAX_RECIPIENTS) return false;
  const seen = new Set<string>();
  for (const id of v) {
    if (!isBoundedNonEmptyString(id, DISCUSSION_ID_MAX_CHARS)) return false;
    if (seen.has(id)) return false;
    seen.add(id);
  }
  return true;
}

export interface DiscussionsResponse {
  readonly discussions: Discussion[];
}

export interface DiscussionMessagesResponse {
  readonly messages: Message[];
}

export interface DiscussionRecipientsResponse {
  readonly recipients: Recipient[];
}

/** Nouvelle discussion : sujet + premier message + destinataires (1..20). */
export interface DiscussionsCreateRequest {
  readonly accountId?: string;
  readonly subject: string;
  readonly body: string;
  readonly recipientIds: string[];
}

export interface DiscussionsReplyRequest {
  readonly accountId?: string;
  readonly discussionId: string;
  readonly body: string;
}

/** État lu/non-lu du fil (parité Papillon `readState`). */
export interface DiscussionsReadStateRequest {
  readonly accountId?: string;
  readonly discussionId: string;
  readonly read: boolean;
}

export interface DiscussionsDeleteRequest {
  readonly accountId?: string;
  readonly discussionId: string;
}

/** Réponse commune des 4 actions : confirmation + invalidation de cache. */
export interface DiscussionActionResponse {
  readonly ok: true;
  readonly event: ContractEvent<"CacheInvalidated", CacheInvalidatedData>;
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

export function isDiscussionsCreateRequest(v: unknown): v is DiscussionsCreateRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!isOptionalAccountId(r["accountId"])) return false;
  if (!isBoundedNonEmptyString(r["subject"], DISCUSSION_SUBJECT_MAX_CHARS)) return false;
  if (!isBoundedNonEmptyString(r["body"], MESSAGE_BODY_MAX_CHARS)) return false;
  return isRecipientIdList(r["recipientIds"]);
}

export function isDiscussionsReplyRequest(v: unknown): v is DiscussionsReplyRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!isOptionalAccountId(r["accountId"])) return false;
  if (!isBoundedNonEmptyString(r["discussionId"], DISCUSSION_ID_MAX_CHARS)) return false;
  return isBoundedNonEmptyString(r["body"], MESSAGE_BODY_MAX_CHARS);
}

export function isDiscussionsReadStateRequest(v: unknown): v is DiscussionsReadStateRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!isOptionalAccountId(r["accountId"])) return false;
  if (!isBoundedNonEmptyString(r["discussionId"], DISCUSSION_ID_MAX_CHARS)) return false;
  return typeof r["read"] === "boolean";
}

export function isDiscussionsDeleteRequest(v: unknown): v is DiscussionsDeleteRequest {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (!isOptionalAccountId(r["accountId"])) return false;
  return isBoundedNonEmptyString(r["discussionId"], DISCUSSION_ID_MAX_CHARS);
}

/**
 * `{ ok, event }` valide = l'action est partie d'un geste de l'app ET
 * l'invalidation porte bien la ressource `discussions` (donc le cache est
 * purgé, pas un autre). Un événement d'un autre type = réponse refusée : le
 * client ne peut pas transformer une action en autre effet.
 */
export function isDiscussionActionResponse(v: unknown): v is DiscussionActionResponse {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  if (r["ok"] !== true) return false;
  const e = r["event"];
  if (!isContractEvent(e)) return false;
  if (e.type !== "CacheInvalidated") return false;
  const d = e.data as { resource?: unknown };
  return d.resource === "discussions";
}
