package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.LessonNote
import fr.veryslopnynotes.core.LessonNotes
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Course notes on disk: ONE JSON file in `filesDir/offline/`.
 *
 * One file, not a database: the volume is tiny (64 bounded notes), the repo has
 * no Room or DataStore, and the account purge already erases `offline/`
 * recursively (I16). The write goes through [OfflineArtifacts.writeText]: a
 * note saved during a logout is ABANDONED, the purged directory stays gone.
 *
 * `@Synchronized`: protège chaque accès au fichier (lecture/écriture d'un
 * appel). La perte de mise à jour, elle, est empêchée par le verrou de
 * [LessonNotesRepository], qui couvre la relecture ET la fusion.
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
        // Un fichier tronqué ou corrompu est mis en quarantaine : la sauvegarde
        // précédente est relue avant de retomber sur l'ancien `cahier.json`.
        val current = DurableFile.read(file, ::parseLessonNotesOrNull)
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
