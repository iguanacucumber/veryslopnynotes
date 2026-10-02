import { describe, expect, test } from "bun:test";
import { CACHE_TTL_MS, cacheStatus, isCacheableResource } from "../../shared/contracts/cache";
import type { CacheableResource } from "../../shared/contracts/cache";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import { isContractEvent } from "../../shared/contracts/events";

// Miroir TS de android/data (CachePolicy + SyncedRepository) — logique
// offline-first testable via bun (SDK Android absent en CI).
// Le Kotlin reste la source d'execution app ; ce test fige le contrat.

type Entry = { payload: string; fetchedAt: number };
type Outcome =
  | { kind: "updated"; payload: string; fetchedAt: number }
  | { kind: "fallback"; payload: string; fetchedAt: number; stale: boolean }
  | { kind: "failed"; message: string; cached: string | null };

function refresh(
  resource: CacheableResource,
  cached: Entry | null,
  net: { ok: boolean; body?: string },
  now: number,
): Outcome {
  if (net.ok && net.body) return { kind: "updated", payload: net.body, fetchedAt: now };
  if (cached)
    return {
      kind: "fallback",
      payload: cached.payload,
      fetchedAt: cached.fetchedAt,
      stale: cacheStatus(resource, cached.fetchedAt, now) === "stale",
    };
  return { kind: "failed", message: net.ok ? "Réponse vide." : "Hors-ligne, aucune donnée en cache.", cached: null };
}

describe("offline android (#14)", () => {
  test("ressources cachables = notes/devoirs/EDT seules", () => {
    for (const r of ["grades", "assignments", "timetable"] as const) expect(isCacheableResource(r)).toBe(true);
    expect(isCacheableResource("health")).toBe(false);
    expect(isCacheableResource("")).toBe(false);
  });

  test("TTL miroir contrats : frais à la borne, périmé après", () => {
    for (const r of ["grades", "assignments", "timetable"] as const) {
      const ttl = CACHE_TTL_MS[r];
      expect(cacheStatus(r, 1_000, 1_000 + ttl)).toBe("fresh");
      expect(cacheStatus(r, 1_000, 1_000 + ttl + 1)).toBe("stale");
    }
    // EDT (60min) > notes (15min) : même âge, EDT frais quand notes périmées.
    expect(cacheStatus("grades", 0, 20 * 60 * 1000)).toBe("stale");
    expect(cacheStatus("timetable", 0, 20 * 60 * 1000)).toBe("fresh");
  });

  test("refresh succès → updated (cache écrasé)", () => {
    const o = refresh("grades", { payload: "old", fetchedAt: 0 }, { ok: true, body: "new" }, 5_000);
    expect(o).toEqual({ kind: "updated", payload: "new", fetchedAt: 5_000 });
  });

  test("refresh échec + cache → fallback (stale flag cohérent TTL)", () => {
    const fresh = refresh("grades", { payload: "c", fetchedAt: 1_000 }, { ok: false }, 1_001);
    expect(fresh).toEqual({ kind: "fallback", payload: "c", fetchedAt: 1_000, stale: false });
    const stale = refresh(
      "grades",
      { payload: "c", fetchedAt: 1_000 },
      { ok: false },
      1_000 + CACHE_TTL_MS.grades + 1,
    );
    expect(stale).toMatchObject({ kind: "fallback", stale: true });
  });

  test("refresh échec sans cache → failed propre (jamais de spinner infini)", () => {
    expect(refresh("timetable", null, { ok: false }, 0).kind).toBe("failed");
    expect(refresh("assignments", null, { ok: true }, 0).kind).toBe("failed"); // réponse vide
  });

  test("CacheInvalidated valide → purge ressource (invalidation active)", () => {
    const store = new Map<CacheableResource, Entry>([["grades", { payload: "g", fetchedAt: 0 }]]);
    const ev = {
      v: CONTRACTS_VERSION,
      type: "CacheInvalidated",
      at: "2026-10-02T06:00:00.000Z",
      data: { resource: "grades", reason: "sync" },
    };
    expect(isContractEvent(ev)).toBe(true);
    if (isContractEvent(ev) && ev.type === "CacheInvalidated") {
      const res = (ev.data as { resource: unknown }).resource;
      if (isCacheableResource(res)) store.delete(res);
    }
    expect(store.has("grades")).toBe(false);
  });
});
