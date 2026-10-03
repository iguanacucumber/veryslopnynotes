// server/domain/averages.ts — moyennes parité Papillon (issue #74, phase 2).
// I3 : aucune dépendance SQLite/HTTP ici, fonctions pures sur contrats.
// Portage fidèle de papillon.bzh utils/grades/algorithms/* (subject, weighted,
// median, time) + useGradeInfluence. Aucun LLM, aucun réseau : la moyenne est
// une donnée structurée (I7).
//
// Semantics communes : sortie toujours sur /20. Une période sans note
// exploitable renvoie null (jamais 0 = "zéro de moyenne", cf. sentinel -1
// interne de Papillon). Bonus et facultatives suivent les règles Papillon :
//   - bonus   : contribution (valeur - barème/2) si >= 0, sinon ignorée.
//   - facult. : conservée seulement si elle améliore la moyenne.
//   - coef 0  : note ignorée.
// ponytail: notes non notées / absentes non modélisées (pas de flag `disabled`
// dans le contrat) — upgrade: champ `graded?: boolean` sur Grade + source
// Pronote, sans changer les trois algorithmes.

import type {
  AverageAlgorithm,
  AverageHistoryPoint,
  AveragesReport,
  GeneralAverage,
  Grade,
  GradeInfluence,
  SubjectAverage,
} from "../../shared/contracts/models";

/** Sentinelle interne « aucune donnée » (Papillon utilise -1 en interne). */
const NO_DATA = -1;

/**
 * Historique et influence : une entrée par note, donc quadratique (chaque
 * influence recalcule la moyenne sans la note). L'historique porte sur TOUTES
 * les notes antérieures (exact, cohérent avec la moyenne générale) ; seules
 * les MAX_AVERAGE_POINTS DERNIERS entrées sont renvoyées. ponytail: au-delà de
 * N, seuls les points/impacts anciens manquent, la moyenne reste exacte.
 */
export const MAX_AVERAGE_POINTS = 200;

