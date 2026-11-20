import { describe, expect, test } from "bun:test";
import { readLocal, writeLocal, type LocalStore } from "../../web/src/lib/storage";

function memory(initial: Record<string, string> = {}): LocalStore & { values: Map<string, string> } {
  const values = new Map(Object.entries(initial));
  return {
    values,
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe("préférences locales", () => {
  test("lit et écrit la valeur attendue", () => {
    const store = memory({ "vsn:theme": "DARK" });
    expect(readLocal("vsn:theme", store)).toBe("DARK");
    expect(writeLocal("vsn:scheme", "cyberpunk", store)).toBe(true);
    expect(store.values.get("vsn:scheme")).toBe("cyberpunk");
  });

  test("un stockage absent rend null/false, jamais une exception", () => {
    expect(readLocal("vsn:theme", null)).toBeNull();
    expect(writeLocal("vsn:theme", "DARK", null)).toBe(false);
  });

  test("un stockage qui lève (privé, quota, WebView verrouillée) ne casse rien", () => {
    const broken: LocalStore = {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
    };
    expect(readLocal("vsn:theme", broken)).toBeNull();
    expect(writeLocal("vsn:theme", "DARK", broken)).toBe(false);
  });
});
