package fr.veryslopnynotes.ui

import org.json.JSONArray
import org.json.JSONObject
import java.time.OffsetDateTime
import java.time.ZoneId
import java.time.format.DateTimeFormatter
import java.util.Locale

// #139 : LECTURE ET MISE EN FORME du rapport de moyennes + des notes de
// l'onglet Notes. Avant ce fichier, l'écran n'affichait que
// `averages.general.{value,origin}` et vidait le reste du payload en JSON brut
// tronqué ; `subjects[]`, `history[]`, `influences[]`, `general.subjectCount`
// et les champs `coefficient` / `bonus` / `optional` / `classAverage` /
// `classMin` / `classMax` / `periodId` / `label` / `teacher` de chaque note
// étaient RÉCUPÉRÉS JAMAIS AFFICHÉS.
//
// org.json = SDK Android (aucune dépendance ajoutée). Tout ce qui est lu ici
// est une DONNÉE structurée du contrat 0.7.0 (`shared/contracts/models.ts`) :
// aucune clé lue n'est interprétée, aucun texte libre n'est exécuté (I6/I7).
// Champ absent = l'établissement ne le publie pas -> `null` / `false`, jamais 0,
// jamais "" bidon, jamais une valeur devinée.
//
// Le rendu (Canvas, cartes, chips) vit dans `GradesHero.kt` / `GradesRows.kt` ;
// ce fichier ne contient QUE de la logique pure, donc son miroir est
// `tests/unit/android-averages.test.ts`.

/** Barème de sortie du rapport : TOUJOURS /20 (`server/domain/averages.ts`). */
const val AVERAGE_SCALE = 20.0

/** Algorithmes du contrat (`AVERAGE_ALGORITHMS`) : moy. des matières / pondérée / médiane. */
const val ALGORITHM_SUBJECT = "subject"
const val ALGORITHM_WEIGHTED = "weighted"
const val ALGORITHM_MEDIAN = "median"

const val ALGORITHM_DEFAULT = ALGORITHM_SUBJECT

/** Les trois choix du sélecteur, dans l'ordre du contrat. */
val AVERAGE_ALGORITHM_CHOICES: List<String> = listOf(ALGORITHM_SUBJECT, ALGORITHM_WEIGHTED, ALGORITHM_MEDIAN)

// Bornes de lecture. Les tailles viennent du contrat et du routeur
// (`PERIOD_ID_MAX_CHARS = 64`) : un champ plus long est tronqué comme le
// serveur le ferait, pas rejeté (une liste d'affichage n'échoue jamais).
private const val MAX_SUBJECT_CHARS = 100
private const val MAX_LABEL_CHARS = 200
private const val MAX_TEACHER_CHARS = 100
private const val MAX_PERIOD_NAME_CHARS = 100
private const val MAX_PERIOD_ID_CHARS = 64

/** Nombre de notes du carrousel « Nouvelles notes ». */
private const val RECENT_GRADES_LIMIT = 12

// --- Modèles d'affichage ----------------------------------------------------

/** Moyenne générale seule (mention fournie/estimée), lue depuis le rapport. */
data class GeneralAverageUi(
    val value: Double,
    val provided: Boolean,
    val algorithm: String,
)

/** Moyenne d'UNE matière : `value` nul = période sans note exploitable. */
data class SubjectAverageUi(
    val subject: String,
    val value: Double?,
    val provided: Boolean,
    val gradeCount: Int,
)

/** Point d'historique : moyenne générale recalculée à chaque note. */
data class HistoryPointUi(val millis: Long, val value: Double?)

/** Influence d'UNE note sur la moyenne générale (positif = elle fait monter). */
data class InfluenceUi(val gradeId: String, val subject: String, val impact: Double)

/** Note affichable : tous les champs absents du contrat valent `null`/`false`. */
data class GradeUi(
    val id: String,
    val subject: String,
    val value: Double,
    val scale: Double,
    val coefficient: Double?,
    val millis: Long,
    val classAverage: Double?,
    val classMin: Double?,
    val classMax: Double?,
    val periodId: String?,
    val bonus: Boolean,
    val optional: Boolean,
    val label: String?,
    val teacher: String?,
)

