// Écritures messagerie #80 : create / reply / read-state / delete.
// I7 BLOQUANT : ces 4 actions sont des ÉCRITURES vers Pronote. Elles ne sont
// atteignables que par ces routes POST, donc par une action APP CONFIRMÉE.
// Le test I7 (tests/unit/discussions.test.ts) prouve qu'aucun symbole d'écriture
// de messagerie n'est atteignable depuis le module IA, et que ce handler ne
// dépend d'aucun fournisseur de génération de texte.
// Corps BORNÉ AVANT parse, validation par is*Request, erreurs typées (jamais de
// message brut ni d'input reflété) : même discipline que le toggle #75.
import {
  DISCUSSION_MAX_BODY_CHARS,
  isDiscussionActionResponse,
  isDiscussionsCreateRequest,
  isDiscussionsDeleteRequest,
  isDiscussionsReadStateRequest,
  isDiscussionsReplyRequest,
} from "../../shared/contracts/api";
import type { DiscussionActionResponse } from "../../shared/contracts/api";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import type { CacheInvalidatedData, ContractEvent } from "../../shared/contracts/events";
import { PronoteWriteError } from "../domain/ports";
import { apiError } from "./errors";

/**
 * Port d'action côté API, SÉPARÉ des lectures (PronoteReader n'expose aucune
 * écriture). Implémenté par le reader Pronote via la session SSO serveur.
 * `accountId` vide = serveur mono-compte (session appairée résolue côté intégr.).
 */
export interface DiscussionActions {
  createDiscussion(accountId: string, subject: string, body: string, recipientIds: string[]): Promise<void>;
  replyToDiscussion(accountId: string, discussionId: string, body: string): Promise<void>;
  setDiscussionRead(accountId: string, discussionId: string, read: boolean): Promise<void>;
  deleteDiscussion(accountId: string, discussionId: string): Promise<void>;
}

/** Une route d'écriture par action : aucune action implicite, aucune combinaison. */
export type DiscussionWriteKind = "create" | "reply" | "read-state" | "delete";

/**
 * Invalidation : l'événement EXISTANT CacheInvalidated (resource discussions).
 * Aucun type d'événement nouveau (EVENT_TYPES est une liste fermée) et aucun
 * push : la messagerie ne déclenche aucune notification.
 */
function invalidationEvent(at: string): ContractEvent<"CacheInvalidated", CacheInvalidatedData> {
  return {
    v: CONTRACTS_VERSION,
    type: "CacheInvalidated",
    at,
    data: { resource: "discussions", reason: "manual" },
  };
}

/** Erreurs typées → HTTP. Jamais le message Pronote (secret/détail interne). */
function writeError(err: unknown, kind: DiscussionWriteKind): Response {
  if (err instanceof PronoteWriteError) {
    if (err.code === "unsupported") return apiError("not_implemented", "action messagerie non supportée");
    if (err.code === "session_expired") return apiError("unauthorized", "session expirée");
    if (err.code === "not_found") {
      // Fil fermé = 409 aussi (pas d'action possible sur ce fil).
      return kind === "create" ? apiError("conflict", "destinataire inconnu") : apiError("conflict", "discussion indisponible");
    }
    return apiError("internal", "action messagerie impossible");
  }
  return apiError("internal", "action messagerie impossible");
}

/**
 * POST /v1/discussions | /reply | /read-state | /delete — action APP confirmée
 * (I7). Sortie : `{ ok, event }` ; `ok` seul ne prouve rien côté client, l'événement
 * porte l'invalidation de cache (même démarche que le toggle #75).
 * ponytail: un seul handler paramétré par `kind` plutôt que 4 handlers : une
 * seule implémentation de la discipline (bornes, validation, erreurs typées).
 */
export async function handleDiscussionWrite(
  req: Request,
  actions: DiscussionActions | null,
  kind: DiscussionWriteKind,
  at: string = new Date().toISOString(),
): Promise<Response> {
  // Écriture indisponible (aucun adaptateur injecté, ou adaptateur sans cette
  // action) : erreur franche 501, jamais un faux succès.
  const method: keyof DiscussionActions | null =
    actions === null
      ? null
      : kind === "create"
        ? "createDiscussion"
        : kind === "reply"
          ? "replyToDiscussion"
          : kind === "read-state"
            ? "setDiscussionRead"
            : "deleteDiscussion";
  if (!actions || method === null || typeof actions[method] !== "function") {
    return apiError("not_implemented", "action messagerie non supportée");
  }
  let body: unknown;
  try {
    const text = await req.text();
    // Corps borné AVANT parse : sujet + 4000 caractères de message + ids.
    if (text.length > DISCUSSION_MAX_BODY_CHARS) return apiError("bad_request", "invalid discussion request");
    body = JSON.parse(text);
  } catch {
    return apiError("bad_request", "invalid JSON body");
  }
  try {
    switch (kind) {
      case "create": {
        if (!isDiscussionsCreateRequest(body)) return apiError("bad_request", "invalid discussion request");
        await actions.createDiscussion(body.accountId ?? "", body.subject, body.body, body.recipientIds);
        break;
      }
      case "reply": {
        if (!isDiscussionsReplyRequest(body)) return apiError("bad_request", "invalid discussion request");
        await actions.replyToDiscussion(body.accountId ?? "", body.discussionId, body.body);
        break;
      }
      case "read-state": {
        if (!isDiscussionsReadStateRequest(body)) return apiError("bad_request", "invalid discussion request");
        await actions.setDiscussionRead(body.accountId ?? "", body.discussionId, body.read);
        break;
      }
      case "delete": {
        if (!isDiscussionsDeleteRequest(body)) return apiError("bad_request", "invalid discussion request");
        await actions.deleteDiscussion(body.accountId ?? "", body.discussionId);
        break;
      }
    }
  } catch (err) {
    return writeError(err, kind);
  }
  const payload: DiscussionActionResponse = { ok: true, event: invalidationEvent(at) };
  if (!isDiscussionActionResponse(payload)) return apiError("internal", "invalid payload");
  return Response.json(payload);
}