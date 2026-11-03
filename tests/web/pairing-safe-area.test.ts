// #872 : l'appairage est la première page (et le repli après session morte),
// souvent affichée sans coquille. Ses actions et son contenu doivent rester
// hors encoche, hors barres visibles et hors geste d'accueil, comme le reste.
// #934 : le clavier est un second bas de viewport ; le défilement doit y
// réserver la zone sûre, sinon un champ focalisé s'arrête sous le geste.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { applyViewport } from "../../web/src/lib/viewport";

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

/** Balise `<main>` d'un écran : le padding doit venir du CSS, jamais du JSX. */
function mainTag(source: string): string {
  return /<main\b[^>]*>/.exec(source)?.[0] ?? "";
}

describe("appairage et repli : actions au-dessus du geste, clavier compris (#934)", () => {
  test("le viewport simulé rétrécit la coquille et publie le clavier", () => {
    // Même simulation que `viewport.test.ts` : un faux `documentElement`.
    const written: Record<string, string> = {};
    const root = {
      style: {
        setProperty: (name: string, value: string) => {
          written[name] = value;
        },
      },
    } as unknown as HTMLElement;
    // Téléphone portrait : 344 px de clavier sur 844 px, geste 34 px à part.
    applyViewport(root, { height: 500, keyboard: 344 });
    expect(written["--app-height"]).toBe("500px");
    expect(written["--keyboard-bottom"]).toBe("344px");
    // Le CSS consomme ces deux variables : le bas de l'écran n'est pas deviné.
    const bare = block(css, ".main--bare");
    expect(bare).toMatch(/var\(--keyboard-bottom\)/);
    expect(bare).toMatch(/var\(--safe-bottom\)/);
  });

  test("sans coquille, le dernier bouton garde 32 px + geste + clavier sous lui", () => {
    // C'est la marge qui place « Connexion démo » au-dessus de la barre de
    // gestes une fois la page défilée jusqu'en bas.
    const bare = block(css, ".main--bare");
    const bottom = /padding-bottom:\s*([^;]+);/.exec(bare)?.[1] ?? "";
    expect(bottom).toMatch(/32px\s*\+\s*var\(--safe-bottom\)/);
    expect(bottom).toMatch(/var\(--safe-bottom\)\s*\+\s*var\(--keyboard-bottom\)/);
    // Pas de padding inline qui écraserait cette règle sur les trois écrans.
    for (const [écran, source] of [
      ["appairage", pairing],
      ["secours", app],
      ["porte de session", gate],
    ] as const) {
      const tag = mainTag(source);
      expect(tag, `${écran} : aucune <main> trouvée`).toContain("main--bare");
      expect(tag, `${écran} : padding inline sur <main>`).not.toContain("style=");
    }
  });

  test("le défilement réserve les quatre zones sûres, clavier inclus", () => {
    // `scrollIntoView` (champ focalisé) s'arrête au bord du scrollport : sans
    // `scroll-padding`, le PIN atterrit sous le geste ou sous le clavier.
    const root = block(css, "html");
    expect(root).toMatch(/scroll-padding-top:\s*var\(--safe-top\)/);
    expect(root).toMatch(/scroll-padding-right:\s*var\(--safe-right\)/);
    expect(root).toMatch(/scroll-padding-left:\s*var\(--safe-left\)/);
    expect(root).toMatch(
      /scroll-padding-bottom:\s*calc\(var\(--safe-bottom\) \+ var\(--keyboard-bottom\)\)/,
    );
  });

  test("paysage : les actions restent entre les encoches latérales", () => {
    // L'appairage n'a pas de coquille, mais hérite des gouttières de `.main` :
    // en paysage, les encoches sont à gauche et à droite, pas en haut.
    const main = block(css, ".main");
    expect(main).toMatch(/padding:[^;]*var\(--safe-right\)/);
    expect(main).toMatch(/var\(--safe-left\)/);
    expect(mainTag(pairing)).toContain("main main--bare");
    // La règle grand écran ajoute 24 px de respiration, sans perdre l'encoche.
    expect(css).toContain("calc(24px + var(--safe-left))");
    expect(css).toContain("calc(24px + var(--safe-right))");
  });
});
