// API v0 — routeur HTTP stdlib Bun.serve (issues #10, #12, ADR-001 : pas de
// framework sans besoin justifié). Routes = shared/contracts API_ROUTES,
// payloads validés par les garde-fous is* avant envoi (500 typée sinon).
// Appairage câblé sur PairingService (QR = payload {sessionId, code}).
// SSE = snapshot SyncCompleted puis connexion tenue (live : phase 5).

import {
  API_ROUTES,
  SUBJECT_PREFS_MAX_BODY_CHARS,
  isAssignmentsResponse,
  isGradesResponse,
  isPairingConfirmRequest,
  isPairingStartRequest,
  isPairingStartResponse,
  isPeriodsResponse,
  isRevisionSheetsResponse,
  isSecurityAlertsResponse,
  isSubjectPrefsResponse,
  isTimetableResponse,
} from "../../shared/contracts/api";
import { CONTRACTS_VERSION, DEFAULT_AVERAGE_ALGORITHM, SUBJECT_PREFS_MAX_COUNT, isAverageAlgorithm, isDevice, isSubjectPrefs } from "../../shared/contracts/models";
import type { ContractEvent, SyncCompletedData } from "../../shared/contracts/events";
import { apiError } from "./errors";
import { computeAverages } from "../domain/averages";
import { handleHomeworkGenerate } from "./homework";
import { PairingService } from "./pairing";
import { renderRevisionPdf } from "../jobs/revision";
import type { RevisionListStore } from "./revision";
import { createRevisionMemoryStore } from "./revision";
import type { ReadStore } from "./store";
import type { SubjectPrefsStore } from "./subject-prefs";
import { createSubjectPrefsMemoryStore } from "./subject-prefs";
import type { LLMProvider } from "../domain/ports";

/** Longueur max d'un periodId reflété dans la réponse (borne d'entrée utilisateur). */
const PERIOD_ID_MAX_CHARS = 64;

function json(valid: boolean, payload: unknown): Response {
  if (!valid) return apiError("internal", "invalid payload");
  return Response.json(payload);
}

function sse(event: ContractEvent): Response {
  const line = `data: ${JSON.stringify(event)}\n\n`;
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
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const url = new URL(req.url);
    const path = url.pathname;
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
        const payload = { assignments: store.assignments() };
        return json(isAssignmentsResponse(payload), payload);
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
        return sse(event);
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
    ),
  });
}
