import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const dialog = readFileSync(join(ROOT, "web/src/ui/Dialog.tsx"), "utf8");
const index = readFileSync(join(ROOT, "web/index.html"), "utf8");

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  const to = text.indexOf(end, from);
  expect(from).toBeGreaterThan(-1);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

// #930 : le fond reste visible mais doit disparaître de l'arbre
// d'accessibilité, et le focus doit continuer de revenir au déclencheur.
describe("dialogues modaux inertes (#930)", () => {
  test("le dialogue est portalé dans body, donc hors de la racine inerte", () => {
    expect(index).toContain('<div id="root"></div>');
    expect(dialog).toContain('import { createPortal } from "react-dom"');
    expect(dialog).toContain("return createPortal(");
    expect(dialog).toContain("document.body,");
  });

  test("la racine de l'app est inerte et masquée, jamais le dialogue", () => {
    expect(dialog).toContain('document.getElementById("root")');
    const inert = between(dialog, "function inertApp", "function freeApp");
    expect(inert).toContain("root.inert = true");
    expect(inert).toContain('root.setAttribute("aria-hidden", "true")');
    expect(dialog).not.toContain("panelRef.current?.setAttribute");
  });

  test("l'inertie attend le dernier dialogue empilé et se restaure", () => {
    const inert = between(dialog, "function inertApp", "function freeApp");
    const free = between(dialog, "function freeApp", "/** Dialogue modal partagé");
    expect(inert).toContain("openDialogs += 1");
    expect(inert).toContain("if (openDialogs > 1) return");
    expect(free).toContain("openDialogs = Math.max(0, openDialogs - 1)");
    expect(free).toContain("if (openDialogs > 0) return");
    expect(free).toContain("root.inert = rootState.inert");
    expect(free).toContain('root.removeAttribute("aria-hidden")');
  });

  test("le focus entre dans le dialogue avant de masquer la racine", () => {
    // Masquer un ancêtre du focus déclenche « Blocked aria-hidden » et casse
    // l'annonce : le panneau doit déjà porter le focus.
    expect(dialog).toContain("target?.focus()");
    expect(dialog.indexOf("target?.focus()")).toBeLessThan(dialog.indexOf("inertApp();"));
  });

  test("focus rendu et piège à Tab inchangés", () => {
    expect(dialog).toContain("restoreRef.current?.focus()");
    expect(dialog).toContain("function trapTab");
    expect(dialog).toContain("last.focus()");
    expect(dialog).toContain("first.focus()");
    expect(dialog).toContain('aria-modal="true"');
  });
});
