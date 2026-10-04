// Miroir TS de la logique pure de PapillonTheme.kt — `tint` (l'`adjustColor` de
// papillon.bzh), `subjectSurface`/`subjectContent`, luminance et rapport de
// contraste WCAG, `bestContentOn`. Les couleurs sont des `Color(0xAARRGGBB)`
// et des flottants, donc aucun hex n'est ré-analysé : le miroir travaille en
// fraction 0..1 comme le Kotlin.
//
// Dérive assumée : ce fichier duplique le calcul Kotlin au lieu de le partager —
// un JVM ne tourne pas dans `bun test`. Le seul garde-fou réel est le test Kotlin
// ci-dessous qui relit PapillonTheme.kt (jetons, constantes, absence de
// dépendance) PLUS `make android-compile` qui compile le vrai fichier. Tout ce
// que le miroir ne voit pas : une résolution de symbole, une surcharge ambiguë,
// un `Color(0x...)` mal typé. Upgrade: golden test Gradle (testDebugUnitTest)
// si le miroir devient un poids.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const UI = join(import.meta.dir, "..", "..", "android/ui/src/main/java/fr/veryslopnynotes/ui");
const APP = join(import.meta.dir, "..", "..", "android/app/src/main/java/fr/veryslopnynotes/app");

// --- Miroir de PapillonTheme.kt ---
type Rgb = { r: number; g: number; b: number; a: number };

const color8 = (r: number, g: number, b: number, a = 1): Rgb => ({ r: r / 255, g: g / 255, b: b / 255, a });
const hex8 = (h: string): Rgb => color8(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));
const WHITE = color8(255, 255, 255);

/** Compose `Color(red, green, blue, alpha)` : flottants 0..1, AUCUN arrondi 8 bits. */
function tsTint(color: Rgb, p: number): Rgb {
  const amount = Math.min(1, Math.abs(p));
  const towardWhite = p >= 0;
  const channel = (v: number): number => (towardWhite ? v + (1 - v) * amount : v - v * amount);
  return { r: channel(color.r), g: channel(color.g), b: channel(color.b), a: color.a };
}

const HEX = /^#[0-9a-fA-F]{6}$/;
/** Renvoie null si le hex est absent ou mal formé — jamais de couleur inventée. */
function tsTintHex(hex: string, p: number): Rgb | null {
  if (!HEX.test(hex)) return null;
  return tsTint(hex8(hex), p);
}

// Miroir de `PapillonTheme.kt` : les quatre pas de matière sont SENSIBLES au
// thème (#179) — un pas unique ne peut pas servir les deux, les directions
// étant opposées (assombrir une couleur pour un fond clair, l'éclaircir pour un
// fond sombre). Les constantes ci-dessous relisent les `const val` du Kotlin.
const SUBJECT_SURFACE_TINT = 0.75;
const SUBJECT_SURFACE_DARK_TINT = -0.6;
const SUBJECT_CONTENT_LIGHT_TINT = -0.45;
const SUBJECT_CONTENT_DARK_TINT = 0.55;

/** `subjectSurface(hex, dark)` : le fond de carte matière du thème demandé. */
const tsSubjectSurface = (hex: string, dark = false): Rgb | null =>
  tsTintHex(hex, dark ? SUBJECT_SURFACE_DARK_TINT : SUBJECT_SURFACE_TINT);
/** `subjectContent(hex, dark)` : l'encre matière du thème demandé. */
const tsSubjectContent = (hex: string, dark = false): Rgb | null =>
  tsTintHex(hex, dark ? SUBJECT_CONTENT_DARK_TINT : SUBJECT_CONTENT_LIGHT_TINT);

function tsLuminance(color: Rgb): number {
  const linear = (v: number): number => (v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4));
  return 0.2126 * linear(color.r) + 0.7152 * linear(color.g) + 0.0722 * linear(color.b);
}

function tsContrast(a: Rgb, b: Rgb): number {
  const la = tsLuminance(a);
  const lb = tsLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}

const INK = hex8("#1F292E");
const tsBestContentOn = (background: Rgb): Rgb =>
  tsContrast(background, INK) >= tsContrast(background, WHITE) ? INK : WHITE;
// Miroir de `bestSubjectContentOn` (#179) : le fond d'une puce change avec son
// état (transparent au repos, `secondaryContainer` une fois sélectionnée) alors
// que le `secondaryContainer` sombre reste un aplat clair — on garde donc le pas
// du thème qui passe le mieux, mesuré contre le fond RÉEL.
const tsBestSubjectContentOn = (hex: string, background: Rgb): Rgb | null => {
  let best: Rgb | null = null;
  let bestRatio = -1;
  for (const candidate of [tsSubjectContent(hex, false), tsSubjectContent(hex, true)]) {
    if (!candidate) continue;
    const ratio = tsContrast(candidate, background);
    if (ratio > bestRatio) {
      bestRatio = ratio;
      best = candidate;
    }
  }
  return best;
};
// Miroir de `errorInk` (#146) : en thème sombre, le rouge d'`error` est éclairci
// de `ERROR_INK_TINT` vers le blanc — sinon 3.70:1 sur la surface `#121212`.
const ERROR_INK_TINT = 0.7;
const tsErrorInk = (error: Rgb, dark: boolean): Rgb => (dark ? tsTint(error, ERROR_INK_TINT) : error);

// Jetons Papillon, dans l'ordre du fichier Kotlin.
const GREEN = hex8("#29947A");
const GREEN_DEEP = hex8("#237E68");
const GREEN_PALE = tsTint(GREEN, 0.94);
const LIME = hex8("#BFE677");
const LIME_INK = hex8("#5A7821");
const DANGER = hex8("#DC1400");
const BORDER = hex8("#DCDCDC");
const SURFACE = hex8("#FFFFFF");
const SURFACE_VARIANT = hex8("#F3F6F7");
const SURFACE_CONTAINER = hex8("#F1F1F1");
const DARK_SURFACE = hex8("#121212");
const DARK_BACKGROUND = color8(0, 0, 0);
const SECONDARY_ALPHA = 0.65;

