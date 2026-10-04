package fr.veryslopnynotes.ui

import fr.veryslopnynotes.core.Assignment
import java.text.Normalizer
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.temporal.WeekFields
import java.util.Locale

// #138 : logique PURE de l'écran Devoirs — fenêtre de semaine, sections,
// recherche, texte des dates. ZÉRO Composable, dépôt, réseau ou `now` caché :
// l'instant et le fuseau sont INJECTÉS, donc chaque fonction est déterministe et
// son miroir tient dans tests/unit/android-assignments.test.ts (le build Gradle
// n'est pas exécuté par `make check`).
//
// AVANT #138, la liste était un seul `assignmentsByDay` trié par jour : rien ne
// distinguait « à faire ce soir » de « rendu la semaine dernière », et la seule
// trace du FAIT était le libellé d'un bouton.
//
// La fenêtre de semaine est un ISO court (« 2026-10-05 ») : c'est la forme que
// le serveur attend (`weekStart`, bornes lundi → dimanche côté API), donc elle
// se partage avec lui sans conversion ni fuseau implicite.

/** Jours d'une semaine ISO : le serveur borne la fenêtre lundi → dimanche. */
private const val WEEK_DAYS = 7L

/** Diacritiques retirés après NFD : « Économies » se cherche « economies ». */
private val DIACRITICS = Regex("\\p{InCombiningDiacriticalMarks}+")

// Sections de l'écran, dans l'ordre d'affichage. Le FAIT prime sur la date : un
// devoir rendu est rangé « Terminés » même s'il est daté de demain, sinon il
// reviendrait dans « À venir » à chaque rechargement.
const val SECTION_OVERDUE = "overdue"
const val SECTION_TODAY = "today"
const val SECTION_UPCOMING = "upcoming"
const val SECTION_DONE = "done"

/** Libellés français des sections : une source, l'ordre EST l'ordre d'affichage. */
private val SECTION_TITLES = listOf(
    SECTION_OVERDUE to "En retard",
    SECTION_TODAY to "Aujourd'hui",
    SECTION_UPCOMING to "À venir",
    SECTION_DONE to "Terminés",
)

/**
 * Une section remplie : [days] = groupes (jour ISO, devoirs) — le regroupement
 * par jour de [assignmentsByDay] est CONSERVÉ, il porte la lecture d'une semaine.
 */
data class AssignmentSectionUi(
    val id: String,
    val title: String,
    val days: List<Pair<String, List<Assignment>>>,
) {
    /** Nombre de devoirs de la section, tous groupes confondus. */
    val count: Int get() = days.sumOf { it.second.size }
}

/** Section d'un devoir. La comparaison se fait au JOUR local : « aujourd'hui à
 *  08:00 » appartient à « Aujourd'hui », pas à « En retard » (sinon un devoir de
 *  ce matin qui traîne depuis 6 h ressemblerait à un devoir de la semaine
 *  dernière). Une dueDate illisible n'est jamais classée « En retard » : ce
 *  serait inventer un retard que le serveur n'a pas publié. */
fun assignmentSectionOf(a: Assignment, nowMillis: Long, zone: ZoneId): String {
    if (a.done) return SECTION_DONE
    val day = assignmentDay(a.dueDate, zone) ?: return SECTION_UPCOMING
    val today = localDay(nowMillis, zone)
    if (today.isEmpty()) return SECTION_UPCOMING
    return when {
        day < today -> SECTION_OVERDUE
        day == today -> SECTION_TODAY
        else -> SECTION_UPCOMING
    }
}

/**
 * Sections NON VIDES, dans l'ordre de [SECTION_TITLES], chacune groupée par jour.
 *
 * Un devoir dont la dueDate est illisible est ÉCARTÉ : `assignmentsByDay` en
 * tirerait un jour avec les dix premiers caractères de la chaîne (« pas une
 * da »), donc un intitulé de jour FABRIQUÉ — pire que l'absence de ligne, qui
 * dit seulement « cette date n'a pas été publiée ».
 */
fun assignmentSections(list: List<Assignment>, nowMillis: Long, zone: ZoneId): List<AssignmentSectionUi> {
    val dated = list.filter { assignmentDay(it.dueDate, zone) != null }
    return SECTION_TITLES.mapNotNull { (id, title) ->
        val days = assignmentsByDay(dated.filter { assignmentSectionOf(it, nowMillis, zone) == id })
        if (days.isEmpty()) null else AssignmentSectionUi(id, title, days)
    }
}

