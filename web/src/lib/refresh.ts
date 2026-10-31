// Le geste de rafraîchissement est un DELTA, pas un absolu : forcer seulement
// si le geste ou la requête a changé depuis le dernier chargement. La première
// entrée sur un écran ne force rien (`CachePolicy.shouldFetch` côté natif).

export interface LoadSignature {
  /** Semaine, période, algorithme… */
  query: string;
  /** Compteur du geste local de l'écran (« Actualiser »). */
  manual: number;
  /** Compteur du geste global (barre). */
  tick: number;
}

export function forceReload(last: LoadSignature | null, next: LoadSignature): boolean {
  if (!last) return false;
  return last.manual !== next.manual || last.tick !== next.tick || last.query !== next.query;
}
