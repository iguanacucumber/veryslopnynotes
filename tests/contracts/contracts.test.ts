import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("contracts", () => {
  test("openapi présent", () => {
    expect(existsSync(join(import.meta.dir, "..", "..", "shared/contracts/api.openapi.yaml"))).toBe(true);
  });
});
