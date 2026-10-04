import { describe, expect, test } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { AVERAGE_ALGORITHMS, CONTRACTS_VERSION, isAveragesReport } from "../../shared/contracts/models";
import { isGradesResponse, isPeriodsResponse } from "../../shared/contracts/api";

// Miroir des helpers Kotlin (Averages.kt) — doivent rester en sync.
// org.json = SDK Android, aucune dépendance ajoutée (garde deps plus bas).
//
// Dérive assumée : ce fichier duplique la logique Kotlin au lieu de la partager
// — un JVM ne tourne pas dans `bun test`. Le filet réel reste
// `make android-compile` (le vrai compilateur) + les gardes structurels des
// derniers tests (les clés lues par le Kotlin, le branchement dans AppNav, la
// query des notes, l'appel à /v1/periods).
const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const DATA = join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data");
const CORE = join(import.meta.dir, "..", "..", "android/core/src/main/java/fr/veryslopnynotes/core");

// --- Types du miroir --------------------------------------------------------

interface TsGrade {
  id: string;
  subject: string;
  value: number;
  scale: number;
  coefficient: number | null;
  millis: number;
  classAverage: number | null;
  classMin: number | null;
  classMax: number | null;
  periodId: string | null;
  bonus: boolean;
  optional: boolean;
  label: string | null;
  teacher: string | null;
}

interface TsAverages {
  algorithm: string;
  generalValue: number | null;
  provided: boolean;
  subjectCount: number;
  subjects: { subject: string; value: number | null; provided: boolean; gradeCount: number }[];
  history: { millis: number; value: number | null }[];
  influences: { gradeId: string; subject: string; impact: number }[];
}

// --- Miroir de Averages.kt --------------------------------------------------

const ALGO_CHOICES = ["subject", "weighted", "median"];

const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$/;

/** ISO-8601 -> millis (Kotlin : OffsetDateTime.parse). Illisible = null. */
function tsMillis(value: string | undefined | null): number | null {
  if (typeof value !== "string" || value.trim() === "") return null;
  if (!ISO_RE.test(value.trim())) return null;
  const ms = Date.parse(value.trim());
  return Number.isNaN(ms) ? null : ms;
}

function tsBound(value: unknown, max: number): string | null {
  const text = typeof value === "string" ? value.trim() : "";
  return text === "" || text.length > max ? null : text;
}

function tsNumber(obj: Record<string, unknown>, key: string): number | null {
  const raw = obj[key];
  if (raw === null || raw === undefined || typeof raw !== "number" || !Number.isFinite(raw)) return null;
  return raw;
}

function tsAverages(payload: string | null): TsAverages | null {
  if (payload === null) return null;
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return null;
  }
  const averages = root["averages"];
  if (typeof averages !== "object" || averages === null) return null;
  const a = averages as Record<string, unknown>;
  const general = a["general"];
  if (typeof general !== "object" || general === null) return null;
  const g = general as Record<string, unknown>;
  const origin = g["origin"];
  if (origin !== "provided" && origin !== "estimated") return null;
  const algo = String(a["algorithm"] ?? "");
  const array = <T>(key: string, read: (o: Record<string, unknown>) => T | null): T[] => {
    const list = a[key];
    if (!Array.isArray(list)) return [];
    const out: T[] = [];
    for (const item of list as unknown[]) {
      if (typeof item !== "object" || item === null) continue;
      const read_value = read(item as Record<string, unknown>);
      if (read_value !== null) out.push(read_value);
    }
    return out;
  };
  return {
    algorithm: ALGO_CHOICES.includes(algo) ? algo : "subject",
    generalValue: tsNumber(g, "value"),
    provided: origin === "provided",
    subjectCount: Math.max(0, Math.trunc(Number(g["subjectCount"] ?? 0))),
    subjects: array("subjects", (o) => {
      const subject = tsBound(o["subject"], 100);
      const o2 = o["origin"];
      if (subject === null || (o2 !== "provided" && o2 !== "estimated")) return null;
      return {
        subject,
        value: tsNumber(o, "value"),
        provided: o2 === "provided",
        gradeCount: Math.max(0, Math.trunc(Number(o["gradeCount"] ?? 0))),
      };
    }),
    history: array("history", (o) => {
      const millis = tsMillis(typeof o["date"] === "string" ? (o["date"] as string) : undefined);
      if (millis === null) return null;
      return { millis, value: tsNumber(o, "value") };
    }),
    influences: array("influences", (o) => {
      const gradeId = tsBound(o["gradeId"], 64);
      const subject = tsBound(o["subject"], 100);
      const impact = tsNumber(o, "impact");
      if (gradeId === null || subject === null || impact === null) return null;
      return { gradeId, subject, impact };
    }),
  };
}

function tsGrades(payload: string | null): TsGrade[] {
  if (payload === null) return [];
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return [];
  }
  const list = root["grades"];
  if (!Array.isArray(list)) return [];
  const out: TsGrade[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const id = tsBound(o["id"], 64);
    const subject = tsBound(o["subject"], 100);
    const value = tsNumber(o, "value");
    const scale = tsNumber(o, "scale");
    const millis = tsMillis(typeof o["date"] === "string" ? (o["date"] as string) : undefined);
    if (id === null || subject === null || value === null || scale === null || millis === null) continue;
    if (value < 0 || scale <= 0) continue;
    const coefficient = tsNumber(o, "coefficient");
    out.push({
      id,
      subject,
      value,
      scale,
      coefficient: coefficient !== null && coefficient > 0 ? coefficient : null,
      millis,
      classAverage: tsNumber(o, "classAverage"),
      classMin: tsNumber(o, "classMin"),
      classMax: tsNumber(o, "classMax"),
      periodId: tsBound(o["periodId"], 64),
      bonus: o["bonus"] === true,
      optional: o["optional"] === true,
      label: tsBound(o["label"], 200),
      teacher: tsBound(o["teacher"], 100),
    });
  }
  return out.sort((a, b) => b.millis - a.millis);
}

