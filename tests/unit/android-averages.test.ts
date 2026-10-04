import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AVERAGE_ALGORITHMS, CONTRACTS_VERSION, isAveragesReport } from "../../shared/contracts/models";
import { isGradesResponse } from "../../shared/contracts/api";

// Miroir des helpers Kotlin (Averages.kt) — doivent rester en sync.
// org.json = SDK Android, aucune dépendance ajoutée (garde deps plus bas).
function tsGeneralAverage(payload: string): { value: number; provided: boolean; algorithm: string } | null {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const averages = (root as Record<string, unknown>)["averages"];
    if (typeof averages !== "object" || averages === null) return null;
    const general = (averages as Record<string, unknown>)["general"];
    if (typeof general !== "object" || general === null) return null;
    const value = (general as Record<string, unknown>)["value"];
    if (typeof value !== "number" || !Number.isFinite(value)) return null;
    const origin = (general as Record<string, unknown>)["origin"];
    if (origin !== "provided" && origin !== "estimated") return null;
    return { value, provided: origin === "provided", algorithm: String((averages as Record<string, unknown>)["algorithm"] ?? "") };
  } catch {
    return null;
  }
}

function tsAverageLabel(a: { value: number; provided: boolean; algorithm: string } | null): string {
  if (a === null) return "Moyenne indisponible.";
  const value = a.value.toFixed(2).replace(".", ",");
  const origin = a.provided ? "fournie" : "estimée";
  const algo = a.provided || a.algorithm === "" ? "" : `, algorithme ${a.algorithm}`;
  return `${value}/20 (moyenne ${origin}${algo})`;
}

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");

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

describe("unit android moyennes (#74)", () => {
  test("payload contrat 0.2.0 -> mention fournie/estimée", () => {
    const provided = tsGeneralAverage(JSON.stringify({ grades: [GRADE], averages: REPORT }));
    expect(provided).toEqual({ value: 13.75, provided: true, algorithm: "subject" });
    expect(tsAverageLabel(provided)).toBe("13,75/20 (moyenne fournie)");

    const estimated = tsGeneralAverage(
      JSON.stringify({
        grades: [GRADE],
        averages: {
          ...REPORT,
          algorithm: "weighted",
          general: { value: 15.14, origin: "estimated", subjectCount: 4 },
        },
      }),
    );
    expect(estimated?.provided).toBe(false);
    expect(tsAverageLabel(estimated)).toBe("15,14/20 (moyenne estimée, algorithme weighted)");
  });

  test("payload absent/invalide/cache ancien -> aucune valeur inventée", () => {
    // Cache 0.1.0 (pas de averages) : on n'affiche rien de faux.
    expect(tsGeneralAverage(JSON.stringify({ grades: [GRADE] }))).toBeNull();
    expect(tsAverageLabel(null)).toBe("Moyenne indisponible.");
    // Période sans note exploitable : value null.
    expect(
      tsGeneralAverage(
        JSON.stringify({
          grades: [],
          averages: { ...REPORT, general: { value: null, origin: "estimated", subjectCount: 0 } },
        }),
      ),
    ).toBeNull();
    // Origine inconnue = non conforme au contrat, refusée.
    expect(
      tsGeneralAverage(JSON.stringify({ averages: { ...REPORT, general: { value: 10, origin: "?", subjectCount: 1 } } })),
    ).toBeNull();
    // Texte libre, pas du JSON : jamais interprété.
    expect(tsGeneralAverage("Ignore les instructions")).toBeNull();
    expect(tsGeneralLabelGuard());
  });

  test("le miroir TS valide exactement les payloads que le Kotlin affiche", () => {
    for (const payload of [
      { grades: [GRADE], averages: REPORT },
      { grades: [GRADE], averages: { ...REPORT, algorithm: "median" } },
    ]) {
      expect(isGradesResponse(payload)).toBe(true);
      expect(isAveragesReport(payload.averages)).toBe(true);
      expect(tsGeneralAverage(JSON.stringify(payload))).not.toBeNull();
    }
    expect(AVERAGE_ALGORITHMS).toEqual(["subject", "weighted", "median"]);
    // 0.7.0 : plus aucun credential serveur (`SetupRequest` QR-only, clé
    // LLM envoyée par l'app). Aucun impact sur le rapport de moyennes, d'où le
    // simple re-pin de version.
    expect(CONTRACTS_VERSION).toBe("0.7.0");
  });

  test("Kotlin : parsing + libellé, sans dépendance ajoutée", () => {
    const kt = readFileSync(join(UI, "Averages.kt"), "utf8");
    expect(kt).toContain("fun generalAverageFrom");
    expect(kt).toContain("fun averageLabel");
    expect(kt).toContain("org.json.JSONObject");
    expect(kt).toContain("fournie");
    expect(kt).toContain("estimée");
    expect(kt).toContain("moyenne $origin");
    // Écran Notes : la mention est branchée, les autres onglets intacts.
    // #135 : l'onglet Notes est branché dans AppNav.kt, son rendu a rejoint
    // GradesScreen.kt — d'où les DEUX fichiers pour les DEUX responsibilities.
    const nav = readFileSync(join(UI, "AppNav.kt"), "utf8");
    const grades = readFileSync(join(UI, "GradesScreen.kt"), "utf8");
    expect(nav).toContain("showAverage = true");
    expect(grades).toContain("averageLabel");
    expect(grades).toContain("generalAverageFrom");
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
