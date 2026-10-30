// I15 : le corps assemblé porte DÉJÀ le bloc canonique « Sources : ». L'écran
// ne doit pas ajouter une seconde liste : une seule attribution visible, et
// l'aperçu fermé ne montre pas la bibliographie.
import { describe, expect, test } from "bun:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SheetBody } from "../../web/src/features/revisions/RevisionSheets";
import {
  bodyCarriesSources,
  bodyWithoutSources,
  type RevisionSheet,
} from "../../web/src/features/revisions/sheets";

const SOURCES = ["Consigne", "Cours : chapitre 4"];

function sheetOf(body: string): RevisionSheet {
  return {
    id: "fiche-devoir-1",
    title: "Fiche révision Mathématiques — Devoir dérivées",
    subject: "Mathématiques",
    date: "2026-10-19",
    sources: SOURCES,
    body,
  };
}

const CANONICAL_BODY = ["## Analyse", "", "La dérivée de x^2 est 2x.", "", "Sources :", "- Consigne", "- Cours : chapitre 4"].join(
  "\n",
);

function sourceHeadings(html: string): number {
  return (html.match(/Sources/g) ?? []).length;
}

describe("rendu d'une fiche : les sources ne sont affichées qu'une fois (I15)", () => {
  test("un corps qui porte le bloc canonique n'ajoute pas de seconde liste", () => {
    const html = renderToStaticMarkup(createElement(SheetBody, { sheet: sheetOf(CANONICAL_BODY) }));
    expect(sourceHeadings(html)).toBe(1);
    // Le bloc du corps est rendu ; la liste séparée du composant, non.
    expect(html).not.toContain("revision-card__sources");
    expect(html).toContain("Cours : chapitre 4");
  });

  test("un corps sans bloc canonique garde sa liste de sources", () => {
    const html = renderToStaticMarkup(
      createElement(SheetBody, { sheet: sheetOf("## Analyse\n\nLa dérivée de x^2 est 2x.") }),
    );
    expect(sourceHeadings(html)).toBe(1);
    expect(html).toContain("revision-card__sources");
  });

  test("l'aperçu ignore le bloc de sources", () => {
    expect(bodyCarriesSources(CANONICAL_BODY)).toBe(true);
    const preview = bodyWithoutSources(CANONICAL_BODY);
    expect(preview).not.toContain("Sources");
    expect(preview).not.toContain("Consigne");
    expect(preview).toContain("La dérivée de x^2 est 2x.");
    // Un corps sans bloc reste intact : rien n'est retiré au hasard.
    expect(bodyCarriesSources("Rappel du cours.")).toBe(false);
    expect(bodyWithoutSources("Rappel du cours.")).toBe("Rappel du cours.");
  });
});