function tsPeriods(payload: string | null): { id: string; name: string; start: number | null; end: number | null }[] {
  if (payload === null) return [];
  let root: Record<string, unknown>;
  try {
    root = JSON.parse(payload) as Record<string, unknown>;
  } catch {
    return [];
  }
  const list = root["periods"];
  if (!Array.isArray(list)) return [];
  const out: { id: string; name: string; start: number | null; end: number | null }[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== "object" || item === null) continue;
    const o = item as Record<string, unknown>;
    const id = tsBound(o["id"], 64);
    const name = tsBound(o["name"], 100);
    if (id === null || name === null) continue;
    const start = tsMillis(typeof o["start"] === "string" ? (o["start"] as string) : undefined);
    const end = tsMillis(typeof o["end"] === "string" ? (o["end"] as string) : undefined);
    if (start !== null && end !== null && end < start) continue;
    out.push({ id, name, start, end });
  }
  return out;
}

function tsGeneralAverageOf(report: TsAverages | null): { value: number; provided: boolean; algorithm: string } | null {
  if (report === null || report.generalValue === null) return null;
  return { value: report.generalValue, provided: report.provided, algorithm: report.algorithm };
}

/** Kotlin : String.format(Locale.FRANCE, "%.Nf", value). */
const tsFormatMark = (value: number, decimals = 2): string => {
  if (!Number.isFinite(value)) return "—";
  return value.toFixed(decimals).replace(".", ",");
};

/** Kotlin : `gradeValueLabel` — pas de zéro inutile après la virgule. */
const tsGradeValueLabel = (value: number): string => {
  const two = tsFormatMark(value);
  if (two.endsWith(",00")) return two.slice(0, -3);
  if (two.endsWith("0")) return two.slice(0, -1);
  return two;
};

const tsScaleSuffix = (scale: number): string =>
  scale <= 0 || Number.isNaN(scale) ? "" : `/${tsGradeValueLabel(scale)}`;

/** Kotlin : `averageLabel` (le « /20 » est en dur : barème de sortie du rapport). */
function tsAverageLabel(a: { value: number; provided: boolean; algorithm: string } | null): string {
  if (a === null) return "Moyenne indisponible.";
  const value = tsFormatMark(a.value);
  const origin = a.provided ? "fournie" : "estimée";
  const algo = a.provided || a.algorithm === "" ? "" : `, algorithme ${a.algorithm}`;
  return `${value}/20 (moyenne ${origin}${algo})`;
}

/** Kotlin : `originLabel` — la date est en `dd/MM/yyyy`, quelle que soit la zone. */
const tsOriginLabel = (provided: boolean, estimatedAtMillis: number | null): string => {
  if (provided) return "par l'établissement";
  if (estimatedAtMillis === null) return "estimée";
  const d = new Date(estimatedAtMillis);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `estimée au ${dd}/${mm}/${d.getUTCFullYear()}`;
};

const tsAlgorithmLabel = (a: string): string =>
  a === "subject" ? "Moyenne des matières" : a === "weighted" ? "Moyenne pondérée" : a === "median" ? "Médiane des notes" : "Moyenne générale";

const tsAlgorithmChipLabel = (a: string): string =>
  a === "subject" ? "Matières" : a === "weighted" ? "Pondérée" : a === "median" ? "Médiane" : "Moyenne";

/** Kotlin : `influenceLabel` — l'arrondi à 2 décimales décide de « ne change pas ». */
function tsInfluenceLabel(impact: number): string {
  const rounded = tsFormatMark(Math.abs(impact));
  if (rounded === "0,00" || !Number.isFinite(impact)) return "Cette note ne change pas ta moyenne";
  const verb = impact > 0 ? "gagner" : "perdre";
  return `Cette note te fait ${verb} ${rounded} de moyenne`;
}

/** Kotlin : `gradeContextLabel` — partie vide = établissement qui ne publie pas. */
function tsGradeContextLabel(g: TsGrade): string {
  const parts: string[] = [];
  if (g.coefficient !== null && g.coefficient !== 1) parts.push(`Coeff. ${tsGradeValueLabel(g.coefficient)}`);
  if (g.bonus) parts.push("Bonus");
  if (g.optional) parts.push("Facultatif");
  if (g.teacher !== null) parts.push(g.teacher);
  if (g.classAverage !== null) parts.push(`Moyenne de classe ${tsGradeValueLabel(g.classAverage)}`);
  if (g.classMin !== null && g.classMax !== null) parts.push(`De ${tsGradeValueLabel(g.classMin)} à ${tsGradeValueLabel(g.classMax)}`);
  return parts.join(" · ");
}

