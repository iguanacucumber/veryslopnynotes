// Contrats v0 — politique cache + invalidation (issue #18, phase 5).
// TTL = indice d'affichage (frais vs badge périmé, app phase 4 #14) ; la
// source de vérité reste le sync serveur (#16/#17). Invalidation active via
// événement CacheInvalidated (events.ts). Versionnée avec CONTRACTS_VERSION.

// "attendance"/"punishments" (#77) ajoutés en fin : vie scolaire lente comme
// l'EDT (les absences sont saisies par la vie scolaire, pas par l'app).
// Add-only, le sync serveur reste la source de vérité. Invalidation =
// CacheInvalidated (resource attendance/punishments), pas d'événement dédié.
// "evaluations" (#78) : badge périmé comme les notes, même principe.
// "capabilities" (#87) ajouté en fin : la liste des onglets Pronote actifs ne
// bouge qu'à la configuration de l'établissement. Elle est cachée comme les
// autres (l'app masque un onglet sans réseau) et invalidée par
// CacheInvalidated (resource capabilities) quand le pull-refresh la change.
export const CACHEABLE_RESOURCES = ["grades", "assignments", "timetable", "news", "menus", "evaluations", "attendance", "punishments", "capabilities"] as const;

export type CacheableResource = (typeof CACHEABLE_RESOURCES)[number];

/** Durées de fraîcheur par ressource (données scolaires lentes). */
export const CACHE_TTL_MS: Record<CacheableResource, number> = {
  grades: 15 * 60 * 1000,
  assignments: 15 * 60 * 1000,
  timetable: 60 * 60 * 1000,
  // #79 : actualités établissement, très lentes comme l'EDT (événement rare).
  news: 60 * 60 * 1000,
  // #81 : menus publiés à la semaine, on les garde 6h pour l'affichage avion.
  menus: 6 * 60 * 60 * 1000,
  // #78 : évaluations par compétences, même cadence que les notes.
  evaluations: 15 * 60 * 1000,
  // #77 : vie scolaire (absences/retards/sanctions), rythme EDT.
  attendance: 60 * 60 * 1000,
  punishments: 60 * 60 * 1000,
  // #87 : onglets Pronote actifs = configuration d'établissement, très lente.
  capabilities: 24 * 60 * 60 * 1000,
} as const;

export type CacheStatus = "fresh" | "stale";

export function isCacheableResource(v: unknown): v is CacheableResource {
  return typeof v === "string" && (CACHEABLE_RESOURCES as readonly string[]).includes(v);
}

/** Frais si fetchedAt + TTL couvre now, périmé sinon (badge app). */
export function cacheStatus(resource: CacheableResource, fetchedAt: number, now: number): CacheStatus {
  return now - fetchedAt <= CACHE_TTL_MS[resource] ? "fresh" : "stale";
}