/** Tranche scolaire publiée par l'établissement (`Period`). */
data class PeriodUi(val id: String, val name: String, val startMillis: Long?, val endMillis: Long?)

/**
 * Le rapport de moyennes du contrat, en une fois.
 *
 * `periodId` n'y figure PAS : c'est l'ID que l'app a demandé, donc le serveur
 * ne fait que le renvoyer (`/v1/grades?periodId=…`) — l'écran affiche le
 * libellé de la période qu'il a choisie, jamais un identifiant opaque.
 */
data class AveragesUi(
    val algorithm: String,
    val generalValue: Double?,
    val provided: Boolean,
    val subjectCount: Int,
    val subjects: List<SubjectAverageUi>,
    val history: List<HistoryPointUi>,
    val influences: List<InfluenceUi>,
)

/** Une matière : sa moyenne (contrat) et ses notes (affichage). */
data class GradeGroupUi(
    val subject: String,
    val average: Double?,
    val provided: Boolean,
    val grades: List<GradeUi>,
)

// --- Lecture du JSON --------------------------------------------------------

private fun boundText(value: String?, max: Int): String? {
    val out = value?.trim().orEmpty()
    return if (out.isEmpty() || out.length > max) null else out
}

/** ISO-8601 -> millis. Absent/illisible = `null` (jamais une date affichée « - »). */
private fun millisOf(value: String?): Long? {
    val raw = value?.trim().orEmpty()
    if (raw.isEmpty()) return null
    return runCatching { OffsetDateTime.parse(raw).toInstant().toEpochMilli() }.getOrNull()
}

/** Nombre du contrat borné : `null` si absent, `null` ou non fini. */
private fun numberOf(obj: JSONObject, key: String): Double? {
    if (obj.isNull(key)) return null
    val v = obj.optDouble(key, Double.NaN)
    return if (v.isNaN() || v.isInfinite()) null else v
}

/** Vrai si le contrat le déclare, faux sinon (jamais déduit). */
private fun flagOf(obj: JSONObject, key: String): Boolean = obj.optBoolean(key, false)

private fun originIsProvided(origin: String): Boolean = origin == "provided"

private fun subjectAverageFrom(obj: JSONObject): SubjectAverageUi? {
    val subject = boundText(obj.optString("subject", ""), MAX_SUBJECT_CHARS) ?: return null
    val origin = obj.optString("origin", "")
    if (origin != "provided" && origin != "estimated") return null
    return SubjectAverageUi(
        subject = subject,
        value = numberOf(obj, "value"),
        provided = originIsProvided(origin),
        gradeCount = obj.optInt("gradeCount", 0).coerceAtLeast(0),
    )
}

private fun historyPointFrom(obj: JSONObject): HistoryPointUi? {
    val millis = millisOf(obj.optString("date", "")) ?: return null
    return HistoryPointUi(millis = millis, value = numberOf(obj, "value"))
}

private fun influenceFrom(obj: JSONObject): InfluenceUi? {
    val id = boundText(obj.optString("gradeId", ""), MAX_PERIOD_ID_CHARS) ?: return null
    val subject = boundText(obj.optString("subject", ""), MAX_SUBJECT_CHARS) ?: return null
    val impact = numberOf(obj, "impact") ?: return null
    return InfluenceUi(gradeId = id, subject = subject, impact = impact)
}

private fun gradeFrom(obj: JSONObject): GradeUi? {
    val id = boundText(obj.optString("id", ""), MAX_PERIOD_ID_CHARS) ?: return null
    val subject = boundText(obj.optString("subject", ""), MAX_SUBJECT_CHARS) ?: return null
    val value = numberOf(obj, "value") ?: return null
    val scale = numberOf(obj, "scale") ?: return null
    if (value < 0 || scale <= 0) return null
    val date = millisOf(obj.optString("date", "")) ?: return null
    val coefficient = numberOf(obj, "coefficient")
    return GradeUi(
        id = id,
        subject = subject,
        value = value,
        scale = scale,
        coefficient = if (coefficient != null && coefficient > 0) coefficient else null,
        millis = date,
        classAverage = numberOf(obj, "classAverage"),
        classMin = numberOf(obj, "classMin"),
        classMax = numberOf(obj, "classMax"),
        periodId = boundText(obj.optString("periodId", ""), MAX_PERIOD_ID_CHARS),
        bonus = flagOf(obj, "bonus"),
        optional = flagOf(obj, "optional"),
        label = boundText(obj.optString("label", ""), MAX_LABEL_CHARS),
        teacher = boundText(obj.optString("teacher", ""), MAX_TEACHER_CHARS),
    )
}

