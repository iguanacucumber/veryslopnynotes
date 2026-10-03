// API v0 — routeur HTTP stdlib Bun.serve (issues #10, #12, ADR-001 : pas de
// framework sans besoin justifié). Routes = shared/contracts API_ROUTES,
// payloads validés par les garde-fous is* avant envoi (500 typée sinon).
// Appairage câblé sur PairingService (QR = payload {sessionId, code}).
// SSE = snapshot SyncCompleted puis connexion tenue (live : phase 5).

import {
  API_ROUTES,
  SUBJECT_PREFS_MAX_BODY_CHARS,
  isAssignmentsResponse,
  isAttendanceResponse,
  isEvaluationsResponse,
  isPunishmentsResponse,

  isCanteenMenusResponse,
  isGradesResponse,
  isMeResponse,
  isNewsResponse,
  MEDIA_ACCOUNT_ID_MAX_CHARS,
  MEDIA_REF_MAX_CHARS,
  isPairingConfirmRequest,
  isPairingStartRequest,
  isPairingStartResponse,
  isPeriodsResponse,
  isRevisionSheetsResponse,
  isSecurityAlertsResponse,
  isSubjectPrefsResponse,
  isTimetableResponse,
} from "../../shared/contracts/api";
import { CONTRACTS_VERSION, DEFAULT_AVERAGE_ALGORITHM, isAverageAlgorithm, isDevice, isNewsItem, isSubjectPrefs, SUBJECT_PREFS_MAX_COUNT } from "../../shared/contracts/models";
import type { ContractEvent, NewsUpdatedData, SyncCompletedData } from "../../shared/contracts/events";
import { apiError } from "./errors";
import { computeAverages } from "../domain/averages";
import { attendancePeriods } from "../domain/attendance";
import { buildCompetenceSummary, buildSkills } from "../domain/competences";
import { handleHomeworkGenerate } from "./homework";
import type { AssignmentActions, MediaActions } from "./assignments";
import { handleAssignmentsToggle } from "./assignments";
import { PairingService } from "./pairing";
import { renderRevisionPdf } from "../jobs/revision";
import type { RevisionListStore } from "./revision";
import { createRevisionMemoryStore } from "./revision";
import type { ReadStore } from "./store";
import type { SubjectPrefsStore } from "./subject-prefs";
import { createSubjectPrefsMemoryStore } from "./subject-prefs";
import type { LLMProvider } from "../domain/ports";
import type { MediaPayload } from "../infrastructure/media-proxy";
import { MediaProxyError } from "../infrastructure/media-proxy";

/**
 * #82 : résolution serveur d'une réf opaque (photo de profil, pièce jointe).
 * L'app n'a jamais d'adresse Pronote/ENT (I1, règle d'or média) : elle appelle
 * /v1/media et le serveur télécharge via la session appairée.
 * ponytail: fonction injectée, null = 501 explicite (aucun accès direct depuis
 * le routeur). Upgrade: câblage sur PronoteSessionStore au démarrage serveur.
 */
export type MediaResolver = (accountId: string, ref: string) => Promise<MediaPayload>;

/** Types MIME déduits de l'extension du nom renvoyé par le proxy (defaut = binaire). */
const MEDIA_CONTENT_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

function mediaContentType(name: string): string {
  const ext = (name.toLowerCase().split(".").pop() ?? "").trim();
  return MEDIA_CONTENT_TYPES[ext] ?? "application/octet-stream";
}

/** Nom ASCII pour l'en-tête (le nom lisible part dans filename*). */
function asciiFileName(name: string): string {
  const clean = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_").trim();
  return clean || "fichier";
}

/** Normalise les deux ports média (fonction #82 / objet `download` #75). */
function mediaResolver(media: MediaResolver | MediaActions | null): MediaResolver | null {
  if (media === null) return null;
  if (typeof media === "function") return media;
  if (typeof media.download === "function") return (accountId, ref) => media.download(accountId, ref);
  return null;
}

/**
 * #82 : une ref est un jeton opaque. Toute forme d'adresse est refusée avant le
 * proxy (défense en profondeur, même si le proxy revalide de son côté).
 */
