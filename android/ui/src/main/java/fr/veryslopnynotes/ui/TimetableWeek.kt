package fr.veryslopnynotes.ui

import androidx.compose.animation.Crossfade
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowLeft
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.filled.DateRange
import androidx.compose.material.icons.filled.KeyboardArrowDown
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Refresh
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.core.dayLabelOf
import fr.veryslopnynotes.core.enumFr
import fr.veryslopnynotes.core.monthFr
import fr.veryslopnynotes.core.weekdayCapitalizedFr
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.SubjectPrefs
import fr.veryslopnynotes.data.SyncedRepository
import kotlinx.coroutines.delay
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// #76 parité Papillon, onglet EDT — refaite en #137.
//
// L'EDT de papillon.bzh N'EST PAS une grille de semaine : c'est un PAGER
// HORIZONTAL, une page par jour, chaque page une liste verticale. Un jour =
// en-tête collant (jour en gras + pastille colorée du numéro et du mois +
// chevron, sous-titre « Aujourd'hui » / « Hier »), puis les cours.
//
// CE QUE LA VERSION D'AVANT FAISAIT MAL, et que ce fichier corrige :
//   - pas de conteneur de défilement : une `Column` à `fillMaxSize` tronquait
//     silencieusement la fin d'une semaine de cours ;
//   - `weekStart ±= 7 × 24 × 3600 × 1000` : 168 h ignore le changement d'heure.
//     En arrière d'une semaine d'été vers une semaine d'hiver, le lundi
//     atterrissait sur DIMANCHE 23 h, et la query `weekStart=` partie de là
//     était fausse pour le reste de la session. Le passage se fait maintenant
//     par `LocalDate.plusWeeks` ([shiftWeeks]) ;
//   - un cours annulé en `Color.LightGray` sur fond clair = 1.5:1, et
//     l'intention (« annulé » doit rester lisible) était annulée : c'est le
//     rouge pâle mesuré de [cancelledSurface] ;
//   - la couleur des `SubjectPrefs` ne servait qu'à teinter une chaîne ; elle
//     colore enfin la carte ([PapCourseCard]) ;
//   - « Erreur réseau. Réessayer. » au lieu du message du serveur, et aucun
//     horodatage sur « Données hors-ligne (périmé). » : l'écran utilise enfin
//     les briques de #136.
// org.json = SDK Android (zéro dépendance ajoutée). Le payload est une donnée
// structurée du contrat : on lit des champs bornés, jamais de texte libre
// interprété (I6). Aucun hôte Pronote ici (I1). Heures et bornes de semaine
// EXPLICITES (zone + instant injectés) : le décalage de fuseau implicite est le
// bug connu de l'onglet EDT Papillon, on ne le reproduit pas et rien ne dépend
// de Date.now() dans les helpers.
// ponytail: pas de ViewModel, état local comme les autres écrans ; le rendu
//   passe par les briques de #136, pas par des `Text` à la main.
//   upgrade: ViewModel + StateFlow quand #82 câblerait la navigation complète.
//
// #166 — le tirail vient de `HomePullToRefresh` (#143), PLUS de
// `PullToRefreshContainer` de material3 1.2.1. En 1.2.1 ce conteneur peint son
// disque de 40 dp INCONDITIONNELLEMENT — `.background(containerColor, shape)`
// n'est pas conditionné par le geste, seul `shadow(elevation)` l'est — et au
// repos `verticalOffset == 0f` donne `translationY = 0f - height`, donc le
// disque se dessinait à cheval sur le bandeau « périmé » au lieu de sous le
// bord haut du pager. C'est ce disque gris que la passe sur appareil a photographié
// au milieu de l'EDT, sans qu'aucun geste n'ait jamais eu lieu. La brique de #143
// ne compose son icône que si `offset.value > 0f || refreshing`, anime le retour
// au repos, coupe l'overscroll natif — et elle est déjà écrite et testée : on la
// réutilise au lieu de refaire un second « tirer pour actualiser » qui serait, lui,
// animation par animation, le même défaut.

private const val MAX_SUBJECT_CHARS = 100
private const val MAX_ROOM_CHARS = 100
private const val MAX_TEACHER_CHARS = 100

private const val STATUS_NORMAL = "normal"
private const val STATUS_CANCELLED = "cancelled"
private const val STATUS_MOVED = "moved"

/** Une minute, en millisecondes. */
private const val MINUTE_MS = 60_000L

/** Instant de la pause méridienne : le creux qui CONTIENT 12 h 30 locales est la
 *  pause. Une heure fixe plutôt qu'un « trou de plus de N minutes » parce que le
 *  contrat `/v1/timetable` ne publie que des COURS : la récré de 10 h 40 et la
 *  pause de midi ne se ressemblent pas, et la seconde se situe toujours autour
 *  de midi. 12 h 30 (et non 12 h) parce que la demi-heure est dans les deux
 *  créneaux les plus répandus : 11 h 30-12 h 30 comme 12 h-13 h. */
private const val LUNCH_HOUR = 12
private const val LUNCH_MINUTE = 30

