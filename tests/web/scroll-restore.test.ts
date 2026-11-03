import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  scrollDecision,
  scrollKey,
  type ScrollPosition,
} from "../../web/src/ui/scrollMemory";

const ROOT = join(import.meta.dir, "..", "..");

function at(pathname: string, search = "", y = 0): ScrollPosition {
  return { key: scrollKey(pathname, search), pathname, y };
}

describe("mémoire de scroll par localisation", () => {
  test("la clé est pathname + search", () => {
    expect(scrollKey("/calendar", "")).toBe("/calendar");
    expect(scrollKey("/calendar", "?week=2026-11-02")).toBe("/calendar?week=2026-11-02");
  });

  test("premier rendu : haut de page", () => {
    expect(
      scrollDecision({
        navigationType: "POP",
        previous: null,
        key: "/",
        pathname: "/",
        saved: undefined,
      }),
    ).toEqual({ save: [], restore: 0 });
  });

  test("nouvel écran : la position quittée est mémorisée, la page remonte", () => {
    const previous = at("/", "", 420);
    expect(
      scrollDecision({
        navigationType: "PUSH",
        previous,
        key: "/grades",
        pathname: "/grades",
        saved: undefined,
      }),
    ).toEqual({ save: [previous], restore: 0 });
  });

  test("retour POP : la position de l'entrée est restaurée", () => {
    const previous = at("/grades", "", 0);
    expect(
      scrollDecision({
        navigationType: "POP",
        previous,
        key: "/",
        pathname: "/",
        saved: 420,
      }),
    ).toEqual({ save: [previous], restore: 420 });
  });

  test("POP sans position mémorisée : haut de page", () => {
    expect(
      scrollDecision({
        navigationType: "POP",
        previous: at("/grades", "", 90),
        key: "/calendar",
        pathname: "/calendar",
        saved: undefined,
      }).restore,
    ).toBe(0);
  });

  test("changement de query seul : l'écran ne bouge pas", () => {
    const previous = at("/calendar", "?week=2026-11-02", 180);
    expect(
      scrollDecision({
        navigationType: "PUSH",
        previous,
        key: scrollKey("/calendar", "?week=2026-11-09"),
        pathname: "/calendar",
        saved: undefined,
      }),
    ).toEqual({ save: [previous], restore: null });
  });

  test("POP entre deux query : chacune retrouve sa position", () => {
    expect(
      scrollDecision({
        navigationType: "POP",
        previous: at("/calendar", "?week=2026-11-09", 240),
        key: scrollKey("/calendar", "?week=2026-11-02"),
        pathname: "/calendar",
        saved: 180,
      }),
    ).toEqual({
      save: [at("/calendar", "?week=2026-11-09", 240)],
      restore: 180,
    });
  });

  test("même localisation : aucun effet", () => {
    expect(
      scrollDecision({
        navigationType: "REPLACE",
        previous: at("/", "", 120),
        key: "/",
        pathname: "/",
        saved: 120,
      }),
    ).toEqual({ save: [], restore: null });
  });
});

describe("câblage de la coquille", () => {
  const shell = readFileSync(join(ROOT, "web/src/ui/AppShell.tsx"), "utf8");

  test("la coquille suit le type de navigation et les deux parties de la clé", () => {
    expect(shell).toContain("useNavigationType");
    expect(shell).toContain("scrollDecision(");
    expect(shell).toContain("scrollKey(location.pathname, location.search)");
  });

  test("le navigateur ne restaure pas le scroll en parallèle", () => {
    expect(shell).toContain('window.history.scrollRestoration = "manual"');
  });

  test("plus de remise à zéro inconditionnelle au changement de pathname", () => {
    expect(shell).not.toContain("window.scrollTo(0, 0);");
    expect(shell).toContain("window.scrollTo(0, decision.restore)");
  });
});
