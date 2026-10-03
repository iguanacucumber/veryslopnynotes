// Bugs adversariaux — manuels (manuals.ts, manuals-config.ts, manuals-scrape.ts,
// resources-corpus.ts). Aucun réseau : le scraping est simulé via mock.module
// ("playwright"), le HTML est synthétique et inline, tous comptes/URLs sont
// factices (example.invalid). Chaque test est volontairement ROUGE : il
// documente un bug actuel du code source, pas un comportement attendu.
import { afterEach, describe, expect, mock, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildManualIndex,
  chunkManual,
  loadIndexedChunks,
  loadManualChunk,
  retrieveManuals,
} from "../../server/infrastructure/manuals";
import type { ManualDoc } from "../../server/infrastructure/manuals";
import { ScrapeManualsError, scrapeManuals } from "../../server/infrastructure/manuals-scrape";
import { collectResourceCorpus } from "../../server/infrastructure/resources-corpus";
import { untrusted } from "../../server/domain/ports";
import type { PedagogicResource, PronoteReader } from "../../server/domain/ports";
import { SqliteStorageProvider } from "../../server/infrastructure/sqlite-storage";

// --- helpers (tout synthétique) -------------------------------------------

// HTML 100% synthétique, aucun contenu de manuel réel.
const FAKE_HTML_ERREUR_404 =
  "<html><head><title>Page introuvable</title></head><body><h1>404</h1><p>Le manuel demande est introuvable.</p></body></html>";
const FAKE_HTML_ENTITES =
  "<html><head><title>Titre-Fake</title></head><body><p>Caf&eacute; &amp; cr&egrave;me&nbsp;: 3 &lt; 4</p><script>var a = 1;</script></body></html>";

function fakeDoc(over: Partial<ManualDoc> = {}): ManualDoc {
  return {
    id: "doc-fake-1",
    platform: "editeur-fake",
    title: "Titre-Fake",
    subject: "Matiere-Fake",
    page: 1,
    excerpt: "contenu synthetique sans aucune donnee reelle",
    ...over,
  };
}

function tmpDb(): string {
  return join(mkdtempSync(join(tmpdir(), "vslm-bugs-")), "test.db");
}

function fakeResource(over: Partial<PedagogicResource> = {}): PedagogicResource {
  return {
    id: "l1",
    accountId: "acc-fake-1",
    subject: "Matiere-Fake",
    title: "Ressource-Fake",
    excerpt: "extrait synthetique",
    origin: "lesson-content",
    ref: "ref-fake",
    ...over,
  };
}

// Lecteur Pronote minimal : seule getResources compte, les autres méthodes ne
// doivent jamais être appelées par le corpus.
function readerReturning(
  getResources: (accountId: string, page?: { limit?: number; cursor?: string }) => unknown,
): PronoteReader {
  const unused = async () => {
    throw new Error("unused");
  };
  return {
    getResources,
    getGrades: unused,
    getAssignments: unused,
    getTimetable: unused,
  } as unknown as PronoteReader;
}

// Simule le module "playwright" (résolution dynamique dans manuals-scrape).
// Aucun navigateur, aucun réseau : page HTML et statut HTTP fournis en dur.
function stubPlaywright(html: string, title: string, status = 200): void {
  mock.module("playwright", () => ({
    chromium: {
      launch: async () => ({
        newContext: async () => ({
          newPage: async () => ({
            goto: async () => ({ status: () => status, ok: () => status < 400 }),
            title: async () => title,
            content: async () => html,
          }),
          storageState: async () => ({}),
          close: async () => {},
        }),
        close: async () => {},
      }),
    },
  }));
}

const fakeConfig = { platform: "editeur-fake", username: "fake-user-UNREAL", password: "fake-pw-UNREAL" };
const fakeStart = "https://example.invalid/manuel-fake";

// Well-formedness UTF-16 (équivalent de String#isWellFormed, absent de lib ES2022).
function isWellFormedUtf16(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c >= 0xd800 && c <= 0xdbff) {
      const n = s.charCodeAt(i + 1);
      if (!(n >= 0xdc00 && n <= 0xdfff)) return false;
      i++;
    } else if (c >= 0xdc00 && c <= 0xdfff) {
      return false;
    }
  }
  return true;
}

const realFetch = globalThis.fetch;
afterEach(() => {
  globalThis.fetch = realFetch;
  mock.restore();
});

