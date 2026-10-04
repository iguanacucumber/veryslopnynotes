package fr.veryslopnynotes.ui

import fr.veryslopnynotes.core.monthFr
import fr.veryslopnynotes.core.weekdayFr
import java.time.Instant
import java.time.LocalDate
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.temporal.ChronoUnit

// #141 : LOGIQUE PURE de l'écran « Vie scolaire ». Rien ici ne compose : ces
// fonctions prennent des données du contrat et rendent des chaînes, donc leur
// miroir se teste sans téléphone (`tests/unit/android-attendance.test.ts`).
//
// AVANT #141, la seule mise en forme était `minutesLabel` et l'écran concaténait
// tout : « Retard 2026-10-01 -> 2026-10-02 en Maths (45min) non justifiee ». Une
// date ISO brute, aucune structure, aucune couleur. Ces règles pilotent
// l'ÉCRAN, pas le payload : le JSON reste la donnée affichée telle quelle.
//
// Réutilisé tel quel, jamais re-dérivé : `gradeValueLabel` (virgule française)
// de `Averages.kt`, `PeriodUi` / `periodsFrom` / `periodLabel` de la même vague
// (#139, premier vrai appel à `/v1/periods`), `absenceKindLabel` de
// `Attendance.kt`.
//
// ponytail: pas de bibliothèque de dates (date-fns, ThreeTen…) — `java.time`
// suffit (minSdk 26 = API 26). Les noms de mois et de jours sont des TABLES
// FRANÇAISES posées, pas `MMMM` : le nom long dépend de la CLDR du téléphone
// (« 10月 » sur un appareil japonais). Cf. le même arbitrage dans
// `relativeTimeFr` et `formatMark`.

// #147 : les tables `MONTHS_FR` et `WEEKDAYS_FR` d'ici ont DISPARU. Elles étaient
// la CINQUIÈME copie du nom de jour (et la DEUXIÈME du nom de mois), dans un
// ordre inversé (lundi d'abord) : même donnée, deux indexations, donc une
// obligation d'y toucher à chaque correction. Les noms sont maintenant ceux de
// `core/DateFr.kt` — posés, jamais `EEEE`/`MMMM` (CLDR du téléphone).

/** Au-delà de 30 jours d'écart, compter en jours n'aide plus : on passe au mois. */
private const val DAYS_IN_MONTH_LIMIT = 30L

/** Mois d'une année : au-delà, on compte en années. */
private const val MONTHS_IN_YEAR = 12L

/** Regex du numéro de tranche dans un libellé (« Trimestre 1 » -> 1). */
private val PERIOD_NUMBER_RE = Regex("(\\d+)")

/** ISO-8601 -> millis. `null` si la date est absente ou illisible : aucune date
 *  n'est devinée, donc aucune date n'est affichée.
 *
 *  Deux formes, parce que le contrat les admet toutes les deux : un INSTANT
 *  (`2026-10-01T08:00:00.000Z`, ce que publie Pronote) et une DATE SEULE
 *  (`2026-10-01`), rendue au début de la journée du fuseau du téléphone.
 *
 *  [zone] est injectable pour que le miroir TS soit déterministe ; par défaut
 *  c'est le fuseau de l'appareil, comme partout ailleurs dans le module.
 */
fun attendanceMillis(iso: String, zone: ZoneId = ZoneId.systemDefault()): Long? {
    val raw = iso.trim()
    if (raw.isEmpty()) return null
    val instant = runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
    if (instant != null) return instant
    return runCatching { LocalDate.parse(raw).atStartOfDay(zone).toInstant().toEpochMilli() }.getOrNull()
}

/**
 * Jour calendaire en toutes lettres : « mercredi 18 novembre ».
 *
 * L'année n'est écrite que si elle diffère de celle de [now] : une absence de
 * l'année en cours se lit « mercredi 18 novembre », celle d'il y a trois ans se
 * lit « mercredi 18 novembre 2023 » — sans elle, la ligne serait ambiguë.
 */
