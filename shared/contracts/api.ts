// Contrats v0 — routes API app↔serveur (source de vérité, issue #4).
// Table de routes + types requête/réponse. Doit rester en sync avec
// shared/contracts/api.openapi.yaml (test contracts l'impose).

import type { Assignment, AveragesReport, CanteenBalance, CanteenMenu, CompetenceSummary, Device, Evaluation, Grade, NewsItem, Period, RevisionSheet, Skill, SubjectPrefs, TimetableEntry, UserInfo } from "./models";
import { isAssignment, isAveragesReport, isCanteenBalance, isCanteenMenu, isCompetenceSummary, isDevice, isEvaluation, isGrade, isNewsItem, isPeriod, isRevisionSheet, isSkill, isSubjectPrefs, isTimetableEntry, isUserInfo, SUBJECT_PREFS_MAX_COUNT } from "./models";
import type { SecurityAlertData } from "./events";
import { isSecurityAlertData } from "./events";


export interface ApiRoute {
  readonly method: "GET" | "POST" | "PUT";
  readonly path: string;
}

export const API_ROUTES: readonly ApiRoute[] = [
  { method: "GET", path: "/v1/health" },
  { method: "POST", path: "/v1/pairing/start" },
  { method: "POST", path: "/v1/pairing/confirm" },
  { method: "GET", path: "/v1/grades" },
  { method: "GET", path: "/v1/periods" },
  { method: "GET", path: "/v1/assignments" },
  { method: "GET", path: "/v1/timetable" },
  { method: "GET", path: "/v1/events" },
  { method: "GET", path: "/v1/security/alerts" },
  { method: "POST", path: "/v1/homework/generate" },
  { method: "GET", path: "/v1/revision-sheets" },
  { method: "GET", path: "/v1/revision-sheets/pdf" },
  // #83 préférences matière : GET liste / PUT upsert (clé = nom de matière).
  { method: "GET", path: "/v1/subjects/prefs" },
  { method: "PUT", path: "/v1/subjects/prefs" },

  { method: "GET", path: "/v1/evaluations" },

  { method: "GET", path: "/v1/news" },

  // #81 cantine : menus de la semaine + solde compte (optionnel).
  { method: "GET", path: "/v1/menus" },

  // #82 profil : infos du compte appairé (nom, classe, période, photo opaque).
  { method: "GET", path: "/v1/me" },
  // #82/#84 : résolution serveur d'une réf opaque (photo, PJ). L'app n'a
  // jamais d'URL Pronote : c'est le serveur qui télécharge (I1, règle d'or média).
  { method: "GET", path: "/v1/media" },
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
export type PairingConfirmResponse = Device;

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
// l'ENT ou hors périmètre) : l'app masque alors l'onglet, sans erreur.
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
export const HOMEWORK_MAX_SOURCES = 8;
export const HOMEWORK_MAX_SOURCE_CHARS = 2000;
export const HOMEWORK_MAX_SOURCE_LABEL_CHARS = 200;

export interface HomeworkSource {
  readonly text: string;
  readonly source: string;
}

export interface HomeworkGenerateRequest {
  readonly question: string;
  readonly sources: HomeworkSource[];
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
  return isDevice(v);
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

// --- #82 profil + média ---
// Bornes des paramètres d'entrée de /v1/media (ref opaque, accountId).
export const MEDIA_REF_MAX_CHARS = 200;
export const MEDIA_ACCOUNT_ID_MAX_CHARS = 64;

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
