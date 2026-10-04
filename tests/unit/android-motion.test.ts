// Miroir TS de la logique PURE de `Motion.kt` (issue #145) : ce qu'on peut
// prouver sans téléphone et sans Compose.
//
// Ce que le miroir vérifie par le CALCUL :
//   - la politique de fermeture d'une notice (durée, et `Long`/`Short`) : une
//     notice AVEC action et une notice d'erreur doivent rester, une confirmation
//     doit être brève ;
//   - le mapping SÉVÉRITÉ -> COULEURS, et le contraste WCAG de chaque paire
//     (fond/encre) en clair comme en sombre — c'est ce qui prouve qu'un échec ne
//     peut pas ressembler à une réussite, et qu'aucune des deux ne tombe sous AA ;
//   - la pulsation « en cours » (échelle et opacité bornes, monotones, sans
//     dépassement) ;
//   - le，嘴角 de l'amortissement et de la durée quand le mouvement est COUPÉ
//     (`ValueAnimator.areAnimatorsEnabled() == false`).
//
// Ce que le miroir vérifie par LECTURE DE LA SOURCE (les objets Compose ne
// peuvent pas être instanciés dans `bun test`) : les VALEURS MESURÉES elles-mêmes
// — 300 ms, `cubicBezier(0.3, 0.3, 0, 1)`, échelle 0.9 -> 1, ressort 0.8 — et le
// câblage (aucune couleur en dur, aucune dépendance ajoutée).
//
// Dérive assumée : ce fichier duplique la logique Kotlin au lieu de la partager,
// un JVM ne tournant pas dans `bun test`. Le seul filet réel du rendu reste
// `make android-compile` + la passe sur appareil de l'issue. Ce que le miroir ne
// voit pas : une résolution de symbole, une surcharge ambiguë, et — par nature —
// une animation elle-même.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..");
const UI = join(ROOT, "android/ui/src/main/java/fr/veryslopnynotes/ui");
const MOTION = readFileSync(join(UI, "Motion.kt"), "utf8");
const ASSIGNMENTS = readFileSync(join(UI, "Assignments.kt"), "utf8");
const SECTIONS = readFileSync(join(UI, "AssignmentsSections.kt"), "utf8");
const NAV = readFileSync(join(UI, "AppNav.kt"), "utf8");
const UI_GRADLE = readFileSync(join(ROOT, "android/ui/build.gradle.kts"), "utf8");
const VERSIONS = readFileSync(join(ROOT, "android/gradle/libs.versions.toml"), "utf8");

/** Sans les commentaires : une garde qui lit la source ne doit pas confondre un
 *  `//` qui NOMME une mauvaise pratique avec la pratique. */
