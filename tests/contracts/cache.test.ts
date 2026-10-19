import { describe, expect, test } from "bun:test";
import { CONTRACTS_VERSION } from "../../shared/contracts/models";
import { EVENT_TYPES, isContractEvent } from "../../shared/contracts/events";
import { CACHE_TTL_MS, cacheStatus } from "../../shared/contracts/cache";
import type { CacheableResource } from "../../shared/contracts/cache";

// #311 : miroir de `CachePolicy.shouldFetch` (android/data). La règle est PURE
// (comme `isStale`), donc elle se fige ici sans SDK Android : une entrée de
// cache FRAÎCHE suffit à l'écran, sauf geste explicite de l'utilisateur
// (`force`). Entrée absente ou périmée = relecture du client local.
//
// #372 : la fraîcheur suit EXACTEMENT la règle de `CachePolicy.isStale`
// (android/data) — donc celle de `cacheStatus` (contrat, même règle) : une
// entrée datée dans le FUTOUR (dérive d'horloge d'appareil) est PÉRIMÉE.
// Miroir de `isStale` LUI-MÊME, pas de `cacheStatus` : c'est la borne Kotlin
// qui décide ici, et le badge (« périmé ») garde la sienne.
//
// #365 : la réponse dépend de la REQUÊTE (semaine, période, algorithme).
// L'entrée porte la requête qui l'a produite : une entrée d'une autre requête
// est une entrée ABSENTE ⇒ relecture (le miroir ci-dessous est rejoué par le
// VRAI Kotlin compilé dans `tests/unit/kotlin-cache-query.test.ts`).
type CachedEntry = { payload: string; fetchedAt: number; query: string };

function isStale(resource: CacheableResource, fetchedAt: number, now: number): boolean {
  if (fetchedAt > now) return true;
  return now - fetchedAt > CACHE_TTL_MS[resource];
}

function normalizeQuery(query: string): string {
  return query.trim().replace(/[\n\r\t]/g, " ");
}

function shouldFetch(
  entry: CachedEntry | null,
  resource: CacheableResource,
  query: string,
  now: number,
  force: boolean,
): boolean {
  if (force || entry === null) return true;
  if (normalizeQuery(entry.query) !== normalizeQuery(query)) return true;
  return isStale(resource, entry.fetchedAt, now);
}

describe("fraîcheur avant relecture (#311)", () => {
  test("cache frais + force=false ⇒ zéro appel client", () => {
    // À la borne du TTL, l'entrée est encore fraîche (borne inclusive) : c'est
    // exactement le cas « onglet rouvert dans le TTL » de l'issue.
    expect(shouldFetch({ payload: "g", fetchedAt: 1_000, query: "" }, "grades", "", 1_000 + CACHE_TTL_MS.grades, false)).toBe(false);
  });

  test("cache périmé ⇒ appel", () => {
    expect(shouldFetch({ payload: "g", fetchedAt: 1_000, query: "" }, "grades", "", 1_000 + CACHE_TTL_MS.grades + 1, false)).toBe(true);
  });

  test("force=true ⇒ appel, même sur un cache frais", () => {
    expect(shouldFetch({ payload: "g", fetchedAt: 1_000, query: "" }, "grades", "", 1_000, true)).toBe(true);
    expect(shouldFetch(null, "grades", "", 1_000, true)).toBe(true);
  });

  test("pas de cache ⇒ appel", () => {
    expect(shouldFetch(null, "grades", "", 1_000, false)).toBe(true);
  });

  test("c'est le TTL de la ressource qui décide, pas une durée globale", () => {
    const now = 20 * 60 * 1000;
    expect(shouldFetch({ payload: "g", fetchedAt: 0, query: "" }, "grades", "", now, false)).toBe(true);
    expect(shouldFetch({ payload: "t", fetchedAt: 0, query: "" }, "timetable", "", now, false)).toBe(false);
  });
});

