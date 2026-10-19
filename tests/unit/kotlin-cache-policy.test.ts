// #372 : une horloge en avance rendait le cache frais POUR TOUJOURS.
//
// `CachePolicy` (android/data) est compilé par le harnais puis piloté par
// `CachePolicyParityMain` : ce n'est pas un miroir TS, c'est le code de
// production EXÉCUTÉ. Deux vérifications :
//   1. une entrée datée dans le FUTUR (dérive d'horloge d'appareil, NTP qui
//      recule) est PÉRIMÉE — badge « périmé » affiché, client local relu ;
//   2. PARITÉ avec le contrat TS `cacheStatus` (shared/contracts/cache.ts) :
//      même verdict sur la même série de cas (passé, futur, périmé, borne du
//      TTL), et TTL identiques des deux côtés.
//
// Outillage `kotlinc`/`java` absent = SKIP BRUYANT du harnais (jamais un faux
// vert) ; un échec de compilation, lui, est un défaut (le test rougit).
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { CACHEABLE_RESOURCES, CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import { parityToolchain, ROOT, type ParityLink } from "./fixtures/kotlin-harness";

const DATA = join(ROOT, "android", "data", "src", "main", "java", "fr", "veryslopnynotes", "data");
const POLICY = join(DATA, "CachePolicy.kt");
const CACHE = join(DATA, "OfflineCache.kt");
// JSON du pilote : le `Json` embarqué du port (pur, aucun import Android).
const JSON_LIB = join(ROOT, "android", "pronote", "src", "main", "java", "fr", "veryslopnynotes", "pronote", "Json.kt");
const DRIVER = join(ROOT, "agents", "runtime", "kotlin-parity", "CachePolicyParityMain.kt");

const skip = parityToolchain.skipReason !== null;

let link: ParityLink | null = null;
if (!skip) {
  const jar = await parityToolchain.ensureJar("kotlin-cache-policy", [POLICY, CACHE, JSON_LIB, DRIVER]);
  link = await parityToolchain.openLink(jar);
}

async function ask(op: unknown): Promise<string> {
  return link!.ask(op);
}

/** Verdict « périmé » du VRAI Kotlin (`CachePolicy.isStale`). */
async function kotlinIsStale(resource: string, fetchedAt: number, now: number): Promise<boolean> {
  const res = JSON.parse(await ask({ op: "isStale", resource, fetchedAt, now })) as { stale: boolean };
  return res.stale;
}

/** Verdict « relecture du client local » du VRAI Kotlin (`CachePolicy.shouldFetch`). */
async function kotlinShouldFetch(
  resource: string,
  fetchedAt: number,
  now: number,
  force: boolean,
  entry: boolean,
): Promise<boolean> {
  const res = JSON.parse(await ask({ op: "shouldFetch", resource, fetchedAt, now, force, entry })) as {
    fetch: boolean;
  };
  return res.fetch;
}

const NOW = 1_700_000_000_000;

describe("fraîcheur du cache : horloge en avance (#372)", () => {
  test.skipIf(skip)("entrée datée dans le FUTUR = périmée (Kotlin)", async () => {
    // Une dérive d'horloge d'appareil (NTP qui recule) date l'entrée APRÈS
    // maintenant : elle est périmée, pas fraîche.
    expect(await kotlinIsStale("grades", NOW + 1000, NOW)).toBe(true);
    // Une entrée normale (passée) reste fraîche.
    expect(await kotlinIsStale("grades", NOW - 1000, NOW)).toBe(false);
  });

  test.skipIf(skip)("shouldFetch relit le client local sur une entrée future", async () => {
    // Sans ça, l'app ne relisait PLUS JAMAIS le client local pendant toute la
    // dérive (capabilities : TTL 24 h → jusqu'à 48 h de données périmées
    // servies comme fraîches).
    expect(await kotlinShouldFetch("grades", NOW + 1000, NOW, false, true)).toBe(true);
    // Entrée fraîche = pas de relecture, sauf geste explicite de l'utilisateur.
    expect(await kotlinShouldFetch("grades", NOW - 1000, NOW, false, true)).toBe(false);
    expect(await kotlinShouldFetch("grades", NOW - 1000, NOW, true, true)).toBe(true);
    // Pas d'entrée du tout = relecture.
    expect(await kotlinShouldFetch("grades", NOW - 1000, NOW, false, false)).toBe(true);
  });

  test.skipIf(skip)("parité Kotlin <-> contrat TS : même verdict sur la même série de cas", async () => {
    for (const resource of CACHEABLE_RESOURCES) {
      const ttl = CACHE_TTL_MS[resource];
      const series = [
        { label: "passé", fetchedAt: NOW - 1000 },
        { label: "borne exacte du TTL", fetchedAt: NOW - ttl },
        { label: "TTL dépassé de 1 ms", fetchedAt: NOW - ttl - 1 },
        { label: "futur de 1 ms", fetchedAt: NOW + 1 },
        { label: "futur de 1 s", fetchedAt: NOW + 1000 },
      ];
      for (const c of series) {
        const kt = await kotlinIsStale(resource, c.fetchedAt, NOW);
        const ts = cacheStatus(resource, c.fetchedAt, NOW) === "stale";
        if (kt !== ts) {
          throw new Error(
            `parité cache ${resource} (${c.label}) : Kotlin=${kt} TS=${ts} (fetchedAt=${c.fetchedAt}, now=${NOW})`,
          );
        }
        expect(kt).toBe(ts);
      }
    }
  });

  test.skipIf(skip)("TTL identiques des deux côtés (aucun TTL déplacé)", async () => {
    for (const resource of CACHEABLE_RESOURCES) {
      const res = JSON.parse(await ask({ op: "ttl", resource })) as { ttl: number };
      expect(res.ttl).toBe(CACHE_TTL_MS[resource]);
    }
  });
});
