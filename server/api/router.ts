// API v0 — routeur HTTP stdlib Bun.serve (issues #10, #12, ADR-001 : pas de
// framework sans besoin justifié). Routes = shared/contracts API_ROUTES,
// payloads validés par les garde-fous is* avant envoi (500 typée sinon).
// Appairage câblé sur PairingService (QR = payload {sessionId, code}).
// Auth : une porte d'entrée unique laisse ouvertes les 3 routes qui servent à
// OBTENIR un credential (appairage) + la sonde /v1/health (OPEN_WITHOUT_DEVICE) ;
// TOUTE autre route exige le bearer d'un device appairé, et le compte servi est
// résolu côté serveur (servedAccountId), jamais celui réclamé par le client.
// SSE = snapshot SyncCompleted puis connexion tenue (live : phase 5).

import {
  API_ROUTES,
  SUBJECT_PREFS_MAX_BODY_CHARS,
  isAssignmentsResponse,
  isAttendanceResponse,
  isCapabilitiesResponse,
  isPunishmentsResponse,

  isCanteenMenusResponse,
  isDiscussionMessagesResponse,
  isDiscussionRecipientsResponse,
  isDiscussionsResponse,
  isGradesResponse,
  isMeResponse,
  isNewsResponse,
  MEDIA_REF_MAX_CHARS,
  isPairingConfirmRequest,
  isPairingConfirmResponse,
  isPairingStartRequest,
  isPairingStartResponse,
  isPeriodsResponse,
  isRevisionSheetsResponse,
  isSecurityAlertsResponse,
  isSetupRequest,
  isSetupResponse,
  isSubjectPrefsResponse,
  isTimetableResponse,
} from "../../shared/contracts/api";
import type { PairingConfirmResponse, SetupResponse } from "../../shared/contracts/api";
import { CONTRACTS_VERSION, DEFAULT_AVERAGE_ALGORITHM, DISCUSSION_ID_MAX_CHARS, isAverageAlgorithm, isNewsItem, isSubjectPrefs, isTimetableEntry, SUBJECT_PREFS_MAX_COUNT, TIMETABLE_WEEK_MAX_SPAN_DAYS } from "../../shared/contracts/models";
import type { ContractEvent, NewsUpdatedData, SyncCompletedData, TimetableUpdatedData } from "../../shared/contracts/events";
import { apiError } from "./errors";
import { computeAverages, providedAveragesFor } from "../domain/averages";
import { attendancePeriods } from "../domain/attendance";
import { handleHomeworkGenerate } from "./homework";
import type { AssignmentActions, MediaActions } from "./assignments";
import { handleAssignmentsToggle } from "./assignments";
import type { SyncRefreshActions } from "./sync-refresh";
import { handleSyncRefresh } from "./sync-refresh";

import type { DiscussionActions } from "./discussions";
import { handleDiscussionWrite } from "./discussions";
import { PairingService } from "./pairing";
import type { SetupFailure, SetupService } from "./setup";
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
 * L'app n'a jamais d'adresse Pronote (I1, règle d'or média) : elle appelle
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
 * Date de fenêtre : ISO 8601 STRICT ou rien. `Date.parse` est lenient
 * (« 12 » -> 2001-12-01, du junk collé à une date valide passe encore) : sans
 * ce garde-fou le serveur devine une fenêtre et le client croit sa liste vide.
 * Formes acceptées : `AAAA-MM-JJ`, `…THH:MM[:SS[.mmm]]` avec `Z` ou ±HH:MM.
 */
const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})?)?$/;

/**
 * Paramètre de date de fenêtre (`from`, `to`, `weekStart`).
 * - `null` = absent ou vide -> AUCUNE borne (comportement inchangé) ;
 * - chaîne = ISO valide, reflétée telle quelle ;
 * - `undefined` = valeur invalide -> 400 chez l'appelant, jamais de date devinée.
 */
function isoDateParam(raw: string | null): string | null | undefined {
  if (raw === null) return null;
  const t = raw.trim();
  if (t === "") return null;
  if (t.length > DATE_MAX_CHARS) return undefined;
  if (!ISO_DATE_RE.test(t) || Number.isNaN(Date.parse(t))) return undefined;
  return t;
}

