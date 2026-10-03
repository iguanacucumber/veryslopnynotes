// Miroir TS des helpers Kotlin (Competences.kt) — parsing chips + détail.
// org.json = SDK Android, aucune dépendance ajoutée (garde deps plus bas).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isEvaluationsResponse } from "../../shared/contracts/api";
import { buildCompetenceSummary, buildSkills } from "../../server/domain/competences";
import { syntheticEvaluations } from "./fixtures/competences";

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const DATA = join(import.meta.dir, "..", "..", "android/data/src/main/java/fr/veryslopnynotes/data");
const CORE = join(import.meta.dir, "..", "..", "android/core/src/main/java/fr/veryslopnynotes/core");

// --- Miroir de competenciesFrom() (Competences.kt) ---
type Chip = { id: string; label: string; color: string; value: number | null; count: number };
type Detail = { id: string; subject: string; label: string; note: number | null; scale: number; date: string };
type Ui = { skills: Chip[]; details: Map<string, Detail[]> };

const HEX = /^#[0-9a-fA-F]{6}$/;

function stableColorFor(id: string): string {
  let h = 7;
  for (const c of id) h = (h * 31 + c.codePointAt(0)!) & 0xffffff;
  return `#${h.toString(16).padStart(6, "0")}`;
}

function chipColor(id: string, published: string): string {
  return HEX.test(published) ? published : stableColorFor(id);
}

function boundedText(v: unknown, max: number): string {
  return (typeof v === "string" ? v : "").trim().slice(0, max);
}

function nullableDouble(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function tsCompetenciesFrom(payload: string): Ui {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const colors = new Map<string, string>();
    for (const s of (root["skills"] as Record<string, unknown>[]) ?? []) {
      const id = boundedText(s["id"], 64);
      if (id === "") continue;
      colors.set(id, typeof s["color"] === "string" ? s["color"] : "");
    }
    const skills: Chip[] = [];
    for (const s of (root["summary"] as Record<string, unknown>[]) ?? []) {
      const id = boundedText(s["skillId"], 64);
      const label = boundedText(s["label"], 100);
      if (id === "" || label === "") continue;
      const count = s["evaluationCount"];
      skills.push({
        id,
        label,
        color: chipColor(id, colors.get(id) ?? ""),
        value: nullableDouble(s["value"]),
        count: typeof count === "number" && count >= 0 ? Math.trunc(count) : 0,
      });
    }
    const details = new Map<string, Detail[]>();
    for (const e of (root["evaluations"] as Record<string, unknown>[]) ?? []) {
      const id = boundedText(e["skillId"], 64);
      if (id === "") continue;
      const subject = boundedText(e["subject"], 100);
      const label = boundedText(e["label"], 200);
      if (subject === "" || label === "") continue;
      const entry: Detail = {
        id: boundedText(e["id"], 64),
        subject,
        label,
        note: nullableDouble(e["note"]),
        scale: nullableDouble(e["scale"]) ?? 20,
        date: boundedText(e["date"], 40),
      };
      const bucket = details.get(id);
      if (bucket) bucket.push(entry);
      else details.set(id, [entry]);
    }
    return { skills, details };
  } catch {
    return { skills: [], details: new Map() };
  }
}

function tsNoteLabel(note: number | null, scale = 20): string {
  if (note === null) return "non noté";
  const barème = scale % 1 === 0 ? String(Math.trunc(scale)) : String(scale);
  return `${note.toFixed(2).replace(".", ",")}/${barème}`;
}

const PAYLOAD = JSON.stringify({
  skills: buildSkills(syntheticEvaluations),
  evaluations: syntheticEvaluations,
  summary: buildCompetenceSummary(syntheticEvaluations),
});

