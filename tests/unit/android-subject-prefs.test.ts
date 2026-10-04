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

// --- #140 : l'éditeur de matière en feuille (`SettingsSubjectEditor.kt`) ---

/** `normalizeColorHex` : trim + majuscules, ou null. */
function ktNormalizeColorHex(hex: string | null): string | null {
  const t = (hex ?? "").trim();
  return COLOR_RE.test(t) ? t.toUpperCase() : null;
}

/** `subjectSwatchColors` : la palette du thème, plus la couleur enregistrée
 *  quand elle n'y figure pas (une prefs d'avant #140 doit rester visible). */
function ktSubjectSwatchColors(current: string | null): string[] {
  const hex = ktNormalizeColorHex(current);
  const known = SUBJECT_PALETTE.some((h) => h.toUpperCase() === hex);
  return hex === null || known ? SUBJECT_PALETTE : [...SUBJECT_PALETTE, hex];
}

/** `subjectPreviewHex` : le brouillon s'il est valide, sinon la couleur de la
 *  matière (préfs puis dérivée du nom). */
const ktSubjectPreviewHex = (prefs: Prefs[], subject: string, draftHex: string): string =>
  ktNormalizeColorHex(draftHex) ?? ktSubjectColorHex(prefs, subject);

// `stableHash` / `derivedSubjectHex` (miroir de android-timetable.test.ts, même
// `fold(31)` sur 32 bits) : sans couleur de prefs, l'aperçu montre la couleur
// dérivée du NOM (#137), donc le miroir doit la recalculer.
function ktStableHash(value: string): number {
  let acc = 7;
  for (const c of value) acc = (acc * 31 + c.codePointAt(0)!) >>> 0;
  return acc;
}
const ktDerivedSubjectHex = (subject: string): string =>
  SUBJECT_PALETTE[ktStableHash(subject.trim().toLowerCase()) % SUBJECT_PALETTE.length]!;
const ktSubjectColorHex = (prefs: Prefs[], subject: string): string => {
  const hex = ktSubjectStyle(prefs, subject).colorHex;
  return hex !== null && COLOR_RE.test(hex) ? hex : ktDerivedSubjectHex(subject);
};

/** `subjectEmojiChoices` : la palette, plus l'emoji enregistré s'il est hors
 *  palette ET dans le contrat. */
const ktSubjectEmojiChoices = (current: string | null): string[] => {
  const e = (current ?? "").trim();
  if (e === "" || [...e].length > SUBJECT_PREFS_MAX_EMOJI_CHARS) return SUBJECT_EMOJI_PALETTE;
  return SUBJECT_EMOJI_PALETTE.includes(e) ? SUBJECT_EMOJI_PALETTE : [...SUBJECT_EMOJI_PALETTE, e];
};

/** `subjectNameError` : null si le nom est acceptable, sinon la raison. */
function ktSubjectNameError(name: string): string | null {
  const t = name.trim();
  if (t === "") return null;
  return t.length > SUBJECT_PREFS_MAX_SUBJECT_CHARS ? `${SUBJECT_PREFS_MAX_SUBJECT_CHARS} caractères maximum` : null;
}

const MATHS: Prefs = { subject: "Maths", color: "#1565C0", emoji: "🧮", label: "Matros", updatedAt: "2026-09-20T10:00:00.000Z" };
const GRADE = { id: "g1", accountId: "acc1", subject: "Maths", value: 15, scale: 20, date: "2026-09-20T10:00:00.000Z" };
const GRADE2 = { id: "g2", accountId: "acc1", subject: "SVT", value: 12, scale: 20, date: "2026-09-21T10:00:00.000Z" };
const ENTRY = { id: "t1", accountId: "acc1", subject: "Histoire", start: "2026-10-03T08:00:00.000Z", end: "2026-10-03T09:00:00.000Z" };

// La palette matière du thème (PapillonTheme.kt) — la SEULE source de couleurs
// pour les pastilles de l'éditeur (#140 : avant, huit hex en dur qui n'étaient
// mesurés par rien).
const SUBJECT_PALETTE = [
  "#C50017", "#DA2400", "#DD6B00", "#E8901C", "#E8B048",
  "#6BAE00", "#37BB12", "#12BB67", "#26B290", "#26ABB2",
  "#2DB9D8", "#009EC5", "#007FDA", "#3A56D0", "#7600CA",
  "#962DD8", "#B300CA", "#C50066", "#DD004A", "#DD0030",
];

