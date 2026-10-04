// Tests PronoteSessionStore + PronoteClientReader (issue #73).
// Mocks injectés (factory/sessions) : aucun réseau, aucun secret réel.
// Fixtures synthétiques fake-UNREAL uniquement.
import { describe, expect, test } from "bun:test";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteAuthError, PronoteReadError } from "../../server/domain/ports";
import { isAssignment, isGrade, isPeriod, isTimetableEntry } from "../../shared/contracts/models";
import { isPedagogicResource } from "../../server/domain/ports";
import {
  syntheticAccountId,
  syntheticQr,
  syntheticSessionCredentials,
} from "./fixtures/pronote";

const creds = syntheticSessionCredentials;

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

// #74 : période id + moyennes de classe + bonus/facultative + libellé.
function fakeClientAverages() {
  return {
    periods: [
      {
        id: "period-1",
        name: "Trimestre 1",
        start: new Date("2026-09-01T00:00:00.000Z"),
        end: new Date("2026-11-30T23:59:59.000Z"),
        grades: async () => [
          {
            id: "g1",
            grade: "15",
            outOf: "20",
            date: new Date("2026-09-20T10:00:00.000Z"),
            subject: { name: "Maths" },
            coefficient: "1",
            average: "12",
            min: "4",
            max: "19",
            isBonus: false,
            isOptionnal: false,
            comment: "Contrôle 1",
          },
          {
            id: "g2",
            grade: "18",
            outOf: "20",
            date: new Date("2026-09-25T10:00:00.000Z"),
            subject: { name: "EPS" },
            isBonus: true,
            isOptionnal: true,
            // Moyennes de classe illisibles (non notées) : doivent disparaître.
            average: "N.Rendu",
            min: "",
            max: "",
          },
        ],
      },
      {
        id: "period-2",
        name: "Trimestre 2",
        start: new Date("2026-12-01T00:00:00.000Z"),
        end: new Date("2027-02-28T23:59:59.000Z"),
        grades: async () => [],
      },
    ],
  };
}

describe("PronoteSessionStore", () => {
  test("auth OK, sessions isolées", async () => {
    const logs: string[] = [];
    const store = new PronoteSessionStore({
      clientFactory: (async () => fakeClient()) as never,
      logger: (m) => logs.push(m),
    });
    const s = await store.authenticate({ ...creds });
    expect(s.accountId).toBe(syntheticAccountId);
    expect(store.isAuthenticated(syntheticAccountId)).toBe(true);
    expect(store.isAuthenticated("autre")).toBe(false);
    expect(store.requireClient(syntheticAccountId)).toBeDefined();
    const joined = logs.join("\n");
    expect(joined).not.toContain(syntheticQr.jeton);
    expect(joined).not.toContain(syntheticQr.login);
  });

  test("validation vide -> invalid_credentials", async () => {
    const store = new PronoteSessionStore({
      clientFactory: (async () => fakeClient()) as never,
    });
    for (const bad of [
      { ...creds, accountId: "  " },
      { ...creds, pronoteUrl: "  " },
      // QR + pin incomplets = preuve de détention absente : refus, pas d'appel.
      { ...creds, qr: { login: "", jeton: creds.qr.jeton } },
      { ...creds, qr: { login: creds.qr.login, jeton: "" } },
      { ...creds, pin: "" },
    ]) {
      const err = await store.authenticate(bad).catch((e: unknown) => e);
      // Sans URL ni compte -> invalid_credentials ; QR/pin incomplets ->
      // qr_rejected (« rescane »), les deux sont des refus AVEC réseau.
      expect(["invalid_credentials", "qr_rejected"]).toContain((err as PronoteAuthError).code);
    }
  });

  test("ni URL ni compte -> invalid_credentials sans appel réseau", async () => {
    let calls = 0;
    const store = new PronoteSessionStore({
      clientFactory: (async () => {
        calls += 1;
        return fakeClient();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      }) as any,
    });
    const err = await store.authenticate({ ...creds, accountId: "", pronoteUrl: "" }).catch((e: unknown) => e);
    expect((err as PronoteAuthError).code).toBe("invalid_credentials");
    expect(calls).toBe(0);
  });

  test("echec incomprehensible de la lib au login -> pronote_unavailable", async () => {
    const store = new PronoteSessionStore({
      clientFactory: (async () => {
        throw new Error("boom Pronote");
      }) as never,
    });
    const err = await store.authenticate({ ...creds }).catch((e: unknown) => e);
    expect((err as PronoteAuthError).code).toBe("pronote_unavailable");
  });

  test("invalidate + requireClient -> session_expired + re-auth OK", async () => {
    const store = new PronoteSessionStore({
      clientFactory: (async () => fakeClient()) as never,
    });
    await store.authenticate({ ...creds });
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
    await store.authenticate({ ...creds });
    expect(store.isAuthenticated(syntheticAccountId)).toBe(true);
  });
});

