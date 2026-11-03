import { relativeFr } from "./format";

/** Cause stable d'une lecture qui n'a pas abouti. `offline` = l'appareil le
 *  dit ; `network` = l'appareil est en ligne mais l'établissement n'a pas
 *  répondu ; `other` = refus, stockage ou donnée illisible. */
export type FreshnessCause = "offline" | "network" | "other";

export const FRESHNESS_CAUSE_LABEL: Record<FreshnessCause, string> = {
  offline: "hors-ligne",
  network: "réseau indisponible",
  other: "erreur de lecture",
};

export function isFreshnessCause(value: unknown): value is FreshnessCause {
  return value === "offline" || value === "network" || value === "other";
}

/** L'appareil annonce-t-il une connexion ? Ce n'est pas une preuve que
 *  l'établissement répond, seulement ce que le téléphone sait de son réseau. */
export function isOnline(): boolean {
  return typeof navigator === "undefined" || navigator.onLine !== false;
}

/** Cause d'un échec : la plus précise disponible, sinon le réseau de l'appareil.
 *  Une cause `network` du natif devient `offline` quand l'appareil est hors
 *  ligne, pour ne jamais annoncer « réseau » alors qu'il n'y en a pas. */
export function failureCause(
  error: string | null | undefined,
  online: boolean = isOnline(),
  reported: FreshnessCause | null | undefined = null,
): FreshnessCause | null {
  if (!error) return null;
  if (reported === "offline" || !online) return "offline";
  if (reported === "other") return "other";
  return "network";
}

/** « mis à jour il y a 2 h », « mis à jour le 16 oct. » : jamais une date
 *  inventée quand `fetchedAt` manque. */
export function updatedAtLabel(fetchedAt: number | null | undefined, now: number = Date.now()): string {
  if (fetchedAt === null || fetchedAt === undefined || !Number.isFinite(fetchedAt) || fetchedAt <= 0) {
    return "";
  }
  const relative = relativeFr(new Date(fetchedAt).toISOString(), now);
  if (!relative) return "";
  if (relative === "hier" || relative === "à l'instant" || relative.startsWith("il y a ")) {
    return `mis à jour ${relative}`;
  }
  return `mis à jour le ${relative}`;
}

/** Phrase d'un état de cache : cause (si connue), puis âge réel de la donnée. */
export function freshnessLabel({
  fetchedAt,
  cause = null,
  now = Date.now(),
  fallback = "fraîcheur inconnue",
}: {
  fetchedAt?: number | null;
  cause?: FreshnessCause | null;
  now?: number;
  fallback?: string;
}): string {
  const updated = updatedAtLabel(fetchedAt, now);
  const prefix = cause ? FRESHNESS_CAUSE_LABEL[cause] : "";
  if (prefix && updated) return `${prefix} · ${updated}`;
  if (updated) return updated;
  return prefix || fallback;
}
