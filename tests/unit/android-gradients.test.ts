// Miroir #262 (dégradés légers) : les voiles sont des compositions
// `Transparent -> surface à alpha` posées SUR le fond opaque des cartes, donc
// ce qu'il faut mesurer, c'est l'encre contre le fond voilé — jamais à l'œil.
//
// Dérive assumée (comme `android-papillon-theme.test.ts`) : le miroir duplique
// `tint`/`over`/luminance au lieu de partager le Kotlin — un JVM ne tourne pas
// dans `bun test`. Le garde-fou réel reste `make android-compile` + la relecture
// des constantes ci-dessous, lues DANS le fichier Kotlin (regex, pas recopiées).
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const read = (name: string): string => readFileSync(join(UI, name), "utf8");

type Rgb = { r: number; g: number; b: number; a: number };
const color8 = (r: number, g: number, b: number, a = 1): Rgb => ({ r: r / 255, g: g / 255, b: b / 255, a });
const hex8 = (h: string): Rgb => color8(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));

function tsTint(color: Rgb, p: number): Rgb {
  const amount = Math.min(1, Math.abs(p));
  const towardWhite = p >= 0;
  const channel = (v: number): number => (towardWhite ? v + (1 - v) * amount : v - v * amount);
  return { r: channel(color.r), g: channel(color.g), b: channel(color.b), a: color.a };
}