/** En dessous de 45 minutes, le creux est une récré, pas un repas. */
private const val MIN_BREAK_MINUTES = 45L

private const val LUNCH_LABEL = "Pause méridienne"

/** Battement de l'horloge de l'écran. Sans lui, « En cours » resterait collé
 *  au cours du matin pendant toute la journée, et « Aujourd'hui » ne basculerait
 *  jamais à minuit. Une minute suffit : une mise en avant à la minute près
 *  n'apprend rien à l'utilisateur. */
private const val CLOCK_TICK_MS = 60_000L

/** Cours affiché. `status`/`room`/`teacher` nuls = établissement ne publie pas. */
data class TimetableLessonUi(
    val id: String,
    val subject: String,
    val room: String?,
    val teacher: String?,
    val status: String?,
    val startMillis: Long,
    val endMillis: Long,
    val originalStartMillis: Long?,
    val originalEndMillis: Long?,
)

data class TimetableDayUi(val day: String, val lessons: List<TimetableLessonUi>)

data class TimetableWeekUi(
    val days: List<TimetableDayUi>,
    val lessons: List<TimetableLessonUi>,
    val next: TimetableLessonUi?,
)

/** Une pause déduite entre deux cours (jamais dans le payload). */
data class TimetableBreakUi(val label: String, val startMillis: Long, val endMillis: Long)

/**
 * Éléments d'une page de jour : les cours, et la pause méridienne insérée dans
 * le creux qui la contient. La pause est un TYPE, pas une carte de cours : elle
 * n'a ni matière ni salle, et lui en inventer une serait un mensonge affiché.
 */
sealed interface TimetableItemUi {
    data class Lesson(val lesson: TimetableLessonUi) : TimetableItemUi
    data class Break(val pause: TimetableBreakUi) : TimetableItemUi
}

/**
 * Mise en avant d'une carte.
 *
 * AVANT #137, aucun cours n'était mis en valeur : la liste était une suite de
 * chaînes, donc savoir si l'on est « en cours » demandait de comparer des heures
 * à l'heure qu'on avait sous les yeux.
 */
enum class CourseHighlight { NONE, NEXT, CURRENT }

/**
 * Mise en avant d'un cours : en cours > prochain > rien.
 *
 * Comparaison par HEURE DE DÉBUT, pas par `id` : un établissement peut ne pas
 * publier d'identifiant (le contrat ne l'exige pas), auquel cas tous les cours
 * porteraient la même clé — et deux cours qui commencent à la même minute sont
 * TOUS LES DEUX en cours, ce qui est vrai.
 */
fun highlightOf(
    lesson: TimetableLessonUi,
    currentStartMillis: Long?,
    nextStartMillis: Long?,
): CourseHighlight = when {
    currentStartMillis != null && lesson.startMillis == currentStartMillis -> CourseHighlight.CURRENT
    nextStartMillis != null && lesson.startMillis == nextStartMillis -> CourseHighlight.NEXT
    else -> CourseHighlight.NONE
}

private val HHMM: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.FRANCE)

// #147 : les tables `DAY_NAMES` et `MONTH_NAMES` d'ici ont DISPARU. Jours et mois
// en toutes lettres sont posés UNE fois dans `core/DateFr.kt` — jamais `EEEE` ni
// `MMMM`, qui suivent la CLDR du téléphone (« oct. », « 10月 »). Ce fichier n'en a
// plus besoin que pour trois libellés, tous délégués.

private fun bound(s: String, max: Int): String = s.trim().take(max)

/** ISO-8601 -> millis, ou null si illisible (jamais de date "NaN" affichée). */
private fun millisOf(value: String?): Long? {
    if (value.isNullOrBlank()) return null
    return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
}

/** Statut du contrat seulement : valeur inconnue = non publié (jamais devinée). */
private fun statusOf(obj: JSONObject): String? = when (obj.optString("status", "")) {
    STATUS_NORMAL, STATUS_CANCELLED, STATUS_MOVED -> obj.optString("status")
    else -> null
}

private fun optionalText(obj: JSONObject, key: String, max: Int): String? {
    if (obj.isNull(key)) return null
    val v = bound(obj.optString(key, ""), max)
    return if (v.isEmpty()) null else v
}

/** Cours annulé ? (statut du contrat seulement, jamais deviné.) */
fun TimetableLessonUi.isCancelled(): Boolean = status == STATUS_CANCELLED

/** Cours déplacé ? (statut du contrat seulement, jamais deviné.) */
fun TimetableLessonUi.isMoved(): Boolean = status == STATUS_MOVED

// Cours illisible (dates absentes/illisibles, matière vide) = ligne IGNORÉE,
// jamais une entrée à moitié remplie qui casserait l'écran.
private fun lessonFrom(obj: JSONObject): TimetableLessonUi? {
    val start = millisOf(obj.optString("start", "")) ?: return null
    val end = millisOf(obj.optString("end", "")) ?: return null
    if (end < start) return null
    val subject = bound(obj.optString("subject", ""), MAX_SUBJECT_CHARS)
    if (subject.isEmpty()) return null
    return TimetableLessonUi(
        id = obj.optString("id", ""),
        subject = subject,
        room = optionalText(obj, "room", MAX_ROOM_CHARS),
        teacher = optionalText(obj, "teacher", MAX_TEACHER_CHARS),
        status = statusOf(obj),
        startMillis = start,
        endMillis = end,
        originalStartMillis = millisOf(if (obj.isNull("originalStart")) null else obj.optString("originalStart", "")),
        originalEndMillis = millisOf(if (obj.isNull("originalEnd")) null else obj.optString("originalEnd", "")),
    )
}

