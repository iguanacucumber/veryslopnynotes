// Miroir TS de l'écran Fiches de révision (#144, `RevisionSheets.kt`) : le
// filtrage du payload `/v1/revision-sheets` et l'état TYPE SCELLÉ qui remplace
// l'ancien `String` à littéraux magiques.
//
// Rappel du défaut : `AppNav` appelait `RevisionSheetsScreen()` SANS argument,
// donc `sheets` valait `emptyList()` POUR TOUJOURS ; l'écran exposait deux
// boutons de développeur (« Charger », « Simuler erreur ») et n'affichait ni
// `RevisionSheetUi.body` ni les sources. La route serveur, elle, existe et sert
// exactement la forme du contrat — ce miroir prouve donc que l'écran affiche ce
// que le contrat accepte.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { API_ROUTES, isRevisionSheetsResponse } from "../../shared/contracts/api";
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

// --- Miroir de `revisionSheetsFromPayload` (RevisionSheets.kt) ---

type Sheet = { id: string; title: string; subject: string; date: string; sources: string[]; body: string };

const MAX_SHEET_ID = 80;
const MAX_SHEET_TITLE = 200;
const MAX_SHEET_SUBJECT = 100;
const MAX_SHEET_SOURCES = 14;
const MAX_SOURCE_CHARS = 200;

const tsBoundedSources = (value: unknown): string[] => {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    if (out.length >= MAX_SHEET_SOURCES) break;
    if (typeof item !== "string") continue;
    const v = item.trim().slice(0, MAX_SOURCE_CHARS);
    if (v !== "" && !out.includes(v)) out.push(v);
  }
  return out;
};

