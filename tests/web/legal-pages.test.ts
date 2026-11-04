// Les écrans légaux sont STATIQUES et hors ligne : ils rendent les fichiers de
// référence du dépôt, n'appellent aucun réseau et restent atteignables depuis
// Réglages. Le test verrouille aussi les textes intégraux embarqués dans l'APK.
import { describe, expect, test } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import AboutScreen from "../../web/src/features/legal/AboutScreen";
import LicensesScreen from "../../web/src/features/legal/LicensesScreen";
import PrivacyScreen from "../../web/src/features/legal/PrivacyScreen";
import TermsScreen from "../../web/src/features/legal/TermsScreen";
import { LICENSE_TEXTS, REPO_URL, SECURITY_URL, SUPPORT_URL } from "../../web/src/features/legal/legal";
import { SMOKE_ROUTES } from "../../web/src/smoke-routes";

const ROOT = join(import.meta.dir, "..", "..");

function source(path: string): string {
  return readFileSync(join(ROOT, path), "utf8");
}

function render(element: Parameters<typeof renderToStaticMarkup>[0], route: string): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [route] }, element),
  );
}

function headingLevels(html: string): number[] {
  return [...html.matchAll(/<h([1-6])\b/g)].map((match) => Number(match[1]));
}

function expectAccessibleHeadings(html: string): void {
  const levels = headingLevels(html);
  expect(levels.length).toBeGreaterThan(0);
  expect(levels).not.toContain(1);
  expect(levels[0]).toBe(2);
  for (let index = 1; index < levels.length; index += 1) {
    expect(levels[index]! - levels[index - 1]!).toBeLessThanOrEqual(1);
  }
}

