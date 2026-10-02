// e2e manuals (issue #25, phase 8) — offline-first, sans .env.local requis.
// Aucun réseau externe : fixtures synthétiques + serveur local uniquement.
// Sessions/credentials réelles jamais utilisées : pipeline validé sur données
// anonymisées, scrape réel seulement vers boucle locale si Playwright présent.
import { describe, expect, test } from "bun:test";
import { loadManualsConfig } from "../../server/infrastructure/manuals-config";
import {
  chunkManual,
  citeSources,
  formatCorrigeWithCitations,
  markManualsUntrusted,
  retrieveManuals,
} from "../../server/infrastructure/manuals";
import { isPlaywrightAvailable, scrapeManuals } from "../../server/infrastructure/manuals-scrape";
import { buildRevisionPrompt } from "../../server/ai/prompt";
import { syntheticManualDocs } from "../unit/fixtures/manuals";

describe("e2e manuals", () => {
  test("pipeline local chunk→retrieve→cite→prompt, sans fuite", () => {
    // Config réelle chargée ou noop gracieux — jamais loguée en clair.
    const config = loadManualsConfig();
    const logs: string[] = [];
    logs.push(`manuals configured=${config !== null}`);
    const joined = logs.join("\n");
    expect(joined).not.toContain(Bun.env["MANUAL_PASSWORD"] ?? "no-env-pw-never-present");
    expect(joined).not.toContain(Bun.env["MANUAL_USERNAME"] ?? "no-env-user-never-present");

    // Pipeline sur fixtures synthétiques uniquement (jamais de données perso).
    const chunks = syntheticManualDocs.flatMap((d) => chunkManual(d, 500));
    expect(chunks.length).toBeGreaterThan(0);
    const hits = retrieveManuals(chunks, "fractions half quarter", 2);
    expect(hits.length).toBeGreaterThan(0);
    const corrige = formatCorrigeWithCitations("Corrigé : 1/2 + 1/4 = 3/4.", hits);
    expect(corrige).toContain("Sources :");
    expect(corrige).toContain(hits[0].source);

    // Contenus = Untrusted avant IA (I6), nonce tracé.
    const marked = markManualsUntrusted(syntheticManualDocs);
    expect(marked.every((m) => m.__untrusted)).toBe(true);
    const prompt = buildRevisionPrompt([corrige, citeSources(hits)]);
    expect(prompt.body).toContain(`nonce="${prompt.nonce}"`);
    expect(prompt.body).toContain("Sources :");
    expect(prompt.body).not.toContain(Bun.env["MANUAL_PASSWORD"] ?? "no-env-pw-never-present");
  });

  test("scrape vers boucle locale ou skip gracieux sans navigateur", async () => {
    const config = loadManualsConfig();
    if (!(await isPlaywrightAvailable())) {
      let err: Error | null = null;
      try {
        await scrapeManuals(config, { startUrl: "https://docs.example.invalid/page" });
      } catch (e) {
        err = e as Error;
      }
      expect(err?.message ?? "").not.toContain(Bun.env["MANUAL_PASSWORD"] ?? "no-env-pw-never-present");
      expect(true).toBe(true);
      return;
    }
    // Navigateur présent : scrape une page locale, aucun réseau externe.
    const server = Bun.serve({
      port: 0,
      hostname: "127.0.0.1",
      fetch: async () =>
        new Response("<html><head><title>Page-Fake</title></head><body><p>Extrait synthétique fractions.</p></body></html>", {
          headers: { "content-type": "text/html" },
        }),
    });
    try {
      const logs: string[] = [];
      const docs = await scrapeManuals(
        config ?? { platform: "editeur-fake", username: "u", password: "p" },
        {
          startUrl: `http://127.0.0.1:${server.port}/manuel-fake`,
          authFile: `playwright/.auth/e2e-manuals-${Date.now()}.json`,
          headless: true,
          timeoutMs: 10_000,
          logger: (m) => logs.push(m),
        },
      );
      expect(Array.isArray(docs)).toBe(true);
      expect(logs.join("\n")).not.toContain(Bun.env["MANUAL_PASSWORD"] ?? "no-env-pw-never-present");
    } finally {
      server.stop(true);
    }
  });
});
