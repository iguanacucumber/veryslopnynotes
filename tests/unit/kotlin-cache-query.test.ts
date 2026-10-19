// #365 : la clé de cache ignore la requête — VRAI Kotlin compilé.
//
// `CachePolicy` (règle de relecture) et `OfflineCache` (entrée qui porte la
// requête) sont de la logique PURE (aucun import Android) : le harnais les
// compile pour de vrai, puis les pilote via `CacheQueryParityMain`. Les
// assertions portent donc sur du code exécuté, pas sur un miroir TS.
//
// Ce que l'issue demandait :
//   1. deux requêtes différentes pour la même ressource ne partagent PAS la
//      même entrée fraîche (la seconde déclenche une relecture) ;
//   2. la même requête servie depuis le cache ne déclenche PAS de relecture.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const REPO = join(DATA, "SyncedRepository.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CacheQueryParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  link = await parityToolchain.openParityLink(DRIVER);
}

interface Entry {
  payload: string;
  fetchedAt: number;
  query: string;
}

async function ask(op: unknown): Promise<Record<string, unknown>> {
  return JSON.parse(await link!.ask(op)) as Record<string, unknown>;
}

/** La règle de relecture, exécutée par le VRAI `CachePolicy`. */
async function shouldFetch(args: {
  entry?: Entry | null;
  resource?: string;
  query?: string;
  now?: number;
  force?: boolean;
}): Promise<boolean> {
  const res = await ask({
    op: "shouldFetch",
    resource: args.resource ?? "timetable",
    query: args.query ?? "",
    now: args.now ?? 1_000,
    force: args.force ?? false,
    entry: args.entry ?? null,
  });
  return res["fetch"] === true;
}

describe("la clé de cache porte la requête (#365)", () => {
  test("câblage : le dépôt compare la requête et l'écrit dans l'entrée", () => {
    const repo = readFileSync(REPO, "utf8");
    // La requête participe à la DÉCISION de relecture…
    expect(repo).toContain("CachePolicy.shouldFetch(entry, resource, query, clock(), force)");
    // …et à l'ENTRÉE écrite (l'entrée retient la requête qui l'a produite).
    expect(repo).toContain("store.save(resource, payload, clock(), query)");
  });

  test.skipIf(skip)("deux requêtes différentes ⇒ la seconde relit le client local", async () => {
    const entry: Entry = { payload: "semaine 1", fetchedAt: 1_000, query: "weekStart=2026-10-19" };
    // La même requête : l'entrée fraîche suffit (aucune relecture).
    expect(await shouldFetch({ entry, query: "weekStart=2026-10-19" })).toBe(false);
    // Une autre semaine : l'entrée n'est PAS la réponse demandée ⇒ relecture.
    expect(await shouldFetch({ entry, query: "weekStart=2026-10-26" })).toBe(true);
    // Autre période / autre algorithme : idem.
    expect(
      await shouldFetch({
        entry: { payload: "g", fetchedAt: 1_000, query: "algorithm=subject" },
        resource: "grades",
        query: "algorithm=weighted",
      }),
    ).toBe(true);
  });

  test.skipIf(skip)("la même requête servie depuis le cache ne relecture pas", async () => {
    const entry: Entry = { payload: "g", fetchedAt: 1_000, query: "algorithm=subject" };
    expect(await shouldFetch({ entry, resource: "grades", query: "algorithm=subject" })).toBe(false);
    // La requête est normalisée des deux côtés (espaces en bord, ligne).
    expect(
      await shouldFetch({
        entry: { payload: "t", fetchedAt: 1_000, query: "weekStart=2026-10-19" },
        query: "  weekStart=2026-10-19  ",
      }),
    ).toBe(false);
  });

  test.skipIf(skip)("pas d'entrée, entrée périmée ou geste ⇒ relecture", async () => {
    expect(await shouldFetch({ entry: null, query: "" })).toBe(true);
    // Périmée : le TTL décide (l'EDT tient une heure).
    expect(
      await shouldFetch({
        entry: { payload: "t", fetchedAt: 0, query: "weekStart=2026-10-19" },
        query: "weekStart=2026-10-19",
        now: 2 * 60 * 60 * 1000,
      }),
    ).toBe(true);
    // Geste explicite : relecture même sur une entrée fraîche.
    expect(
      await shouldFetch({
        entry: { payload: "t", fetchedAt: 1_000, query: "weekStart=2026-10-19" },
        query: "weekStart=2026-10-19",
        force: true,
      }),
    ).toBe(true);
  });

  test.skipIf(skip)("l'entrée écrite porte la requête (fichier et mémoire)", async () => {
    for (const kind of ["file", "memory"]) {
      await ask({
        op: "save",
        store: kind,
        resource: "timetable",
        payload: "{\"entries\":[]}",
        fetchedAt: 1_234,
        query: "weekStart=2026-10-19",
      });
      const loaded = await ask({ op: "load", store: kind, resource: "timetable" });
      expect(loaded["found"]).toBe(true);
      expect(loaded["query"]).toBe("weekStart=2026-10-19");
      expect(loaded["fetchedAt"]).toBe(1_234);
      expect(loaded["payload"]).toBe("{\"entries\":[]}");
    }
  });

  test.skipIf(skip)("une écriture plus récente remplace l'entrée (avec sa requête)", async () => {
    // Un seul emplacement par ressource : l'entrée suit la DERNIÈRE requête
    // écrite (l'EDT d'une semaine ne sert pas l'autre).
    await ask({
      op: "save",
      store: "memory",
      resource: "timetable",
      payload: "{\"entries\":[\"semaine 1\"]}",
      fetchedAt: 1_000,
      query: "weekStart=2026-10-19",
    });
    await ask({
      op: "save",
      store: "memory",
      resource: "timetable",
      payload: "{\"entries\":[\"semaine 2\"]}",
      fetchedAt: 2_000,
      query: "weekStart=2026-10-26",
    });
    const loaded = await ask({ op: "load", store: "memory", resource: "timetable" });
    expect(loaded["query"]).toBe("weekStart=2026-10-26");
    expect(loaded["fetchedAt"]).toBe(2_000);
    expect(loaded["payload"]).toBe("{\"entries\":[\"semaine 2\"]}");
  });

  test.skipIf(skip)("un fichier écrit avant #365 (sans requête) est ignoré", async () => {
    // Sa requête est inconnue : l'entrée ne répond à AUCUNE requête, donc on
    // relit plutôt que de servir une semaine au hasard.
    await ask({
      op: "writeLegacy",
      resource: "timetable",
      payload: "{\"entries\":[\"semaine inconnue\"]}",
      fetchedAt: 1_000,
    });
    const loaded = await ask({ op: "load", store: "file", resource: "timetable" });
    expect(loaded["found"]).toBe(false);
  });
});
