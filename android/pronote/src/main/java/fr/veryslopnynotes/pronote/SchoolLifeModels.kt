package fr.veryslopnynotes.pronote

import java.time.LocalDateTime

class Absence(json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val fromDate: LocalDateTime = r(::datetimeParse, listOf("dateDebut", "V"))
    val toDate: LocalDateTime = r(::datetimeParse, listOf("dateFin", "V"))
    val justified: Boolean = r(::boolOf, listOf("justifie"), ResolveOpts.withDefault(false))
    val hours: String? = r(::optStr, listOf("NbrHeures"), ResolveOpts.lenient())
    val days: Double = r(::numOf, listOf("NbrJours"), ResolveOpts.withDefault(0.0))
    val reasons: List<String?> = r(::rawList, listOf("listeMotifs", "V"), ResolveOpts.withDefault(listOf<String?>()))
}

class Delay(json: JVal?) : PronoteObject(json) {
    val id: String = r(::strOf, listOf("N"))
    val date: LocalDateTime = r(::datetimeParse, listOf("date", "V"))
    val minutes: Double = r(::numOf, listOf("duree"), ResolveOpts.withDefault(0.0))
    val justified: Boolean = r(::boolOf, listOf("justifie"), ResolveOpts.withDefault(false))
    val justification: String? = r(::optStr, listOf("justification"), ResolveOpts.lenient())
    val reasons: List<String?> = r(::rawList, listOf("listeMotifs", "V"), ResolveOpts.withDefault(listOf<String?>()))
}

/**
 * `during_lesson` = `!horsCours` ; `place2time` illisible = `DataError` ;
 * `schedule` vide sauf si `schedulable`.
 */
class Punishment(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
    /** `placeExecution` absent = date seule ; tranche illisible = `DataError`. */
    class ScheduledPunishment(private val client: PronoteClientLike, json: JVal?) : PronoteObject(json) {
        val id: String = r(::strOf, listOf("N"))
        val start: LocalDateTime = run {
            val date = r(::dateParse, listOf("date", "V"))
            val place = r(::optNum, listOf("placeExecution"), ResolveOpts.lenient())
            if (place != null) {
                try {
                    val (h, m) = place2time(hoursValue(client, "ListeHeures"), place)
                    date.withHour(h).withMinute(m).withSecond(0).withNano(0)
                } catch (e: Exception) {
                    throw DataError(e.toString())
                }
            } else date
        }
        val duration: Double? = r(::optNum, listOf("duree"), ResolveOpts.lenient())
    }

    val id: String = r(::strOf, listOf("N"))
    val during_lesson: Boolean = r({ v -> !boolOf(v) }, listOf("horsCours"))
    val given: LocalDateTime = run {
        val date = r(::dateParse, listOf("dateDemande", "V"))
        if (during_lesson) {
            val place = r(::numOf, listOf("placeDemande"))
            try {
                val (h, m) = place2time(hoursValue(client, "ListeHeures"), place)
                date.withHour(h).withMinute(m).withSecond(0).withNano(0)
            } catch (e: Exception) {
                throw DataError(e.toString())
            }
        } else date
    }
    val exclusion: Boolean = r(::boolOf, listOf("estUneExclusion"))
    val homework: String? = r(::optStr, listOf("travailAFaire"), ResolveOpts.lenient())
    val homeworkDocuments: List<Attachment> =
        r({ v -> attachList(client, v) }, listOf("documentsTAF", "V"), ResolveOpts.withDefault(listOf<Attachment>()))
    val circumstances: String = r(::strOf, listOf("circonstances"))
    val circumstanceDocuments: List<Attachment> =
        r({ v -> attachList(client, v) }, listOf("documentsCirconstances", "V"))
    val nature: String = r(::strOf, listOf("nature", "V", "L"))
    val requiresParent: String? = r(::optStr, listOf("nature", "V", "estAvecARParent"), ResolveOpts.lenient())
    val reasons: List<String?> = r(::rawList, listOf("listeMotifs", "V"))
    val giver: String = r(::strOf, listOf("demandeur", "V", "L"))
    val schedulable: Boolean = r(::boolOf, listOf("estProgrammable"))
    val schedule: List<ScheduledPunishment> =
        if (schedulable) {
            r({ v ->
                val items = (v as? JVal.Arr)?.items ?: throw IllegalStateException("programmation attendue")
                items.map { ScheduledPunishment(client, it) }
            }, listOf("programmation", "V"))
        } else emptyList()
    /** Durée en MINUTES (`duree` Pronote, comme le retard). */
    val duration: Double? = r(::optNum, listOf("duree"), ResolveOpts.lenient())
}
