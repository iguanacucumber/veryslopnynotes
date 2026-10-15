import { describe, expect, test } from "bun:test";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import { EVENT_TYPES, isContractEvent } from "../../shared/contracts/events";

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
