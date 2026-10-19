// Mouvement (#336) : les transitions de route et d'états sont du CSS et de
// l'API View Transition. Ce qu'on peut tenir automatiquement : la décision
// d'animer (repli sans DOM ni API), et la politique de mouvement du CSS
// (propriétés animées + garde `prefers-reduced-motion` unique).
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { animateNavigation, withViewTransition } from "../../web/src/ui/viewTransition";

const ROOT = join(import.meta.dir, "..", "..");

const realDocument = Object.getOwnPropertyDescriptor(globalThis, "document");
const realMatchMedia = Object.getOwnPropertyDescriptor(globalThis, "matchMedia");

interface Stub {
  started: number;
  updates: number;
}

/** Installe un faux navigateur et renvoie le compteur d'appels. */
function stubBrowser(options: { supported: boolean; reducedMotion: boolean }): Stub {
  const stub: Stub = { started: 0, updates: 0 };
  Object.defineProperty(globalThis, "document", {
    configurable: true,
    value: options.supported
      ? {
          startViewTransition: (update: () => void) => {
            stub.started += 1;
            update();
            return { finished: Promise.resolve(), updateCallbackDone: Promise.resolve() };
          },
        }
      : {},
  });
  Object.defineProperty(globalThis, "matchMedia", {
    configurable: true,
    value: () => ({ matches: options.reducedMotion }),
  });
  return stub;
}

afterEach(() => {
  if (realDocument) Object.defineProperty(globalThis, "document", realDocument);
  else Reflect.deleteProperty(globalThis, "document");
  if (realMatchMedia) Object.defineProperty(globalThis, "matchMedia", realMatchMedia);
  else Reflect.deleteProperty(globalThis, "matchMedia");
});

describe("web mouvement", () => {
  test("décision : pas d'animation sans API ni sous mouvement réduit", () => {
    expect(animateNavigation({ reducedMotion: false, supported: true })).toBe(true);
    expect(animateNavigation({ reducedMotion: true, supported: true })).toBe(false);
    expect(animateNavigation({ reducedMotion: false, supported: false })).toBe(false);
    expect(animateNavigation({ reducedMotion: true, supported: false })).toBe(false);
  });

  test("withViewTransition : repli direct quand l'API manque", () => {
    const stub = stubBrowser({ supported: false, reducedMotion: false });
    withViewTransition(() => {
      stub.updates += 1;
    });
    expect(stub.started).toBe(0);
    expect(stub.updates).toBe(1);
  });

  test("withViewTransition : repli direct sous prefers-reduced-motion", () => {
    const stub = stubBrowser({ supported: true, reducedMotion: true });
    withViewTransition(() => {
      stub.updates += 1;
    });
    expect(stub.started).toBe(0);
    expect(stub.updates).toBe(1);
  });

  test("withViewTransition : une transition démarre quand tout est là", () => {
    const stub = stubBrowser({ supported: true, reducedMotion: false });
    withViewTransition(() => {
      stub.updates += 1;
    });
    expect(stub.started).toBe(1);
    expect(stub.updates).toBe(1);
  });

  test("garde unique de mouvement réduit dans tokens.css", () => {
    const css = readFileSync(join(ROOT, "web/src/styles/tokens.css"), "utf8");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("animation-duration: 0.01ms !important");
    expect(css).toContain("transition-duration: 0.01ms !important");
    expect(css).toContain("animation-iteration-count: 1 !important");
    // La garde doit couvrir tout l'arbre, une fois : deux gardes divergentes
    // finissent toujours par se contredire.
    expect(css.match(/@media \(prefers-reduced-motion: reduce\)/g)).toHaveLength(1);
  });

  test("fond : les halos dérivent derrière le contenu et ne captent aucun geste", () => {
    const css = readFileSync(join(ROOT, "web/src/styles/app.css"), "utf8");
    // La couche de fond est fixe, transparente aux gestes, et sous le contenu.
    expect(css).toMatch(/body::before,\s*body::after\s*\{[^}]*position:\s*fixed/);
    expect(css).toMatch(/body::before,\s*body::after\s*\{[^}]*pointer-events:\s*none/);
    expect(css).toMatch(/#root\s*\{[^}]*position:\s*relative[^}]*z-index:\s*1/);
    // La dérive des halos est un `transform` : composée, sans repaint d'écran.
    expect(css).toMatch(/@keyframes page-drift-a\s*\{[^}]*transform/);
    expect(css).toMatch(/@keyframes page-drift-b\s*\{[^}]*transform/);
  });

  test("cartes héros : le reflet qui glisse passe sous le texte", () => {
    const css = readFileSync(join(ROOT, "web/src/styles/app.css"), "utf8");
    // La carte est son propre contexte d'empilement, le reflet est en
    // `z-index: -1` : il reste entre le fond de la carte et son contenu.
    expect(css).toMatch(/\.card--brand,\s*\.card\.home-hero\s*\{[^}]*z-index:\s*0/);
    expect(css).toMatch(/\.card--brand::before,\s*\.card\.home-hero::before\s*\{[^}]*z-index:\s*-1/);
    expect(css).toMatch(/@keyframes hero-sheen\s*\{[^}]*transform/);
  });

  test("politique : les animations restent sur transform/opacité", () => {
    // Propriétés tolérées dans un `@keyframes` : composition seulement.
    const allowed = new Set(["opacity", "transform", "width", "stroke-dashoffset", "background-position"]);
    const files = [
      join(ROOT, "web/src/styles/app.css"),
      ...["grades", "home", "settings", "timetable"].map((feature) =>
        join(ROOT, "web/src/features", feature, `${feature}.css`),
      ),
    ];
    let blocks = 0;
    for (const file of files) {
      const css = readFileSync(file, "utf8");
      for (const match of css.matchAll(/@keyframes\s+([\w-]+)\s*\{/g)) {
        const start = match.index + match[0].length;
        let depth = 1;
        let end = start;
        while (depth > 0 && end < css.length) {
          if (css[end] === "{") depth += 1;
          if (css[end] === "}") depth -= 1;
          end += 1;
        }
        const body = css.slice(start, end - 1);
        blocks += 1;
        const properties = new Set([...body.matchAll(/([a-z-]+)\s*:/g)].map((declaration) => declaration[1]!));
        for (const property of properties) {
          expect({ file: file.slice(ROOT.length + 1), animation: match[1], property, ok: allowed.has(property) }).toEqual({
            file: file.slice(ROOT.length + 1),
            animation: match[1],
            property,
            ok: true,
          });
        }
      }
    }
    expect(blocks).toBeGreaterThan(8);
  });
});
