// Pull-refresh (#87) : POST /v1/sync/refresh force une relecture BORNÉE via le
// reader et renvoie les événements de sync, tous de types EXISTANTS
// (GradeCreated, TimetableUpdated, SyncCompleted, CacheInvalidated) : aucun
// type d'événement novel, donc une app 0.3.0 comprend déjà la réponse.
// I7 : ce chemin ne déclenche aucun LLM — la relecture compare des données
// structurées Pronote, jamais une sortie libre.
// Différence avec POST /v1/assignments/toggle (#75) : ici il n'y a AUCUNE
// écriture Pronote, seulement une lecture; le refresh est donc déclenchable par
// l'app sans confirmation supplémentaire (c'est déjà une action utilisateur).
import {
  isSyncRefreshRequest,
  isSyncRefreshResponse,
  SYNC_REFRESH_MAX_EVENTS,
} from "../../shared/contracts/api";
import type { SyncRefreshResponse } from "../../shared/contracts/api";
import { isContractEvent } from "../../shared/contracts/events";
import type { ContractEvent } from "../../shared/contracts/events";
import { PronoteAuthError } from "../domain/ports";
import { apiError } from "./errors";

/**
 * Port de relecture : implémenté par le moteur de sync branché sur le reader
 * (runSync + détection des capacités). Volontairement structural, comme
 * `AssignmentActions` : le routeur ne connaît ni le reader ni le store.
 */
export interface SyncRefreshActions {
  /** Relecture bornée d'un compte. `accountId` est RÉSOLU CÔTÉ SERVEUR par le
   *  routeur (`servedAccountId`) ; vide = serveur mono-compte (la composition
   *  root vise le compte qu'elle a appairé). */
  refresh(accountId: string): Promise<ContractEvent[]>;
}

/** Corps optionnel : `{}` ou absent = serveur mono-compte. Borné avant parse. */
const SYNC_REFRESH_MAX_BODY_CHARS = 256;

function refreshError(err: unknown): Response {
  if (err instanceof PronoteAuthError) {
    if (err.code === "session_expired") return apiError("unauthorized", "session expirée");
    if (err.code === "timeout") return apiError("internal", "relecture trop longue");
    return apiError("internal", "relecture impossible");
  }
  return apiError("internal", "relecture impossible");
}

/**
 * POST /v1/sync/refresh — relecture immédiate, événements de sync en réponse.
 * Relecture non branchée = 501 honnête, jamais un faux succès.
 *
 * `accountId` est RÉSOLU CÔTÉ SERVEUR par le routeur : le `accountId` du corps
 * reste validé par le contrat (add-only) mais ne sert JAMAIS d'identité — le
 * refresh relit le compte appairé du serveur, pas celui demandé par l'app.
 */
export async function handleSyncRefresh(req: Request, actions: SyncRefreshActions | null, accountId = ""): Promise<Response> {
  if (!actions || typeof actions.refresh !== "function") {
    return apiError("not_implemented", "relecture non branchée");
  }
  const text = await req.text().catch(() => "");
  if (text.trim() !== "") {
    let body: unknown;
    try {
      if (text.length > SYNC_REFRESH_MAX_BODY_CHARS) return apiError("bad_request", "invalid refresh request");
      body = JSON.parse(text);
    } catch {
      return apiError("bad_request", "invalid JSON body");
    }
    // Corps toujours validé (forme + borne de l'accountId réclamé), mais la
    // valeur reste IGNORÉE : seule celle du serveur est utilisée.
    if (!isSyncRefreshRequest(body)) return apiError("bad_request", "invalid refresh request");
  }
  try {
    const raw = await actions.refresh(accountId);
    // Sortie NON contractuelle = rélecture en panne : 500 « invalid payload »,
    // jamais 200 { events: [] } (le client lirait « rien n'a changé » et
    // garderait son cache périmé).
    if (!Array.isArray(raw)) return apiError("internal", "invalid payload");
    // Borne de volume : un sync très productif ne fait pas exploser la réponse.
    // Seuls des événements CONTRACTUELS sortent (garde-fou enveloppe versionnée).
    const events = raw.slice(0, SYNC_REFRESH_MAX_EVENTS).filter(isContractEvent);
    const payload: SyncRefreshResponse = { events };
    if (!isSyncRefreshResponse(payload)) return apiError("internal", "invalid payload");
    return Response.json(payload);
  } catch (err) {
    return refreshError(err);
  }
}