// Palettes (#335) : la table est la source unique des couleurs, donc les
// contrats qu'elle doit tenir sont testables ici — contraste, unicité, et
// non-dérive avec le repli CSS de `styles/tokens.css`.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  cssVarsOf,
  DEFAULT_SCHEME_ID,
  paletteOf,
  parseScheme,
  SCHEMES,
  schemeById,
  schemeLabel,
  type Palette,
} from "../../web/src/lib/schemes";

const ROOT = join(import.meta.dir, "..", "..");
const HEX = /^#[0-9A-Fa-f]{6}$/;

function rgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

function luminance(hex: string): number {
  const [r, g, b] = rgb(hex).map((channel) => {
    const s = channel / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg: string, bg: string): number {
  const a = luminance(fg);
  const b = luminance(bg);
  return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
}

/** 72 % d'encre composés sur la surface : la valeur réelle de `--muted`. */
function mutedOn(palette: Palette): string {
  const ink = rgb(palette.ink);
  const surface = rgb(palette.surface);
  const mix = ink.map((channel, index) => Math.round(channel * 0.72 + surface[index]! * 0.28));
  return `#${mix.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
}

const PAIRS: ReadonlyArray<[keyof Palette, keyof Palette, number]> = [
  ["ink", "page", 4.5],
  ["ink", "surface", 4.5],
  ["brandDeep", "page", 4.5],
  ["brandDeep", "surface", 4.5],
  ["brandDeep", "brandPale", 4.5],
  ["onBrand", "brandSolid", 4.5],
  ["dangerInk", "page", 4.5],
  ["dangerInk", "surface", 4.5],
  ["onDanger", "dangerSolid", 4.5],
];

describe("web palettes", () => {
  test("ids uniques, deux variantes par palette, libellés non vides", () => {
    const ids = SCHEMES.map((scheme) => scheme.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.length).toBeGreaterThanOrEqual(20);
    expect(ids).toContain(DEFAULT_SCHEME_ID);
    for (const scheme of SCHEMES) {
      expect(scheme.id).toMatch(/^[a-z0-9-]+$/);
      expect(scheme.label.trim()).not.toBe("");
      expect(scheme.light).toBeDefined();
      expect(scheme.dark).toBeDefined();
    }
  });

  // #620 : la palette Madoka porte un skin décoratif WebView-local. Le test
  // vérifie le CÂBLAGE (palette → `data-scheme` → feuille importée), pas les
  // couleurs : elles sont déjà tenues par les contrats génériques ci-dessus.
  test("la palette Madoka existe et son skin étoilé est câblé", () => {
    const scheme = SCHEMES.find((entry) => entry.id === "madoka");
    expect(scheme?.label).toBe("Madoka Magica");
    const app = readFileSync(join(ROOT, "web/src/ui/AppContext.tsx"), "utf8");
    expect(app).toContain('dataset["scheme"] = scheme');
    const main = readFileSync(join(ROOT, "web/src/main.tsx"), "utf8");
    expect(main).toContain('import "./styles/madoka.css";');
    const css = readFileSync(join(ROOT, "web/src/styles/madoka.css"), "utf8");
    expect(css).toContain(':root[data-scheme="madoka"]');
    expect(css).toContain("@keyframes madoka-twinkle");
  });

  test("parseScheme : valeur inconnue = palette par défaut", () => {
    expect(parseScheme("tokyo-night")).toBe("tokyo-night");
    expect(parseScheme("inconnu")).toBe(DEFAULT_SCHEME_ID);
    expect(parseScheme(null)).toBe(DEFAULT_SCHEME_ID);
    expect(parseScheme(42)).toBe(DEFAULT_SCHEME_ID);
    expect(schemeById("nord").label).toBe("Nord");
    expect(schemeLabel("inconnu")).toBe(schemeLabel(DEFAULT_SCHEME_ID));
    expect(paletteOf("inconnu", true)).toBe(SCHEMES[0]!.dark);
  });

  test("toutes les couleurs sont des hex à 6 chiffres", () => {
    for (const scheme of SCHEMES) {
      for (const mode of ["light", "dark"] as const) {
        for (const [key, value] of Object.entries(scheme[mode])) {
          expect({ scheme: scheme.id, mode, key, ok: HEX.test(value) }).toEqual({
            scheme: scheme.id,
            mode,
            key,
            ok: true,
          });
        }
      }
    }
  });

  test("contraste ≥ 4.5:1 : encre, accent, erreur, boutons pleins", () => {
    for (const scheme of SCHEMES) {
      for (const mode of ["light", "dark"] as const) {
        const palette = scheme[mode];
        for (const [fg, bg, need] of PAIRS) {
          const ratio = contrast(palette[fg], palette[bg]);
          expect({
            scheme: scheme.id,
            mode,
            pair: `${String(fg)}/${String(bg)}`,
            ok: ratio >= need,
            ratio: Number(ratio.toFixed(2)),
          }).toEqual({
            scheme: scheme.id,
            mode,
            pair: `${String(fg)}/${String(bg)}`,
            ok: true,
            ratio: Number(ratio.toFixed(2)),
          });
        }
      }
    }
  });

  test("texte secondaire (72 % d'encre) ≥ 3:1 sur la surface", () => {
    for (const scheme of SCHEMES) {
      for (const mode of ["light", "dark"] as const) {
        const palette = scheme[mode];
        const ratio = contrast(mutedOn(palette), palette.surface);
        expect({ scheme: scheme.id, mode, ok: ratio >= 3, ratio: Number(ratio.toFixed(2)) }).toEqual({
          scheme: scheme.id,
          mode,
          ok: true,
          ratio: Number(ratio.toFixed(2)),
        });
      }
    }
  });

  test("cssVarsOf : variables attendues, noms préfixés, valeurs non vides", () => {
    const required = [
      "--page",
      "--surface",
      "--surface-variant",
      "--surface-container",
      "--ink",
      "--muted",
      "--border",
      "--brand",
      "--brand-light",
      "--brand-deep",
      "--brand-pale",
      "--brand-solid",
      "--on-brand",
      "--danger",
      "--danger-solid",
      "--on-danger",
      "--danger-ink",
      "--shadow",
      "--shadow-soft",
    ];
    for (const dark of [false, true]) {
      const vars = cssVarsOf(paletteOf(DEFAULT_SCHEME_ID, dark), dark);
      for (const name of required) expect(Object.keys(vars)).toContain(name);
      for (const [name, value] of Object.entries(vars)) {
        expect(name.startsWith("--")).toBe(true);
        expect(value.trim()).not.toBe("");
      }
    }
  });

  test("la palette par défaut ne dérive pas du repli de tokens.css", () => {
    const css = readFileSync(join(ROOT, "web/src/styles/tokens.css"), "utf8");
    const blocks: Array<[string, boolean]> = [
      [/:root \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "", false],
      [/:root\[data-theme="dark"\] \{([\s\S]*?)\n\}/.exec(css)?.[1] ?? "", true],
    ];
    const normalize = (value: string) => value.replace(/\s+/g, "").toLowerCase();
    for (const [block, dark] of blocks) {
      expect(block).not.toBe("");
      const declared = new Map<string, string>();
      for (const match of block.matchAll(/(--[a-z-]+):\s*([^;]+);/g)) {
        declared.set(match[1]!, normalize(match[2]!));
      }
      const vars = cssVarsOf(paletteOf(DEFAULT_SCHEME_ID, dark), dark);
      const compared: string[] = [];
      for (const [name, value] of Object.entries(vars)) {
        if (!declared.has(name)) continue;
        compared.push(name);
        expect({ name, dark, css: declared.get(name) }).toEqual({ name, dark, css: normalize(value) });
      }
      // Le repli CSS doit rester complet : un jeton manquant = écran nu.
      for (const name of ["--muted", "--border", "--brand-solid", "--on-brand", "--on-danger"]) {
        expect(compared).toContain(name);
      }
    }
  });
});
