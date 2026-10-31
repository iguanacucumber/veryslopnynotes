// Statut de session : une session ouverte ou fermée dans l'app rend périmé le
// statut lu au démarrage — sinon retour à /pairing à tort, ou accueil d'un
// compte déconnecté.

import type { SessionStatus } from "../bridge/types";

/** Le natif publie l'ÉTAT (`storage`), pas la phrase : la copie vit ici. Le
 *  repli mémoire reste la règle côté natif (jamais un secret en clair). */
export const STORAGE_UNAVAILABLE_MESSAGE =
  "Stockage chiffré indisponible : tes identifiants ne sont pas conservés sur cet appareil. Déverrouille ton téléphone et réessaie.";

export function storageUnavailable(status: SessionStatus | null): boolean {
  return status?.storage === "unavailable";
}

export interface SessionView {
  /** `null` = le natif n'a pas encore répondu. */
  status: SessionStatus | null;
  open: boolean;
  expired: boolean;
  closed: boolean;
}

export function mustPair(view: SessionView): boolean {
  // Session fermée : le natif a purgé les caches, le statut lu au démarrage
  // est périmé.
  if (view.closed) return true;
  // Une session ouverte prime sur le statut périmé et sur « expirée ».
  if (view.open) return false;
  // Le natif n'a pas répondu : on ne force rien (l'app charge).
  if (!view.status) return false;
  if (view.expired) return true;
  const state = view.status.state;
  return state === "no_session" || state === "dead";
}

/** La fermeture n'a lieu qu'après un logout RÉUSSI : sinon l'app enverrait
 *  vers l'appairage alors que le compte est encore connecté. */
export async function logoutSession(deps: {
  logout: () => Promise<unknown>;
  closeSession: () => void;
}): Promise<void> {
  await deps.logout();
  deps.closeSession();
}
