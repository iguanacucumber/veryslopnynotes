// Alertes de sécurité : contenu hostile neutralisé, affiché comme DONNÉE.
// `excerpt` est du texte brut. Aucune fonction ici ne fabrique de HTML, d'URL
// ou de lien : la route ne rend l'extrait que dans un nœud texte React.
import { cleanText } from "../../lib/format";

export const ALERTS_MAX_ITEMS = 100;
export const ALERT_KIND_INJECTION = "injection_neutralized";
export const EXCERPT_MAX = 500;
export const EXCERPT_COLLAPSED = 140;

// Le filtre de l'appareil est une HEURISTIQUE : il reconnaît des formulations
// d'injection courantes, il ne vérifie rien. Jamais « vérifié » ni « aucun
// contenu hostile » sans réserve.
export const ALERTS_HEURISTIC_NOTE =
  "Filtre heuristique : il repère des formulations d’injection courantes, pas toutes. Un contenu hostile peut donc passer inaperçu, et une note légitime peut être signalée à tort.";
// L'état vide n'affirme PAS l'absence de contenu hostile (fausse assurance) :
// il dit ce que le filtre a fait (rien signalé), le rappel heuristique suit.
export const ALERTS_CLEAR_NOTE = "Le filtre n’a rien signalé sur les contenus lus jusqu’ici.";
export const ALERTS_FLAGGED_NOTE = "Signalé par un filtre heuristique : un faux positif reste possible.";

export interface SecurityAlert {
  id: string;
  kind: string;
  excerpt: string;
  source: string;
}

export type AlertSeverity = "danger" | "info";

export type AlertsLayout = "loading" | "all-clear" | "offline-empty" | "list" | "error";

export interface AlertsState {
  count: number;
  loading: boolean;
  stale: boolean;
  error: string | null;
  hasPayload: boolean;
}

const SOURCE_LABELS: Record<string, string> = {
  revision: "Fiches de révision",
  homework: "Devoirs",
  manuals: "Manuels",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string {
  return typeof value === "string" ? cleanText(value).slice(0, max) : "";
}

export function sanitizeExcerpt(raw: string, max = EXCERPT_MAX): string {
  const clean = cleanText(raw).replace(/\s+/g, " ");
  return clean.length > max ? clean.slice(0, max) : clean;
}

function alertArray(payload: string | null): unknown[] {
  if (!payload) return [];
  try {
    const root: unknown = JSON.parse(payload);
    if (!isRecord(root)) return [];
    if (Array.isArray(root["alerts"])) return root["alerts"];
    if (Array.isArray(root["items"])) return root["items"];
    return [];
  } catch {
    return [];
  }
}

/** Un extrait trop long est tronqué, pas ignoré : mieux vaut montrer la menace
 *  bornée que la cacher. */
export function parseAlertsPayload(payload: string | null): SecurityAlert[] {
  const alerts: SecurityAlert[] = [];
  const seen = new Set<string>();
  for (const raw of alertArray(payload)) {
    if (alerts.length >= ALERTS_MAX_ITEMS) break;
    if (!isRecord(raw)) continue;
    const id = text(raw["id"], 128);
    const kind = text(raw["kind"], 64);
    const excerpt = sanitizeExcerpt(text(raw["excerpt"], 2000));
    const source = text(raw["source"], 64);
    if (!id || !kind || !excerpt || !source || seen.has(id)) continue;
    seen.add(id);
    alerts.push({ id, kind, excerpt, source });
  }
  return alerts;
}

export function alertSeverity(kind: string): AlertSeverity {
  return kind === ALERT_KIND_INJECTION ? "danger" : "info";
}

/** Un kind hors contrat reste neutre, jamais le jeton serveur ni une fausse menace. */
export function alertKindLabel(kind: string): string {
  return kind === ALERT_KIND_INJECTION ? "Injection neutralisée" : "Alerte de sécurité";
}

export function alertSourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? "Autre source";
}

export function excerptPreview(excerpt: string, max = EXCERPT_COLLAPSED): string {
  const clean = sanitizeExcerpt(excerpt);
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${(lastSpace > max / 2 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

/** Décision d'affichage : une liste vide ne vaut « aucune alerte » que si la
 *  réponse est fraîche. Pas de payload, cache périmé ou erreur = le dire. */
export function alertsLayout(state: AlertsState): AlertsLayout {
  if (state.count > 0) return "list";
  if (state.loading) return "loading";
  if (state.error && !state.hasPayload) return "error";
  if (state.stale || state.error || !state.hasPayload) return "offline-empty";
  return "all-clear";
}
