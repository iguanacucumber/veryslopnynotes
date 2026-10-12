// Tests collectResourceCorpus (issue #84).
// Ordre session-d'abord vérifié en mocks : session OK sans fallback,
// session vide -> fallback Playwright (mocké), tout échoue -> vide.
// Aucun réseau, aucun secret réel.
import { describe, expect, test } from "bun:test";
import { collectResourceCorpus, fetchResourceCorpusViaScraper } from "../../server/infrastructure/resources-corpus";
import { untrusted } from "../../server/domain/ports";
import type { PedagogicResource } from "../../server/domain/ports";
import { syntheticManualAccount } from "./fixtures/manuals";

function fakeResource(origin: PedagogicResource["origin"], id: string): PedagogicResource {
  return {
    id,
    accountId: "acc-fake-1",
    subject: "Maths-Fake",
    title: `Doc ${id}`,
    excerpt: `Extrait synthétique ${id}.`,
    origin,
    ref: `ref-${id}`,
  };
}

describe("collectResourceCorpus", () => {
  test("session d'abord : docs Pronote sans fallback", async () => {
    const logs: string[] = [];
    const reader = {
      getResources: async () => ({
        items: untrusted([fakeResource("lesson-content", "l1"), fakeResource("homework-file", "h1")]),
        nextCursor: null,
      }),
      getGrades: async () => { throw new Error("unused"); },
      getAssignments: async () => { throw new Error("unused"); },
      getTimetable: async () => { throw new Error("unused"); },
    };
    const corpus = await collectResourceCorpus({
      reader: reader as never,
      accountId: "acc-fake-1",
      logger: (m) => logs.push(m),
    });
    expect(corpus.origin).toBe("pronote-session");
    expect(corpus.docs).toHaveLength(2);
    expect(corpus.docs[0].platform).toBe("pronote-session");
    expect(corpus.counts["lesson-content"]).toBe(1);
    expect(corpus.counts["homework-file"]).toBe(1);
  });

  test("session vide -> fallback non tenté sans config/url, corpus vide", async () => {
    const reader = {
      getResources: async () => ({ items: untrusted([]), nextCursor: null }),
      getGrades: async () => { throw new Error("unused"); },
      getAssignments: async () => { throw new Error("unused"); },
      getTimetable: async () => { throw new Error("unused"); },
    };
    const corpus = await collectResourceCorpus({ reader: reader as never, accountId: "acc-fake-1" });
    expect(corpus.docs).toHaveLength(0);
    expect(corpus.origin).toBe("pronote-session");
  });

  test("sans reader : fallback skip sans config, corpus vide sans throw", async () => {
    const corpus = await collectResourceCorpus({ manuals: null, startUrl: "" });
    expect(corpus.docs).toHaveLength(0);
  });
});

describe("fetchResourceCorpusViaScraper (#209 : client -> scraper HTTPS, sans auth)", () => {
  const manuals = {
    platform: syntheticManualAccount.platform,
    username: syntheticManualAccount.username,
    password: syntheticManualAccount.password,
  };
  const doc = {
    id: "scrape-9",
    platform: syntheticManualAccount.platform,
    title: "Grammaire-Fake",
    subject: "Francais-Fake",
    page: 2,
    excerpt: "Extrait synthetique passe compose.",
  };

  test("scraper OK : docs mappées, origine scraper-https", async () => {
    const seen: { url: string; init: unknown }[] = [];
    const doFetch = (async (url: string, init: unknown) => {
      seen.push({ url, init });
      return new Response(JSON.stringify({ docs: [doc] }), { status: 200 });
    }) as unknown as typeof fetch;
    const logs: string[] = [];
    const corpus = await fetchResourceCorpusViaScraper({
      scraperBaseUrl: "https://scraper.example.invalid:8080/",
      manuals,
      startUrl: "https://manuels.example.invalid/grammaire",
      doFetch,
      logger: (m) => logs.push(m),
    });
    expect(corpus.origin).toBe("scraper-https");
    expect(corpus.docs).toHaveLength(1);
    expect(corpus.docs[0]?.page).toBe(2);
    expect(seen).toHaveLength(1);
    expect(seen[0]?.url).toBe("https://scraper.example.invalid:8080/v1/manuals/scrape");
    const sent = JSON.stringify(seen[0]?.init);
    expect(sent).toContain(syntheticManualAccount.username);
    const joined = logs.join("\n");
    expect(joined).not.toContain(syntheticManualAccount.password);
    expect(joined).not.toContain(syntheticManualAccount.username);
  });

  test("scraper KO : repli vide propre, jamais de throw", async () => {
    const base = {
      scraperBaseUrl: "https://scraper.example.invalid:8080",
      manuals,
      startUrl: "https://manuels.example.invalid/grammaire",
    };
    // Injoignable.
    const down = await fetchResourceCorpusViaScraper({
      ...base,
      doFetch: (async () => {
        throw new Error("connexion refusee");
      }) as unknown as typeof fetch,
    });
    expect(down).toEqual({ docs: [], origin: "scraper-https", counts: {} });
    // Non-200.
    const err = await fetchResourceCorpusViaScraper({
      ...base,
      doFetch: (async () => new Response("{}", { status: 502 })) as unknown as typeof fetch,
    });
    expect(err.docs).toHaveLength(0);
    // Payload hors contrat.
    const junk = await fetchResourceCorpusViaScraper({
      ...base,
      doFetch: (async () => new Response(JSON.stringify({ docs: "non" }), { status: 200 })) as unknown as typeof fetch,
    });
    expect(junk.docs).toHaveLength(0);
    // Base URL refusée.
    const refused = await fetchResourceCorpusViaScraper({ ...base, scraperBaseUrl: "ftp://hote.invalid" });
    expect(refused.docs).toHaveLength(0);
  });
});