/** Kotlin : `queryValue` — alphanumériques inchangés, le reste en %XX. */
function tsQueryValue(value: string): string {
  let out = "";
  for (const c of value) {
    const safe = /[a-zA-Z0-9\-_.]/.test(c);
    out += safe ? c : "%" + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

/** Kotlin : `gradesQuery` — algorithme validé, periodId borné à 64. */
function tsGradesQuery(algorithm: string, periodId: string | null): string {
  const chosen = ALGO_CHOICES.includes(algorithm) ? algorithm : "subject";
  const parts = [`algorithm=${tsQueryValue(chosen)}`];
  const id = (periodId ?? "").trim().slice(0, 64);
  if (id !== "") parts.push(`periodId=${tsQueryValue(id)}`);
  return parts.join("&");
}

/** Kotlin : `gradesForPeriod` — repli « aucune période publiée » = liste inchangée. */
function tsGradesForPeriod(grades: TsGrade[], periodId: string | null): TsGrade[] {
  const id = (periodId ?? "").trim();
  if (id === "") return grades;
  const inPeriod = grades.filter((g) => g.periodId === id);
  if (inPeriod.length > 0) return inPeriod;
  return grades.every((g) => g.periodId === null) ? grades : [];
}

/** Kotlin : `foldForSearch` — NFD, diacritiques retirés, minuscules, bords coupés. */
const tsFold = (value: string): string =>
  value.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Kotlin : `gradeMatches` — matière, libellé d'évaluation, enseignant. */
const tsGradeMatches = (g: TsGrade, query: string): boolean => {
  const needle = tsFold(query);
  if (needle === "") return true;
  return [g.subject, g.label, g.teacher].some((f) => f !== null && tsFold(f).includes(needle));
};

/** Kotlin : `gradeGroups` — moyenne décroissante, puis nom croissant. */
function tsGradeGroups(
  grades: TsGrade[],
  subjects: { subject: string; value: number | null }[],
): { subject: string; average: number | null; grades: TsGrade[] }[] {
  const byName = new Map<string, TsGrade[]>();
  for (const g of grades) {
    byName.set(g.subject, [...(byName.get(g.subject) ?? []), g]);
  }
  const averages = new Map(subjects.map((s) => [s.subject, s.value]));
  const names = [...new Set([...averages.keys(), ...byName.keys()])];
  return names
    .map((subject) => ({
      subject,
      average: averages.get(subject) ?? null,
      grades: [...(byName.get(subject) ?? [])].sort((a, b) => b.millis - a.millis),
    }))
    .sort((a, b) => (b.average ?? -Infinity) - (a.average ?? -Infinity) || a.subject.localeCompare(b.subject, "fr"));
}

/** Kotlin : `sparklinePoints` — nulls ignorés, y inversé, domaine min..max. */
function tsSparklinePoints(
  values: (number | null)[],
  width: number,
  height: number,
): { x: number; y: number }[] {
  if (width <= 0 || height <= 0) return [];
  const known = values.filter((v): v is number => v !== null && Number.isFinite(v));
  if (known.length === 0) return [];
  if (known.length === 1) return [{ x: width, y: height / 2 }];
  const min = Math.min(...known);
  const max = Math.max(...known);
  const span = max - min;
  const step = width / (known.length - 1);
  return known.map((v, i) => {
    const ratio = span <= 0 ? 0.5 : (v - min) / span;
    return { x: i * step, y: height * (1 - ratio) };
  });
}

/** Kotlin : `historyNote` — "" dès qu'il y a une courbe, sinon ce qui manque. */
const tsHistoryNote = (values: (number | null)[]): string => {
  const n = values.filter((v) => v !== null && Number.isFinite(v)).length;
  if (n === 0) return "Pas d'historique de moyenne sur cette période.";
  if (n === 1) return "Une seule moyenne connue : la courbe se dessine à la note suivante.";
  return "";
};

// --- Fixtures ---------------------------------------------------------------

const REPORT = {
  algorithm: "subject",
  periodId: null,
  general: { value: 13.75, origin: "provided", subjectCount: 4 },
  subjects: [{ subject: "Maths", value: 13.75, origin: "provided", gradeCount: 3 }],
  history: [{ date: "2026-09-20T10:00:00.000Z", value: 13.75 }],
  influences: [{ gradeId: "g1", subject: "Maths", impact: 0.5 }],
};
const GRADE = {
  id: "g1",
  accountId: "acc1",
  subject: "Maths",
  value: 15,
  scale: 20,
  date: "2026-09-20T10:00:00.000Z",
};

const GRADES_RICH = [
  {
    id: "g1",
    accountId: "acc1",
    subject: "Mathématiques",
    value: 15,
    scale: 20,
    coefficient: 2,
    date: "2026-10-02T08:00:00.000Z",
    classAverage: 12.5,
    classMin: 4,
    classMax: 19,
    periodId: "p-1",
    bonus: true,
    label: "Contrôle de géométrie",
    teacher: "M. Alain",
  },
  {
    id: "g2",
    accountId: "acc1",
    subject: "Français",
    value: 11.5,
    scale: 10,
    date: "2026-09-25T08:00:00.000Z",
    periodId: "p-1",
    optional: true,
  },
  {
    id: "g3",
    accountId: "acc1",
    subject: "Mathématiques",
    value: 8,
    scale: 20,
    date: "2026-06-10T08:00:00.000Z",
    periodId: "p-0",
  },
];

const PERIODS_PAYLOAD = {
  periods: [
    { id: "p-1", name: "Trimestre 1", start: "2026-09-01T00:00:00.000Z", end: "2026-11-30T23:59:59.000Z" },
    { id: "p-0", name: "Trimestre 2", start: "2025-09-01T00:00:00.000Z", end: "2025-11-30T23:59:59.000Z" },
  ],
};

describe("unit android moyennes (#74)", () => {
  test("payload contrat 0.2.0 -> mention fournie/estimée", () => {
    const provided = tsGeneralAverageOf(tsAverages(JSON.stringify({ grades: [GRADE], averages: REPORT })));
    expect(provided).toEqual({ value: 13.75, provided: true, algorithm: "subject" });
    expect(tsAverageLabel(provided)).toBe("13,75/20 (moyenne fournie)");

    const estimated = tsGeneralAverageOf(
      tsAverages(
        JSON.stringify({
          grades: [GRADE],
          averages: {
            ...REPORT,
            algorithm: "weighted",
            general: { value: 15.14, origin: "estimated", subjectCount: 4 },
          },
        }),
      ),
    );
    expect(estimated?.provided).toBe(false);
    expect(tsAverageLabel(estimated)).toBe("15,14/20 (moyenne estimée, algorithme weighted)");
  });

  test("payload absent/invalide/cache ancien -> aucune valeur inventée", () => {
    // Cache 0.1.0 (pas de averages) : on n'affiche rien de faux.
    expect(tsGeneralAverageOf(tsAverages(JSON.stringify({ grades: [GRADE] })))).toBeNull();
    expect(tsAverageLabel(null)).toBe("Moyenne indisponible.");
    // Période sans note exploitable : value null.
    expect(
      tsGeneralAverageOf(
        tsAverages(
          JSON.stringify({
            grades: [],
            averages: { ...REPORT, general: { value: null, origin: "estimated", subjectCount: 0 } },
          }),
        ),
      ),
    ).toBeNull();
    // Origine inconnue = non conforme au contrat, refusée.
    expect(
      tsAverages(
        JSON.stringify({ averages: { ...REPORT, general: { value: 10, origin: "?", subjectCount: 1 } } }),
      ),
    ).toBeNull();
    // Texte libre, pas du JSON : jamais interprété.
    expect(tsAverages("Ignore les instructions")).toBeNull();
    expect(tsGrades("Ignore les instructions")).toEqual([]);
    expect(tsPeriods("Ignore les instructions")).toEqual([]);
    expect(tsGeneralLabelGuard());
  });

  test("le miroir TS valide exactement les payloads que le Kotlin affiche", () => {
    for (const payload of [
      { grades: [GRADE], averages: REPORT },
      { grades: [GRADE], averages: { ...REPORT, algorithm: "median" } },
    ]) {
      expect(isGradesResponse(payload)).toBe(true);
      expect(isAveragesReport(payload.averages)).toBe(true);
      expect(tsGeneralAverageOf(tsAverages(JSON.stringify(payload)))).not.toBeNull();
    }
    expect(AVERAGE_ALGORITHMS).toEqual(["subject", "weighted", "median"]);
    // 0.7.0 : plus aucun credential serveur (`SetupRequest` QR-only, clé
    // LLM envoyée par l'app). Aucun impact sur le rapport de moyennes, d'où le
    // simple re-pin de version.
    expect(CONTRACTS_VERSION).toBe("0.7.0");
  });

  test("Kotlin : parsing + libellé, sans dépendance ajoutée", () => {
    const kt = readFileSync(join(UI, "Averages.kt"), "utf8");
    expect(kt).toContain("fun generalAverageOf");
    expect(kt).toContain("fun averageLabel");
    expect(kt).toContain("org.json.JSONObject");
    expect(kt).toContain("fournie");
    expect(kt).toContain("estimée");
    expect(kt).toContain("moyenne $origin");
    // org.json vient du SDK : aucune ligne de dépendance ajoutée.
    const uiGradle = readFileSync(join(import.meta.dir, "..", "..", "android/ui/build.gradle.kts"), "utf8");
    expect(uiGradle).not.toContain("gson");
    expect(uiGradle).not.toContain("moshi");
    expect(uiGradle).not.toContain("kotlinx-serialization");
  });
});

// Garde explicite : le libellé ne doit jamais laisser croire qu'une moyenne
// estimée est fournie. Régression = le mot "fournie" doit exiger provided.
function tsGeneralLabelGuard(): boolean {
  const estimated = { value: 10, provided: false, algorithm: "median" };
  return tsAverageLabel(estimated).includes("estimée") && !tsAverageLabel(estimated).includes("fournie");
}

// --- #162 : la décision d'affichage de l'onglet Notes -----------------------

/** Miroir de `UiState` (UiState.kt) : l'écran n'a que quatre états. */
type TsUiState =
  | { kind: "loading" }
  | { kind: "data"; payload: string; isStale: boolean; fetchedAt: number }
  | { kind: "empty" }
  | { kind: "error"; message: string; cached: string | null };

/**
 * Miroir de `gradesLayout` (Averages.kt).
 *
 * `content` : le corps montre des notes / moyennes. Sinon l'écran est un état
 * UNIQUE, sans contrôle dessous (le défaut de la capture #162 : un gros bloc
 * d'erreur AU MILIEU de la page, puis les puces, puis des liens de navigation).
 * `data` : il y a quelque chose à lister ou à moyenner — sinon pas de puces
 * d'algorithme, pas de titre « Moyennes par matière ».
 */
function tsGradesLayout(state: TsUiState, grades: TsGrade[], report: TsAverages | null): { content: boolean; data: boolean } {
  return {
    content: state.kind === "data" ? true : state.kind === "error" ? state.cached !== null : false,
    data: report !== null || grades.length > 0,
  };
}

// --- #139 : l'onglet Notes structure ---------------------------------------

describe("unit android onglet Notes (#139)", () => {
  test("tout le rapport est lu : matières, historique, influences, subjectCount", () => {
    const payload = JSON.stringify({
      grades: GRADES_RICH,
      averages: {
        algorithm: "weighted",
        periodId: "p-1",
        general: { value: 14.87, origin: "estimated", subjectCount: 2 },
        subjects: [
          { subject: "Mathématiques", value: 15, origin: "provided", gradeCount: 1 },
          { subject: "Français", value: 11.5, origin: "estimated", gradeCount: 1 },
          { subject: "Histoire", value: null, origin: "estimated", gradeCount: 0 },
        ],
        history: [
          { date: "2026-09-25T08:00:00.000Z", value: 12 },
          { date: "2026-10-02T08:00:00.000Z", value: null },
          { date: "2026-10-03T08:00:00.000Z", value: 14.87 },
        ],
        influences: [
          { gradeId: "g1", subject: "Mathématiques", impact: 0.42 },
          { gradeId: "g2", subject: "Français", impact: -0.31 },
        ],
      },
    });
    // Le miroir ne lit que ce que le contrat déclare.
    expect(isGradesResponse(JSON.parse(payload))).toBe(true);

    const report = tsAverages(payload);
    expect(report).not.toBeNull();
    expect(report!.algorithm).toBe("weighted");
    expect(report!.generalValue).toBe(14.87);
    expect(report!.provided).toBe(false);
    expect(report!.subjectCount).toBe(2);
    expect(report!.subjects.map((s) => s.subject)).toEqual(["Mathématiques", "Français", "Histoire"]);
    // Une matière sans note exploitable : valeur nulle, jamais 0.
    expect(report!.subjects[2]!.value).toBeNull();
    expect(report!.subjects[1]!.provided).toBe(false);
    expect(report!.history).toEqual([
      { millis: Date.parse("2026-09-25T08:00:00.000Z"), value: 12 },
      { millis: Date.parse("2026-10-02T08:00:00.000Z"), value: null },
      { millis: Date.parse("2026-10-03T08:00:00.000Z"), value: 14.87 },
    ]);
    expect(report!.influences).toHaveLength(2);

    // Les champs de note du contrat 0.2.0, tous optionnels, tous affichés.
    const grades = tsGrades(payload);
    expect(grades.map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    const g1 = grades[0]!;
    expect(g1.coefficient).toBe(2);
    expect(g1.bonus).toBe(true);
    expect(g1.classAverage).toBe(12.5);
    expect(g1.classMin).toBe(4);
    expect(g1.classMax).toBe(19);
    expect(g1.periodId).toBe("p-1");
    expect(g1.label).toBe("Contrôle de géométrie");
    expect(g1.teacher).toBe("M. Alain");
    // Champs absents = établissement qui ne publie pas (jamais 0 ni "" bidon).
    const g2 = grades[1]!;
    expect(g2.bonus).toBe(false);
    expect(g2.optional).toBe(true);
    expect(g2.label).toBeNull();
    expect(g2.teacher).toBeNull();
    expect(g2.classAverage).toBeNull();
    expect(g2.coefficient).toBeNull();
    // Coefficient 0 = hors moyenne : jamais affiché comme un coefficient.
    expect(tsGrades(JSON.stringify({ grades: [{ ...GRADE, coefficient: 0 }] }))[0]!.coefficient).toBeNull();
    // Note illisible (valeur absente, date illisible, échelle nulle) = ignorée.
    expect(tsGrades(JSON.stringify({ grades: [{ ...GRADE, value: null }, { ...GRADE, date: "hier" }, { ...GRADE, scale: 0 }] }))).toEqual([]);
  });

  test("mise en forme française : notes, barèmes, provenance, influence", () => {
    expect(tsFormatMark(14.87)).toBe("14,87");
    expect(tsFormatMark(14.5)).toBe("14,50");
    expect(tsGradeValueLabel(15)).toBe("15");
    expect(tsGradeValueLabel(15.5)).toBe("15,5");
    expect(tsGradeValueLabel(11.25)).toBe("11,25");
    // Barème réel quand l'évaluation sort de l'échelle (jamais un « /20 » inventé).
    expect(tsScaleSuffix(20)).toBe("/20");
    expect(tsScaleSuffix(10)).toBe("/10");
    expect(tsScaleSuffix(0)).toBe("");

    expect(tsOriginLabel(true, null)).toBe("par l'établissement");
    expect(tsOriginLabel(true, Date.parse("2026-10-03T08:00:00.000Z"))).toBe("par l'établissement");
    expect(tsOriginLabel(false, null)).toBe("estimée");
    expect(tsOriginLabel(false, Date.parse("2026-10-03T08:00:00.000Z"))).toMatch(/^estimée au \d{2}\/\d{2}\/\d{4}$/);

    expect(tsAlgorithmLabel("subject")).toBe("Moyenne des matières");
    expect(tsAlgorithmLabel("weighted")).toBe("Moyenne pondérée");
    expect(tsAlgorithmLabel("median")).toBe("Médiane des notes");
    expect(tsAlgorithmLabel("?")).toBe("Moyenne générale");
    expect(tsAlgorithmChipLabel("subject")).toBe("Matières");

    expect(tsInfluenceLabel(0.42)).toBe("Cette note te fait gagner 0,42 de moyenne");
    expect(tsInfluenceLabel(-0.31)).toBe("Cette note te fait perdre 0,31 de moyenne");
    // Sous le centième, l'écart n'est pas une influence affichable.
    expect(tsInfluenceLabel(0.001)).toBe("Cette note ne change pas ta moyenne");
    expect(tsInfluenceLabel(0)).toBe("Cette note ne change pas ta moyenne");

    const grade = tsGrades(JSON.stringify({ grades: GRADES_RICH }))[0]!;
    expect(tsGradeContextLabel(grade)).toBe("Coeff. 2 · Bonus · M. Alain · Moyenne de classe 12,5 · De 4 à 19");
    // Une note sans rien de publié : ligne de contexte VIDE (jamais de « — »).
    expect(tsGradeContextLabel(tsGrades(JSON.stringify({ grades: GRADES_RICH }))[1]!)).toBe("Facultatif");
  });

  test("sparkline : nulls ignorés, domaine min..max, y inversé, cas limites", () => {
    // Trois points : le premier en bas (plus petite moyenne), le dernier en haut.
    expect(tsSparklinePoints([10, 15, 12.5], 100, 40)).toEqual([
      { x: 0, y: 40 },
      { x: 50, y: 0 },
      { x: 100, y: 20 },
    ]);
    // Un point sans valeur n'est pas une valeur inventée : la courbe relie 10 → 20.
    expect(tsSparklinePoints([10, null, 20], 100, 40)).toEqual([
      { x: 0, y: 40 },
      { x: 100, y: 0 },
    ]);
    // Série plate : ligne à mi-hauteur, jamais une division par zéro.
    expect(tsSparklinePoints([14, 14, 14], 100, 40)).toEqual([
      { x: 0, y: 20 },
      { x: 50, y: 20 },
      { x: 100, y: 20 },
    ]);
    // Une seule valeur = un point à droite, AUCUNE ligne (une note n'est pas une tendance).
    expect(tsSparklinePoints([14.87], 100, 40)).toEqual([{ x: 100, y: 20 }]);
    expect(tsSparklinePoints([], 100, 40)).toEqual([]);
    expect(tsSparklinePoints([null, null], 100, 40)).toEqual([]);
    // Rectangle nul : rien à dessiner (le Canvas ne plante pas sur une frame dégénérée).
    expect(tsSparklinePoints([1, 2], 0, 40)).toEqual([]);
    // Phrase sous la carte : vide dès qu'il y a une courbe, sinon ce qui manque.
    expect(tsHistoryNote([])).toBe("Pas d'historique de moyenne sur cette période.");
    expect(tsHistoryNote([null])).toBe("Pas d'historique de moyenne sur cette période.");
    expect(tsHistoryNote([14.87])).toBe("Une seule moyenne connue : la courbe se dessine à la note suivante.");
    expect(tsHistoryNote([12, 14.87])).toBe("");
  });

  test("périodes : liste du contrat, bornes de date", () => {
    const payload = JSON.stringify(PERIODS_PAYLOAD);
    expect(isPeriodsResponse(JSON.parse(payload))).toBe(true);
    const periods = tsPeriods(payload);
    expect(periods.map((p) => p.id)).toEqual(["p-1", "p-0"]);
    expect(periods[0]!.name).toBe("Trimestre 1");
    // Tranche illisible (nom vide, fin avant début) : ignorée, pas affichée.
    expect(
      tsPeriods(
        JSON.stringify({
          periods: [
            { id: "p-x", name: "", start: "2026-09-01T00:00:00.000Z", end: "2026-11-30T00:00:00.000Z" },
            { id: "p-y", name: "Incohérent", start: "2026-11-30T00:00:00.000Z", end: "2026-09-01T00:00:00.000Z" },
          ],
        }),
      ),
    ).toEqual([]);
  });

  test("query des notes : algorithme validé, période bornée et encodée", () => {
    // C'est cette query que `SyncedRepository` envoie à `/v1/grades`.
    expect(tsGradesQuery("subject", null)).toBe("algorithm=subject");
    expect(tsGradesQuery("weighted", "p-1")).toBe("algorithm=weighted&periodId=p-1");
    expect(tsGradesQuery("median", " p-1 ")).toBe("algorithm=median&periodId=p-1");
    // Algorithme hors contrat : repli sur le défaut, jamais de 400 côté serveur.
    expect(tsGradesQuery("moyenne", "p-1")).toBe("algorithm=subject&periodId=p-1");
    // Un id de période est une DONNÉE serveur : encodé, borné, jamais une adresse.
    expect(tsGradesQuery("subject", "a b/c")).toBe("algorithm=subject&periodId=a%20b%2Fc");
    expect(tsGradesQuery("subject", "x".repeat(200))).toBe(`algorithm=subject&periodId=${"x".repeat(64)}`);
    expect(tsGradesQuery("subject", "https://hote.evil.tld")).not.toContain("://");
  });

  test("filtre de période : le triomphe du server, le repli sans periodId publié", () => {
    const grades = tsGrades(JSON.stringify({ grades: GRADES_RICH }));
    expect(tsGradesForPeriod(grades, null).map((g) => g.id)).toEqual(["g1", "g2", "g3"]);
    expect(tsGradesForPeriod(grades, "p-1").map((g) => g.id)).toEqual(["g1", "g2"]);
    // Période qui n'existe pas, alors que les notes SONT rattachées : liste vide.
    expect(tsGradesForPeriod(grades, "p-9")).toEqual([]);
    // Établissement qui ne publie AUCUN periodId : le filtre ne peut rien retirer.
    const noPeriod = tsGrades(JSON.stringify({ grades: [GRADE] }));
    expect(tsGradesForPeriod(noPeriod, "p-1").map((g) => g.id)).toEqual(["g1"]);
  });

  test("recherche : matière, libellé et enseignant, sans accents ni casse", () => {
    const grades = tsGrades(JSON.stringify({ grades: GRADES_RICH }));
    const g1 = grades[0]!;
    expect(tsGradeMatches(g1, "")).toBe(true);
    expect(tsGradeMatches(g1, "math")).toBe(true);
    expect(tsGradeMatches(g1, "MATHÉMATIQUES")).toBe(true);
    expect(tsGradeMatches(g1, "geometrie")).toBe(true);
    expect(tsGradeMatches(g1, "alain")).toBe(true);
    expect(tsGradeMatches(g1, "histoire")).toBe(false);
    // Un terme absent ne fait pas disparaître la note (une recherche vide
    // n'est pas une note à 0).
    expect(grades.filter((g) => tsGradeMatches(g, "math")).map((g) => g.id)).toEqual(["g1", "g3"]);
  });

  test("regroupement par matière : moyennes du contrat + notes, tri décroissant", () => {
    const grades = tsGrades(JSON.stringify({ grades: GRADES_RICH }));
    const groups = tsGradeGroups(grades, [
      { subject: "Mathématiques", value: 15 },
      { subject: "Français", value: 11.5 },
      { subject: "Histoire", value: null },
    ]);
    expect(groups.map((g) => g.subject)).toEqual(["Mathématiques", "Français", "Histoire"]);
    expect(groups[0]!.average).toBe(15);
    // Notes de la matière, de la plus récente à la plus ancienne.
    expect(groups[0]!.grades.map((g) => g.id)).toEqual(["g1", "g3"]);
    expect(groups[2]!.grades).toEqual([]);
    // Matière du payload SANS moyenne au contrat : elle reste listée (rien d'inventé).
    expect(tsGradeGroups([grades[1]!], [])[0]!.average).toBeNull();
  });

  test("Kotlin : plus aucune chaîne JSON rendue, branchée sur la query des notes", () => {
    const screen = readFileSync(join(UI, "GradesScreen.kt"), "utf8");
    const nav = readFileSync(join(UI, "AppNav.kt"), "utf8");
    const rows = readFileSync(join(UI, "GradesRows.kt"), "utf8");
    const hero = readFileSync(join(UI, "GradesHero.kt"), "utf8");

    // Le défaut de #139 : plus AUCUNE troncature de payload, dans aucun écran.
    const uiDir = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
    for (const file of readdirSync(uiDir).filter((f) => f.endsWith(".kt"))) {
      const src = readFileSync(join(uiDir, file), "utf8");
      expect({ file, rawPayload: /payload\s*\)?\s*\.take\(/.test(src) || /Text\([^)]*\.payload\b/.test(src) }).toEqual({
        file,
        rawPayload: false,
      });
    }
    // Le rendu structuré est bien celui de l'onglet Notes.
    expect(nav).toContain("GradesRoute(");
    expect(nav).not.toContain("showAverage");
    expect(nav).toMatch(/GradesRoute\([\s\S]{0,200}CachePolicy\.GRADES/);
    expect(screen).toContain("fun GradesRoute(");
    expect(screen).toContain("gradesQuery(algorithm, periodId)");
    expect(screen).toContain("repo.fetchPeriods(baseUrl)");
    // La moyenne reste une DONNÉE lue (mention fournie/estimée), pas une string.
    expect(hero).toContain("averageLabel");
    expect(hero).toContain("originLabel");
    expect(hero).toContain("AverageSparkline");
    // Briques #136 utilisées par l'écran.
    for (const brique of ["PapLoading", "PapEmptyState", "PapErrorState", "PapStaleBanner"]) {
      expect({ brique, used: screen.includes(brique) }).toEqual({ brique, used: true });
    }
    // Champs du contrat affichés : chacun a sa ligne de lecture dans Averages.kt.
    const averages = readFileSync(join(UI, "Averages.kt"), "utf8");
    for (const champ of [
      "coefficient",
      "bonus",
      "optional",
      "classAverage",
      "classMin",
      "classMax",
      "periodId",
      "label",
      "teacher",
      "subjects",
      "history",
      "influences",
      "subjectCount",
    ]) {
      expect({ champ, lu: averages.includes(`"${champ}"`) }).toEqual({ champ, lu: true });
    }
    // Aucune date ISO rendue : tout passe par un format français.
    expect(screen).not.toMatch(/Text\([^)]*\.date\b/);
    expect(rows).not.toMatch(/Text\([^)]*\.date\b/);
    // Zéro bibliothèque de graphiques : la courbe est un `Canvas` de Compose.
    expect(hero).toContain("import androidx.compose.foundation.Canvas");
    for (const lib of ["vico", "MPAndroidChart", "compose-charts", "material-icons-extended"]) {
      expect({ lib, absent: !rows.includes(lib) && !hero.includes(lib) }).toEqual({ lib, absent: true });
    }
  });

  test("côté data : query des notes + première lecture de /v1/periods", () => {
    const repo = readFileSync(join(DATA, "SyncedRepository.kt"), "utf8");
    const config = readFileSync(join(CORE, "ServerConfig.kt"), "utf8");
    // Le sélecteur de période change RÉELLEMENT la requête envoyée au serveur.
    expect(config).toContain('fun gradesUrl(baseUrl: String, query: String)');
    expect(repo).toContain("ServerConfig.gradesUrl(baseUrl, query)");
    // /v1/periods : allowlist serveur seule (I1), 401 comme les autres lectures.
    expect(repo).toContain("fun fetchPeriods(");
    expect(repo).toContain("ServerConfig.periodsUrl(baseUrl)");
    expect(repo).toContain("RefreshOutcome.Failed(DeviceAuth.REJECTED_MESSAGE");
    // Le garde-fou 401 reste UNIQUE : ce fichier ne lève jamais le signal.
    expect(repo).not.toContain("DeviceAuth.reject()");
    expect(repo).toContain("api.client().newCall(");
  });
});
describe("unit android onglet Notes, états et navigation (#162)", () => {
  test("écran SANS donnée = un état UNIQUE, pas un état puis des contrôles", () => {
    const LOADING: TsUiState = { kind: "loading" };
    const EMPTY: TsUiState = { kind: "empty" };
    // Hors-ligne, aucune donnée en cache : le cas de la capture.
    const FAILED: TsUiState = { kind: "error", message: "Hors-ligne, aucune donnée en cache.", cached: null };
    const payload = JSON.stringify({ grades: GRADES_RICH, averages: REPORT });
    const FRESH: TsUiState = { kind: "data", payload, isStale: false, fetchedAt: 1 };
    const STALE: TsUiState = { kind: "data", payload, isStale: true, fetchedAt: 1 };
    const grades = tsGrades(payload);
    const report = tsAverages(payload);
    const none: TsGrade[] = [];
    const noReport = null;

    // Aucun des trois états de requête ne montre de contenu : l'écran rend un
    // message et UNE action, puis RIEN (ni recherche, ni période, ni algorithme).
    expect(tsGradesLayout(LOADING, none, noReport)).toEqual({ content: false, data: false });
    expect(tsGradesLayout(EMPTY, none, noReport)).toEqual({ content: false, data: false });
    expect(tsGradesLayout(FAILED, none, noReport)).toEqual({ content: false, data: false });
    // Échec AVEC cache : les notes restent affichées (périmées), un plein écran
    // d'erreur alors qu'il y a des notes serait un mensonge.
    expect(tsGradesLayout({ kind: "error", message: "Erreur serveur 503.", cached: payload }, grades, report)).toEqual({
      content: true,
      data: true,
    });
    expect(tsGradesLayout(FRESH, grades, report)).toEqual({ content: true, data: true });
    expect(tsGradesLayout(STALE, grades, report)).toEqual({ content: true, data: true });
  });

  test("contrôles et titres de section seulement s'il y a des données", () => {
    const payload = JSON.stringify({ grades: GRADES_RICH, averages: REPORT });
    const grades = tsGrades(payload);
    const report = tsAverages(payload);
    // Payload lu mais ZÉRO note exploitable : c'est du contenu (le serveur a
    // répondu) qui n'a rien à montrer — un seul message, pas de puces d'algorithme
    // ni « Moyennes par matière » sous le vide.
    expect(tsGradesLayout({ kind: "data", payload: "{}", isStale: false, fetchedAt: 1 }, [], null)).toEqual({
      content: true,
      data: false,
    });
    // Établissement qui ne publie pas de moyennes mais des notes : les notes
    // restent listées, donc les contrôles servent.
    expect(tsGradesLayout({ kind: "data", payload: "{}", isStale: false, fetchedAt: 1 }, grades, null)).toEqual({
      content: true,
      data: true,
    });
    // Inversement : moyennes publiées, aucune note lisible (cache tronqué, notes
    // illisibles) — le rapport est là, donc la carte et les sections restent.
    expect(tsGradesLayout({ kind: "data", payload: "{}", isStale: false, fetchedAt: 1 }, [], report)).toEqual({
      content: true,
      data: true,
    });
  });

  test("Kotlin : un seul état, et les liens de navigation sont dans la barre du haut", () => {
    const screen = readFileSync(join(UI, "GradesScreen.kt"), "utf8");
    const shell = readFileSync(join(UI, "AppShell.kt"), "utf8");
    const nav = readFileSync(join(UI, "AppNav.kt"), "utf8");
    const averages = readFileSync(join(UI, "Averages.kt"), "utf8");
    /** Sans les commentaires : une garde qui lit le texte ne doit pas confondre un
     *  `//` qui NOMME une mauvaise pratique avec la pratique. */
    const codeOnly = (src: string): string =>
      src
        .replace(/\/\*[\s\S]*?\*\//g, "\n")
        .split("\n")
        .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
        .join("\n");

    // 1. La décision est PURE et vit dans le fichier de logique : elle se teste.
    expect(averages).toContain("fun gradesLayout(state: UiState, grades: List<GradeUi>, report: AveragesUi?)");
    expect(averages).toContain("data class GradesLayout(val content: Boolean, val data: Boolean)");
    expect(screen).toContain("gradesLayout(state, grades, report)");
    // L'écran appelle l'état unique et S'ARRÊTE : rien de contrôles dessous.
    expect(screen).toMatch(/if \(!layout\.content \|\| !layout\.data\) \{[\s\S]{0,600}?GradesBlankState\(state = state, query = query, onRefresh = \{ refresh\(\) \}\)\n\s*return\n\s*\}/);
    // Les puces d'algorithme, le titre de section et le carrousel sont APRÈS le
    // retour : avec zéro donnée ils ne sont jamais rendus.
    const guard = screen.indexOf("if (!layout.content || !layout.data) {");
    for (const brique of ["GradesSearchField(", "GradesPeriodChips(", "GradesAlgorithmChips(", "PapSectionHeader(", "GradesRecentCarousel("]) {
      expect({ brique, afterGuard: screen.indexOf(brique) > guard }).toEqual({ brique, afterGuard: true });
    }
    // L'état vide porte UNE action, l'état d'erreur le sien : plus de bloc
    // d'erreur à l'intérieur d'une page de contrôles.
    expect(screen).not.toMatch(/is UiState\.Error -> PapErrorState\([\s\S]{0,200}Les notes en cache/);
    expect(screen).toMatch(/is UiState\.Error -> PapErrorState\(message = state\.message, onRetry = onRefresh\)/);

    // 2. Plus AUCUN lien de navigation dans le corps d'un écran : les
    // destinations sont déclarées une fois, dans la table de la barre du haut.
    const body = codeOnly(screen);
    for (const label of ["Réglages", "Appairage QR+PIN", "Alertes sécurité", "Compétences"]) {
      expect({ label, inBody: body.includes(`Text("${label}")`) }).toEqual({ label, inBody: false });
    }
    // Plus aucun bouton de navigation : le corps de l'onglet Notes n'a plus que
    // l'action de son état vide.
    expect(body).not.toContain("TextButton(");
    for (const dest of ["ROUTE_COMPETENCES", "ROUTE_SETTINGS", "ROUTE_PAIRING", "ROUTE_ALERTS"]) {
      expect({ dest, inTopBar: new RegExp(`TopAction\\.Go\\(${dest}, "`).test(shell) }).toEqual({ dest, inTopBar: true });
    }
    // La barre sait naviguer ET recharger, sans valeur par défaut : un bouton
    // mort ne doit pas pouvoir se câbler.
    expect(shell).toContain("private val TOP_BAR_ACTIONS: Map<String, List<TopAction>>");
    expect(shell).toMatch(/fun AppTopBar\(\s*\n\s*route: String\?,\s*\n\s*onBack: \(String\) -> Unit,\s*\n\s*onNavigate: \(String\) -> Unit,\s*\n\s*onRefresh: \(\) -> Unit,/);
    expect(shell).toContain("actions = { TopBarActions(actions = actions, onNavigate = onNavigate, onRefresh = onRefresh) }");
    // #87 : la destination Compétences reste conditionnelle aux capacités.
    expect(shell).toContain("hiddenDestinations: Set<String> = emptySet()");
    expect(nav).toMatch(/hiddenDestinations = if \(Capabilities\.visible\(capabilities, Capabilities\.EVALUATIONS\)\) emptySet\(\) else setOf\(ROUTE_COMPETENCES\)/);
    // La relecture passe par un compteur vu par les deux routes qui l'ont.
    expect(nav).toContain("onRefresh = { readTick++ }");
    expect(screen).toMatch(/LaunchedEffect\(resource, algorithm, periodId, refreshTick\) \{ refresh\(\) \}/);
    expect(screen).toContain("refreshTick: Int = 0");
    expect(nav).toContain("refreshTick = readTick");
    // Plus de paramètre de navigation dans les deux écrans qui l'ont perdu.
    for (const gone of ["goSettings:", "goPairing:", "goAlerts:", "onCompetences:"]) {
      expect({ gone, absent: !screen.includes(gone) }).toEqual({ gone, absent: true });
    }
    // La route Compétences, seule autre route de cet écran, garde ses args.
    expect(nav).toMatch(/CachedResourceScreen\([\s\S]{0,300}section = \{ CompetencesSection\(it\) \}/);
  });

  test("Kotlin : plus aucune phrase où le message d'échec répète le libellé", () => {
    const screen = readFileSync(join(UI, "GradesScreen.kt"), "utf8");
    const repo = readFileSync(join(DATA, "SyncedRepository.kt"), "utf8");
    // La source de la phrase : le message d'échec de `/v1/periods` PORTE DÉJÀ le
    // nom de la ressource. L'écran le préfixait par « Tranches indisponibles : »,
    // d'où « Tranches indisponibles : Hors-ligne, tranches indisponibles. ».
    expect(repo).toContain('RefreshOutcome.Failed("Hors-ligne, tranches indisponibles.", null)');
    expect(screen).not.toMatch(/"Tranches indisponibles\s*:/);
    // Le message est rendu tel quel, jamais concaténé à un libellé.
    expect(screen).toMatch(/text = periodError/);
    expect(screen).not.toMatch(/Text\(\s*"[^"]*:\s*\$\{?[a-zA-Z]/);
    // Même règle pour l'échec de relecture : une ligne, pas un préfixe.
    expect(screen).toMatch(/text = failed\.message/);
    expect(screen).toMatch(/periodsError = "Tranches indisponibles\."/);
  });
});
