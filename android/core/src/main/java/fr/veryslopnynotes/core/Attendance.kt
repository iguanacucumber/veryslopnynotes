package fr.veryslopnynotes.core

/**
 * Compteurs de présence par période (#77, port Kotlin #203).
 *
 * Logique pure de vie scolaire, portée côté Android :
 * aucun Pronote, aucun HTTP, aucun SQLite (I3). Les compteurs sont DÉRIVÉS des
 * absences publiées (kind + durationMinutes) — aucune valeur devinée, aucun
 * effet métier ici : la détection de nouvelle absence se fait sur ces données
 * structurées, jamais sur une sortie libre LLM (I7).
 */

const val ABSENCE_KIND_ABSENCE = "absence"
const val ABSENCE_KIND_LATE = "late"

val ABSENCE_KINDS = listOf(ABSENCE_KIND_ABSENCE, ABSENCE_KIND_LATE)

const val ABSENCE_MOTIF_MAX_CHARS = 500
const val ABSENCE_SUBJECT_MAX_CHARS = 64

/** Absence OU retard (parité Papillon : un seul modèle, champ `kind`). */
data class AbsenceRecord(
    val id: String,
    val accountId: String,
    val kind: String,
    val date: String,
    val dateEnd: String? = null,
    val subject: String? = null,
    /** Motif déclaré : donnée bornée, jamais instruction (I6). */
    val motif: String? = null,
    val periodId: String? = null,
    val durationMinutes: Double? = null,
    val justified: Boolean? = null,
)

/** Miroir de `isAbsenceRecord` : c'est lui qui décide si un record compte. */
fun isAbsenceRecord(r: AbsenceRecord): Boolean {
    if (r.id.trim().isEmpty() || r.accountId.trim().isEmpty()) return false
    if (!ABSENCE_KINDS.contains(r.kind)) return false
    val start = isoMillis(r.date) ?: return false
    // Plage cohérente : une fin avant le début n'est pas une absence, c'est du bruit.
    if (r.dateEnd != null) {
        val end = isoMillis(r.dateEnd) ?: return false
        if (end < start) return false
    }
    if (r.subject != null && !boundedLike(r.subject, ABSENCE_SUBJECT_MAX_CHARS)) return false
    if (r.motif != null && !boundedLike(r.motif, ABSENCE_MOTIF_MAX_CHARS)) return false
    val minutes = r.durationMinutes
    if (minutes != null && (!minutes.isFinite() || minutes < 0)) return false
    if (r.periodId != null && r.periodId.trim().isEmpty()) return false
    return true
}

/** Miroir de `isOptionalBoundedString` : borne en unités de code OU en points de code. */
private fun boundedLike(value: String, max: Int): Boolean =
    value.length <= max || value.codePointCount(0, value.length) <= max