function tsLuminance(color: Rgb): number {
  const linear = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function tsContrast(a: Rgb, b: Rgb): number {
  const la = tsLuminance(a);
  const lb = tsLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

/** Composition d'un voile semi-transparent sur son fond : ce que le moteur rend. */
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => ({
  r: fg.r * alpha + bg.r * (1 - alpha),
  g: fg.g * alpha + bg.g * (1 - alpha),
  b: fg.b * alpha + bg.b * (1 - alpha),
  a: 1,
});

const GREEN = hex8("#29947A");
const INK = hex8("#1F292E");
const SURFACE = hex8("#FFFFFF");
const SURFACE_VARIANT = hex8("#F3F6F7");
const DARK_SURFACE = hex8("#121212");
const DARK_SURFACE_VARIANT = hex8("#2B2B2B");

const PALETTE = [
  "#C50017", "#DA2400", "#DD6B00", "#E8901C", "#E8B048",
  "#6BAE00", "#37BB12", "#12BB67", "#26B290", "#26ABB2",
  "#2DB9D8", "#009EC5", "#007FDA", "#3A56D0", "#7600CA",
  "#962DD8", "#B300CA", "#C50066", "#DD004A", "#DD0030",
];

/** `const val X = 0.08f` lu dans le Kotlin, jamais recopié. */
function readConst(src: string, name: string): number {
  const m = src.match(new RegExp(`const val ${name} = (-?[\\d.]+)f`));
  if (!m) throw new Error(`constante ${name} introuvable dans PapComponents.kt`);
  return parseFloat(m[1]!);
}

const tsSubjectSurface = (hex: string, dark: boolean): Rgb =>
  tsTint(hex8(hex), dark ? -0.6 : 0.75);
const tsSubjectContent = (hex: string, dark: boolean): Rgb =>
  tsTint(hex8(hex), dark ? 0.55 : -0.45);

describe("unit android dégradés légers (#262)", () => {
  const pap = read("PapComponents.kt");

  test("alphas plafonnés : cartes 8 %, en-têtes 4 %, lus dans le Kotlin", () => {
    expect(readConst(pap, "COURSE_SCRIM_ALPHA")).toBeLessThanOrEqual(0.08);
    expect(readConst(pap, "WIDGET_HEADER_SCRIM_ALPHA")).toBeLessThanOrEqual(0.04);
    const heroTint = readConst(pap, "HERO_DARK_TINT");
    expect(heroTint).toBeLessThan(0);
    expect(Math.abs(heroTint)).toBeLessThanOrEqual(1);
  });

  test("cartes cours/accueil : encre ≥ 4.5:1 sur fond voilé, 20 couleurs × 2 thèmes", () => {
    const alpha = readConst(pap, "COURSE_SCRIM_ALPHA");
    let worst = 99;
    let worstAt = "";
    for (const dark of [false, true]) {
      const surface = dark ? DARK_SURFACE : SURFACE;
      for (const hex of PALETTE) {
        const bg = tsSubjectSurface(hex, dark);
        const ink = tsSubjectContent(hex, dark);
        // Bas du voile : le fond glissé de `alpha` vers la surface.
        const bottom = over(surface, bg, alpha);
        const ratio = Math.min(tsContrast(ink, bg), tsContrast(ink, bottom));
        if (ratio < worst) {
          worst = ratio;
          worstAt = `${hex} sombre=${dark}`;
        }
        expect(ratio).toBeGreaterThanOrEqual(4.5);
      }
    }
    // Preuve chiffrée, pas à l'œil : le pire cas reste au-dessus d'AA.
    expect(worst).toBeGreaterThanOrEqual(4.5);
  });

  test("en-tête widget : 4 % vers surfaceVariant, encre secondaire intacte", () => {
    const alpha = readConst(pap, "WIDGET_HEADER_SCRIM_ALPHA");
    const bottom = over(SURFACE_VARIANT, SURFACE, alpha);
    // L'en-tête porte l'encre secondaire sur `surface` ; à 4 % le fond ne bouge
    // presque pas — l'encre la plus sûre (INK) doit garder une marge énorme.
    expect(tsContrast(INK, bottom)).toBeGreaterThanOrEqual(4.5);
  });

  test("héro sombre : vers le noir, jamais un pastel qui brûle", () => {
    const heroTint = readConst(pap, "HERO_DARK_TINT");
    const top = tsTint(GREEN, heroTint);
    const lum = tsLuminance(top);
    // Bien sous tout pastel : un aplat clair serait à 0.5 et plus.
    expect(lum).toBeLessThanOrEqual(0.06);
    // Mais au-dessus de la surface sombre : le dégradé se voit, vers le bas.
    expect(lum).toBeGreaterThan(tsLuminance(DARK_SURFACE));
    // Le haut clair est le GreenPale du thème (94 % vers le blanc), lu en miroir.
    const pale = tsTint(GREEN, 0.94);
    expect(tsContrast(pale, SURFACE_VARIANT)).toBeGreaterThanOrEqual(1);
  });

  test("câblage : les 4 fichiers portent le dégradé, tokens #261 intacts", () => {
    expect(read("GradesHero.kt")).toContain("heroGradientTop");
    expect(read("GradesHero.kt")).toContain("Brush.verticalGradient");
    expect(read("TimetableCourseCard.kt")).toContain("cardScrim(surface, COURSE_SCRIM_ALPHA)");
    expect(read("HomeCards.kt")).toContain("cardScrim(MaterialTheme.colorScheme.surface, COURSE_SCRIM_ALPHA)");
    expect(read("HomeCards.kt")).toContain("cardScrim(MaterialTheme.colorScheme.surfaceVariant, WIDGET_HEADER_SCRIM_ALPHA)");
    expect(pap).toContain("fun cardScrim(");
    expect(pap).toContain("fun heroGradientTop(");
    // Tokens de #261 en lecture seule : aucun voile ne vit dans le thème.
    expect(read("PapillonTheme.kt")).not.toContain("Scrim");
    expect(read("PapillonTheme.kt")).not.toContain("scrim");
    // Pas de dégradé plein écran : aucun des 4 fichiers ne voile un fillMaxSize
    // (commentaires stripés : `HomeCards.kt` cite `fillMaxSize` dans son
    // historique #143, ce n'est pas un modifier).
    for (const f of ["GradesHero.kt", "TimetableCourseCard.kt", "HomeCards.kt", "PapComponents.kt"]) {
      const code = read(f).split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");
      expect(code).not.toContain("fillMaxSize");
    }
  });
});
