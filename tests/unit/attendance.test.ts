// #77 vie scolaire : contrats stricts, mapper défensif (PronoteClientReader),
// compteurs par période, routes via createHandler, détection de nouvelle absence
// sur données structurées (I7). Fixtures 100 % synthétiques, mocks injectés :
// aucun réseau, aucun secret, aucune URL Pronote.
import { describe, expect, test } from "bun:test";
import { createHandler } from "../../server/api/router";
import { pairedDevice } from "./fixtures/pairing";
import { createMemoryStore } from "../../server/api/store";
import { isApiErrorBody } from "../../server/api/errors";
import { attendancePeriods } from "../../server/domain/attendance";
import { PronoteReadError } from "../../server/domain/ports";
import { syntheticAccountId, syntheticQr, syntheticSessionCredentials } from "./fixtures/pronote";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { PronoteSessionStore } from "../../server/integrations/pronote-sessions";
import { isAttendanceResponse, isPunishmentsResponse } from "../../shared/contracts/api";
import { CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import {
  ABSENCE_MOTIF_MAX_CHARS,
  PUNISHMENT_MOTIF_MAX_CHARS,
  isAbsenceRecord,
  isAttendancePeriod,
  isPunishment,
} from "../../shared/contracts/models";
import { absenceFingerprint, formatAbsencePush, newAbsences } from "../../server/jobs/notify";
import {
  syntheticAbsences,
  syntheticAttendanceClient,
  syntheticAttendancePayload,
  syntheticAttendancePeriods,
  syntheticClientWithoutAttendance,
  syntheticPunishments,
  syntheticPunishmentsPayload,
} from "./fixtures/attendance";

const creds = syntheticSessionCredentials;

function fakeStore(client: unknown) {
  return new PronoteSessionStore({
    clientFactory: (async () => client) as never,
  });
}

async function readerFor(client: unknown, logs: string[] = []) {
  const store = fakeStore(client);
  await store.authenticate({ ...creds });
  return new PronoteClientReader({ sessions: store, logger: (m) => logs.push(m) });
}

describe("contrats vie scolaire (#77)", () => {
  test("AbsenceRecord : valide OK, bornes et fautes rejetées", () => {
    const [absence, late] = syntheticAbsences;
    expect(isAbsenceRecord(absence)).toBe(true);
    // Retard = même modèle, champ `kind` (parité Papillon).
    expect(isAbsenceRecord(late)).toBe(true);
    expect(isAbsenceRecord({ ...absence, kind: "exclusion" })).toBe(false);
    expect(isAbsenceRecord({ ...absence, kind: undefined })).toBe(false);
    expect(isAbsenceRecord({ ...absence, id: "  " })).toBe(false);
    expect(isAbsenceRecord({ ...absence, date: "pas-une-date" })).toBe(false);
    // Plage incohérente : fin avant début = bruit, pas une absence.
    expect(isAbsenceRecord({ ...absence, dateEnd: "2026-09-01T08:00:00.000Z" })).toBe(false);
    expect(isAbsenceRecord({ ...absence, dateEnd: absence.date })).toBe(true);
    expect(isAbsenceRecord({ ...absence, durationMinutes: -1 })).toBe(false);
    expect(isAbsenceRecord({ ...absence, durationMinutes: Number.NaN })).toBe(false);
    expect(isAbsenceRecord({ ...absence, durationMinutes: 30 })).toBe(true);
    expect(isAbsenceRecord({ ...absence, justified: "oui" })).toBe(false);
    expect(isAbsenceRecord({ ...absence, periodId: "" })).toBe(false);
    expect(isAbsenceRecord({ ...absence, motif: "x".repeat(501) })).toBe(false);
    expect(isAbsenceRecord({ ...absence, subject: "y".repeat(65) })).toBe(false);
    expect(isAbsenceRecord(null)).toBe(false);
    expect(isAbsenceRecord([absence])).toBe(false);
  });

  test("Punishment : motif/type requis et bornés, gravité publiée optionnelle", () => {
    const [pun] = syntheticPunishments;
    expect(isPunishment(pun)).toBe(true);
    expect(isPunishment({ ...pun, gravity: undefined })).toBe(true);
    expect(isPunishment({ ...pun, gravity: -3 })).toBe(false);
    expect(isPunishment({ ...pun, motif: "" })).toBe(false);
    expect(isPunishment({ ...pun, type: undefined })).toBe(false);
    expect(isPunishment({ ...pun, motif: "z".repeat(PUNISHMENT_MOTIF_MAX_CHARS + 1) })).toBe(false);
    expect(isPunishment({ ...pun, date: "hier" })).toBe(false);
    expect(isPunishment({ ...pun, dateEnd: "2026-01-01T00:00:00.000Z" })).toBe(false);
  });

  test("AttendancePeriod + réponses : compteurs entiers, listes vides valides", () => {
    for (const p of syntheticAttendancePeriods) expect(isAttendancePeriod(p)).toBe(true);
    expect(isAttendancePeriod({ ...syntheticAttendancePeriods[0], missingMinutes: -1 })).toBe(false);
    expect(isAttendancePeriod({ ...syntheticAttendancePeriods[0], absences: 1.5 })).toBe(false);
    expect(isAttendancePeriod({ ...syntheticAttendancePeriods[0], periodId: "" })).toBe(false);
    expect(isAttendanceResponse(syntheticAttendancePayload)).toBe(true);
    // Onglet vie scolaire absent de l'établissement = listes vides (200).
    expect(isAttendanceResponse({ absences: [], periods: [] })).toBe(true);
    expect(isAttendanceResponse({ absences: syntheticAbsences })).toBe(false);
    expect(isAttendanceResponse({ absences: "non", periods: [] })).toBe(false);
    expect(isPunishmentsResponse(syntheticPunishmentsPayload)).toBe(true);
    expect(isPunishmentsResponse({ punishments: [] })).toBe(true);
    expect(isPunishmentsResponse({ punishments: [{ ...syntheticPunishments[0], motif: "" }] })).toBe(false);
  });

  test("cache : vie scolaire ressource cachable, TTL rythme EDT", () => {
    expect(isCacheableResource("attendance")).toBe(true);
    expect(isCacheableResource("punishments")).toBe(true);
    expect(CACHE_TTL_MS.attendance).toBe(60 * 60 * 1000);
    expect(CACHE_TTL_MS.punishments).toBe(CACHE_TTL_MS.attendance);
    expect(cacheStatus("attendance", 1_000, 1_000 + CACHE_TTL_MS.attendance)).toBe("fresh");
    expect(cacheStatus("punishments", 1_000, 1_000 + CACHE_TTL_MS.punishments + 1)).toBe("stale");
  });
});

describe("compteurs par période (#77)", () => {
  test("dérivés des absences publiées, libellé repris des périodes", () => {
    const counters = attendancePeriods(syntheticAbsences, [
      { id: "p-1", name: "Trimestre 1", start: "2026-09-01T00:00:00.000Z", end: "2026-11-30T23:59:59.000Z" },
      { id: "p-2", name: "Trimestre 2", start: "2026-12-01T00:00:00.000Z", end: "2027-03-31T23:59:59.000Z" },
    ]);
    expect(counters).toEqual(syntheticAttendancePeriods);
    // Période inconnue du store = compteurs sans nom (jamais de libellé inventé).
    expect(attendancePeriods(syntheticAbsences)).toEqual([
      { periodId: "p-1", absences: 2, late: 1, missingMinutes: 250 },
      { periodId: "p-2", absences: 1, late: 0, missingMinutes: 0 },
    ]);
    // Sans absence, aucune période : liste vide.
    expect(attendancePeriods([])).toEqual([]);
    // Sans periodId : jamais rattachée à une période (aucune devinette).
    expect(attendancePeriods([{ ...syntheticAbsences[0], periodId: undefined }])).toEqual([]);
    // Enregistrement non conforme : ignoré des compteurs.
    expect(attendancePeriods([{ ...syntheticAbsences[0], kind: "exclusion" } as never])).toEqual([]);
  });
});

describe("PronoteClientReader vie scolaire (#77)", () => {
  test("absences + retards : mappés, bornés, Untrusted", async () => {
    const logs: string[] = [];
    const reader = await readerFor(syntheticAttendanceClient(), logs);
    const page = await reader.getAttendance(syntheticAccountId);
    expect(page.items.__untrusted).toBe(true);
    expect(page.items.value.every(isAbsenceRecord)).toBe(true);
    const [absence, late, late2] = page.items.value;
    expect(absence?.kind).toBe("absence");
    expect(absence?.date).toBe("2026-10-01T08:00:00.000Z");
    expect(absence?.dateEnd).toBe("2026-10-01T12:00:00.000Z");
    expect(absence?.subject).toBe("Maths");
    // Raisons dédupliquées + bornées, données bornées (I6).
    expect(absence?.motif).toBe("Rendez-vous medical");
    expect(absence?.durationMinutes).toBe(120);
    expect(absence?.justified).toBe(true);
    expect(absence?.periodId).toBe("p-1");
    expect(late?.kind).toBe("late");
    expect(late?.durationMinutes).toBe(10);
    // Sans date : ignorée, jamais de date devinée.
    expect(page.items.value.some((r) => r.id === "a2")).toBe(false);
    // Durée illisible : champ omis (jamais 0 bidon).
    expect(late2?.durationMinutes).toBeUndefined();
    expect(late2?.motif).toBeUndefined();
    expect(page.nextCursor).toBeNull();
    const joined = logs.join("\n");
    expect(joined).toContain("attendance -> ok");
    expect(joined).not.toContain(syntheticQr.jeton);
    expect(joined).not.toContain(syntheticQr.login);
  });

  test("sanctions : nature/motif bornés, repli sans donnée publiée", async () => {
    const logs: string[] = [];
    const reader = await readerFor(syntheticAttendanceClient(), logs);
    const page = await reader.getPunishments(syntheticAccountId);
    expect(page.items.__untrusted).toBe(true);
    expect(page.items.value.every(isPunishment)).toBe(true);
    const [warn, fallback] = page.items.value;
    expect(warn?.type).toBe("Avertissement");
    expect(warn?.motif).toBe("Travail non fait");
    expect(warn?.gravity).toBe(1);
    expect(warn?.periodId).toBe("p-1");
    // Nature + motif absents : valeurs de repli, pas d'erreur.
    expect(fallback?.type).toBe("Sanction");
    expect(fallback?.motif).toBe("Sanction");
    // Sans date : ignorée.
    expect(page.items.value).toHaveLength(2);
    expect(logs.join("\n")).toContain("punishments -> ok");
  });

  test("motif hors bornes tronqué, longues listes de raisons dedoublonnées", async () => {
    const reader = await readerFor({
      periods: [
        {
          id: "p-1",
          punishments: async () => [
            {
              id: "s1",
              given: new Date("2026-10-02T10:00:00.000Z"),
              nature: "N".repeat(300),
              reasons: Array.from({ length: 40 }, (_, i) => `motif-${i} ${"x".repeat(60)}`),
            },
          ],
        },
      ],
    });
    const [pun] = (await reader.getPunishments(syntheticAccountId)).items.value;
    expect(pun?.type.length).toBe(100);
    expect(pun?.motif?.length).toBe(PUNISHMENT_MOTIF_MAX_CHARS);
    expect(isPunishment(pun)).toBe(true);
  });

  test("défensif : onglet vie scolaire absent/KO = page VIDE, journal indisponible", async () => {
    const logs: string[] = [];
    // Établissement sans onglets absences/delays/punishments.
    const noTabs = await readerFor(syntheticClientWithoutAttendance(), logs);
    const empty = await noTabs.getAttendance(syntheticAccountId);
    expect(empty.items.__untrusted).toBe(true);
    expect(empty.items.value).toEqual([]);
    expect(empty.nextCursor).toBeNull();
    expect((await noTabs.getPunishments(syntheticAccountId)).items.value).toEqual([]);
    // Liste des périodes illisible : page VIDE + log `indisponible <code>`.
    const getterKo = await readerFor(
      {
        get periods(): unknown[] {
          throw new Error("PagePeriodes indisponible");
        },
      },
      logs,
    );
    expect((await getterKo.getAttendance(syntheticAccountId)).items.value).toEqual([]);
    expect(logs.join("\n")).toContain("attendance -> indisponible");
    // Une période en erreur n'annule pas les autres (résilience, comme #78).
    const partial = await readerFor({
      periods: [
        {
          id: "p-1",
          absences: async () => {
            throw new Error("PageAbsences indisponible");
          },
          delays: async () => [],
        },
        {
          id: "p-2",
          absences: async () => [{ id: "ok", fromDate: new Date("2026-10-03T08:00:00.000Z"), reasons: [] }],
        },
      ],
    });
    expect((await partial.getAttendance(syntheticAccountId)).items.value.map((r) => r.id)).toEqual(["ok"]);
    // Sans session : erreur de session classique, pas une page vide silencieuse.
    const cold = new PronoteClientReader({ sessions: fakeStore({}) });
    const err = await cold.getAttendance("acc-inconnu").catch((e: unknown) => e);
    expect((err as PronoteReadError).code).toBe("session_expired");
    expect(((await cold.getAttendance("  ").catch((e: unknown) => e)) as PronoteReadError).code).toBe("session_expired");
    expect(((await cold.getPunishments("acc-inconnu").catch((e: unknown) => e)) as PronoteReadError).code).toBe("session_expired");
  });

  test("pagination clampée 1..100 comme les autres lectures", async () => {
    const reader = await readerFor(syntheticAttendanceClient());
    const p1 = await reader.getAttendance(syntheticAccountId, { limit: 1 });
    expect(p1.items.value).toHaveLength(1);
    expect(p1.nextCursor).toBe("1");
    const p2 = await reader.getAttendance(syntheticAccountId, { limit: 1000, cursor: p1.nextCursor ?? undefined });
    expect(p2.items.value.length).toBeGreaterThan(0);
    expect(p2.nextCursor).toBeNull();
  });
});

describe("routes GET /v1/attendance + /v1/punishments (#77)", () => {
  test("store sans vie scolaire : deux listes vides (onglet masqué, pas d'erreur)", async () => {
    const { pairing, auth } = pairedDevice();
    const handler = createHandler(createMemoryStore(), pairing);
    const res = await handler(new Request("http://127.0.0.1/v1/attendance", { headers: auth }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(isAttendanceResponse(body)).toBe(true);
    expect(body.absences).toEqual([]);
    expect(body.periods).toEqual([]);
    const pun = await handler(new Request("http://127.0.0.1/v1/punishments", { headers: auth }));
    expect(pun.status).toBe(200);
    expect((await pun.json()).punishments).toEqual([]);
  });

  test("store seedé : compteurs dérivés + filtre periodId", async () => {
    const { pairing, auth } = pairedDevice();
    const handler = createHandler(
      createMemoryStore({
        absences: syntheticAbsences,
        punishments: syntheticPunishments,
        periods: [
          { id: "p-1", name: "Trimestre 1", start: "2026-09-01T00:00:00.000Z", end: "2026-11-30T23:59:59.000Z" },
          { id: "p-2", name: "Trimestre 2", start: "2026-12-01T00:00:00.000Z", end: "2027-03-31T23:59:59.000Z" },
        ],
      }),
      pairing,
    );
    const all = await handler(new Request("http://127.0.0.1/v1/attendance", { headers: auth }));
    const body = await all.json();
    expect(isAttendanceResponse(body)).toBe(true);
    expect(body.absences).toHaveLength(4);
    expect(body.periods).toEqual(syntheticAttendancePeriods);

    const p1 = await handler(new Request("http://127.0.0.1/v1/attendance?periodId=p-1", { headers: auth }));
    const p1Body = await p1.json();
    expect(p1Body.absences).toHaveLength(3);
    expect(p1Body.periods).toEqual([syntheticAttendancePeriods[0]]);

    // Période inconnue = listes vides, jamais une erreur.
    const inconnu = await handler(new Request("http://127.0.0.1/v1/attendance?periodId=p-42", { headers: auth }));
    expect(inconnu.status).toBe(200);
    expect((await inconnu.json()).absences).toEqual([]);

    const pun = await handler(new Request("http://127.0.0.1/v1/punishments", { headers: auth }));
    const punBody = await pun.json();
    expect(isPunishmentsResponse(punBody)).toBe(true);
    expect(punBody.punishments).toEqual(syntheticPunishments);
  });

  test("méthode/props : 405 sur la mauvaise méthode, 404 hors API_ROUTES", async () => {
    const { pairing, auth } = pairedDevice();
    const handler = createHandler(createMemoryStore(), pairing);
    const post = await handler(new Request("http://127.0.0.1/v1/attendance", { method: "POST", headers: auth }));
    expect(post.status).toBe(405);
    expect(isApiErrorBody(await post.json())).toBe(true);
    const unknown = await handler(new Request("http://127.0.0.1/v1/sanctions", { headers: auth }));
    expect(unknown.status).toBe(404);
  });
});

describe("détection de nouvelle absence sur données structurées (#77, I7)", () => {
  test("diff d'empreintes : seulement les absences inconnues du snapshot", () => {
    const previous = [absenceFingerprint(syntheticAbsences[0])];
    const fresh = newAbsences(previous, syntheticAbsences);
    expect(fresh.map((a) => a.id)).toEqual(["abs-fake-2", "abs-fake-3", "abs-fake-4"]);
    // Rejeu des mêmes données = zéro notif (idempotent).
    expect(newAbsences(syntheticAbsences.map(absenceFingerprint), syntheticAbsences)).toEqual([]);
    // Enregistrement invalide : jamais d'effet, même absent du snapshot.
    expect(newAbsences([], [{ ...syntheticAbsences[0], kind: "exclusion" } as never])).toEqual([]);
    // Absence CORRIGÉE (justifiée) : empreinte différente de la version vue,
    // donc à notifier — un diff par id seul l'aurait avalée en silence.
    const nonJustifiee = { ...syntheticAbsences[0], justified: false };
    expect(newAbsences([absenceFingerprint(nonJustifiee)], [syntheticAbsences[0]]).map((a) => a.id)).toEqual([
      "abs-fake-1",
    ]);
  });

  test("push : titre/bornes, date locale (jamais le jour UTC), motif = donnée tronquée, jamais d'instruction", () => {
    const [absence, late] = syntheticAbsences;
    // Jour civil LOCAL au format du dépôt (helper partagé `localDay`, en-CA +
    // Europe/Paris) : « 01/10/2026 » et « 2026-10-01 » désignent le MÊME jour
    // affiché, seul le rendu change — plus de `Intl` local divergent entre le
    // push d'absence, le titre de fiche et le PDF.
    expect(formatAbsencePush(absence)).toEqual({
      title: "Nouvelle absence",
      body: "2026-10-01 en Maths — Rendez-vous medical",
    });
    expect(formatAbsencePush(late)).toEqual({ title: "Nouveau retard", body: "2026-10-02 — Transport" });
    const long = formatAbsencePush({ ...absence, motif: "m".repeat(4000) });
    expect(long.body.length).toBeLessThanOrEqual(1000);
    // Jour local, JAMAIS le jour UTC : 23h30Z = 01h30 le lendemain à Paris,
    // donc le corps nomme le 02 et pas le 01 (`.slice(0, 10)` de l'ISO).
    const nocturne = formatAbsencePush({ ...absence, date: "2026-10-01T23:30:00.000Z" });
    expect(nocturne.body).toBe("2026-10-02 en Maths — Rendez-vous medical");
    expect(nocturne.body).not.toContain("2026-10-01 en");
  });
});