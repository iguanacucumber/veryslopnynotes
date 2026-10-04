package fr.veryslopnynotes.core

import java.time.DayOfWeek
import java.time.LocalDate

// DATES FRANÇAISES — L'UNIQUE COPIE (#147).
//
// AVANT, le même module portait QUATRE (puis CINQ) tableaux divergents du nom
// de jour : `Assignment.dayLabelFr`, `CanteenMenus.canteenDayLabel`,
// `HomeWidgets.homeDayLabel`, `TimetableWeek.DAY_NAMES` — tous en « dimanche
// d'abord » — et `AttendanceFormat.WEEKDAYS_FR` en « LUNDI d'abord », avec
// `MONTHS_FR` dupliqué dans deux fichiers. Deux indexations différentes pour la
// même liste : c'est la faille derrière chaque « mardi 06/10 » affiché un
// dimanche. Les TRANCHES ISO (`iso.substring(0, 10)`) étaient, elles, le défaut
// affichable : « 2026-10-05 » à l'écran, en pleine interface française.
//
// Ici, une seule table, UN index (`dayOfWeek.value % 7` : `java.time` compte le
// lundi pour 1 et le dimanche pour 7, donc le modulo donne dimanche = 0) et un
// seul rendu « lundi 05/10 ». Chaque écran délègue au lieu de réécrire.
//
// Tables POSÉES, jamais `DateTimeFormatter` avec `EEEE` / `MMMM` : le nom long
// dépend de la CLDR du téléphone (« oct. », « 10月 »). Même arbitrage que dans
// le temps relatif de l'onglet Notes.
//
// core et pas ui : `Assignment.dayLabelFr` vivait dans core et était appelé
// depuis ui. Un helper de dates dans ui l'aurait rendu inaccessible à core, donc
// la copie serait restée. Ici les deux modules parlent au même fichier.
//
// ponytail: `java.time` seul (minSdk 26 = API 26, le désucrage n'est pas même
// nécessaire), zéro dépendance ajoutée. Upgrade: `TimeFormatter` avec un
// `DecimalStyle`/`TextStyle` forcé si un jour le format change.

/**
 * Jours de la semaine, DIMANCHE D'ABORD : c'est l'ordre de `dayOfWeek.value % 7`
 * (`java.time` : lundi = 1 … dimanche = 7), donc l'index est direct.
 */
val FR_DAY_NAMES: List<String> =
    listOf("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")

/** Mois en toutes lettres, index 0 = janvier (comme `monthValue - 1`). */
val FR_MONTHS: List<String> =
    listOf(
        "janvier", "février", "mars", "avril", "mai", "juin",
        "juillet", "août", "septembre", "octobre", "novembre", "décembre",
    )

/** Nom du jour en minuscules : « lundi ». Jamais de table lisible ailleurs. */
fun weekdayFr(day: DayOfWeek): String = FR_DAY_NAMES[day.value % 7]

/** Même nom, première lettre en capitale : « Lundi » (titre d'en-tête). */
fun weekdayCapitalizedFr(day: DayOfWeek): String =
    weekdayFr(day).replaceFirstChar { it.uppercaseChar() }

/** Nom du mois en minuscules : « octobre ». Hors borne = chaîne vide. */
fun monthFr(month: Int): String = FR_MONTHS.getOrElse(month - 1) { "" }

/** « lundi 05/10 » : le jour CALENDAIRE, sans année, sans heure. */
fun dayLabelOf(date: LocalDate): String {
    val dd = date.dayOfMonth.toString().padStart(2, '0')
    val mm = date.monthValue.toString().padStart(2, '0')
    return "${weekdayFr(date.dayOfWeek)} $dd/$mm"
}

/**
 * Partie DATE d'un ISO du contrat (`2026-10-05`, `2026-10-05T08:00:00.000Z`) :
 * une **clé de tri**, jamais un libellé.
 *
 * Elle est gardée parce que `assignmentsByDay` range les devoirs par jour et
 * les-TRIE dessus : une clé lexicale ISO est justement ce qui rend l'ordre
 * chronologique. Ne jamais la passer à un `Text` — c'est pour ça qu'elle est
 * nommée `isoDayKey` et pas `dateLabel` (le nom de l'ancien helper mort, qui
 * affichait cette tranche).
 */
fun isoDayKey(iso: String): String = if (iso.length >= 10) iso.substring(0, 10) else ""

/**
 * « lundi 05/10 » depuis l'ISO du contrat, chaîne VIDE si la date est illisible.
 *
 * Vide et non « les dix premiers caractères » : une date qu'on ne sait pas lire
 * vaut mieux absente qu'affichée en fragment d'ISO — c'est le défaut que les
 * quatre écrans corrigés laissaient passer (`RevisionSheets`, `Competences`).
 */
fun dayLabelFr(iso: String): String {
    val day = isoDayKey(iso)
    if (day.length < 10) return ""
    val date = runCatching { LocalDate.parse(day) }.getOrNull() ?: return ""
    return dayLabelOf(date)
}