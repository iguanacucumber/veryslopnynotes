// API v0 — routeur HTTP stdlib Bun.serve (issues #10, #12, ADR-001 : pas de
// framework sans besoin justifié). Routes = shared/contracts API_ROUTES,
// payloads validés par les garde-fous is* avant envoi (500 typée sinon).
// Appairage câblé sur PairingService (QR = payload {sessionId, code}).
// SSE = snapshot SyncCompleted puis connexion tenue (live : phase 5).

import {
  API_ROUTES,
  isAssignmentsResponse,
  isGradesResponse,
  isPairingConfirmRequest,
  isPairingStartRequest,
  isPairingStartResponse,
  isTimetableResponse,
} from "../../shared/contracts/api";
import { CONTRACTS_VERSION, isDevice } from "../../shared/contracts/models";
import type { ContractEvent, SyncCompletedData } from "../../shared/contracts/events";
import { apiError } from "./errors";
import { PairingService } from "./pairing";
import type { ReadStore } from "./store";

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
): (req: Request) => Promise<Response> {
  return async (req: Request): Promise<Response> => {
    const path = new URL(req.url).pathname;
    const route = API_ROUTES.find((r) => r.path === path);
    if (!route) return apiError("not_found", `unknown path ${path}`);
    if (req.method !== route.method) return apiError("method_not_allowed", `${req.method} not allowed on ${path}`);

    switch (path) {
      case "/v1/health":
        return Response.json({ status: "ok", version: CONTRACTS_VERSION });
      case "/v1/grades": {
        const payload = { grades: store.grades() };
        return json(isGradesResponse(payload), payload);
      }
      case "/v1/assignments": {
        const payload = { assignments: store.assignments() };
        return json(isAssignmentsResponse(payload), payload);
      }
      case "/v1/timetable": {
        const payload = { entries: store.entries() };
        return json(isTimetableResponse(payload), payload);
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
      default:
        return apiError("not_found", `unknown path ${path}`);
    }
  };
}

export function serve(store: ReadStore, port = 0, pairing?: PairingService) {
  return Bun.serve({
    port,
    hostname: "127.0.0.1",
    fetch: createHandler(store, pairing),
  });
}
