package fr.veryslopnynotes.ui

import fr.veryslopnynotes.data.CachePolicy
import fr.veryslopnynotes.data.CachedEntry
import fr.veryslopnynotes.data.SyncedRepository
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.time.LocalDate
import java.time.LocalDateTime
import java.time.ZoneId
import java.time.ZoneOffset
import java.time.format.DateTimeFormatter
import java.time.temporal.ChronoUnit
import java.util.Locale

// Données de l'accueil #143 — LECTURE DE CACHE, PAS DE REQUÊTE.
//
// AVANT, ce fichier sortait d'ISO en COMPARAISON LEXICOGRAPHIQUE (#82 :
// « format unique du contrat, .000Z », avec un `ponytail:` qui l'admettait).
// C'était faux pour deux raisons réelles :
//   - le contrat ISO-8601 admet un décalage (`+02:00`) et l'ordre des chaînes
//     n'est alors plus l'ordre des instants (« …T09:00:00+02:00 » < « …T08:30:00Z »
//     en lexicographie, alors que 09h+02:00 = 07hZ est AVANT 08h30Z) ;
//   - un horodatage illisible se triait sans erreur au lieu d'être écarté.
// #143 : `java.time` (minSdk 26 = API 26, le désucrage n'est pas même nécessaire),
// zéro dépendance ajoutée. `millis` circule désormais dans l'UI — l'heure de FIN
// de cours, qui était parsée puis JETÉE (#82), est enfin affichable.
//
// AUCUNE requête réseau ici : l'accueil lit les caches que les écrans ont déjà
// posés (offline-first #14). `homeSnapshotFrom` est la SEULE lecture, et
// `HOME_WIDGET_RESOURCES` la seule liste rechargée par le pull-refresh.
//
// ponytail: pas de `ViewModel` ni de `StateFlow` (l'écran relit le cache quand le
//   compteur de révision change) ; pas de bibliothèque de dates ; pas de
//   dépendance aux écrans voisins (`NewsScreen`, `CanteenMenus`, `Attendance`,
//   `MessagesScreen` sont réécrits par d'autres vagues) — chaque état lit le
//   champ affiché du cache, ce qui garde ce fichier compilable seul.
// Upgrade: un état `HomeUiState` + ViewModel quand l'accueil aura son propre
// refresh (balayage de toutes les ressources) plutôt qu'un relu de cache.

private const val HOME_MAX_ITEMS = 5

/** Longueur d'une ligne d'état d'accès rapide : au-delà, la ligne déborde. */
private const val HOME_STATUS_CHARS = 34

private val HOME_DAY_NAMES =
    listOf("dimanche", "lundi", "mardi", "mercredi", "jeudi", "vendredi", "samedi")

/** Heure seule, 24 h. Format POSÉ : jamais `MMM`/`a` (CLDR du téléphone). */
private val HOME_CLOCK: DateTimeFormatter = DateTimeFormatter.ofPattern("HH:mm", Locale.FRANCE)

/** Cache absent : une phrase par état d'accès rapide, jamais une valeur devinée. */
const val HOME_NO_CACHE = "Aucune donnée en cache"

// --- Dates -------------------------------------------------------------------

/**
 * ISO-8601 du contrat -> millis, `null` si la date est illisible.
 *
 * Le contrat date en UTC avec suffixe `Z` (`format: date-time`,
 * [shared/contracts/api.openapi.yaml]) ; un horodatage SANS fuseau est donc lu
 * en UTC — c'est l'hypothèse que faisait déjà la comparaison de chaînes, mais en
 * vrai parsing. Une date SEULE (« 2026-10-05 », que `isIsoDate` du contrat
 * accepte) vaut minuit UTC : le jour de service de la cantine compte alors juste,
 * quelle que soit l'heure du téléphone. Un horodatage illisible vaut `null` : la
 * ligne est écartée au lieu d'être triée n'importe comment.
 */