/** Clé de regroupement d'une matière : sans accents, minuscules, sans bords. */
export function subjectKey(subject: string): string {
  return subject
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Poids de la note : 1 par défaut (Papillon `coefficient || 1`), 0 = hors moyenne. */
function weightOf(g: Grade): number {
  if (g.coefficient === undefined) return 1;
  return Number.isFinite(g.coefficient) ? g.coefficient : 1;
}

/** Note explicitement hors moyenne (coefficient 0), comme Papillon l'ignore. */
function isExcluded(g: Grade): boolean {
  return g.coefficient === 0;
}

/** Note exploitable : hors moyenne écartée, valeur et barème exploitables. */
function isUsable(g: Grade): boolean {
  if (isExcluded(g)) return false;
  // Coefficient négatif : le poids annule le dénominateur (moyenne qui
  // disparaît ou s'inverse). Donnée Pronote incohérente = note écartée, comme
  // un coefficient 0 — jamais un dénominateur annulé.
  if (g.coefficient !== undefined && (!Number.isFinite(g.coefficient) || g.coefficient < 0)) return false;
  return Number.isFinite(g.value) && g.value >= 0 && Number.isFinite(g.scale) && g.scale > 0;
}

/**
 * Papillon : ramène la note sur /20 quand elle sort de l'échelle, pondérée
 * par le coefficient. Le seuil `coef < 1 && barème - 20 >= -5` est repris tel
 * quel de Papillon (les évaluations notées /10 ou /15 comptent en clair).
 */
function addWeighted(sum: { value: number; outOf: number }, g: Grade, value: number): void {
  const coef = weightOf(g);
  const outOf = g.scale;
  if (value > 20 || (coef < 1 && outOf - 20 >= -5) || outOf > 20) {
    sum.value += (value / outOf) * 20 * coef;
    sum.outOf += 20 * coef;
  } else {
    sum.value += value * coef;
    sum.outOf += outOf * coef;
  }
}

function ratioTo20(sum: { value: number; outOf: number }): number {
  if (sum.outOf <= 0) return NO_DATA;
  const result = Math.min((sum.value / sum.outOf) * 20, 20);
  return Number.isNaN(result) ? NO_DATA : result;
}

/** Papillon getSubjectAverage : moyenne d'une matière. `loop` court-circuite le cas facultative. */
function subjectAverageInner(grades: Grade[], loop: boolean): number {
  const sum = { value: 0, outOf: 0 };
  for (let i = 0; i < grades.length; i++) {
    const g = grades[i];
    if (!isUsable(g)) continue;
    // Facultative : hors boucle, on ne garde la note que si elle améliore la moyenne.
    if (g.optional && !loop) {
      const without = grades.filter((_, idx) => idx !== i);
      const avgWithout = subjectAverageInner(without, true);
      const avgWith = subjectAverageInner(grades, true);
      if (avgWithout > avgWith) continue;
    }
    // Bonus : on retire la demi-barème, contribution 1 point si positif.
    if (g.bonus) {
      const corrected = g.value - g.scale / 2;
      if (corrected >= 0) {
        sum.value += corrected;
        sum.outOf += 1;
      }
      continue;
    }
    addWeighted(sum, g, g.value);
  }
  return ratioTo20(sum);
}

/** Papillon getSubjectAverage (entry point) : null si matière vide. */
export function subjectAverage(grades: Grade[]): number | null {
  const value = subjectAverageInner(grades, false);
  return value === NO_DATA ? null : value;
}

function groupBySubject(grades: Grade[]): Map<string, Grade[]> {
  const groups = new Map<string, Grade[]>();
  for (const g of grades) {
    const key = subjectKey(g.subject);
    const bucket = groups.get(key);
    if (bucket) bucket.push(g);
    else groups.set(key, [g]);
  }
  return groups;
}

/** Papillon PapillonSubjectAvg : moyenne des moyennes de matière. */
export function subjectAlgorithmAverage(grades: Grade[]): number | null {
  if (grades.length === 0) return null;
  let total = 0;
  let counted = 0;
  for (const bucket of groupBySubject(grades).values()) {
    const avg = subjectAverageInner(bucket, false);
    if (avg !== NO_DATA) {
      counted += 1;
      total += avg;
    }
  }
  return counted > 0 ? total / counted : null;
}

/** Papillon PapillonWeightedAvg : toutes notes poolées, pondérées par coefficient. */
export function weightedAlgorithmAverage(grades: Grade[]): number | null {
  if (grades.length === 0) return null;
  const sum = { value: 0, outOf: 0 };
  for (const g of grades) {
    if (!isUsable(g)) continue;
    if (g.bonus) {
      const corrected = g.value - g.scale / 2;
      if (corrected >= 0) {
        sum.value += corrected;
        sum.outOf += 1;
      }
      continue;
    }
    addWeighted(sum, g, g.value);
  }
  const result = ratioTo20(sum);
  return result === NO_DATA ? null : result;
}

/** Papillon PapillonMedian : médiane des notes ramenées sur /20 (bonus ignorés). */
export function medianAlgorithmAverage(grades: Grade[]): number | null {
  const values: number[] = [];
  for (const g of grades) {
    if (!isUsable(g)) continue;
    // Bonus = majoration hors barème, PAS une note /20 ordinaire : l'inclure
    // ferait monter la médiane de la matière pour une note qui ne compte pas.
    if (g.bonus) continue;
    values.push((g.value / g.scale) * 20);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 0) return (values[middle - 1] + values[middle]) / 2;
  return values[middle];
}

const ALGORITHMS: Record<AverageAlgorithm, (grades: Grade[]) => number | null> = {
  subject: subjectAlgorithmAverage,
  weighted: weightedAlgorithmAverage,
  median: medianAlgorithmAverage,
};

/** Applique l'algorithme choisi (défaut Papillon = subject). */
export function averageWith(algorithm: AverageAlgorithm, grades: Grade[]): number | null {
  const fn = ALGORITHMS[algorithm] ?? subjectAlgorithmAverage;
  return fn(grades);
}

export interface ProvidedAverages {
  /**
   * Période à laquelle ces moyennes appartiennent. `null` = l'ensemble des
   * notes sans filtre. Une moyenne fournie n'est appliquée que si sa période
   * correspond exactement au périmètre demandé, sinon l'estimation prend le
   * relais (une moyenne d'année ne vaut pas pour un trimestre).
   */
  readonly periodId?: string | null;
  /** Moyenne générale fournie par l'établissement (sur /20), ou null. */
  readonly general?: number | null;
  /**
   * Moyennes fournies par matière, sur /20. Clé = `subjectKey(nom)` (sans
   * accents, minuscules) : exportée pour que l'adaptateur et les tests
   * produisent exactement la même clé.
   */
  readonly subjects?: Readonly<Record<string, number>>;
}

/** Les fournies ne servent que si leur périmètre == celui demandé. */
function providedFor(options: ComputeAveragesOptions): ProvidedAverages | null {
  const provided = options.provided ?? null;
  if (!provided) return null;
  const scope = options.periodId ?? null;
  return (provided.periodId ?? null) === scope ? provided : null;
}

function providedSubject(key: string, provided?: ProvidedAverages | null): number | null {
  const map = provided?.subjects;
  if (!map) return null;
  const raw = map[key];
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

/**
 * Historique : moyenne générale recalculée à chaque note, triée par date.
 * Les valeurs sont calculées sur TOUTES les notes antérieures (historique
 * exact) ; seules les MAX_AVERAGE_POINTS derniers points sont gardés.
 */
function buildHistory(algorithm: AverageAlgorithm, grades: Grade[]): AverageHistoryPoint[] {
  const sorted = [...grades].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  const out: AverageHistoryPoint[] = [];
  // Historique EXACT : chaque point est la moyenne de TOUTES les notes
  // antérieures (fenêtrer les notes d'entrée ferait diverger la courbe de la
  // moyenne générale affichée, qui porte sur toute la période).
  for (let i = 0; i < sorted.length; i++) {
    out.push({ date: sorted[i].date, value: averageWith(algorithm, sorted.slice(0, i + 1)) });
  }
  // Seule la TAILLE de la réponse est bornée : on garde les points les plus
  // récents (le dernier = moyenne générale, donc cohérent avec l'affichage).
  return out.length > MAX_AVERAGE_POINTS ? out.slice(out.length - MAX_AVERAGE_POINTS) : out;
}

/** Notes les plus récentes, triées : fenêtré pour borner le coût quadratique. */
function recentByDate(grades: Grade[]): Grade[] {
  const sorted = [...grades].sort((a, b) => Date.parse(a.date) - Date.parse(b.date));
  return sorted.length > MAX_AVERAGE_POINTS ? sorted.slice(sorted.length - MAX_AVERAGE_POINTS) : sorted;
}

/**
 * Influence d'une note sur la moyenne générale : écart avec/sans la note.
 * Papillon useGradeInfluence (arrondi 2 décimales). Cas upstream : sans la
 * note, la matière devient sans note exploitable, elle est retirée de la
 * moyenne générale ; s'il ne reste aucune matière, la moyenne de référence
 * vaut 0 (et non null) — l'écart vaut alors la moyenne entière.
 */
function buildInfluences(algorithm: AverageAlgorithm, grades: Grade[]): GradeInfluence[] {
  const general = averageWith(algorithm, grades);
  if (general === null) return [];
  const recent = recentByDate(grades);
  const out: GradeInfluence[] = [];
  for (const g of recent) {
    const rest = grades.filter((x) => x.id !== g.id);
    const without = averageWith(algorithm, rest) ?? 0;
    out.push({ gradeId: g.id, subject: g.subject, impact: Number((general - without).toFixed(2)) });
  }
  return out;
}

export interface ComputeAveragesOptions {
  readonly algorithm?: AverageAlgorithm;
  /** null = toutes périodes confondues. */
  readonly periodId?: string | null;
  readonly provided?: ProvidedAverages | null;
}

function buildSubjectAverages(grades: Grade[], provided?: ProvidedAverages | null): SubjectAverage[] {
  const out: SubjectAverage[] = [];
  for (const [key, bucket] of groupBySubject(grades)) {
    const label = bucket[0].subject;
    const providedValue = providedSubject(key, provided);
    const estimated = subjectAverageInner(bucket, false);
    const value = providedValue ?? (estimated === NO_DATA ? null : estimated);
    const gradeCount = countRetained(bucket);
    out.push({
      subject: label,
      value,
      origin: providedValue !== null ? "provided" : "estimated",
      gradeCount,
    });
  }
  return out.sort((a, b) => a.subject.localeCompare(b.subject, "fr"));
}

/** Notes exploitables : coefficient non nul, valeur et barème valides (bonus/facultatives incluses). */
function countRetained(grades: Grade[]): number {
  let count = 0;
  for (const g of grades) if (isUsable(g)) count += 1;
  return count;
}

/** Rapport de moyennes : fourchettes fournies prioritaires, sinon estimation par algorithme. */
export function computeAverages(grades: Grade[], options: ComputeAveragesOptions = {}): AveragesReport {
  const algorithm = options.algorithm ?? "subject";
  const periodId = options.periodId ?? null;
  const provided = providedFor(options);
  const scoped = periodId === null ? grades : grades.filter((g) => (g.periodId ?? null) === periodId);
  const subjects = buildSubjectAverages(scoped, provided);

  const providedGeneral =
    typeof provided?.general === "number" && Number.isFinite(provided.general) ? provided.general : null;
  const estimatedGeneral = averageWith(algorithm, scoped);
  const general: GeneralAverage = {
    value: providedGeneral ?? estimatedGeneral,
    origin: providedGeneral !== null ? "provided" : "estimated",
    subjectCount: subjects.filter((s) => s.value !== null).length,
  };

  return {
    algorithm,
    periodId,
    general,
    subjects,
    history: buildHistory(algorithm, scoped),
    influences: buildInfluences(algorithm, scoped),
  };
}
