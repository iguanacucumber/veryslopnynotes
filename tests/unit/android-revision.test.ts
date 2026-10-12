// Miroir TS de l'écran Fiches de révision (#144, `RevisionSheets.kt`, repointé
// #206 : store LOCAL, zéro réseau) : le filtrage des fiches du store et l'état
// TYPE SCELLÉ qui remplace l'ancien `String` à littéraux magiques.
//
// Rappel du défaut : `AppNav` appelait `RevisionSheetsScreen()` SANS argument,
// donc `sheets` valait `emptyList()` POUR TOUJOURS ; l'écran exposait deux
// boutons de développeur (« Charger », « Simuler erreur ») et n'affichait ni
// `RevisionSheetUi.body` ni les sources.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REVISION_TEMPLATE_VERSION, isRevisionSheet } from "../../shared/contracts/models";
import type { RevisionSheet } from "../../shared/contracts/models";

const ROOT = join(import.meta.dir, "..", "..");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const CORE = join(ROOT, "android/core/src/main/java/fr/veryslopnynotes/core");
const SCREEN = join(UI, "RevisionSheets.kt");
const NAV = join(UI, "AppNav.kt");

/** Sans les commentaires (même raison que dans les autres miroirs). */
const codeOnly = (c: string): string =>
  c
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .join("\n");

// --- Miroir du mapping store -> UI (`RevisionSheet.toUi`, RevisionSheets.kt) ---
// Mêmes règles que `isRevisionSheetValid` : fiche non conforme = ignorée,
// tri décroissant sur la date.

type Sheet = { id: string; title: string; subject: string; date: string; sources: string[]; body: string };

function tsSheetToUi(raw: unknown): Sheet | null {
  if (typeof raw !== "object" || raw === null) return null;
  const o = raw as Record<string, unknown>;
  const str = (k: string): string => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
  if (!isRevisionSheet(o)) return null;
  const sources = Array.isArray(o["sources"]) ? (o["sources"] as unknown[]).filter((s): s is string => typeof s === "string") : [];
  return { id: str("id"), title: str("title"), subject: str("subject"), date: str("date"), sources, body: str("body") };
}

function tsSheetsFromStore(raws: unknown[]): Sheet[] {
  return raws
    .map(tsSheetToUi)
    .filter((s): s is Sheet => s !== null)
    .sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
}

/** Fiche synthétique #30 : corps + sources, aucun secret, aucune URL réelle. */
const SHEET: RevisionSheet = {
  id: "fiche-a-ds",
  examId: "a-ds",
  subject: "Maths",
  date: "2026-10-06T08:00:00.000Z",
  title: "Fiche DS n°3 — fractions",
  body: "Réviser : half + quarter = three quarters.\n\nSources :\n- manuel-fractions p.12",
  sources: ["manuel-fractions p.12"],
  templateVersion: REVISION_TEMPLATE_VERSION,
  createdAt: "2026-10-05T18:00:00.000Z",
};