fun homeMillisOf(iso: String): Long? {
    val value = iso.trim()
    if (value.isEmpty()) return null
    return runCatching { Instant.parse(value).toEpochMilli() }.getOrNull()
        ?: runCatching { LocalDateTime.parse(value).toInstant(ZoneOffset.UTC).toEpochMilli() }.getOrNull()
        ?: runCatching { LocalDate.parse(value).atStartOfDay(ZoneOffset.UTC).toInstant().toEpochMilli() }.getOrNull()
}

/** Écart en JOURS entre l'ancre et l'instant, dans la zone d'affichage. */
fun dayOffsetOf(millis: Long, nowMillis: Long, zone: ZoneId): Long = runCatching {
    val there = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
    ChronoUnit.DAYS.between(today, there)
}.getOrDefault(0L)

/** "08:00" dans la zone d'affichage (jamais l'heure brute du serveur). */
fun homeTimeLabel(millis: Long, zone: ZoneId): String =
    runCatching { HOME_CLOCK.format(Instant.ofEpochMilli(millis).atZone(zone)) }.getOrDefault("")

/**
 * "08:00–09:00" : l'heure de FIN est affichée avec celle du début.
 *
 * #82 parsait `end` puis ne l'affichait nulle part (et ne s'en servait que pour
 * filtrer les cours terminés). Une fin illisible ou égale au début = heure de
 * début seule : jamais « 08:00–08:00 », qui lirait comme un cours d'une minute.
 */
fun homeRangeLabel(startMillis: Long, endMillis: Long, zone: ZoneId): String {
    val start = homeTimeLabel(startMillis, zone)
    val end = homeTimeLabel(endMillis, zone)
    if (start.isEmpty() || end.isEmpty() || end == start) return start
    return "$start–$end"
}

/** "Aujourd’hui", "Demain", "Hier", sinon "mardi 07/10" (jour LOCAL, cf. #136). */
fun homeDayLabel(millis: Long, nowMillis: Long, zone: ZoneId): String = when (dayOffsetOf(millis, nowMillis, zone)) {
    0L -> "Aujourd’hui"
    1L -> "Demain"
    -1L -> "Hier"
    else -> runCatching {
        val date = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
        val dd = date.dayOfMonth.toString().padStart(2, '0')
        val mm = date.monthValue.toString().padStart(2, '0')
        "${HOME_DAY_NAMES[date.dayOfWeek.value % 7]} $dd/$mm"
    }.getOrDefault("")
}

/**
 * Titre du widget cours, forme Papillon : « Prochain cours » pour aujourd'hui,
 * « Demain » le lendemain, sinon la date.
 *
 * Aucun cours = chaîne vide : l'appelant ne rend alors pas de widget, donc
 * jamais un titre sans contenu.
 */
fun homeCourseTitle(lessons: List<HomeLessonUi>, nowMillis: Long, zone: ZoneId): String {
    val first = lessons.firstOrNull() ?: return ""
    return when (dayOffsetOf(first.startMillis, nowMillis, zone)) {
        0L -> "Prochain cours"
        1L -> "Demain"
        else -> homeDayLabel(first.startMillis, nowMillis, zone)
    }
}

// --- Cours, devoirs, notes ---------------------------------------------------

data class HomeLessonUi(val subject: String, val room: String, val startMillis: Long, val endMillis: Long)

data class HomeHomeworkUi(val subject: String, val title: String, val dueMillis: Long)

data class HomeGradeUi(val subject: String, val note: String, val dateMillis: Long)

/** Statut du contrat, tel que publié. Un cours annulé n'est pas le prochain. */
private const val HOME_STATUS_CANCELLED = "cancelled"

/**
 * Cours encore en cours ou à venir, triés par DÉBUT croissant.
 *
 * On écarte ce qui est illisible (pas de matière, dates absentes ou non
 * analysables, fin avant début) et les cours annulés : annoncer « Prochain
 * cours : Français » pour un cours annulé est un fait faux.
 */
