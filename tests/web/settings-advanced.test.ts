import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  AdvancedSection,
  SelfHostingNotice,
} from "../../web/src/features/settings/AdvancedSection";

const WEB = join(import.meta.dir, "..", "..", "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

const probe = createElement("p", null, "Champ avancé visible");

function renderAdvanced(open: boolean): string {
  return renderToStaticMarkup(
    createElement(AdvancedSection, { open, onToggle: () => undefined, children: probe }),
  );
}

describe("réglages — Avancé replié par défaut", () => {
  test("replié : le panneau n'est pas rendu, la commande reste visible", () => {
    const html = renderAdvanced(false);
    expect(html).toContain("Avancé");
    expect(html).toContain('aria-expanded="false"');
    expect(html).not.toContain("Champ avancé visible");
  });

  test("déplié : le panneau apparaît et l'état ARIA suit", () => {
    const html = renderAdvanced(true);
    expect(html).toContain("Champ avancé visible");
    expect(html).toContain('aria-expanded="true"');
  });

  test("l'écran démarre replié et n'ouvre que sur demande", () => {
    const settings = source("features/settings/SettingsScreen.tsx");
    expect(settings).toContain("const [advancedOpen, setAdvancedOpen] = useState(false);");
    expect(settings).toContain("onToggle={() => setAdvancedOpen((open) => !open)}");
    expect(settings).toContain("<AdvancedSection open={advancedOpen}");
  });
});

describe("réglages — auto-hébergement annoncé", () => {
  test("la copie dit qui voit les adresses et les risques", () => {
    const html = renderToStaticMarkup(createElement(SelfHostingNotice));
    expect(html).toContain("auto-hébergé");
    expect(html).toContain("voit les adresses de manuels");
    expect(html).toContain("Limite son accès");
    expect(html).toContain("conditions des sites");
    // La promesse hors-ligne reste vraie sans serveur.
    expect(html).toContain("utilisable sans serveur");
  });

  test("le serveur et le manuel sont dans le panneau, pas dans Assistant", () => {
    const settings = source("features/settings/SettingsScreen.tsx");
    const advanced = settings.slice(settings.indexOf("<AdvancedSection"));
    expect(advanced).toContain("<SelfHostingNotice");
    expect(advanced).toContain("<ServerCard");
    expect(advanced).toContain("<ManualCard");
    const assistant = settings.slice(
      settings.indexOf('title="Assistant"'),
      settings.indexOf("<AdvancedSection"),
    );
    expect(assistant).not.toContain("<ServerCard");
    expect(assistant).not.toContain("<ManualCard");
  });
});