private fun periodFrom(obj: JSONObject): PeriodUi? {
    val id = boundText(obj.optString("id", ""), MAX_PERIOD_ID_CHARS) ?: return null
    val name = boundText(obj.optString("name", ""), MAX_PERIOD_NAME_CHARS) ?: return null
    val start = millisOf(obj.optString("start", ""))
    val end = millisOf(obj.optString("end", ""))
    // Tranche incohérente (fin avant début) = donnée illisible : ignorée.
    if (start != null && end != null && end < start) return null
    return PeriodUi(id = id, name = name, startMillis = start, endMillis = end)
}

private fun <T> itemsOf(array: JSONArray?, read: (JSONObject) -> T?): List<T> {
    if (array == null) return emptyList()
    val out = ArrayList<T>(array.length())
    for (i in 0 until array.length()) {
        val obj = array.optJSONObject(i) ?: continue
        read(obj)?.let { out.add(it) }
    }
    return out
}

/**
 * Payload `/v1/grades` -> rapport de moyennes.
 *
 * `null` = payload sans `averages` (cache 0.1.0, serveur sans moyennes) : aucun
 * chiffre n'est inventé, l'écran affiche ses états vides.
 */
fun averagesFrom(payload: String?): AveragesUi? = try {
    if (payload == null) null else JSONObject(payload).optJSONObject("averages")?.let { averages ->
        val algorithm = averages.optString("algorithm", "").let {
            if (it in AVERAGE_ALGORITHM_CHOICES) it else ALGORITHM_DEFAULT
        }
        val general = averages.optJSONObject("general")
        val origin = general?.optString("origin", "").orEmpty()
        if (general == null || (origin != "provided" && origin != "estimated")) {
            null
        } else {
            AveragesUi(
                algorithm = algorithm,
                generalValue = numberOf(general, "value"),
                provided = originIsProvided(origin),
                subjectCount = general.optInt("subjectCount", 0).coerceAtLeast(0),
                subjects = itemsOf(averages.optJSONArray("subjects"), ::subjectAverageFrom),
                // L'historique est une COURBE : on le garde dans l'ordre du
                // contrat (dates croissantes) pour que la sparkline soit lisible.
                history = itemsOf(averages.optJSONArray("history"), ::historyPointFrom),
                influences = itemsOf(averages.optJSONArray("influences"), ::influenceFrom),
            )
        }
    }
} catch (_: Exception) {
    // Cache ancien, JSON invalide, texte libre : aucun rapport, aucun crash.
    null
}

/** Payload `/v1/grades` -> notes (triées du plus récent au plus ancien). */
fun gradesFrom(payload: String?): List<GradeUi> = try {
    if (payload == null) emptyList() else {
        itemsOf(JSONObject(payload).optJSONArray("grades"), ::gradeFrom)
            .sortedByDescending { it.millis }
    }
} catch (_: Exception) {
    emptyList()
}

/** Payload `/v1/periods` -> tranches de l'établissement, dans l'ordre du contrat. */
fun periodsFrom(payload: String?): List<PeriodUi> = try {
    if (payload == null) emptyList() else itemsOf(JSONObject(payload).optJSONArray("periods"), ::periodFrom)
} catch (_: Exception) {
    emptyList()
}

/** La moyenne générale seule, à partir du rapport DÉJÀ lu (pas un second parse). */
fun generalAverageOf(report: AveragesUi?): GeneralAverageUi? {
    if (report == null) return null
    val value = report.generalValue ?: return null
    return GeneralAverageUi(value = value, provided = report.provided, algorithm = report.algorithm)
}

