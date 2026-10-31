import { useEffect, useRef, useState } from "react";

/** Distance sous laquelle on considère le fil « collé » au bas. */
const STICK_THRESHOLD = 56;

export function isNearBottom(
  box: { scrollHeight: number; scrollTop: number; clientHeight: number },
  threshold = STICK_THRESHOLD,
): boolean {
  return box.scrollHeight - box.scrollTop - box.clientHeight <= threshold;
}

/** Un pixel près : les arrondis de mise en page ne doivent pas compter. */
export function isScrollable(box: { scrollHeight: number; clientHeight: number }): boolean {
  return box.scrollHeight > box.clientHeight + 1;
}

/**
 * Suit le bas du fil sans voler le scroll : on ne recolle que si l'élève y
 * était déjà. Sinon `away` affiche la pastille « Dernière réponse ».
 */
export function useStickToBottom(deps: readonly unknown[]) {
  const ref = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const [away, setAway] = useState(false);

  useEffect(() => {
    const box = ref.current;
    if (!box) return;
    // Un fil vide ou plus court que son cadre est toujours « en bas » : sans
    // ça, effacer la discussion laisserait la pastille sur l'état vide.
    if (stick.current || !isScrollable(box)) {
      box.scrollTop = box.scrollHeight;
      stick.current = true;
      setAway(false);
    } else {
      setAway(true);
    }
    // Les dépendances du fil sont fournies par l'appelant.
  }, deps);

  function onScroll(): void {
    const box = ref.current;
    if (!box) return;
    stick.current = isNearBottom(box);
    if (stick.current) setAway(false);
  }

  function toBottom(): void {
    stick.current = true;
    setAway(false);
    const box = ref.current;
    if (box) box.scrollTop = box.scrollHeight;
  }

  return { ref, onScroll, away, toBottom };
}
