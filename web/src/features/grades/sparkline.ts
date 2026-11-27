import { gradeValueLabel } from "./labels";

export interface SparkPoint {
  x: number;
  y: number;
}

function knownValues(values: readonly (number | null)[]): number[] {
  return values.filter((value): value is number => value !== null && Number.isFinite(value));
}

/** Points de la courbe : valeurs nulles ignorées, moins de deux valeurs = aucun
 *  tracé, y inversé (la meilleure moyenne en haut). */
export function sparklinePoints(
  values: readonly (number | null)[],
  width: number,
  height: number,
): SparkPoint[] {
  if (!(width > 0) || !(height > 0)) return [];
  const known = knownValues(values);
  if (known.length === 0) return [];
  if (known.length === 1) return [{ x: width, y: height / 2 }];
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min;
  const step = width / (known.length - 1);
  return known.map((value, index) => ({
    x: index * step,
    y: height * (1 - (span <= 0 ? 0.5 : (value - min) / span)),
  }));
}

/** Ordonnée de la moyenne, dans l'échelle de `sparklinePoints` ; `null` quand
 *  la ligne n'apprendrait rien (moins de deux points, série plate). */
export function sparklineAverageY(values: readonly (number | null)[], height: number): number | null {
  const known = knownValues(values);
  if (known.length < 2 || !(height > 0)) return null;
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min;
  if (span <= 0) return null;
  const average = known.reduce((sum, value) => sum + value, 0) / known.length;
  return height * (1 - (average - min) / span);
}

/** Quand la moyenne est fournie, la courbe reste une estimation : le dire évite
 *  de faire passer le dernier point pour la moyenne de l'établissement. */
export function historyNote(values: readonly (number | null)[], provided = false): string {
  const size = knownValues(values).length;
  if (size === 0) {
    return provided
      ? "Pas d'historique de moyenne estimée sur cette période."
      : "Pas d'historique de moyenne sur cette période.";
  }
  if (size === 1) {
    return provided
      ? "Une seule moyenne estimée connue : la courbe se dessine à la note suivante."
      : "Une seule moyenne connue : la courbe se dessine à la note suivante.";
  }
  if (provided) return "Courbe estimée à partir des notes ; la moyenne affichée est celle de l'établissement.";
  return "";
}

export function sparklineDescription(values: readonly (number | null)[], provided = false): string {
  const known = knownValues(values);
  if (known.length === 0) return "Pas d'historique de moyenne.";
  const first = known[0];
  const last = known[known.length - 1];
  if (first === undefined || last === undefined) return "Pas d'historique de moyenne.";
  const kind = provided ? "estimée " : "";
  if (known.length === 1) return `Une seule moyenne ${kind}connue : ${gradeValueLabel(first)} sur 20.`;
  return `Évolution ${kind}de la moyenne : de ${gradeValueLabel(first)} à ${gradeValueLabel(last)}.`;
}
