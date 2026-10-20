// Séquence de chargement : une réponse PÉRIMÉE est ignorée.
//
// Pourquoi : deux chargements peuvent se chevaucher (l'utilisateur ouvre un
// fil, revient à la liste, en ouvre un autre). La réponse du PREMIER arrive
// parfois APRÈS celle du second : sans cette garde, l'écran affichait les
// messages de l'ancien fil sous l'en-tête du nouveau (#501).
//
// Le motif est celui de `features/revisions/RevisionSheets.tsx` : un compteur
// monotone, et la comparaison de la valeur capturée au moment de la demande.
//
// ponytail: trois lignes, un `useRef` par écran. La logique est ici (et pas
// dans le composant) pour être TESTABLE : le dépôt n'a pas de rendu React
// dans les tests, donc une règle écrite dans le composant ne serait pas
// vérifiée.

export interface Seq {
  /** Nouvelle demande : renvoie le numéro de la séquence demandée. */
  next(): number;
  /** La réponse `n` est-elle encore la dernière demandée ? */
  isCurrent(n: number): boolean;
  /** Invalide toute demande en vol (l'écran a changé d'état). */
  invalidate(): void;
}

/** Crée une séquence de chargement. */
export function createSeq(): Seq {
  let n = 0;
  return {
    next: () => ++n,
    isCurrent: (v) => v === n,
    invalidate: () => {
      n += 1;
    },
  };
}
