import { describe, expect, test } from "bun:test";
import { untrusted } from "../../server/domain/ports";

describe("unit bootstrap", () => {
  test("untrusted marqueur", () => {
    expect(untrusted("a").value).toBe("a");
  });
});
