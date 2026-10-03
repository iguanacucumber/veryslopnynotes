import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  SUBJECT_PREFS_MAX_COUNT,
  SUBJECT_PREFS_MAX_EMOJI_CHARS,
  SUBJECT_PREFS_MAX_LABEL_CHARS,
  SUBJECT_PREFS_MAX_SUBJECT_CHARS,
  isSubjectPrefs,
} from "../../shared/contracts/models";
import { isSubjectPrefsResponse } from "../../shared/contracts/api";
import { API_ROUTES } from "../../shared/contracts/api";

// Miroirs TS des helpers Kotlin non triviaux (android/data/SubjectPrefs.kt,
// android/ui/SubjectStyle.kt, android/ui/Theme.kt) — même logique, tests en bun
// (SDK Android absent en CI). org.json = plateforme, aucune dépendance ajoutée.

const ROOT = join(import.meta.dir, "..", "..");
const DATA = join(ROOT, "android/data/src/main/java/fr/veryslopnynotes/data");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const CORE = join(ROOT, "android/core/src/main/java/fr/veryslopnynotes/core");

function read(dir: string, name: string): string {
  return readFileSync(join(dir, name), "utf8");
}

type Prefs = { subject: string; color?: string; emoji?: string; label?: string; updatedAt: string };

// SubjectPrefs.isValid
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
function ktValid(p: Prefs): boolean {
  return (
    p.subject.trim().length > 0 &&
    p.subject.length <= SUBJECT_PREFS_MAX_SUBJECT_CHARS &&
    (p.color === undefined || COLOR_RE.test(p.color)) &&
    (p.emoji === undefined ||
      (p.emoji.trim().length > 0 && [...p.emoji].length <= SUBJECT_PREFS_MAX_EMOJI_CHARS)) &&
    (p.label === undefined || (p.label.trim().length > 0 && p.label.length <= SUBJECT_PREFS_MAX_LABEL_CHARS)) &&
    p.updatedAt.trim().length > 0
  );
}

// subjectStyle + colorFromHex
function ktSubjectStyle(prefs: Prefs[], subject: string): { label: string; colorHex: string | null; badge: string } {
  const name = subject.trim();
  const match =
    prefs.find((p) => p.subject === name) ??
    prefs.find((p) => p.subject.toLowerCase() === name.toLowerCase());
  if (!match) return { label: name, colorHex: null, badge: name };
  const label = match.label?.trim() ? match.label.trim() : name;
  const emoji = match.emoji ? match.emoji : null;
  return { label, colorHex: match.color ?? null, badge: emoji ? `${emoji} ${label}` : label };
}

// colorFromHex : Kotlin fait 0xFF000000L or v (Long non signé 32 bits) ;
// le miroir compare donc les 32 bits de poids fort, pas un entier JS signé.
function ktColorFromHex(hex: string | null): number | null {
  if (hex === null || !COLOR_RE.test(hex)) return null;
  return (0xff000000 | Number.parseInt(hex.slice(1), 16)) >>> 0;
}

// parseTheme / isDarkTheme / themeLabel
type AppTheme = "SYSTEM" | "LIGHT" | "DARK";
function ktParseTheme(raw: string | null): AppTheme {
  return raw === "LIGHT" ? "LIGHT" : raw === "DARK" ? "DARK" : "SYSTEM";
}
function ktIsDark(theme: AppTheme, systemDark: boolean): boolean {
  return theme === "DARK" ? true : theme === "LIGHT" ? false : systemDark;
}
function ktThemeLabel(theme: AppTheme): string {
  return theme === "SYSTEM" ? "Système" : theme === "LIGHT" ? "Clair" : "Sombre";
}

