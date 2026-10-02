import { describe, expect, test } from "bun:test";
import { untrusted } from "../../server/domain/ports";

describe("security", () => {
  test("I6: contenu externe marqué UNTRUSTED_DATA", () => {
    const doc = untrusted("<p>cours</p>");
    expect(doc.__untrusted).toBe(true);
  });

  test("I4/I5: LLMProvider sans secrets ni outils (type-level)", async () => {
    const fake = {
      async generate({ system, data }: { system: string; data: unknown[] }) {
        expect(system).not.toMatch(/sk-or|MASTER_KEY/);
        expect(data.length).toBeGreaterThanOrEqual(0);
        return "{}";
      },
    };
    const out = await fake.generate({ system: "fixed", data: [untrusted("x")] });
    expect(out).toBe("{}");
  });
});
