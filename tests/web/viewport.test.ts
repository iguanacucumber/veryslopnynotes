// #399 : la zone de saisie suit le viewport RÉEL, pas `100dvh`.
//
// Le clavier réduit la zone visible de la WebView (côté natif : l'inset IME
// est appliqué au conteneur, voir `MainActivity.kt`). Une unité de viewport
// figée garde la hauteur d'origine dans une WebView : la mise en page
// plaçait donc le champ « Code PIN du QR » sous le clavier.
//
// La hauteur utile est lue sur le viewport VISUEL (la seule qui rétrécit
// quand un élément recouvre la page) et publiée en variable CSS ; les
// éléments FIXES du bas remontent de la hauteur du clavier ; le champ
// focalisé revient dans le cadre.

import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { viewportMetrics } from "../../web/src/lib/viewport";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const css = read("web/src/styles/app.css");
const tokens = read("web/src/styles/tokens.css");
const viewport = read("web/src/lib/viewport.ts");
const main = read("web/src/main.tsx");

/** Corps d'un bloc CSS (du sélecteur à sa accolade fermante). */
function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return "";
  return source.slice(start, source.indexOf("}", start));
}

describe("viewport utile et clavier (#399)", () => {
  test("la hauteur utile suit le viewport visuel", () => {
    // Pas de clavier : la hauteur utile = la hauteur de la fenêtre.
    expect(viewportMetrics(800, 800, 0)).toEqual({ height: 800, keyboard: 0 });
    // Clavier ouvert : 300 px recouverts par le bas.
    expect(viewportMetrics(800, 500, 0)).toEqual({ height: 500, keyboard: 300 });
    // Viewport visuel DÉCALÉ (barre de navigateur) : rien n'est recouvert.
    expect(viewportMetrics(800, 500, 300)).toEqual({ height: 500, keyboard: 0 });
    // Pas de viewport visuel (WebView ancienne) : on retombe sur la fenêtre.
    expect(viewportMetrics(800, 0, 0)).toEqual({ height: 800, keyboard: 0 });
  });

  test("la mise en page ne dépend plus d'une unité de viewport figée", () => {
    // La coquille (le conteneur de toute la page) prend sa hauteur dans la
    // variable publiée par le JS, jamais dans une hauteur de viewport figée.
    expect(css).not.toMatch(/dvh/);
    expect(block(css, ".shell")).toMatch(/min-height:\s*var\(--app-height\)/);
    expect(tokens).toMatch(/--app-height:/);
  });

  test("les éléments fixes du bas remontent avec le clavier", () => {
    expect(block(css, ".tabbar")).toMatch(/bottom:[^;]*var\(--keyboard-bottom\)/);
    expect(block(css, ".notice")).toMatch(/bottom:[^;]*var\(--keyboard-bottom\)/);
    // Le contenu laisse la place de la barre d'onglets, clavier compris.
    expect(block(css, ".main")).toMatch(/padding:[^;]*var\(--keyboard-bottom\)/);
  });

  test("le viewport est publié au démarrage et le champ focalisé revient dans le cadre", () => {
    expect(viewport).toContain("--app-height");
    expect(viewport).toContain("--keyboard-bottom");
    expect(viewport).toContain("scrollIntoView");
    expect(main).toContain("watchViewport");
  });
});
