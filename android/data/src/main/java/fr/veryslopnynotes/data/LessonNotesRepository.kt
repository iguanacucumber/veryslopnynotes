package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.LessonNote
import fr.veryslopnynotes.core.LessonNotes
import java.time.Instant
import java.util.UUID

/**
 * Issue d'une écriture du cahier.
 *
 * `INVALID` n'est pas `REFUSED` : une note hors contrat n'a rien changé,
 * tandis qu'un refus vient de la garde d'époque (déconnexion). L'interface
 * doit dire laquelle des deux causes s'applique.
 */
enum class LessonNotesWrite {
    WRITTEN,
    INVALID,
    LIMIT,
    NOT_FOUND,
    REFUSED,
}

interface LessonNotesLocalStore {
    fun load(): List<LessonNote>

    /** false = écriture abandonnée (la session a changé depuis [epoch]). */
    fun save(notes: List<LessonNote>, epoch: Long): Boolean

    /** Purge de compte : `true` = plus aucune note sur cet appareil. */
    fun clear(): Boolean
}

/**
 * Lecture/écriture du cahier, bornée et validée. Les règles vivent dans
 * [LessonNote] / [LessonNotes] (core) : le pont et le stockage acceptent la
 * même chose que ce que le stockage relira.
 *
 * La fusion relit le fichier : sans serrure, deux ajouts concurrents lisent
 * la même liste et le dernier écrase l'autre. [SerializedUpdate] couvre la
 * relecture ET l'écriture, donc aucune mise à jour n'est perdue.
 */
class LessonNotesRepository(private val local: LessonNotesLocalStore) {
    private val update = SerializedUpdate()

    fun notes(): List<LessonNote> = update.run {
        try {
            local.load().filter { LessonNote.isValid(it) }.take(LessonNotes.MAX_NOTES)
        } catch (e: LocalDataUnreadable) {
            throw e
        } catch (_: Exception) {
            emptyList()
        }
    }

    fun notesFor(subject: String): List<LessonNote> = LessonNotes.forSubject(notes(), subject)

    fun subjects(): List<String> = notes().map { it.subject }.distinct().take(LessonNotes.MAX_NOTES)

    /** Purge de compte sous la serrure de fusion. */
    fun clear(): Boolean = update.run {
        try {
            local.clear()
        } catch (_: Exception) {
            false
        }
    }

    fun find(id: String): LessonNote? = notes().firstOrNull { it.id == id }

    /**
     * Crée ou remplace une note. `id` vide = nouvelle note, sinon la note
     * existante est remplacée en gardant sa date de création. Un identifiant
     * inconnu est une erreur, jamais une création silencieuse.
     */
    fun save(id: String, subject: String, title: String, text: String, epoch: Long): LessonNotesWrite = update.run {
        val current = notes()
        val wanted = id.trim()
        val existing = if (wanted.isEmpty()) null else current.firstOrNull { it.id == wanted }
        if (wanted.isNotEmpty() && existing == null) return@run LessonNotesWrite.NOT_FOUND
        val note = LessonNote(
            id = existing?.id ?: newId(),
            subject = subject.trim(),
            title = title.trim(),
            text = text.trim(),
            createdAt = existing?.createdAt ?: Instant.now().toString(),
        )
        if (!LessonNote.isValid(note)) return@run LessonNotesWrite.INVALID
        val sameSubject = current.filter { it.subject.trim() == note.subject && it.id != existing?.id }
        if (sameSubject.size >= LessonNotes.MAX_PER_SUBJECT) return@run LessonNotesWrite.LIMIT
        if (existing == null && current.size >= LessonNotes.MAX_NOTES) return@run LessonNotesWrite.LIMIT
        val merged = if (existing == null) {
            current + note
        } else {
            current.map { if (it.id == existing.id) note else it }
        }.filter { LessonNote.isValid(it) }
            .sortedByDescending { it.createdAt }
            .take(LessonNotes.MAX_NOTES)
        if (!write(merged, epoch)) return@run LessonNotesWrite.REFUSED
        LessonNotesWrite.WRITTEN
    }

    fun delete(id: String, epoch: Long): LessonNotesWrite = update.run {
        val key = id.trim()
        val current = notes()
        if (current.none { it.id == key }) return@run LessonNotesWrite.NOT_FOUND
        val next = current.filterNot { it.id == key }
        if (!write(next, epoch)) return@run LessonNotesWrite.REFUSED
        LessonNotesWrite.WRITTEN
    }

    private fun write(notes: List<LessonNote>, epoch: Long): Boolean = try {
        local.save(notes, epoch)
    } catch (_: Exception) {
        // Le cahier est une donnée utilisateur : un échec ne doit pas crasher
        // le pont, il devient un refus lisible.
        false
    }

    private fun newId(): String = UUID.randomUUID().toString().replace("-", "").take(LessonNote.MAX_ID_CHARS)
}
