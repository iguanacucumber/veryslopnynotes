// Tests PronoteSessionStore + PronoteClientReader (issue #73).
// Mocks injectés (factory/entLogin/sessions) : aucun réseau, aucun secret réel.
// Fixtures synthétiques fake-UNREAL uniquement.
import { describe, expect, test } from "bun:test";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteAuthError, PronoteReadError } from "../../server/domain/ports";
import { isAssignment, isGrade, isTimetableEntry } from "../../shared/contracts/models";
import { isPedagogicResource } from "../../server/domain/ports";
import {
  syntheticAccountId,
  syntheticEntKind,
  syntheticPassword,
  syntheticUsername,
} from "./fixtures/pronote";

const creds = {
  accountId: syntheticAccountId,
  username: syntheticUsername,
  password: syntheticPassword,
  entKind: syntheticEntKind,
};

function fakeClient() {
  return {
    periods: [
      {
        grades: async () => [
          { id: "g1", grade: "14,5", outOf: "20", date: new Date("2026-09-20T10:00:00.000Z"), subject: { name: "Maths-Fake" }, coefficient: "2" },
          { id: "g2", grade: "absent", outOf: "20", date: new Date(), subject: { name: "X" } },
        ],
      },
    ],
    homework: async () => [
      { id: "h1", description: "Exos p.12", done: false, date: new Date("2026-10-05T08:00:00.000Z"), subject: { name: "Francais-Fake" } },
    ],
    lessons: async () => [
      {
        id: "l1",
        start: new Date("2026-10-03T08:00:00.000Z"),
        end: new Date("2026-10-03T09:00:00.000Z"),
        subject: { name: "Histoire-Fake" },
        classroom: "Salle-1",
        homeworkDocuments: [{ name: "doc1.pdf", id: "f1" }],
        content: async () => ({
          title: "Séance 1",
          description: "Cours introductif.",
          files: () => [{ name: "cours1.pdf", id: "c1" }],
        }),
      },
    ],
  };
}

describe("PronoteSessionStore", () => {
  test("auth OK via ent injecté, sessions isolées", async () => {
    const logs: string[] = [];
    const store = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      entLogin: (async () => ({}) as unknown as never) as never,
      clientFactory: (async () => fakeClient()) as never,
      logger: (m) => logs.push(m),
    });
    const s = await store.authenticate({ ...creds, entKind: "ninegate" });
    expect(s.accountId).toBe(syntheticAccountId);
    expect(store.isAuthenticated(syntheticAccountId)).toBe(true);
    expect(store.isAuthenticated("autre")).toBe(false);
    expect(store.requireClient(syntheticAccountId)).toBeDefined();
    const joined = logs.join("\n");
    expect(joined).not.toContain(syntheticPassword);
    expect(joined).not.toContain(syntheticUsername);
  });

  test("validation vide -> invalid_credentials", async () => {
    const store = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      clientFactory: (async () => fakeClient()) as never,
    });
    for (const bad of [
      { ...creds, accountId: "  " },
      { ...creds, username: "" },
      { ...creds, password: "" },
      { ...creds, entKind: "" },
    ]) {
      const err = await store.authenticate(bad).catch((e: unknown) => e);
      expect((err as PronoteAuthError).code).toBe("invalid_credentials");
    }
  });

  test("entKind inconnu -> invalid_credentials, echec ent -> ent_unavailable", async () => {
    const store = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      clientFactory: (async () => {
        throw new Error("boom SSO");
      }) as never,
    });
    const errKind = await store.authenticate({ ...creds, entKind: "nope" }).catch((e: unknown) => e);
    expect((errKind as PronoteAuthError).code).toBe("invalid_credentials");
    const errEnt = await store.authenticate({ ...creds, entKind: "ninegate" }).catch((e: unknown) => e);
    expect((errEnt as PronoteAuthError).code).toBe("ent_unavailable");
  });

  test("invalidate + requireClient -> session_expired + re-auth OK", async () => {
    const store = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      clientFactory: (async () => fakeClient()) as never,
    });
    await store.authenticate({ ...creds, entKind: "ninegate" });
    store.invalidate(syntheticAccountId);
    expect(store.isAuthenticated(syntheticAccountId)).toBe(false);
    const err = (() => {
      try {
        store.requireClient(syntheticAccountId);
        return null;
      } catch (e) {
        return e;
      }
    })();
    expect((err as PronoteAuthError).code).toBe("session_expired");
    await store.authenticate({ ...creds, entKind: "ninegate" });
    expect(store.isAuthenticated(syntheticAccountId)).toBe(true);
  });
});

describe("PronoteClientReader", () => {
  test("grades typées + pagination + Untrusted, invalides filtrées", async () => {
    const logs: string[] = [];
    const store = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      clientFactory: (async () => fakeClient()) as never,
    });
    await store.authenticate({ ...creds, entKind: "ninegate" });
    const reader = new PronoteClientReader({ sessions: store, logger: (m) => logs.push(m) });
    const page = await reader.getGrades(syntheticAccountId, { limit: 10 });
    expect(page.items.__untrusted).toBe(true);
    expect(page.items.value).toHaveLength(1);
    expect(isGrade(page.items.value[0])).toBe(true);
    expect(page.items.value[0]?.value).toBe(14.5);
    expect(page.nextCursor).toBeNull();
    expect(logs.join("\n")).not.toContain(syntheticPassword);
  });

  test("assignments + timetable + resources OK, contrats valides", async () => {
    const store = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      clientFactory: (async () => fakeClient()) as never,
    });
    await store.authenticate({ ...creds, entKind: "ninegate" });
    const reader = new PronoteClientReader({ sessions: store });
    const a = await reader.getAssignments(syntheticAccountId);
    expect(a.items.__untrusted).toBe(true);
    expect(isAssignment(a.items.value[0])).toBe(true);
    const t = await reader.getTimetable(syntheticAccountId, {
      from: "2026-10-01T00:00:00.000Z",
      to: "2026-10-07T00:00:00.000Z",
    });
    expect(isTimetableEntry(t.items.value[0])).toBe(true);
    expect(t.items.value[0]?.room).toBe("Salle-1");
    const r = await reader.getResources(syntheticAccountId);
    expect(r.items.__untrusted).toBe(true);
    expect(r.items.value.length).toBeGreaterThanOrEqual(2);
    expect(r.items.value.every(isPedagogicResource)).toBe(true);
    expect(r.items.value.some((x) => x.origin === "lesson-content")).toBe(true);
    expect(r.items.value.some((x) => x.origin === "homework-file")).toBe(true);
  });

  test("sans session -> session_expired, from/to invalides -> ent_unavailable", async () => {
    const store = new PronoteSessionStore({
      pronoteUrl: "https://example.test/pronote/eleve.html",
      clientFactory: (async () => fakeClient()) as never,
    });
    const reader = new PronoteClientReader({ sessions: store });
    const err = await reader.getGrades("acc-inconnu").catch((e: unknown) => e);
    expect((err as PronoteReadError).code).toBe("session_expired");
    await store.authenticate({ ...creds, entKind: "ninegate" });
    const bad = await reader.getTimetable(syntheticAccountId, { from: "pas-une-date" }).catch((e: unknown) => e);
    expect((bad as PronoteReadError).code).toBe("ent_unavailable");
  });
});
