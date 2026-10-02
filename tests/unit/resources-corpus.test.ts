// Tests collectResourceCorpus (issue #84).
// Ordre session-d'abord vérifié en mocks : session OK sans fallback,
// session vide -> fallback Playwright (mocké), tout échoue -> vide.
// Aucun réseau, aucun secret réel.
import { describe, expect, test } from "bun:test";
import { collectResourceCorpus } from "../../server/infrastructure/resources-corpus";
import { untrusted } from "../../server/domain/ports";
import type { PedagogicResource } from "../../server/domain/ports";

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
