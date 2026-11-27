import { parseDate } from "../../lib/format";
import type { Algorithm } from "./averages";
import type { AveragesReport, Grade, Period } from "./parse";

export function formatMark(value: number, decimals = 2): string {
  if (!Number.isFinite(value)) return "—";
  const digits = Math.min(4, Math.max(0, Math.trunc(decimals)));
  return value.toFixed(digits).replace(".", ",");
}

export function gradeValueLabel(value: number): string {
  const two = formatMark(value);
  if (two.endsWith(",00")) return two.slice(0, -3);
  if (two.endsWith("0")) return two.slice(0, -1);
  return two;
}

/** « /20 », ou le barème réel quand l'évaluation sort de l'échelle. */
export function scaleSuffix(scale: number): string {
  return Number.isFinite(scale) && scale > 0 ? `/${gradeValueLabel(scale)}` : "";
}

export function algorithmLabel(algorithm: Algorithm): string {
  if (algorithm === "weighted") return "Moyenne pondérée";
  if (algorithm === "median") return "Médiane des notes";
  return "Moyenne des matières";
}

/** Une moyenne fournie ne dépend pas de l'algorithme choisi. */
export function reportTitle(report: AveragesReport): string {
  return report.provided ? "Moyenne générale" : algorithmLabel(report.algorithm);
}

export function algorithmChipLabel(algorithm: Algorithm): string {
  if (algorithm === "weighted") return "Pondérée";
  if (algorithm === "median") return "Médiane";
  return "Matières";
}

/** Quand la moyenne est publiée, les puces ne portent que sur la courbe et les
 *  influences, estimées : le dire évite de croire que « Médiane » a produit le 12,50. */
export function algorithmHint(algorithm: Algorithm, provided = false): string {
  if (provided) {
    return "Moyenne publiée par l'établissement ; la courbe et les influences sont estimées.";
  }
  if (algorithm === "weighted") return "Chaque note pèse selon son coefficient.";
  if (algorithm === "median") return "La médiane de toutes les notes, peu sensible aux extrêmes.";
  return "Moyenne simple des moyennes de matières.";
}

export function coverageLabel(report: AveragesReport): string {
  const grades = report.subjects.reduce((total, subject) => total + subject.gradeCount, 0);
  const parts: string[] = [];
  if (report.subjectCount > 0) {
    parts.push(`${report.subjectCount} matière${report.subjectCount > 1 ? "s" : ""}`);
  }
  if (grades > 0) parts.push(`${grades} note${grades > 1 ? "s" : ""}`);
  return parts.join(" · ");
}

export function originLabel(provided: boolean, estimatedAt: string | null): string {
  if (provided) return "publiée par l'établissement";
  const date = parseDate(estimatedAt);
  if (!date) return "estimée";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `estimée au ${day}/${month}/${date.getFullYear()}`;
}

export function averageLabel(value: number | null, provided: boolean, algorithm: Algorithm): string {
  if (value === null) return "Moyenne indisponible sur cette période.";
  const origin = provided ? "fournie" : `estimée, algorithme ${algorithmChipLabel(algorithm).toLowerCase()}`;
  return `${formatMark(value)}/20 (moyenne ${origin})`;
}

export function influenceLabel(impact: number, estimated = false): string {
  if (!Number.isFinite(impact)) return "";
  const rounded = formatMark(Math.abs(impact));
  const target = estimated ? "sur la moyenne estimée" : "sur la moyenne";
  if (rounded === "0,00") return estimated ? "Sans effet sur la moyenne estimée" : "Sans effet sur la moyenne";
  return `${impact > 0 ? "+" : "−"}${rounded} ${target}`;
}

export function gradeContextLabel(grade: Grade): string {
  const parts: string[] = [];
  if (grade.coefficient !== null && grade.coefficient !== 1) {
    parts.push(`Coeff. ${gradeValueLabel(grade.coefficient)}`);
  }
  if (grade.bonus) parts.push("Bonus");
  if (grade.optional) parts.push("Facultatif");
  if (grade.teacher) parts.push(grade.teacher);
  if (grade.classAverage !== null) parts.push(`Moyenne de classe ${gradeValueLabel(grade.classAverage)}`);
  if (grade.classMin !== null && grade.classMax !== null) {
    parts.push(`De ${gradeValueLabel(grade.classMin)} à ${gradeValueLabel(grade.classMax)}`);
  }
  return parts.join(" · ");
}

/** Repli sur la matière : jamais une chaîne vide. */
export function gradeLabel(grade: Grade): string {
  return grade.label?.trim() || grade.subject;
}

export function periodLabel(period: Period): string {
  const start = period.start ? formatDay(period.start) : "";
  const end = period.end ? formatDay(period.end) : "";
  const range =
    start && end ? `${start} – ${end}` : start ? `depuis le ${start}` : end ? `jusqu'au ${end}` : "";
  return range ? `${period.name} · ${range}` : period.name;
}

function formatDay(value: string): string {
  const date = parseDate(value);
  if (!date) return "";
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}/${date.getFullYear()}`;
}
