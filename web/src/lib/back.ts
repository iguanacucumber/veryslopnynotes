/** Décision de retour matériel : dialogues d'abord, puis route, sinon sortie. */
export type BackDecision =
  | { kind: "dialog" }
  | { kind: "route"; fallback: string }
  | { kind: "root" };

/**
 * `fallback` est la route de `meta.back` : une entrée initiale (deep link,
 * restauration) n'a pas d'historique interne, donc reculer ne doit pas sortir
 * de l'app.
 */
export function decideBack(input: {
  dialogs: number;
  pathname: string;
  metaBack?: string;
}): BackDecision {
  if (input.dialogs > 0) return { kind: "dialog" };
  if (input.pathname === "/") return { kind: "root" };
  return { kind: "route", fallback: input.metaBack ?? "/" };
}
