package fr.veryslopnynotes.core

import java.text.Normalizer
import java.util.Locale

// Détection DS/interro sur données structurées (port Kotlin #207).
//
// Porté de `server/jobs/exams.ts` (supprimé en #210 : ce port est la source
// de vérité). Heuristique à mots-frontières sur
// titres devoirs (+ sujet/salle EDT quand libellés dispos). `high` = effet
// notif auto possible ; `needs_confirm` = confirmation app obligatoire, aucun
// effet métier direct. Aucun LLM : fonction pure (I7).
//
// Pur : aucun réseau, aucun SQLite, aucun Android (I3). `Assignment` est
// réutilisé tel quel ; le créneau EDT est une vue minimale (id/sujet/salle/
// début), pas un doublon du contrat.
//
// ponytail: listes de mots-clés en dur, comme la référence. Upgrade: table
// servie par le serveur si le vocabulaire s'enrichit.

const val EXAM_CONFIDENCE_HIGH = "high"
const val EXAM_CONFIDENCE_NEEDS_CONFIRM = "needs_confirm"

const val EXAM_SOURCE_ASSIGNMENT = "assignment"
const val EXAM_SOURCE_TIMETABLE = "timetable"

/** Candidat DS/interro détecté sur données structurées. */
data class ExamCandidate(
    val source: String,
    val id: String,
    val subject: String,
    val date: String,
    val confidence: String,
    val matched: String,
)

/** Confiance + mot-clé apparié pour un titre. */
data class ExamHit(
    val confidence: String,
    val matched: String,
)

/** Vue minimale d'un créneau EDT : ce que le détecteur lit, rien de plus. */
data class TimetableSlot(
    val id: String,
    val subject: String,
    val room: String? = null,
    val start: String,
)

private val EXAM_HIGH = listOf(
    "ds",
    "dst",
    "devoir surveille",
    "devoir commun",
    "controle",
    "interro",
    "interrogation",
    "evaluation",
    "examen",
    "partiel",
    "bac blanc",
    "brevet blanc",
)

private val EXAM_MAYBE = listOf("test", "qcm", "quiz", "bac", "brevet")

private fun normalizeExamText(s: String): String {
    val lower = s.lowercase(Locale.ROOT)
    val stripped = Normalizer.normalize(lower, Normalizer.Form.NFKD)
        .replace(Regex("[\u0300-\u036f]"), "")
    return stripped.replace(Regex("[^a-z0-9 ]+"), " ").replace(Regex("\\s+"), " ").trim()
}

private fun matchExamKeyword(text: String, keywords: List<String>): String? {
    val norm = " ${normalizeExamText(text)} "
    for (k in keywords) {
        if (norm.contains(" $k ")) return k
    }
    return null
}

fun examConfidence(title: String): ExamHit? {
    val high = matchExamKeyword(title, EXAM_HIGH)
    if (high != null) return ExamHit(confidence = EXAM_CONFIDENCE_HIGH, matched = high)
    val maybe = matchExamKeyword(title, EXAM_MAYBE)
    if (maybe != null) return ExamHit(confidence = EXAM_CONFIDENCE_NEEDS_CONFIRM, matched = maybe)
    return null
}

fun detectExams(assignments: List<Assignment>, entries: List<TimetableSlot>): List<ExamCandidate> {
    val out = mutableListOf<ExamCandidate>()
    for (a in assignments) {
        val hit = examConfidence(a.title)
        if (hit != null) {
            out.add(
                ExamCandidate(
                    source = EXAM_SOURCE_ASSIGNMENT,
                    id = a.id,
                    subject = a.subject,
                    date = a.dueDate,
                    confidence = hit.confidence,
                    matched = hit.matched,
                ),
            )
        }
    }
    for (e in entries) {
        val hit = examConfidence("${e.subject} ${e.room ?: ""}")
        if (hit != null) {
            out.add(
                ExamCandidate(
                    source = EXAM_SOURCE_TIMETABLE,
                    id = e.id,
                    subject = e.subject,
                    date = e.start,
                    confidence = hit.confidence,
                    matched = hit.matched,
                ),
            )
        }
    }
    return out
}