/** "12,50/20 (moyenne fournie)" ou "(moyenne estimée, algorithme subject)". */
fun averageLabel(a: GeneralAverageUi?): String {
    if (a == null) return "Moyenne indisponible."
    val value = formatMark(a.value)
    val origin = if (a.provided) "fournie" else "estimée"
    val algo = if (a.provided || a.algorithm.isEmpty()) "" else ", algorithme ${a.algorithm}"
    return "$value/20 (moyenne $origin$algo)"
}

// --- Mise en forme (français, jamais d'ISO) ---------------------------------

private val DATE_FR: DateTimeFormatter = DateTimeFormatter.ofPattern("dd/MM/yyyy", Locale.FRANCE)

/**
 * Valeur sur 2 décimales, virgule française : 14.5 -> "14,50".
 *
 * Format POSÉ (`dd/MM/yyyy` plus la locale) et non `MMM` : le nom court du
 * mois dépend de la CLDR du téléphone (« oct. », « oct », « 10月 »). Cf. le
 * même arbitrage dans `PapComponents.relativeTimeFr`.
 */
fun formatMark(value: Double, decimals: Int = 2): String {
    if (value.isNaN() || value.isInfinite()) return "—"
    val digits = decimals.coerceIn(0, 4)
    return String.format(Locale.FRANCE, "%.${digits}f", value)
}

/** Note affichée sans zéros inutiles : 15 -> "15", 15.5 -> "15,5". */
fun gradeValueLabel(value: Double): String {
    val two = formatMark(value)
    return when {
        two.endsWith(",00") -> two.dropLast(3)
        two.endsWith("0") -> two.dropLast(1)
        else -> two
    }
}

/** "/20", ou le barème réel quand l'évaluation sort de l'échelle (/10, /15). */
fun scaleSuffix(scale: Double): String = if (scale <= 0 || scale.isNaN()) "" else "/${gradeValueLabel(scale)}"

/** "Trimestre 1 · 01/09/2026 – 30/11/2026" (bornes absentes = libellé seul). */
fun periodLabel(period: PeriodUi): String {
    val start = period.startMillis?.let { dateFr(it) }
    val end = period.endMillis?.let { dateFr(it) }
    val range = when {
        start != null && end != null -> "$start – $end"
        start != null -> "depuis le $start"
        end != null -> "jusqu'au $end"
        else -> ""
    }
    return if (range.isEmpty()) period.name else "${period.name} · $range"
}

private fun dateFr(millis: Long, zone: ZoneId = ZoneId.systemDefault()): String = runCatching {
    DATE_FR.format(java.time.Instant.ofEpochMilli(millis).atZone(zone))
}.getOrElse { "" }

/** Titre de l'algorithme, comme chez Papillon (« Moyenne des matières »). */
fun algorithmLabel(algorithm: String): String = when (algorithm) {
    ALGORITHM_SUBJECT -> "Moyenne des matières"
    ALGORITHM_WEIGHTED -> "Moyenne pondérée"
    ALGORITHM_MEDIAN -> "Médiane des notes"
    else -> "Moyenne générale"
}

/** Libellé court du chip d'algorithme. */
fun algorithmChipLabel(algorithm: String): String = when (algorithm) {
    ALGORITHM_SUBJECT -> "Matières"
    ALGORITHM_WEIGHTED -> "Pondérée"
    ALGORITHM_MEDIAN -> "Médiane"
    else -> "Moyenne"
}

/**
 * Provenance de la moyenne, comme chez Papillon : « par l'établissement » quand
 * elle est PUBLIÉE, sinon « estimée au <date> ».
 *
 * La date d'estimation n'est pas un champ du contrat : c'est le DERNIER point
 * d'historique, c'est-à-dire le jour où l'algorithme a été recalculé avec les
 * notes connues (donnée dérivée, affichée comme telle ; sans historique, on
 * n'invente pas de date et l'on écrit seulement « estimée »).
 */
fun originLabel(provided: Boolean, estimatedAtMillis: Long?): String {
    if (provided) return "par l'établissement"
    val date = estimatedAtMillis?.let { dateFr(it) }.orEmpty()
    return if (date.isEmpty()) "estimée" else "estimée au $date"
}

