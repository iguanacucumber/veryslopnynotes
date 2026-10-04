// Miroir PARTAGÉ des dates françaises (#147) — la table est LUE dans le Kotlin,
// pas recopiée.
//
// AVANT, chaque test d'écran avait sa PROPRE liste : `DAYS` côté accueil,
// `DAY_NAMES` côté EDT et côté cantine, une liste en ligne côté devoirs, et
// `WEEKDAYS_FR` (ordre LUNDI-D'ABORD !) + `MONTHS_FR` côté vie scolaire — deux
// indexations de la même donnée dans le même dépôt, dont quatre tableaux Kotlin
// identiques en face. C'est ce que ce fichier supprime : les tests lisent
// `core/DateFr.kt`, donc ajouter un jour ou un mois se fait à un seul endroit.
//
// `LocalDate.parse` est strict (2026-13-01 et 2026-02-30 sont refusés) : le
// miroir le reproduit, sinon un test vert validerait une date que l'app affiche
// en « lundi 30/02 ».
//
// ponytail: lecture à la PREMIÈRE UTILISATION, pas au chargement du module — un
// fichier absent (le helper pas encore écrit) doit faire échouer le TEST qui le
// réclame, pas tout le fichier de test à l'import.

import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..", "..", "..");
export const DATE_FR_KT = join(ROOT, "android/core/src/main/java/fr/veryslopnynotes/core/DateFr.kt");

/** Lit une `listOf("…", "…")` Kotlin par son nom de variable. */
function ktList(source: string, name: string): string[] {
  const start = source.indexOf(`${name}: List<String>`);
  if (start < 0) throw new Error(`miroir : ${name} absent de ${DATE_FR_KT}`);
  const open = source.indexOf("(", start);
  let depth = 0;
  let end = open;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "(") depth++;
    if (source[i] === ")") {
      depth--;
      if (depth === 0) {
        end = i;
        break;
      }
    }
  }
  const items = [...source.slice(open, end).matchAll(/"([^"]*)"/g)].map((m) => m[1]!);
  if (items.length === 0) throw new Error(`miroir : ${name} vide dans ${DATE_FR_KT}`);
  return items;
}

let cache: { days: string[]; months: string[] } | null = null;

function load(): { days: string[]; months: string[] } {
  if (cache === null) {
    let source = "";
    try {
      source = readFileSync(DATE_FR_KT, "utf8");
    } catch {
      throw new Error(`miroir : ${DATE_FR_KT} absent — les dates françaises ne sont plus où le test les cherche`);
    }
    cache = { days: ktList(source, "FR_DAY_NAMES"), months: ktList(source, "FR_MONTHS") };
  }
  return cache;
}

/** Jours en toutes lettres, DIMANCHE D'ABORD (comme `dayOfWeek.value % 7`). */
export const frDayNames = (): readonly string[] => load().days;

/** Mois en toutes lettres, janvier = index 0. */
export const frMonths = (): readonly string[] => load().months;

const pad2 = (n: number): string => String(n).padStart(2, "0");

/** Partie DATE de l'ISO : clé de tri, jamais affichée (miroir de `isoDayKey`). */
export const isoDayKey = (iso: string): string => (iso.length >= 10 ? iso.substring(0, 10) : "");

/** « vendredi 02/10 » depuis une date civile (miroir de `dayLabelOf`). */
export function dayLabelOf(y: number, m: number, d: number): string {
  const weekday = frDayNames()[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return `${weekday} ${pad2(d)}/${pad2(m)}`;
}

/** Date civile d'une clé ISO, `null` si illisible (même refus que `LocalDate.parse`). */
export function civilOfIsoDay(day: string): { y: number; m: number; d: number } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) return null;
  const y = Number(day.slice(0, 4));
  const m = Number(day.slice(5, 7));
  const d = Number(day.slice(8, 10));
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCFullYear() !== y || probe.getUTCMonth() + 1 !== m || probe.getUTCDate() !== d) return null;
  return { y, m, d };
}

/** « vendredi 02/10 » depuis l'ISO, chaîne VIDE si la date est illisible. */
export function dayLabelFr(iso: string): string {
  const civil = civilOfIsoDay(isoDayKey(iso));
  return civil === null ? "" : dayLabelOf(civil.y, civil.m, civil.d);
}

/** Nom du mois en minuscules, hors borne = chaîne vide (miroir de `monthFr`). */
export const monthFr = (month: number): string => frMonths()[month - 1] ?? "";

/** Nom du jour en capitale : « Vendredi » (miroir de `weekdayCapitalizedFr`). */
export const weekdayCapitalizedFr = (y: number, m: number, d: number): string => {
  const name = frDayNames()[new Date(Date.UTC(y, m - 1, d)).getUTCDay()]!;
  return name.charAt(0).toUpperCase() + name.slice(1);
};