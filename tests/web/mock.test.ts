import { describe, expect, test } from "bun:test";
import { mockCall } from "../../web/src/bridge/mock";
import type { PairResult, ResourceResult, SessionStatus } from "../../web/src/bridge/types";

describe("pont factice", () => {
  test("les ressources de démonstration sont parsables", async () => {
    for (const key of ["grades", "assignments", "timetable", "news", "attendance", "discussions"] as const) {
      const result = await mockCall<ResourceResult>("resources.load", { key });
      expect(result.error).toBeNull();
      const parsed = JSON.parse(result.payload ?? "{}") as { items?: unknown };
      expect(Array.isArray(parsed.items)).toBe(true);
    }
  });

  test("session restaurée par défaut", async () => {
    const status = await mockCall<SessionStatus>("session.restore", {});
    expect(status.state).toBe("restored");
  });

  test("appairage sans PIN refusé, avec PIN accepté", async () => {
    const bad = await mockCall<PairResult>("pairing.pair", {
      qr: { login: "x", jeton: "y", url: "https://school.invalid" },
      pin: "",
    });
    expect(bad.ok).toBe(false);
    const good = await mockCall<PairResult>("pairing.pair", {
      qr: { login: "x", jeton: "y", url: "https://school.invalid" },
      pin: "1234",
    });
    expect(good.ok).toBe(true);
  });

  test("méthode inconnue refusée", async () => {
    await expect(mockCall("nope", {})).rejects.toThrow("inconnue");
  });
});