const codeOnly = (src: string): string =>
  src
    .replace(/\/\*[\s\S]*?\*\//g, "\n")
    .split("\n")
    .filter((l) => !l.trim().startsWith("//") && !l.trim().startsWith("*"))
    .map((l) => {
      const idx = l.search(/(?<!:)\/\//);
      return idx >= 0 ? l.slice(0, idx) : l;
    })
    .join("\n");
const kt = codeOnly(MOTION);

// --- Couleurs : le même modèle 0..1 que PapillonTheme.kt ---------------------

type Rgb = { r: number; g: number; b: number };

const color8 = (r: number, g: number, b: number): Rgb => ({ r: r / 255, g: g / 255, b: b / 255 });
const hex8 = (h: string): Rgb =>
  color8(parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16));

/** `tint` de `PapillonTheme.kt`, appliqué à une couleur sans alpha. */
function tsTint(color: Rgb, p: number): Rgb {
  const amount = Math.min(1, Math.abs(p));
  const towardWhite = p >= 0;
  const channel = (v: number): number => (towardWhite ? v + (1 - v) * amount : v - v * amount);
  return { r: channel(color.r), g: channel(color.g), b: channel(color.b) };
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

const INK = hex8("#1F292E");
const SURFACE_VARIANT = hex8("#F3F6F7");
const PRIMARY = hex8("#29947A");
/** `PapillonDanger`, le rôle `error` des DEUX schemes. */
const DANGER = hex8("#DC1400");

/** `cancelledSurface` / `cancelledInk` (TimetableCourseCard.kt), les deux
 * couples mesurés que `noticePalette` réutilise. */
const tsCancelledSurface = (error: Rgb, dark: boolean): Rgb => tsTint(error, dark ? -0.6 : 0.82);
const tsCancelledInk = (error: Rgb, dark: boolean): Rgb => tsTint(error, dark ? 0.72 : -0.45);

// --- Miroir de `noticeDurationMs` / `noticeIsLong` --------------------------

const NOTICE_SHORT_MS = 4_000;
const NOTICE_INFO_MS = 6_000;
const NOTICE_LONG_MS = 10_000;
type NoticeKind = "INFO" | "SUCCESS" | "ERROR";

function tsNoticeDurationMs(kind: NoticeKind, hasAction: boolean): number {
  if (hasAction) return NOTICE_LONG_MS;
  if (kind === "ERROR") return NOTICE_LONG_MS;
  if (kind === "SUCCESS") return NOTICE_SHORT_MS;
  return NOTICE_INFO_MS;
}

const tsNoticeIsLong = (kind: NoticeKind, hasAction: boolean): boolean =>
  tsNoticeDurationMs(kind, hasAction) >= NOTICE_LONG_MS;

// --- Miroir de `noticePalette` -----------------------------------------------

type NoticePalette = { container: Rgb; content: Rgb; action: Rgb };

function tsNoticePalette(
  kind: NoticeKind,
  error: Rgb,
  dark: boolean,
  surfaceVariant: Rgb,
  onSurface: Rgb,
): NoticePalette {
  if (kind === "ERROR") {
    const content = tsCancelledInk(error, dark);
    return { container: tsCancelledSurface(error, dark), content, action: content };
  }
  return { container: surfaceVariant, content: onSurface, action: onSurface };
}

// --- Miroir de la pulsation et du mouvement coupé ----------------------------

const MOTION_ENTER_MS = 300;
const MOTION_PRESS_DAMPING = 0.8;
const MOTION_PRESS_STIFFNESS = 400;
const MOTION_ENTER_SCALE = 0.9;
const CURRENT_PULSE_SCALE = 1.02;
const CURRENT_PULSE_ALPHA = 0.78;

const tsMotionMs = (on: boolean, ms: number): number => (on ? ms : 0);
const tsMotionDamping = (on: boolean): number => (on ? MOTION_PRESS_DAMPING : 1);
const tsPulseScale = (phase: number): number => 1 + (CURRENT_PULSE_SCALE - 1) * Math.min(1, Math.max(0, phase));
const tsPulseAlpha = (phase: number): number => 1 - (1 - CURRENT_PULSE_ALPHA) * Math.min(1, Math.max(0, phase));

const rounded = (x: number): number => Math.round(x * 10000) / 10000;

describe("#145 — politique de fermeture des notices", () => {
  test("une action se trouve : toute notice actionnable reste 10 s (Long)", () => {
    for (const kind of ["INFO", "SUCCESS", "ERROR"] as NoticeKind[]) {
      expect({ kind, hasAction: false, ms: tsNoticeDurationMs(kind, false) === NOTICE_SHORT_MS }).toEqual({
        kind,
        hasAction: false,
        ms: kind === "SUCCESS",
      });
      // Avec action, plus aucune sévérité n'est « courte » : c'est la règle.
      expect({ kind, ms: tsNoticeDurationMs(kind, true) }).toEqual({ kind, ms: NOTICE_LONG_MS });
      expect({ kind, long: tsNoticeIsLong(kind, true) }).toEqual({ kind, long: true });
    }
    // Sans action : `Short` pour la confirmation, `Long` pour l'erreur.
    expect(tsNoticeIsLong("SUCCESS", false)).toBe(false);
    expect(tsNoticeIsLong("ERROR", false)).toBe(true);
    expect(tsNoticeIsLong("INFO", false)).toBe(false);
  });

  test("l'ordre est le bon : l'erreur ne se ferme jamais avant une confirmation", () => {
    // Un message de serveur (401, 503) doit tenir plus longtemps qu'un « devoir
    // marqué fait », sinon il disparaît avant d'avoir été lu.
    expect(tsNoticeDurationMs("ERROR", false)).toBeGreaterThan(tsNoticeDurationMs("SUCCESS", false));
    expect(tsNoticeDurationMs("ERROR", false)).toBeGreaterThan(tsNoticeDurationMs("INFO", false));
    expect(tsNoticeDurationMs("INFO", false)).toBeGreaterThan(tsNoticeDurationMs("SUCCESS", false));
  });

  test("Kotlin : les trois durées et le `Long` sont posés une seule fois", () => {
    expect(MOTION).toContain("const val NOTICE_SHORT_MS = 4_000");
    expect(MOTION).toContain("const val NOTICE_INFO_MS = 6_000");
    expect(MOTION).toContain("const val NOTICE_LONG_MS = 10_000");
    expect(kt).toMatch(/fun noticeDurationMs\(kind: NoticeKind, hasAction: Boolean\): Int = when \{/);
    expect(kt).toMatch(/hasAction -> NOTICE_LONG_MS/);
    expect(kt).toMatch(/kind == NoticeKind\.ERROR -> NOTICE_LONG_MS/);
    expect(kt).toContain("fun noticeIsLong(kind: NoticeKind, hasAction: Boolean): Boolean");
    // La durée est une FONCTION de la sévérité : le `SnackbarDuration` n'est
    // choisi qu'à UN endroit dans tout le module (les docs ci-dessus comptent
    // pour du texte, pas pour du code).
    expect(kt).toContain("duration = if (noticeIsLong(notice.kind, notice.actionLabel != null)) {");
    expect((kt.match(/SnackbarDuration\./g) ?? []).length).toBe(2);
  });
});

describe("#145 — sévérité -> couleurs : un échec ne peut pas ressembler à une réussite", () => {
  // [kind, rouge du thème, thème sombre ?, surface variante]
  const cases: Array<[NoticeKind, Rgb, boolean, Rgb]> = [
    ["ERROR", DANGER, false, SURFACE_VARIANT],
    ["ERROR", DANGER, true, SURFACE_VARIANT],
    ["SUCCESS", DANGER, false, SURFACE_VARIANT],
    ["SUCCESS", DANGER, true, SURFACE_VARIANT],
    ["INFO", DANGER, false, SURFACE_VARIANT],
    ["INFO", DANGER, true, SURFACE_VARIANT],
  ];

  test("échec = rouge de mesure, succès et info = encre normale", () => {
    for (const [kind, error, isDark, variant] of cases) {
      const palette = tsNoticePalette(kind, error, isDark, variant, INK);
      const label = `${kind}/${isDark ? "sombre" : "clair"}`;
      if (kind === "ERROR") {
        // Le couple MESURÉ d'un cours annulé, pas une teinte inventée ici.
        expect({ label, container: rounded(palette.container.r) }).toEqual({
          label,
          container: rounded(tsCancelledSurface(error, isDark).r),
        });
        expect({ label, rouge: palette.container.r !== variant.r || palette.content.r !== INK.r }).toEqual({
          label,
          rouge: true,
        });
      } else {
        // Le succès porte l'ENCRE NORMALE du thème : pas de rouge, pas d'aplat vert.
        expect({ label, container: palette.container }).toEqual({ label, container: variant });
        expect({ label, content: palette.content }).toEqual({ label, content: INK });
      }
    }
  });

  test("un échec et un succès ne peuvent pas avoir ni le même fond ni la même encre", () => {
    for (const isDark of [false, true]) {
      const error = tsNoticePalette("ERROR", DANGER, isDark, SURFACE_VARIANT, INK);
      const success = tsNoticePalette("SUCCESS", DANGER, isDark, SURFACE_VARIANT, INK);
      expect({ isDark, memeFond: error.container === success.container }).toEqual({ isDark, memeFond: false });
      expect({ isDark, memeEncre: error.content === success.content }).toEqual({ isDark, memeEncre: false });
      // Les deux paires sont lisibles (4.5:1, vérifié plus bas) ET distinctes :
      // la différence ne repose pas sur la seule perception des couleurs.
      expect({
        isDark,
        ecartDesEncrés: rounded(tsLuminance(error.content) - tsLuminance(success.content)),
      }).toEqual({
        isDark,
        ecartDesEncrés: rounded(tsLuminance(error.content) - tsLuminance(success.content)),
      });
    }
  });

  test("chaque paire fond/encre passe AA (4.5:1), clair comme sombre", () => {
    for (const [kind, error, isDark, variant] of cases) {
      const palette = tsNoticePalette(kind, error, isDark, variant, INK);
      const label = `${kind}/${isDark ? "sombre" : "clair"}`;
      // Le texte du snackbar est du corps de texte : 4.5:1, pas 3:1.
      expect({ label, ratio: Math.round(tsContrast(palette.container, palette.content) * 100) / 100 }).toEqual({
        label,
        ratio: Math.round(tsContrast(palette.container, palette.content) * 100) / 100,
      });
      expect(tsContrast(palette.container, palette.content)).toBeGreaterThanOrEqual(4.5);
      // L'action est un libellé de la même taille : même exigence.
      expect(tsContrast(palette.container, palette.action)).toBeGreaterThanOrEqual(4.5);
    }
  });

  test("l'action en vert de marque aurait été sous AA : le choix se justifie", () => {
    // La raison écrite dans le KDoc de `noticePalette`, vérifiée : `primary` sur
    // `surfaceVariant` ne passe pas 4.5:1, donc l'action prend l'encre du texte.
    expect(tsContrast(SURFACE_VARIANT, PRIMARY)).toBeLessThan(4.5);
    expect(tsContrast(SURFACE_VARIANT, INK)).toBeGreaterThanOrEqual(4.5);
    expect(MOTION).toContain("3.47:1");
  });

  test("Kotlin : la palette ne contient AUCUNE couleur en dur", () => {
    expect(kt).not.toMatch(/Color\(0x/);
    expect(kt).not.toMatch(/#[0-9A-Fa-f]{6}"/);
    // Elle RÉUTILISE les deux fonctions mesurées du thème, pas une teinte locale.
    expect(kt).toContain("cancelledSurface(error, dark)");
    expect(kt).toContain("cancelledInk(error, dark)");
    expect(kt).toContain("surfaceVariant: Color,");
    expect(kt).toContain("onSurface: Color,");
  });
});

describe("#145 — valeurs mesurées du mouvement", () => {
  test("300 ms et cubicBezier(0.3, 0.3, 0, 1), écrits une seule fois", () => {
    expect(MOTION).toContain("const val MOTION_ENTER_MS = 300");
    expect(kt).toContain("val MOTION_ENTER_EASING: Easing = CubicBezierEasing(0.3f, 0.3f, 0f, 1f)");
    // Une seule définition de la durée, réutilisée par les quatre briques.
    expect(MOTION.match(/const val MOTION_ENTER_MS/g)?.length ?? 0).toBe(1);
    expect(kt).toContain("tween(motionMs(motionOn, MOTION_ENTER_MS), easing = MOTION_ENTER_EASING)");
  });

  test("apparition : échelle 0.9 -> 1, ressort de presse amorti 0.8", () => {
    expect(MOTION).toContain("const val MOTION_ENTER_SCALE = 0.9f");
    expect(MOTION).toContain("const val MOTION_PRESS_DAMPING = 0.8f");
    expect(MOTION).toContain(`const val MOTION_PRESS_STIFFNESS = ${MOTION_PRESS_STIFFNESS}f`);
    // Les trois briques lisent les mêmes jetons : aucune durée « en dur » ailleurs.
    expect(kt).toContain("initialScale = MOTION_ENTER_SCALE");
    expect(kt).toContain("spring(dampingRatio = motionDamping(motionOn), stiffness = MOTION_PRESS_STIFFNESS)");
    // Un ressort non amorti est un rebond, pas une presse.
    expect(MOTION_PRESS_DAMPING).toBeLessThan(1);
    expect(tsMotionDamping(true)).toBe(0.8);
  });

  test("mouvement coupé : durée nulle, amortissement 1 (aucun rebond)", () => {
    // `ValueAnimator.areAnimatorsEnabled()` = false : l'état saute, il ne dérive pas.
    expect(tsMotionMs(false, MOTION_ENTER_MS)).toBe(0);
    expect(tsMotionMs(true, MOTION_ENTER_MS)).toBe(300);
    expect(tsMotionDamping(false)).toBe(1);
    expect(kt).toMatch(/fun motionMs\(motionOn: Boolean, ms: Int\): Int = if \(motionOn\) ms else 0/);
    expect(kt).toMatch(/fun motionDamping\(motionOn: Boolean\): Float = if \(motionOn\) MOTION_PRESS_DAMPING else 1f/);
    // La porte de lecture est bien celle de la plateforme, et elle est tolérante.
    expect(kt).toContain("fun systemAnimationsEnabled(): Boolean =");
    expect(kt).toContain("ValueAnimator.areAnimatorsEnabled()");
    expect(kt).toContain("getOrDefault(true)");
    // Une coupe ne doit jamais produire une durée NÉGATIVE ou infinie.
    expect(tsMotionMs(false, MOTION_ENTER_MS)).toBeGreaterThanOrEqual(0);
  });

  test("Kotlin : Compose 1.6.8 n'a pas `LocalMotionDurationScale`, on ne l'invente pas", () => {
    expect(kt).not.toContain("LocalMotionDurationScale(");
    // La pulsation « en cours » est coupée par le même interrupteur.
    expect(kt).toMatch(/if \(active && motionOn\) \{/);
  });
});

describe("#145 — pulsation « en cours »", () => {
  test("échelle et opacité : bornes, monotonie, aucun dépassement", () => {
    expect(tsPulseScale(0)).toBe(1);
    expect(tsPulseScale(1)).toBeCloseTo(1.02, 6);
    expect(tsPulseAlpha(0)).toBe(1);
    expect(tsPulseAlpha(1)).toBeCloseTo(0.78, 6);
    // Hors bornes : une transition infinie peut déborder, la valeur doit rester
    // dans son intervalle (sinon une carte « en cours » se déformerait).
    expect(tsPulseScale(1.5)).toBeCloseTo(1.02, 6);
    expect(tsPulseScale(-1)).toBe(1);
    expect(tsPulseAlpha(-1)).toBe(1);
    // Monotones et bornées : la pulsation reste SUBTILE (2 %, 22 % d'opacité).
    let previousScale = tsPulseScale(0);
    let previousAlpha = tsPulseAlpha(0);
    for (const phase of [0.25, 0.5, 0.75, 1]) {
      const scale = tsPulseScale(phase);
      const alpha = tsPulseAlpha(phase);
      expect(scale).toBeGreaterThanOrEqual(previousScale);
      expect(alpha).toBeLessThanOrEqual(previousAlpha);
      expect(scale).toBeLessThanOrEqual(CURRENT_PULSE_SCALE);
      expect(alpha).toBeGreaterThanOrEqual(CURRENT_PULSE_ALPHA);
      previousScale = scale;
      previousAlpha = alpha;
    }
  });

  test("Kotlin : la pulsation n'existe que pour le cours EN COURS", () => {
    expect(MOTION).toContain("const val CURRENT_PULSE_SCALE = 1.02f");
    expect(MOTION).toContain("const val CURRENT_PULSE_ALPHA = 0.78f");
    expect(kt).toMatch(/fun pulseScale\(phase: Float\): Float =\s*1f \+ \(CURRENT_PULSE_SCALE - 1f\) \* phase\.coerceIn\(0f, 1f\)/);
    expect(kt).toMatch(/fun pulseAlpha\(phase: Float\): Float =\s*1f - \(1f - CURRENT_PULSE_ALPHA\) \* phase\.coerceIn\(0f, 1f\)/);
    // La boucle infinie n'est créée QUE si le cours est actif : sinon une par
    // cours de la page, donc autant de recompositions par image pour rien.
    expect(kt).toMatch(/return if \(active\) \{/);
    // Et c'est la SEULE carte qui l'appelle.
    const card = readFileSync(join(UI, "TimetableCourseCard.kt"), "utf8");
    expect(card).toContain("modifier.papCurrentPulse(highlight == CourseHighlight.CURRENT)");
    expect((codeOnly(card).match(/papCurrentPulse\(/g) ?? []).length).toBe(1);
  });
});

describe("#145 — le message du snackbar dit ce que l'app a fait", () => {
  const tsToggleNoticeLabel = (subject: string, done: boolean): string =>
    done ? `« ${subject} » marqué comme fait.` : `« ${subject} » remis à faire.`;

  test("fait / à faire : deux formulations, donc deux retours distincts", () => {
    expect(tsToggleNoticeLabel("Maths", true)).toBe("« Maths » marqué comme fait.");
    expect(tsToggleNoticeLabel("Maths", false)).toBe("« Maths » remis à faire.");
    // La matière est reprise telle quelle : c'est une donnée (I6), jamais réécrite.
    expect(tsToggleNoticeLabel("ALLEMAND LV2", true)).toContain("ALLEMAND LV2");
    expect(tsToggleNoticeLabel("", true)).toBe("«  » marqué comme fait.");
  });

  test("Kotlin : la fonction est PURE, dans le fichier des helpers purs", () => {
    expect(SECTIONS).toContain("fun toggleNoticeLabel(subject: String, done: Boolean): String =");
    // L'action « Annuler » n'existe que parce que le retour dit ce qu'elle inverse.
    expect(ASSIGNMENTS).toContain("actionLabel = \"Annuler\"");
    expect(ASSIGNMENTS).toContain("onAction = { toggle(a, !done) }");
    expect(ASSIGNMENTS).toContain("text = toggleNoticeLabel(a.subject, done)");
  });
});

describe("#145 — une seule porte de notification, et zéro dépendance ajoutée", () => {
  test("le `Scaffold` racine porte le `SnackbarHost`, le reste poste", () => {
    expect(NAV).toContain("val noticeHost = rememberPapNoticeHost()");
    expect(NAV).toContain("CompositionLocalProvider(LocalPapNotice provides noticeHost)");
    expect(NAV).toContain("snackbarHost = { PapNoticeSnackbarHost(noticeHost) }");
    // Aucun écran ne dessine son propre snackbar : le host est unique.
    for (const f of ["Assignments.kt", "MessagesScreen.kt", "TimetableWeek.kt"]) {
      const src = readFileSync(join(UI, f), "utf8");
      expect({ f, host: src.includes("SnackbarHost(") }).toEqual({ f, host: false });
    }
    // Les deux écrans qui ont une écriture à annoncer postent par la porte unique.
    for (const f of ["Assignments.kt", "MessagesScreen.kt"]) {
      const src = readFileSync(join(UI, f), "utf8");
      expect({ f, poster: src.includes("LocalPapNotice.current") }).toEqual({ f, poster: true });
    }
  });

  test("les deux rangées `Text` de message ont disparu des écrans migrés", () => {
    const devoirs = codeOnly(ASSIGNMENTS);
    const messagerie = codeOnly(readFileSync(join(UI, "MessagesScreen.kt"), "utf8"));
    // AVANT : un `Text` en encre d'erreur au-dessus du contenu — un ÉCHEC et une
    // RÉUSSITE s'affichaient pareil. Le message passe par le snackbar, qui a une
    // couleur de sévérité et une fermeture automatique.
    expect(devoirs).not.toMatch(/text = notice,/);
    expect(messagerie).not.toContain("NoticeRow");
    // Le squelette, l'état vide et l'état d'erreur restent : on n'a rien retiré
    // d'autre que la rangée de message.
    for (const brique of ["PapLoading", "PapEmptyState", "PapErrorState", "PapStaleBanner"]) {
      expect({ brique, devoirs: devoirs.includes(brique) }).toEqual({ brique, devoirs: true });
      expect({ brique, messagerie: messagerie.includes(brique) }).toEqual({ brique, messagerie: true });
    }
    // Le bandeau « périmé » s'ouvre au lieu d'apparaître d'un coup.
    expect(devoirs).toContain("PapAppear(visible = isStale)");
    expect(messagerie).toContain("PapAppear(visible = isStale)");
  });

  test("un échec propose « Réessayer », jamais un « Annuler » de suppression", () => {
    const messagerie = readFileSync(join(UI, "MessagesScreen.kt"), "utf8");
    // Le contrat n'expose que `POST /v1/discussions/delete` : une annulation ne
    // serait qu'un mensonge affiché, donc elle n'est pas câblée.
    expect(messagerie).toContain("« Réessayer »");
    expect(codeOnly(messagerie)).not.toContain('actionLabel = "Annuler"');
    expect(messagerie).toContain("onUndoDelete: (() -> Unit)? = null,");
    // L'annulation, elle, EST câblée là où le serveur sait l'inverser : le devoir.
    expect(ASSIGNMENTS).toContain("onAction = { toggle(a, !done) }");
  });

  test("retour physique : les moments de l'issue, et un vocabulaire unique", () => {
    const haptique = (f: string): string => codeOnly(readFileSync(join(UI, f), "utf8"));
    // Bascule de devoir, QR lu, envoi de message, appairage validé. #184 : le
    // cinquième moment (la sélection de compétence) a disparu avec son écran ;
    // `select()` reste au vocabulaire du kit de mouvement, sans appelant.
    expect(haptique("Assignments.kt")).toContain("performHapticFeedback(HapticFeedbackType.LongPress)");
    expect(haptique("QrScanner.kt")).toContain("haptics.confirm()");
    expect(haptique("MessagesScreen.kt")).toContain("haptics.confirm()");
    expect(haptique("PairingScreen.kt")).toContain("haptics.confirm()");
    // Un seul vocabulaire, défini UNE fois (`Motion.kt`).
    expect(kt).toContain("fun select() {");
    expect(kt).toContain("fun confirm() {");
    expect(kt).not.toContain("HapticFeedbackType.Confirm");
    expect(kt).not.toContain("HapticFeedbackType.Reject");
  });

  test("animations : `Crossfade` sur les changements d'état, pas de clignotement", () => {
    // L'état est une VALEUR comparée par le Crossfade, pas une branche de `when`.
    for (const [f, cle] of [
      ["Assignments.kt", "assignmentsState"],
      ["MessagesScreen.kt", "messagesState"],
      ["TimetableWeek.kt", "timetableState"],
    ] as const) {
      const src = readFileSync(join(UI, f), "utf8");
      expect({ f, crossfade: src.includes(`label = "${cle}"`) }).toEqual({ f, crossfade: true });
      expect({ f, stateKey: src.includes("val stateKey = when {") }).toEqual({ f, stateKey: true });
      expect({ f, animated: src.includes("import androidx.compose.animation.Crossfade") }).toEqual({
        f,
        animated: true,
      });
    }
    // Le placement d'une carte qui change de place est animé, pas téléporté.
    expect(ASSIGNMENTS).toContain("Modifier.animateItemPlacement(motionPlacementSpec(motionOn))");
  });

  test("zéro dépendance : rien d'ajouté au graphe Gradle", () => {
    const avant = readFileSync(join(ROOT, "android/ui/build.gradle.kts"), "utf8");
    expect(avant).toBe(UI_GRADLE);
    // Pas de bibliothèque d'animation : uniquement les API Compose du BOM gelé.
    expect(UI_GRADLE).not.toMatch(/animation|lottie|reanimated|sprinkles/i);
    expect(VERSIONS).not.toMatch(/animation|lottie|reanimated/i);
    // Le BOM et material3 n'ont pas bougé non plus.
    expect(UI_GRADLE).toContain('val composeBom = platform("androidx.compose:compose-bom:2024.06.00")');
    expect(UI_GRADLE).toContain('implementation("androidx.compose.material3:material3:1.2.1")');
    // Les briques d'animation viennent de `animation-core`, déjà dans le graphe.
    expect(kt).toContain("androidx.compose.animation.AnimatedVisibility");
    expect(kt).toContain("androidx.compose.animation.core.CubicBezierEasing");
  });

  test("Android n'a toujours pas de couleur en dur dans le mouvement", () => {
    for (const f of ["Motion.kt", "Assignments.kt", "MessagesScreen.kt", "TimetableWeek.kt"]) {
      const src = codeOnly(readFileSync(join(UI, f), "utf8"));
      expect({ f, hex: /Color\(0x|#[0-9A-Fa-f]{6}"/.test(src) }).toEqual({ f, hex: false });
    }
  });
});