// Règle de session du web : faut-il encore renvoyer l'utilisateur vers
// l'écran d'appairage ? Le statut vient du natif (lu au démarrage) ; une
// session ouverte dans l'app (appairage réussi) le rend périmé — sans cela,
// l'app renverrait vers /pairing alors que la session native est ouverte et
// il faudrait redémarrer l'application pour sortir (#357).

import type { SessionStatus } from "../bridge/types";

export interface SessionView {
  /** Statut renvoyé par le natif (`null` = il n'a pas encore répondu). */
  status: SessionStatus | null;
  /** Une session a été ouverte dans l'app (appairage réussi). */
  open: boolean;
  /** Le natif a répondu 401 (session expirée). */
  expired: boolean;
}

export function mustPair(view: SessionView): boolean {
  // Une session ouverte prime sur tout : le statut lu au démarrage est
  // périmé, et « session expirée » a été levé par la session précédente.
  if (view.open) return false;
  // Le natif n'a pas répondu : on ne force rien (l'app charge).
  if (!view.status) return false;
  if (view.expired) return true;
  const state = view.status.state;
  return state === "no_session" || state === "dead";
}