describe("PronoteClientReader", () => {
  test("grades typées + pagination + Untrusted, invalides filtrées", async () => {
    const logs: string[] = [];
    const store = new PronoteSessionStore({
      clientFactory: (async () => fakeClient()) as never,
    });
    await store.authenticate({ ...creds });
    const reader = new PronoteClientReader({ sessions: store, logger: (m) => logs.push(m) });
    const page = await reader.getGrades(syntheticAccountId, { limit: 10 });
    expect(page.items.__untrusted).toBe(true);
    expect(page.items.value).toHaveLength(1);
    expect(isGrade(page.items.value[0])).toBe(true);
    expect(page.items.value[0]?.value).toBe(14.5);
    expect(page.nextCursor).toBeNull();
    expect(logs.join("\n")).not.toContain(syntheticQr.jeton);
  });

  test("assignments + timetable + resources OK, contrats valides", async () => {
    const store = new PronoteSessionStore({
      clientFactory: (async () => fakeClient()) as never,
    });
    await store.authenticate({ ...creds });
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

  test("#74 : moyennes de classe, période, bonus/facultative, libellé mappés", async () => {
    const store = new PronoteSessionStore({
      clientFactory: (async () => fakeClientAverages()) as never,
    });
    await store.authenticate({ ...creds });
    const reader = new PronoteClientReader({ sessions: store });
    const page = await reader.getGrades(syntheticAccountId);
    const [g1, g2] = page.items.value;
    expect(isGrade(g1)).toBe(true);
    expect(g1?.classAverage).toBe(12);
    expect(g1?.classMin).toBe(4);
    expect(g1?.classMax).toBe(19);
    expect(g1?.periodId).toBe("period-1");
    expect(g1?.label).toBe("Contrôle 1");
    // Flags absents (pas false) quand Pronote ne les publie pas : contrat add-only.
    expect(g1?.bonus).toBeUndefined();
    expect(g1?.optional).toBeUndefined();
    // Moyennes de classe illisibles retirées, pas de 0 trompeur.
    expect(g2?.bonus).toBe(true);
    expect(g2?.optional).toBe(true);
    expect(g2?.classAverage).toBeUndefined();
    expect(g2?.classMin).toBeUndefined();
    expect(g2?.classMax).toBeUndefined();
    expect(isGrade(g2)).toBe(true);
  });

  test("#74 : périodes mappées et validées, Untrusted", async () => {
    const store = new PronoteSessionStore({
      clientFactory: (async () => fakeClientAverages()) as never,
    });
    await store.authenticate({ ...creds });
    const reader = new PronoteClientReader({ sessions: store });
    const page = await reader.getPeriods(syntheticAccountId);
    expect(page.items.__untrusted).toBe(true);
    expect(page.nextCursor).toBeNull();
    expect(page.items.value).toHaveLength(2);
    expect(page.items.value.every(isPeriod)).toBe(true);
    expect(page.items.value[0]?.id).toBe("period-1");
    expect(page.items.value[0]?.name).toBe("Trimestre 1");
    expect(Date.parse(page.items.value[0]!.start)).toBeLessThan(Date.parse(page.items.value[0]!.end));
    // Session absente : erreur typée, pas de fuite.
    const cold = new PronoteClientReader({ sessions: store });
    const err = await cold.getPeriods("acc-inconnu").catch((e: unknown) => e);
    expect((err as PronoteReadError).code).toBe("session_expired");
  });

  test("sans session -> session_expired, from/to invalides -> pronote_unavailable", async () => {
    const store = new PronoteSessionStore({
      clientFactory: (async () => fakeClient()) as never,
    });
    const reader = new PronoteClientReader({ sessions: store });
    const err = await reader.getGrades("acc-inconnu").catch((e: unknown) => e);
    expect((err as PronoteReadError).code).toBe("session_expired");
    await store.authenticate({ ...creds });
    const bad = await reader.getTimetable(syntheticAccountId, { from: "pas-une-date" }).catch((e: unknown) => e);
    expect((bad as PronoteReadError).code).toBe("pronote_unavailable");
  });
});
