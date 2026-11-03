export type NavigationType = "POP" | "PUSH" | "REPLACE";

export interface ScrollPosition {
  key: string;
  pathname: string;
  y: number;
}

export interface ScrollDecision {
  /** Positions à mémoriser avant de quitter la localisation courante. */
  save: ScrollPosition[];
  /** Cible du scroll, `null` pour laisser la page en place. */
  restore: number | null;
}

/** Clé d'une entrée d'historique : le contrat est `pathname + search`. */
export function scrollKey(pathname: string, search: string): string {
  return `${pathname}${search}`;
}

/**
 * Décide la sauvegarde et la restauration au changement de localisation.
 * Seul POP restaure ; un changement de query sur le même écran ne bouge pas ;
 * un nouveau pathname repart en haut.
 */
export function scrollDecision(input: {
  navigationType: NavigationType;
  previous: ScrollPosition | null;
  key: string;
  pathname: string;
  saved: number | undefined;
}): ScrollDecision {
  const { navigationType, previous, key, pathname, saved } = input;
  if (!previous) return { save: [], restore: saved ?? 0 };
  if (previous.key === key) return { save: [], restore: null };
  const save = [{ key: previous.key, pathname: previous.pathname, y: previous.y }];
  if (navigationType === "POP") return { save, restore: saved ?? 0 };
  if (previous.pathname === pathname) return { save, restore: null };
  return { save, restore: 0 };
}