fun upcomingLessonsFrom(payload: String, nowMillis: Long, limit: Int = 3): List<HomeLessonUi> {
    return try {
        val entries: JSONArray = JSONObject(payload).optJSONArray("entries") ?: JSONArray()
        val out = mutableListOf<HomeLessonUi>()
        for (i in 0 until entries.length()) {
            val o: JSONObject = entries.optJSONObject(i) ?: continue
            val subject = o.optString("subject", "").trim()
            val start = homeMillisOf(o.optString("start", ""))
            val end = homeMillisOf(o.optString("end", ""))
            if (subject.isEmpty() || start == null || end == null) continue
            if (end < start) continue
            if (end <= nowMillis) continue
            if (o.optString("status", "").trim() == HOME_STATUS_CANCELLED) continue
            out.add(HomeLessonUi(subject, o.optString("room", "").trim(), start, end))
        }
        out.sortedBy { it.startMillis }.take(if (limit > 0) limit else HOME_MAX_ITEMS)
    } catch (_: Exception) {
        emptyList()
    }
}

/** Devoirs à rendre (non faits), du plus proche au plus lointain. */
fun pendingHomeworkFrom(payload: String, nowMillis: Long, limit: Int = 3): List<HomeHomeworkUi> {
    return try {
        val arr: JSONArray = JSONObject(payload).optJSONArray("assignments") ?: JSONArray()
        val out = mutableListOf<HomeHomeworkUi>()
        for (i in 0 until arr.length()) {
            val o: JSONObject = arr.optJSONObject(i) ?: continue
            val subject = o.optString("subject", "").trim()
            val title = o.optString("title", "").trim()
            val due = homeMillisOf(o.optString("dueDate", ""))
            if (subject.isEmpty() || title.isEmpty() || due == null) continue
            if (o.optBoolean("done", false)) continue
            if (due <= nowMillis) continue
            out.add(HomeHomeworkUi(subject, title, due))
        }
        out.sortedBy { it.dueMillis }.take(if (limit > 0) limit else HOME_MAX_ITEMS)
    } catch (_: Exception) {
        emptyList()
    }
}

/**
 * Dernières notes, de la plus récente à la plus ancienne.
 *
 * #139 a livré le VRAI lecteur du payload `/v1/grades` (`gradesFrom`, dates
 * déjà analysées, tri décroissant, notes hors contrat écartées) : l'accueil
 * n'en relit pas le JSON, il se contente de garder les trois champs dont sa
 * carte a besoin (matière, « 15,5/20 », millis). Un seul propriétaire du JSON
 * des notes, donc pas deux règles de tri à maintenir.
 */
fun latestGradesFrom(payload: String, limit: Int = 3): List<HomeGradeUi> {
    val grades = gradesFrom(payload)
    return grades
        .take(if (limit > 0) limit else HOME_MAX_ITEMS)
        .map { HomeGradeUi(it.subject, gradeValueLabel(it.value) + scaleSuffix(it.scale), it.millis) }
}

/** "13,75" : la moyenne en GRAND, donc sans zéros inutiles ("14", pas "14,00"). */
fun homeAverageNumberLabel(value: Double): String {
    if (value.isNaN()) return ""
    val mark = formatMark(value)
    return if (mark.endsWith(",00")) mark.dropLast(3) else if (mark.endsWith("0")) mark.dropLast(1) else mark
}

// --- Accès rapides -----------------------------------------------------------

/**
 * Un accès rapide de la grille 2×2 : route, titre, UNE ligne d'état tirée du
 * cache, et l'entrée de palette dont il porte la couleur.
 *
 * [colorHex] vient de `SubjectPalette` (la seule palette de `PapillonTheme.kt`)
 * par indice dans [homeQuickActions] : aucune couleur en dur, et l'ordre des
 * accès étant fixe, l'association couleur ↔ carte ne peut pas bouger.
 */
