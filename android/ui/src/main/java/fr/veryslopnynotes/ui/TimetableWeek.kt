package fr.veryslopnynotes.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextDecoration
import androidx.compose.ui.unit.dp
import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.SubjectPrefs
import fr.veryslopnynotes.data.SyncedRepository
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// #76 parité Papillon, onglet EDT : vue semaine (jours groupés), cours annulés
// barrés/grisés, cours déplacé affiché avec son horaire d'origine, badge
// "prochain cours" + salle. org.json = SDK Android (zéro dépendance ajoutée).
// Le payload est une donnée structurée du contrat : on lit des champs bornés,
// jamais de texte libre interprété (I6). Aucun hôte Pronote ici (I1).
// Heures et bornes de semaine EXPLICITES (zone + instant injectés) : le décalage
// de fuseau implicite est le bug connu de l'onglet EDT Papillon, on ne le
// reproduit pas et rien ne dépend de Date.now() dans les helpers.
// ponytail: pas de ViewModel, état local comme NewsRoute/CanteenRoute ;
//   upgrade: ViewModel + StateFlow quand #82 câblerait la navigation complète.

private const val MAX_SUBJECT_CHARS = 100
private const val MAX_ROOM_CHARS = 100
private const val MAX_TEACHER_CHARS = 100

private const val STATUS_NORMAL = "normal"
private const val STATUS_CANCELLED = "cancelled"
private const val STATUS_MOVED = "moved"

private const val WEEK_MS = 7L * 24L * 60L * 60L * 1000L

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

