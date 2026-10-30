package fr.veryslopnynotes.app

import android.util.Base64
import fr.veryslopnynotes.core.AiError
import fr.veryslopnynotes.core.LessonNote
import fr.veryslopnynotes.core.LessonNotes
import fr.veryslopnynotes.core.ManualCatalog
import fr.veryslopnynotes.core.OutputTooLongException
import fr.veryslopnynotes.core.SecretDetectedException
import fr.veryslopnynotes.core.VisionImage
import fr.veryslopnynotes.core.secretRefusalMessage
import fr.veryslopnynotes.core.transcribeLesson
import fr.veryslopnynotes.data.LessonNotesWrite
import fr.veryslopnynotes.data.LlmError
import fr.veryslopnynotes.data.OpenRouterLlm
import fr.veryslopnynotes.data.SubjectPrefs
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import fr.veryslopnynotes.app.VsnBridge.Companion.AWAIT_LLM_MS
import fr.veryslopnynotes.app.VsnBridge.Companion.AWAIT_PHOTO_MS

// --- Cahier de cours (#586) -------------------------------------------------

/**
 * Matières proposées par le Cahier : celles déjà connues des caches
 * (notes, devoirs, EDT), les préférences et les notes existantes. Aucune
 * lecture réseau ici : l'écran s'ouvre même hors ligne.
 */
internal fun VsnBridge.lessonsList(): JSONObject {
    val known = LinkedHashSet<String>()
    knownSubjects().forEach { known.add(it) }
    lessons.subjects().forEach { known.add(it) }
    prefsRepo.prefs().forEach { known.add(it.subject) }
    val arr = JSONArray()
    for (subject in known.take(64)) {
        val notes = lessons.notesFor(subject)
        arr.put(
            JSONObject()
                .put("subject", subject)
                .put("manualEnabled", manuals.isEnabled(subject))
                .put("manualAvailable", manualAvailableForSubject(subject, known.toList()))
                .put(
                    "notes",
                    JSONArray().apply {
                        for (note in notes) {
                            put(
                                JSONObject()
                                    .put("id", note.id)
                                    .put("title", note.title)
                                    .put("createdAt", note.createdAt)
                                    .put("chars", note.text.length),
                            )
                        }
                    },
                ),
        )
    }
    return JSONObject()
        .put("subjects", arr)
        .put("maxNotesPerSubject", LessonNotes.MAX_PER_SUBJECT)
        .put("maxTextChars", LessonNote.MAX_TEXT_CHARS)
        .put("maxTitleChars", LessonNote.MAX_TITLE_CHARS)
}

internal fun VsnBridge.lessonsLoad(p: JSONObject): JSONObject {
    val id = bounded(p.string("id"), LessonNote.MAX_ID_CHARS)
    val note = lessons.find(id)
        ?: return JSONObject().put("ok", false).put("message", "Cours introuvable.")
    return JSONObject().put("ok", true).put("note", lessonJson(note))
}

internal fun VsnBridge.lessonsSave(p: JSONObject, epoch: Long): JSONObject {
    val id = bounded(p.string("id"), LessonNote.MAX_ID_CHARS)
    val subject = bounded(p.string("subject"), LessonNote.MAX_SUBJECT_CHARS)
    val title = bounded(p.string("title"), LessonNote.MAX_TITLE_CHARS)
    val text = bounded(p.string("text"), LessonNote.MAX_TEXT_CHARS)
    return when (lessons.save(id, subject, title, text, epoch)) {
        LessonNotesWrite.WRITTEN -> JSONObject().put("ok", true)
        LessonNotesWrite.INVALID -> JSONObject().put("ok", false)
            .put("message", "Cours invalide : matière, titre et texte sont obligatoires (texte 4000 caractères maximum).")
        LessonNotesWrite.LIMIT -> JSONObject().put("ok", false)
            .put("message", "Cours non ajouté : ${LessonNotes.MAX_PER_SUBJECT} cours maximum par matière.")
        LessonNotesWrite.NOT_FOUND -> JSONObject().put("ok", false)
            .put("message", "Cours introuvable : recharge le cahier.")
        LessonNotesWrite.REFUSED -> JSONObject().put("ok", false)
            .put("message", "Session modifiée : cours non enregistré.")
    }
}

internal fun VsnBridge.lessonsDelete(p: JSONObject, epoch: Long): JSONObject {
    val id = bounded(p.string("id"), LessonNote.MAX_ID_CHARS)
    return when (lessons.delete(id, epoch)) {
        LessonNotesWrite.WRITTEN -> JSONObject().put("ok", true)
        LessonNotesWrite.NOT_FOUND -> JSONObject().put("ok", false)
            .put("message", "Cours introuvable.")
        LessonNotesWrite.REFUSED -> JSONObject().put("ok", false)
            .put("message", "Session modifiée : cours non supprimé.")
        else -> JSONObject().put("ok", false).put("message", "Cours non supprimé.")
    }
}

