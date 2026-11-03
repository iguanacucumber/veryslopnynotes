// L'aide est une page STATIQUE et hors ligne : elle ne lit pas le pont et ne
// doit contenir aucun appel réseau. Le test verrouille aussi son branchement
// (route, smoke, retour, entrée Réglages) et la hiérarchie des titres.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import HelpScreen from "../../web/src/features/help/HelpScreen";

const ROOT = join(import.meta.dir, "..", "..");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function renderHelp(): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: ["/help"] }, createElement(HelpScreen)),
  );
}

describe("aide et FAQ (#946)", () => {
  test("chaque sujet demandé a sa section et son titre", () => {
    const html = renderHelp();
    const sections = [
      ["aide-qr", "Trouver le QR de l’établissement"],
      ["aide-pin", "Saisir le PIN"],
      ["aide-reseau", "Réseau et mode hors-ligne"],
      ["aide-camera", "Caméra et scan"],
      ["aide-sans-ia", "Utiliser l’app sans assistant IA"],
      ["aide-openrouter", "Clé OpenRouter, coût et âge"],
      ["aide-depannage", "Dépannage"],
    ] as const;
    for (const [id, title] of sections) {
      expect(html).toContain(`id="${id}"`);
      expect(html).toContain(title);
    }
    expect(html).toContain("au moins 18 ans");
    expect(html).toContain("crédits prépayés");
    expect(html).toContain("Sans clé OpenRouter");
    expect(html).toContain("aucun appel");
    expect(html).toContain("hors ligne");
  });

  test("titres hiérarchisés, sans h1 concurrent, et liens nommés", () => {
    const html = renderHelp();
    const levels = [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
    expect(levels.length).toBeGreaterThan(0);
    // Le titre de page est le h1 de la coquille : l'écran ne le duplique pas.
    expect(levels).not.toContain(1);
    expect(levels[0]).toBe(2);
    for (let index = 1; index < levels.length; index += 1) {
      expect(levels[index]! - levels[index - 1]!).toBeLessThanOrEqual(1);
    }
    expect(html).toContain('aria-label="Raccourcis de l’aide"');
    expect(html).toContain('href="/settings"');
    expect(html).toContain("Ouvrir les réglages");
    expect(html).toContain('href="/tasks"');
    expect(html).toContain("Voir les tâches");
  });

  test("aucun réseau, aucun HTML construit, aucun pont", () => {
    const text = source("web/src/features/help/HelpScreen.tsx");
    expect(text).not.toMatch(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/);
    expect(text).not.toMatch(/https?:\/\//);
    expect(text).not.toContain("dangerouslySetInnerHTML");
    expect(text).not.toContain("bridge");
  });

  test("la route est branchée, visitée par le smoke et atteignable depuis Réglages", () => {
    const app = source("web/src/App.tsx");
    expect(app).toContain('import HelpRoute from "./routes/help"');
    expect(app).toContain('<Route path="/help" element={<HelpRoute />} />');

    const smoke = source("web/src/smoke-routes.ts");
    expect(smoke).toContain('["help", "/help"]');

    const shell = source("web/src/ui/AppShell.tsx");
    expect(shell).toContain('"/help": { title: "Aide", back: "/settings" }');

    const settings = source("web/src/features/settings/SettingsScreen.tsx");
    expect(settings).toContain("Aide et FAQ");
    expect(settings).toContain('navigate("/help")');

    const route = source("web/src/routes/help.tsx");
    expect(route).toContain("../features/help/HelpScreen");
  });

  test("la route native et le harnais de capture connaissent /help", () => {
    expect(source("android/app/src/main/java/fr/veryslopnynotes/app/WebRouteState.kt")).toContain('"/help"');
    expect(source("android/app/src/debug/AndroidManifest.xml")).toContain('android:host="help"');
    expect(source("agents/runtime/shot.sh")).toContain("help|Aide|Trouver le QR");
  });
});