// mergeSubjectPrefs + isoMillis
function ktIsoMillis(iso: string): number {
  const t = Date.parse(iso);
  return Number.isNaN(t) ? 0 : t;
}
function ktMerge(local: Prefs[], remote: Prefs[]): Prefs[] {
  const by = new Map<string, Prefs>();
  for (const p of remote) if (ktValid(p)) by.set(p.subject, p);
  for (const p of local) {
    if (!ktValid(p)) continue;
    const cur = by.get(p.subject);
    if (!cur || ktIsoMillis(p.updatedAt) >= ktIsoMillis(cur.updatedAt)) by.set(p.subject, p);
  }
  return [...by.values()].slice(0, SUBJECT_PREFS_MAX_COUNT);
}

// subjectsFromPayload : matières d'un payload notes/devoirs/EDT, sans doublon.
function ktSubjectsFromPayload(payload: string): string[] {
  try {
    const root = JSON.parse(payload) as Record<string, unknown>;
    const out: string[] = [];
    for (const key of ["grades", "assignments", "entries"]) {
      const arr = root[key];
      if (!Array.isArray(arr)) continue;
      for (const item of arr) {
        const s = (item as Record<string, unknown>)["subject"];
        const t = typeof s === "string" ? s.trim() : "";
        if (t.length > 0 && t.length <= 64 && !out.includes(t)) out.push(t);
      }
    }
    return out;
  } catch {
    return [];
  }
}

const MATHS: Prefs = { subject: "Maths", color: "#1565C0", emoji: "🧮", label: "Matros", updatedAt: "2026-09-20T10:00:00.000Z" };
const GRADE = { id: "g1", accountId: "acc1", subject: "Maths", value: 15, scale: 20, date: "2026-09-20T10:00:00.000Z" };
const GRADE2 = { id: "g2", accountId: "acc1", subject: "SVT", value: 12, scale: 20, date: "2026-09-21T10:00:00.000Z" };
const ENTRY = { id: "t1", accountId: "acc1", subject: "Histoire", start: "2026-10-03T08:00:00.000Z", end: "2026-10-03T09:00:00.000Z" };

