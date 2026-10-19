// Règle de session du web : faut-il encore renvoyer l'utilisateur vers
// l'écran d'appairage ? Le statut vient du natif (lu au démarrage) ; une
// session ouverte dans l'app (appairage réussi) le rend périmé — sans cela,
// l'app renverrait vers /pairing alors que la session native est ouverte et
// il faudrait redémarrer l'application pour sortir (#357).
//
// Symétrique : une déconnexion ferme la session côté interface. Le statut lu
// au démarrage disait alors « session vivante » : sans ce drapeau, l'accueil
// d'un compte déconnecté afficherait « aucune donnée en cache » pour
// toujours (#360).

import type { SessionStatus } from "../bridge/types";

/**
 * Message affiché quand le stockage CHIFFRÉ est indisponible (#401).
 *
 * Le native publie l'ÉTAT (`storage`), pas la phrase : la copie vit ici,
 * dans l'interface. Le repli mémoire reste la règle côté natif (jamais un
 * secret en clair) — ce que l'utilisateur perd, c'est la CONSERVATION.
 */
export const STORAGE_UNAVAILABLE_MESSAGE =
  "Stockage chiffré indisponible : tes identifiants ne sont pas conservés sur cet appareil. Déverrouille ton téléphone et réessaie.";

/**
 * Le stockage chiffré est-il indisponible (Keystore mort) ?
 *
 * Le natif le publie avec le statut de la session. Sans ce signal, l'app
 * croyait en silence ne pas être appairée et la clé de l'assistant
 * disparaissait sans explication (#401).
 */
export function storageUnavailable(status: SessionStatus | null): boolean {
  return status?.storage === "unavailable";
}

export interface SessionView {
  /** Statut renvoyé par le natif (`null` = il n'a pas encore répondu). */
  status: SessionStatus | null;
  /** Une session a été ouverte dans l'app (appairage réussi). */
  open: boolean;
  /** Le natif a répondu 401 (session expirée). */
  expired: boolean;
  /** L'utilisateur a déconnecté le compte (déconnexion). */
  closed: boolean;
}

export function mustPair(view: SessionView): boolean {
  // Session fermée par l'utilisateur : le natif a invalidé la session ET
  // purgé les caches, il n'y a donc plus rien à afficher. Le statut lu au
  // démarrage est périmé (« session vivante ») : sans ce drapeau, l'accueil
  // d'un compte déconnecté afficherait « aucune donnée en cache » (#360).
  if (view.closed) return true;
  // Une session ouverte prime sur tout : le statut lu au démarrage est
  // périmé, et « session expirée » a été levé par la session précédente.
  if (view.open) return false;
  // Le natif n'a pas répondu : on ne force rien (l'app charge).
  if (!view.status) return false;
  if (view.expired) return true;
  const state = view.status.state;
  return state === "no_session" || state === "dead";
}

/**
 * Déconnexion : le natif invalide la session et purge les caches, puis
 * l'interface se ferme. La fermeture n'a lieu qu'après un logout RÉUSSI : un
 * logout en échec laisse la session ouverte, sinon l'app enverrait vers
 * l'appairage alors que le compte est encore connecté (#360).
 */
export async function logoutSession(deps: {
  /** Invalidation native de la session (caches purgés). */
  logout: () => Promise<unknown>;
  /** Fermeture de la session côté interface. */
  closeSession: () => void;
}): Promise<void> {
  await deps.logout();
  deps.closeSession();
}