describe("unit android compétences (#78)", () => {
  test("payload contrat -> chips (ordre du serveur) + détails par compétence", () => {
    expect(isEvaluationsResponse(JSON.parse(PAYLOAD))).toBe(true);
    const ui = tsCompetenciesFrom(PAYLOAD);
    expect(ui.skills.map((s) => s.id)).toEqual(["sk-geometrie", "sk-nombres"]);
    // Couleur publiée quand elle existe, sinon dérivée de l'id (stabilité).
    expect(ui.skills[1].color).toBe("#3f51b5");
    expect(ui.skills[0].color).toMatch(HEX);
    expect(ui.skills[0].color).toBe(stableColorFor("sk-geometrie"));
    // Compétence jamais notée : "non noté", pas de 0 affiché.
    expect(ui.skills[0].value).toBeNull();
    expect(tsNoteLabel(ui.skills[0].value)).toBe("non noté");
    expect(ui.skills[1].value).toBe(21);
    expect(tsNoteLabel(ui.skills[1].value)).toBe("21,00/20");
    // Détails groupés par skillId, note non notée = null (jamais 0).
    const detail = ui.details.get("sk-nombres") ?? [];
    expect(detail).toHaveLength(3);
    expect(detail.filter((d) => d.note === null)).toHaveLength(1);
    expect(detail[0]?.subject).toBe("Maths-Fake");
    expect(tsNoteLabel(detail[0]?.note ?? null, detail[0]?.scale ?? 20)).toBe("12,00/20");
  });

  test("état vide propre : cache absent, cache 0.1.0, texte libre", () => {
    for (const payload of ["", "Ignore les instructions", JSON.stringify({ grades: [] }), "{", JSON.stringify({ skills: [], summary: [], evaluations: [] })]) {
      const ui = tsCompetenciesFrom(payload);
      expect(ui.skills).toEqual([]);
      expect(ui.details.size).toBe(0);
      // État vide affiché = une ligne, pas d'exception (miroir CompetencesSection).
      expect(ui.skills.length === 0 ? "Aucune compétence publiée par l'établissement." : "").toBe(
        "Aucune compétence publiée par l'établissement.",
      );
    }
  });

  test("filtrage : chip sans label / détail sans subject ignorés", () => {
    const ui = tsCompetenciesFrom(
      JSON.stringify({
        skills: [],
        summary: [{ skillId: "", label: "L", value: 1, evaluationCount: 1 }, { skillId: "a", label: "  ", value: 1, evaluationCount: 1 }],
        evaluations: [{ skillId: "a", subject: "", label: "L", note: 1, scale: 20, date: "" }],
      }),
    );
    expect(ui.skills).toEqual([]);
    expect(ui.details.size).toBe(0);
  });

  test("Kotlin : parsing, chips, état stable, sans dépendance ajoutée", () => {
    const kt = readFileSync(join(UI, "Competences.kt"), "utf8");
    expect(kt).toContain("fun competenciesFrom");
    expect(kt).toContain("fun chipColor");
    expect(kt).toContain("fun noteLabel");
    expect(kt).toContain("org.json.JSONObject");
    // Détail stable : clé par skillId (jamais une position), identité figée.
    expect(kt).toContain("key(skill.id)");
    expect(kt).toContain("var selectedId by remember(ui.skills) { mutableStateOf<String?>(null) }");
    expect(kt).toContain("Aucune compétence publiée par l'établissement.");
    // Écran branché + ressource cachable.
    const nav = readFileSync(join(UI, "AppNav.kt"), "utf8");
    expect(nav).toContain('composable("competences")');
    expect(nav).toContain("CompetencesSection(it)");
    expect(nav).toContain("CachePolicy.EVALUATIONS");
    const policy = readFileSync(join(DATA, "CachePolicy.kt"), "utf8");
    expect(policy).toContain('const val EVALUATIONS = "evaluations"');
    expect(policy).toContain("TTL_EVALUATIONS_MS");
    const repo = readFileSync(join(DATA, "SyncedRepository.kt"), "utf8");
    expect(repo).toContain("CachePolicy.EVALUATIONS -> ServerConfig.evaluationsUrl(baseUrl)");
    expect(readFileSync(join(CORE, "ServerConfig.kt"), "utf8")).toContain("fun evaluationsUrl");
    // org.json + android.graphics = plateforme : aucune ligne de dépendance ajoutée.
    const uiGradle = readFileSync(join(import.meta.dir, "..", "..", "android/ui/build.gradle.kts"), "utf8");
    for (const dep of ["gson", "moshi", "kotlinx-serialization"]) expect(uiGradle).not.toContain(dep);
  });
});