function isMediaRef(v: string): boolean {
  return v.length > 0 && v.length <= MEDIA_REF_MAX_CHARS && !v.includes("//") && !v.includes("..");
}

/** Longueur max d'un periodId reflété dans la réponse (borne d'entrée utilisateur). */
const PERIOD_ID_MAX_CHARS = 64;

/** Longueur max d'une date de fenêtre (borne d'entrée utilisateur, #75/#81). */
const DATE_MAX_CHARS = 40;

/**
 * Fenêtre from/to du routeur (bornée en longueur puis validée ISO ; paramètre
 * absent = pas de borne). Renvoie null = 400 (jamais de date devinée).
 * Partagée par /v1/assignments (#75, + weekStart) et /v1/menus (#81).
 */
function dateWindow(url: URL): { from?: string; to?: string } | null {
  const out: { from?: string; to?: string } = {};
  for (const key of ["from", "to"] as const) {
    const raw = url.searchParams.get(key);
    if (raw === null) continue;
    const t = raw.trim().slice(0, DATE_MAX_CHARS);
    if (t === "") continue;
    if (Number.isNaN(Date.parse(t))) return null;
    out[key] = t;
  }
  return out;
}

/** #75 : bornes ISO de la semaine demandée (weekStart lundi → dimanche). */
function assignmentWeek(url: URL): { from?: string; to?: string } | null {
  const win = dateWindow(url);
  if (win === null) return null;
  const rawWeek = url.searchParams.get("weekStart");
  if (rawWeek === null) return win;
  const day = rawWeek.trim().slice(0, DATE_MAX_CHARS);
  if (day === "") return win;
  const start = Date.parse(day);
  if (Number.isNaN(start)) return null;
  // 7 jours pleins : l'app passe le lundi, la borne haute couvre dimanche soir.
  const end = new Date(start + 7 * 86400000 - 1);
  return { from: new Date(start).toISOString(), to: end.toISOString() };
}

function json(valid: boolean, payload: unknown): Response {
  if (!valid) return apiError("internal", "invalid payload");
  return Response.json(payload);
}

function sse(events: ContractEvent | ContractEvent[]): Response {
  const list = Array.isArray(events) ? events : [events];
  const line = list.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(line));
    },
    cancel() {},
  });
  return new Response(stream, {
    headers: {
      "content-type": "text/event-stream",
      "cache-control": "no-cache",
      connection: "keep-alive",
    },
  });
}

