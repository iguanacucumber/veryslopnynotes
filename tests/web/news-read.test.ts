import { useParisTz } from "./setup";

import { describe, expect, test } from "bun:test";
import {
  loadNewsReadIds,
  markNewsRead,
  NEWS_READ_MAX,
  NEWS_READ_STORAGE_KEY,
  type ReadStore,
} from "../../web/src/features/news/readState";

useParisTz();

function memoryStore(initial: string | null = null): ReadStore & { value: string | null } {
  const store = {
    value: initial,
    getItem(key: string) {
      return key === NEWS_READ_STORAGE_KEY ? store.value : null;
    },
    setItem(key: string, value: string) {
      if (key === NEWS_READ_STORAGE_KEY) store.value = value;
    },
  };
  return store;
}

describe("web actualités — état lu persistant", () => {
  test("persiste et relit les identifiants, sans doublon", () => {
    const store = memoryStore();
    const after = markNewsRead("n1", store);
    expect([...after]).toEqual(["n1"]);
    markNewsRead("n2", store);
    markNewsRead("n1", store);
    expect([...loadNewsReadIds(store)]).toEqual(["n1", "n2"]);
  });

  test("un stockage absent ou corrompu rend un ensemble vide, jamais une exception", () => {
    expect(loadNewsReadIds(null).size).toBe(0);
    expect(loadNewsReadIds(memoryStore("pas du json")).size).toBe(0);
    expect(loadNewsReadIds(memoryStore(JSON.stringify({ nope: true }))).size).toBe(0);
  });

  test("borne à 500 identifiants en gardant les plus récents", () => {
    const store = memoryStore();
    for (let index = 0; index < NEWS_READ_MAX + 20; index++) markNewsRead(`n${index}`, store);
    const ids = loadNewsReadIds(store);
    expect(ids.size).toBe(NEWS_READ_MAX);
    expect(ids.has("n0")).toBe(false);
    expect(ids.has(`n${NEWS_READ_MAX + 19}`)).toBe(true);
  });
});
