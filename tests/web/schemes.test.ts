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
import { readableInk, subjectColor, tint } from "../../web/src/lib/format";
import { subjectPalette } from "../../web/src/lib/subjectVisual";

const ROOT = join(import.meta.dir, "..", "..");
const HEX = /^#[0-9A-Fa-f]{6}$/;

function rgb(hex: string): [number, number, number] {
  const value = /^rgba?\(\s*(\d{1,3})[\s,]+(\d{1,3})[\s,]+(\d{1,3})/i.exec(hex.trim());
  if (value) return [Number(value[1]), Number(value[2]), Number(value[3])];
  const parsed = Number.parseInt(hex.slice(1), 16);
  return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
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

/** Mélange opaque de `base` sur `other`, comme `color-mix(in srgb, …)`. */
function mix(base: string, other: string, weight: number): string {
  const a = rgb(base);
  const b = rgb(other);
  const channels = a.map((channel, index) => Math.round(channel * weight + b[index]! * (1 - weight)));
  return `#${channels.map((channel) => channel.toString(16).padStart(2, "0")).join("")}`;
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
    expect(ids).toEqual([DEFAULT_SCHEME_ID, "material", "liquid-glass", "frutiger-aero"]);
    expect(ids).toContain(DEFAULT_SCHEME_ID);
    for (const scheme of SCHEMES) {
      expect(scheme.id).toMatch(/^[a-z0-9-]+$/);
      expect(scheme.label.trim()).not.toBe("");
      expect(scheme.light).toBeDefined();
      expect(scheme.dark).toBeDefined();
    }
  });

  // La palette Liquid Glass porte une matière WebView-locale. Le test vérifie
  // le CÂBLAGE (palette → `data-scheme` → feuille importée), pas le rendu.
  test("la palette Liquid Glass existe et sa matière est câblée", () => {
    const scheme = SCHEMES.find((entry) => entry.id === "liquid-glass");
    expect(scheme?.label).toBe("Liquid Glass");
    const main = readFileSync(join(ROOT, "web/src/main.tsx"), "utf8");
    expect(main).toContain('import "./styles/liquid-glass.css";');
    const css = readFileSync(join(ROOT, "web/src/styles/liquid-glass.css"), "utf8");
    expect(css).toContain(':root[data-scheme="liquid-glass"]');
    expect(css).toMatch(/:root\[data-scheme="liquid-glass"\] \.tabbar\s*\{[^}]*backdrop-filter/);
    expect(css).toContain("@supports not");
    expect(css).toContain("prefers-reduced-transparency");
    const shell = readFileSync(join(ROOT, "web/src/ui/AppShell.tsx"), "utf8");
    expect(shell).toContain("<GlassBackdrop");
    expect(shell).toContain('scheme === "liquid-glass"');
    expect(css).toContain(".glass-backdrop__blob");
    expect(css).toMatch(/@keyframes lg-drift-a/);
  });

  // Frutiger Aero ajoute une matière WebView-locale. Le test vérifie le
  // CÂBLAGE (palette → `data-scheme` → feuille importée), pas le rendu.
  test("la palette Frutiger Aero existe et son vernis est câblé", () => {
    const scheme = SCHEMES.find((entry) => entry.id === "frutiger-aero");
    expect(scheme?.label).toBe("Frutiger Aero");
    const main = readFileSync(join(ROOT, "web/src/main.tsx"), "utf8");
    expect(main).toContain('import "./styles/frutiger-aero.css";');
    const css = readFileSync(join(ROOT, "web/src/styles/frutiger-aero.css"), "utf8");
    expect(css).toContain(':root[data-scheme="frutiger-aero"]');
    expect(css).toMatch(/:root\[data-scheme="frutiger-aero"\] \.card[^{]*\{[^}]*background-image:\s*var\(--fa-gloss\)/);
    expect(css).toContain(".glass-backdrop__blob");
    expect(css).toMatch(/@keyframes fa-bubble-rise/);
    const shell = readFileSync(join(ROOT, "web/src/ui/AppShell.tsx"), "utf8");
    expect(shell).toContain("<GlassBackdrop");
    expect(shell).toContain('scheme === "frutiger-aero"');
  });

  test("parseScheme : valeur inconnue = palette par défaut", () => {
    expect(parseScheme("material")).toBe("material");
    expect(parseScheme("inconnu")).toBe(DEFAULT_SCHEME_ID);
    expect(parseScheme(null)).toBe(DEFAULT_SCHEME_ID);
    expect(parseScheme(42)).toBe(DEFAULT_SCHEME_ID);
    expect(schemeById("material").label).toBe("Material You");
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

  // La coche « Terminé » pose son encre sur la teinte de la matière : cette
  // teinte est éclaircie en sombre. L'encre doit donc être dérivée, pas blanche.
  test("l'encre de tâche reste ≥ 4.5:1 sur la teinte de matière", () => {
    const bases = [...new Set(Array.from({ length: 64 }, (_, index) => subjectColor(`MATIERE ${index}`)))];
    expect(bases.length).toBe(20);
    for (const base of bases) {
      // Mêmes deux teintes que la carte de tâche : assombrie en clair, éclaircie en sombre.
      for (const amount of [-0.3, 0.3]) {
        const background = tint(base, amount);
        const ink = readableInk(background);
        const ratio = contrast(ink, background);
        expect({ base, amount, ink, ok: ratio >= 4.5, ratio: Number(ratio.toFixed(2)) }).toEqual({
          base,
          amount,
          ink,
          ok: true,
          ratio: Number(ratio.toFixed(2)),
        });
      }
    }
    const css = readFileSync(join(ROOT, "web/src/features/tasks/tasks.css"), "utf8");
    expect(css).toContain("color: var(--task-ink, var(--on-brand))");
    expect(css).not.toContain("color: #fff;");
  });

  // L'encre d'une carte matière est choisie sur le FOND COMPOSÉ (teinte +
  // éclaircissement), pas sur la teinte seule. Elle sert aussi de couleur au
  // sujet dans la ligne de devoir, donc elle doit tenir sur `surface` aussi.
  test("cartes matière : encre ≥ 4.5:1 sur le fond composé", () => {
    const subjects = Array.from({ length: 64 }, (_, index) => `MATIERE ${index}`);
    expect(new Set(subjects.map(subjectColor)).size).toBe(20);
    for (const scheme of SCHEMES) {
      for (const mode of ["light", "dark"] as const) {
        const palette = scheme[mode];
        for (const subject of subjects) {
          const card = subjectPalette(subject, mode === "dark");
          for (const [support, background] of [
            ["carte", card.background],
            ["surface", palette.surface],
          ] as const) {
            const ratio = contrast(card.ink, background);
            expect({
              scheme: scheme.id,
              mode,
              subject,
              support,
              ink: card.ink,
              ok: ratio >= 4.5,
              ratio: Number(ratio.toFixed(2)),
            }).toEqual({
              scheme: scheme.id,
              mode,
              subject,
              support,
              ink: card.ink,
              ok: true,
              ratio: Number(ratio.toFixed(2)),
            });
          }
        }
      }
    }
    const home = readFileSync(join(ROOT, "web/src/features/home/HomeScreen.tsx"), "utf8");
    const timetable = readFileSync(join(ROOT, "web/src/features/timetable/TimetableScreen.tsx"), "utf8");
    expect(home).toContain("subjectPalette(");
    expect(timetable).toContain("subjectPalette(");
  });

  // Les tuiles de réglages posent leur encre sur une teinte composée avec la
  // page et l'encre de la palette. L'encre garde 30 % de la base pour la
  // teinte, sans repasser sous 4.5:1 sur le fond composé.
  test("tuiles réglages : encre ≥ 4.5:1 sur le fond composé", () => {
    const css = readFileSync(join(ROOT, "web/src/features/settings/settings.css"), "utf8");
    const backgroundRule =
      /background:\s*color-mix\(in srgb, var\(--tile-base, var\(--brand\)\)\s+(\d+)%,\s*var\(--page\)\)/.exec(css);
    const inkRule =
      /color:\s*color-mix\(in srgb, var\(--tile-base, var\(--brand\)\)\s+(\d+)%,\s*var\(--ink\)\)/.exec(css);
    expect(backgroundRule).not.toBeNull();
    expect(inkRule).not.toBeNull();
    const backgroundWeight = Number(backgroundRule?.[1]) / 100;
    const inkWeight = Number(inkRule?.[1]) / 100;
    const bases = [...css.matchAll(/--tile-base:\s*(#[0-9a-fA-F]{6});/g)].map((match) => match[1]!);
    expect(bases).toHaveLength(4);
    for (const scheme of SCHEMES) {
      for (const mode of ["light", "dark"] as const) {
        const palette = scheme[mode];
        // `--brand` est le repli d'une tuile sans modificateur de teinte.
        for (const base of [...bases, palette.brand]) {
          const background = mix(base, palette.page, backgroundWeight);
          const ink = mix(base, palette.ink, inkWeight);
          const ratio = contrast(ink, background);
          expect({
            scheme: scheme.id,
            mode,
            base,
            ink,
            ok: ratio >= 4.5,
            ratio: Number(ratio.toFixed(2)),
          }).toEqual({
            scheme: scheme.id,
            mode,
            base,
            ink,
            ok: true,
            ratio: Number(ratio.toFixed(2)),
          });
        }
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
