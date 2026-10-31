// Le payload d'une ressource appartient à SA requête : changer de période,
// d'algorithme ou de semaine invalide le payload précédent (sinon les chiffres
// d'une autre requête restent affichés, même après un échec).
//
// Règles pures, testables sans React : une requête = clé + query ; un
// changement de requête vide l'état ; la vue ne montre jamais un autre payload.
// Le rafraîchissement d'une MÊME requête garde le cache affiché.

export function requestId(key: string, query: string): string {
  // La clé ne contient jamais de « ? » : l'identifiant est unique et comparé
  // pour égalité, rien d'autre.
  return `${key}?${query}`;
}

/** Le payload est RATTACHÉ à sa requête. */
export interface ResourceStatus {
  request: string;
  payload: string | null;
  fetchedAt: number;
  stale: boolean;
  error: string | null;
  loading: boolean;
}

/** Jamais le payload d'une autre requête. */
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

/** Changement de requête : ancien payload invalidé. Même requête : état
 *  conservé, le cache reste affiché pendant la relecture. */
export function invalidateOnRequestChange(status: ResourceStatus, request: string): ResourceStatus {
  if (status.request === request) return status;
  return { request, payload: null, fetchedAt: 0, stale: false, error: null, loading: true };
}

/** Début de chargement : requête différente = chargement ; même requête =
 *  cache affiché, ou chargement sans payload. */
export function beginLoad(status: ResourceStatus, request: string): ResourceStatus {
  const next = invalidateOnRequestChange(status, request);
  return next.payload ? next : { ...next, loading: true };
}

/** Vue affichable : le payload d'une autre requête n'est jamais montré, même
 *  après un échec de chargement. */
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
