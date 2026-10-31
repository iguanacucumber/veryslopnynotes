// Source UNIQUE des palettes : l'aperçu des réglages et les variables CSS
// sortent du même objet. Le mode choisit la variante (claire/sombre), la
// palette la famille ; les contrastes sont tenus par `tests/web/schemes.test.ts`.

import {
  DEFAULT_SCHEME_ID,
  SCHEMES,
  type Palette,
  type Scheme,
} from "./schemes.data";

export { DEFAULT_SCHEME_ID, SCHEMES };
export type { Palette, Scheme };

export const SCHEME_IDS: ReadonlyArray<string> = SCHEMES.map((scheme) => scheme.id);

export function schemeById(id: string): Scheme {
  return SCHEMES.find((scheme) => scheme.id === id) ?? SCHEMES[0]!;
}

/** Valeur inconnue = défaut : une palette retirée ne casse pas le démarrage. */
export function parseScheme(raw: unknown): string {
  return typeof raw === "string" && SCHEME_IDS.includes(raw) ? raw : DEFAULT_SCHEME_ID;
}

export function schemeLabel(id: string): string {
  return schemeById(id).label;
}

export function paletteOf(id: string, dark: boolean): Palette {
  const scheme = schemeById(id);
  return dark ? scheme.dark : scheme.light;
}

function rgba(hex: string, alpha: number): string {
  const value = Number.parseInt(hex.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}

/** Variables CSS posées sur `<html>` : mêmes noms que `styles/tokens.css`. */
export function cssVarsOf(p: Palette, dark: boolean): Record<string, string> {
  return {
    "--page": p.page,
    "--surface": p.surface,
    "--surface-variant": p.surfaceVariant,
    "--surface-container": p.surfaceContainer,
    "--ink": p.ink,
    "--muted": rgba(p.ink, 0.72),
    "--border": rgba(p.ink, 0.16),
    "--brand": p.brand,
    "--brand-light": p.brandLight,
    "--brand-deep": p.brandDeep,
    "--brand-pale": p.brandPale,
    "--brand-solid": p.brandSolid,
    "--on-brand": p.onBrand,
    "--on-brand-soft": rgba(p.onBrand, 0.88),
    "--on-brand-veil": rgba(p.onBrand, dark ? 0.14 : 0.13),
    "--on-brand-hover": rgba(p.onBrand, 0.26),
    "--on-brand-line": rgba(p.onBrand, 0.34),
    "--danger": p.danger,
    "--danger-solid": p.dangerSolid,
    "--on-danger": p.onDanger,
    "--danger-ink": p.dangerInk,
    "--shadow": dark ? "0 10px 30px rgba(0, 0, 0, 0.55)" : `0 10px 30px ${rgba(p.ink, 0.08)}`,
    "--shadow-soft": dark ? "0 2px 10px rgba(0, 0, 0, 0.4)" : `0 2px 10px ${rgba(p.ink, 0.05)}`,
    // Ombre des surfaces flottantes (barre d'onglets) : dérivée de l'encre en
    // clair, noire en sombre — une ombre d'encre claire ne se voit pas.
    "--shadow-float": dark ? "0 8px 28px rgba(0, 0, 0, 0.6)" : `0 8px 28px ${rgba(p.ink, 0.16)}`,
  };
}
