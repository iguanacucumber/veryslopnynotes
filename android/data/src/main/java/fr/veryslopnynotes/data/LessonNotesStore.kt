package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.LessonNote
import fr.veryslopnynotes.core.LessonNotes
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.time.Instant
import java.util.UUID

/**
 * Issue d'une écriture du cahier (#586).
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

/**
 * Course notes on disk: ONE JSON file in `filesDir/offline/`.
 *
 * Pourquoi un fichier et pas une base : le volume est minuscule (64 notes
 * bornées), le dépôt n'a ni Room ni DataStore, et la purge de compte efface
 * déjà récursivement `offline/` (I16). L'écriture passe par
 * [OfflineArtifacts.writeText] : une note enregistrée pendant une
 * déconnexion est ABANDONNÉE, le dossier purgé ne ressuscite pas.
 *
 * `@Synchronized` : le pont peut écrire depuis plusieurs fils, et le fichier
 * est relu avant chaque fusion. Pas de perte silencieuse entre deux ajouts.
 */
class FileLessonNotesStore(
    private val file: File,
    private val legacyFile: File? = null,
) : LessonNotesLocalStore {
    @Synchronized
    override fun load(): List<LessonNote> = read()

    @Synchronized
    override fun save(notes: List<LessonNote>, epoch: Long): Boolean {
        val written = OfflineArtifacts.writeText(file, lessonNotesJson(notes), epoch)
        // Migrate old `cahier.json` only after the new file is safely written.
        if (written) legacyFile?.takeIf { it.isFile }?.delete()
        return written
    }

    private fun read(): List<LessonNote> {
        // A truncated new file (writeText is truncate-then-write) must not
        // shadow intact legacy notes: parse failure falls through to it.
        val current = file.takeIf { it.isFile }?.let { parseLessonNotesOrNull(it.readText()) }
        if (current != null) return current
        // Read the pre-rename file until the next successful write moves it.
        return legacyFile?.takeIf { it.isFile }?.let { parseLessonNotesOrNull(it.readText()) } ?: emptyList()
    }
}

class InMemoryLessonNotesStore : LessonNotesLocalStore {
    private var notes: List<LessonNote> = emptyList()

    @Synchronized
    override fun load(): List<LessonNote> = notes

    @Synchronized
    override fun save(notes: List<LessonNote>, epoch: Long): Boolean =
        SessionEpoch.writeIfCurrent(epoch) {
            this.notes = notes.take(LessonNotes.MAX_NOTES)
            true
        } ?: false
}

interface LessonNotesLocalStore {
    fun load(): List<LessonNote>

    /** false = écriture abandonnée (la session a changé depuis [epoch]). */
    fun save(notes: List<LessonNote>, epoch: Long): Boolean
}

/**
 * Lecture/écriture du cahier, bornée et validée.
 *
 * La source de vérité des règles est [LessonNote] / [LessonNotes] (core) :
 * le pont et le dépôt ne peuvent pas accepter plus que ce que le stockage
 * relira.
 */
class LessonNotesRepository(private val local: LessonNotesLocalStore) {
    fun notes(): List<LessonNote> = try {
        local.load().filter { LessonNote.isValid(it) }.take(LessonNotes.MAX_NOTES)
    } catch (_: Exception) {
        emptyList()
    }

    fun notesFor(subject: String): List<LessonNote> = LessonNotes.forSubject(notes(), subject)

    fun subjects(): List<String> = notes().map { it.subject }.distinct().take(LessonNotes.MAX_NOTES)

    fun find(id: String): LessonNote? = notes().firstOrNull { it.id == id }

    /**
     * Crée ou remplace une note. `id` vide = nouvelle note (identifiant
     * aléatoire), sinon la note existante est remplacée en gardant sa date de
     * création. Un identifiant inconnu est une erreur, jamais une création
     * silencieuse sous un identifiant fourni par l'interface.
     */
    fun save(id: String, subject: String, title: String, text: String, epoch: Long): LessonNotesWrite {
        val current = notes()
        val wanted = id.trim()
        val existing = if (wanted.isEmpty()) null else current.firstOrNull { it.id == wanted }
        if (wanted.isNotEmpty() && existing == null) return LessonNotesWrite.NOT_FOUND
        val note = LessonNote(
            id = existing?.id ?: newId(),
            subject = subject.trim(),
            title = title.trim(),
            text = text.trim(),
            createdAt = existing?.createdAt ?: Instant.now().toString(),
        )
        if (!LessonNote.isValid(note)) return LessonNotesWrite.INVALID
        val sameSubject = current.filter { it.subject.trim() == note.subject && it.id != existing?.id }
        if (sameSubject.size >= LessonNotes.MAX_PER_SUBJECT) return LessonNotesWrite.LIMIT
        if (existing == null && current.size >= LessonNotes.MAX_NOTES) return LessonNotesWrite.LIMIT
        val merged = if (existing == null) {
            current + note
        } else {
            current.map { if (it.id == existing.id) note else it }
        }.filter { LessonNote.isValid(it) }
            .sortedByDescending { it.createdAt }
            .take(LessonNotes.MAX_NOTES)
        if (!write(merged, epoch)) return LessonNotesWrite.REFUSED
        return LessonNotesWrite.WRITTEN
    }

    fun delete(id: String, epoch: Long): LessonNotesWrite {
        val key = id.trim()
        val current = notes()
        if (current.none { it.id == key }) return LessonNotesWrite.NOT_FOUND
        val next = current.filterNot { it.id == key }
        if (!write(next, epoch)) return LessonNotesWrite.REFUSED
        return LessonNotesWrite.WRITTEN
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

fun lessonNotesJson(notes: List<LessonNote>): String {
    val arr = JSONArray()
    for (note in notes.take(LessonNotes.MAX_NOTES)) {
        if (!LessonNote.isValid(note)) continue
        arr.put(
            JSONObject()
                .put("id", note.id)
                .put("subject", note.subject)
                .put("title", note.title)
                .put("text", note.text)
                .put("createdAt", note.createdAt),
        )
    }
    return arr.toString()
}

/** `null` = JSON illisible (à distinguer d'une liste vide valide). */
internal fun parseLessonNotesOrNull(raw: String): List<LessonNote>? = try {
    val arr = JSONArray(raw)
    val out = mutableListOf<LessonNote>()
    for (i in 0 until arr.length()) {
        if (out.size >= LessonNotes.MAX_NOTES) break
        val o = arr.optJSONObject(i) ?: continue
        val note = LessonNote(
            id = o.optString("id").trim(),
            subject = o.optString("subject").trim(),
            title = o.optString("title").trim(),
            text = o.optString("text").trim(),
            createdAt = o.optString("createdAt").trim(),
        )
        if (LessonNote.isValid(note)) out.add(note)
    }
    out.sortedByDescending { it.createdAt }
} catch (_: Exception) {
    null
}
