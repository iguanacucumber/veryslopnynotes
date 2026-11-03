import type { TextSizeChoice } from "../bridge/types";

/** Choix proposés : `SYSTEM` suit le réglage Android, les autres le remplacent. */
export const TEXT_SIZE_OPTIONS: ReadonlyArray<{ value: TextSizeChoice; label: string }> = [
  { value: "SYSTEM", label: "Système" },
  { value: "100", label: "100 %" },
  { value: "125", label: "125 %" },
  { value: "150", label: "150 %" },
];

/** Miroir de `core/TextScale.kt` : bornes du zoom textuel. */
export const MIN_TEXT_ZOOM = 50;
export const MAX_TEXT_ZOOM = 200;

/** Une valeur inconnue retombe sur le système, jamais sur un zoom inventé. */
export function parseTextSize(raw: unknown): TextSizeChoice {
  const value = typeof raw === "number" ? String(raw) : typeof raw === "string" ? raw.trim() : "";
  if (value.toUpperCase() === "SYSTEM") return "SYSTEM";
  return value === "100" || value === "125" || value === "150" ? value : "SYSTEM";
}

/** `fontScale` Android (1.0 = 100 %) converti en pourcentage borné. */
export function textZoomFromFontScale(fontScale: number): number {
  if (!Number.isFinite(fontScale)) return 100;
  return Math.min(MAX_TEXT_ZOOM, Math.max(MIN_TEXT_ZOOM, Math.round(fontScale * 100)));
}

/** Zoom effectif : le choix explicite gagne, sinon le système décide. */
export function effectiveTextZoom(choice: TextSizeChoice, fontScale = 1): number {
  const size = parseTextSize(choice);
  return size === "SYSTEM" ? textZoomFromFontScale(fontScale) : Number(size);
}

/** À partir de 150 %, les libellés passent à la ligne au lieu d'être coupés. */
export function isLargeText(zoom: number): boolean {
  return Number.isFinite(zoom) && zoom >= 150;
}
