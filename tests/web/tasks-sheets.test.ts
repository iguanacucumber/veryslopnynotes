import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  parseRevisionSheet,
  parseRevisionSheets,
  revisionDateLabel,
  SHEET_MAX_BODY,
  SHEET_MAX_SOURCES,
  SHEETS_MAX_ITEMS,
} from "../../web/src/features/revisions/sheets";

useParisTz();

describe("web fiches — parsing défensif", () => {
  const SHEET = {
    id: "rev1",
    title: "Régimes totalitaires — fiche de révision",
    subject: "HISTOIRE-GEOGRAPHIE",
    date: "2026-10-17T18:00:00.000Z",
    sources: ["a1"],
    body: "1. Définir le totalitarisme.\n2. Comparer les régimes.",
  };

  test("accepte {sheets} et le tableau nu, ignore une fiche incomplète", () => {
    expect(parseRevisionSheets({ sheets: [SHEET, { id: "x" }] })).toHaveLength(1);
    expect(parseRevisionSheets([SHEET])).toHaveLength(1);
    expect(parseRevisionSheets({ items: [SHEET] })).toHaveLength(1);
    expect(parseRevisionSheets({ sheets: "nope" })).toEqual([]);
    expect(parseRevisionSheets(null)).toEqual([]);
  });

  test("trie par date décroissante et garde le corps comme texte brut", () => {
    const older = { ...SHEET, id: "old", date: "2026-10-01T18:00:00.000Z" };
    const sheets = parseRevisionSheets([older, SHEET]);
    expect(sheets.map((sheet) => sheet.id)).toEqual(["rev1", "old"]);
    const xss = parseRevisionSheet({ ...SHEET, body: "<script>alert(1)</script>" });
    expect(xss?.body).toBe("<script>alert(1)</script>");
  });

  test("date lisible et fiche introuvable", () => {
    const sheet = parseRevisionSheet(SHEET);
    expect(sheet).not.toBeNull();
    expect(revisionDateLabel(sheet!)).toContain("17 octobre");
    expect(parseRevisionSheet({ ...SHEET, body: "" })).toBeNull();
    expect(parseRevisionSheet(null)).toBeNull();
  });

  test("accepte une enveloppe JSON sérialisée", () => {
    expect(parseRevisionSheets(JSON.stringify({ sheets: [SHEET] }))).toHaveLength(1);
    expect(parseRevisionSheets(JSON.stringify([SHEET]))).toHaveLength(1);
    expect(parseRevisionSheets("{")).toEqual([]);
  });

  test("la fiche ouverte est rendue dans sa carte, avec aria-expanded/controls", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "revisions", "RevisionSheets.tsx"),
      "utf8",
    );
    expect(source).toContain("aria-expanded={opened}");
    expect(source).toContain("aria-controls={bodyId}");
    expect(source).toContain("<SheetBody sheet={selected.sheet} />");
    // Disclosure inline : le corps est rendu DANS la carte de la fiche, après
    // son déclencheur, jamais dans une carte séparée au-dessus de la liste.
    expect(source.indexOf("<SheetBody")).toBeGreaterThan(source.indexOf("aria-controls={bodyId}"));
    // Un seul « Fermer » : le déclencheur devient Fermer et porte le focus.
    expect(source).toContain("triggers.current.get(selected.id)?.focus()");
    expect(source).not.toContain("Fiche ouverte");
    expect(source).toContain("triggers.current.get(id)?.focus()");
  });

  test("la fiche fermée montre un aperçu texte et des actions Ouvrir/PDF", () => {
    const source = readFileSync(
      join(import.meta.dir, "..", "..", "web", "src", "features", "revisions", "RevisionSheets.tsx"),
      "utf8",
    );
    expect(source).toContain('eyebrow="Assistant"');
    expect(source).toContain('title="Fiches de révision"');
    expect(source).toContain("Créer une fiche");
    expect(source).toContain('navigate("/tasks")');
    expect(source).toContain("sourceLabel");
    expect(source).toContain("revision-card__preview");
    // Ouvrir est l'action principale, PDF l'action secondaire.
    const open = source.indexOf("btn btn--small revision-card__open");
    const pdf = source.indexOf("btn btn--ghost btn--small revision-card__pdf");
    expect(open).toBeGreaterThan(-1);
    expect(pdf).toBeGreaterThan(open);
    expect(source).toContain("Exporter en PDF la fiche");
    // L'aperçu fermé reste du texte aplati (`previewOf`), pas du markdown.
    expect(source).toContain("previewOf(sheet.body)");
    // Corps ouvert : parseur markdown borné rendu en éléments React, jamais
    // de HTML brut injecté.
    expect(source).toContain("<MarkdownBody text={sheet.body} />");
    expect(source).not.toContain("innerHTML");
    expect(source).not.toContain("dangerouslySetInnerHTML");
  });

  test("borne le scan, les sources et le corps, déduplique par id", () => {
    const many = Array.from({ length: 5000 }, (_, index) => ({ ...SHEET, id: `rev${index}` }));
    const parsed = parseRevisionSheets(many);
    expect(parsed).toHaveLength(SHEETS_MAX_ITEMS);
    expect(new Set(parsed.map((sheet) => sheet.id)).size).toBe(SHEETS_MAX_ITEMS);

    expect(parseRevisionSheets([SHEET, SHEET, { ...SHEET, id: "other" }])).toHaveLength(2);

    const sources = Array.from({ length: 25 }, (_, index) => `src${index}`);
    const capped = parseRevisionSheet({
      ...SHEET,
      sources,
      body: "b".repeat(30_000),
    });
    expect(capped?.sources).toHaveLength(SHEET_MAX_SOURCES);
    expect(capped?.body).toHaveLength(SHEET_MAX_BODY);
  });
});