const PALETTE = [
  "#C50017", "#DA2400", "#DD6B00", "#E8901C", "#E8B048",
  "#6BAE00", "#37BB12", "#12BB67", "#26B290", "#26ABB2",
  "#2DB9D8", "#009EC5", "#007FDA", "#3A56D0", "#7600CA",
  "#962DD8", "#B300CA", "#C50066", "#DD004A", "#DD0030",
];

// Compose d'une encre semi-transparente sur son fond réel : c'est ce que fait
// le moteur, donc c'est ce qu'il faut mesurer (jamais la teinte brute).
const over = (fg: Rgb, bg: Rgb, alpha: number): Rgb => ({
  r: fg.r * alpha + bg.r * (1 - alpha),
  g: fg.g * alpha + bg.g * (1 - alpha),
  b: fg.b * alpha + bg.b * (1 - alpha),
  a: 1,
});

const readCode = (path: string): string =>
  readFileSync(path, "utf8").split("\n").map((l) => l.replace(/\/\/.*$/, "")).join("\n");

const rounded = (x: number): number => Math.round(x * 100) / 100;

describe("unit android thème Papillon (#134)", () => {
  test("tint : p>0 vers le blanc, p<0 vers le noir, monotone et borné", () => {
    // Bornes : p = ±1 donne exactement le noir et le blanc, jamais au-delà.
    for (const c of [GREEN, INK, hex8(PALETTE[0]), hex8(PALETTE[4])]) {
      expect({ c: tsTint(c, 1) }).toEqual({ c: WHITE });
      expect({ c: tsTint(c, -1) }).toEqual({ c: color8(0, 0, 0) });
    }
    // p = 0 est l'identité.
    expect(tsTint(GREEN, 0)).toEqual(GREEN);
    // Monotonie : vers le blanc, chaque canal croît et reste sous 1 ; vers le
    // noir, chaque canal décroît et reste > 0 tant que la couleur n'est pas noire.
    for (const base of [GREEN, hex8(PALETTE[11]), hex8(PALETTE[19])]) {
      const whites = [0, 0.25, 0.5, 0.75, 1].map((p) => tsTint(base, p));
      const blacks = [0, -0.25, -0.5, -0.75, -1].map((p) => tsTint(base, p));
      for (let i = 1; i < whites.length; i++) {
        for (const ch of ["r", "g", "b"] as const) {
          expect(whites[i]![ch]).toBeGreaterThanOrEqual(whites[i - 1]![ch]);
          expect(blacks[i]![ch]).toBeLessThanOrEqual(blacks[i - 1]![ch]);
        }
      }
      // Un canal déjà au maximum ne bouge plus (le lerp sature, il n'explose pas).
      expect(whites[whites.length - 1]!.g).toBe(1);
    }
    // Valeurs intermédiaires figées : une dérive de formule se voit ici.
    expect(rounded(tsTint(GREEN, 0.25).r)).toBe(0.37);
    expect(rounded(tsTint(GREEN, -0.5).r)).toBe(0.08);
    // |p| > 1 est ramené dans 0..1 : jamais de couleur hors noir/blanc.
    expect(tsTint(GREEN, 7)).toEqual(WHITE);
    expect(tsTint(GREEN, -7)).toEqual(color8(0, 0, 0));
  });

  test("tint : hex absent ou mal formé = null, jamais de couleur inventée", () => {
    for (const bad of ["", "#fff", "29947A", "#GGGGGG", "#29947A80", "rgb(1,2,3)"]) {
      expect({ bad, got: tsTintHex(bad, 0.5) }).toEqual({ bad, got: null });
      expect({ bad, surface: tsSubjectSurface(bad) }).toEqual({ bad, surface: null });
      expect({ bad, content: tsSubjectContent(bad) }).toEqual({ bad, content: null });
    }
    // Minuscules acceptées (le Kotlin compile sur la même regex insensible à la casse).
    expect(tsTintHex("#29947a", 0)).toEqual(tsTintHex("#29947A", 0));
  });

  test("palette matières : 20 couleurs, aucun doublon, toutes hex", () => {
    expect(PALETTE).toHaveLength(20);
    expect(new Set(PALETTE.map((h) => h.toUpperCase())).size).toBe(20);
    for (const h of PALETTE) expect({ h, ok: HEX.test(h) }).toEqual({ h, ok: true });
  });

  test("contraste : luminance WCAG (bornes) et paires texte/fond >= 4.5", () => {
    // Bornes de la formule : noir 0, blanc 1, et 21 pour le couple noir/blanc.
    expect(tsLuminance(color8(0, 0, 0))).toBe(0);
    expect(tsLuminance(WHITE)).toBe(1);
    expect(tsContrast(color8(0, 0, 0), WHITE)).toBeCloseTo(21, 4);
    expect(tsContrast(GREEN, GREEN)).toBe(1);

    // Thème CLAIR : toute paire où du TEXTE repose sur sa surface doit passer AA.
    const light = [
      ["onSurface/surface", INK, SURFACE],
      ["onBackground/background", INK, SURFACE],
      ["onSurfaceVariant/surface", over(INK, SURFACE, SECONDARY_ALPHA), SURFACE],
      ["onSecondary/secondary", WHITE, GREEN_DEEP],
      ["onSecondaryContainer/secondaryContainer", INK, GREEN_PALE],
      ["onPrimaryContainer/primaryContainer", GREEN_DEEP, GREEN_PALE],
      ["onError/error", WHITE, DANGER],
    ] as const;
    for (const [name, fg, bg] of light) {
      expect({ name, ratio: rounded(tsContrast(fg, bg)) >= 4.5 }).toEqual({ name, ratio: true });
    }
    // Thème SOMBRE : mêmes rôles, sur la surface #121212 et le fond #000000.
    const dark = [
      ["onSurface/surface", WHITE, DARK_SURFACE],
      ["onBackground/background", WHITE, DARK_BACKGROUND],
      ["onSurfaceVariant/surface", over(WHITE, DARK_SURFACE, SECONDARY_ALPHA), DARK_SURFACE],
      ["onSecondary/secondary", DARK_SURFACE, hex8("#48A98B")],
      ["onSecondaryContainer/secondaryContainer", INK, GREEN_PALE],
      ["onPrimaryContainer/primaryContainer", tsTint(GREEN, 0.7), tsTint(GREEN, -0.35)],
      ["onError/error", WHITE, DANGER],
      ["outline/surface (bordure)", tsTint(INK, 0.45), DARK_SURFACE],
    ] as const;
    for (const [name, fg, bg] of dark) {
      expect({ name, ratio: rounded(tsContrast(fg, bg)) >= 4.5 }).toEqual({ name, ratio: true });
    }

    // Papillon : le blanc sur le vert de marque mesure 3.74:1 — couleur
    // d'INTERFACE, WCAG 1.4.3 n'y vise que le texte de corps. AA exige donc
    // `onSurface` (14.84:1), pas `primary`, pour le texte.
    expect(rounded(tsContrast(WHITE, GREEN))).toBe(3.74);
    expect(rounded(tsContrast(INK, SURFACE))).toBe(14.84);
  });

  test("paires de marque assumées et figées : onPrimary/primary 3.74, onTertiary 3.57", () => {
    // Ces deux couples sont des valeurs RELEVÉES sur papillon.bzh : on ne les
    // remplace pas par un substitut qui passerait 4.5 et trahirait la marque.
    // Elles sont figées ici pour qu'un changement de formule se voie.
    expect(rounded(tsContrast(WHITE, GREEN))).toBe(3.74);
    expect(rounded(tsContrast(LIME_INK, LIME))).toBe(3.57);
    // Le vert clair ne TIENT PAS le blanc (2.87:1) : c'est pourquoi le rôle
    // `secondary` clair est le vert profond et le sombre prend une encre sombre.
    expect(rounded(tsContrast(WHITE, hex8("#48A98B")))).toBe(2.87);
    expect(rounded(tsContrast(DARK_SURFACE, hex8("#48A98B")))).toBe(6.53);
  });

  test("bestContentOn : choisit le côté le plus lisible, sur les 20 couleurs", () => {
    for (const h of PALETTE) {
      const bg = hex8(h);
      const ink = tsContrast(INK, bg);
      const white = tsContrast(WHITE, bg);
      const chosen = tsBestContentOn(bg);
      const isInk = chosen === INK;
      // Jamais un choix arbitraire : c'est bien l'argmax des deux côtés.
      expect({ h, chose: isInk ? "ink" : "white", argmax: ink >= white ? "ink" : "white" }).toEqual({
        h,
        chose: isInk ? "ink" : "white",
        argmax: ink >= white ? "ink" : "white",
      });
      // Et le côté écarté est réellement le moins bon.
      expect(Math.max(ink, white)).toBeGreaterThan(Math.min(ink, white));
    }
    // Le cas réel de l'écran Compétences (supprimé en #184) : du blanc en dur sur une puce jaune
    // tombait à 1.1:1 — `bestContentOn` choisit l'encre, à 7.59:1.
    const yellow = tsBestContentOn(hex8("#E8B048"));
    expect({ isWhite: yellow === WHITE, ratio: rounded(tsContrast(yellow, hex8("#E8B048"))) }).toEqual({
      isWhite: false,
      ratio: 7.59,
    });
    // Deux colors de la palette (#DD6B00, #007FDA) n'atteignent pas 4.5 :
    // ni le noir ni le blanc ne le peuvent. C'est documenté, pas masqué.
    const below = PALETTE.filter((h) => Math.max(tsContrast(INK, hex8(h)), tsContrast(WHITE, hex8(h))) < 4.5);
    expect(below.sort()).toEqual(["#007FDA", "#DD6B00"]);
  });

  test("carte matière : le nom de la matière se lit dans LES DEUX thèmes", () => {
    // #179 : le pas suit le fond. En clair le fond est le pastel de Papillon
    // (+75 %) et l'encre −45 % ; en sombre le fond s'assombrit (−60 %) et
    // l'encre s'éclaircit (+55 %). 4.5:1 sur les 20 couleurs, dans les deux.
    for (const dark of [false, true]) {
      let worst = { h: "", ratio: 21 };
      for (const h of PALETTE) {
        const bg = tsSubjectSurface(h, dark)!;
        const ink = tsSubjectContent(h, dark)!;
        const ratio = tsContrast(ink, bg);
        expect({ dark, h, ok: ratio >= 4.5 }).toEqual({ dark, h, ok: true });
        // Le fond de carte reste distinguable de la surface (une carte se voit).
        expect(tsContrast(bg, dark ? DARK_SURFACE : SURFACE)).toBeGreaterThan(1);
        if (ratio < worst.ratio) worst = { h, ratio };
      }
      // PIRE cas de chaque thème, figé : un changement de pas se voit ici.
      expect({ dark, h: worst.h, ratio: rounded(worst.ratio) }).toEqual(
        dark ? { dark, h: "#DD0030", ratio: 6.29 } : { dark, h: "#E8B048", ratio: 4.9 },
      );
    }
    // Le pas de Papillon (-15 %) ne suffirait pas en clair : 2.29:1 au pire.
    expect(rounded(Math.min(...PALETTE.map((h) => tsContrast(tsTintHex(h, -0.15)!, tsSubjectSurface(h)!)))))
      .toBe(2.3);
    // RÉGRESSION #179 : le pas UNIQUE d'avant (−45 % partout) ne passe NI la
    // carte sombre (1.17:1) NI la carte de devoir en thème sombre (1.30:1 sur
    // la surface #121212). Ces deux lignes échouent sur le code précédent.
    expect(rounded(Math.min(...PALETTE.map((h) => tsContrast(tsSubjectContent(h, false)!, tsSubjectSurface(h, true)!)))))
      .toBe(1.17);
    expect(rounded(Math.min(...PALETTE.map((h) => tsContrast(tsSubjectContent(h, false)!, DARK_SURFACE)))))
      .toBe(1.3);
  });

  test("carte matière : l'encre se lit sur la surface RÉELLE de chaque carte, dans les deux thèmes", () => {
    // Le fond n'est pas toujours `subjectSurface` : la carte de DEVOIR et le
    // widget d'accueil sont posés sur la `surface` du thème (#121212 en sombre,
    // blanc en clair), la rangée de note sur la `surfaceVariant`. L'encre doit
    // donc passer sur les trois, sans que l'appelant ait à choisir un pas.
    const surfaces: Array<[string, Rgb, Rgb]> = [
      ["surface", SURFACE, DARK_SURFACE],
      ["surfaceVariant", SURFACE_VARIANT, tsTint(DARK_SURFACE, 0.1)],
      ["background (rangée de puces)", SURFACE, DARK_BACKGROUND],
    ];
    for (const [name, light, dark] of surfaces) {
      for (const h of PALETTE) {
        const clair = tsContrast(tsSubjectContent(h, false)!, light);
        const sombre = tsContrast(tsSubjectContent(h, true)!, dark);
        expect({ name, h, clair: Math.round(clair * 100) / 100 >= 4.5 }).toEqual({
          name, h, clair: true,
        });
        expect({ name, h, sombre: Math.round(sombre * 100) / 100 >= 4.5 }).toEqual({
          name, h, sombre: true,
        });
      }
    }
    // Pires figés : le violet `#7600CA` sur la surface sombre (7.31:1) et sa
    // variante (`surfaceVariant`, 5.63:1) — les deux marches les plus courtes.
    let pireSurface = 99;
    let pireVariant = 99;
    for (const h of PALETTE) {
      pireSurface = Math.min(pireSurface, tsContrast(tsSubjectContent(h, true)!, DARK_SURFACE));
      pireVariant = Math.min(pireVariant, tsContrast(tsSubjectContent(h, true)!, tsTint(DARK_SURFACE, 0.1)));
    }
    expect({ pireSurface: rounded(pireSurface), pireVariant: rounded(pireVariant) }).toEqual({
      pireSurface: 7.31, pireVariant: 5.63,
    });
  });

  test("puce matière : l'encre est mesurée contre le fond réel de la puce", () => {
    // Au repos la puce est transparente sur le fond de l'écran (#FFFFFF en
    // clair, #000000 en sombre) ; sélectionnée elle prend le `secondaryContainer`
    // du thème, qui reste un APLAT CLAIR même en sombre. Un seul pas ne peut pas
    // passer les deux : `bestSubjectContentOn` mesure et choisit.
    const chips: Array<[string, Rgb]> = [
      ["clair/repos", SURFACE],
      ["clair/sélectionnée", GREEN_PALE],
      ["sombre/repos", DARK_BACKGROUND],
      ["sombre/sélectionnée", GREEN_PALE],
    ];
    for (const [name, bg] of chips) {
      for (const h of PALETTE) {
        const ink = tsBestSubjectContentOn(h, bg)!;
        expect({ name, h, ok: tsContrast(ink, bg) >= 4.5 }).toEqual({ name, h, ok: true });
      }
    }
    // RÉGRESSION #179 : la couleur BRUTE (ce que faisait la puce avant) tombe à
    // 1.83:1 au pire sur le vert pâle et 2.62:1 sur le fond sombre — le défaut
    // constaté (le jaune de la palette, lui, fait 1.96:1 sur le blanc).
    expect(rounded(Math.min(...PALETTE.map((h) => tsContrast(hex8(h), GREEN_PALE))))).toBe(1.83);
    expect(rounded(Math.min(...PALETTE.map((h) => tsContrast(hex8(h), DARK_BACKGROUND))))).toBe(2.62);
    // Puce sélectionnée en thème sombre : le pas sombre y est à 1.25:1, donc
    // c'est bien le pas CLAIR qui est choisi — la mesure tranche, pas le thème.
    expect(tsBestSubjectContentOn(PALETTE[4]!, GREEN_PALE)).toEqual(tsSubjectContent(PALETTE[4]!, false));
  });
});