/** Influence d'une note, en phrase : « te fait gagner 0,42 de moyenne ». */
fun influenceLabel(impact: Double): String {
    if (impact.isNaN() || impact.isInfinite()) return "Cette note ne change pas ta moyenne"
    // Sous le centième, l'écart n'est pas affichable : une influence de 0,004
    // ne doit pas s'annoncer « gagner 0,00 ».
    val rounded = formatMark(Math.abs(impact))
    if (rounded == "0,00") return "Cette note ne change pas ta moyenne"
    val verb = if (impact > 0) "gagner" else "perdre"
    return "Cette note te fait $verb $rounded de moyenne"
}

/**
 * Contexte d'une note : coefficient, bonus, facultatif, enseignant, moyennes de
 * classe. Partie vide = établissement qui ne publie pas (jamais de « — » ni de 0).
 */
fun gradeContextLabel(grade: GradeUi): String {
    val parts = mutableListOf<String>()
    val coefficient = grade.coefficient
    if (coefficient != null && coefficient != 1.0) {
        parts.add("Coeff. ${gradeValueLabel(coefficient)}")
    }
    if (grade.bonus) parts.add("Bonus")
    if (grade.optional) parts.add("Facultatif")
    val teacher = grade.teacher
    if (!teacher.isNullOrEmpty()) parts.add(teacher)
    val classAverage = grade.classAverage
    if (classAverage != null) parts.add("Moyenne de classe ${gradeValueLabel(classAverage)}")
    val min = grade.classMin
    val max = grade.classMax
    if (min != null && max != null) parts.add("De ${gradeValueLabel(min)} à ${gradeValueLabel(max)}")
    return parts.joinToString(" · ")
}

// --- Sélection : période, recherche, regroupement ---------------------------

/**
 * Query du contrat pour `/v1/grades` : `algorithm=…&periodId=…`.
 *
 * L'algorithme est validé contre la liste du contrat (le serveur répond 400 à
 * une valeur inconnue) et le `periodId` est borné à 64 caractères comme le
 * routeur. Aucun paramètre n'est une saisie libre : les deux viennent de listes
 * fermées (chips d'algorithme, tranches de `/v1/periods`).
 */
fun gradesQuery(algorithm: String, periodId: String?): String {
    val chosen = if (algorithm in AVERAGE_ALGORITHM_CHOICES) algorithm else ALGORITHM_DEFAULT
    val parts = mutableListOf("algorithm=${queryValue(chosen)}")
    val id = periodId?.trim()?.take(MAX_PERIOD_ID_CHARS).orEmpty()
    if (id.isNotEmpty()) parts.add("periodId=${queryValue(id)}")
    return parts.joinToString("&")
}

/** Encodage minimal : alphanumériques inchangés, le reste en %XX (I1 : aucune adresse). */
private fun queryValue(value: String): String {
    val out = StringBuilder()
    for (c in value) {
        val safe = c in 'a'..'z' || c in 'A'..'Z' || c in '0'..'9' || c == '-' || c == '_' || c == '.'
        if (safe) out.append(c) else out.append('%').append("%02X".format(c.code))
    }
    return out.toString()
}

/**
 * Notes de la période choisie.
 *
 * `/v1/grades` renvoie TOUTES les notes et ne filtre que le RAPPORT de moyennes :
 * le regroupement par période se fait donc ici, sur le `periodId` publié par
 * l'établissement. Aucune période choisie = aucune filtre.
 *
 * ponytail: si AUCUNE note ne porte de `periodId` (établissement qui ne publie
 * pas l'appartenance), le filtre ne peut rien retirer et l'on garde les notes
 * telles quelles — un écran vide serait un mensonge. Upgrade: filtrer sur la
 * plage `Period.{start,end}` quand l'établissement ne publie pas `periodId`.
 */
fun gradesForPeriod(grades: List<GradeUi>, periodId: String?): List<GradeUi> {
    val id = periodId?.trim().orEmpty()
    if (id.isEmpty()) return grades
    val inPeriod = grades.filter { it.periodId == id }
    if (inPeriod.isNotEmpty()) return inPeriod
    return if (grades.none { !it.periodId.isNullOrEmpty() }) grades else emptyList()
}

