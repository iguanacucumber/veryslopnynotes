// #872 : l'appairage est la première page (et le repli après session morte),
// souvent affichée sans coquille. Ses actions et son contenu doivent rester
// hors encoche, hors barres visibles et hors geste d'accueil, comme le reste.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const read = (p: string) => readFileSync(join(ROOT, p), "utf8");
const tokens = read("web/src/styles/tokens.css");
const css = read("web/src/styles/app.css");
const pairing = read("web/src/features/pairing/PairingScreen.tsx");
const app = read("web/src/App.tsx");
const gate = read("web/src/ui/SessionGate.tsx");

/** Corps d'un bloc CSS (du sélecteur à sa accolade fermante). */
function block(source: string, selector: string): string {
  const start = source.indexOf(`${selector} {`);
  if (start < 0) return "";
  return source.slice(start, source.indexOf("}", start));
}

describe("zones sûres de l'appairage (#872)", () => {
  test("les jetons suivent l'inset natif, `env()` seulement en repli", () => {
    // Le natif pose toujours la variable (même à 0px) : dans la WebView, un
    // `env()` non nul compterait l'encoche déjà paddée par le natif.
    expect(tokens).toContain("var(--native-safe-top, env(safe-area-inset-top, 0px))");
    expect(tokens).toContain("var(--native-safe-right, env(safe-area-inset-right, 0px))");
    expect(tokens).toContain("var(--native-safe-bottom, env(safe-area-inset-bottom, 0px))");
    expect(tokens).toContain("var(--native-safe-left, env(safe-area-inset-left, 0px))");
  });

  test("une page sans coquille dégage le haut, le bas et le clavier", () => {
    const bare = block(css, ".main--bare");
    expect(bare).toMatch(/padding-top:[^;]*var\(--safe-top\)/);
    expect(bare).toMatch(/padding-bottom:[^;]*var\(--safe-bottom\)/);
    expect(bare).toMatch(/padding-bottom:[^;]*var\(--keyboard-bottom\)/);
  });

  test("l'appairage utilise la page sans coquille, sans padding inline qui l'écrase", () => {
    expect(pairing).toMatch(/className="main main--bare"/);
    expect(pairing).not.toContain("paddingBottom");
    // Repli de session et écran de secours : même chemin.
    expect(app).toMatch(/className="main main--bare"/);
    expect(gate).toMatch(/className="main main--bare"/);
  });

  test("contenu, en-tête, dock et dialogues combinent la gouttière et la zone sûre", () => {
    // Un `calc` par côté : la zone sûre s'ajoute à la gouttière, sans jamais
    // remplacer le padding de base.
    expect(block(css, ".main")).toMatch(/calc\(var\(--gutter\) \+ var\(--safe-left\)\)/);
    expect(block(css, ".main")).toMatch(/calc\(var\(--gutter\) \+ var\(--safe-right\)\)/);
    expect(block(css, ".topbar__inner")).toMatch(/calc\(var\(--gutter\) \+ var\(--safe-left\)\)/);
    expect(block(css, ".topbar__inner")).toMatch(/calc\(var\(--gutter\) \+ var\(--safe-right\)\)/);
    expect(block(css, ".dialog-backdrop")).toMatch(/var\(--safe-top\)/);
    expect(block(css, ".dialog-backdrop")).toMatch(/var\(--safe-bottom\)/);
    // Grand écran : la règle de 700 px ne perd pas les zones sûres latérales.
    expect(css).toContain("calc(24px + var(--safe-left))");
    expect(css).toContain("calc(24px + var(--safe-right))");
  });
});