export function createHandler(
  store: ReadStore,
  pairing: PairingService = new PairingService(),
  llm: LLMProvider | null = null,
  revisions: RevisionListStore = createRevisionMemoryStore(),
  // #83 : préférences matière. Interface d'écriture séparée de ReadStore, NoOp
  // par défaut pour les appels existants (5e paramètre, aucun appel cassé).
  subjectPrefs: SubjectPrefsStore = createSubjectPrefsMemoryStore(),
  // #75 : écriture "fait" (I7, action APP confirmée) et proxy média. Absents par
  // défaut = 501 honnête, jamais un faux succès ni une URL Pronote côté app.
  assignmentActions: AssignmentActions | null = null,
  // #75/#82/#84 : proxy média unique (PJ devoirs + photo de profil). Les deux
  // ports (fonction #82, objet `download` #75) sont acceptés et normalisés :
  // une seule implémentation de la route, un seul contrat.
  media: MediaResolver | MediaActions | null = null,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
    const download = mediaResolver(media);
    // Une path peut porter GET + PUT (#83) : on matche path puis méthode,
    // sinon 405 sur la mauvaise méthode au lieu de 404/405 incohérent.
    if (!API_ROUTES.some((r) => r.path === path)) return apiError("not_found", `unknown path ${path}`);
    if (!API_ROUTES.some((r) => r.path === path && r.method === req.method)) {
      return apiError("method_not_allowed", `${req.method} not allowed on ${path}`);
    }

    switch (path) {
      case "/v1/health":
        return Response.json({ status: "ok", version: CONTRACTS_VERSION });
      case "/v1/grades": {
        // #74 : moyennes fournies si l'établissement les publie, sinon estimées
        // (3 algorithmes Papillon). Choix algo/période par query, defauts sûrs.
        const grades = store.grades();
        const rawAlgo = url.searchParams.get("algorithm");
        // Algo inconnu = 400 sans répliquer l'input dans le corps d'erreur.
        if (rawAlgo !== null && !isAverageAlgorithm(rawAlgo)) return apiError("bad_request", "unknown algorithm");
        const algorithm = rawAlgo ?? DEFAULT_AVERAGE_ALGORITHM;
        // periodIdborné : c'est un champ d'entrée utilisateur, on le reflète
        // dans la réponse mais sans laisser une chaîne arbitrairement longue.
        const rawPeriod = (url.searchParams.get("periodId") ?? "").trim().slice(0, PERIOD_ID_MAX_CHARS);
        const periodId = rawPeriod === "" ? null : rawPeriod;
        const payload = {
          grades,
          averages: computeAverages(grades, {
            algorithm,
            periodId,
            provided: store.providedAverages(),
          }),
        };
        return json(isGradesResponse(payload), payload);
      }
      case "/v1/periods": {
        const payload = { periods: store.periods() };
        return json(isPeriodsResponse(payload), payload);
      }
      case "/v1/assignments": {
        // #75 : fenêtre weekStart (lundi→dimanche) ou from/to. Date illisible
        // = 400 sans refléter l'input ; devoir sans description/PJ = champs
        // omis, jamais de valeur inventée.
        const win = assignmentWeek(url);
        if (win === null) return apiError("bad_request", "invalid date window");
        const from = win.from === undefined ? null : Date.parse(win.from);
        const to = win.to === undefined ? null : Date.parse(win.to);
        const assignments = store.assignments().filter((a) => {
          const d = Date.parse(a.dueDate);
          if (Number.isNaN(d)) return false;
          return (from === null || d >= from) && (to === null || d <= to);
        });
        const payload = { assignments };
        return json(isAssignmentsResponse(payload), payload);
      }
      // #75 : toggle fait = ÉCRITURE Pronote, action APP confirmée (I7).
      case "/v1/assignments/toggle": {
        return handleAssignmentsToggle(req, assignmentActions);
      }
      // #75 : proxy des pièces jointes (ref opaque → octets). Jamais d'URL
      // Pronote dans l'app (I1), jamais de WebView distante.
      case "/v1/media": {
        const ref = (url.searchParams.get("ref") ?? "").trim();
        const accountId = (url.searchParams.get("accountId") ?? "").trim().slice(0, MEDIA_ACCOUNT_ID_MAX_CHARS);
        if (!isMediaRef(ref) || accountId === "") return apiError("bad_request", "invalid media ref");
        if (!download) return apiError("not_implemented", "media proxy absent");
        let file: MediaPayload;
        try {
          file = await download(accountId, ref);
        } catch (err) {
          // Jamais le message d'erreur brut (il peut contenir une interne).
          if (err instanceof MediaProxyError) {
            if (err.code === "bad_ref") return apiError("bad_request", "invalid media ref");
            if (err.code === "session_expired") return apiError("unauthorized", "session expirée");
            if (err.code === "not_found") return apiError("not_found", "unknown media ref");
          }
          return apiError("internal", "media unavailable");
        }
        const type = mediaContentType(file.name);
        return new Response(file.bytes as unknown as BodyInit, {
          headers: {
            "content-type": type,
            "content-length": String(file.bytes.byteLength),
            "cache-control": "private, max-age=600",
            // Image = affichage direct (photo de profil), sinon téléchargement.
            "content-disposition": `${type.startsWith("image/") ? "inline" : "attachment"}; filename="${asciiFileName(file.name)}"; filename*=UTF-8''${encodeURIComponent(file.name)}`,
          },
        });
      }
      case "/v1/timetable": {
        const payload = { entries: store.entries() };
        return json(isTimetableResponse(payload), payload);
      }
      case "/v1/security/alerts": {
        const payload = { alerts: store.securityAlerts() };
        return json(isSecurityAlertsResponse(payload), payload);
      }
      case "/v1/events": {
        const data: SyncCompletedData = {
          accountId: "seed-acc",
          grades: store.grades().length,
          assignments: store.assignments().length,
        };
        const event: ContractEvent<"SyncCompleted", SyncCompletedData> = {
          v: CONTRACTS_VERSION,
          type: "SyncCompleted",
          at: new Date().toISOString(),
          data,
        };
        // #79 : snapshot actus dans le meme flux (items filtrees par le garde-fou
        // pour garantir une enveloppe valide, pas de 500 possible en flux ouvert).
        const newsEvent: ContractEvent<"NewsUpdated", NewsUpdatedData> = {
          v: CONTRACTS_VERSION,
          type: "NewsUpdated",
          at: new Date().toISOString(),
          data: { items: (store.news?.() ?? []).filter(isNewsItem) },
        };
        return sse([event, newsEvent]);
      }
      case "/v1/revision-sheets": {
        const payload = { sheets: revisions.list() };
        return json(isRevisionSheetsResponse(payload), payload);
      }
      case "/v1/revision-sheets/pdf": {
        const id = (url.searchParams.get("id") ?? "").trim();
        if (!id) return apiError("bad_request", "missing id");
        const sheet = revisions.get(id);
        if (!sheet) return apiError("not_found", "unknown revision sheet");
        let pdf: Uint8Array;
        try {
          pdf = renderRevisionPdf(sheet);
        } catch {
          return apiError("internal", "invalid payload");
        }
        return new Response(pdf as unknown as BodyInit, {
          headers: { "content-type": "application/pdf" },
        });
      }
      case "/v1/pairing/start": {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return apiError("bad_request", "invalid JSON body");
        }
        if (!isPairingStartRequest(body)) return apiError("bad_request", "invalid pairing request");
        const payload = pairing.start(body.deviceName);
        return json(isPairingStartResponse(payload), payload);
      }
      case "/v1/pairing/confirm": {
        let body: unknown;
        try {
          body = await req.json();
        } catch {
          return apiError("bad_request", "invalid JSON body");
        }
        if (!isPairingConfirmRequest(body)) return apiError("bad_request", "invalid pairing request");
        const res = pairing.confirm(body.sessionId, body.code);
        if (!res.ok) {
          if (res.failure === "unknown_session" || res.failure === "expired") {
            return apiError("not_found", `pairing ${res.failure}`);
          }
          return apiError("bad_request", `pairing ${res.failure}`);
        }
        return json(isDevice(res.device), res.device);
      }
      case "/v1/homework/generate": {
        return handleHomeworkGenerate(req, llm);
      }
      case "/v1/subjects/prefs": {
        // #83 : préférences matière (couleur/emoji/libellé), clé = nom de matière.
        // GET = liste bornée, PUT = upsert d'une matière. Le local gagne côté app,
        // le serveur ne fait que répliquer (aucun effet métier ici, I7).
        if (req.method === "GET") {
          const payload = { prefs: subjectPrefs.list().slice(0, SUBJECT_PREFS_MAX_COUNT) };
          return json(isSubjectPrefsResponse(payload), payload);
        }
        let body: unknown;
        try {
          const text = await req.text();
          // Corps borné avant parse : prefs = 4 champs, pas d'entrée arbitraire.
          if (text.length > SUBJECT_PREFS_MAX_BODY_CHARS) return apiError("bad_request", "invalid body");
          body = JSON.parse(text);
        } catch {
          return apiError("bad_request", "invalid JSON body");
        }
        // 400 sans jamais répliquer l'input dans le message.
        if (!isSubjectPrefs(body)) return apiError("bad_request", "invalid subject prefs");
        try {
          subjectPrefs.upsert(body);
        } catch {
          return apiError("bad_request", "subject prefs rejected");
        }
        return json(isSubjectPrefs(body), body);
      }

      // #78 : compétences fournies = chips + détail. Store sans évaluations
      // (ou établissement sans l'onglet) = trois listes vides, état propre.
      case "/v1/evaluations": {
        const evaluations = store.evaluations?.() ?? [];
        const payload = {
          skills: buildSkills(evaluations),
          evaluations,
          summary: buildCompetenceSummary(evaluations),
        };
        return json(isEvaluationsResponse(payload), payload);
      }

      case "/v1/news": {
        // #79 : onglet Actualités. Store sans table actus = liste vide (200).
        const payload = { news: store.news?.() ?? [] };
        return json(isNewsResponse(payload), payload);
      }

      // #81 : menus cantine de la fenêtre from/to (optionnels, défaut semaine
      // courante côté app). Fenêtre bornée en longueur puis validée ISO : date
      // illisible = 400, jamais de date devinée. Aucun menu = [] (onglet masqué).
      case "/v1/menus": {
        // #75 : fenêtre ISO mutualisée avec /v1/menus (borne + validation).
        const win = dateWindow(url);
        if (win === null) return apiError("bad_request", "invalid date window");
        const all = store.canteenMenus?.(win) ?? [];
        const from = win.from === undefined ? null : Date.parse(win.from);
        const to = win.to === undefined ? null : Date.parse(win.to);
        const menus = all.filter((m) => {
          const d = Date.parse(m.date);
          if (Number.isNaN(d)) return false;
          return (from === null || d >= from) && (to === null || d <= to);
        });
        const balance = store.canteenBalance?.() ?? undefined;
        const payload = balance === undefined ? { menus } : { menus, balance };
        return json(isCanteenMenusResponse(payload), payload);
      }

      // #77 vie scolaire : absences + retards unifiés (kind) + compteurs dérivés
      // par période. Store sans vie scolaire = listes vides (onglet masqué).
      // periodId reflété dans la réponse : entrée utilisateur bornée en amont.
      case "/v1/attendance": {
        const rawPeriod = (url.searchParams.get("periodId") ?? "").trim().slice(0, PERIOD_ID_MAX_CHARS);
        const periodId = rawPeriod === "" ? null : rawPeriod;
        const all = store.absences?.() ?? [];
        const absences = periodId === null ? all : all.filter((a) => a.periodId === periodId);
        const payload = { absences, periods: attendancePeriods(absences, store.periods()) };
        return json(isAttendanceResponse(payload), payload);
      }

      case "/v1/punishments": {
        const payload = { punishments: store.punishments?.() ?? [] };
        return json(isPunishmentsResponse(payload), payload);
      }


      // #82 : écran Profil. Store sans infos = `user: null` (état vide propre),
      // jamais de nom ni de photo d'exemple. Périodes : /v1/periods (#74).
      case "/v1/me": {
        const payload = { user: store.userInfo?.() ?? null };
        return json(isMeResponse(payload), payload);
      }

      // #82/#84 : proxy média (photo de profil, PJ). Réf opaque bornée, refusée
      // si elle ressemble à une adresse ; octets streamés par le serveur, donc
      // aucune URL Pronote ne sort côté app (I1). Sans proxy injecté = 501.
      // ponytail: aucune vérification de token ici — l'auth du device n'est
      // encore appliquée sur AUCUNE route (voir createHandler) ; /v1/media
      // n'ouvre pas un trou nouveau, il hérite du même poste.
      // Upgrade: exiger le token appairé sur /v1/me et /v1/media.
      default:
        return apiError("not_found", `unknown path ${path}`);
    }
  };
}

export function serve(
  store: ReadStore,
  port = 0,
  pairing?: PairingService,
  llm?: LLMProvider | null,
  revisions?: RevisionListStore,
  subjectPrefs?: SubjectPrefsStore,
  // #75 : toggle "fait" (écriture confirmée par l'app) + proxy média.
  assignmentActions?: AssignmentActions | null,
  media?: MediaResolver | MediaActions | null,
) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: createHandler(
      store,
      pairing ?? new PairingService(),
      llm ?? null,
      revisions ?? createRevisionMemoryStore(),
      subjectPrefs ?? createSubjectPrefsMemoryStore(),
      assignmentActions ?? null,
      media ?? null,
    ),
  });
}
