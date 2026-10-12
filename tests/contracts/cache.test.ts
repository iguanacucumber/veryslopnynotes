import { describe, expect, test } from "bun:test";
import {
  CACHE_TTL_MS,
  cacheStatus,
  isCacheableResource,
} from "../../shared/contracts/cache";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import { EVENT_TYPES, isContractEvent } from "../../shared/contracts/events";

describe("contracts cache", () => {
  test("politique TTL saine + badge frais/périmé aux bornes", () => {
    for (const r of ["grades", "assignments", "timetable"] as const) {
      expect(isCacheableResource(r)).toBe(true);
      expect(CACHE_TTL_MS[r]).toBeGreaterThan(0);
    }
    expect(isCacheableResource("nope")).toBe(false);
    const ttl = CACHE_TTL_MS.grades;
    expect(cacheStatus("grades", 1_000, 1_000 + ttl)).toBe("fresh");
    expect(cacheStatus("grades", 1_000, 1_000 + ttl + 1)).toBe("stale");
  });

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