/** Payload /v1/timetable -> semaine groupée par jour LOCAL + prochain cours. */
fun timetableWeekFrom(
    payload: String,
    zone: ZoneId = ZoneId.systemDefault(),
    nowMillis: Long = System.currentTimeMillis(),
): TimetableWeekUi = try {
    val root = JSONObject(payload)
    val entries = root.optJSONArray("entries") ?: JSONArray()
    val lessons = mutableListOf<TimetableLessonUi>()
    for (i in 0 until entries.length()) {
        val lesson = entries.optJSONObject(i)?.let { lessonFrom(it) } ?: continue
        lessons.add(lesson)
    }
    val byDay = LinkedHashMap<String, MutableList<TimetableLessonUi>>()
    for (lesson in lessons) {
        val key = dayKey(lesson.startMillis, zone)
        if (key.isEmpty()) continue
        byDay.getOrPut(key) { mutableListOf() }.add(lesson)
    }
    val days = byDay.entries.sortedBy { it.key }.map { (day, list) ->
        TimetableDayUi(day, list.sortedBy { it.startMillis })
    }
    TimetableWeekUi(
        days = days,
        lessons = lessons.sortedBy { it.startMillis },
        next = nextLessonOf(lessons, nowMillis),
    )
} catch (_: Exception) {
    // Cache ancien, JSON invalide, texte libre : semaine vide, aucun crash.
    TimetableWeekUi(emptyList(), emptyList(), null)
}

/** Jour local "2026-10-05" (jamais le jour UTC : c'est le bug d'offset). */
fun dayKey(millis: Long, zone: ZoneId): String =
    runCatching { Instant.ofEpochMilli(millis).atZone(zone).toLocalDate().toString() }.getOrElse { "" }

/**
 * Cours EN COURS : il a commencé et il n'est pas fini. Un cours annulé n'est
 * pas « en cours » — il ne se passe pas.
 */
fun currentLessonOf(lessons: List<TimetableLessonUi>, nowMillis: Long): TimetableLessonUi? =
    lessons
        .filter { it.startMillis <= nowMillis && nowMillis < it.endMillis && it.status != STATUS_CANCELLED }
        .minByOrNull { it.startMillis }

/**
 * Prochain cours = premier cours qui n'a pas ENCORE COMMENCÉ et n'est pas
 * annulé (un cours annulé n'est pas le prochain cours). `nowMillis` injecté :
 * aucun Date.now() caché.
 *
 * AVANT, le filtre portait sur `endMillis > nowMillis` : pendant un cours, le
 * « prochain » était le cours EN COURS, donc rien n'était jamais signalé comme
 * « à venir ». Les tests existants restent verts : ils interrogent le badge en
 * dehors des cours.
 */
fun nextLessonOf(lessons: List<TimetableLessonUi>, nowMillis: Long): TimetableLessonUi? =
    lessons
        .filter { it.startMillis > nowMillis && it.status != STATUS_CANCELLED }
        .minByOrNull { it.startMillis }

/** "08:00" dans la zone d'affichage (jamais l'heure brute du serveur). */
fun lessonTimeLabel(millis: Long, zone: ZoneId): String =
    runCatching { HHMM.format(Instant.ofEpochMilli(millis).atZone(zone)) }.getOrElse { "" }

/** "08:00–09:00", heure de début seule si la fin est illisible. */
fun lessonRangeLabel(lesson: TimetableLessonUi, zone: ZoneId): String {
    val start = lessonTimeLabel(lesson.startMillis, zone)
    val end = lessonTimeLabel(lesson.endMillis, zone)
    return if (start.isEmpty() || end.isEmpty() || end == start) start else "$start–$end"
}

/**
 * Durée d'un cours en français : « 1 min », « 55 mins », « 1h 50 mins », « 2h ».
 *
 * `min` et `h` sont les abréviations INVARIANTES du français (comme dans
 * [relativeTimeFr]) : « 55 min » comme « 4 min », donc seul le singulier se
 * distingue (« 1 min »). Une durée nulle (bornes égales) ne rend RIEN : « 0
 * mins » serait une information fausse, et un cours sans durée n'en est pas une.
 */
fun lessonDurationLabel(lesson: TimetableLessonUi): String =
    durationLabelOf(lesson.endMillis - lesson.startMillis)

/** Même chose depuis un écart en millisecondes (borne basse : jamais négatif). */
fun durationLabelOf(millis: Long): String {
    val minutes = (millis / MINUTE_MS).coerceAtLeast(0L)
    if (minutes < 1L) return ""
    if (minutes < 60L) return if (minutes == 1L) "1 min" else "$minutes mins"
    val hours = minutes / 60L
    val rest = minutes % 60L
    return if (rest == 0L) "${hours}h" else "${hours}h $rest mins"
}