describe("unit android fiches de révision (#144, #206 local)", () => {
  test("le serveur ne sert plus les fiches : l'écran lit le store local", () => {
    // #206 : le process ne sert que des manuels — les fiches viennent du
    // store local (`listRevisionSheets`), jamais du réseau.
    expect(isRevisionSheet(SHEET)).toBe(true);
    const config = readFileSync(join(CORE, "ServerConfig.kt"), "utf8");
    expect(config).not.toContain("fun revisionSheetsUrl");
    expect(config).not.toContain("fun revisionSheetPdfUrl");
    // L'écran ne connaît ni ApiClient ni URL serveur.
    const screen = codeOnly(readFileSync(SCREEN, "utf8"));
    expect(screen).not.toContain("ApiClient");
    expect(screen).not.toContain("ServerConfig.");
    expect(screen).not.toContain("http://");
    expect(screen).not.toContain("https://");
    expect(screen).toContain("listRevisionSheets(");
    expect(screen).toContain("FileRevisionKv(");
  });

  test("store -> fiches affichables, corps et sources compris", () => {
    const sheets = tsSheetsFromStore([SHEET]);
    expect(sheets).toHaveLength(1);
    // Le CORPS est rendu (il ne l'était jamais) et les sources avec.
    expect(sheets[0]?.body).toContain("half + quarter");
    expect(sheets[0]?.sources).toEqual(["manuel-fractions p.12"]);
    expect(sheets[0]?.date).toBe("2026-10-06T08:00:00.000Z");
    const screen = codeOnly(readFileSync(SCREEN, "utf8"));
    expect(screen).toContain("Text(text = sheet.body");
    expect(screen).toContain('text = "SOURCES"');
    // Tri décroissant : la fiche la plus récente d'abord.
    const two = tsSheetsFromStore([{ ...SHEET, id: "fiche-b", date: "2026-10-09T08:00:00.000Z" }, SHEET]);
    expect(two.map((s) => s.id)).toEqual(["fiche-b", "fiche-a-ds"]);
  });

  test("filtrage : fiche non conforme IGNORÉE, jamais affichée à moitié", () => {
    const base = { ...SHEET };
    // Champs obligatoires manquants ou vides = fiche ignorée (mêmes règles
    // que `isRevisionSheet`).
    for (const vide of ["id", "examId", "title", "subject", "body"]) {
      expect(tsSheetsFromStore([{ ...base, [vide]: "  " }])).toEqual([]);
    }
    // Sans sources, le contrat refuse la fiche : l'app aussi.
    expect(tsSheetsFromStore([{ ...base, sources: [] }])).toEqual([]);
    // Gabarit inconnu ou date illisible : refusés comme côté core.
    expect(tsSheetsFromStore([{ ...base, templateVersion: "fiche-v0" }])).toEqual([]);
    expect(tsSheetsFromStore([{ ...base, date: "pas-une-date" }])).toEqual([]);
    // Sources = DONNÉES affichées, jamais exécutées (I6).
    const screen = codeOnly(readFileSync(SCREEN, "utf8"));
    for (const bad of ["WebView", "Html.fromHtml", "fromHtml", "loadData", "setJavaScriptEnabled", "AnnotatedString"]) {
      expect({ bad, found: screen.includes(bad) }).toEqual({ bad, found: false });
    }
  });

  test("#144 : plus aucun bouton de développeur dans l'application", () => {
    // Le critère d'acceptation de #144, sur TOUTE la source Kotlin : plus un
    // seul « Charger » / « Simuler erreur » de développement.
    const kt = readFileSync(SCREEN, "utf8");
    expect({ present: kt.includes('Text("Charger")') }).toEqual({ present: false });
    expect({ present: kt.includes('Text("Simuler erreur")') }).toEqual({ present: false });
    // Et plus d'état `String` à littéraux magiques : le type scellé fait foi.
    expect(kt).toContain("sealed interface RevisionState");
    const screen = codeOnly(kt);
    for (const litteral of ['"idle"', '"loading"', '"error"']) {
      expect({ litteral, present: screen.includes(litteral) }).toEqual({ litteral, present: false });
    }
    // Le bouton « Ouvrir », qui n'avait aucun destinataire (`onOpen = {}` par
    // défaut), n'existe plus non plus : il était mort.
    expect({ present: screen.includes("onOpen") }).toEqual({ present: false });
    // État UNIQUE par cas, plus les briques Papillon.
    expect(screen).toContain("PapLoading()");
    expect(screen).toContain("PapEmptyState(");
    expect(screen).toContain("PapErrorState(");
    expect(screen).toContain("Aucune fiche de révision");
  });

  test("câblage : la route lit le store, l'export passe par FileProvider", () => {
    const screen = codeOnly(readFileSync(SCREEN, "utf8"));
    // Route 100 % locale : lecture du store sur thread de fond, export PDF
    // rendu sur place et servi au viewer par FileProvider (même motif que les
    // PJ des devoirs) — aucun bearer, aucun 401, aucune URL.
    expect(screen).toContain("fun RevisionSheetsRoute()");
    expect(screen).toContain("listRevisionSheets(");
    expect(screen).toContain("RevisionPdf.writeSheet(");
    expect(screen).toContain("FileProvider.getUriForFile(");
    expect(screen).toContain("ATTACHMENT_PROVIDER_AUTHORITY");
    expect(screen).toContain("Fiches illisibles.");
    // L'âge des fiches affichées, et PAS de bandeau « hors ligne » : rien
    // n'est en cache réseau, donc rien ne peut être « périmé ».
    expect(screen).toContain("relativeTimeFr(state.fetchedAt)");
    // AppNav câble la route sans dépendance serveur.
    const nav = readFileSync(NAV, "utf8");
    expect(nav).toContain("RevisionSheetsRoute()");
    expect(nav).not.toContain("RevisionSheetsScreen()");
    expect(nav).toContain("SecurityAlertsRoute(repo = repo, baseUrl = baseUrl)");
  });
});