/**
 * Fenêtre from/to du routeur (bornée en longueur puis validée ISO ; paramètre
 * absent = pas de borne). Renvoie null = 400 (jamais de date devinée).
 * Partagée par /v1/assignments (#75, + weekStart) et /v1/menus (#81).
 */
function dateWindow(url: URL): { from?: string; to?: string } | null {
  const out: { from?: string; to?: string } = {};
  for (const key of ["from", "to"] as const) {
    const t = isoDateParam(url.searchParams.get(key));
    if (t === undefined) return null;
    if (t !== null) out[key] = t;
  }
  return out;
}

/**
 * #76 : fenêtre de l'EDT en millisecondes. `weekStart` = un jour quelconque de
 * la semaine demandée -> lundi 00:00 UTC → dimanche 23:59:59.999 UTC (borne
 * EXPLICITE en UTC : l'offset de fuseau implicite est le bug connu de l'onglet
 * EDT Papillon, on ne le reproduit pas). Sans weekStart, from/to borment la
 * fenêtre (parse ISO + longueur bornée). Sans paramètre = aucune fenêtre.
 * Renvoie null = 400, sans jamais répliquer l'input ni deviner une date.
 */
function timetableWindow(url: URL): { fromMs?: number; toMs?: number } | null {
  const weekStart = isoDateParam(url.searchParams.get("weekStart"));
  if (weekStart === undefined) return null;
  const win = dateWindow(url);
  if (win === null) return null;
  if (weekStart !== null) {
    const parsed = Date.parse(weekStart);
    const d = new Date(parsed);
    const midnight = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    // getUTCDay() = 0 le dimanche -> décalage vers le lundi de la même semaine.
    const monday = midnight - ((d.getUTCDay() + 6) % 7) * 86400000;
    return { fromMs: monday, toMs: monday + 7 * 86400000 - 1 };
  }
  const fromMs = win.from === undefined ? undefined : Date.parse(win.from);
  const toMs = win.to === undefined ? undefined : Date.parse(win.to);
  // Fenêtre libre bornée en amplitude (une semaine par défaut, 14 jours maxi) :
  // au-delà, 400 plutôt qu'un payload géant.
  if (fromMs !== undefined && toMs !== undefined && toMs - fromMs > TIMETABLE_WEEK_MAX_SPAN_DAYS * 86400000) {
    return null;
  }
  return { fromMs, toMs };
}


/** #75 : bornes ISO de la semaine demandée (weekStart lundi → dimanche). */
function assignmentWeek(url: URL): { from?: string; to?: string } | null {
  const win = dateWindow(url);
  if (win === null) return null;
  const day = isoDateParam(url.searchParams.get("weekStart"));
  if (day === undefined) return null;
  if (day === null) return win;
  const start = Date.parse(day);
  // 7 jours pleins : l'app passe le lundi, la borne haute couvre dimanche soir.
  const end = new Date(start + 7 * 86400000 - 1);
  return { from: new Date(start).toISOString(), to: end.toISOString() };
}

/**
 * Corps JSON borné AVANT le parse (comme les autres routes d'écriture) : un
 * corps géant est refusé sans être bufferisé ni validé. Un retour `Response`
 * = erreur typée à renvoyer telle quelle.
 */
async function boundedJson(req: Request, max: number): Promise<unknown | Response> {
  let text: string;
  try {
    text = await req.text();
  } catch {
    return apiError("bad_request", "invalid JSON body");
  }
  if (text.length > max) return apiError("bad_request", "invalid body");
  try {
    return JSON.parse(text);
  } catch {
    return apiError("bad_request", "invalid JSON body");
  }
}

/** Corps d'appairage : {deviceName} ou {sessionId, code}, quelques centaines de caractères suffisent. */
const PAIRING_MAX_BODY_CHARS = 1024;

/**
 * Routes ouvertes SANS credential : celles qui servent à OBTENIR un credential
 * (appairage) et la sonde de vivacité. Tout le reste — lectures ET écritures —
 * exige un device appairé.
 * ponytail: une liste blanche de 3 chemins plutôt qu'une blacklist de 30 :
 * une route ajoutée à API_ROUTES est fermée par DÉFAUT, pas ouverte par oubli.
 */