describe("unit android thème Papillon — Kotlin (#134)", () => {
  test("jetons, schemes et câblage présents dans PapillonTheme.kt", () => {
    // Les commentaires `//` sont retirés partout : ce fichier explique en commentaire
    // ce qu'il supprime (le violet, le gris en dur, Dynamic Color), et ce texte
    // ne doit pas passer pour du code encore présent.
    const kt = readCode(join(UI, "PapillonTheme.kt"));
    // Couleurs de marque, une par une : un hex typoqué se voit ici.
    for (const hex of [
      "0xFF29947AL", "0xFF48A98BL", "0xFF237E68L", "0xFFBFE677L", "0xFF5A7821L",
      "0xFFDC1400L", "0xFF1F292EL", "0xFFDCDCDCL", "0xFFFFFFFFL", "0xFFF3F6F7L",
      "0xFFF1F1F1L", "0xFF121212L", "0xFF000000L",
    ]) {
      expect({ hex, found: kt.includes(hex) }).toEqual({ hex, found: true });
    }
    // Formes : 25 dp, la signature Papillon.
    expect(kt).toContain("extraLarge = 25.dp");
    // Typographie : 18 sp gras pour le titre, Roboto par le défaut système.
    expect(kt).toContain("titleLarge = papillonText(18, 22, FontWeight.Bold)");
    expect(kt).toContain("bodyLarge = papillonText(15, 21)");
    expect(kt).toContain("bodyMedium = papillonText(14, 20)");
    expect(kt).toContain("labelSmall = papillonText(13, 17)");
    expect(kt).toContain("fontFamily = FontFamily.SansSerif");
    // Helpers purs : signatures attendues par le miroir ci-dessus. `#179` : les
    // deux fonctions de matière portent le thème EN PARAMÈTRE (donc testables
    // sans Compose) et un raccourci `@Composable` qui le LIT dans le thème.
    for (const fn of [
      "fun tint(color: Color, p: Float): Color",
      "fun tint(hex: String, p: Float): Color?",
      "fun subjectSurface(hex: String, dark: Boolean): Color?",
      "fun subjectContent(hex: String, dark: Boolean): Color?",
      "fun relativeLuminance(color: Color): Float",
      "fun contrastRatio(a: Color, b: Color): Float",
      "fun bestContentOn(background: Color): Color",
      "fun bestSubjectContentOn(hex: String, background: Color): Color?",
    ]) {
      expect({ fn, found: kt.includes(fn) }).toEqual({ fn, found: true });
    }
    // Les raccourcis `@Composable` : le mode se LIT dans le thème, donc une
    // encre de matière ne peut pas être choisie pour le mauvais thème.
    expect(kt).toContain("fun subjectSurface(hex: String): Color? = subjectSurface(hex, isDarkSurface())");
    expect(kt).toContain("fun subjectContent(hex: String): Color? = subjectContent(hex, isDarkSurface())");
    // Les quatre pas qui portent les garanties de contraste, et le câblage qui
    // les rend sensibles au thème. Un pas unique figé échoue ici.
    for (const step of [
      "const val SUBJECT_SURFACE_TINT = 0.75f",
      "const val SUBJECT_SURFACE_DARK_TINT = -0.60f",
      "const val SUBJECT_CONTENT_LIGHT_TINT = -0.45f",
      "const val SUBJECT_CONTENT_DARK_TINT = 0.55f",
    ]) {
      expect({ step, found: kt.includes(step) }).toEqual({ step, found: true });
    }
    expect(kt).toContain("tint(hex, if (dark) SUBJECT_SURFACE_DARK_TINT else SUBJECT_SURFACE_TINT)");
    expect(kt).toContain("tint(hex, if (dark) SUBJECT_CONTENT_DARK_TINT else SUBJECT_CONTENT_LIGHT_TINT)");
    expect(kt).toContain("const val PapillonSecondaryAlpha = 0.65f");
    // Scheme : les deux modes, plus `MaterialTheme` complet (typo + formes).
    expect(kt).toContain("lightColorScheme(");
    expect(kt).toContain("darkColorScheme(");
    expect(kt).toContain("secondaryContainer = PapillonGreenPale");
    expect(kt).toContain("typography = PapillonTypography");
    expect(kt).toContain("shapes = PapillonShapes");
    expect(kt).toContain("fun PapillonTheme(darkTheme: Boolean, content: @Composable () -> Unit)");
    // Palette : les 20 matières, et AUCUNE couleur d'interface Material par
    // défaut ne doit survivre (le bug d'origine était le violet #6750A4).
    for (const h of PALETTE) expect({ h, found: kt.includes(`"${h}"`) }).toEqual({ h, found: true });
    expect(kt.includes("0xFF6750A4")).toBe(false);
    // Module : plus aucun scheme sans argument. Les commentaires `//` sont
    // retirés avant la recherche — AppNav.kt explique dans un commentaire
    // qu'il appelait justement ces deux fonctions sans argument, et ce texte ne
    // doit pas passer pour un appel.
    // #135 : les écrans sont sortis d'AppNav.kt — ils sont donc vérifiés aussi.
    for (const file of ["AppNav.kt", "AppShell.kt", "AppIcons.kt", "Theme.kt", "SubjectStyle.kt"]) {
      const src = readCode(join(UI, file));
      expect({ file, bare: /lightColorScheme\(\)|darkColorScheme\(\)/.test(src) }).toEqual({ file, bare: false });
    }
    // Racine : le thème est appliqué UNE fois, par PapillonTheme.
    const nav = readCode(join(UI, "AppNav.kt"));
    expect(nav).toContain("PapillonTheme(darkTheme = isDarkTheme(theme, isSystemInDarkTheme()))");
    expect(nav).not.toContain("import androidx.compose.material3.darkColorScheme");
    expect(nav).not.toContain("import androidx.compose.material3.lightColorScheme");
    // `AppTheme.values()` est déprécié : `entries` le remplace. #135 : les
    // réglages sont sortis d'AppNav.kt, donc l'appel est dans SettingsScreen.kt.
    const settings = readCode(join(UI, "SettingsScreen.kt"));
    expect(settings).toContain("AppTheme.entries");
    expect(nav + settings).not.toContain("AppTheme.values()");
    // MainActivity : plus de MaterialTheme extérieur, il écrasait le thème choisi.
    const activity = readCode(join(APP, "MainActivity.kt"));
    expect(activity).not.toContain("MaterialTheme");
    // TimetableWeek : le gris en dur (1.5:1) cède la place à une couleur de thème.
    const week = readCode(join(UI, "TimetableWeek.kt"));
    expect(week).not.toContain("Color.LightGray");
    expect(week).toContain("MaterialTheme.colorScheme.onSurfaceVariant");
    // ZÉRO dépendance ajoutée, et pas de fichier de police embarqué : la liste des
    // modules Gradle est FIGÉE (pas de « material3 reste le seul material » :
    // n'importe quelle ligne ajoutée fait échouer cette égalité). Roboto vient
    // de `FontFamily.SansSerif`, donc le dossier de ressources ne gagne aucun
    // .ttf/.otf.
    const uiGradle = readFileSync(join(import.meta.dir, "..", "..", "android/ui/build.gradle.kts"), "utf8");
    expect([...uiGradle.matchAll(/(?:implementation|api|platform)\("([^"]+)"\)/g)].map((m) => m[1]!).sort()).toEqual([
      "androidx.activity:activity-compose:1.9.2",
      "androidx.compose.material3:material3:1.2.1",
      "androidx.compose.ui:ui:1.6.8",
      "androidx.compose:compose-bom:2024.06.00",
      "androidx.navigation:navigation-compose:2.7.7",
      "com.journeyapps:zxing-android-embedded:4.3.0",
      "com.squareup.okhttp3:okhttp:4.12.0",
    ]);
    expect(uiGradle).not.toMatch(/\.(ttf|otf)\b/);
    // Compose épinglé : aucune API plus récente que material3 1.2.1 / BOM 2024.06.00.
    expect(uiGradle).toContain("compose-bom:2024.06.00");
    expect(uiGradle).toContain("material3:1.2.1");
    expect(uiGradle).toContain("kotlinCompilerExtensionVersion = \"1.5.14\"");
    expect(uiGradle).toContain("minSdk = 26");
    expect(uiGradle).toContain("compileSdk = 34");
    // Dynamic Color : existe en material3 1.2.1 mais VOLONTAIREMENT absent —
    // le vert Papillon est l'identité, la couleur du fond d'écran l'écraserait.
    expect(kt).not.toContain("dynamicLightColorScheme");
    expect(kt).not.toContain("dynamicDarkColorScheme");
    // #146 : la cible tactile du module, et l'encre d'erreur qui dépend du thème.
    expect(kt).toContain("val TouchTarget = 48.dp");
    expect(kt).toContain("const val ERROR_INK_TINT = 0.70f");
    expect(kt).toContain("fun errorInk(error: Color, dark: Boolean): Color = if (dark) tint(error, ERROR_INK_TINT) else error");
    expect(kt).toContain("fun errorTextColor(): Color = errorInk(MaterialTheme.colorScheme.error, isDarkSurface())");
  });

  // #179 : les deux passers du pas de matière — la pastille (`PapPill`, qui
  // reçoit une `Color` et non un hex) et la puce matière des devoirs. Un pas
  // figé sur +75 % / −45 % y poserait un aplat clair et une encre assombrie en
  // thème sombre : les deux sources sont donc vérifiées ici.
  test("les deux passers du pas de matière lisent les pas du thème", () => {
    const pill = readCode(join(UI, "PapComponents.kt"));
    expect(pill).toContain("val dark = isDarkSurface()");
    expect(pill).toContain("tint(color, if (dark) SUBJECT_SURFACE_DARK_TINT else SUBJECT_SURFACE_TINT)");
    expect(pill).toContain("tint(color, if (dark) SUBJECT_CONTENT_DARK_TINT else SUBJECT_CONTENT_LIGHT_TINT)");
    expect(pill).not.toContain("tint(color, .75f)");
    expect(pill).not.toContain("tint(color, -.45f)");
    // La puce matière : le fond est POSÉ (donc connu), l'encre MESURÉE contre.
    const tasks = readCode(join(UI, "Assignments.kt"));
    expect(tasks).toContain("bestSubjectContentOn(");
    // LE MÊME fond sert à la puce et à la mesure de l'encre (« picked ») : une
    // mesure faite sur un fond différent de celui qui est rendu ne prouve rien.
    expect(tasks).toContain("selectedContainerColor = picked");
    expect(tasks).toContain("if (isSelected) picked else resting");
    // La couleur BRUTE ne peut plus servir d'encre de texte : c'était 1.96:1.
    expect(tasks).not.toContain("colorFromHex(subjectColorHex(prefs, subject)) ?: LocalContentColor.current");
  });
});

