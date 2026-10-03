// Tests #76 EDT semaine : contrats add-only rétro-compatibles + bornes,
// mapper Pronote défensif, fenêtre de semaine (weekStart/from/to), cache, SSE.
// Fixtures 100 % synthétiques (tests/unit/fixtures/timetable.ts) : aucun réseau,
// aucun secret, aucune URL Pronote.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRACTS_VERSION,
  isTimetableEntry,
  TIMETABLE_ROOM_MAX_CHARS,
  TIMETABLE_STATUSES,
  TIMETABLE_TEACHER_MAX_CHARS,
  TIMETABLE_WEEK_MAX_SPAN_DAYS,
} from "../../shared/contracts/models";
import { isTimetableResponse } from "../../shared/contracts/api";
import { CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import { EVENT_TYPES, isContractEvent } from "../../shared/contracts/events";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { createMemoryStore } from "../../server/api/store";
import { createHandler } from "../../server/api/router";
import { isApiErrorBody } from "../../server/api/errors";
import {
  syntheticRawLesson,
  syntheticTimetableAccountId,
  syntheticTimetableClient,
  syntheticTimetableEntries,
  syntheticTimetablePayload,
} from "./fixtures/timetable";

// Session injectée sans réseau (PronoteSessionStore/pronotets non nécessaire).
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function readerFor(client: unknown, logs: string[] = []) {
  return new PronoteClientReader({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    sessions: { requireClient: () => client } as any,
    logger: (m) => logs.push(m),
  });
}

async function getTimetableJson(query = "", entries = syntheticTimetableEntries) {
  const handler = createHandler(createMemoryStore({ entries }));
  const res = await handler(new Request(`http://127.0.0.1/v1/timetable${query}`));
  return { res, body: (await res.json()) as { entries: typeof syntheticTimetableEntries } };
}

describe("unit timetable (#76)", () => {
  test("contrat : add-only rétro-compatible, champs optionnels bornés", () => {
    expect(TIMETABLE_STATUSES).toEqual(["normal", "cancelled", "moved"]);
    for (const entry of syntheticTimetableEntries) expect(isTimetableEntry(entry)).toBe(true);
    // Payload 0.2.0 antérieur (ni prof, ni statut, ni salle) : toujours valide.
    expect(isTimetableEntry(syntheticTimetableEntries[3])).toBe(true);
    expect(isTimetableEntry({ ...syntheticTimetableEntries[0], teacher: undefined, status: undefined })).toBe(true);
    // Rejets : types, bornes, cohérence des horaires d'origine.
    const base = syntheticTimetableEntries[0]!;
    expect(isTimetableEntry({ ...base, status: "reporte" })).toBe(false);
    expect(isTimetableEntry({ ...base, status: true })).toBe(false);
    expect(isTimetableEntry({ ...base, teacher: 42 })).toBe(false);
    expect(isTimetableEntry({ ...base, room: 42 })).toBe(false);
    expect(isTimetableEntry({ ...base, originalStart: "hier" })).toBe(false);
    expect(isTimetableEntry({ ...base, originalStart: "2026-10-05T09:00:00.000Z", originalEnd: "2026-10-05T08:00:00.000Z" })).toBe(
      false,
    );
    expect(isTimetableEntry({ ...base, room: "s".repeat(TIMETABLE_ROOM_MAX_CHARS) })).toBe(true);
    expect(isTimetableEntry({ ...base, room: "s".repeat(TIMETABLE_ROOM_MAX_CHARS + 1) })).toBe(false);
    expect(isTimetableEntry({ ...base, teacher: "t".repeat(TIMETABLE_TEACHER_MAX_CHARS) })).toBe(true);
    expect(isTimetableEntry({ ...base, teacher: "t".repeat(TIMETABLE_TEACHER_MAX_CHARS + 1) })).toBe(false);
    // Réponse complète + garde-fou de réponse.
    expect(isTimetableResponse(syntheticTimetablePayload)).toBe(true);
    expect(isTimetableResponse({ entries: [] })).toBe(true);
    expect(isTimetableResponse({ entries: [{ ...base, status: "reporte" }] })).toBe(false);
    expect(isTimetableResponse({ entries: "non" })).toBe(false);
    // Miroir OpenAPI : params de fenêtre + champs #76 documentés.
    const raw = readFileSync(join(import.meta.dir, "..", "..", "shared/contracts/api.openapi.yaml"), "utf8");
    expect(raw).toContain("weekStart");
    expect(raw).toContain("originalStart");
    expect(raw).toContain("enum: [normal, cancelled, moved]");
  });

  test("cache : ressource timetable existante, TTL 1h, chemin compatible", () => {
    expect(isCacheableResource("timetable")).toBe(true);
    expect(CACHE_TTL_MS.timetable).toBe(60 * 60 * 1000);
    expect(cacheStatus("timetable", 0, CACHE_TTL_MS.timetable)).toBe("fresh");
    expect(cacheStatus("timetable", 0, CACHE_TTL_MS.timetable + 1)).toBe("stale");
    // Les champs #76 ne changent rien au chemin de cache : payload JSON brut.
    expect(JSON.stringify(syntheticTimetablePayload)).toContain('"status":"moved"');
  });

  test("mapper : prof, statut, déplacé, champs absents omis, poubelles ignorées", async () => {
    const logs: string[] = [];
    const reader = readerFor(syntheticTimetableClient(), logs);
    const page = await reader.getTimetable(syntheticTimetableAccountId, {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-11T23:59:59.999Z",
      limit: 50,
    });
    expect(page.items.__untrusted).toBe(true);
    const items = page.items.value;
    // 4 cours lisibles seulement : dates illisibles + entrée nulle ignorées.
    expect(items).toHaveLength(4);
    expect(items.every(isTimetableEntry)).toBe(true);
    expect(items.map((e) => e.status)).toEqual(["normal", "cancelled", "moved", undefined]);
    expect(items[0]?.teacher).toBe("Mme Faket-UNREAL");
    expect(items[0]?.room).toBe("Salle A12");
    expect(items[2]?.originalStart).toBe("2026-10-06T06:00:00.000Z");
    expect(items[2]?.originalEnd).toBe("2026-10-06T07:00:00.000Z");
    // Cours sans prof/salle/statut : champs OMIS, jamais "" deviné.
    expect(items[3]?.teacher).toBeUndefined();
    expect(items[3]?.status).toBeUndefined();
    expect(items[3]?.room).toBeUndefined();
    expect(logs.join("\n")).not.toMatch(/fake-pw|sk-or-v1/);
  });

  test("mapper : statut textuel reconnu, inconnu = absent, drapeaux false = normal", async () => {
    const client = {
      periods: [],
      lessons: async () => [
        syntheticRawLesson({ id: "l-a", status: "Annulé" }),
        syntheticRawLesson({ id: "l-b", status: "déplacé" }),
        syntheticRawLesson({ id: "l-c", status: "reporte" }),
        syntheticRawLesson({ id: "l-d", isCancelled: false, isMoved: false }),
      ],
    };
    const items = (
      await readerFor(client).getTimetable(syntheticTimetableAccountId, {
        from: "2026-10-05T00:00:00.000Z",
        to: "2026-10-05T23:00:00.000Z",
      })
    ).items.value;
    expect(items.map((e) => e.id)).toEqual(["l-a", "l-b", "l-c", "l-d"]);
    expect(items.map((e) => e.status)).toEqual(["cancelled", "moved", undefined, "normal"]);
    // Libellés hors bornes tronqués (contenu externe borné, I6).
    const long = readerFor({
      periods: [],
      lessons: async () => [syntheticRawLesson({ teacher: { name: "p".repeat(400) }, classroom: "s".repeat(400) })],
    });
    const bounded = await long.getTimetable(syntheticTimetableAccountId, {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-05T23:00:00.000Z",
    });
    expect(bounded.items.value[0]?.teacher).toHaveLength(TIMETABLE_TEACHER_MAX_CHARS);
    expect(bounded.items.value[0]?.room).toHaveLength(TIMETABLE_ROOM_MAX_CHARS);
  });

  test("mapper : fenêtre appliquée côté reader (bornes UTC explicites)", async () => {
    const reader = readerFor(syntheticTimetableClient());
    // Mardi uniquement : les cours du lundi et du mercredi sont hors fenêtre.
    const mardi = await reader.getTimetable(syntheticTimetableAccountId, {
      from: "2026-10-06T00:00:00.000Z",
      to: "2026-10-06T23:59:59.999Z",
    });
    expect(mardi.items.value.map((e) => e.id)).toEqual(["l-fake-3"]);
  });

  test("route GET /v1/timetable : sans fenêtre = tout, weekStart = semaine UTC", async () => {
    const all = await getTimetableJson();
    expect(all.res.status).toBe(200);
    expect(isTimetableResponse(all.body)).toBe(true);
    expect(all.body.entries).toHaveLength(4);

    // weekStart un mercredi -> la semaine du lundi 05/10 au dimanche 11/10.
    const semaine = await getTimetableJson("?weekStart=2026-10-07");
    expect(semaine.res.status).toBe(200);
    expect(semaine.body.entries.map((e) => e.id)).toEqual(["t-fake-1", "t-fake-2", "t-fake-3", "t-fake-4"]);

    // Semaine du 12/10 : aucun cours (fenêtre vide = 200, jamais 500).
    const vide = await getTimetableJson("?weekStart=2026-10-12");
    expect(vide.res.status).toBe(200);
    expect(isTimetableResponse(vide.body)).toBe(true);
    expect(vide.body.entries).toEqual([]);

    // from/to libres, fenêtre étroite.
    const lundiMatin = await getTimetableJson("?from=2026-10-05T06:00:00.000Z&to=2026-10-05T07:00:00.000Z");
    expect(lundiMatin.body.entries.map((e) => e.id)).toEqual(["t-fake-1"]);
  });

  test("route : dates illisibles ou fenêtre trop large = 400 sans répliquer l'input", async () => {
    const tropLarge = "?from=2026-01-01T00:00:00.000Z&to=2027-12-31T00:00:00.000Z";
    for (const query of ["?weekStart=lundi", `?weekStart=${"9".repeat(80)}`, "?from=past-une-date", "?to=pas-une-date", tropLarge]) {
      const { res, body } = await getTimetableJson(query);
      expect({ query, status: res.status }).toEqual({ query, status: 400 });
      expect(isApiErrorBody(body)).toBe(true);
      // L'input n'est jamais reflété dans le corps d'erreur.
      expect(JSON.stringify(body)).not.toContain("lundi");
      expect(JSON.stringify(body)).not.toContain("pas-une-date");
    }
    // Fenêtre d'amplitude exactement max (14 jours) = acceptée.
    const max = await getTimetableJson("?from=2026-10-01T00:00:00.000Z&to=2026-10-15T00:00:00.000Z");
    expect(max.res.status).toBe(200);
    expect(TIMETABLE_WEEK_MAX_SPAN_DAYS).toBe(14);
  });

  test("SSE : TimetableUpdated réémis (type existant), pas de type novel", async () => {
    expect(EVENT_TYPES).toContain("TimetableUpdated");
    const at = "2026-10-05T07:00:00.000Z";
    const data = { entries: syntheticTimetableEntries };
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "TimetableUpdated", at, data })).toBe(true);
    expect(isContractEvent({ v: CONTRACTS_VERSION, type: "TimetableUpdated", at, data: { entries: [] } })).toBe(true);
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "TimetableUpdated",
        at,
        data: { entries: [{ ...syntheticTimetableEntries[0], status: "reporte" }] },
      }),
    ).toBe(false);

    const handler = createHandler(createMemoryStore({ entries: syntheticTimetableEntries }));
    const res = await handler(new Request("http://127.0.0.1/v1/events"));
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let events: { type: string; data?: unknown }[] = [];
    for (let i = 0; i < 20 && events.length < 3; i++) {
      const { done, value } = await reader.read();
      if (value) buf += decoder.decode(value, { stream: true });
      events = [...buf.matchAll(/data: (\{.*\})\n\n/g)].map((m) => JSON.parse(m[1] as string));
      if (done) break;
    }
    await reader.cancel();
    const timetable = events.find((e) => e.type === "TimetableUpdated");
    expect(timetable).toBeDefined();
    expect((timetable?.data as { entries: unknown[] }).entries).toHaveLength(4);
    expect(events.every((e) => isContractEvent(e))).toBe(true);
  });
});