/** `SubjectEmojiPalette` + `subjectEmojiChoices` (SettingsSubjectEditor.kt). */
const SUBJECT_EMOJI_PALETTE = [
  "📘", "📐", "🔬", "🌍", "🗺️", "📜", "🧮", "🎨", "🎵", "💻", "⚽", "🌱",
];

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

    // #135 : le rendu de l'onglet Notes est sorti d'AppNav.kt (GradesScreen.kt) ;
    // le branchement et le résolveur sont toujours dans AppNav.kt.
    const nav = read(UI, "AppNav.kt");
    const grades = read(UI, "GradesScreen.kt");
    // Préfs appliquées aux trois onglets + thème à la racine.
    // Regex tolérante à la mise en forme multi-lignes du CachedResourceScreen.
    for (const resource of ["CachePolicy.GRADES", "CachePolicy.ASSIGNMENTS"]) {
      expect(nav).toMatch(new RegExp(`${resource}[\\s\\S]{0,80}baseUrl`));
      // La prefs est passée à chacun des trois onglets qui affichent des matières.
      expect(nav).toMatch(new RegExp(`${resource}[\\s\\S]{0,400}subjectPrefs = subjectPrefs`));
    }
    // #76 : l'onglet EDT est devenu TimetableRoute (vue semaine), les prefs
    // matière y sont toujours passées via le même résolveur.
    expect(nav).toMatch(/TimetableRoute\([\s\S]{0,200}subjectPrefs = subjectPrefs/);
    expect(nav).toContain("subjectPrefs = subjectPrefs");
    expect(grades).toContain("SubjectLegend(subjectsFromPayload(s.payload), subjectPrefs)");
    expect(grades).toContain("subjectPrefs: List<SubjectPrefs>");
    // #134 : la racine applique `PapillonTheme`, plus un `MaterialTheme` nu
    // (couleurs + typo + formes) qui n'existait qu'en clair par défaut.
    expect(nav).toContain("PapillonTheme(darkTheme = isDarkTheme(theme, isSystemInDarkTheme()))");
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

  test("#140 : couleur de l'éditeur — normalisation, roue, aperçu vivant", () => {
    // Normalisation : espaces + casse, sinon la pastille sélectionnée ne se
    // reconnaît pas et l'utilisateur croit avoir perdu sa couleur.
    expect(ktNormalizeColorHex(" #abcdef ")).toBe("#ABCDEF");
    expect(ktNormalizeColorHex("#C50017")).toBe("#C50017");
    for (const bad of ["abcdef", "#abc", "#ABCDEFG", "red", "", null, " #abcdeg "]) {
      expect(ktNormalizeColorHex(bad)).toBeNull();
    }
    // La roue, c'est la PALETTE DU THÈME : 20 couleurs déjà mesurées (4.5:1
    // sur le texte), pas huit hex en dur. Aucune couleur n'est inventée.
    const roue = ktSubjectSwatchColors(null);
    expect(roue).toEqual(SUBJECT_PALETTE);
    expect(new Set(roue).size).toBe(roue.length);
    // Une couleur déjà dans la palette ne s'ajoute pas une seconde fois.
    expect(ktSubjectSwatchColors("#c50017")).toEqual(SUBJECT_PALETTE);
    // Une prefs d'avant #140 (hors palette) reste sélectionnée, donc visible.
    expect(ktSubjectSwatchColors("#1565c0")).toEqual([...SUBJECT_PALETTE, "#1565C0"]);
    expect(ktSubjectSwatchColors("nawak")).toEqual(SUBJECT_PALETTE);
    // Aperçu : le brouillon gagne s'il est valide ; sinon la matière garde sa
    // couleur (préfs), sinon celle dérivée de son nom (#137).
    expect(ktSubjectPreviewHex([MATHS], "Maths", "#37bb12")).toBe("#37BB12");
    expect(ktSubjectPreviewHex([MATHS], "Maths", "pas une couleur")).toBe("#1565C0");
    expect(ktSubjectPreviewHex([], "Histoire", "")).toBe(ktDerivedSubjectHex("Histoire"));
    // Nom de matière : vide = rien à dire (le bouton est désactivé), trop long =
    // la raison du refus, à la borne du contrat.
    expect(ktSubjectNameError("")).toBeNull();
    expect(ktSubjectNameError("   ")).toBeNull();
    expect(ktSubjectNameError("Maths")).toBeNull();
    expect(ktSubjectNameError("M".repeat(SUBJECT_PREFS_MAX_SUBJECT_CHARS))).toBeNull();
    expect(ktSubjectNameError("M".repeat(SUBJECT_PREFS_MAX_SUBJECT_CHARS + 1))).toBe(`${SUBJECT_PREFS_MAX_SUBJECT_CHARS} caractères maximum`);
    // Chaque emoji proposé tient dans le contrat (≤ 8 points de code), donc un
    // choix dans la rangée n'est jamais refusé à l'écriture.
    for (const emoji of SUBJECT_EMOJI_PALETTE) {
      expect([...emoji].length).toBeLessThanOrEqual(SUBJECT_PREFS_MAX_EMOJI_CHARS);
    }
    expect(new Set(SUBJECT_EMOJI_PALETTE).size).toBe(SUBJECT_EMOJI_PALETTE.length);
    expect(SUBJECT_EMOJI_PALETTE.length).toBeGreaterThanOrEqual(8);
    // L'emoji ENREGISTRÉ reste dans la rangée (même règle que la couleur) :
    // l'ancien champ était libre, donc un emoji hors palette doit rester
    // sélectionnable — et donc retirable.
    expect(ktSubjectEmojiChoices("🧬")).toEqual([...SUBJECT_EMOJI_PALETTE, "🧬"]);
    expect(ktSubjectEmojiChoices("🧮")).toEqual(SUBJECT_EMOJI_PALETTE);
    expect(ktSubjectEmojiChoices("   ")).toEqual(SUBJECT_EMOJI_PALETTE);
    expect(ktSubjectEmojiChoices(null)).toEqual(SUBJECT_EMOJI_PALETTE);
    // Un emoji hors contrat ne revient pas dans la rangée (il n'a jamais pu être
    // écrit, et l'afficher proposerait un choix que l'écriture refuserait).
    expect(ktSubjectEmojiChoices("x".repeat(SUBJECT_PREFS_MAX_EMOJI_CHARS + 1))).toEqual(SUBJECT_EMOJI_PALETTE);
  });

  test("#140 : feuille d'édition — aperçu sur les VRAIS composants, écriture inchangée", () => {
    const sheet = read(UI, "SettingsSubjectEditor.kt");
    const settings = read(UI, "SettingsScreen.kt");
    const style = read(UI, "SubjectStyle.kt");
    // L'aperçu appelle les composants que #137/#138/#139 ont rendus colorés :
    // une carte de cours, une pastille matière et une pastille de note. Sans
    // cela, l'aperçu ne prouverait rien du rendu final.
    expect(sheet).toContain("PapCourseCard(");
    expect(sheet).toContain("PapSubjectAvatar(");
    expect(sheet).toContain("PapPill(");
    // Les couleurs de l'éditeur sortent du thème, jamais d'un hex posé ici.
    expect(sheet).not.toMatch(/#[0-9A-Fa-f]{6}/);
    expect(sheet).toContain("subjectContent(");
    // Le pastel de la carte de cours n'est pas re-écrit dans la feuille : il vient
    // de `PapCourseCard`, donc l'aperçu et l'EDT partagent la MÊME fonction.
    expect(read(UI, "TimetableCourseCard.kt")).toContain("subjectSurface(colorHex)");
    expect(sheet).toContain("bestContentOn(");
    // Les conventions #138 sont réutilisées, pas ré-derivées.
    expect(sheet).toContain("subjectDisplayFr(");
    expect(sheet).toContain("subjectInitial(");
    expect(sheet).toContain("subjectColorHex(");
    // Feuille modale (material3 1.2.1 l'a), croix = annuler, coche = valider.
    expect(sheet).toContain("ModalBottomSheet(");
    expect(sheet).toContain("onDismissRequest = onDismiss");
    expect(sheet).toContain('label = "Annuler"');
    expect(sheet).toContain('label = "Enregistrer"');
    // Roue de pastilles circulaires : anneau blanc + coche sur la sélection.
    expect(sheet).toContain("CircleShape");
    expect(sheet).toContain("Modifier.border(SWATCH_RING, Color.White, CircleShape)");
    expect(style).toContain("fun normalizeColorHex(");
    // L'écran : une LIGNE par matière (plus de bloc déployé par matière) et le
    // thème en segment, pas en puces.
    expect(settings).toContain("SingleChoiceSegmentedButtonRow(");
    // (le mot « FilterChip » reste dans l'en-tête du fichier, qui raconte ce
    // qu'était l'ancien écran : c'est l'APPEL qui doit avoir disparu)
    expect(settings).not.toContain("FilterChip(");
    expect(settings).toMatch(/verticalScroll\(rememberScrollState\(\)\)/);
    expect(settings).toContain("SubjectEditorSheet(");
    expect(settings).toContain("AppTheme.entries");
    // « Ajouter la matière » refuse le champ vide et dit pourquoi.
    expect(settings).toContain("enabled = newSubject.isNotBlank() && nameError == null");
    // Clé LLM : MASQUÉE par défaut, bascule explicite, collage inchangé (aucun
    // filtre de caractères, seule la borne du contrat).
    expect(settings).toContain("PasswordVisualTransformation()");
    expect(settings).toContain("VisualTransformation.None");
    expect(settings).toContain("KeyboardOptions(keyboardType = KeyboardType.Password)");
    expect(settings).toContain('if (it.length <= Homework.MAX_API_KEY_CHARS) llmKey = it');
    expect(settings).not.toContain('llmKey.isConfigured()');
    // La clé n'est ni journalisée, ni mise dans un message, ni pré-remplie.
    expect(settings).not.toMatch(/Log\.|println|toJson\(\).*llm/i);
    expect(settings).not.toContain("value = llmKeys.apiKey()");
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