describe("la clé de cache porte la requête (#365)", () => {
  test("même ressource, requête différente ⇒ relecture", () => {
    // L'EDT de la semaine prochaine : l'entrée fraîche de la semaine
    // courante ne peut PAS lui servir de réponse.
    const entry = { payload: "t", fetchedAt: 1_000, query: "weekStart=2026-10-19" };
    expect(shouldFetch(entry, "timetable", "weekStart=2026-10-26", 1_000, false)).toBe(true);
    expect(shouldFetch(entry, "timetable", "weekStart=2026-10-19", 1_000, false)).toBe(false);
  });

  test("la période et l'algorithme changent la réponse", () => {
    const entry = { payload: "g", fetchedAt: 1_000, query: "algorithm=subject" };
    expect(shouldFetch(entry, "grades", "algorithm=weighted", 1_000, false)).toBe(true);
    expect(shouldFetch(entry, "grades", "algorithm=subject&periodId=T2", 1_000, false)).toBe(true);
    expect(shouldFetch(entry, "grades", "algorithm=subject", 1_000, false)).toBe(false);
  });

  test("la requête vide est la vue par défaut", () => {
    const entry = { payload: "g", fetchedAt: 1_000, query: "" };
    expect(shouldFetch(entry, "grades", "", 1_000, false)).toBe(false);
    expect(shouldFetch(entry, "grades", "algorithm=subject", 1_000, false)).toBe(true);
  });

  test("la requête est normalisée des deux côtés", () => {
    const entry = { payload: "t", fetchedAt: 1_000, query: "weekStart=2026-10-19" };
    expect(shouldFetch(entry, "timetable", "  weekStart=2026-10-19  ", 1_000, false)).toBe(false);
  });
});

describe("fraîcheur du contrat : horloge en avance (#372)", () => {
  const now = 1_700_000_000_000;

  test("entrée datée dans le futur = périmée (dérive d'horloge d'appareil)", () => {
    // Une entrée datée APRÈS maintenant n'est pas fraîche : son âge est
    // indéterminable, donc on la traite comme périmée (badge affiché, cache
    // relu). La soustraction seule (`now - fetchedAt` négatif) la disait fraîche.
    expect(cacheStatus("grades", now + 1000, now)).toBe("stale");
    // Une entrée passée normale reste fraîche.
    expect(cacheStatus("grades", now - 1000, now)).toBe("fresh");
  });

  test("la relecture suit la même règle (entrée future = on relit)", () => {
    expect(shouldFetch({ payload: "g", fetchedAt: now + 1000, query: "" }, "grades", "", now, false)).toBe(true);
    expect(shouldFetch({ payload: "g", fetchedAt: now - 1000, query: "" }, "grades", "", now, false)).toBe(false);
  });

  test("borne du TTL : frais dessus, périmé au-delà", () => {
    const ttl = CACHE_TTL_MS.grades;
    expect(cacheStatus("grades", now - ttl, now)).toBe("fresh");
    expect(cacheStatus("grades", now - ttl - 1, now)).toBe("stale");
  });

  test("parité : le miroir Kotlin et le contrat rendent le même verdict", () => {
    for (const resource of ["grades", "timetable", "capabilities"] as const) {
      const ttl = CACHE_TTL_MS[resource];
      for (const fetchedAt of [now - 1000, now - ttl, now - ttl - 1, now + 1, now + 1000]) {
        const miroir = isStale(resource, fetchedAt, now);
        const contrat = cacheStatus(resource, fetchedAt, now) === "stale";
        expect(miroir).toBe(contrat);
      }
    }
  });
});

describe("cache invalidation event contract", () => {
  test("CacheInvalidated : enveloppe valide, invalides rejetés, miroir OpenAPI", () => {
    const at = "2026-10-02T06:00:00.000Z";
    expect(EVENT_TYPES).toContain("CacheInvalidated");
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "CacheInvalidated",
        at,
        data: { resource: "grades", reason: "sync" },
      }),
    ).toBe(true);
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "CacheInvalidated",
        at,
        data: { resource: "nope", reason: "sync" },
      }),
    ).toBe(false);
    expect(
      isContractEvent({
        v: CONTRACTS_VERSION,
        type: "CacheInvalidated",
        at,
        data: { resource: "grades", reason: "unknown" },
      }),
    ).toBe(false);
  });
});
