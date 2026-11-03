// Visuel de matière : emoji et palette dérivée de la couleur, affichage seul,
// aucune donnée Pronote interprétée.
import { readableInk, subjectColor, tint } from "./format";

const RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/MATHEMATIQUES?|MATHS?/, "📐"],
  [/NUMERIQUE|INFORMATIQUE|\bNSI\b|ALGORITHMIQUE/, "💻"],
  [/HISTOIRE|GEOGRAPHIE/, "🌍"],
  [/FRANCAIS|LETTRES|LITTERATURE/, "📚"],
  [/PHILOSOPHIE|PHILO/, "💭"],
  [/ANGLAIS|DNL.ANG/, "🇬🇧"],
  [/ESPAGNOL/, "🇪🇸"],
  [/ALLEMAND/, "🇩🇪"],
  [/ITALIEN/, "🇮🇹"],
  [/SCIENCES? DE LA VIE|\bSVT\b|BIOLOGIE/, "🧬"],
  [/PHYSIQUE|CHIMIE/, "🧪"],
  [/SCIENCES? ECONOMIQUES|\bSES\b|ECONOMIE|GESTION/, "📈"],
  [/EDUCATION PHYSIQUE|\bEPS\b|SPORT/, "🏃"],
  [/ARTS? PLASTIQUES|DESSIN|PEINTURE/, "🎨"],
  [/MUSIQUE|CHANT/, "🎵"],
  [/TECHNOLOGIE|TECHNO|INGENIERIE/, "🛠️"],
  [/SANTE|MEDECINE|PREMIERS SECOURS/, "🩺"],
];

export function subjectEmoji(subject: string): string {
  const normalized = subject
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase();
  for (const [pattern, emoji] of RULES) {
    if (pattern.test(normalized)) return emoji;
  }
  return "📘";
}

export interface SubjectPalette {
  base: string;
  background: string;
  ink: string;
}

/** Fond teinté de la matière et encre lisible sur ce fond composé. */
export function subjectPalette(subject: string, dark: boolean): SubjectPalette {
  const base = subjectColor(subject);
  const background = tint(base, dark ? -0.7 : 0.75);
  return {
    base,
    background,
    ink: readableInk(background),
  };
}
