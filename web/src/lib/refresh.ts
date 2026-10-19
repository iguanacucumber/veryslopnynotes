// Rechargement d'une ressource : le geste est un DELTA, pas un absolu (#365).
//
// Avant, `force` valait `manual > 0 || refreshTick > 0` : les deux compteurs
// sont monotones et ne repassent jamais à zéro. Après le PREMIER geste de
// rafraîchissement, `force` restait donc `true` POUR TOUJOURS : chaque
// ouverture d'écran relisait le client local (cinq lectures sérialisées sur
// l'accueil, au-delà du délai du pont). À l'inverse, un changement de requête
// (semaine, période, algorithme) ne forçait jamais la relecture.
//
// La règle : on force quand le GESTE a changé depuis le dernier chargement, ou
// quand la REQUÊTE a changé. La première entrée sur un écran n'est PAS un
// geste : elle ne force rien (cf. `CachePolicy.shouldFetch` côté natif).

/** Signature d'un chargement : ce qui permet de dire « qu'est-ce qui a changé ». */
export interface LoadSignature {
  /** Requête de la ressource (semaine, période, algorithme…). */
  query: string;
  /** Compteur du geste local de l'écran (« Actualiser » de l'écran). */
  manual: number;
  /** Compteur du geste global (bouton « Actualiser » de la barre). */
  tick: number;
}

/**
 * Faut-il forcer la relecture du client local ?
 *
 * - `last` absent = première entrée sur l'écran : NON (ce n'est pas un geste) ;
 * - le geste (local ou global) a changé depuis le dernier chargement : OUI ;
 * - la requête a changé (semaine, période, algorithme) : OUI.
 */
export function forceReload(last: LoadSignature | null, next: LoadSignature): boolean {
  if (!last) return false;
  return last.manual !== next.manual || last.tick !== next.tick || last.query !== next.query;
}