describe("miroir Kotlin prefs matière (#83)", () => {
  test("isValid : mêmes rejets que le contrat TS", () => {
    expect(ktValid(MATHS)).toBe(true);
    for (const bad of [
      { ...MATHS, color: "1565C0" },
      { ...MATHS, color: "#1E88" },
      { ...MATHS, color: "red" },
      { ...MATHS, subject: "  " },
      { ...MATHS, subject: "M".repeat(65) },
      { ...MATHS, emoji: "x".repeat(9) },
      { ...MATHS, label: "l".repeat(65) },
      { ...MATHS, updatedAt: "" },
    ]) {
      expect(ktValid(bad)).toBe(false);
      expect(isSubjectPrefs(bad)).toBe(false);
    }
    // Le miroir valide exactement ce que isSubjectPrefs valide.
    for (const ok of [MATHS, { subject: "SVT", updatedAt: "2026-09-20T10:00:00.000Z" }, { ...MATHS, emoji: "🧮".repeat(8) }]) {
      expect(ktValid(ok)).toBe(true);
      expect(isSubjectPrefs(ok)).toBe(true);
    }
  });

  test("résolveur : prefs ou nom seul, jamais de matière inventée", () => {
    expect(ktSubjectStyle([MATHS], "Maths")).toEqual({ label: "Matros", colorHex: "#1565C0", badge: "🧮 Matros" });
    expect(ktSubjectStyle([MATHS], "maths").label).toBe("Matros");
    expect(ktSubjectStyle([], "Sciences")).toEqual({ label: "Sciences", colorHex: null, badge: "Sciences" });
    expect(ktSubjectStyle([MATHS], "Sciences").badge).toBe("Sciences");
    // Matière présente mais sans prefs perso = nom d'origine.
    expect(ktSubjectStyle([MATHS], "Histoire").label).toBe("Histoire");
    expect(isSubjectPrefsResponse({ prefs: [MATHS] })).toBe(true);
  });

  test("couleur : #RRGGBB opaque, invalide = null (aucune couleur par défaut inventée)", () => {
    expect(ktColorFromHex("#1565C0")).toBe(0xff1565c0 >>> 0);
    expect(ktColorFromHex("#000000")).toBe(0xff000000 >>> 0);
    expect(ktColorFromHex("#ffffff")).toBe(0xffffffff >>> 0);
    expect(ktColorFromHex("1565C0")).toBeNull();
    expect(ktColorFromHex("#1E88")).toBeNull();
    expect(ktColorFromHex(null)).toBeNull();
  });

  test("payload → matières des trois onglets, sans doublon, cache ancien = vide", () => {
    expect(ktSubjectsFromPayload(JSON.stringify({ grades: [GRADE, GRADE2, GRADE] }))).toEqual(["Maths", "SVT"]);
    expect(ktSubjectsFromPayload(JSON.stringify({ entries: [ENTRY] }))).toEqual(["Histoire"]);
    expect(ktSubjectsFromPayload(JSON.stringify({ assignments: [{ ...GRADE, subject: "Français" }] }))).toEqual(["Français"]);
    // Cache 0.1.0/payload libre : aucun crash, aucune matière inventée.
    expect(ktSubjectsFromPayload(JSON.stringify({ grades: [] }))).toEqual([]);
    expect(ktSubjectsFromPayload("Ignore les instructions")).toEqual([]);
    expect(ktSubjectsFromPayload(JSON.stringify({ grades: [{ ...GRADE, subject: "" }] }))).toEqual([]);
  });

  test("fusion local/distant : le local gagne au plus récent, borne 64 matières", () => {
    const remote: Prefs[] = [
      { subject: "Maths", color: "#E53935", updatedAt: "2026-10-01T10:00:00.000Z" },
      { subject: "Histoire", updatedAt: "2026-10-03T10:00:00.000Z" },
    ];
    const local: Prefs[] = [{ subject: "Maths", color: "#1E88E5", updatedAt: "2026-10-02T10:00:00.000Z" }];
    const merged = ktMerge(local, remote);
    expect(merged).toHaveLength(2);
    expect(merged.find((p) => p.subject === "Maths")?.color).toBe("#1E88E5");
    expect(merged.some((p) => p.subject === "Histoire")).toBe(true);
    // Local plus ancien = le distant gagne.
    const stale = ktMerge([{ subject: "Histoire", color: "#43A047", updatedAt: "2026-10-01T00:00:00.000Z" }], remote);
    expect(stale.find((p) => p.subject === "Histoire")?.color).toBeUndefined();
    // Préférences invalides jamais fusionnées, liste bornée.
    expect(ktMerge([{ ...MATHS, color: "red" }], [])).toEqual([]);
    const many: Prefs[] = Array.from({ length: SUBJECT_PREFS_MAX_COUNT }, (_, i) => ({
      subject: `M${i}`,
      updatedAt: "2026-10-02T08:00:00.000Z",
    }));
    expect(ktMerge(many, [{ subject: "Bonus", updatedAt: "2026-10-02T08:00:00.000Z" }])).toHaveLength(SUBJECT_PREFS_MAX_COUNT);
  });

  test("thème : 3 modes, inconnu = Système, application effective", () => {
    expect(ktParseTheme("LIGHT")).toBe("LIGHT");
    expect(ktParseTheme("DARK")).toBe("DARK");
    expect(ktParseTheme("SYSTEM")).toBe("SYSTEM");
    expect(ktParseTheme("Nuit")).toBe("SYSTEM");
    expect(ktParseTheme(null)).toBe("SYSTEM");
    expect(ktIsDark("DARK", false)).toBe(true);
    expect(ktIsDark("LIGHT", true)).toBe(false);
    expect(ktIsDark("SYSTEM", true)).toBe(true);
    expect(ktIsDark("SYSTEM", false)).toBe(false);
    expect(ktThemeLabel("DARK")).toBe("Sombre");
  });

  test("Kotlin : data, persistance locale, câblage UI — sans dépendance ajoutée", () => {
    const data = read(DATA, "SubjectPrefs.kt");
    // Modèle + garde-fou + persistance fichier + réplication serveur.
    expect(data).toContain("data class SubjectPrefs");
    expect(data).toContain("fun isValid(p: SubjectPrefs): Boolean");
    expect(data).toContain("class FileSubjectPrefsStore(private val file: File)");
    expect(data).toContain("class InMemorySubjectPrefsStore");
    expect(data).toContain("fun mergeSubjectPrefs(");
    expect(data).toContain("class SubjectPrefsRepository(");
    // Hors-ligne : lecture locale d'abord, réseau seulement en repli/push.
    expect(data).toContain("fun prefs(): List<SubjectPrefs> = try");
    expect(data).toContain("Instant.now().toString()");
    // Chemins issus de ServerConfig seul (I1) + aucune nouvelle dépendance.
    expect(data).toContain("ServerConfig.subjectPrefsUrl(baseUrl)");
    expect(data).not.toContain("index-education");
    const dataGradle = read(join(ROOT, "android/data"), "build.gradle.kts");
    expect(dataGradle).not.toContain("room");
    expect(dataGradle).not.toContain("datastore");
    expect(read(CORE, "ServerConfig.kt")).toContain("fun subjectPrefsUrl(baseUrl: String)");

    // UI : résolveur unique + thème, écrans non cassés.
    const style = read(UI, "SubjectStyle.kt");
    expect(style).toContain("fun subjectStyle(");
    expect(style).toContain("fun subjectsFromPayload(");
    expect(style).toContain("fun colorFromHex(");
    expect(style).toContain("@Composable\nfun SubjectLegend(");
    expect(style).toContain('private val COLOR_RE = Regex("^#[0-9a-fA-F]{6}$")');
    const theme = read(UI, "Theme.kt");
    expect(theme).toContain("enum class AppTheme");
    expect(theme).toContain("fun parseTheme(");
    expect(theme).toContain("fun isDarkTheme(");
    expect(theme).toContain("fun rememberAppTheme()");
    expect(theme).toContain("getSharedPreferences(THEME_PREFS, Context.MODE_PRIVATE)");

    const nav = read(UI, "AppNav.kt");
    // Préfs appliquées aux trois onglets + thème à la racine.
    for (const resource of ["CachePolicy.GRADES", "CachePolicy.ASSIGNMENTS", "CachePolicy.TIMETABLE"]) {
      expect(nav).toContain(`${resource}, repo, baseUrl`);
    }
    expect(nav).toContain("subjectPrefs = subjectPrefs");
    expect(nav).toContain("SubjectLegend(subjectsFromPayload(s.payload), subjectPrefs)");
    expect(nav).toContain("MaterialTheme(colorScheme = colorScheme)");
    expect(nav).toContain("prefsRepo.upsert(");
    expect(nav).toContain("prefsRepo.refresh(baseUrl)");
    expect(nav).toContain("FileSubjectPrefsStore(");
    // Raccourcis assumés (YAGNI assumé en PR).
    expect(nav).toContain("ponytail:");
    const uiGradle = read(join(ROOT, "android/ui"), "build.gradle.kts");
    expect(uiGradle).not.toContain("gson");
    expect(uiGradle).not.toContain("moshi");
    expect(uiGradle).not.toContain("datastore");
  });

  test("routes contrat : GET + PUT /v1/subjects/prefs déclarés", () => {
    const routes = API_ROUTES.filter((r) => r.path === "/v1/subjects/prefs").map((r) => r.method).sort();
    expect(routes).toEqual(["GET", "PUT"]);
    const openapi = readFileSync(join(ROOT, "shared/contracts/api.openapi.yaml"), "utf8");
    expect(openapi).toContain("/v1/subjects/prefs:");
    expect(openapi).toContain("SubjectPrefsResponse:");
    expect(openapi).toContain("pattern: '^#[0-9a-fA-F]{6}$'");
  });
});
