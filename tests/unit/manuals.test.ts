import { describe, expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { isManualsConfigured, loadManualsConfig } from "../../server/infrastructure/manuals-config";
import {
  LocalManualProvider,
  MANUAL_INDEX_KEY,
  buildManualIndex,
  chunkManual,
  citeSources,
  formatCorrigeWithCitations,
  loadIndexedChunks,
  loadManualChunk,
  loadManualIndex,
  markManualsUntrusted,
  parseManualSource,
  retrieveManuals,
  saveManualChunks,
  searchManualIndex,
} from "../../server/infrastructure/manuals";
import { ScrapeManualsError, isPlaywrightAvailable, scrapeManuals } from "../../server/infrastructure/manuals-scrape";
import { SqliteStorageProvider } from "../../server/infrastructure/sqlite-storage";
import { syntheticManualAccount, syntheticManualDocs } from "./fixtures/manuals";

function envFull(over: Record<string, string | undefined> = {}) {
  return {
    MANUAL_PLATFORM: syntheticManualAccount.platform,
    MANUAL_USERNAME: syntheticManualAccount.username,
    MANUAL_PASSWORD: syntheticManualAccount.password,
    ...over,
  };
}

function tmpDb(): string {
  return join(mkdtempSync(join(tmpdir(), "vslm-")), "test.db");
}

describe("unit manuals", () => {
  test("config null si incomplet, OK si complet (trim)", () => {
    expect(loadManualsConfig({})).toBeNull();
    expect(loadManualsConfig(envFull({ MANUAL_USERNAME: "" }))).toBeNull();
    expect(loadManualsConfig(envFull({ MANUAL_PASSWORD: "  " }))).toBeNull();
    const full = loadManualsConfig(envFull());
    expect(full?.platform).toBe(syntheticManualAccount.platform);
    expect(loadManualsConfig(envFull({ MANUAL_PLATFORM: "  editeur-fake  " }))?.platform).toBe(
      "editeur-fake",
    );
    expect(isManualsConfigured(envFull())).toBe(true);
    expect(isManualsConfigured({})).toBe(false);
  });

  test("chunkManual découpe déterministe + source", () => {
    const chunks = chunkManual(syntheticManualDocs[0], 20);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].docId).toBe(syntheticManualDocs[0].id);
    expect(chunks[0].source).toContain("Maths-Fake 6e");
    expect(chunks[0].source).toContain("p.42");
    expect(chunkManual({ ...syntheticManualDocs[0], excerpt: "   " })).toEqual([]);
    // rejouable
    expect(chunkManual(syntheticManualDocs[0], 20)).toEqual(chunks);
  });

  test("retrieveManuals score par recouvrement, limite + vide", () => {
    const chunks = syntheticManualDocs.flatMap((d) => chunkManual(d, 500));
    const hits = retrieveManuals(chunks, "fractions half quarter", 3);
    expect(hits.length).toBeGreaterThanOrEqual(1);
    expect(hits[0].docId).toBe("manuel-fake-maths-6e");
    expect(retrieveManuals(chunks, "   ")).toEqual([]);
    expect(retrieveManuals(chunks, "quasar xylophone wombat")).toEqual([]);
    expect(retrieveManuals(chunks, "synthetic lesson", 1).length).toBeLessThanOrEqual(1);
  });

  test("citeSources déduplique, corrigé cite toujours", () => {
    const chunks = syntheticManualDocs.flatMap((d) => chunkManual(d, 500));
    const cited = citeSources(chunks.slice(0, 2));
    expect(cited).toContain("Sources :");
    const corrige = formatCorrigeWithCitations("Réponse : 3/4.", chunks.slice(0, 1));
    expect(corrige).toContain("Réponse : 3/4.");
    expect(corrige).toContain("Sources :");
    expect(corrige).toContain(chunks[0].source);
    expect(citeSources([])).toContain("aucune");
  });

  test("markManualsUntrusted marque I6 avant IA", () => {
    const marked = markManualsUntrusted(syntheticManualDocs);
    expect(marked.length).toBe(syntheticManualDocs.length);
    for (const m of marked) {
      expect(m.__untrusted).toBe(true);
      expect(typeof m.value).toBe("string");
    }
  });

  test("persistance chunks via StorageProvider (phase 3)", async () => {
    const store = new SqliteStorageProvider(tmpDb());
    const chunks = chunkManual(syntheticManualDocs[0], 50);
    await saveManualChunks(store, chunks.slice(0, 2));
    const back = await loadManualChunk(store, chunks[0].docId, 0);
    expect(back).toEqual(chunks[0]);
    expect(await loadManualChunk(store, "nope", 99)).toBeNull();
    store.close();
  });

  test("provider local search + taille", () => {
    const chunks = syntheticManualDocs.flatMap((d) => chunkManual(d, 500));
    const p = new LocalManualProvider(syntheticManualAccount.platform, chunks);
    expect(p.platform).toBe(syntheticManualAccount.platform);
    expect(p.size).toBe(chunks.length);
    expect(p.search("passé composé auxiliaire")[0]?.docId).toBe("manuel-fake-francais-5e");
  });

  test("scrape refuse sans config / mauvaise URL / sans navigateur (sans fuite)", async () => {
    await expect(scrapeManuals(null, { startUrl: "https://x.example.invalid/" })).rejects.toBeInstanceOf(
      ScrapeManualsError,
    );
    await expect(
      scrapeManuals(loadManualsConfig(envFull()), { startUrl: "not-a-url" }),
    ).rejects.toThrow("startUrl");
    // CI sans Playwright : message utile, jamais de credential dedans.
    if (!(await isPlaywrightAvailable())) {
      let err: Error | null = null;
      try {
        await scrapeManuals(loadManualsConfig(envFull()), {
          startUrl: "https://docs.example.invalid/page",
        });
      } catch (e) {
        err = e as Error;
      }
      expect(err).toBeInstanceOf(ScrapeManualsError);
      expect(err?.message ?? "").not.toContain(syntheticManualAccount.password);
      expect(err?.message ?? "").not.toContain(syntheticManualAccount.username);
    }
  });

  test("index versionné build/load/loadAll + rebuild idempotent (#26)", async () => {
    const store = new SqliteStorageProvider(tmpDb());
    expect(await loadManualIndex(store)).toBeNull();
    expect(await loadIndexedChunks(store)).toEqual([]);
    const { index, chunks } = await buildManualIndex(store, syntheticManualDocs, 500);
    expect(index.version).toBe(1);
    expect(index.chunkCount).toBe(chunks.length);
    expect(index.chunkKeys.length).toBe(chunks.length);
    expect(Number.isNaN(Date.parse(index.builtAt))).toBe(false);
    expect(await loadManualIndex(store)).toEqual(index);
    expect(await loadIndexedChunks(store)).toEqual(chunks);
    // rebuild écrase, mêmes clés
    const again = await buildManualIndex(store, syntheticManualDocs, 500);
    expect(again.index.chunkKeys).toEqual(index.chunkKeys);
    expect(await loadIndexedChunks(store)).toEqual(chunks);
    store.close();
  });

  test("index stale/corrompu → null + chunks ignorés, search vide (#26)", async () => {
    const store = new SqliteStorageProvider(tmpDb());
    const enc = new TextEncoder();
    await store.set(MANUAL_INDEX_KEY, enc.encode(JSON.stringify({ version: 999, chunkKeys: [], chunkCount: 0, builtAt: "x" })));
    expect(await loadManualIndex(store)).toBeNull();
    await store.set(MANUAL_INDEX_KEY, enc.encode("not-json{{{"));
    expect(await loadManualIndex(store)).toBeNull();
    expect(await searchManualIndex(store, "fractions")).toEqual([]);
    store.close();
  });

  test("searchManualIndex citable : source + page + extrait, citation corrigé (#26)", async () => {
    const store = new SqliteStorageProvider(tmpDb());
    await buildManualIndex(store, syntheticManualDocs, 500);
    const hits = await searchManualIndex(store, "fractions half quarter", 2);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0].source).toContain("p.42");
    expect(hits[0].text.length).toBeGreaterThan(0);
    const parsed = parseManualSource(hits[0].source);
    expect(parsed.platform).toBe("editeur-fake");
    expect(parsed.title).toContain("Maths-Fake");
    expect(parsed.page).toBe(42);
    // citation obligatoire exposée aux corrigés phase 9
    const corrige = formatCorrigeWithCitations("Corrigé : 3/4.", hits.slice(0, 1));
    expect(corrige).toContain("Sources :");
    expect(corrige).toContain(hits[0].source);
    expect(await searchManualIndex(store, "quasar xylophone wombat")).toEqual([]);
    store.close();
  });

  test("parseManualSource legacy : jamais de throw, page -1", () => {
    expect(parseManualSource("editeur-fake • Titre • p.abc")).toEqual({
      platform: "editeur-fake",
      title: "Titre",
      page: -1,
    });
    expect(parseManualSource("source-brute").page).toBe(-1);
  });

  test("fixtures synthétiques : aucune URL réelle ni secret", async () => {    const { readFileSync } = await import("node:fs");
    const url = new URL("./fixtures/manuals.ts", import.meta.url).pathname;
    const content = readFileSync(url, "utf8");
    expect(content).not.toMatch(/https?:\/\/(?!example\.invalid|docs\.example\.invalid)[^\s"']+/i);
    expect(content).not.toMatch(/sk-or-v1-|BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY/);
    expect(content).not.toMatch(/MANUAL_PASSWORD\s*=\s*[^$\s][^\n]{3,}/);
  });
});
