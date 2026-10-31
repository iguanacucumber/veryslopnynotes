import { describe, expect, test } from "bun:test";
import { canUseCached } from "../../web/src/lib/resource";

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
});