/**
 * Filtre matière + recherche plein texte (matière, titre, consigne), sans casse
 * ni accent : « econ » trouve « Économie », « MATH » trouve « Mathématiques ».
 *
 * [subject] vide ou nulle = toutes les matières (le chip « Toutes »), jamais
 * aucun résultat par défaut. Une matière absente de [list] ne renvoie RIEN :
 * filtrer sur une matière que la semaine ne publie pas doit montrer l'écran
 * vide, pas revenir à la liste entière (ce qui ferait croire que le filtre a
 * été ignoré).
 */
fun filterAssignments(list: List<Assignment>, subject: String?, query: String): List<Assignment> {
    val wanted = subject?.trim().orEmpty()
    val needle = foldFr(query)
    return list.filter { a ->
        val sameSubject = wanted.isEmpty() || a.subject.trim() == wanted
        val matches = needle.isEmpty() || foldFr(a.subject + " " + a.title + " " + a.description).contains(needle)
        sameSubject && matches
    }
}

/** Les DEUX textes d'une carte de devoir : son titre et le corps de la consigne. */
data class AssignmentCardText(val title: String, val body: String)

/**
 * Répartit les deux textes de la carte SANS JAMAIS afficher deux fois la consigne.
 *
 * Pronote n'expose qu'UN champ descriptif, et le lecteur serveur en publie deux
 * fois le début : `title` = les 200 premiers caractères de `description`
 * (`pronote-client-reader.ts`, `mapAssignment`). La carte affichait donc les deux
 * champs côte à côte — « Evaluation de compréhension orale et d'expression
 * écrite » puis « Evaluation de compréhension orale et d'expression écrite sur
 * le début de la séquence… » (#161).
 *
 * Décision : la consigne vit dans le CORPS, bornée et dépliable comme avant ; le
 * TITRE n'est affiché que s'il apporte autre chose — pas de consigne du tout, ou
 * une consigne qui ne COMMENCE pas par lui (là, c'est un intitulé d'établissement).
 * La comparaison se fait sur le texte PLIÉ (casse + accents), donc un titre
 * re-casé ou ré-accents par le serveur ne passe pas pour un texte différent.
 */
fun assignmentCardText(a: Assignment): AssignmentCardText {
    val title = a.title.trim()
    val body = a.description.trim()
    if (body.isEmpty()) return AssignmentCardText(title, "")
    val foldedTitle = foldFr(title)
    if (foldedTitle.isNotEmpty() && foldFr(body).startsWith(foldedTitle)) {
        return AssignmentCardText("", body)
    }
    return AssignmentCardText(title, body)
}

/**
 * Nom de matière affichable : l'établissement publie « ALLEMAND LV2 », qui crie
 * à côté du reste de l'écran (#161). Seul le PREMIER mot passe en casse de
 * phrase — « Allemand LV2 » — car le reste porte une abréviation de niveau
 * (« LV2 », « Tle ») dont la casse fait sens. Un nom déjà mixte (« Mathématiques »)
 * est rendu TEL QUEL : la matière garde sa propre casse.
 */
fun subjectDisplayFr(name: String): String {
    val trimmed = name.trim()
    val letters = trimmed.filter { it.isLetter() }
    // Aucune lettre, ou au moins une en minuscule : la casse est celle de la
    // matière (préférence saisie à la main), on n'y touche pas.
    if (letters.isEmpty() || letters.any { !it.isUpperCase() }) return trimmed
    val head = trimmed.substringBefore(' ')
        .lowercase(Locale.FRANCE)
        .replaceFirstChar { it.uppercaseChar() }
    val tail = trimmed.substringAfter(' ', missingDelimiterValue = "")
    return if (tail.isEmpty()) head else "$head $tail"
}

/**
 * Initiale de matière, pour une pastille qui a un contenu : « ALLEMAND LV2 » → « A ».
 *
 * `PapSubjectAvatar` rend un disque PÂLE VIDE quand elle ne reçoit pas d'emoji,
 * donc une matière sans préférences n'affichait qu'une tache pastel, muette
 * (#161). Repli « ? », comme `profileInitials` (core/UserProfile.kt) : un glyphe
 * lisible plutôt qu'un rond nu. `uppercaseChar()` est sans locale (donc pas de
 * « ı » turc) et le premier caractère alphanumétrique gagne — « 2nde STL » commence
 * par un chiffre, donc « 2 ».
 */
fun subjectInitial(subject: String): String =
    subject.trim().firstOrNull { it.isLetterOrDigit() }?.uppercaseChar()?.toString() ?: "?"