/** Ligne de cours : matière (libellé prefs) • salle • prof • horaires • statut. */
fun lessonBadgeLabel(lesson: TimetableLessonUi, zone: ZoneId, label: String = lesson.subject): String {
    val parts = mutableListOf(label)
    if (!lesson.room.isNullOrEmpty()) parts.add(lesson.room)
    if (!lesson.teacher.isNullOrEmpty()) parts.add(lesson.teacher)
    val range = lessonRangeLabel(lesson, zone)
    if (range.isNotEmpty()) parts.add(range)
    val head = parts.joinToString(" • ")
    // Le mot vient de la table du contrat, MIS en minuscules : il est collé au
    // milieu de la ligne, donc « Annulé » y serait une faute de typographie
    // (#147, cf. `core/EnumFr.kt`).
    return when (lesson.status) {
        STATUS_CANCELLED -> "$head • ${enumFr(STATUS_CANCELLED).lowercase()}"
        STATUS_MOVED -> "$head • ${enumFr(STATUS_MOVED).lowercase()}" + movedFromLabel(lesson, zone)
        else -> head
    }
}

// Cours déplacé : horaire d'origine si l'établissement le publie, sinon rien
// d'affiché (jamais d'horaire deviné).
private fun movedFromLabel(lesson: TimetableLessonUi, zone: ZoneId): String {
    val hint = movedHintLabel(lesson, zone) ?: return ""
    return " ($hint)"
}

/**
 * "départ 08:00" pour un cours déplacé dont l'établissement publie l'horaire
 * d'origine, `null` sinon (jamais d'horaire deviné).
 */
fun movedHintLabel(lesson: TimetableLessonUi, zone: ZoneId): String? {
    if (!lesson.isMoved()) return null
    val from = lesson.originalStartMillis ?: return null
    val label = lessonTimeLabel(from, zone)
    return if (label.isEmpty()) null else "départ $label"
}

/** "lundi 05/10" depuis le jour local (2026-10-05) ; illisible = tel quel. */
fun timetableDayLabel(day: String): String {
    val date = runCatching { LocalDate.parse(day) }.getOrNull() ?: return day
    return dayLabelOf(date)
}

/** "Lundi" : nom du jour civil, première lettre en capitale. */
fun dayNameFr(date: LocalDate): String = weekdayCapitalizedFr(date.dayOfWeek)

/** "octobre" : nom du mois ÉCRIT (cf. `FR_MONTHS`). */
fun monthNameFr(date: LocalDate): String = monthFr(date.monthValue)

/** "5 octobre" : le contenu de la pastille de jour de l'en-tête collant. */
fun dayPillLabel(date: LocalDate): String =
    listOf(date.dayOfMonth.toString(), monthNameFr(date)).filter { it.isNotEmpty() }.joinToString(" ")

/**
 * Sous-titre de l'en-tête : « Aujourd'hui », « Hier », « Demain », sinon vide.
 *
 * Comparaison de DATES LOCALES et non d'écarts d'heures : à 23 h un jour de
 * 23 h (le changement d'heure d'automne), un écart de 2 h est le jour même.
 */
fun daySubtitleFr(date: LocalDate, today: LocalDate): String = when (date) {
    today -> "Aujourd'hui"
    today.minusDays(1) -> "Hier"
    today.plusDays(1) -> "Demain"
    else -> ""
}

/**
 * La pause méridienne entre deux cours, ou `null`.
 *
 * Le creux doit contenir 12 h 30 locales ET durer au moins 45 minutes. Une
 * heure locale fixe plutôt qu'un écart en millisecondes : autour du changement
 * d'heure, 12 h 30 tombe deux fois dans la même journée de 25 h, et « le trou
 * qui contient 12 h 30 » reste vrai dans les deux.
 */
fun lunchBreakOf(previousEndMillis: Long, nextStartMillis: Long, zone: ZoneId): TimetableBreakUi? {
    if (nextStartMillis - previousEndMillis < MIN_BREAK_MINUTES * MINUTE_MS) return null
    val noon = runCatching {
        Instant.ofEpochMilli(previousEndMillis)
            .atZone(zone)
            .toLocalDate()
            .atTime(LUNCH_HOUR, LUNCH_MINUTE)
            .atZone(zone)
            .toInstant()
            .toEpochMilli()
    }.getOrNull() ?: return null
    if (previousEndMillis > noon || nextStartMillis < noon) return null
    return TimetableBreakUi(LUNCH_LABEL, previousEndMillis, nextStartMillis)
}

/** Éléments d'une page de jour : cours triés, pause méridienne insérée. */
fun dayItemsUi(lessons: List<TimetableLessonUi>, zone: ZoneId): List<TimetableItemUi> {
    val sorted = lessons.sortedBy { it.startMillis }
    val out = mutableListOf<TimetableItemUi>()
    for (i in sorted.indices) {
        if (i > 0) {
            val pause = lunchBreakOf(sorted[i - 1].endMillis, sorted[i].startMillis, zone)
            if (pause != null) out.add(TimetableItemUi.Break(pause))
        }
        out.add(TimetableItemUi.Lesson(sorted[i]))
    }
    return out
}

