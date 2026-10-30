package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.ALGORITHM_SUBJECT
import fr.veryslopnynotes.core.AVERAGE_ALGORITHMS
import fr.veryslopnynotes.core.AveragesReport
import fr.veryslopnynotes.core.ComputeAveragesOptions
import fr.veryslopnynotes.core.Grade
import fr.veryslopnynotes.core.ProvidedAverages
import fr.veryslopnynotes.core.computeAverages
import fr.veryslopnynotes.core.subjectKey
import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.PeriodNotes
import org.json.JSONArray
import org.json.JSONObject
import java.time.Duration

// Notes et moyennes : payloads `grades` et `periods`.

internal const val GRADE_SUBJECT_FALLBACK = "Matière"

private fun mapCoreGrade(g: fr.veryslopnynotes.pronote.Grade, index: Int, periodId: String?): Grade? {
    val value = toNumOrNull(g.grade) ?: return null
    val scale = toNum(g.outOf ?: g.defaultOutOf, 20.0)
    val coefficient = g.coefficient?.let { toNum(it, 1.0) }
    return Grade(
        id = g.id.ifBlank { "g-$index" },
        accountId = "",
        subject = g.subject.name.ifBlank { GRADE_SUBJECT_FALLBACK },
        value = value,
        scale = scale,
        coefficient = coefficient,
        date = g.date.parisIso(),
        classAverage = toNumOrNull(g.average),
        classMin = toNumOrNull(g.min),
        classMax = toNumOrNull(g.max),
        periodId = periodId,
        bonus = if (g.isBonus) true else null,
        optional = if (g.isOptionnal) true else null,
        label = boundedCp(g.comment, 200).ifEmpty { null },
        teacher = null,
    )
}

/**
 * Moyennes publiées d'une période, depuis le SNAPSHOT `Period.notes()`.
 *
 * Aucun POST ici : `gradesPayload` a déjà lu la période une fois. Les lignes
 * illisibles ont été sautées par le snapshot ; cette fonction ne fait que
 * mettre en forme ce qui est exploitable.
 */
private fun mapProvided(periodId: String, notes: PeriodNotes): ProvidedAverages? {
    val subjects = LinkedHashMap<String, Double>()
    for (a in notes.averages) {
        val name = a.subject.name
        if (name.isBlank() || name.length > 100) continue
        val value = toNumOrNull(a.student) ?: continue
        val outOf = toNum(a.outOf ?: a.defaultOutOf, 20.0)
        val sur20 = if (outOf.isFinite() && outOf > 0 && outOf != 20.0) (value / outOf) * 20 else value
        if (sur20.isFinite()) subjects[subjectKey(name)] = sur20
    }
    val general = when (val v = notes.overallAverage) {
        is JVal.Str -> toNumOrNull(v.value)
        is JVal.Num -> v.value.takeIf { it.isFinite() }
        else -> null
    }
    if (subjects.isEmpty() && general == null) return null
    return ProvidedAverages(periodId = periodId, general = general, subjects = subjects.ifEmpty { null })
}

private fun gradeJson(g: Grade): JSONObject = JSONObject().apply {
    put("id", g.id)
    put("subject", g.subject)
    put("value", g.value)
    put("scale", g.scale)
    putIf("coefficient", g.coefficient)
    put("date", g.date)
    putIf("classAverage", g.classAverage)
    putIf("classMin", g.classMin)
    putIf("classMax", g.classMax)
    putIf("periodId", g.periodId)
    putFlag("bonus", g.bonus == true)
    putFlag("optional", g.optional == true)
    putIf("label", g.label)
}

private fun reportJson(report: AveragesReport): JSONObject = JSONObject().apply {
    put("algorithm", report.algorithm)
    put("general", JSONObject().apply {
        report.general.value?.let { put("value", it) } ?: put("value", JSONObject.NULL)
        put("origin", report.general.origin)
        put("subjectCount", report.general.subjectCount)
    })
    put("subjects", JSONArray().apply {
        for (s in report.subjects) {
            put(JSONObject().apply {
                put("subject", s.subject)
                s.value?.let { put("value", it) } ?: put("value", JSONObject.NULL)
                put("origin", s.origin)
                put("gradeCount", s.gradeCount)
            })
        }
    })
    put("history", JSONArray().apply {
        for (h in report.history) {
            put(JSONObject().apply {
                put("date", h.date)
                h.value?.let { put("value", it) } ?: put("value", JSONObject.NULL)
            })
        }
    })
    put("influences", JSONArray().apply {
        for (i in report.influences) {
            put(JSONObject().apply {
                put("gradeId", i.gradeId)
                put("subject", i.subject)
                put("impact", i.impact)
            })
        }
    })
}