/**
 * Minuscules sans accent : `NFD` décompose « é » en « e » + accent combinant,
 * qu'on retire. La casse est repliée AVEC une locale : un `lowercase()` sans
 * locale transforme le « I » pointu turc en « ı », que la suite ne retrouve
 * plus.
 */
fun foldFr(value: String): String =
    Normalizer.normalize(value.lowercase(Locale.FRANCE), Normalizer.Form.NFD)
        .replace(DIACRITICS, "")
        .trim()

/** Millis d'une dueDate ISO, ou null si elle est illisible. */
fun assignmentDueMillis(iso: String): Long? = runCatching { Instant.parse(iso).toEpochMilli() }.getOrNull()

/** Jour local d'un instant (« 2026-10-05 »), chaîne vide si l'instant est illisible. */
private fun localDay(millis: Long, zone: ZoneId): String =
    runCatching { Instant.ofEpochMilli(millis).atZone(zone).toLocalDate().toString() }.getOrDefault("")

/**
 * Jour local d'une dueDate (« 2026-10-05 »), null si elle est illisible.
 *
 * Les DEUX formes du contrat sont acceptées : l'instant ISO complet
 * (`Instant.parse`) et la date seule (`LocalDate.parse`) — `Instant.parse`
 * refuse « 2026-10-05 », alors que le contrat (`Date.parse` côté TS) l'accepte,
 * donc un devoir daté sans heure ne doit pas disparaître de l'écran.
 */
fun assignmentDay(iso: String, zone: ZoneId): String? {
    val millis = assignmentDueMillis(iso)
    if (millis != null) return localDay(millis, zone).takeIf { it.isNotEmpty() }
    return runCatching { LocalDate.parse(iso).toString() }.getOrNull()
}

/**
 * Échéance en temps relatif : « il y a 3 jours », « dans 2 jours », « demain
 * 08:00 » (via [relativeTimeFr]), puis une date courte au-delà de 7 jours.
 *
 * Une dueDate en DATE SEULE passe par [Assignment.dayLabelFr] — « lundi 05/10 » —
 * et une chaîne illisible ne rend RIEN. Jamais de fragment de date : un jour qui
 * ne se lit pas vaut mieux qu'un « ij » affiché comme une échéance.
 */
fun assignmentDueLabel(iso: String, nowMillis: Long, zone: ZoneId): String {
    val millis = assignmentDueMillis(iso)
    if (millis != null) return relativeTimeFr(millis, nowMillis, zone)
    return if (assignmentDay(iso, zone) != null) Assignment.dayLabelFr(iso) else ""
}

/** Lundi de la semaine contenant [millis], en ISO court ; chaîne vide si l'instant est illisible. */
fun weekStartIso(millis: Long, zone: ZoneId): String {
    val day = runCatching { Instant.ofEpochMilli(millis).atZone(zone).toLocalDate() }.getOrNull() ?: return ""
    return day.minusDays((day.dayOfWeek.value - 1).toLong()).toString()
}

/**
 * Semaine ± [weeks] (entier). Un ISO illisible est RENVOYÉ TEL QUEL : la
 * navigation ne doit jamais fabriquer une fenêtre ni bloquer l'écran.
 */
fun shiftWeekIso(iso: String, weeks: Long): String =
    runCatching { LocalDate.parse(iso).minusWeeks(weeks).toString() }.getOrDefault(iso)

/** « Semaine 41 » — numéro ISO, comme l'en-tête de Papillon. Le numéro seul ne
 *  suffit pas à dater : la plage ci-dessous l'accompagne toujours. */
fun weekLabelFr(iso: String): String {
    val date = runCatching { LocalDate.parse(iso) }.getOrNull() ?: return "Semaine"
    return "Semaine ${date.get(WeekFields.ISO.weekOfWeekBasedYear())}"
}

/** « 05/10 – 11/10 » : la plage affichée à côté du titre, avec l'année quand elle change. */
fun weekRangeFr(iso: String): String {
    val start = runCatching { LocalDate.parse(iso) }.getOrNull() ?: return ""
    val end = start.plusDays(WEEK_DAYS - 1)
    val tail = if (end.year != start.year) " – ${shortFr(end)}/${end.year}" else " – ${shortFr(end)}"
    return shortFr(start) + tail
}

/** « 05/10 » — format POSÉ : le nom court du mois dépend de la CLDR du téléphone. */
private fun shortFr(date: LocalDate): String =
    "%02d/%02d".format(Locale.FRANCE, date.dayOfMonth, date.monthValue)
