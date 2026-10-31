// TTL = indice d'affichage (frais vs périmé) ; la source de vérité reste le
// sync serveur. Invalidation active via l'événement CacheInvalidated
// (events.ts), versionnée avec CONTRACTS_VERSION.

// Messagerie = donnée personnelle (sujets, participants, non-lus) : jamais
// journalisée en clair, seule la LISTE des fils est cachable, les messages
// sont lus à la demande. Invalidation par CacheInvalidated, sans événement dédié.
export const CACHEABLE_RESOURCES = ["grades", "assignments", "timetable", "news", "menus", "attendance", "punishments", "capabilities", "discussions", "security-alerts"] as const;

export type CacheableResource = (typeof CACHEABLE_RESOURCES)[number];

export const CACHE_TTL_MS: Record<CacheableResource, number> = {
  grades: 15 * 60 * 1000,
  assignments: 15 * 60 * 1000,
  timetable: 60 * 60 * 1000,
  news: 60 * 60 * 1000,
  // Menus publiés à la semaine, gardés 6 h pour l'affichage hors ligne.
  menus: 6 * 60 * 60 * 1000,
  attendance: 60 * 60 * 1000,
  punishments: 60 * 60 * 1000,
  // Onglets actifs = configuration d'établissement, très lente.
  capabilities: 24 * 60 * 60 * 1000,
  discussions: 15 * 60 * 1000,
  // TTL court : l'âge compte le plus ici, et sans entrée « aucune menace »
  // serait indistinguable de « hors ligne ». Contenu hostile = DONNÉE bornée
  // (I6) ; purgé au logout.
  "security-alerts": 15 * 60 * 1000,
} as const;

export type CacheStatus = "fresh" | "stale";

export function isCacheableResource(v: unknown): v is CacheableResource {
  return typeof v === "string" && (CACHEABLE_RESOURCES as readonly string[]).includes(v);
}

/**
 * Frais si fetchedAt + TTL couvre now, périmé sinon. `fetchedAt` dans le futur
 * (dérive d'horloge appareil) = « périmé » : jamais une entrée fraîche sur une
 * horloge qui recule.
 *
 * Règle PARTAGÉE avec `CachePolicy.isStale` (android/data), borne du TTL
 * incluse des deux côtés. `tests/unit/kotlin-cache-policy.test.ts` rejoue les
 * MÊMES cas sur le vrai Kotlin compilé.
 */
export function cacheStatus(resource: CacheableResource, fetchedAt: number, now: number): CacheStatus {
  const elapsed = now - fetchedAt;
  return elapsed >= 0 && elapsed <= CACHE_TTL_MS[resource] ? "fresh" : "stale";
}