// --- Arithmétique de semaine : le bug des 168 heures --------------------------

/** Lundi de la semaine contenant `millis`, en date locale. `null` si l'instant
 *  est illisible — donc jamais de lundi inventé. */
fun weekStartDate(millis: Long, zone: ZoneId): LocalDate? = runCatching {
    val date = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
    date.minusDays((date.dayOfWeek.value - 1).toLong())
}.getOrNull()

/** Lundi 00:00 (zone d'affichage) de la semaine contenant `millis`. */
fun weekStartOf(millis: Long, zone: ZoneId): Long =
    weekStartDate(millis, zone)?.atStartOfDay(zone)?.toInstant()?.toEpochMilli() ?: millis

/**
 * Semaine ± [weeks] : passage par `LocalDate.plusWeeks`, JAMAIS par 168 h.
 *
 * C'est LE correctif de #137. Les 168 h fixes de `WEEK_MS` supposent une
 * journée de 24 h sans exception, or une semaine qui traverse un changement
 * d'heure dure 167 h (passage à l'heure d'été) ou 169 h (retour à l'heure
 * d'hiver). Le cas destructeur, mesuré :
 *
 *  - la semaine du 19 octobre 2026 est à +02:00 jusqu'au dimanche 25 inclus.
 *    En AVANT de 168 h, `2026-10-19 00:00` CEST (`2026-10-18T22:00Z`) donne
 *    `2026-10-25T22:00Z`, soit DIMANCHE 23 h 00 en CET : la query
 *    `weekStart=2026-10-25` partait sur le dimanche pour le reste de la session ;
 *  - en arrière depuis la semaine du 30 mars, on obtenait de même le dimanche
 *    22 mars à 23 h (`2026-03-22T23:00Z`), et en avant depuis la semaine du 23
 *    mars, un lundi 30 mars à 01 h — un `weekStart` qui n'était plus minuit.
 *
 * `plusWeeks` travaille sur la DATE : le lundi 00 h 00 local est recalculé dans
 * la zone à chaque pas, donc l'état ne peut pas dériver. Miroir TS :
 * `tests/unit/android-timetable.test.ts`.
 */
fun shiftWeeks(weekStartMillis: Long, weeks: Long, zone: ZoneId): Long = runCatching {
    weekStartDate(weekStartMillis, zone)?.plusWeeks(weeks)
}.getOrNull()?.atStartOfDay(zone)?.toInstant()?.toEpochMilli() ?: weekStartMillis

/** "semaine du 05/10/2026". */
fun timetableWeekLabel(weekStartMillis: Long, zone: ZoneId): String = runCatching {
    val date = Instant.ofEpochMilli(weekStartMillis).atZone(zone).toLocalDate()
    val dd = date.dayOfMonth.toString().padStart(2, '0')
    val mm = date.monthValue.toString().padStart(2, '0')
    "semaine du $dd/$mm/${date.year}"
}.getOrElse { "semaine" }

/** Query de fenêtre du contrat (#76) : "weekStart=2026-10-05" (borne d'entrée). */
fun timetableWindowQuery(weekStartMillis: Long, zone: ZoneId): String {
    val day = runCatching { Instant.ofEpochMilli(weekStartMillis).atZone(zone).toLocalDate().toString() }
        .getOrNull() ?: return ""
    return "weekStart=$day"
}

// --- Écran -------------------------------------------------------------------