data class HomeQuickActionUi(
    val route: String,
    val title: String,
    val status: String,
    val colorHex: String,
)

/**
 * Tableau d'un payload de ressource, par sa clé de CONTRAT ; `null` si le
 * cache est absent ou illisible.
 *
 * Une seule clé, celle du contrat (`news`, `menus`, `absences`,
 * `discussions`) : une liste de clés candidates serait une clé devinée, donc une
 * source de données qui n'existe pas.
 *
 * (pas `arrayOf`, qui est la fonction vararg de la stdlib : la masquer dans ce
 * fichier rendrait tout `arrayOf(...)` de lecture ambigu).
 */
private fun jsonArrayOf(payload: String?, key: String): JSONArray? {
    if (payload == null) return null
    return try {
        JSONObject(payload).optJSONArray(key)
    } catch (_: Exception) {
        null
    }
}

/** Une ligne d'état tient sur une ligne : au-delà, elle est coupée au mot. */
fun homeEllipsis(text: String, max: Int = HOME_STATUS_CHARS): String {
    val value = text.trim()
    if (value.isEmpty() || max <= 0) return value
    return if (value.length <= max) value else value.take(max - 1).trimEnd() + "…"
}

/**
 * « Une absence », « 3 absences », « Aucune absence » — le français du compte,
 * accent inclus : le genre est un paramètre parce qu'« absence » est féminin et
 * « retard » masculin, et « Une absence » / « Aucune retard » seraient faux.
 */
fun homeCountLabel(count: Int, singular: String, plural: String, feminine: Boolean = true): String = when {
    count <= 0 -> if (feminine) "Aucune $singular" else "Aucun $singular"
    count == 1 -> if (feminine) "Une $singular" else "Un $singular"
    else -> "$count $plural"
}

/**
 * Actualités : le titre de la plus récente, coupé à une ligne.
 *
 * Contenu de l'établissement = DONNÉE affichée (I6) : on ne rend que le titre,
 * jamais de corps, jamais d'instruction. Aucun titre lisible = « Aucune
 * actualité » (l'établissement n'en publie aucune), pas une valeur inventée.
 */
fun homeNewsStatus(payload: String?): String {
    val arr = jsonArrayOf(payload, "news") ?: return HOME_NO_CACHE
    var bestTitle = ""
    var bestMillis = Long.MIN_VALUE
    for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val title = o.optString("title", "").trim()
        if (title.isEmpty()) continue
        val millis = homeMillisOf(o.optString("publishedAt", "")) ?: continue
        if (millis > bestMillis) {
            bestMillis = millis
            bestTitle = title
        }
    }
    if (bestTitle.isEmpty()) return "Aucune actualité"
    return homeEllipsis(bestTitle)
}

/**
 * Cantine : « Menu du jour » si le cache publie le jour, sinon le premier menu
 * à venir avec sa date, sinon « Aucun menu publié ».
 */
fun homeCanteenStatus(payload: String?, nowMillis: Long, zone: ZoneId): String {
    val arr = jsonArrayOf(payload, "menus") ?: return HOME_NO_CACHE
    var bestMillis = 0L
    var bestOffset = Long.MAX_VALUE
    for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val millis = homeMillisOf(o.optString("date", "")) ?: continue
        val offset = dayOffsetOf(millis, nowMillis, zone)
        if (offset < 0 || offset >= bestOffset) continue
        bestOffset = offset
        bestMillis = millis
    }
    if (bestOffset == Long.MAX_VALUE) return "Aucun menu publié"
    if (bestOffset == 0L) return "Menu du jour"
    return "Menu ${homeDayLabel(bestMillis, nowMillis, zone)}"
}