/** Minuscules, sans accents ni bords : la recherche « maths » trouve « Mathématiques ». */
fun foldForSearch(value: String): String = java.text.Normalizer
    .normalize(value, java.text.Normalizer.Form.NFD)
    .replace("\\p{InCombiningDiacriticalMarks}+".toRegex(), "")
    .lowercase(Locale.FRANCE)
    .trim()

/** Recherche sur la matière, le libellé de l'évaluation et l'enseignant. */
fun gradeMatches(grade: GradeUi, query: String): Boolean {
    val needle = foldForSearch(query)
    if (needle.isEmpty()) return true
    val haystacks = listOfNotNull(grade.subject, grade.label, grade.teacher)
    return haystacks.any { foldForSearch(it).contains(needle) }
}

/** Notes les plus récentes d'abord (déjà triées par [gradesFrom], on re-tranche). */
fun recentGrades(grades: List<GradeUi>, limit: Int = RECENT_GRADES_LIMIT): List<GradeUi> =
    grades.sortedByDescending { it.millis }.take(limit.coerceAtLeast(0))

/**
 * Regroupement par matière pour l'affichage : moyenne du contrat + notes de la
 * matière, triées par moyenne décroissante (les matières sans moyenne exploitable
 * passent après, par ordre de nom).
 *
 * Le regroupement se fait sur le NOM EXACT de la matière (comme `subjectStyle`),
 * pas sur une clé sans accents : deux libellés distincts restent deux sections,
 * et aucune n'est fusionnée sous un nom qui n'est pas celui du contrat.
 */
fun gradeGroups(grades: List<GradeUi>, subjects: List<SubjectAverageUi>): List<GradeGroupUi> {
    val byName = LinkedHashMap<String, MutableList<GradeUi>>()
    for (grade in grades) byName.getOrPut(grade.subject) { mutableListOf() }.add(grade)
    val averages = subjects.associateBy { it.subject }
    val names = LinkedHashSet<String>()
    names.addAll(averages.keys)
    names.addAll(byName.keys)
    return names.map { name ->
        val average = averages[name]
        GradeGroupUi(
            subject = name,
            average = average?.value,
            provided = average?.provided ?: false,
            grades = byName[name]?.sortedByDescending { it.millis } ?: emptyList(),
        )
    }.sortedWith(compareByDescending<GradeGroupUi> { it.average ?: Double.NEGATIVE_INFINITY }.thenBy { it.subject })
}

/** Influence d'une note dans le rapport, ou `null` si l'établissement n'en publie aucune. */
fun influenceOf(influences: List<InfluenceUi>, gradeId: String): InfluenceUi? =
    influences.firstOrNull { it.gradeId == gradeId }

// --- Décision d'affichage de l'onglet Notes (#162) ---------------------------

/**
 * Ce que l'onglet Notes doit rendre, décidé par une fonction PURE (donc testée
 * dans `tests/unit/android-averages.test.ts`, sans téléphone).
 *
 * [content] : le corps montre des notes ou des moyennes. Sinon l'écran est un
 * état UNIQUE — un message, une action, et dessous NIEN : ni recherche, ni
 * période, ni puces d'algorithme, ni titre de section. La capture réelle
 * (#162) montrait l'inverse : un gros bloc d'erreur au milieu de la page, puis
 * les contrôles, puis des liens de navigation sous le vide.
 *
 * [data] : il y a quelque chose à LISTER ou à MOYENNER. Un payload lu mais
 * sans note exploitable ne justifie pas les puces d'algorithme (le sélecteur
 * n'a rien à changer) ni le titre « Moyennes par matière » (rien à moyenner).
 */
data class GradesLayout(val content: Boolean, val data: Boolean)

