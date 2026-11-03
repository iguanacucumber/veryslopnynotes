import { describe, expect, test } from "bun:test";
import {
  canUseCached,
  invalidateOnRequestChange,
  visibleResource,
} from "../../web/src/lib/resource";

const fresh = { payload: "{}", stale: false };

describe("cache d'une ressource", () => {
  test("un cache frais évite la relecture native", () => {
    expect(canUseCached(fresh, false)).toBe(true);
  });

  test("un cache périmé est relu", () => {
    expect(canUseCached({ payload: "{}", stale: true }, false)).toBe(false);
  });

  test("sans payload, la lecture native part", () => {
    expect(canUseCached({ payload: null, stale: false }, false)).toBe(false);
  });

  test("un geste forcé relit même un cache frais", () => {
    expect(canUseCached(fresh, true)).toBe(false);
  });

  test("la cause d'échec suit la vue et disparaît avec la requête", () => {
    const status = {
      request: "grades?",
      payload: "{}",
      fetchedAt: 1,
      stale: true,
      error: "réseau",
      cause: "network" as const,
      loading: false,
    };
    expect(visibleResource(status, "grades?").cause).toBe("network");
    const changed = invalidateOnRequestChange(status, "grades?period=p2");
    expect(changed.cause).toBeNull();
    expect(visibleResource(changed, "grades?period=p2").cause).toBeNull();
  });
});
