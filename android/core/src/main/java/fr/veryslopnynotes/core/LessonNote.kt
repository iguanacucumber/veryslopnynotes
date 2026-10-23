package fr.veryslopnynotes.core

// Cahier de cours local (#586) : l'élève garde ses cours par matière, et
// l'assistant les reçoit comme SOURCES à chaque demande. Ce n'est pas une
// mémoire du modèle : rien n'est entraîné, rien ne quitte le téléphone sans
// une demande explicite.
//
// Le texte est une DONNÉE (I6) : il est marqué Untrusted par le prompt, borné
// ici et jamais interprété comme une instruction.
//
// ponytail: une note = un texte, pas de pièces jointes ni de fichiers ici.
// Upgrade: photos stockées à côté quand le besoin de relecture apparaît.

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
 * Une note devient une source `HomeworkSource` (étiquette « Cours : titre »),
 * exactement comme l'extrait de cours Pronote ou le manuel. Le prompt la
 * marque Untrusted, et le modèle ne peut citer que les étiquettes fournies.
 */
object LessonNotes {
    const val MAX_NOTES = 64
    const val MAX_PER_SUBJECT = 8
    const val MAX_SOURCES = 3
    const val MAX_SOURCE_LABEL_CHARS = 200

    /** Notes d'une matière, les plus récentes d'abord, bornées au lot. */
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

    /** Sources citables : au plus [MAX_SOURCES], texte borné comme une source. */
    fun sources(notes: List<LessonNote>, subject: String): List<HomeworkSource> =
        forSubject(notes, subject)
            .take(MAX_SOURCES)
            .mapNotNull { note ->
                val text = note.text.trim().take(Homework.MAX_SOURCE_CHARS)
                if (text.isEmpty()) return@mapNotNull null
                val rawLabel = "Cours : " + note.title.trim().ifEmpty { "cours" }
                val label = rawLabel.take(MAX_SOURCE_LABEL_CHARS)
                HomeworkSource(label = label, text = text).takeIf { it.isValid() }
            }

    /** Étiquettes distinctes des sources du cahier (pour les citations). */
    fun labels(notes: List<LessonNote>, subject: String): List<String> =
        sources(notes, subject).map { it.label }.distinct()
}