/**
 * Onglet EDT : un pager horizontal, une page par jour de la semaine affichée.
 *
 * Les PAGES sont les jours que le payload contient, triés : une journée sans
 * cours n'a pas de page (une page vide serait un aplat à faire défiler). Le
 * bandeau de semaine, le bandeau « périmé » et l'état (chargement / vide /
 * erreur) restent hors du pager, donc ils ne défilent pas avec les cours.
 *
 * Cache d'abord (affichage hors-ligne immédiat), refresh réseau ensuite
 * (`LaunchedEffect(weekStart)` : une seule requête par semaine affichée, la
 * query de fenêtre du contrat est donc toujours celle de la semaine VUE).
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun TimetableRoute(
    repo: SyncedRepository,
    baseUrl: String,
    subjectPrefs: List<SubjectPrefs> = emptyList(),
    onSettings: () -> Unit = {},
    onPairing: () -> Unit = {},
    onAlerts: () -> Unit = {},
) {
    val zone = remember { ZoneId.systemDefault() }
    var nowMillis by remember { mutableStateOf(System.currentTimeMillis()) }
    // #147 : la SEMAINE affichée est un état d'écran : sans sauvegarde, tourner
    // l'appareil en cours de consultation d'une autre semaine y revenait, et
    // l'en-tête changeait de date sous les cours.
    var weekStart by rememberSaveable { mutableStateOf(weekStartOf(nowMillis, zone)) }
    var refreshing by remember { mutableStateOf(false) }
    var state by remember {
        val cached = try {
            repo.cached(CachePolicy.TIMETABLE)
        } catch (_: Exception) {
            null
        }
        mutableStateOf(uiStateFromCache(cached, cached != null && repo.isStale(CachePolicy.TIMETABLE, cached)))
    }
    fun refresh() {
        // Serveur non configuré : aucun appel (I1), cache conservé.
        if (baseUrl.isBlank()) {
            state = UiState.Error("Serveur non configuré.", (state as? UiState.Data)?.payload)
            refreshing = false
            return
        }
        state = when (val s = state) {
            is UiState.Data -> s
            // Erreur avec cache : on rebascule sur les données existantes (le
            // bandeau « périmé » et le pull-to-refresh suffisent) plutôt que de
            // vider l'écran à chaque nouvelle tentative.
            is UiState.Error -> if (s.cached != null) UiState.Data(s.cached, true, 0L) else UiState.Loading
            else -> UiState.Loading
        }
        refreshing = true
        try {
            repo.refreshAsync(CachePolicy.TIMETABLE, baseUrl, timetableWindowQuery(weekStart, zone)) { o ->
                state = uiStateFromOutcome(o)
                nowMillis = System.currentTimeMillis()
                refreshing = false
            }
        } catch (_: Exception) {
            state = UiState.Error("Erreur inattendue.", (state as? UiState.Data)?.payload)
            refreshing = false
        }
    }
    // ponytail: auto-refresh à l'ouverture + navigation de semaine + pull
    // (pas de WorkManager avant le sync périodique #82). Une seule clé : un
    // LaunchedEffect par clé d'écran, pas de double appel au premier rendu.
    LaunchedEffect(weekStart) { refresh() }
    // L'horloge de l'écran (cf. CLOCK_TICK_MS) : sans elle la mise en avant du
    // cours en cours et le sous-titre « Aujourd'hui » vieilliraient.
    LaunchedEffect(Unit) {
        while (true) {
            delay(CLOCK_TICK_MS)
            nowMillis = System.currentTimeMillis()
        }
    }

    val payload = (state as? UiState.Data)?.payload ?: (state as? UiState.Error)?.cached
    val week = payload?.let { timetableWeekFrom(it, zone, nowMillis) }
    val days = week?.days ?: emptyList()
    val today = remember(nowMillis, zone) {
        runCatching { Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate() }.getOrNull()
    }
    val todayPage = days.indexOfFirst { it.day == today?.toString() }.coerceAtLeast(0)
    val pagerState = rememberPagerState(todayPage) { days.size.coerceAtLeast(1) }
    // Changement de semaine : on revient sur la page d'aujourd'hui (dans cette
    // semaine si elle y est, sinon la première), pas sur la page 0 — « la
    // semaine suivante » ne veut pas dire « le premier jour de l'écran ».
    LaunchedEffect(weekStart, days.size) {
        val target = if (todayPage in days.indices) todayPage else 0
        pagerState.scrollToPage(target)
    }
    // #166 : le tirail est celui de l'accueil (`HomePullToRefresh`, #143). Plus de
    // `LaunchedEffect(pullState…)` : la brique appelle `refresh()` au relâchement
    // au-delà du seuil et anime elle-même son propre retour au repos, donc l'écran
    // n'a plus deux états à synchroniser avec celui de l'indicateur.
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        TimetableWeekBar(
            weekStart = weekStart,
            zone = zone,
            onPrevious = { weekStart = shiftWeeks(weekStart, -1L, zone) },
            onNext = { weekStart = shiftWeeks(weekStart, 1L, zone) },
            onRefresh = { refresh() },
            onSettings = onSettings,
            onPairing = onPairing,
            onAlerts = onAlerts,
        )
        val data = state as? UiState.Data
        if (data != null && data.isStale) {
            // `fetchedAt = 0` = cache resservi depuis un état d'erreur : pas
            // d'horodatage à afficher (le bandeau prend `null`), donc aucune
            // date inventée.
            PapStaleBanner(fetchedAt = data.fetchedAt.takeIf { it > 0L }, onRefresh = { refresh() })
        }
        // #147 : relecture ratée alors que la SEMAINE EST LÀ. AVANT, l'état
        // d'erreur n'était rendu que dans la branche « aucune journée » : le
        // bandeau « hors ligne » disait l'âge des cours, jamais la cause de
        // l'échec (« 503 », « session expirée »). Une ligne, même règle que les
        // autres écrans en cache — les cours restent affichés, la cause est dite.
        val failed = state as? UiState.Error
        if (failed != null) {
            Text(
                text = failed.message,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        val next = week?.next
        val currentStartMillis = week?.let { currentLessonOf(it.lessons, nowMillis)?.startMillis }
        // #145 : la ligne du prochain cours APPARAÎT (échelle 0.9 -> 1 + opacité,
        // 300 ms mesurés) au lieu de se faire réécrire sous les yeux quand
        // l'heure change.
        PapEnter {
            if (next != null) {
                Text(
                    text = "Prochain cours · ${subjectStyle(subjectPrefs, next.subject).badge}" +
                        " · ${lessonTimeLabel(next.startMillis, zone)}",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }
        // #166 : le tirail enveloppe l'ÉTAT ENTIER, pas seulement le pager. Le
        // vide en disait « Tirez vers le bas pour actualiser » alors que la
        // connexion de défilement n'était montée que dans la branche du pager :
        // le geste y était un mensonge. Ici il est vrai partout, et il n'y a plus
        // qu'une seule implémentation du tirail dans l'application.
        HomePullToRefresh(
            refreshing = refreshing,
            onRefresh = { refresh() },
            modifier = Modifier.fillMaxSize(),
        ) {
            // #145 : changer de semaine faisait passer de « pager » à « squelette »
            // d'un frame à l'autre — la page disparaissait puis revenait, ce qui se
            // lit comme un défaut d'affichage. Ici le passage se fait en fondu, et la
            // clé est l'ÉTAT (les quatre branches sont celles d'avant).
            val stateKey = when {
                days.isEmpty() && failed != null -> "error"
                days.isEmpty() && state is UiState.Loading -> "loading"
                days.isEmpty() -> "empty"
                else -> "days"
            }
            Crossfade(targetState = stateKey, label = "timetableState") { _ -> when {
                // Contenu affiché : le pager prime. L'erreur est déjà dite en une
                // ligne plus haut (#147) — un bandeau « Réessayer » au-dessus
                // d'une semaine entière doublerait l'action du pull-to-refresh.
                days.isEmpty() && failed != null -> PapErrorState(message = failed.message, onRetry = { refresh() })
                days.isEmpty() && state is UiState.Loading -> PapLoading()
                days.isEmpty() -> PapEmptyState(
                    icon = Icons.Filled.DateRange,
                    title = "Aucun cours cette semaine",
                    description = if (baseUrl.isBlank()) {
                        "Aucun serveur configuré : appairez l'établissement pour charger l'emploi du temps."
                    } else {
                        "Tirez vers le bas pour actualiser, ou changez de semaine."
                    },
                    action = {
                        if (baseUrl.isNotBlank()) TextButton(onClick = { refresh() }) { Text("Actualiser") }
                    },
                )
                else -> HorizontalPager(
                    state = pagerState,
                    modifier = Modifier.fillMaxSize(),
                ) { page ->
                    TimetableDayPage(
                        day = days[page.coerceIn(0, days.lastIndex)],
                        today = today,
                        zone = zone,
                        subjectPrefs = subjectPrefs,
                        currentStartMillis = currentStartMillis,
                        nextStartMillis = next?.startMillis,
                    )
                }
            }
            }
        }
    }
}

/**
 * Bandeau de semaine : « semaine du 05/10/2026 », les deux flèches de semaine,
 * l'actualisation, et les trois entrées de navigation que l'écran portait
 * jusqu'ici en trois boutons pleine largeur, en bas de l'écran.
 *
 * Le contenu des trois entrées est devenu un MENU (`MoreVert`) : elles sortent
 * de l'EDT, alors que la semaine et les cours sont l'écran. Elles restent
 * atteignables en un geste, sans voler 48 dp à la liste.
 */