// AUDIT DE CONTRASTE #146 — TOUTES les paires texte/fond que l'app utilise
// réellement, dans les DEUX thèmes. Avant, seules sept paires étaient mesurées
// et le reste de l'app pouvait écrire du texte en `primary` (3.74:1) ou en
// `error` (3.70:1 en sombre) sans qu'aucune vérification ne le voie. Chaque
// ligne ci-dessous est une paire RÉELLEMENT rendue : un rôle y entre comme
// `Text`, une surface de carte, un `primaryContainer` de bulle.
describe("unit android contraste (#146) — encre de texte, clair ET sombre", () => {
  test("toute paire texte/fond réelle du thème clair tient 4.5:1", () => {
    const pairs: Array<[string, Rgb, Rgb]> = [
      // Corps de texte sur les trois surfaces que l'app empile.
      ["onSurface/surface", INK, SURFACE],
      ["onSurface/surfaceVariant", INK, SURFACE_VARIANT],
      ["onSurfaceVariant/surface", over(INK, SURFACE, SECONDARY_ALPHA), SURFACE],
      ["onSurfaceVariant/surfaceVariant", over(INK, SURFACE_VARIANT, SECONDARY_ALPHA), SURFACE_VARIANT],
      ["onSurfaceVariant/surfaceContainerLow", over(INK, tsTint(SURFACE_CONTAINER, 0.35), SECONDARY_ALPHA), tsTint(SURFACE_CONTAINER, 0.35)],
      // Accent de TEXTE : c'est `secondary` (le vert profond), PAS `primary`.
      ["secondary/surface", GREEN_DEEP, SURFACE],
      ["secondary/surfaceVariant", GREEN_DEEP, SURFACE_VARIANT],
      ["secondary/surfaceContainerLow", GREEN_DEEP, tsTint(SURFACE_CONTAINER, 0.35)],
      ["secondary/primaryContainer", GREEN_DEEP, GREEN_PALE],
      // Encre d'erreur en texte : le rouge de marque en clair, éclairci en sombre.
      ["errorInk/surface", DANGER, SURFACE],
      ["errorInk/surfaceVariant", DANGER, SURFACE_VARIANT],
      // Conteneurs.
      ["onPrimaryContainer/primaryContainer", GREEN_DEEP, GREEN_PALE],
      ["onSecondaryContainer/secondaryContainer", INK, GREEN_PALE],
    ];
    for (const [name, fg, bg] of pairs) {
      expect({ name, ratio: rounded(tsContrast(fg, bg)) >= 4.5 }).toEqual({ name, ratio: true });
    }
    // Les deux valeurs qui portent le choix : `primary` ne tient PAS en texte,
    // `secondary` tient. C'est ce qui a fait migrer les libellés.
    expect(rounded(tsContrast(GREEN, SURFACE))).toBe(3.74);
    expect(rounded(tsContrast(GREEN, SURFACE_VARIANT))).toBe(3.45);
    expect(rounded(tsContrast(GREEN_DEEP, SURFACE))).toBe(4.93);
    // ÉCART ASSUMÉ, pas un oubli : le blanc sur le vert de marque mesure 3.74:1.
    // C'est la valeur relevée sur papillon.bzh, figée par le miroir de #133, et
    // elle ne sert qu'aux libellés de BOUTON (large surface, pas du texte de
    // lecture). Le seuil applicable à un bouton plein est 3:1 (WCAG 1.4.11) :
    // mesuré, il passe. Passer à 4.5 obligerait à assombrir le vert de marque.
    expect({ ok: rounded(tsContrast(WHITE, GREEN)) >= 3 }).toEqual({ ok: true });
  });

  test("la même paire, thème sombre : `error` seul ne passerait pas", () => {
    const darkPairs: Array<[string, Rgb, Rgb]> = [
      ["onSurface/surface", WHITE, DARK_SURFACE],
      ["onSurfaceVariant/surface", over(WHITE, DARK_SURFACE, SECONDARY_ALPHA), DARK_SURFACE],
      ["onSurfaceVariant/surfaceVariant", over(WHITE, tsTint(DARK_SURFACE, 0.1), SECONDARY_ALPHA), tsTint(DARK_SURFACE, 0.1)],
      ["secondary/surface", hex8("#48A98B"), DARK_SURFACE],
      ["secondary/surfaceVariant", hex8("#48A98B"), tsTint(DARK_SURFACE, 0.1)],
      ["errorInk/surface", tsErrorInk(DANGER, true), DARK_SURFACE],
      ["errorInk/surfaceVariant", tsErrorInk(DANGER, true), tsTint(DARK_SURFACE, 0.1)],
      ["onPrimaryContainer/primaryContainer", tsTint(GREEN, 0.7), tsTint(GREEN, -0.35)],
      ["onSecondaryContainer/secondaryContainer", INK, GREEN_PALE],
    ];
    for (const [name, fg, bg] of darkPairs) {
      expect({ name, ratio: rounded(tsContrast(fg, bg)) >= 4.5 }).toEqual({ name, ratio: true });
    }
    // LE DÉFAUT CORRIGÉ : `error` en texte de 13-14 sp sur la surface sombre.
    expect({ ratio: rounded(tsContrast(DANGER, DARK_SURFACE)) }).toEqual({ ratio: 3.7 });
    expect({ ratio: rounded(tsContrast(tsErrorInk(DANGER, true), DARK_SURFACE)) }).toEqual({ ratio: 11.07 });
  });

  test("matière : l'encre de la pastille, de la puce et de la carte, sur 20 couleurs", () => {
    // Les trois surfaces matière de l'app — carte de cours, pastille de note
    // (`PapPill`), puce de compétence (`chipSurfaceColor`) — et les DEUX encres
    // possibles : `subjectContent` (le pas mesuré du thème) et `bestContentOn`
    // (l'argmax du thème). Sur les 20, dans les DEUX thèmes (#179) : la pastille
    // porte le même couple de pas que la carte, inversé en sombre.
    for (const dark of [false, true]) {
      for (const h of PALETTE) {
        const raw = hex8(h);
        const surface = tsSubjectSurface(h, dark)!;
        const content = tsSubjectContent(h, dark)!;
        // `PapPill` prend une `Color`, pas un hex : c'est le MÊME couple de pas.
        const pillSurface = tsTint(raw, dark ? SUBJECT_SURFACE_DARK_TINT : SUBJECT_SURFACE_TINT);
        const pillInk = tsTint(raw, dark ? SUBJECT_CONTENT_DARK_TINT : SUBJECT_CONTENT_LIGHT_TINT);
        const page = dark ? DARK_BACKGROUND : SURFACE;
        const cases: Array<[string, number]> = [
          ["subjectContent/subjectSurface", tsContrast(content, surface)],
          ["PapPill encre/fond", tsContrast(pillInk, pillSurface)],
          ["bestContentOn/pastille", tsContrast(tsBestContentOn(pillSurface), pillSurface)],
          ["bestContentOn/surface (carte annulée)", tsContrast(tsBestContentOn(page), page)],
        ];
        for (const [name, ratio] of cases) {
          expect({ dark, h, name, ok: ratio >= 4.5 }).toEqual({ dark, h, name, ok: true });
        }
      }
    }
    // `PapPill` ne reçoit pas qu'une couleur de matière : `error` (pastille
    // « absent », « Annulé ») et `primary` (pastille « en cours », compteur de
    // messages) passent par le même couple de pas, dans les deux thèmes.
    for (const base of [DANGER, GREEN]) {
      for (const dark of [false, true]) {
        const bg = tsTint(base, dark ? SUBJECT_SURFACE_DARK_TINT : SUBJECT_SURFACE_TINT);
        const fg = tsTint(base, dark ? SUBJECT_CONTENT_DARK_TINT : SUBJECT_CONTENT_LIGHT_TINT);
        expect({ dark, ok: tsContrast(fg, bg) >= 4.5 }).toEqual({ dark, ok: true });
      }
    }
    // `PapSubjectAvatar` est décorée à 31 % AU-DESSUS de la carte et n'y porte
    // QU'UN glyphe : elle n'est donc pas dans la liste ci-dessus, et c'est
    // VOLONTAIRE. Son fond se mesure à 3.86:1 au pire (`#C50066`) — sous AA, donc
    // elle ne peut pas porter de texte, ce que #146 lui impose : l'emoji y est
    // sorti de l'arbre de sémantique (`clearAndSetSemantics`) et le LIBELLÉ est
    // toujours affiché à côté. C'est ce couple — glyphe + libellé écrit — qui
    // rend la matière identifiable ; la pastille n'est qu'un rappel visuel. Le
    // garde-fou correspondant est dans `android-accesibilite.test.ts`
    // (« la légende matière porte une pastille ET un libellé écrit »).
    let worst = { h: "", ratio: 99 };
    for (const h of PALETTE) {
      // Le meilleur des deux côtés sur le fond à 31 % : c'est le plafond que
      // `bestContentOn` atteint, donc la limite réelle de cette pastille.
      const bg = tsTint(hex8(h), 0.31);
      const best = Math.max(tsContrast(INK, bg), tsContrast(WHITE, bg));
      if (best < worst.ratio) worst = { h, ratio: best };
    }
    expect({ h: worst.h, ratio: rounded(worst.ratio) }).toEqual({ h: "#C50066", ratio: 3.86 });
  });

  test("cours annulé : l'encre rouge du thème sur le rouge pâle, mesurée", () => {
    // `cancelledSurface` / `cancelledInk` (TimetableCourseCard.kt) : le rouge
    // clairci à 82 % porte une encre rouge assombrie à −45 % ; en thème sombre
    // l'ordre s'inverse. 4.5:1 des deux côtés, sinon « Annulé » n'est pas lu.
    const clearSurface = tsTint(DANGER, 0.82)!;
    const clearInk = tsTint(DANGER, -0.45)!;
    const darkSurface = tsTint(DANGER, -0.6)!;
    const darkInk = tsTint(DANGER, 0.72)!;
    expect({ ok: tsContrast(clearInk, clearSurface) >= 4.5 }).toEqual({ ok: true });
    expect({ ok: tsContrast(darkInk, darkSurface) >= 4.5 }).toEqual({ ok: true });
  });

  test("carte matière : le fond reste distinguable de la surface, dans les deux thèmes", () => {
    // Un aplat à 1.02:1 de la surface rendrait la carte invisible — le contraste
    // du TEXTE est inutile si la CARTE ne se voit plus. En sombre (#179) le fond
    // est assombri au lieu d'être éclairci : il reste donc loin du blanc.
    for (const dark of [false, true]) {
      for (const h of PALETTE) {
        const bg = tsSubjectSurface(h, dark)!;
        const page = dark ? DARK_SURFACE : SURFACE;
        expect({ dark, h, visible: tsContrast(bg, page) > 1 }).toEqual({ dark, h, visible: true });
      }
    }
    // Pire cas sombre figé : le violet `#7600CA` à 1.11:1 de la surface — le même
    // écart que le pastel clair à 1.07:1 du blanc, la symétrie du pas.
    let pire = 99;
    for (const h of PALETTE) pire = Math.min(pire, tsContrast(tsSubjectSurface(h, true)!, DARK_SURFACE));
    expect({ pire: rounded(pire) }).toEqual({ pire: 1.11 });
    // Et le fond sombre ne peut pas être un aplat CLAIR : c'était le défaut
    // visible (pastel à +75 % sur fond noir, encre assombrie dessus).
    for (const h of PALETTE) {
      expect(tsLuminance(tsSubjectSurface(h, true)!)).toBeLessThan(0.5);
    }
    // `primaryContainer` (bandeau « périmé », pastille d'onglet) est à 1.07:1 du
    // blanc : c'est le PRIX de son pas (94 % vers le blanc, le plus clair qui
    // garde 4.61:1 pour l'encre — cf. le KDoc de `PapillonGreenPale`). Un aplat
    // décoratif n'est pas un composant d'interface à BORDURE (WCAG 1.4.11 vise les
    // contours d'INTERACTION) : c'est le texte du bandeau qui le rend lisible,
    // et il tient 4.61:1. La valeur est FIGÉE ici pour qu'un changement de pas
    // se voie.
    expect({ frozen: rounded(tsContrast(GREEN_PALE, SURFACE)) }).toEqual({ frozen: 1.07 });
    expect({ ink: rounded(tsContrast(GREEN_DEEP, GREEN_PALE)) >= 4.5 }).toEqual({ ink: true });
  });
});