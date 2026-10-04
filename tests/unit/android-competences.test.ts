// Miroir TS des helpers Kotlin (Competences.kt) — parsing chips + détail.
// org.json = SDK Android, aucune dépendance ajoutée (garde deps plus bas).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { isEvaluationsResponse } from "../../shared/contracts/api";
import { buildCompetenceSummary, buildSkills } from "../../server/domain/competences";
import { syntheticEvaluations } from "./fixtures/competences";

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
/** Sans les commentaires (voir `android-canteen.test.ts` : même raison). */
const codeOnly = (c: string): string =>
  c
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

// --- Miroir des couleurs de puce (#144) -------------------------------------
// `chipSurfaceColor` = `tint(fond, .75)` (pastel Papillon) et `chipContentColor`
// = `bestContentOn(fond)`, les deux fonctions PURES du thème. On les rejoue ici
// pour mesurer le contraste — le critère d'acceptation de #144 est « >= 4.5:1
// pour les 20 couleurs de la palette ».
type Rgb = { r: number; g: number; b: number };
const color8 = (r: number, g: number, b: number): Rgb => ({ r: r / 255, g: g / 255, b: b / 255 });
const hex8 = (h: string): Rgb => color8(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
const WHITE = color8(255, 255, 255);
const INK = hex8("#1F292E");

function tsTint(color: Rgb, p: number): Rgb {
  const amount = Math.min(1, Math.abs(p));
  const towardWhite = p >= 0;
  const channel = (v: number): number => (towardWhite ? v + (1 - v) * amount : v - v * amount);
  return { r: channel(color.r), g: channel(color.g), b: channel(color.b) };
}
function tsLuminance(color: Rgb): number {
  const linear = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}
function tsContrast(a: Rgb, b: Rgb): number {
  const la = tsLuminance(a);
  const lb = tsLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
const tsBestContentOn = (background: Rgb): Rgb =>
  tsContrast(background, INK) >= tsContrast(background, WHITE) ? INK : WHITE;
/** `chipSurfaceColor` : fond borné en luminance (pastel), puis encre mesurée. */
const tsChipSurface = (hex: string): Rgb => tsTint(hex8(hex), 0.75);
const tsChipContent = (background: Rgb): Rgb => tsBestContentOn(background);
const rounded = (v: number): number => Math.round(v * 100) / 100;

// Les 20 couleurs de matière de papillon.bzh (`SubjectPalette`).
const PALETTE = [
  "#C50017", "#DA2400", "#DD6B00", "#E8901C", "#E8B048",
  "#6BAE00", "#37BB12", "#12BB67", "#26B290", "#26ABB2",
  "#2DB9D8", "#009EC5", "#007FDA", "#3A56D0", "#7600CA",
  "#962DD8", "#B300CA", "#C50066", "#DD004A", "#DD0030",
];
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

  test("#144 : contraste des puces >= 4.5:1 pour les 20 couleurs de la palette", () => {
    // Le défaut : texte forcé à `Color.White` sur la couleur de la puce. Sur le
    // jaune `#E8B048` de la palette, cela mesurait 1.96:1 — illisible.
    expect({ jaune: rounded(tsContrast(WHITE, hex8("#E8B048"))) }).toEqual({ jaune: 1.96 });
    // Corrigé : fond pastel (`tint .75`) + encre par contraste mesuré.
    let worst = { h: "", ratio: 21 };
    for (const h of PALETTE) {
      const bg = tsChipSurface(h);
      const ink = tsChipContent(bg);
      const ratio = tsContrast(ink, bg);
      expect({ h, ok: ratio >= 4.5 }).toEqual({ h, ok: true });
      if (ratio < worst.ratio) worst = { h, ratio };
    }
    expect(rounded(worst.ratio)).toBeGreaterThanOrEqual(4.5);
    // La PIRE couleur de la palette : mesurée, donc elle ne peut pas « baisser ».
    expect({ h: worst.h, ratio: rounded(worst.ratio) }).toEqual({ h: "#7600CA", ratio: 9.06 });
    // L'encre choisie est TOUJOURS celle de la marque sur un fond pastel (le
    // blanc n'est jamais forcé).
    for (const h of PALETTE) {
      const bg = tsChipSurface(h);
      expect({ h, encre: tsChipContent(bg) === INK }).toEqual({ h, encre: true });
    }
    // Même règle pour une couleur HACHÉE (le serveur n'en publie pas) : le fond
    // pastel est toujours clair, donc l'écart au texte reste confortable.
    const hashed = stableColorFor("sk-geometrie");
    const hashedRatio = tsContrast(tsChipContent(tsChipSurface(hashed)), tsChipSurface(hashed));
    expect({ hashed, ok: hashedRatio >= 4.5 }).toEqual({ hashed, ok: true });
  });

  test("#144 : sélection exposed en sémantique + état vide dédié", () => {
    const kt = codeOnly(readFileSync(join(UI, "Competences.kt"), "utf8"));
    // Plus de `Color.White` forcé, plus d'élévation comme SEUL signal.
    expect(kt).not.toContain("color = Color.White");
    expect(kt).not.toContain("tonalElevation = if (selected)");
    // `selectable` porte l'état pour le lecteur d'écran, `stateDescription` le
    // nomme en français, et le filet le montre.
    expect(kt).toContain("Modifier.selectable(");
    expect(kt).toContain("role = Role.Tab");
    expect(kt).toContain("stateDescription = if (selected) \"Sélectionnée\"");
    expect(kt).toContain("border = if (selected) BorderStroke(SELECTED_BORDER, ink) else null");
    // Fond borné en luminance + encre mesurée (les deux fonctions pures).
    expect(kt).toContain("fun chipSurfaceColor(hex: String): Color = tint(parseChipColor(hex), .75f)");
    expect(kt).toContain("fun chipContentColor(background: Color): Color = bestContentOn(background)");
    // La rangée de puces DÉFILE (avant : une Row sans défilement, donc les
    // puces au-delà de l'écran étaient invisibles).
    expect(kt).toContain("horizontalScroll(rememberScrollState())");
    // Compétence sélectionnée SANS évaluation = état vide DÉDIÉ (pas le texte
    // générique « Touchez une compétence »).
    expect(kt).toContain('title = "Aucune évaluation"');
    expect(kt).toContain("L'établissement n'a publié aucune évaluation pour");
    // La section défile : le détail peut compter plusieurs évaluations.
    expect(kt).toContain("verticalScroll(rememberScrollState())");
  });

  test("Kotlin : parsing, chips, état stable, sans dépendance ajoutée", () => {
    const kt = readFileSync(join(UI, "Competences.kt"), "utf8");
    expect(kt).toContain("fun competenciesFrom");
    expect(kt).toContain("fun chipColor");
    expect(kt).toContain("fun noteLabel");
    expect(kt).toContain("org.json.JSONObject");
    // Détail stable : clé par skillId (jamais une position), identité figée.
    expect(kt).toContain("key(skill.id)");
    // #147 : la compétence ouverte survit à la rotation, la clé reste `skills`
    // (la sélection repart à vide quand le payload change).
    expect(kt).toContain("var selectedId by rememberSaveable(ui.skills) { mutableStateOf<String?>(null) }");
    // #147 : la date d'une évaluation est un jour français, plus une tranche ISO.
    expect(kt).toContain("dayLabelFr(entry.date)");
    expect(kt).not.toContain("entry.date.take(");
    expect(kt).toContain("Aucune compétence publiée par l'établissement.");
    // Écran branché + ressource cachable.
    const nav = readFileSync(join(UI, "AppNav.kt"), "utf8");
    // `composable(ROUTE_COMPETENCES` sans la parenthèse fermante : #133 ajoute
    // l'argument `deepLinks`, la parenthèse fermante n'est plus le même texte.
    // #135 : la route a sa constante (c'était un littéral nu).
    expect(nav).toContain('const val ROUTE_COMPETENCES = "competences"');
    expect(nav).toContain('composable(ROUTE_COMPETENCES');
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
