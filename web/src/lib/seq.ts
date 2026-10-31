// Une réponse PÉRIMÉE est ignorée : deux chargements peuvent se chevaucher et
// l'ancien arrive après le nouveau (messages d'un autre fil sous l'en-tête).

// ponytail: un compteur monotone et un `useRef` par écran. La logique est ici
// pour être testable : les tests n'ont pas de rendu React.

export interface Seq {
  /** Numéro de la nouvelle demande. */
  next(): number;
  isCurrent(n: number): boolean;
  /** Invalide toute demande en vol (l'écran a changé d'état). */
  invalidate(): void;
}

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
