// Contrats — capacités dynamiques (parité Papillon).
// Papillon masque une entrée d'onglet quand l'onglet Pronote correspondant
// n'est pas actif chez l'établissement. Capacités non déterminées = `null`
// côté API (voir `CapabilitiesResponse`).
import { isBoundedString, isIsoDate, isRecord } from "./guards";

export const TAB_CAPABILITIES = [
  "grades",
  "homework",
  "timetable",
  "news",
  "menus",
  "attendance",
  "punishments",
  "discussions",
  "profile",
] as const;

export type TabCapability = (typeof TAB_CAPABILITIES)[number];

export const CAPABILITIES_ACCOUNT_ID_MAX_CHARS = 64;
export const CAPABILITIES_MAX_TABS = TAB_CAPABILITIES.length;

export interface Capabilities {
  readonly accountId: string;
  /** Onglets ACTIFS chez l'établissement (ordre canonique, sans doublon). */
  readonly tabs: TabCapability[];
  /** ISO-8601 de la détection (l'app l'affiche comme donnée, jamais interprété). */
  readonly fetchedAt: string;
}

export function isTabCapability(v: unknown): v is TabCapability {
  return typeof v === "string" && (TAB_CAPABILITIES as readonly string[]).includes(v);
}

export function isCapabilities(v: unknown): v is Capabilities {
  if (!isRecord(v)) return false;
  if (!isBoundedString(v["accountId"], CAPABILITIES_ACCOUNT_ID_MAX_CHARS)) return false;
  const tabs = v["tabs"];
  if (!Array.isArray(tabs) || tabs.length > CAPABILITIES_MAX_TABS) return false;
  const seen = new Set<string>();
  for (const t of tabs as unknown[]) {
    if (!isTabCapability(t)) return false;
    if (seen.has(t as string)) return false;
    seen.add(t as string);
  }
  if (!isIsoDate(v["fetchedAt"])) return false;
  return true;
}
