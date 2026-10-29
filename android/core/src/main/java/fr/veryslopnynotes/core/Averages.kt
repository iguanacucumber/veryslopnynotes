package fr.veryslopnynotes.core

import java.text.Collator
import java.text.Normalizer
import java.util.Locale

/**
 * Moyennes par matière, parité Papillon (#74, port Kotlin #203).
 *
 * Port Kotlin (#203), source de vérité pour le calcul des moyennes et rejoué
 * par `tests/unit/android-averages.test.ts`. Un écart au miroir est un défaut ;
 * les algorithmes restent alignés sur Papillon.
 *
 * Pur : aucun réseau, aucun SQLite, aucun Android (I3). La moyenne est une DONNÉE
 * structurée, jamais le produit d'une sortie libre LLM (I7).
 *
 * Semantics communes : sortie toujours sur /20. Une période sans note exploitable
 * renvoie null (jamais 0 = « zéro de moyenne »).
 *   - bonus   : contribution (valeur - barème/2) si >= 0, sinon ignorée.
 *   - facult. : conservée seulement si elle améliore la moyenne.
 *   - coef 0  : note ignorée.
 * ponytail: notes non notées / absentes non modélisées (pas de flag `disabled`
 * dans le contrat) — upgrade: champ `graded` sur Grade + source Pronote.
 */

/** Note du contrat 0.7.0 (`shared/contracts/models.ts`), tous les champs Papillon compris. */
data class Grade(
    val id: String,
    val accountId: String,
    val subject: String,
    val value: Double,
    val scale: Double,
    val coefficient: Double? = null,
    val date: String,
    val classAverage: Double? = null,
    val classMin: Double? = null,
    val classMax: Double? = null,
    val periodId: String? = null,
    val bonus: Boolean? = null,
    val optional: Boolean? = null,
    val label: String? = null,
    val teacher: String? = null,
)

/** Algorithmes du contrat : moyenne des matières (défaut) / pondérée / médiane. */
const val ALGORITHM_SUBJECT = "subject"
const val ALGORITHM_WEIGHTED = "weighted"
const val ALGORITHM_MEDIAN = "median"

val AVERAGE_ALGORITHMS = listOf(ALGORITHM_SUBJECT, ALGORITHM_WEIGHTED, ALGORITHM_MEDIAN)

/** Sentinelle interne « aucune donnée » (Papillon utilise -1 en interne). */
private const val NO_DATA = -1.0

/**
 * Historique et influence : une entrée par note, donc quadratique. L'historique
 * porte sur TOUTES les notes antérieures (exact, cohérent avec la moyenne
 * générale) ; seules les MAX_AVERAGE_POINTS dernières entrées sont renvoyées.
 */
const val MAX_AVERAGE_POINTS = 200

// --- Types de sortie (miroir de AveragesReport) ------------------------------

data class SubjectAverage(
    val subject: String,
    val value: Double?,
    val origin: String,
    val gradeCount: Int,
)

data class GeneralAverage(
    val value: Double?,
    val origin: String,
    val subjectCount: Int,
)

data class GradeInfluence(
    val gradeId: String,
    val subject: String,
    val impact: Double,
)

data class AverageHistoryPoint(
    val date: String,
    val value: Double?,
)

data class AveragesReport(
    val algorithm: String,
    val periodId: String?,
    val general: GeneralAverage,
    val subjects: List<SubjectAverage>,
    val history: List<AverageHistoryPoint>,
    val influences: List<GradeInfluence>,
)

/** Les moyennes publiées par l'établissement, pour une période. */
data class ProvidedAverages(
    val periodId: String? = null,
    val general: Double? = null,
    /** Clé = `subjectKey(nom)` (sans accents, minuscules), comme côté TS. */
    val subjects: Map<String, Double>? = null,
)

data class ComputeAveragesOptions(
    val algorithm: String? = null,
    val periodId: String? = null,
    val provided: ProvidedAverages? = null,
)

// --- Utilitaires -------------------------------------------------------------

/** Clé de regroupement d'une matière : sans accents, minuscules, sans bords. */
fun subjectKey(subject: String): String =
    Normalizer.normalize(subject, Normalizer.Form.NFKD)
        .replace(Regex("[\\u0300-\\u036f]"), "")
        .lowercase(Locale.ROOT)
        .trim()

/**
 * `Number(value.toFixed(2))` côté TS : arrondi au 1/100, moitié AU LOIN de zéro
 * (`(-0.125).toFixed(2) == "-0.13"`, symétrique). `HALF_UP` a exactement cette
 * sémantique, y compris sur les égalités exactes — le cas est couvert par la
 * parité (impact `-0.125` -> `-0.13` des deux côtés).
 */
private fun twoDecimals(value: Double): Double =
    java.math.BigDecimal(value).setScale(2, java.math.RoundingMode.HALF_UP).toDouble()

/** Poids de la note : 1 par défaut (Papillon `coefficient || 1`), 0 = hors moyenne. */
private fun weightOf(g: Grade): Double {
    val c = g.coefficient ?: return 1.0
    return if (c.isFinite()) c else 1.0
}