private val HHMM: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.FRANCE)
private val DAY_NAMES = listOf("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")

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
 * Prochain cours = premier cours non terminé et non annulé (un cours annulé
 * n'est pas le prochain cours). `nowMillis` injecté : aucun Date.now() caché.
 */
fun nextLessonOf(lessons: List<TimetableLessonUi>, nowMillis: Long): TimetableLessonUi? =
    lessons
        .filter { it.endMillis > nowMillis && it.status != STATUS_CANCELLED }
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

/** Ligne de cours : matière (libellé prefs) • salle • prof • horaires • statut. */
fun lessonBadgeLabel(lesson: TimetableLessonUi, zone: ZoneId, label: String = lesson.subject): String {
    val parts = mutableListOf(label)
    if (!lesson.room.isNullOrEmpty()) parts.add(lesson.room)
    if (!lesson.teacher.isNullOrEmpty()) parts.add(lesson.teacher)
    val range = lessonRangeLabel(lesson, zone)
    if (range.isNotEmpty()) parts.add(range)
    val head = parts.joinToString(" • ")
    return when (lesson.status) {
        STATUS_CANCELLED -> "$head • annulé"
        STATUS_MOVED -> "$head • déplacé" + movedFromLabel(lesson, zone)
        else -> head
    }
}

// Cours déplacé : horaire d'origine si l'établissement le publie, sinon rien
// d'affiché (jamais d'horaire deviné).
private fun movedFromLabel(lesson: TimetableLessonUi, zone: ZoneId): String {
    val from = lesson.originalStartMillis ?: return ""
    val label = lessonTimeLabel(from, zone)
    return if (label.isEmpty()) "" else " (départ $label)"
}

/** "lundi 05/10" depuis le jour local (2026-10-05). */
fun timetableDayLabel(day: String): String {
    val date = runCatching { LocalDate.parse(day) }.getOrNull() ?: return day
    val dd = date.dayOfMonth.toString().padStart(2, '0')
    val mm = date.monthValue.toString().padStart(2, '0')
    return "${DAY_NAMES[date.dayOfWeek.value % 7]} $dd/$mm"
}

/** Lundi 00:00 (zone d'affichage) de la semaine contenant `millis`. */
fun weekStartOf(millis: Long, zone: ZoneId): Long = runCatching {
    val date = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
    date.minusDays((date.dayOfWeek.value - 1).toLong()).atStartOfDay(zone).toInstant().toEpochMilli()
}.getOrElse { millis }

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

// Onglet EDT : cache d'abord (affichage hors-ligne immédiat), refresh réseau
// ensuite. Aucun cours = état vide propre, jamais de spinner infini.
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
    var weekStart by remember { mutableStateOf(weekStartOf(nowMillis, zone)) }
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
            return
        }
        state = when (val s = state) {
            is UiState.Data -> s
            is UiState.Error -> if (s.cached != null) UiState.Data(s.cached, true, 0L) else UiState.Loading
            else -> UiState.Loading
        }
        try {
            repo.refreshAsync(CachePolicy.TIMETABLE, baseUrl, timetableWindowQuery(weekStart, zone)) { o ->
                state = uiStateFromOutcome(o)
                nowMillis = System.currentTimeMillis()
            }
        } catch (_: Exception) {
            state = UiState.Error("Erreur inattendue.", (state as? UiState.Data)?.payload)
        }
    }
    // ponytail: auto-refresh à l'ouverture + navigation de semaine + bouton
    // (pas de WorkManager avant le sync périodique #82). Une seule clé : un
    // LaunchedEffect par clé d'écran, pas de double appel au premier rendu.
    LaunchedEffect(weekStart) { refresh() }

    val payload = (state as? UiState.Data)?.payload ?: (state as? UiState.Error)?.cached
    val week = payload?.let { timetableWeekFrom(it, zone, nowMillis) }
    val next = week?.next
    Column(
        modifier = Modifier.fillMaxSize().padding(16.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        Text("Calendrier")
        Text(timetableWeekLabel(weekStart, zone))
        Text("EDT semaine")
        Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
            Button(onClick = { weekStart -= WEEK_MS }) { Text("‹") }
            Button(onClick = { weekStart += WEEK_MS }) { Text("›") }
            Button(onClick = { refresh() }) { Text("Actualiser") }
        }
        if (next != null) {
            // Badge prochain cours : matière, salle, prof et horaires.
            Text("Prochain cours")
            Text(lessonBadgeLabel(next, zone, subjectStyle(subjectPrefs, next.subject).badge))
        }
        if ((state as? UiState.Data)?.isStale == true) Text("Données hors-ligne (périmé).")
        val days = week?.days ?: emptyList()
        if (days.isEmpty()) {
            when (state) {
                UiState.Empty -> Text("Aucun cours en cache. Actualisez pour charger la semaine.")
                UiState.Loading -> Text("Chargement…")
                is UiState.Error -> Text("Erreur réseau. Réessayer.")
                else -> Text("Aucun cours cette semaine.")
            }
        } else {
            for (day in days) {
                Text(timetableDayLabel(day.day))
                for (lesson in day.lessons) {
                    val style = subjectStyle(subjectPrefs, lesson.subject)
                    val color = colorFromHex(style.colorHex) ?: Color.Unspecified
                    // Cours annulé = gris + barré ; déplacé = mentioning l'origine.
                    Text(
                        lessonBadgeLabel(lesson, zone, style.badge),
                        // #134 : `Color.LightGray` en dur mesurait 1.5:1 sur
                        // surface claire, et ne s'adaptait pas au thème
                        // sombre. L'encre de marque à 70 % mesure 5.58:1 sur
                        // blanc et suit la surface en mode sombre.
                        color = if (lesson.status == STATUS_CANCELLED) {
                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.70f)
                        } else {
                            color
                        },
                        textDecoration = if (lesson.status == STATUS_CANCELLED) TextDecoration.LineThrough else null,
                    )
                }
            }
        }
        Button(onClick = { onSettings() }) { Text("Réglages") }
        Button(onClick = { onPairing() }) { Text("Appairage QR+PIN") }
        Button(onClick = { onAlerts() }) { Text("Alertes sécurité") }
    }
}