const OPEN_WITHOUT_DEVICE: ReadonlySet<string> = new Set([
  "/v1/health",
  "/v1/pairing/start",
  "/v1/pairing/confirm",
  // #118 : obtenir un credential ET la session école d'un coup. Comme
  // l'appairage, c'est une porte d'entrée sans jeton — donc fermée par
  // construction : elle n'accepte que ce qu'un utilisateur SAIT de son
  // établissement (URL publique, identifiants ou QR), jamais un pouvoir sur
  // les données d'un compte déjà appairé.
  "/v1/setup",
]);

/**
 * #118 : corps de setup — des identifiants et un QR chiffré, quelques centaines
 * d'octets. Borné avant parse comme l'appairage (route ouverte : autant ne pas
 * bufferiser un corps arbitraire).
 */
const SETUP_MAX_BODY_CHARS = 4096;

/**
 * Rejet de setup → code d'erreur typé. Volontairement jamais 401 : un 401
 * ferait déconnecter l'app alors que le problème est la saisie de l'utilisateur,
 * qui doit pouvoir corriger sur place (`qr_rejected`, `login_refused`).
 */
function setupError(failure: SetupFailure): Response {
  switch (failure) {
    case "unavailable":
      return apiError("not_implemented", "setup non branche (aucune session Pronote)");
    case "bad_url":
      return apiError("bad_request", "adresse d'etablissement refusee");
    case "throttled":
      return apiError("rate_limited", "trop de tentatives, reessayez plus tard");
    case "qr_rejected":
      return apiError("qr_rejected", "QR refuse par l'etablissement");
    case "login_refused":
      return apiError("login_refused", "identifiants refuses");
    case "school_unreachable":
      return apiError("school_unreachable", "Pronote injoignable");
  }
}

/**
 * Jeton d'appareil appairé exigé sur TOUTE route hors `OPEN_WITHOUT_DEVICE`
 * (donc sur les lectures comme sur les écritures) :
 * `Authorization: Bearer <token d'appareil>`.
 * `verifyDeviceToken` compare en temps constant ; le refus ne dit JAMAIS pourquoi
 * (inexistant / expiré / révoqué / format inconnu = un seul 401, un seul
 * message, `WWW-Authenticate`).
 * Renvoie la réponse 401 à renvoyer, ou `null` si le jeton est valide.
 */
function requireDevice(req: Request, pairing: PairingService): Response | null {
  const m = /^Bearer[ \t]+(\S+)$/i.exec((req.headers.get("authorization") ?? "").trim());
  const token = m?.[1];
  if (token === undefined || pairing.verifyDeviceToken(token) === null) {
    return apiError("unauthorized", "jeton d'appareil invalide");
  }
  return null;
}

/**
 * Compte RÉELLEMENT servi, résolu côté serveur : l'`accountId` transporté par
 * le client n'est qu'un indice (comme `resolveAccountId` côté intégration), le
 * prendre pour une identité ouvrait la session d'un compte qu'il n'a pas
 * appairé. `null` = serveur mono-compte : le proxy média résout la session
 * appairée unique (accountId vide).
 */
function servedAccountId(store: ReadStore): string | null {
  return (
    store.userInfo?.()?.accountId ??
    store.capabilities?.()?.accountId ??
    store.grades()[0]?.accountId ??
    store.assignments()[0]?.accountId ??
    null
  );
}

function json(valid: boolean, payload: unknown): Response {
  if (!valid) return apiError("internal", "invalid payload");
  return Response.json(payload);
}