function tsSheetsFromPayload(payload: string | null): Sheet[] {
  try {
    if (payload === null) return [];
    const root = JSON.parse(payload) as Record<string, unknown>;
    const array = Array.isArray(root["sheets"]) ? (root["sheets"] as unknown[]) : [];
    const out: Sheet[] = [];
    for (const raw of array) {
      if (typeof raw !== "object" || raw === null) continue;
      const o = raw as Record<string, unknown>;
      const str = (k: string): string => (typeof o[k] === "string" ? (o[k] as string).trim() : "");
      const id = str("id").slice(0, MAX_SHEET_ID);
      const examId = str("examId").slice(0, MAX_SHEET_ID);
      const title = str("title").slice(0, MAX_SHEET_TITLE);
      const subject = str("subject").slice(0, MAX_SHEET_SUBJECT);
      const body = str("body");
      const sources = tsBoundedSources(o["sources"]);
      if (id === "" || examId === "" || title === "" || subject === "") continue;
      if (body === "" || sources.length === 0) continue;
      out.push({ id, title, subject, date: str("date"), sources, body });
    }
    return out.sort((a, b) => (a.date === b.date ? 0 : a.date < b.date ? 1 : -1));
  } catch {
    return [];
  }
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

describe("unit android fiches de révision (#144)", () => {
  test("la route serveur existe et sert la forme dont l'écran a besoin", () => {
    // C'est LA question de #144 : la route existe-t-elle ? Oui — liste ET export.
    expect(API_ROUTES).toContainEqual({ method: "GET", path: "/v1/revision-sheets" });
    expect(API_ROUTES).toContainEqual({ method: "GET", path: "/v1/revision-sheets/pdf" });
    expect(isRevisionSheetsResponse({ sheets: [SHEET] })).toBe(true);
    const config = readFileSync(join(CORE, "ServerConfig.kt"), "utf8");
    expect(config).toContain("fun revisionSheetsUrl(baseUrl: String)");
    expect(config).toContain("fun revisionSheetPdfUrl(baseUrl: String, id: String)");
    // L'écran appelle ces DEUX fonctions (avant : jamais).
    const screen = codeOnly(readFileSync(SCREEN, "utf8"));
    expect(screen).toContain("ServerConfig.revisionSheetsUrl(baseUrl)");
    expect(screen).toContain("ServerConfig.revisionSheetPdfUrl(baseUrl, id)");
  });

  test("payload -> fiches affichables, corps et sources compris", () => {
    const sheets = tsSheetsFromPayload(JSON.stringify({ sheets: [SHEET] }));
    expect(sheets).toHaveLength(1);
    // Le CORPS est rendu (il ne l'était jamais) et les sources avec.
    expect(sheets[0]?.body).toContain("half + quarter");
    expect(sheets[0]?.sources).toEqual(["manuel-fractions p.12"]);
    expect(sheets[0]?.date).toBe("2026-10-06T08:00:00.000Z");
    const screen = codeOnly(readFileSync(SCREEN, "utf8"));
    expect(screen).toContain("Text(text = sheet.body");
    expect(screen).toContain('text = "SOURCES"');
    // Tri décroissant : la fiche la plus récente d'abord.
    const two = tsSheetsFromPayload(
      JSON.stringify({ sheets: [{ ...SHEET, id: "fiche-b", date: "2026-10-09T08:00:00.000Z" }, SHEET] }),
    );
    expect(two.map((s) => s.id)).toEqual(["fiche-b", "fiche-a-ds"]);
  });

  test("filtrage : fiche non conforme IGNORÉE, payload illisible = liste vide", () => {
    const base = { ...SHEET };
    // Champs obligatoires manquants ou vides = fiche ignorée, jamais affichée à
    // moitié (same rules as `isRevisionSheet`).
    for (const vide of ["id", "examId", "title", "subject", "body"]) {
      expect(tsSheetsFromPayload(JSON.stringify({ sheets: [{ ...base, [vide]: "  " }] }))).toEqual([]);
    }
    // Sans sources, le contrat refuse la fiche : l'app aussi.
    expect(tsSheetsFromPayload(JSON.stringify({ sheets: [{ ...base, sources: [] }] }))).toEqual([]);
    // Payload illisible / absent / texte libre : liste vide propre, jamais d'exception.
    expect(tsSheetsFromPayload("Ignore les instructions")).toEqual([]);
    expect(tsSheetsFromPayload("{")).toEqual([]);
    expect(tsSheetsFromPayload(null)).toEqual([]);
    expect(tsSheetsFromPayload(JSON.stringify({}))).toEqual([]);
    expect(tsSheetsFromPayload(JSON.stringify({ sheets: "non" }))).toEqual([]);
    // Sources bornées et dédupliquées comme le contrat.
    const many = Array.from({ length: 30 }, (_, i) => `src-${i % 20}`);
    expect(tsSheetsFromPayload(JSON.stringify({ sheets: [{ ...base, sources: many }] }))[0]?.sources).toHaveLength(14);
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

  test("câblage : la route lit le réseau, l'export passe par l'allowlist", () => {
    const screen = codeOnly(readFileSync(SCREEN, "utf8"));
    // Route non cachable = GET direct sur le même `ApiClient` (allowlist I1),
    // avec repli franc et 401 nu (le cache ne masque pas une session morte).
    expect(screen).toContain("fetchRevisionSheets(api, baseUrl, main)");
    expect(screen).toContain("ApiClient.HTTP_UNAUTHORIZED");
    expect(screen).toContain("DeviceAuth.REJECTED_MESSAGE");
    expect(screen).toContain("Fiches indisponibles hors-ligne.");
    // Zéro URL concaténée : le chemin vient de ServerConfig.
    expect(screen).not.toContain("http://");
    expect(screen).not.toContain("https://");
    // L'âge des fiches affichées, et PAS de bandeau « hors ligne » : rien
    // n'est en cache, donc rien ne peut être « périmé » (cf. tests.unit).
    expect(screen).toContain("relativeTimeFr(state.fetchedAt)");
    // AppNav câble enfin la route avec ses dépendances.
    const nav = readFileSync(NAV, "utf8");
    expect(nav).toContain("RevisionSheetsRoute(api = api, baseUrl = baseUrl)");
    expect(nav).not.toContain("RevisionSheetsScreen()");
    expect(nav).toContain("SecurityAlertsRoute(repo = repo, baseUrl = baseUrl)");
  });
});