/** Note explicitement hors moyenne (coefficient 0), comme Papillon l'ignore. */
private fun isExcluded(g: Grade): Boolean = g.coefficient == 0.0

/** Note exploitable : hors moyenne écartée, valeur et barème exploitables. */
private fun isUsable(g: Grade): Boolean {
    if (isExcluded(g)) return false
    // Coefficient négatif : le poids annule le dénominateur. Donnée Pronote
    // incohérente = note écartée, comme un coefficient 0.
    val c = g.coefficient
    if (c != null && (!c.isFinite() || c < 0)) return false
    return g.value.isFinite() && g.value >= 0 && g.scale.isFinite() && g.scale > 0
}

/**
 * Papillon : ramène la note sur /20 quand elle sort de l'échelle, pondérée par
 * le coefficient. Le seuil `coef < 1 && barème - 20 >= -5` est repris tel quel.
 */
private class Sum(var value: Double = 0.0, var outOf: Double = 0.0)

private fun addWeighted(sum: Sum, g: Grade, value: Double) {
    val coef = weightOf(g)
    val outOf = g.scale
    if (value > 20 || (coef < 1 && outOf - 20 >= -5) || outOf > 20) {
        sum.value += (value / outOf) * 20 * coef
        sum.outOf += 20 * coef
    } else {
        sum.value += value * coef
        sum.outOf += outOf * coef
    }
}

private fun ratioTo20(sum: Sum): Double {
    if (sum.outOf <= 0) return NO_DATA
    val result = minOf((sum.value / sum.outOf) * 20, 20.0)
    return if (result.isNaN()) NO_DATA else result
}

/** Papillon getSubjectAverage : `loop` court-circuite le cas facultative. */
private fun subjectAverageInner(grades: List<Grade>, loop: Boolean): Double {
    val sum = Sum()
    for ((i, g) in grades.withIndex()) {
        if (!isUsable(g)) continue
        // Facultative : hors boucle, on ne garde la note que si elle améliore la moyenne.
        if (g.optional == true && !loop) {
            val avgWithout = subjectAverageInner(grades.filterIndexed { idx, _ -> idx != i }, true)
            val avgWith = subjectAverageInner(grades, true)
            if (avgWithout > avgWith) continue
        }
        // Bonus : on retire la demi-barème, contribution 1 point si positif.
        if (g.bonus == true) {
            val corrected = g.value - g.scale / 2
            if (corrected >= 0) {
                sum.value += corrected
                sum.outOf += 1
            }
            continue
        }
        addWeighted(sum, g, g.value)
    }
    return ratioTo20(sum)
}

/** Groupement par `subjectKey`, ordre d'insertion conservé (miroir de la Map TS). */
private fun groupBySubject(grades: List<Grade>): List<Pair<String, List<Grade>>> {
    val groups = LinkedHashMap<String, MutableList<Grade>>()
    for (g in grades) groups.getOrPut(subjectKey(g.subject)) { mutableListOf() }.add(g)
    return groups.map { it.key to it.value }
}

/** Papillon PapillonSubjectAvg : moyenne des moyennes de matière. */
fun subjectAlgorithmAverage(grades: List<Grade>): Double? {
    if (grades.isEmpty()) return null
    var total = 0.0
    var counted = 0
    for ((_, bucket) in groupBySubject(grades)) {
        val avg = subjectAverageInner(bucket, false)
        if (avg != NO_DATA) {
            counted += 1
            total += avg
        }
    }
    return if (counted > 0) total / counted else null
}

/** Papillon PapillonWeightedAvg : toutes notes poolées, pondérées par coefficient. */
fun weightedAlgorithmAverage(grades: List<Grade>): Double? {
    if (grades.isEmpty()) return null
    val sum = Sum()
    for (g in grades) {
        if (!isUsable(g)) continue
        if (g.bonus == true) {
            val corrected = g.value - g.scale / 2
            if (corrected >= 0) {
                sum.value += corrected
                sum.outOf += 1
            }
            continue
        }
        addWeighted(sum, g, g.value)
    }
    val result = ratioTo20(sum)
    return if (result == NO_DATA) null else result
}

/** Papillon PapillonMedian : médiane des notes ramenées sur /20 (bonus ignorés). */
fun medianAlgorithmAverage(grades: List<Grade>): Double? {
    val values = mutableListOf<Double>()
    for (g in grades) {
        if (!isUsable(g)) continue
        // Bonus = majoration hors barème, PAS une note /20 ordinaire.
        if (g.bonus == true) continue
        values.add((g.value / g.scale) * 20)
    }
    if (values.isEmpty()) return null
    values.sort()
    val middle = values.size / 2
    if (values.size % 2 == 0) return (values[middle - 1] + values[middle]) / 2
    return values[middle]
}

