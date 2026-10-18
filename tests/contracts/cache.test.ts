import { describe, expect, test } from "bun:test";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import { EVENT_TYPES, isContractEvent } from "../../shared/contracts/events";
import { CACHE_TTL_MS } from "../../shared/contracts/cache";
import type { CacheableResource } from "../../shared/contracts/cache";

// #311 : miroir de `CachePolicy.shouldFetch` (android/data). La règle est PURE
// (comme `isStale`), donc elle se fige ici sans SDK Android : une entrée de
// cache FRAÎCHE suffit à l'écran, sauf geste explicite de l'utilisateur
// (`force`). Entrée absente ou périmée = relecture du client local.
//
// Miroir de `isStale` LUI-MÊME (`now - fetchedAt > TTL`), pas de `cacheStatus` :
// c'est la borne Kotlin qui décide ici, et le badge (« périmé ») garde la sienne.
type CachedEntry = { payload: string; fetchedAt: number };

function shouldFetch(entry: CachedEntry | null, resource: CacheableResource, now: number, force: boolean): boolean {
  return force || entry === null || now - entry.fetchedAt > CACHE_TTL_MS[resource];
}

describe("fraîcheur avant relecture (#311)", () => {
  test("cache frais + force=false ⇒ zéro appel client", () => {
    // À la borne du TTL, l'entrée est encore fraîche (borne inclusive) : c'est
    // exactement le cas « onglet rouvert dans le TTL » de l'issue.
    expect(shouldFetch({ payload: "g", fetchedAt: 1_000 }, "grades", 1_000 + CACHE_TTL_MS.grades, false)).toBe(false);
  });

  test("cache périmé ⇒ appel", () => {
    expect(shouldFetch({ payload: "g", fetchedAt: 1_000 }, "grades", 1_000 + CACHE_TTL_MS.grades + 1, false)).toBe(true);
  });

  test("force=true ⇒ appel, même sur un cache frais", () => {
    expect(shouldFetch({ payload: "g", fetchedAt: 1_000 }, "grades", 1_000, true)).toBe(true);
    expect(shouldFetch(null, "grades", 1_000, true)).toBe(true);
  });

  test("pas de cache ⇒ appel", () => {
    expect(shouldFetch(null, "grades", 1_000, false)).toBe(true);
  });

  test("c'est le TTL de la ressource qui décide, pas une durée globale", () => {
    const now = 20 * 60 * 1000;
    expect(shouldFetch({ payload: "g", fetchedAt: 0 }, "grades", now, false)).toBe(true);
    expect(shouldFetch({ payload: "t", fetchedAt: 0 }, "timetable", now, false)).toBe(false);
  });
});

describe("cache invalidation event contract", () => {
  test("CacheInvalidated : enveloppe valide, invalides rejetés, miroir OpenAPI", () => {
    const at = "2026-10-02T06:00:00.000Z";
    expect(EVENT_TYPES).toContain("CacheInvalidated");
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "CacheInvalidated",
        at,
        data: { resource: "grades", reason: "sync" },
      }),
    ).toBe(true);
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "CacheInvalidated",
        at,
        data: { resource: "nope", reason: "sync" },
      }),
    ).toBe(false);
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "CacheInvalidated",
        at,
        data: { resource: "grades", reason: "unknown" },
      }),
    ).toBe(false);
  });
});
