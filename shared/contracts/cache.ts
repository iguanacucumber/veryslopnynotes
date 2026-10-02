// Contrats v0 — politique cache + invalidation (issue #18, phase 5).
// TTL = indice d'affichage (frais vs badge périmé, app phase 4 #14) ; la
// source de vérité reste le sync serveur (#16/#17). Invalidation active via
// événement CacheInvalidated (events.ts). Versionnée avec CONTRACTS_VERSION.

export const CACHEABLE_RESOURCES = ["grades", "assignments", "timetable", "news"] as const;

export type CacheableResource = (typeof CACHEABLE_RESOURCES)[number];

/** Durées de fraîcheur par ressource (données scolaires lentes). */
export const CACHE_TTL_MS: Record<CacheableResource, number> = {
  grades: 15 * 60 * 1000,
  assignments: 15 * 60 * 1000,
  timetable: 60 * 60 * 1000,
  // #79 : actualités établissement, très lentes comme l'EDT (événement rare).
  news: 60 * 60 * 1000,
} as const;

export type CacheStatus = "fresh" | "stale";

export function isCacheableResource(v: unknown): v is CacheableResource {
  return typeof v === "string" && (CACHEABLE_RESOURCES as readonly string[]).includes(v);
}

/** Frais si fetchedAt + TTL couvre now, périmé sinon (badge app). */
export function cacheStatus(resource: CacheableResource, fetchedAt: number, now: number): CacheStatus {
  return now - fetchedAt <= CACHE_TTL_MS[resource] ? "fresh" : "stale";
}