/** Applique l'algorithme choisi (défaut Papillon = subject). */
fun averageWith(algorithm: String?, grades: List<Grade>): Double? = when (algorithm) {
    ALGORITHM_WEIGHTED -> weightedAlgorithmAverage(grades)
    ALGORITHM_MEDIAN -> medianAlgorithmAverage(grades)
    else -> subjectAlgorithmAverage(grades)
}

/** Les fournies ne servent que si leur périmètre == celui demandé. */
private fun providedFor(options: ComputeAveragesOptions): ProvidedAverages? {
    val provided = options.provided ?: return null
    return if (provided.periodId == options.periodId) provided else null
}

private fun providedSubject(key: String, provided: ProvidedAverages?): Double? {
    val raw = provided?.subjects?.get(key) ?: return null
    return if (raw.isFinite()) raw else null
}

/**
 * Historique : moyenne générale recalculée à chaque note, triée par date.
 * Chaque point est la moyenne de TOUTES les notes antérieures (fenêtrer les
 * notes d'entrée ferait diverger la courbe de la moyenne générale affichée).
 */
private fun buildHistory(algorithm: String?, grades: List<Grade>): List<AverageHistoryPoint> {
    val sorted = grades.sortedBy { isoMillis(it.date) ?: Long.MAX_VALUE }
    val out = mutableListOf<AverageHistoryPoint>()
    for (i in sorted.indices) {
        out.add(AverageHistoryPoint(sorted[i].date, averageWith(algorithm, sorted.subList(0, i + 1))))
    }
    return if (out.size > MAX_AVERAGE_POINTS) out.subList(out.size - MAX_AVERAGE_POINTS, out.size) else out
}

/** Notes les plus récentes, triées : fenêtré pour borner le coût quadratique. */
private fun recentByDate(grades: List<Grade>): List<Grade> {
    val sorted = grades.sortedBy { isoMillis(it.date) ?: Long.MAX_VALUE }
    return if (sorted.size > MAX_AVERAGE_POINTS) sorted.subList(sorted.size - MAX_AVERAGE_POINTS, sorted.size) else sorted
}

/**
 * Influence d'une note sur la moyenne générale : écart avec/sans la note.
 * Cas upstream : sans la note, la matière devient sans note exploitable, elle est
 * retirée de la moyenne générale ; s'il ne reste aucune matière, la moyenne de
 * référence vaut 0 (et non null) — l'écart vaut alors la moyenne entière.
 */
private fun buildInfluences(algorithm: String?, grades: List<Grade>): List<GradeInfluence> {
    val general = averageWith(algorithm, grades) ?: return emptyList()
    val out = mutableListOf<GradeInfluence>()
    for (g in recentByDate(grades)) {
        val rest = grades.filter { it.id != g.id }
        val without = averageWith(algorithm, rest) ?: 0.0
        out.add(GradeInfluence(g.id, g.subject, twoDecimals(general - without)))
    }
    return out
}

/** Notes exploitables : coefficient non nul, valeur et barème valides. */
private fun countRetained(grades: List<Grade>): Int = grades.count { isUsable(it) }

private fun buildSubjectAverages(grades: List<Grade>, provided: ProvidedAverages?): List<SubjectAverage> {
    val out = groupBySubject(grades).map { (key, bucket) ->
        val providedValue = providedSubject(key, provided)
        val estimated = subjectAverageInner(bucket, false)
        SubjectAverage(
            subject = bucket[0].subject,
            value = providedValue ?: if (estimated == NO_DATA) null else estimated,
            origin = if (providedValue != null) "provided" else "estimated",
            gradeCount = countRetained(bucket),
        )
    }
    // `localeCompare(b, "fr")` côté TS : le collateur FR classe « Épreuve » avant
    // « ecole », l'ordre naturel des chaînes non. Une `Map` TS n'a pas d'ordre de
    // cléstrié : c'est le tri explicite qui fait foi des deux côtés.
    val collator = Collator.getInstance(Locale.FRANCE)
    return out.sortedWith { a, b -> collator.compare(a.subject, b.subject) }
}

/** Rapport de moyennes : fourchettes fournies prioritaires, sinon estimation par algorithme. */
fun computeAverages(grades: List<Grade>, options: ComputeAveragesOptions = ComputeAveragesOptions()): AveragesReport {
    val algorithm = options.algorithm ?: ALGORITHM_SUBJECT
    val periodId = options.periodId
    val provided = providedFor(options)
    val scoped = if (periodId == null) grades else grades.filter { it.periodId == periodId }
    val subjects = buildSubjectAverages(scoped, provided)

    val providedGeneral = provided?.general?.takeIf { it.isFinite() }
    val estimatedGeneral = averageWith(algorithm, scoped)
    val general = GeneralAverage(
        value = providedGeneral ?: estimatedGeneral,
        origin = if (providedGeneral != null) "provided" else "estimated",
        subjectCount = subjects.count { it.value != null },
    )

    return AveragesReport(
        algorithm = algorithm,
        periodId = periodId,
        general = general,
        subjects = subjects,
        history = buildHistory(algorithm, scoped),
        influences = buildInfluences(algorithm, scoped),
    )
}