/**
 * Vie scolaire : absences et retards du cache.
 *
 * Un compteur absent reste absent (« Aucune absence ») — jamais « 0 » : le
 * contrat ne publie pas forcément la période, et un 0 attribué serait une
 * donnée inventée (I6).
 */
fun homeAttendanceStatus(payload: String?): String {
    val arr = jsonArrayOf(payload, "absences") ?: return HOME_NO_CACHE
    var absences = 0
    var late = 0
    for (i in 0 until arr.length()) {
        when (arr.optJSONObject(i)?.optString("kind", "")?.trim()) {
            "late" -> late++
            "absence" -> absences++
        }
    }
    if (absences == 0 && late == 0) return "Aucune absence"
    val head = homeCountLabel(absences, "absence", "absences")
    // Le compteur de retards n'apparaît qu'à partir de 1 : écrire « Aucun
    // retard » à côté de « Une absence » n'apprend rien et allonge la ligne.
    return if (late == 0) head else "$head · ${homeCountLabel(late, "retard", "retards", feminine = false)}"
}

/**
 * Messages : les non lus d'abord (« 3 non lus »), sinon le sujet du fil le
 * plus récemment mis à jour.
 *
 * `unreadCount = -1` signifie « l'établissement ne publie pas le compteur »
 * (`DiscussionRules.UNKNOWN_UNREAD`) : on ne l'ajoute donc à aucun total, et
 * on retombe sur le sujet plutôt que d'annoncer « 0 non lu ».
 */
fun homeMessagesStatus(payload: String?): String {
    val arr = jsonArrayOf(payload, "discussions") ?: return HOME_NO_CACHE
    var unread = 0
    var unreadKnown = true
    var bestSubject = ""
    var bestMillis = Long.MIN_VALUE
    for (i in 0 until arr.length()) {
        val o = arr.optJSONObject(i) ?: continue
        val count = o.optDouble("unreadCount", Double.NaN)
        if (count.isNaN() || count < 0) {
            unreadKnown = false
        } else {
            unread += count.toInt()
        }
        val subject = o.optString("subject", "").trim()
        if (subject.isEmpty()) continue
        val millis = homeMillisOf(o.optString("updatedAt", "")) ?: continue
        if (millis > bestMillis) {
            bestMillis = millis
            bestSubject = subject
        }
    }
    if (unreadKnown && unread > 0) {
        return homeCountLabel(unread, "message non lu", "messages non lus", feminine = false)
    }
    if (bestSubject.isEmpty()) return "Aucun fil"
    return homeEllipsis(bestSubject)
}

/**
 * La grille d'accès rapides, dans l'ordre de Papillon : Actualités, Cantine,
 * Vie scolaire, Messages.
 *
 * `payload = null` = ressource jamais synchronisée → [HOME_NO_CACHE], ce qui est
 * une information vraie (« je n'ai rien reçu »), pas un échec à masquer.
 *
 * ponytail: quatre accès en dur, pas une table de capacités (#87) : un
 *   établissement qui ne publie pas l'actualité affiche « Aucune donnée en
 *   cache », et l'écran correspondant reste vide proprement.
 * Upgrade: croiser `Capabilities` quand l'accueil recevra la liste des onglets
 *   actifs — une ligne de filtre, pas une refonte.
 */
fun homeQuickActions(
    news: String?,
    menus: String?,
    attendance: String?,
    discussions: String?,
    nowMillis: Long,
    zone: ZoneId,
): List<HomeQuickActionUi> = listOf(
    HomeQuickActionUi(ROUTE_NEWS, "Actualités", homeNewsStatus(news), homeTintHex(0)),
    HomeQuickActionUi(ROUTE_CANTEEN, "Cantine", homeCanteenStatus(menus, nowMillis, zone), homeTintHex(1)),
    HomeQuickActionUi(ROUTE_ATTENDANCE, "Vie scolaire", homeAttendanceStatus(attendance), homeTintHex(2)),
    HomeQuickActionUi(ROUTE_MESSAGES, "Messages", homeMessagesStatus(discussions), homeTintHex(3)),
)