describe("BUGS manuels", () => {
  test("BUG: scrapeManuals ignore le statut HTTP — une page d'erreur 404 est ingérée comme manuel (puis indexée et citée)", async () => {
    stubPlaywright(FAKE_HTML_ERREUR_404, "Page introuvable", 404);
    // Un 404 ne doit jamais produire de ManualDoc : le corpus citerait "Page
    // introuvable" comme source de corrigé.
    await expect(scrapeManuals(fakeConfig, { startUrl: fakeStart, authFile: "" })).rejects.toBeInstanceOf(
      ScrapeManualsError,
    );
  });

  test("BUG: chunkKey ne déduplique pas les docId — deux docs de même id s'écrasent (contenu perdu + clé de manifeste dupliquée)", async () => {
    const store = new SqliteStorageProvider(tmpDb());
    // ScrapeManuals génère id = `scrape-${Date.now()}` : deux scrapes dans la
    // même milliseconde (ou deux pages rendues dans le même lot) donnent le
    // même docId, donc la même clé de chunk.
    const { index } = await buildManualIndex(
      store,
      [
        fakeDoc({ id: "doc-dup", title: "Premier", excerpt: "texte exclusif au premier document" }),
        fakeDoc({ id: "doc-dup", title: "Second", excerpt: "texte exclusif au second document" }),
      ],
      500,
    );
    // Les deux documents doivent rester adressables : deux clés distinctes,
    // et le texte du premier encore présent après relecture.
    const loaded = await loadIndexedChunks(store);
    expect(loaded.map((c) => c.text)).toContain("texte exclusif au premier document");
    expect(index.chunkKeys[0]).not.toBe(index.chunkKeys[1]);
    store.close();
  });

  test("BUG: stripTags ne décode pas les entités HTML — l'extrait scrapé contient « &eacute; »/« &nbsp; » (texte illisible et introuvable à la recherche)", async () => {
    stubPlaywright(FAKE_HTML_ENTITES, "Titre-Fake");
    const docs = await scrapeManuals(fakeConfig, { startUrl: fakeStart, authFile: "" });
    expect(docs[0]?.excerpt ?? "").toContain("Café & crème");
  });

  test("BUG: rebuild d'index ne supprime pas les chunks orphelins — le contenu d'un manuel retiré reste lisible indéfiniment en base", async () => {
    const store = new SqliteStorageProvider(tmpDb());
    const long = fakeDoc({ id: "doc-retracable", excerpt: "aaaa bbbb cccc dddd eeee" });
    const { index: first } = await buildManualIndex(store, [long], 9);
    const lastIndex = first.chunkKeys.length - 1;
    // Le manuel est ensuite raccourci (contenu retiré côté éditeur).
    await buildManualIndex(store, [fakeDoc({ id: "doc-retracable", excerpt: "aaaa" })], 9);
    // La clé retirée du manifeste ne doit plus exister en base.
    expect(await loadManualChunk(store, "doc-retracable", lastIndex)).toBeNull();
    store.close();
  });

  test("BUG: collectResourceCorpus ignore nextCursor — seules les 100 premières ressources entrent dans le corpus, la suite est perdue silencieusement", async () => {
    const seenCursors: (string | undefined)[] = [];
    const reader = readerReturning((_accountId, page) => {
      seenCursors.push(page?.cursor);
      if (!page?.cursor) {
        return {
          items: untrusted([fakeResource({ id: "l1", excerpt: "page une" })]),
          nextCursor: "1",
        };
      }
      return {
        items: untrusted([fakeResource({ id: "l2", excerpt: "page deux" })]),
        nextCursor: null,
      };
    });
    const corpus = await collectResourceCorpus({ reader, accountId: "acc-fake-1", manuals: null, startUrl: "" });
    expect(seenCursors.length).toBe(2);
    expect(corpus.docs.map((d) => d.id)).toContain("pronote-res-l2");
  });

  test("BUG: la troncature slice(0, 4000) coupe une paire de surrogates — l'extrait se termine par un demi-caractère orphelin (texte corrompu)", async () => {
    const reader = readerReturning(async () => ({
      items: untrusted([fakeResource({ excerpt: "x".repeat(3999) + "😀" })]),
      nextCursor: null,
    }));
    const corpus = await collectResourceCorpus({ reader, accountId: "acc-fake-1", manuals: null, startUrl: "" });
    const doc = corpus.docs[0];
    expect(doc).toBeDefined();
    expect(doc!.excerpt).toHaveLength(4000);
    // Un extrait bien formé doit finir par le couple complet, pas par un demi-surrogat isolé.
    expect(isWellFormedUtf16(doc!.excerpt)).toBe(true);
  });

  test("BUG: chunkManual ignore maxLen pour un mot plus long que la limite — un chunk de 300 caractères est produit avec maxLen=100", () => {
    const sansEspaces = "x".repeat(300);
    const chunks = chunkManual(fakeDoc({ excerpt: sansEspaces }), 100);
    expect(Math.max(...chunks.map((c) => c.text.length))).toBeLessThanOrEqual(100);
  });

  test("BUG: le normaliseur est limité à a-z0-9 — une requête hors alphabet latin renvoie zéro résultat au lieu du chunk correspondant", () => {
    const chunks = chunkManual(fakeDoc({ excerpt: "exercices de grammaire 语法 exercises" }), 500);
    // Contrôle : le chemin latin fonctionne bien.
    expect(retrieveManuals(chunks, "grammaire")).toHaveLength(1);
    // La même recherche en caractères CJK ne trouve rien.
    expect(retrieveManuals(chunks, "语法")).toHaveLength(1);
  });
});