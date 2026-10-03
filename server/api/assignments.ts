// Devoirs enrichis #75 : toggle "fait" + proxy de pièces jointes.
// I7 : l'écriture Pronote (`toggleAssignmentDone`) n'est atteignable que par
// cette route, donc par une action APP confirmée. Aucun appel depuis le code IA
// (le test I7 le prouve), aucun autre effet de bord.
// Règle d'or média : l'app n'a JAMAIS d'URL Pronote, elle passe une `ref` opaque
// que le serveur résout via downloadMedia (media-proxy, #84).
import {
  isAssignmentsToggleRequest,
  isAssignmentsToggleResponse,
} from "../../shared/contracts/api";
import type { AssignmentsToggleResponse } from "../../shared/contracts/api";
import { CONTRACTS_VERSION, isAssignment } from "../../shared/contracts/models";
import type { Assignment } from "../../shared/contracts/models";
import type { ContractEvent } from "../../shared/contracts/events";
import { PronoteWriteError } from "../domain/ports";
import type { MediaPayload } from "../infrastructure/media-proxy";
import { apiError } from "./errors";

/** Port d'écriture côté API : implémenté par le reader Pronote (jamais par l'IA). */
export interface AssignmentActions {
  setAssignmentDone(accountId: string, assignmentId: string, done: boolean): Promise<Assignment>;
}

/** Port média : résolution d'une `ref` opaque en octets (session SSO serveur). */
export interface MediaActions {
  download(accountId: string, ref: string): Promise<MediaPayload>;
}

/** accountId absent = serveur mono-compte résout sa session appairée (côté
 *  intégration). La valeur reste BORNÉE et jamais reflétée dans une erreur.
 */
function accountParam(raw: string | null): string {
  return (raw ?? "").trim().slice(0, 64);
}

/** Corps du toggle = 2 identifiants + 1 booléen : borné avant parse (confiance). */
const TOGGLE_MAX_BODY_CHARS = 512;

function writeError(err: unknown): Response {
  if (err instanceof PronoteWriteError) {
    // Erreurs typées, jamais de détail Pronote/secret dans le corps.
    if (err.code === "unsupported") return apiError("not_implemented", "toggle non supporté");
    if (err.code === "session_expired") return apiError("unauthorized", "session expirée");
    if (err.code === "not_found") return apiError("conflict", "devoir introuvable");
    return apiError("internal", "toggle impossible");
  }
  return apiError("internal", "toggle impossible");
}

/**
 * POST /v1/assignments/toggle — action APP confirmée (I7).
 * Renvoie le devoir à jour + l'événement `AssignmentUpdated` (type existant,
 * pas de nouveau type d'événement) pour que l'app invalide son cache.
 */
export async function handleAssignmentsToggle(
  req: Request,
  actions: AssignmentActions | null,
  at: string = new Date().toISOString(),
): Promise<Response> {
  // Écriture indisponible (adaptateur sans setDone) : erreur franche, pas de faux succès.
  if (!actions || typeof actions.setAssignmentDone !== "function") {
    return apiError("not_implemented", "toggle non supporté");
  }
  let body: unknown;
  try {
    const text = await req.text();
    if (text.length > TOGGLE_MAX_BODY_CHARS) return apiError("bad_request", "invalid toggle request");
    body = JSON.parse(text);
  } catch {
    return apiError("bad_request", "invalid JSON body");
  }
  if (!isAssignmentsToggleRequest(body)) return apiError("bad_request", "invalid toggle request");
  try {
    // accountId = INDICE borné, jamais une identité : le serveur résout son
    // compte appairé (resolveAccountId de la composition root ignore l'indice).
    const assignment = await actions.setAssignmentDone(body.accountId ?? "", body.assignmentId, body.done);
    if (!isAssignment(assignment)) return apiError("internal", "invalid payload");
    const event: ContractEvent<"AssignmentUpdated", Assignment> = {
      v: CONTRACTS_VERSION,
      type: "AssignmentUpdated",
      at,
      data: assignment,
    };
    const payload: AssignmentsToggleResponse = { assignment, event };
    // Le garde-fou contrat filtre aussi l'événement (enveloppe versionnée).
    if (!isAssignmentsToggleResponse(payload)) return apiError("internal", "invalid payload");
    return Response.json(payload);
  } catch (err) {
    return writeError(err);
  }
}