/**
 * Couleur d'un accès rapide : l'entrée n de [SubjectPalette].
 *
 * Palette de matière = la SEULE liste de couleurs du thème, donc zéro hex en
 * dur ici. L'encre et le pastel sont dérivés plus loin par `subjectContent`
 * (−45 %, 4.87:1 au pire) et `subjectSurface` (+75 %), tous deux mesurés dans
 * `PapillonTheme.kt`.
 */
private fun homeTintHex(index: Int): String =
    SubjectPalette.getOrNull(index) ?: SubjectPalette.first()

// --- Lecture des caches ------------------------------------------------------

/**
 * Ce que l'accueil affiche, relu du cache — l'unique source de la page.
 *
 * [fetchedAt] = l'horodatage LE PLUS ANCIEN des trois ressources widget : c'est
 * l'âge honnête de la page (mélanger le plus récent donnerait un bandeau
 * « mis à jour à l'instant » alors qu'un widget peut être vieux de jours).
 * `null` = rien de synchronisé, donc bandeau sans date plutôt qu'une date fausse.
 */
data class HomeSnapshotUi(
    val timetable: String? = null,
    val grades: String? = null,
    val assignments: String? = null,
    val news: String? = null,
    val menus: String? = null,
    val attendance: String? = null,
    val discussions: String? = null,
    val fetchedAt: Long? = null,
    val stale: Boolean = false,
)

/** Ressources rechargées par le pull-refresh de l'accueil : les trois widgets. */
val HOME_WIDGET_RESOURCES = listOf(CachePolicy.TIMETABLE, CachePolicy.GRADES, CachePolicy.ASSIGNMENTS)

/**
 * Lecture synchrone des caches (fichiers petits, comme partout ailleurs dans le
 * module). Un cache illisible = absent : l'accueil affiche alors l'état vide,
 * jamais une exception.
 */
fun homeSnapshotFrom(repo: SyncedRepository): HomeSnapshotUi {
    fun entry(resource: String): CachedEntry? = try {
        repo.cached(resource)
    } catch (_: Exception) {
        null
    }

    fun staleOf(resource: String, value: CachedEntry?): Boolean =
        value != null && runCatching { repo.isStale(resource, value) }.getOrDefault(false)

    val timetable = entry(CachePolicy.TIMETABLE)
    val grades = entry(CachePolicy.GRADES)
    val assignments = entry(CachePolicy.ASSIGNMENTS)
    val widgets = listOfNotNull(timetable, grades, assignments)
    return HomeSnapshotUi(
        timetable = timetable?.payload,
        grades = grades?.payload,
        assignments = assignments?.payload,
        news = entry(CachePolicy.NEWS)?.payload,
        menus = entry(CachePolicy.MENUS)?.payload,
        attendance = entry(CachePolicy.ATTENDANCE)?.payload,
        discussions = entry(CachePolicy.DISCUSSIONS)?.payload,
        fetchedAt = widgets.minOfOrNull { it.fetchedAt },
        stale = staleOf(CachePolicy.TIMETABLE, timetable) ||
            staleOf(CachePolicy.GRADES, grades) ||
            staleOf(CachePolicy.ASSIGNMENTS, assignments),
    )
}

/**
 * L'accueil a-t-il quelque chose à montrer ? Sans ça, `PapEmptyState`.
 *
 * Un accès rapide COMPTE dès que sa ressource est en cache : « l'établissement
 * n'a publié aucune actualité » est une information, pas un vide.
 */
fun homeHasContent(
    lessons: List<HomeLessonUi>,
    average: GeneralAverageUi?,
    homework: List<HomeHomeworkUi>,
    cachedActions: Int,
): Boolean = average != null || lessons.isNotEmpty() || homework.isNotEmpty() || cachedActions > 0