@Composable
private fun TimetableWeekBar(
    weekStart: Long,
    zone: ZoneId,
    onPrevious: () -> Unit,
    onNext: () -> Unit,
    onRefresh: () -> Unit,
    onSettings: () -> Unit,
    onPairing: () -> Unit,
    onAlerts: () -> Unit,
) {
    var menuOpen by remember { mutableStateOf(false) }
    Row(
        modifier = Modifier.fillMaxWidth(),
        verticalAlignment = Alignment.CenterVertically,
        // 8 dp entre les contrôles du bandeau : quatre `IconButton` de 48 dp
        // collés à 4 dp se lisaient comme un seul bloc (le pas de 8 dp des
        // groupes, appliqué à un groupe). #146.
        horizontalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        IconButton(onClick = onPrevious) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowLeft, contentDescription = "Semaine précédente")
        }
        Text(
            text = timetableWeekLabel(weekStart, zone),
            style = MaterialTheme.typography.titleMedium,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis,
            modifier = Modifier.weight(1f),
        )
        IconButton(onClick = onNext) {
            Icon(Icons.AutoMirrored.Filled.KeyboardArrowRight, contentDescription = "Semaine suivante")
        }
        IconButton(onClick = onRefresh) {
            Icon(Icons.Filled.Refresh, contentDescription = "Actualiser")
        }
        Box {
            IconButton(onClick = { menuOpen = true }) {
                Icon(Icons.Filled.MoreVert, contentDescription = "Plus d'actions")
            }
            DropdownMenu(expanded = menuOpen, onDismissRequest = { menuOpen = false }) {
                DropdownMenuItem(
                    text = { Text("Réglages", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    onClick = { menuOpen = false; onSettings() },
                )
                DropdownMenuItem(
                    text = { Text("Appairage QR+PIN", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    onClick = { menuOpen = false; onPairing() },
                )
                DropdownMenuItem(
                    text = { Text("Alertes sécurité", maxLines = 1, overflow = TextOverflow.Ellipsis) },
                    onClick = { menuOpen = false; onAlerts() },
                )
            }
        }
    }
}

/**
 * En-tête COLLANT d'une page de jour : jour en gras, pastille colorée du numéro
 * et du mois, chevron, et le sous-titre « Aujourd'hui » / « Hier ».
 *
 * La pastille prend `primaryContainer` / `onPrimaryContainer`, l'appariement
 * posé dans les DEUX schemes de #134 : correct en mode sombre, sans couleur
 * claire en dur. Le chevron est décoratif (`contentDescription = null`) : il
 * annonce la forme de la pastille de papillon.bzh, pas une action — le sélecteur
 * de date n'existe pas dans ce module et n'est pas simulé ici.
 *
 * `onSurfaceVariant` porte le sous-titre : c'est le rôle MESURÉ du thème
 * (65 %, 4.76:1 sur blanc), pas un gris posé à la main.
 */
@Composable
private fun TimetableDayHeader(
    date: LocalDate,
    today: LocalDate,
    modifier: Modifier = Modifier,
) {
    val pill = MaterialTheme.shapes.small
    val pillBg = MaterialTheme.colorScheme.primaryContainer
    val pillInk = MaterialTheme.colorScheme.onPrimaryContainer
    Column(
        modifier = modifier.fillMaxWidth().padding(bottom = 8.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Row(
            modifier = Modifier.fillMaxWidth(),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            // `heading()` : c'est le titre de la PAGE (l'en-tête collant suit le
            // défilement), donc le point d'entrée du survol pour chaque jour.
            Text(
                text = dayNameFr(date),
                style = MaterialTheme.typography.titleMedium,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.weight(1f).semantics { heading() },
            )
            Row(
                modifier = Modifier
                    .background(pillBg, pill)
                    .padding(start = 10.dp, end = 6.dp, top = 4.dp, bottom = 4.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                Text(
                    text = dayPillLabel(date),
                    style = MaterialTheme.typography.labelMedium,
                    color = pillInk,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
                Icon(
                    imageVector = Icons.Filled.KeyboardArrowDown,
                    contentDescription = null,
                    tint = pillInk,
                )
            }
        }
        val subtitle = daySubtitleFr(date, today)
        if (subtitle.isNotEmpty()) {
            Text(
                text = subtitle,
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

/**
 * Une page de jour : en-tête collant puis les cours (et la pause méridienne).
 *
 * `LazyColumn` : c'est le conteneur de défilement qui manquait (#137). Le
 * `background` de l'en-tête est celui de l'écran, sinon les cours transparaisseraient
 * dessous pendant que l'en-tête reste collé en haut.
 */
@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun TimetableDayPage(
    day: TimetableDayUi,
    today: LocalDate?,
    zone: ZoneId,
    subjectPrefs: List<SubjectPrefs>,
    currentStartMillis: Long?,
    nextStartMillis: Long?,
) {
    val date = remember(day.day) { runCatching { LocalDate.parse(day.day) }.getOrNull() }
    val items = remember(day.day, zone) { dayItemsUi(day.lessons, zone) }
    LazyColumn(
        modifier = Modifier.fillMaxSize(),
        verticalArrangement = Arrangement.spacedBy(TimetableCardGap),
        contentPadding = PaddingValues(bottom = 16.dp),
    ) {
        if (date != null && today != null) {
            stickyHeader {
                TimetableDayHeader(
                    date = date,
                    today = today,
                    modifier = Modifier.background(MaterialTheme.colorScheme.background),
                )
            }
        }
        items(items) { item ->
            when (item) {
                is TimetableItemUi.Lesson -> TimetableCourseRow(
                    lesson = item.lesson,
                    zone = zone,
                    subjectPrefs = subjectPrefs,
                    highlight = highlightOf(item.lesson, currentStartMillis, nextStartMillis),
                )
                is TimetableItemUi.Break -> PapLunchCard(
                    label = item.pause.label,
                    duration = durationLabelOf(item.pause.endMillis - item.pause.startMillis),
                    modifier = Modifier.padding(start = TimetableTimeGutterWidth + TimetableCardGap),
                )
            }
        }
    }
}

/** Gouttière de temps + carte de cours : une ligne de la page. */
@Composable
private fun TimetableCourseRow(
    lesson: TimetableLessonUi,
    zone: ZoneId,
    subjectPrefs: List<SubjectPrefs>,
    highlight: CourseHighlight,
) {
    val style = subjectStyle(subjectPrefs, lesson.subject)
    // Couleur de matière : les prefs d'abord, sinon une couleur DÉRIVÉE du nom
    // (cf. `subjectColorHex`), pour que deux cours de la même matière se
    // ressemblent même avant d'avoir réglé les préférences.
    val colorHex = subjectColorHex(subjectPrefs, lesson.subject)
    Row(horizontalArrangement = Arrangement.spacedBy(TimetableCardGap)) {
        PapLessonTimeGutter(lesson = lesson, zone = zone)
        PapCourseCard(
            lesson = lesson,
            label = style.badge,
            colorHex = colorHex,
            zone = zone,
            highlight = highlight,
            modifier = Modifier.weight(1f),
        )
    }
}