/**
 * Toutes les périodes, rapport cadré sur la `periodId` demandée (miroir `/v1/grades`).
 *
 * UN SEUL `DernieresNotes` par période (le snapshot `Period.notes()`) : notes,
 * moyennes publiées et moyenne générale viennent de la même réponse. Avant,
 * chaque période était lue une fois (`grades`) et la période sélectionnée deux
 * fois de plus (`averages` + `overallAverage`).
 *
 * La même note revient dans CHAQUE période dont la plage la recouvre : elle
 * n'est publiée qu'une fois, par identifiant Pronote NON VIDE (le repli
 * synthétique reste unique par ligne, jamais dédupliqué). Quand deux périodes
 * portent le même identifiant, la plus PRÉCISE (la plus courte) gagne : un
 * semestre ne doit pas usurper la note de son trimestre.
 */
internal fun gradesPayload(client: Client, query: Map<String, String>): String {
    val algorithm = query["algorithm"]?.takeIf { it in AVERAGE_ALGORITHMS } ?: ALGORITHM_SUBJECT
    val periodId = query["periodId"]?.trim()?.take(64)?.ifEmpty { null }
    val periods = client.periods
    val currentIds = periods.mapNotNullTo(HashSet()) { it.id.ifBlank { null } }
    val spanById = periods.mapNotNull { p ->
        p.id.ifBlank { null }?.let { id ->
            id to Duration.between(p.start, p.end).toMillis().coerceAtLeast(0L)
        }
    }.toMap()
    val all = mutableListOf<Grade>()
    val positionById = HashMap<String, Int>()
    val spanOfId = HashMap<String, Long>()
    // Snapshot de la période DEMANDÉE, capturé pendant la lecture unique.
    val snapshots = HashMap<String, PeriodNotes>()
    var seq = 0
    for (p in periods) {
        val pid = p.id.ifBlank { null }
        val notes = try {
            p.notes()
        } catch (e: Exception) {
            if (mustPropagateReadFailure(e)) throw e
            continue
        }
        if (pid != null) snapshots[pid] = notes
        for (g in notes.grades) {
            // La période PORTÉE par la ligne prime quand elle nomme une période
            // COURANTE. `Period.instances` est un registre global jamais vidé
            // entre sessions : un identifiant périmé ne doit pas rattacher une
            // note à un trimestre d'un autre compte.
            val rowPeriodId = g.period?.id?.takeIf { it in currentIds } ?: pid
            val mapped = mapCoreGrade(g, seq++, rowPeriodId) ?: continue
            if (g.id.isBlank()) {
                // Repli synthétique unique (`g-<seq>`) : deux lignes distinctes
                // ne partagent jamais cet identifiant, rien à dédupliquer.
                all.add(mapped)
                continue
            }
            val span = rowPeriodId?.let { spanById[it] } ?: Long.MAX_VALUE
            val existing = positionById[g.id]
            if (existing == null) {
                positionById[g.id] = all.size
                spanOfId[g.id] = span
                all.add(mapped)
            } else if (span < (spanOfId[g.id] ?: Long.MAX_VALUE)) {
                // La ligne la plus précise remplace la plus large, à sa place
                // dans la liste (l'ordre de lecture reste stable).
                all[existing] = mapped
                spanOfId[g.id] = span
            }
        }
    }
    val provided = periodId?.let { id -> snapshots[id]?.let { mapProvided(id, it) } }
    val report = computeAverages(
        all,
        ComputeAveragesOptions(algorithm = algorithm, periodId = periodId, provided = provided),
    )
    return JSONObject().apply {
        put("averages", reportJson(report))
        put("grades", JSONArray().apply { for (g in all) put(gradeJson(g)) })
    }.toString()
}

/** Tranches de l'établissement (miroir `/v1/periods`, hors cache). */
internal fun periodsPayload(client: Client): String {
    val arr = JSONArray()
    client.periods.forEachIndexed { i, p ->
        val start = runCatching { p.start.parisIso() }.getOrNull() ?: return@forEachIndexed
        val end = runCatching { p.end.parisIso() }.getOrNull() ?: return@forEachIndexed
        arr.put(JSONObject().apply {
            put("id", p.id.ifBlank { "period-$i" })
            put("name", boundedCp(p.name.ifBlank { "Période ${i + 1}" }, 100))
            put("start", start)
            put("end", end)
        })
    }
    return JSONObject().put("periods", arr).toString()
}