function sse(events: ContractEvent | ContractEvent[]): Response {
  const list = Array.isArray(events) ? events : [events];
  const line = list.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("");
  // #87 : le flux est un SNAPSHOT BORNÉ : une seule écriture puis fermeture.
  // Avant, la réponse restait ouverte sans jamais rien émettre (connexion tenue
  // pour rien). L'app reconnecte avec son backoff et recharge ce qu'il faut ;
  // c'est aussi ce qui évite une fuite de payload sur un flux « vivant ».
  // ponytail: pas de bus d'événements en mémoire (fan-out par device). Upgrade:
  // file d'événements par accountId + Last-Event-ID.
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(line));
      controller.close();
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
  // #87 : relecture synchrone pour le pull-refresh (POST /v1/sync/refresh).
  // Absente par défaut = 501 honnête, aucun appelant existant cassé (8e
  // paramètre ; le câblage réel reste au démarrage du serveur).
  syncRefresh: SyncRefreshActions | null = null,

  // #80 : écritures de messagerie (create/reply/read-state/delete) = actions APP
  // CONFIRMÉES (I7). Absent par défaut = 501 honnête, jamais un faux succès.
  discussionActions: DiscussionActions | null = null,
  // #118 : POST /v1/setup (compte école + jeton en un appel). Absent par défaut
  // = 501 honnête, comme les autres ports non branchés (10e paramètre, aucun
  // appelant existant cassé).
  setup: SetupService | null = null,
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    try {
      const url = new URL(req.url);
      const path = url.pathname;
      const download = mediaResolver(media);
      // Une path peut porter GET + PUT (#83) : on matche path puis méthode,
      // sinon 405 sur la mauvaise méthode au lieu de 404/405 incohérent.
      const routes = API_ROUTES.filter((r) => r.path === path);
      if (routes.length === 0) return apiError("not_found", `unknown path ${path}`);
      // HEAD est obligatoire partout où GET existe (RFC 9110 §9.3.2) : sondes de
      // disponibilité et de taille de contenu (pdf, média). Il rejoue le GET et
      // rend le même statut + les mêmes en-têtes, SANS corps. API_ROUTES ne
      // déclare que GET/POST/PUT : aucune route n'annonce HEAD en propre.
      const isHead = req.method === "HEAD" && routes.some((r) => r.method === "GET");
      const method = isHead ? "GET" : req.method;
      if (!routes.some((r) => r.method === method)) {
        // 405 = en-tête Allow obligatoire (RFC 9110 §15.5.6) : sans lui le client
        // ne sait pas quelles méthodes la route accepte.
        return apiError("method_not_allowed", `${req.method} not allowed on ${path}`, {
          allow: routes.map((r) => r.method).join(", "),
        });
      }
      const res = await dispatch(req, url, path, method, download);
      return isHead ? new Response(null, { status: res.status, headers: res.headers }) : res;
    } catch {
      // Aucun THROW ne sort du handler (URL illisible, store qui lève, port qui
      // jette) : une promesse rejetée = socket cassée sans corps d'erreur typé.
      // I6 : le client reçoit un 500 structuré, le message interne ne sort JAMAIS.
      return apiError("internal", "unexpected failure");
    }
  };

  async function dispatch(
    req: Request,
    url: URL,
    path: string,
    method: string,
    download: MediaResolver | null,
  ): Promise<Response> {
    // Porte d'entrée unique : rien n'est lu (ni body, ni store, ni port) sur
    // une route fermée sans jeton d'un device appairé.
    if (!OPEN_WITHOUT_DEVICE.has(path)) {
      const refuse = requireDevice(req, pairing);
      if (refuse !== null) return refuse;
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
            provided: providedAveragesFor(store.providedAverages(), periodId),
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
      // Écriture = PRONOTE touché : le jeton d'un device appairé est exigé par
      // la porte d'entrée (avant même la lecture du corps).
      case "/v1/assignments/toggle": {
        return handleAssignmentsToggle(req, assignmentActions, servedAccountId(store) ?? "");
      }
      // #75 : proxy des pièces jointes (ref opaque → octets). Jamais d'URL
      // Pronote dans l'app (I1), jamais de WebView distante.
      case "/v1/media": {
        // Lecture des données d'un compte appairé : jeton exigé (porte
        // d'entrée) et le compte est résolu côté SERVEUR (servedAccountId /
        // session appairée du proxy). L'`accountId` de la query est IGNORÉ :
        // le prendre pour une identité ouvrait la session d'un autre compte
        // appairé.
        const ref = (url.searchParams.get("ref") ?? "").trim();
        if (!isMediaRef(ref)) return apiError("bad_request", "invalid media ref");
        if (!download) return apiError("not_implemented", "media proxy absent");
        let file: MediaPayload;
        try {
          file = await download(servedAccountId(store) ?? "", ref);
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
        // #76 : fenêtre weekStart (semaine) ou from/to, bornees et valides.
        // Date d'entrée illisible = 400 sans répliquer l'input ; aucune fenêtre
        // demandée = tout le store (comportement 0.2.0, add-only).
        const win = timetableWindow(url);
        if (win === null) return apiError("bad_request", "invalid date window");
        const all = store.entries();
        const entries =
          win.fromMs === undefined && win.toMs === undefined
            ? all
            : all.filter((e) => {
                const t = Date.parse(e.start);
                if (Number.isNaN(t)) return false;
                return (win.fromMs === undefined || t >= win.fromMs) && (win.toMs === undefined || t <= win.toMs);
              });
        const payload = { entries };
        return json(isTimetableResponse(payload), payload);
      }
      case "/v1/security/alerts": {
        const payload = { alerts: store.securityAlerts() };
        return json(isSecurityAlertsResponse(payload), payload);
      }
      case "/v1/events": {
        const data: SyncCompletedData = {
          // Le compte RÉELLEMENT servi, jamais la constante de seed du module :
          // attribuer les données de tout compte à « seed-acc » faisait
          // purger/recharger le mauvais cache côté app.
          accountId: servedAccountId(store) ?? "compte-inconnu",
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
        // #76 : meme principe pour l'EDT — TimetableUpdated existe deja dans le
        // contrat, on le re-emet (pas de doublon d'evenement ni de type novel).
        const timetableEvent: ContractEvent<"TimetableUpdated", TimetableUpdatedData> = {
          v: CONTRACTS_VERSION,
          type: "TimetableUpdated",
          at: new Date().toISOString(),
          data: { entries: store.entries().filter(isTimetableEntry) },
        };
        return sse([event, newsEvent, timetableEvent]);
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
        // Corps borné AVANT parse comme les autres routes d'écriture : /start
        // est ouverte (le device n'est pas appairé) donc c'est la seule porte
        // d'entrée sans jeton, autant ne pas y bufferiser un corps arbitraire.
        const body = await boundedJson(req, PAIRING_MAX_BODY_CHARS);
        if (body instanceof Response) return body;
        if (!isPairingStartRequest(body)) return apiError("bad_request", "invalid pairing request");
        const payload = pairing.start(body.deviceName);
        return json(isPairingStartResponse(payload), payload);
      }
      case "/v1/pairing/confirm": {
        const body = await boundedJson(req, PAIRING_MAX_BODY_CHARS);
        if (body instanceof Response) return body;
        if (!isPairingConfirmRequest(body)) return apiError("bad_request", "invalid pairing request");
        const res = pairing.confirm(body.sessionId, body.code);
        // Échecs d'appairage INDISTINGUABLES : un seul 401 « unauthorized », un
        // seul message. Distinguer session inexistante / expirée / verrouillée /
        // PIN faux = oracle d'existence de session + fuite des tentatives
        // restantes. Les nuances restent dans `PairingFailure` (usage interne).
        if (!res.ok) return apiError("unauthorized", "pairing refused");
        // Le secret sort ICI, UNE SEULE FOIS dans toute l'API : c'est la seule
        // réponse qui le porte (aucune autre route ne le rend, jamais en erreur,
        // jamais dans un log). Le client s'en sert comme bearer.
        const payload: PairingConfirmResponse = { device: res.device, token: res.token };
        return json(isPairingConfirmResponse(payload), payload);
      }
      case "/v1/setup": {
        if (!setup) return setupError("unavailable");
        const body = await boundedJson(req, SETUP_MAX_BODY_CHARS);
        if (body instanceof Response) return body;
        if (!isSetupRequest(body)) return apiError("bad_request", "invalid setup request");
        const res = await setup.run(body);
        // Échecs = codes ACTIONNABLES (rescan, corrige, réessaie) : jamais le
        // 401 indifférencié de l'appairage, qui déconnecterait l'app.
        if (!res.ok) return setupError(res.failure);
        // Le secret sort ICI, UNE SEULE FOIS dans toute l'API : c'est la seule
        // réponse qui le porte (aucune autre route ne le rend, jamais en erreur,
        // jamais dans un log). Le client s'en sert comme bearer.
        const payload: SetupResponse = { device: res.device, token: res.token };
        return json(isSetupResponse(payload), payload);
      }
      case "/v1/homework/generate": {
        return handleHomeworkGenerate(req, llm);
      }
      case "/v1/subjects/prefs": {
        // #83 : préférences matière (couleur/emoji/libellé), clé = nom de matière.
        // GET = liste bornée, PUT = upsert d'une matière. Le local gagne côté app,
        // le serveur ne fait que répliquer (aucun effet métier ici, I7).
        if (method === "GET") {
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
      // Auth : le jeton d'un device appairé est exigé par la porte d'entrée
      // (OPEN_WITHOUT_DEVICE), comme sur TOUTE autre route.

      // #87 : capacités dynamiques (onglets Pronote actifs). Store sans
      // détection = `capabilities: null` (l'app garde son affichage), jamais
      // une erreur et jamais un onglet deviné actif.
      case "/v1/capabilities": {
        const payload = { capabilities: store.capabilities?.() ?? null };
        return json(isCapabilitiesResponse(payload), payload);
      }

      // #87 : pull-refresh manuel (app -> serveur -> Pronote). Relecture bornée
      // via le moteur de sync, événements de types EXISTANTS uniquement (I7 :
      // aucune sortie LLM sur ce chemin). Sans relecture branchée = 501 franc.
      case "/v1/sync/refresh": {
        return handleSyncRefresh(req, syncRefresh, servedAccountId(store) ?? "");
      }



      // #80 : messagerie (parité Papillon, onglet Discussions).
      // Lectures pures : store sans fils = listes VIDES (onglet inactif côté
      // établissement), jamais 500. `id` borné en amont (entrée utilisateur).
      // Écritures : une route POST par action, geste APP CONFIRMÉ (I7).
      case "/v1/discussions": {
        if (method === "GET") {
          const payload = { discussions: store.discussions?.() ?? [] };
          return json(isDiscussionsResponse(payload), payload);
        }
        return handleDiscussionWrite(req, discussionActions, "create", servedAccountId(store) ?? "");
      }
      case "/v1/discussions/messages": {
        const id = (url.searchParams.get("id") ?? "").trim().slice(0, DISCUSSION_ID_MAX_CHARS);
        // Un id de fil est un jeton opaque : `toString`, `__proto__`,
        // `constructor`… ne sont jamais des ids et ne doivent surtout pas
        // résoudre dans une table indexée par objet côté store (une fonction
        // remontée là se fait structuredCloner en DataCloneError). 400 typé.
        if (id === "" || id in Object.prototype) return apiError("bad_request", "invalid discussion id");
        const payload = { messages: store.discussionMessages?.(id) ?? [] };
        return json(isDiscussionMessagesResponse(payload), payload);
      }
      case "/v1/discussions/recipients": {
        const payload = { recipients: store.discussionRecipients?.() ?? [] };
        return json(isDiscussionRecipientsResponse(payload), payload);
      }
      case "/v1/discussions/reply": {
        return handleDiscussionWrite(req, discussionActions, "reply", servedAccountId(store) ?? "");
      }
      case "/v1/discussions/read-state": {
        return handleDiscussionWrite(req, discussionActions, "read-state", servedAccountId(store) ?? "");
      }
      case "/v1/discussions/delete": {
        return handleDiscussionWrite(req, discussionActions, "delete", servedAccountId(store) ?? "");
      }
      default:
        return apiError("not_found", `unknown path ${path}`);
    }
  }
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
  syncRefresh?: SyncRefreshActions | null,

  // #80 : écritures de messagerie confirmées par l'app (I7).
  discussionActions?: DiscussionActions | null,
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
      syncRefresh ?? null,

      discussionActions ?? null,
    ),
  });
}