describe("écrans légaux (#847)", () => {
  test("À propos affiche version, source, contacts, non-affiliation et GPL", () => {
    const html = render(createElement(AboutScreen), "/about");
    expect(html).toContain("VerySlopyNyNotes");
    expect(html).toContain("Version indisponible");
    expect(html).toContain(REPO_URL);
    expect(html).toContain(SUPPORT_URL);
    expect(html).toContain(SECURITY_URL);
    expect(html).toContain("GPL-3.0-only");
    expect(html).toContain("ni édité, ni approuvé, ni parrainé");
    expect(html).toContain("GitHub est le seul canal officiel");
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/licenses"');
    expect(html).toContain('aria-label="Informations légales"');
  });

  test("la version vient du pont, jamais d'une constante inventée", () => {
    const text = source("web/src/features/legal/AboutScreen.tsx");
    expect(text).toContain("bridge");
    expect(text).toContain(".version()");
    expect(text).not.toMatch(/\b\d+\.\d+\.\d+\b/);

    expect(source("web/src/bridge/types.ts")).toContain('"app.version"');
    expect(source("android/app/src/main/java/fr/veryslopnynotes/app/BridgeCall.kt")).toContain('"app.version"');
    expect(source("android/app/src/main/java/fr/veryslopnynotes/app/VsnBridge.kt")).toContain(
      '"app.version" -> JSONObject().put("version", BuildConfig.VERSION_NAME)',
    );
  });

  test("Confidentialité et Conditions rendent le texte complet de référence", () => {
    const privacy = render(
      createElement(PrivacyScreen, { markdown: source("PRIVACY.md") }),
      "/privacy",
    );
    expect(privacy).toContain("Notice de confidentialité");
    expect(privacy).toContain("Responsable du traitement et contact");
    expect(privacy).toContain("Points ouverts avant la release publique");
    expect(privacy).toContain("le projet n’exploite pas de serveur");
    // Les lignes repliées du fichier restent un seul bloc, pas une liste de
    // paragraphes orphelins.
    expect((privacy.match(/<blockquote/g) ?? []).length).toBe(1);
    expect((privacy.match(/<ol/g) ?? []).length).toBe(1);
    expectAccessibleHeadings(privacy);

    const terms = render(createElement(TermsScreen, { markdown: source("TERMS.md") }), "/terms");
    expect(terms).toContain("Conditions d’utilisation");
    expect(terms).toContain("Licence du logiciel");
    expect(terms).toContain("Aucune garantie");
    expect(terms).toContain("GPL-3.0-only");
    expectAccessibleHeadings(terms);

    expect(source("web/src/routes/privacy.tsx")).toContain("PRIVACY.md?raw");
    expect(source("web/src/routes/terms.tsx")).toContain("TERMS.md?raw");
  });

  test("Licences liste les notices de tiers et chaque texte intégral existe", () => {
    const texts = Object.fromEntries(
      LICENSE_TEXTS.map(({ file }) => [file, source(`web/public/licenses/${file}`)]),
    );
    const html = render(
      createElement(LicensesScreen, { notices: source("THIRD_PARTY_NOTICES.md"), texts }),
      "/licenses",
    );
    expect(html).toContain("Notices de tiers");
    expect(html).toContain("Textes intégraux");
    expect(html).toContain("APP-GPL-3.0-ONLY.txt");
    expect(html).toContain("GNU GENERAL PUBLIC LICENSE");
    expect(html).toContain("Apache License");
    expect(html).toContain("SIL OPEN FONT LICENSE");
    for (const { file, label } of LICENSE_TEXTS) {
      expect(html).toContain(label);
      expect({
        fichier: file,
        present: existsSync(join(ROOT, "web", "public", "licenses", file)),
      }).toEqual({ fichier: file, present: true });
    }
    expectAccessibleHeadings(html);
    expect(source("web/src/routes/licenses.tsx")).toContain("APP-GPL-3.0-ONLY.txt?raw");
  });

  test("aucun réseau, aucun HTML brut et aucun lien externe cliquable", () => {
    for (const file of [
      "AboutScreen.tsx",
      "PrivacyScreen.tsx",
      "TermsScreen.tsx",
      "LicensesScreen.tsx",
      "LegalDocument.tsx",
      "legal.ts",
    ]) {
      const text = source(`web/src/features/legal/${file}`);
      expect(text).not.toMatch(/fetch\s*\(|XMLHttpRequest|WebSocket|EventSource|navigator\.sendBeacon/);
      expect(text).not.toContain("dangerouslySetInnerHTML");
    }
    const texts = Object.fromEntries(
      LICENSE_TEXTS.map(({ file }) => [file, source(`web/public/licenses/${file}`)]),
    );
    for (const [element, route] of [
      [createElement(AboutScreen), "/about"],
      [createElement(PrivacyScreen, { markdown: source("PRIVACY.md") }), "/privacy"],
      [createElement(TermsScreen, { markdown: source("TERMS.md") }), "/terms"],
      [
        createElement(LicensesScreen, {
          notices: source("THIRD_PARTY_NOTICES.md"),
          texts,
        }),
        "/licenses",
      ],
    ] as const) {
      const html = render(element, route);
      for (const match of html.matchAll(/<a\b[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g)) {
        expect({ route, href: match[1] }).toEqual({
          route,
          href: expect.stringMatching(/^\/(?:privacy|terms|licenses)$/),
        });
        expect(match[2]!.trim().length).toBeGreaterThan(0);
      }
    }
  });

  test("les quatre routes sont branchées, visitées par le smoke et dans Réglages", () => {
    const app = source("web/src/App.tsx");
    for (const route of ["about", "privacy", "terms", "licenses"]) {
      expect(app).toContain(`import ${route[0]!.toUpperCase()}${route.slice(1)}Route from "./routes/${route}"`);
      expect(app).toContain(`<Route path="/${route}" element={<${route[0]!.toUpperCase()}${route.slice(1)}Route />} />`);
      expect(SMOKE_ROUTES.map(([, path]) => path)).toContain(`/${route}`);
      expect(source("web/src/ui/AppShell.tsx")).toContain(`"/${route}": {`);
    }
    const settings = source("web/src/features/settings/SettingsScreen.tsx");
    expect(settings).toContain("À propos et informations légales");
    expect(settings).toContain('navigate("/about")');
  });

  test("le natif connaît les routes et les textes de licence restent embarqués", () => {
    const routes = source("android/app/src/main/java/fr/veryslopnynotes/app/WebRouteState.kt");
    const manifest = source("android/app/src/debug/AndroidManifest.xml");
    for (const route of ["about", "privacy", "terms", "licenses"]) {
      expect(routes).toContain(`"/${route}"`);
      expect(manifest).toContain(`android:host="${route}"`);
    }
    for (const { file } of LICENSE_TEXTS) {
      expect(source("web/src/routes/licenses.tsx")).toContain(`${file}?raw`);
    }
  });
});
