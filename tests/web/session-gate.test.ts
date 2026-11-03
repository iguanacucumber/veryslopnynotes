// La porte de session précède les routes : un écran monté avant le statut lit
// le pont (cache, ressources) en parallèle de `session.restore`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { SessionStatus } from "../../web/src/bridge/types";
import { SessionGate } from "../../web/src/ui/SessionGate";

const ROOT = join(import.meta.dir, "..", "..");

function between(source: string, start: string, end: string): string {
  const from = source.indexOf(start);
  const to = source.indexOf(end, from + start.length);
  expect(from).toBeGreaterThanOrEqual(0);
  expect(to).toBeGreaterThan(from);
  return source.slice(from, to);
}

function render(status: SessionStatus | null): { html: string; mounted: number } {
  let mounted = 0;
  function RouteProbe() {
    mounted += 1;
    return createElement("p", null, "route");
  }
  const html = renderToStaticMarkup(
    createElement(SessionGate, { status, children: createElement(RouteProbe) }),
  );
  return { html, mounted };
}

describe("porte de session (#911)", () => {
  test("avant le statut : « Vérification… », aucune route montée", () => {
    const { html, mounted } = render(null);
    expect(html).toContain("Vérification…");
    expect(html).toContain('role="status"');
    expect(html).toContain('aria-busy="true"');
    // Les routes ne montent pas : leurs effets ne peuvent donc pas lire le pont.
    expect(mounted).toBe(0);
    expect(html).not.toContain("route");
  });

  test("statut connu, y compris hors ligne : les routes montent", () => {
    // Le repli hors ligne est un statut : on garde l'écran utilisable au lieu
    // de bloquer sur « Vérification… » pour toujours.
    for (const state of ["restored", "no_session", "dead", "offline"] as const) {
      const { html, mounted } = render({ state });
      expect(mounted).toBe(1);
      expect(html).toContain("route");
      expect(html).not.toContain("Vérification…");
    }
  });

  test("App branche la porte autour des routes, sans lecture de pont supplémentaire", () => {
    const app = readFileSync(join(ROOT, "web/src/App.tsx"), "utf8");
    const gate = between(app, "function Gate(", "export function App");
    expect(gate).toContain("<SessionGate status={session}>{children}</SessionGate>");
    // Seule lecture de cette couche : le statut lui-même.
    expect([...gate.matchAll(/bridge\s*\.\s*(\w+)/g)].map((match) => match[1])).toEqual(["restore"]);
    const routes = between(app, "<Gate>", "</Gate>");
    expect(routes).toContain("<Routes>");
    // La porte elle-même ne lit jamais le pont.
    const guard = readFileSync(join(ROOT, "web/src/ui/SessionGate.tsx"), "utf8");
    expect(guard).not.toContain("bridge/client");
    expect(guard).not.toMatch(/bridge\./);
  });
});
