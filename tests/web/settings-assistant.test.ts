import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const WEB = join(import.meta.dir, "..", "..", "web", "src");

function source(path: string): string {
  return readFileSync(join(WEB, path), "utf8");
}

function between(text: string, start: string, end: string): string {
  const from = text.indexOf(start);
  expect(from).toBeGreaterThan(-1);
  const to = text.indexOf(end, from + start.length);
  expect(to).toBeGreaterThan(from);
  return text.slice(from, to);
}

describe("réglages — une seule section Assistant (#612)", () => {
  const settings = source("features/settings/SettingsScreen.tsx");

  test("l'ordre Apparence, Matières, Assistant, Avancé remplace la section Sécurité", () => {
    expect(settings).not.toContain('title="Sécurité"');
    const order = ["Apparence", "Matières", "Assistant", "Avancé"].map((title) =>
      settings.indexOf(`<Section title="${title}">`),
    );
    expect(order.every((index) => index > -1)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Une seule section Assistant : la configuration IA n'est pas éparpillée.
    expect(settings.match(/<Section title="Assistant">/g)).toHaveLength(1);
  });

  test("clé et manuel vivent dans Assistant, le scraper reste sous Avancé", () => {
    const assistant = between(settings, '<Section title="Assistant">', '<Section title="Avancé">');
    expect(assistant).toContain('id="llm-key"');
    expect(assistant).toContain('id="manual-url"');
    expect(assistant).not.toContain('id="server-host"');
    expect(assistant).toContain("Assistant actif");
    expect(assistant).toContain("Aucune clé");

    const advanced = between(settings, '<Section title="Avancé">', "<Dialog");
    expect(advanced).toContain('id="server-host"');
    expect(advanced).toContain("Scraper de manuels (facultatif)");
    expect(advanced).not.toContain('id="manual-url"');
  });

  test("Cahier et Fiches sont atteignables depuis Assistant", () => {
    const assistant = between(settings, '<Section title="Assistant">', '<Section title="Avancé">');
    expect(settings).toContain("useViewNavigate");
    expect(assistant).toContain('navigate("/course-notes")');
    expect(assistant).toContain('navigate("/revision-sheets")');
  });

  test("oublier la clé passe par une confirmation destructive", () => {
    const forget = between(settings, "async function forgetKey()", "async function saveSubject");
    expect(forget).toContain("bridge.forgetLlmKey()");
    expect(forget).toContain("setForgetAsk(false)");
    // Le bouton de la carte ouvre le dialogue ; il n'appelle jamais le pont.
    expect(settings).toContain("onClick={() => setForgetAsk(true)}");
    expect(settings.match(/void forgetKey\(\)/g)).toHaveLength(1);

    const dialog = between(settings, "<Dialog", "/>");
    expect(dialog).toContain('role="alertdialog"');
    expect(dialog).toContain("void forgetKey()");
    expect(dialog).toContain("btn--danger");
    expect(dialog).toContain("Oublier la clé");
  });

  test("la copie dit où part la clé sans promettre le contraire", () => {
    expect(settings).toContain("Clé OpenRouter");
    expect(settings).toContain("llmSaveError(response)");
    expect(settings).toContain("MAX_API_KEY_CHARS");
    expect(settings).toContain("directement au");
    expect(settings).not.toContain("ne quitte jamais cet appareil");
  });

  test("le manuel garde son pont et affiche une puce de statut", () => {
    expect(settings).toContain("Automatique");
    expect(settings).toContain("Prêt");
    expect(settings).toContain("Non récupéré");
    expect(settings).toContain("bridge.saveManualUrl(value)");
    expect(settings).toContain('bridge.saveManualUrl("")');
    expect(settings).toContain("DEFAULT_MANUAL_URL");
    expect(settings).toContain("MAX_MANUAL_URL_CHARS");
  });
});

describe("profil — assistant découvrable (#612)", () => {
  const profile = source("features/profile/ProfileScreen.tsx");

  test("une section Assistant avant Ressources porte Cahier et Fiches", () => {
    expect(profile.indexOf('<Section title="Assistant">')).toBeGreaterThan(-1);
    expect(profile.indexOf('<Section title="Assistant">')).toBeLessThan(
      profile.indexOf('<Section title="Ressources">'),
    );

    const assistant = between(profile, '<Section title="Assistant">', '<Section title="Ressources">');
    expect(assistant).toContain('title="Cahier de cours"');
    expect(assistant).toContain("Tes cours, sources de l’assistant");
    expect(assistant).toContain('title="Fiches de révision"');
    expect(assistant).toContain("Générées depuis un devoir");
    expect(assistant).toContain("<IconBook");
    expect(assistant).toContain("<IconSparkles");
    expect(assistant).toContain('navigate("/course-notes")');
    expect(assistant).toContain('navigate("/revision-sheets")');
  });

  test("Ressources garde les quatre entrées scolaires, sans doublon assistant", () => {
    const resources = between(profile, '<Section title="Ressources">', '<Section title="Réglages">');
    expect(resources).toContain('navigate("/messages")');
    expect(resources).toContain('navigate("/news")');
    expect(resources).toContain('navigate("/canteen")');
    expect(resources).toContain('navigate("/attendance")');
    expect(resources).not.toContain('navigate("/course-notes")');
    expect(resources).not.toContain('navigate("/revision-sheets")');
  });
});