internal fun VsnBridge.lessonsSetManual(p: JSONObject): JSONObject {
    val subject = bounded(p.string("subject"), LessonNote.MAX_SUBJECT_CHARS)
    if (subject.isEmpty()) {
        return JSONObject().put("ok", false).put("message", "Matière invalide.")
    }
    val enabled = p.optBoolean("enabled", true)
    return if (manuals.setEnabled(subject, enabled)) {
        JSONObject().put("ok", true).put("enabled", enabled)
    } else {
        JSONObject().put("ok", false).put("message", "Réglage du manuel non enregistré.")
    }
}

/**
 * Photo de cours -> brouillon de note (#587). La photo ne traverse JAMAIS
 * le pont : elle est lue ici, ré-encodée, envoyée au fournisseur vision,
 * puis supprimée. Le texte revient pour relecture avant enregistrement.
 *
 * L'attente inclut le temps que l'élève cadre la photo : le JS met cette
 * méthode à 0 (timeout illimité), comme le scan du QR. Le plafond natif
 * évite seulement un fil pendu pour toujours.
 */
internal fun VsnBridge.lessonsAddPhoto(p: JSONObject): JSONObject {
    val subject = bounded(p.string("subject"), LessonNote.MAX_SUBJECT_CHARS)
    if (subject.isEmpty()) return JSONObject().put("ok", false).put("message", "Choisis une matière.")
    val source = bounded(p.string("source"), 16).ifEmpty { "camera" }
    val apiKey = llmKeys.apiKey()?.trim()
        ?: return JSONObject().put("ok", false).put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
    if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
        return JSONObject().put("ok", false).put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
    }
    return when (val shot = awaitPhoto(source)) {
        is PhotoCapture.Result.Cancelled ->
            JSONObject().put("ok", false).put("cancelled", true)
        is PhotoCapture.Result.Error ->
            JSONObject().put("ok", false).put("message", shot.message)
        is PhotoCapture.Result.Ok -> {
            val bytes = try {
                PhotoPrep.prepare(shot.file)
            } finally {
                photos.discard(shot.file)
            }
            if (bytes == null) {
                return JSONObject().put("ok", false)
                    .put("message", "Photo illisible ou trop lourde : reprends-la.")
            }
            val image = VisionImage(
                mime = "image/jpeg",
                base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
            )
            try {
                val draft = transcribeLesson(
                    provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
                    image = image,
                    apiKey = apiKey,
                )
                JSONObject().put("ok", true).put("title", draft.title).put("text", draft.text)
            } catch (e: SecretDetectedException) {
                JSONObject().put("ok", false).put("message", secretRefusalMessage(e.kind))
            } catch (e: OutputTooLongException) {
                JSONObject().put("ok", false).put("message", e.userMessage)
            } catch (e: LlmError) {
                JSONObject().put("ok", false).put("message", e.userMessage)
            } catch (_: AiError) {
                JSONObject().put("ok", false).put("message", "Transcription hors format : réessaie avec une photo plus nette.")
            } catch (_: Exception) {
                JSONObject().put("ok", false).put("message", "Transcription impossible : réessaie dans un instant.")
            }
        }
    }
}

/**
 * Attend la capture. Le callback de l'activité arrive sur le thread
 * principal ; le résultat est publié au fil du pont via le latch.
 */
internal fun VsnBridge.awaitPhoto(source: String): PhotoCapture.Result {
    val latch = CountDownLatch(1)
    var result: PhotoCapture.Result? = null
    photos.capture(source) {
        result = it
        latch.countDown()
    }
    if (!latch.await(AWAIT_PHOTO_MS, TimeUnit.MILLISECONDS)) {
        photos.cancel()
        return PhotoCapture.Result.Error("Photo annulée : délai dépassé.")
    }
    return result ?: PhotoCapture.Result.Error("Photo indisponible : réessaie.")
}

internal fun VsnBridge.lessonJson(note: LessonNote): JSONObject = JSONObject()
    .put("id", note.id)
    .put("subject", note.subject)
    .put("title", note.title)
    .put("text", note.text)
    .put("createdAt", note.createdAt)

/** Le manuel est-il utilisable pour cette matière, sans réseau ? */
internal fun VsnBridge.manualAvailableForSubject(
    subject: String,
    known: List<String>,
): Boolean {
    val url = manuals.url() ?: return false
    if (!manuals.isEnabled(subject)) return false
    if (!ManualCatalog.isCatalog(url)) return true
    val classLabel = manuals.classLabel().ifEmpty { cachedProfile?.classLabel.orEmpty() }
    val subjects = (known + subject).distinct()
    return ManualCatalog.resolve(url, classLabel, subjects, subject) != null
}

internal fun JSONArray.putAllPrefs(prefs: List<SubjectPrefs>) {
    for (pref in prefs) {
        put(
            JSONObject()
                .put("subject", pref.subject)
                .put("color", pref.color ?: JSONObject.NULL)
                .put("emoji", pref.emoji ?: JSONObject.NULL)
                .put("label", pref.label ?: JSONObject.NULL),
        )
    }
}

