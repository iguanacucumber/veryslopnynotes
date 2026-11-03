// #909 — pagination/lazy loading : le nombre de TÉLÉCHARGEMENTS d'un fil ne
// suit pas le nombre de pages lues. Le vrai pager Kotlin est EXÉCUTÉ par le
// harnais, avec un `fetch` synthétique : aucune requête réseau, aucun temps réel.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "MessagePagingMain.kt");
const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface PagerAnswer {
  requests: number;
  pages: Array<{ items: number; start: number; total: number; hasMore: boolean }>;
}

interface EnrichAnswer {
  requests: number;
  ids: string[];
}

async function ask<T>(op: unknown): Promise<T> {
  return JSON.parse(await link!.ask(op)) as T;
}

describe("pagination d'un fil : une requête, des pages gratuites (#909)", () => {
  test.skipIf(skip)("120 messages en 3 pages = 1 seul téléchargement", async () => {
    const res = await ask<PagerAnswer>({
      op: "pager",
      total: 120,
      size: 50,
      // Pages demandées : la plus récente, puis deux plus anciennes.
      befores: [120, 70, 20],
    });
    // C'EST la mesure : 3 pages lues, 1 téléchargement.
    expect(res.requests).toBe(1);
    expect(res.pages.map((p) => p.items)).toEqual([50, 50, 20]);
    expect(res.pages.map((p) => p.start)).toEqual([70, 20, 0]);
    // Ordre et bornes conservés : la dernière page a `hasMore = false`.
    expect(res.pages.map((p) => p.hasMore)).toEqual([true, true, false]);
    expect(res.pages.every((p) => p.total === 120)).toBe(true);
  });

  test.skipIf(skip)("deux fils distincts = un téléchargement chacun", async () => {
    const first = await ask<PagerAnswer>({ op: "pager", total: 40, size: 50, befores: [40] });
    expect(first.requests).toBe(1);
    expect(first.pages[0]?.items).toBe(40);
    expect(first.pages[0]?.hasMore).toBe(false);
  });

  test.skipIf(skip)("un fil vide ne produit aucune page fantôme", async () => {
    const res = await ask<PagerAnswer>({ op: "pager", total: 0, size: 50, befores: [0] });
    expect(res.requests).toBe(1);
    expect(res.pages[0]?.items).toBe(0);
    expect(res.pages[0]?.hasMore).toBe(false);
  });
});

describe("enrichissement visible : requêtes bornées par lot (#909)", () => {
  test.skipIf(skip)("120 fils visibles = 12 requêtes au premier lot, 12 au suivant", async () => {
    const visible = Array.from({ length: 120 }, (_, i) => `d-${i}`);
    const first = await ask<EnrichAnswer>({ op: "enrich", visible, already: [] });
    expect(first.requests).toBe(12);
    expect(first.ids).toHaveLength(12);
    expect(first.ids[0]).toBe("d-0");
    expect(first.ids[11]).toBe("d-11");

    const second = await ask<EnrichAnswer>({
      op: "enrich",
      visible,
      already: first.ids,
    });
    expect(second.requests).toBe(12);
    expect(second.ids[0]).toBe("d-12");
    expect(second.ids[11]).toBe("d-23");
  });

  test.skipIf(skip)("un fil déjà enrichi n'est jamais redemandé", async () => {
    const res = await ask<EnrichAnswer>({
      op: "enrich",
      visible: ["d-0", "d-1", "d-2"],
      already: ["d-0", "d-1", "d-2"],
    });
    expect(res.requests).toBe(0);
    expect(res.ids).toEqual([]);
  });

  test.skipIf(skip)("la borne est un plafond dur, jamais un minimum", async () => {
    const res = await ask<EnrichAnswer>({
      op: "enrich",
      visible: ["d-0", "d-1", "d-2", "d-3", "d-4"],
      already: [],
      max: 2,
    });
    expect(res.requests).toBe(2);
    expect(res.ids).toEqual(["d-0", "d-1"]);
  });
});
