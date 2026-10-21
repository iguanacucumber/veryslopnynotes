// Le payload d'une ressource appartient à SA requête (#527).
//
// Changer de requête (période, algorithme, semaine) change la DONNÉE
// demandée : le payload de la requête précédente est alors INVALIDE. Le
// garder affichait les chiffres d'une autre période sous le nouveau
// sélecteur — et, si le chargement échouait, l'ancien rapport restait
// affiché indéfiniment avec la ligne d'erreur en dessous.
//
// Trois règles PURES (testables sans React, donc testables vraiment) :
//   - une requête est identifiée par sa clé et sa query ;
//   - un changement de requête vide l'état (payload, erreur, horodatage) ;
//   - la vue affichée ne montre JAMAIS le payload d'une autre requête.
//
// Le rafraîchissement d'une MÊME requête (geste « Actualiser ») ne change
// rien : le cache reste affiché pendant la relecture (offline-first).

/** Identifiant d'une requête : la clé de la ressource et sa query. */
export function requestId(key: string, query: string): string {
  // La clé ne contient jamais de « ? » : l'identifiant est donc unique et
  // n'est JAMAIS découpé — comparé pour égalité, rien d'autre.
  return `${key}?${query}`;
}

/** État interne d'une ressource : le payload est RATTACHÉ à sa requête. */
export interface ResourceStatus {
  /** Requête à laquelle appartient le payload. */
  request: string;
  payload: string | null;
  fetchedAt: number;
  stale: boolean;
  error: string | null;
  loading: boolean;
}

/** Ce que l'interface affiche : jamais le payload d'une autre requête. */
export interface ResourceView {
  payload: string | null;
  fetchedAt: number;
  stale: boolean;
  error: string | null;
  loading: boolean;
}

/** Vue d'une requête en cours : rien n'est affiché, le chargement tourne. */
const PENDING: ResourceView = {
  payload: null,
  fetchedAt: 0,
  stale: false,
  error: null,
  loading: true,
};

/**
 * Changement de requête : l'ancien payload est INVALIDE (#527).
 *
 * Même requête (geste de rafraîchissement) : l'état est conservé tel quel —
 * le cache reste affiché pendant la relecture.
 */
export function invalidateOnRequestChange(status: ResourceStatus, request: string): ResourceStatus {
  if (status.request === request) return status;
  return { request, payload: null, fetchedAt: 0, stale: false, error: null, loading: true };
}

/**
 * État au DÉBUT d'un chargement.
 *
 * - requête différente : le payload précédent est invalide, l'écran montre un
 *   chargement ;
 * - même requête : le cache reste affiché pendant la relecture (offline-first) ;
 *   sans payload, l'écran montre le chargement.
 */
export function beginLoad(status: ResourceStatus, request: string): ResourceStatus {
  const next = invalidateOnRequestChange(status, request);
  return next.payload ? next : { ...next, loading: true };
}

/**
 * Vue affichable : le payload n'est montré que s'il est celui de la requête
 * courante.
 *
 * Une requête différente = l'ancien payload est invalide : l'écran montre un
 * chargement, JAMAIS les chiffres d'une autre période — même après un échec
 * du chargement (#527).
 */
export function visibleResource(status: ResourceStatus, request: string): ResourceView {
  if (status.request !== request) return PENDING;
  return {
    payload: status.payload,
    fetchedAt: status.fetchedAt,
    stale: status.stale,
    error: status.error,
    loading: status.loading,
  };
}
