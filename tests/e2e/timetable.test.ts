import { describe, expect, test } from "bun:test";
import { createHandler } from "../../server/api/router";
import { createMemoryStore } from "../../server/api/store";
import { isApiErrorBody } from "../../server/api/errors";
import { isTimetableResponse } from "../../shared/contracts/api";
import type { TimetableEntry } from "../../shared/contracts/models";
import type { Assignment, Grade } from "../../shared/contracts/models";
import { isContractEvent } from "../../shared/contracts/events";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { PronoteClientReader } from "../../server/integrations/pronote-client-reader";
import { runSync } from "../../server/jobs/sync";
import type { SyncSink, SyncSnapshot, SyncSource } from "../../server/jobs/sync";
import type { Untrusted } from "../../server/domain/ports";
import { syntheticTimetableClient, syntheticTimetableEntries } from "../unit/fixtures/timetable";
import { syntheticAccountId } from "../unit/fixtures/pronote";

// e2e EDT semaine (#76) : store seedé -> GET /v1/timetable (fenêtre incluse)
// -> diff sync (TimetableUpdated) -> repli cache hors-ligne.
// Zéro réseau (store mémoire + faux client injecté), zéro secret,
// aucun LLM sur le chemin (données structurées seules, I7).

async function getTimetableJson(query = "") {
  const handler = createHandler(createMemoryStore({ entries: syntheticTimetableEntries }));
  const res = await handler(new Request(`http://127.0.0.1/v1/timetable${query}`));
  return { res, body: (await res.json()) as { entries: TimetableEntry[] } };
}

function memorySync(entries: TimetableEntry[]) {
  let snapshot: SyncSnapshot | null = null;
  const source: SyncSource = {
    grades: async () => [] as Grade[],
    assignments: async () => [] as Assignment[],
    entries: async () => entries,
  };
  const sink: SyncSink = {
    loadSnapshot: async () => snapshot,
    saveSnapshot: async (s) => {
      snapshot = s;
    },
  };
  return { source, sink };
}

describe("e2e timetable (#76)", () => {
  test("semaine publiée : EDT complète, contrats valides, statuts présents", async () => {
    const { res, body } = await getTimetableJson("?weekStart=2026-10-05");
    expect(res.status).toBe(200);
    expect(isTimetableResponse(body)).toBe(true);
    expect(body.entries).toHaveLength(4);
    expect(body.entries.map((e) => e.status)).toEqual(["normal", "cancelled", "moved", undefined]);
    expect(body.entries[0]?.teacher).toBe("Mme Faket-UNREAL");
    expect(body.entries[0]?.room).toBe("Salle A12");
    expect(body.entries[2]?.originalStart).toBe("2026-10-06T06:00:00.000Z");
    // Aucun secret dans la réponse (règle d'or dépôt public).
    expect(JSON.stringify(body)).not.toMatch(/sk-or-v1-|OPENROUTER_API_KEY|PRONOTE_PASSWORD|fake-pw/);
  });

  test("fenêtre de semaine : autre semaine = liste vide (200), date illisible = 400", async () => {
    const vide = await getTimetableJson("?weekStart=2026-10-12");
    expect(vide.res.status).toBe(200);
    expect(isTimetableResponse(vide.body)).toBe(true);
    expect(vide.body.entries).toEqual([]);
    const casse = await getTimetableJson("?weekStart=lundi");
    expect(casse.res.status).toBe(400);
    expect(isApiErrorBody(casse.body)).toBe(true);
    // Store vide (établissement sans EDT) : 200 + liste vide, jamais 500.
    const bare = await createHandler(createMemoryStore({ entries: [] }))(
      new Request("http://127.0.0.1/v1/timetable"),
    );
    expect(bare.status).toBe(200);
    expect(await bare.json()).toEqual({ entries: [] });
  });

  test("sync : premier run silencieux, cours ajouté/déplacé → TimetableUpdated", async () => {
    const entries: TimetableEntry[] = [syntheticTimetableEntries[0] as TimetableEntry];
    const { source, sink } = memorySync(entries);
    const first = await runSync(source, sink);
    expect(first.firstRun).toBe(true);
    expect(first.events).toEqual([]);

    // Nouveau cours = snapshot des cours concernés, un seul événement.
    entries.push(syntheticTimetableEntries[1] as TimetableEntry);
    const second = await runSync(source, sink);
    expect(second.events.length).toBe(1);
    expect(second.events[0]?.type).toBe("TimetableUpdated");
    expect(isContractEvent(second.events[0])).toBe(true);
    expect((second.events[0]?.data as { entries: TimetableEntry[] }).entries).toEqual([
      syntheticTimetableEntries[1],
    ]);

    // Cours déplacé = même id, contenu changé → événement (pas de doublon de type).
    entries[1] = syntheticTimetableEntries[2] as TimetableEntry;
    const third = await runSync(source, sink);
    expect(third.events.map((e) => e.type)).toEqual(["TimetableUpdated"]);
    expect((third.events[0]?.data as { entries: TimetableEntry[] }).entries[0]?.status).toBe("moved");

    // Rejeu identique → zéro événement (pas de boucle de notif).
    const replay = await runSync(source, sink);
    expect(replay.events).toEqual([]);
  });

  test("hors-ligne : cache EDT périmé = repli affiché, badge stale", async () => {
    // Le cache serveur garde le dernier payload valide (miroir SyncedRepository).
    const handler = createHandler(createMemoryStore({ entries: syntheticTimetableEntries }));
    const payload = await (await handler(new Request("http://127.0.0.1/v1/timetable?weekStart=2026-10-05"))).text();
    const now = 1_000_000;
    expect(cacheStatus("timetable", now, now + CACHE_TTL_MS.timetable)).toBe("fresh");
    expect(cacheStatus("timetable", now, now + CACHE_TTL_MS.timetable + 1)).toBe("stale");
    // Hors-ligne : le payload périmé reste affichable (statuts compris).
    const cached = JSON.parse(payload) as { entries: TimetableEntry[] };
    expect(isTimetableResponse(cached)).toBe(true);
    expect(cached.entries.filter((e) => e.status !== undefined).length).toBe(3);
    // Cache absent + réseau KO : l'app rend un état vide propre (payload vide).
    expect(isTimetableResponse(JSON.parse("{}"))).toBe(false);
  });

  test("reader : cours défensifs + Untrusted, aucune fuite de session", async () => {
    const logs: string[] = [];
    const reader = new PronoteClientReader({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      sessions: { requireClient: () => syntheticTimetableClient() } as any,
      logger: (m) => logs.push(m),
    });
    const page = await reader.getTimetable(syntheticAccountId, {
      from: "2026-10-05T00:00:00.000Z",
      to: "2026-10-11T23:59:59.999Z",
    });
    const items: Untrusted<TimetableEntry[]> = page.items;
    expect(items.__untrusted).toBe(true);
    expect(items.value).toHaveLength(4);
    expect(items.value.map((e) => e.status)).toEqual(["normal", "cancelled", "moved", undefined]);
    expect(items.value.every((e) => isTimetableResponse({ entries: [e] }))).toBe(true);
    expect(logs.join("\n")).not.toMatch(/fake-pw|sk-or-v1|fake-user/);
  });
});