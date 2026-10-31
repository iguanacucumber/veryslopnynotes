package fr.veryslopnynotes.core

// Cahier de cours local : l'élève garde ses cours par matière, et l'assistant
// les reçoit comme SOURCES à chaque demande. Rien n'est entraîné, rien ne quitte
// le téléphone sans une demande explicite.
//
// Le texte est une DONNÉE (I6) : marqué Untrusted par le prompt, borné ici.
//
// ponytail: une note = un texte, pas de pièces jointes ici. Upgrade: photos
// stockées à côté quand le besoin de relecture apparaît.

data class LessonNote(
    val id: String,
    val subject: String,
    val title: String,
    val text: String,
    val createdAt: String,
) {
    companion object {
        const val MAX_ID_CHARS = 64
        const val MAX_SUBJECT_CHARS = 64
        const val MAX_TITLE_CHARS = 120
        const val MAX_TEXT_CHARS = 4000

        private val ID_RE = Regex("^[A-Za-z0-9._-]{1,$MAX_ID_CHARS}$")

        fun isValid(note: LessonNote): Boolean =
            ID_RE.matches(note.id) &&
                note.subject.trim().isNotEmpty() &&
                note.subject.length <= MAX_SUBJECT_CHARS &&
                note.title.trim().isNotEmpty() &&
                note.title.length <= MAX_TITLE_CHARS &&
                note.text.trim().isNotEmpty() &&
                note.text.length <= MAX_TEXT_CHARS &&
                isIsoDateLike(note.createdAt)
    }
}

/**
 * Règles du cahier : bornes du lot et fabrique de sources citables.
 *
 * Toutes les notes valides de la matière sont candidates ; [AiContext] décide
 * ensuite de la place réelle dans le budget et signale les coupes. Le préfixe
 * « Cahier : » évite qu'une note homonyme d'un cours soit dédupliquée à tort.
 */
object LessonNotes {
    const val MAX_NOTES = 64
    const val MAX_PER_SUBJECT = 8
    const val MAX_SOURCE_LABEL_CHARS = 200

    fun forSubject(notes: List<LessonNote>, subject: String): List<LessonNote> {
        val key = subject.trim()
        if (key.isEmpty()) return emptyList()
        return notes
            .asSequence()
            .filter { it.subject.trim() == key && LessonNote.isValid(it) }
            .sortedByDescending { it.createdAt }
            .take(MAX_PER_SUBJECT)
            .toList()
    }

    /**
     * Sources citables (contrat historique, sans métadonnées) : toutes les notes
     * valides de la matière. La coupe n'est pas signalée ici : partir des notes
     * brutes via [AiContext.note] expose `truncated`.
     */
    fun sources(notes: List<LessonNote>, subject: String): List<HomeworkSource> =
        forSubject(notes, subject)
            .mapNotNull { note ->
                val text = note.text.trim().take(Homework.MAX_SOURCE_CHARS)
                if (text.isEmpty()) return@mapNotNull null
                val rawLabel = "Cahier : " + note.title.trim().ifEmpty { "cours" }
                val label = rawLabel.take(MAX_SOURCE_LABEL_CHARS)
                HomeworkSource(label = label, text = text).takeIf { it.isValid() }
            }

    /** Étiquettes distinctes des sources du cahier (pour les citations). */
    fun labels(notes: List<LessonNote>, subject: String): List<String> =
        sources(notes, subject).map { it.label }.distinct()
}