/**
 * Décide de l'affichage de l'onglet Notes à partir de l'ÉTAT et des DONNÉES
 * déjà lues.
 *
 * L'état seul ne suffit pas, et les deux questions sont distinctes :
 *   - `Error` garde le cache ([UiState.Error.cached]) : les notes restent
 *     affichées, périmées, avec la cause de l'échec en une ligne — un plein
 *     écran d'erreur alors que des notes existent serait un mensonge ;
 *   - `Data` peut ne porter aucune note exploitable : c'est du CONTENU (le
 *     serveur a répondu) qui n'a rien à montrer, donc un seul message.
 *
 * ponytail: deux booléens plutôt qu'une hiérarchie de sealed classes — l'écran
 * ne pose que ces deux questions, et le rendu reste dans le fichier d'écran.
 */
fun gradesLayout(state: UiState, grades: List<GradeUi>, report: AveragesUi?): GradesLayout = GradesLayout(
    content = when (state) {
        is UiState.Data -> true
        is UiState.Error -> state.cached != null
        UiState.Loading, UiState.Empty -> false
    },
    data = report != null || grades.isNotEmpty(),
)

// --- Sparkline (Canvas dessiné à la main, aucune bibliothèque) -------------

/** Un point de la courbe, en pixels du `Canvas` (y vers le bas). */
data class SparkPoint(val x: Float, val y: Float)

/**
 * Géométrie de la sparkline de l'historique : une liste de points déjà
 * positionnés dans le rectangle du `Canvas`.
 *
 * Règles, toutes VOLONTAIRES :
 *   - un point sans valeur (`null`, période sans note exploitable) est IGNORÉ :
 *     la courbe relie les points connus, elle n'invente pas de valeur ;
 *   - moins de deux valeurs = AUCUNE ligne (une note unique ne fait pas une
 *     tendance) ; une seule valeur rend le point seul, à droite et au milieu ;
 *   - le domaine est `min..max` des valeurs rendues, donc la courbe utilise
 *     toute la hauteur ; si toutes les valeurs sont égales, la ligne est à
 *     mi-hauteur (jamais une division par zéro ni un tracé hors cadre) ;
 *   - `x` répartit les points de gauche à droite (le dernier en bout de course,
 *     d'où le point plein final de Papillon), `y` est INVERSÉ : la plus haute
 *     moyenne en haut.
 */
fun sparklinePoints(values: List<Double?>, width: Float, height: Float): List<SparkPoint> {
    if (width <= 0f || height <= 0f) return emptyList()
    val known = knownValues(values)
    if (known.isEmpty()) return emptyList()
    if (known.size == 1) return listOf(SparkPoint(width, height / 2f))
    val min = known.minOrNull() ?: return emptyList()
    val max = known.maxOrNull() ?: return emptyList()
    val span = max - min
    val step = width / (known.size - 1).toFloat()
    return known.mapIndexed { index, value ->
        val ratio = if (span <= 0.0) 0.5f else ((value - min) / span).toFloat()
        SparkPoint(x = index * step, y = height * (1f - ratio))
    }
}

/**
 * Phrase sous la carte héro quand il n'y a pas de courbe à tracer ("" sinon).
 *
 * Une bande vide sous la moyenne ferait croire à un bug d'affichage : on dit donc
 * ce qui manque — aucun historique, ou une seule moyenne connue jusqu'ici.
 */
fun historyNote(values: List<Double?>): String {
    return when (knownValues(values).size) {
        0 -> "Pas d'historique de moyenne sur cette période."
        1 -> "Une seule moyenne connue : la courbe se dessine à la note suivante."
        else -> ""
    }
}

/** Phrase lue par un lecteur d'écran à la place de la courbe peinte. */
fun sparklineDescription(values: List<Double?>): String {
    val known = knownValues(values)
    return when (known.size) {
        0 -> "Pas d'historique de moyenne."
        1 -> "Une seule moyenne connue : ${gradeValueLabel(known[0])}."
        else -> "Évolution de la moyenne : de ${gradeValueLabel(known.first())} à ${gradeValueLabel(known.last())}."
    }
}

/** Valeurs exploitables d'une courbe : ni `null`, ni NaN, ni infini. */
private fun knownValues(values: List<Double?>): List<Double> = values.mapNotNull { value ->
    if (value == null || value.isNaN() || value.isInfinite()) null else value
}