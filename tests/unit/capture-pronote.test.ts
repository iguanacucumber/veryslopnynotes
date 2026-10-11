// Outil de capture du corpus Pronote (#199).
//
// Le corpus lui-même n'est pas dans le dépôt (données d'un élève), donc ces
// tests portent sur ce qui DOIT être vrai même sans compte réel : la forme des
// fixtures, le marquage I6, l'échec d'un domaine recorded comme code, et surtout
// le DÉTERMINISME (critère d'acceptation) — deux captures du même compte doivent
// sortir octet pour octet identiques, sinon le harnais de parité du port Kotlin
// comparerait du bruit.
import { describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DOMAINS, canonicalJson, captureCorpus, writeCorpus } from "../../agents/runtime/capture-pronote";
import { untrusted, PronoteReadError } from "../../server/domain/ports";
import type { PronoteClientReader } from "../../server/integrations/pronote-client-reader";

const ACCOUNT = "acc-fake-1";

/**
 * Lecteur factice dont l'ordre d'insertion des clés est DÉLIBÉRÉMENT différent
 * d'une instance à l'autre : c'est ce qui prouve que la canonisation vient de
 * l'écriture du fichier, pas de l'ordre des mappers.
 */
function fakeReader(second: boolean): PronoteClientReader {
  const note = second
    ? { subject: "Maths", value: 15, scale: 20, id: "g-1", bonus: false, optional: false }
    : { id: "g-1", bonus: false, optional: false, scale: 20, value: 15, subject: "Maths" };
  const grades = () => Promise.resolve({ items: untrusted([note]), nextCursor: null });
  return {
    getGrades: grades,
    getPeriods: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    getProvidedAverages: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    getAssignments: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    getTimetable: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    getResources: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    getNews: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    getAttendance: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    getPunishments: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    // Onglet absent de l'établissement : un refus, pas une capture interrompue.
    getMenus: () => Promise.reject(new PronoteReadError("menus indisponible", "pronote_unavailable")),
    getDiscussions: () =>
      Promise.resolve({
        items: untrusted([
          { id: "d-1", subject: "Absence", unread: 1 },
          { id: "d-2", subject: "Devoirs", unread: 0 },
        ]),
        nextCursor: null,
      }),
    getDiscussionMessages: (accountId: string, discussionId: string) =>
      Promise.resolve({
        items: untrusted([{ id: `${discussionId}-m1`, body: `message de ${discussionId}` }]),
        nextCursor: null,
      }),
    getDiscussionRecipients: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    getUserInfo: () => Promise.resolve({ items: untrusted([]), nextCursor: null }),
    getCapabilities: () => Promise.resolve({ accountId: ACCOUNT, tabs: ["grades"], fetchedAt: "2026-10-05T00:00:00.000Z" }),
  // Le port déclare ces lectures optionnelles ; la façade Reader les a toutes.
  } as unknown as PronoteClientReader;
}

function tempDir(): string {
  return mkdtempSync(join(tmpdir(), "corpus-capture-"));
}

describe("capture du corpus Pronote (#199)", () => {
  test("une fixture par domaine, marquée donnée externe (I6)", async () => {
    const corpus = await captureCorpus(fakeReader(false), ACCOUNT);
    expect(Object.keys(corpus).sort()).toEqual(DOMAINS.map((d) => d.domain).sort());
    for (const [domain, body] of Object.entries(corpus)) {
      const fixture = body as { __untrusted?: boolean };
      expect(`${domain}:${fixture.__untrusted === true}`).toBe(`${domain}:true`);
    }
  });

  test("un domaine en échec est un code typé, pas un message de lib", async () => {
    const corpus = await captureCorpus(fakeReader(false), ACCOUNT);
    expect(corpus.menus).toEqual({ __untrusted: true, error: "pronote_unavailable" });
  });

  test("les fils de discussion sont captures, un par discussion listee", async () => {
    const corpus = await captureCorpus(fakeReader(false), ACCOUNT);
    const threads = corpus.discussionMessages as { items: Record<string, { items: { id: string }[] }> };
    expect(Object.keys(threads.items)).toEqual(["d-1", "d-2"]);
    expect(threads.items["d-1"]?.items[0]?.id).toBe("d-1-m1");
  });

  test("déterminisme : deux captures du même compte sont octet pour octet identiques", async () => {
    const a = tempDir();
    const b = tempDir();
    writeCorpus(await captureCorpus(fakeReader(false), ACCOUNT), a);
    writeCorpus(await captureCorpus(fakeReader(true), ACCOUNT), b);
    const files = readdirSync(a).sort();
    expect(files).toEqual(readdirSync(b).sort());
    for (const file of files) {
      expect(`${file}:${readFileSync(join(b, file), "utf8")}`).toBe(
        `${file}:${readFileSync(join(a, file), "utf8")}`,
      );
    }
  });

  test("JSON canonique : clés triées, `undefined` = clé absente, tableaux intacts", () => {
    expect(canonicalJson({ b: 1, a: { d: 2, c: undefined } })).toBe(
      '{\n  "a": {\n    "d": 2\n  },\n  "b": 1\n}',
    );
    expect(canonicalJson([3, 1, 2])).toBe("[\n  3,\n  1,\n  2\n]");
  });

  test("le corpus n'est jamais committable : le chemin est gitignoré", () => {
    const ignore = readFileSync(join(import.meta.dir, "..", "..", ".gitignore"), "utf8");
    expect(ignore).toContain("tests/fixtures/pronote/");
  });
});