fun absoluteDayFr(millis: Long, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String {
    val day = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
    val here = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val head = "${weekdayFr(day.dayOfWeek)} ${day.dayOfMonth} ${monthFr(day.monthValue)}"
    return if (day.year == here.year) head else "$head ${day.year}"
}

/**
 * Distance en français, comme chez Papillon : « aujourd'hui », « hier »,
 * « demain », « il y a 6 jours », « dans 3 mois », « il y a 2 ans ».
 *
 * L'écart se compte en JOURS CIVILS (`ChronoUnit.DAYS` entre deux `LocalDate`),
 * jamais en millisecondes : à 00 h 10, une absence de la veille à 23 h 55 est
 * bien « hier », pas « dans 10 minutes » — et une absence de demain à 23 h est
 * bien « demain », pas « dans 23 h ».
 *
 * `mois` ne porte jamais le singulier, `an` et `jour` le portent.
 */
fun relativeDayFr(millis: Long, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String {
    val day = Instant.ofEpochMilli(millis).atZone(zone).toLocalDate()
    val today = Instant.ofEpochMilli(now).atZone(zone).toLocalDate()
    val days = ChronoUnit.DAYS.between(today, day)
    if (days == 0L) return "aujourd'hui"
    if (days == -1L) return "hier"
    if (days == 1L) return "demain"
    val past = days < 0L
    val gap = if (past) -days else days
    val prefix = if (past) "il y a " else "dans "
    if (gap <= DAYS_IN_MONTH_LIMIT) return "$prefix$gap jours"
    // Écart de mois POSÉ : (année2 - année1) x 12 + (mois2 - mois1). Le jour du
    // mois n'entre pas dans le calcul — « 3 mois » est un mois rond, comme chez
    // Papillon, et une règle que le miroir TS recalcule à l'identique.
    val months = (day.year - today.year) * 12L + (day.monthValue - today.monthValue).toLong()
    val gapMonths = if (months < 0L) -months else months
    if (gapMonths in 1 until MONTHS_IN_YEAR) return "$prefix$gapMonths mois"
    val years = gapMonths / MONTHS_IN_YEAR
    return "$prefix$years an" + if (years > 1L) "s" else ""
}

/**
 * Les DEUX dates d'une ligne, comme chez Papillon : « dans 3 mois · mercredi
 * 18 novembre ». La distance répond « quand », le jour répond « lequel ».
 */
fun schoolDateLabel(millis: Long, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String =
    "${relativeDayFr(millis, now, zone)} · ${absoluteDayFr(millis, now, zone)}"

/** Même chose depuis la chaîne ISO du contrat ; chaîne vide si la date est
 *  illisible (aucune ligne de date ne s'affiche alors). */
fun schoolDateLabel(iso: String, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String =
    attendanceMillis(iso, zone)?.let { schoolDateLabel(it, now, zone) }.orEmpty()

/**
 * Étendue d'une absence : la date simple, ou le couple début → fin quand
 * l'absence couvre plusieurs JOURS.
 *
 * `dateEnd` est dans le contrat et était JETÉ avant #141 (la ligne concaténée ne
 * l'utilisait pas). Une absence de trois jours affichait une seule date : on ne
 * voyait pas qu'il fallait revenir trois jours. Un `dateEnd` du MÊME jour que le
 * début (cas courant : 8 h → 12 h) n'est pas une étendue, donc n'est pas affiché.
 */
fun absenceDateSpan(row: AbsenceUi, now: Long = System.currentTimeMillis(), zone: ZoneId = ZoneId.systemDefault()): String {
    val start = attendanceMillis(row.date, zone) ?: return ""
    val head = schoolDateLabel(start, now, zone)
    val end = row.dateEnd?.let { attendanceMillis(it, zone) } ?: return head
    if (end == start) return head
    val startDay = Instant.ofEpochMilli(start).atZone(zone).toLocalDate()
    val endDay = Instant.ofEpochMilli(end).atZone(zone).toLocalDate()
    if (startDay == endDay) return head
    return "$head → ${absoluteDayFr(end, now, zone)}"
}

/** Durée en toutes lettres : « 4 h 12 min », « 1 h », « 45 min », « 0 min ». */
fun durationLongFr(minutes: Int): String {
    val safe = if (minutes < 0) 0 else minutes
    if (safe < 60) return "$safe min"
    val rest = safe % 60
    return if (rest == 0) "${safe / 60} h" else "${safe / 60} h $rest min"
}

/**
 * Carte de statut : tout est justifié, ou pas.
 *
 * [clean] = aucune heure INJUSTIFIÉE. Une absence justifiée manque toujours des
 * heures, mais elle n'est pas due : c'est la différence que la carte annonce,
 * et c'est elle qui décide de la couleur (vert / ambre).
 *
 * [unjustifiedMinutes] est ce que l'établissement n'a pas justifié, [totalMinutes]
 * tout ce qui manque — les deux sont affichés, donc l'utilisateur voit ce qu'il
 * doit justifier ET ce qu'il a manqué. Un `justified` absent de la publication
 * n'est PAS compté comme injustifié : l'établissement n'a rien affirmé, donc la
 * carte ne peut pas l'accuser.
 */
data class AttendanceStatusUi(
    val clean: Boolean,
    val eventCount: Int,
    val totalMinutes: Int,
    val unjustifiedCount: Int,
    val unjustifiedMinutes: Int,
    val title: String,
    val detail: String,
)

/** Statut du lot affiché, à partir des lignes filtrées (période ou année). */
fun attendanceStatus(rows: List<AbsenceUi>): AttendanceStatusUi {
    val unjustified = rows.filter { it.justified == false }
    // `minutes` absent = durée non publiée : elle compte pour zéro, jamais pour 1.
    val total = rows.sumOf { it.minutes?.coerceAtLeast(0) ?: 0 }
    val pending = unjustified.sumOf { it.minutes?.coerceAtLeast(0) ?: 0 }
    val clean = unjustified.isEmpty()
    return AttendanceStatusUi(
        clean = clean,
        eventCount = rows.size,
        totalMinutes = total,
        unjustifiedCount = unjustified.size,
        unjustifiedMinutes = pending,
        title = if (clean) "Aucune heure injustifiée" else "Des heures injustifiées",
        detail = if (clean) {
            "Toutes les absences et tous les retards publiés sont justifiés."
        } else {
            val n = unjustified.size
            "${durationLongFr(pending)} sur ${durationLongFr(total)} manquées · " +
                "$n ${if (n <= 1) "événement" else "événements"} sans justificatif"
        },
    )
}

/**
 * Sections de l'écran : « Absences » puis « Retards », une seule fois chacune, et
 * seulement si elle a des lignes (une section vide est du bruit, pas une info).
 *
 * L'ordre est FIXE (absences d'abord) et pas celui du payload : la lecture d'un
 * bilan de vie scolaire suit le poids, pas l'ordre de saisie de l'établissement.
 */
data class AttendanceSectionUi(val kind: String, val title: String, val rows: List<AbsenceUi>)

fun attendanceSections(rows: List<AbsenceUi>): List<AttendanceSectionUi> =
    listOf("absence", "late").mapNotNull { kind ->
        val group = rows.filter { it.kind == kind }
        if (group.isEmpty()) null else AttendanceSectionUi(kind, absenceKindLabel(kind), group)
    }

/**
 * Titre d'une carte d'événement : le MOTIF déclaré (« Rendez-vous médical »),
 * sinon la matière, sinon le type d'événement.
 *
 * Le motif est le seul texte libre du contrat, donc c'est lui qui porte le titre
 * — mais une carte sans titre est un aplat : à défaut, on dit ce qu'on sait
 * vraiment (la matière, ou « Absence » / « Retard »), jamais un UUID.
 */
fun absenceTitle(row: AbsenceUi): String =
    row.motif?.trim()?.takeIf { it.isNotEmpty() }
        ?: row.subject?.trim()?.takeIf { it.isNotEmpty() }
        ?: absenceKindLabel(row.kind)

/** « justifiée », « non justifiée », ou vide si l'établissement n'affirme rien
 *  (pas de badge inventé : une pastille « non justifiée » sur une absence dont
 *  personne n'a parlé serait une accusation). */
fun justifiedBadge(justified: Boolean?): String = when (justified) {
    true -> "justifiée"
    false -> "non justifiée"
    null -> ""
}

/** Une absence est-elle explicitement INJUSTIFIÉE ? `justified = null` ne l'est
 *  pas : l'établissement n'a rien affirmé, donc rien n'est compté contre
 *  l'étudiant. */
fun isUnjustified(row: AbsenceUi): Boolean = row.justified == false

/**
 * Une tranche de la vie scolaire : nom, bornes de dates et compteurs publiés.
 *
 * [period] repasse le même objet à `GradesPeriodChips` — le sélecteur de période
 * DÉJÀ écrit par #139 (ligne DÉFILABLE, cf. `Competences.kt`), donc le rendu n'en
 * écrit pas un second.
 */
data class AttendancePeriodUi(
    val id: String,
    val name: String,
    val absences: Int,
    val late: Int,
    val minutes: Int,
    val startMillis: Long?,
    val endMillis: Long?,
) {
    val period: PeriodUi get() = PeriodUi(id, name, startMillis, endMillis)
}

/**
 * Tranches de la vie scolaire : la liste COMPLÈTE de `/v1/periods` (les
 * trimestres/semestres, y compris ceux sans aucune absence) complétée par les
 * compteurs de `/v1/attendance`.
 *
 * Pourquoi les deux : `attendancePeriods` côté serveur ne crée une tranche que
 * pour les absences qui la portent, donc un trimestre sans aucune absence
 * disparaîtrait du sélecteur — et l'utilisateur ne pourrait plus le choisir pour
 * vérifier qu'il n'a rien. `/v1/periods` donne la liste exhaustive, le payload
 * d'absence donne les compteurs ; la jointure est par `periodId`.
 *
 * Repli : sans `/v1/periods` (hors-ligne), les compteurs seuls font une liste
 * utilisable — moins complète, jamais fausse. L'ordre des tranches est celui du
 * contrat, donc « Trimestre 1 » vient avant « Trimestre 2 ».
 *
 * ponytail: une tranche des compteurs ABSENTE de `/v1/periods` est ignorée
 * (elle n'a pas de libellé ni de bornes). Upgrade: réconcilier sur la plage
 * `[start, end]` quand l'établissement ne publie pas les deux listes.
 */
fun attendancePeriods(periods: List<PeriodUi>, counts: List<PeriodCountUi>): List<AttendancePeriodUi> {
    if (periods.isEmpty()) {
        return counts.map { c ->
            AttendancePeriodUi(
                id = c.periodId,
                name = c.name,
                absences = c.absences,
                late = c.late,
                minutes = c.minutes,
                startMillis = null,
                endMillis = null,
            )
        }
    }
    val byId = counts.associateBy { it.periodId }
    return periods.map { p ->
        val c = byId[p.id]
        AttendancePeriodUi(
            id = p.id,
            name = p.name,
            absences = c?.absences ?: 0,
            late = c?.late ?: 0,
            minutes = c?.minutes ?: 0,
            startMillis = p.startMillis,
            endMillis = p.endMillis,
        )
    }
}

/** Numéro de tranche pour la pastille du titre : « Trimestre 1 » -> « 1 ».
 *  `null` = le libellé ne porte aucun numéro (« Année »), donc aucune pastille
 *  n'est inventée. */
fun periodNumberLabel(name: String): String? = PERIOD_NUMBER_RE.find(name)?.groupValues?.get(1)

/**
 * Gravité d'une sanction, ÉTiquetée : « Niveau 1 ».
 *
 * `gravity` est une ÉCHELLE LIBRE de l'établissement (le contrat dit
 * « gravité publiée », le lecteur Pronote y met la durée d'exclusion) : l'app ne
 * connaît pas son unité, donc elle ne l'invente pas — elle rend un NIVEAU, ce
 * qui reste vrai quelle que soit l'échelle. `null`/illisible = aucune étiquette
 * (l'établissement ne publie pas de gravité).
 *
 * Le nombre passe par `gradeValueLabel` (virgule française, zéros inutiles
 * retirés) : un niveau se lit « Niveau 1 », pas « Niveau 1,00 ».
 */
fun gravityLabel(gravity: String?): String? {
    val raw = gravity?.trim().orEmpty()
    if (raw.isEmpty()) return null
    val value = raw.toDoubleOrNull() ?: return null
    if (value.isNaN() || value.isInfinite()) return null
    return "Niveau ${gradeValueLabel(value)}"
}