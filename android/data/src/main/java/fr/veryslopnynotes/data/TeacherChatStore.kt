package fr.veryslopnynotes.data

import fr.veryslopnynotes.core.AiContext
import fr.veryslopnynotes.core.TeacherChat
import fr.veryslopnynotes.core.TeacherChatMessage
import fr.veryslopnynotes.core.TeacherChatSourceMeta
import fr.veryslopnynotes.core.TeacherThread
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Fil de discussion du professeur IA : UN fichier JSON dans
 * `filesDir/offline/teacher_chat.json`.
 *
 * `offline/` parce que le fil est de la DONNÉE DU COMPTE (questions, réponses,
 * sources) : la purge de déconnexion efface ce dossier EN TOUT (I16 bis).
 * L'écriture passe par [OfflineArtifacts] (garde d'époque) : une sauvegarde
 * demandée pendant une déconnexion est ABANDONNÉE, le dossier purgé ne
 * ressuscite pas.
 *
 * Aucun réseau ici, aucun identifiant Pronote.
 */
interface TeacherChatLocalStore {
    fun load(): TeacherThread

    /** false = écriture abandonnée (la session a changé depuis [epoch]). */
    fun save(thread: TeacherThread, epoch: Long): Boolean

    /** false = suppression abandonnée (la session a changé depuis [epoch]). */
    fun delete(epoch: Long): Boolean
}

class FileTeacherChatStore(private val file: File) : TeacherChatLocalStore {
    @Synchronized
    override fun load(): TeacherThread {
        val raw = try {
            file.takeIf { it.isFile }?.readText()
        } catch (_: Exception) {
            null
        } ?: return TeacherThread()
        return TeacherChat.trimThread(parseTeacherThreadOrNull(raw) ?: TeacherThread())
    }

    @Synchronized
    override fun save(thread: TeacherThread, epoch: Long): Boolean {
        val bounded = TeacherChat.trimThread(thread)
        if (!TeacherChat.isThreadValid(bounded)) return false
        return OfflineArtifacts.writeText(file, teacherThreadJson(bounded), epoch)
    }

    @Synchronized
    override fun delete(epoch: Long): Boolean =
        SessionEpoch.writeIfCurrent(epoch) {
            try {
                file.delete()
            } catch (_: Exception) {
                // ponytail: best-effort, comme la purge du cache.
            }
            true
        } ?: false
}

class InMemoryTeacherChatStore : TeacherChatLocalStore {
    private var thread: TeacherThread = TeacherThread()

    @Synchronized
    override fun load(): TeacherThread = thread

    @Synchronized
    override fun save(thread: TeacherThread, epoch: Long): Boolean {
        val bounded = TeacherChat.trimThread(thread)
        if (!TeacherChat.isThreadValid(bounded)) return false
        return SessionEpoch.writeIfCurrent(epoch) {
            this.thread = bounded
            true
        } ?: false
    }

    @Synchronized
    override fun delete(epoch: Long): Boolean =
        SessionEpoch.writeIfCurrent(epoch) {
            thread = TeacherThread()
            true
        } ?: false
}

fun teacherThreadJson(thread: TeacherThread): String {
    val bounded = TeacherChat.trimThread(thread)
    val messages = JSONArray()
    for (message in bounded.messages) {
        messages.put(teacherMessageJson(message))
    }
    return JSONObject()
        .put("subject", bounded.subject)
        .put("messages", messages)
        .toString()
}

private fun teacherMessageJson(message: TeacherChatMessage): JSONObject {
    val sources = JSONArray()
    message.sources.forEach { sources.put(it) }
    val context = JSONArray()
    for (source in message.context) {
        context.put(
            JSONObject()
                .put("type", source.type)
                .put("label", source.label)
                .put("chars", source.chars)
                .put("truncated", source.truncated),
        )
    }
    return JSONObject()
        .put("role", message.role)
        .put("text", message.text)
        .put("sources", sources)
        .put("unsourced", message.unsourced)
        .put("context", context)
        .put("summaryChars", message.summaryChars)
}

/** `null` = JSON illisible (à distinguer d'un fil vide valide). */
fun parseTeacherThreadOrNull(raw: String): TeacherThread? = try {
    val root = JSONObject(raw)
    val subject = root.optString("subject", "").trim().take(TeacherChat.MAX_SUBJECT_CHARS)
    val arr = root.optJSONArray("messages") ?: JSONArray()
    val messages = ArrayList<TeacherChatMessage>()
    for (i in 0 until arr.length()) {
        if (messages.size >= TeacherChat.MAX_STORED_MESSAGES) break
        val obj = arr.optJSONObject(i) ?: continue
        val message = TeacherChatMessage(
            role = obj.optString("role", ""),
            text = obj.optString("text", ""),
            sources = strings(obj.optJSONArray("sources")),
            unsourced = obj.optBoolean("unsourced", false),
            context = sourcesMeta(obj.optJSONArray("context")),
            summaryChars = obj.optInt("summaryChars", 0),
        )
        if (message.isValid()) messages.add(message)
    }
    TeacherThread(subject = subject, messages = messages).takeIf { it.isValid() }
} catch (_: Exception) {
    null
}

private fun strings(arr: JSONArray?): List<String> {
    if (arr == null) return emptyList()
    val out = ArrayList<String>(arr.length())
    for (i in 0 until arr.length()) {
        val value = arr.optString(i, "").trim()
        if (value.isNotEmpty()) out.add(value.take(AiContext.MAX_LABEL_CHARS))
    }
    return out
}

private fun sourcesMeta(arr: JSONArray?): List<TeacherChatSourceMeta> {
    if (arr == null) return emptyList()
    val out = ArrayList<TeacherChatSourceMeta>(arr.length())
    for (i in 0 until arr.length()) {
        val obj = arr.optJSONObject(i) ?: continue
        val meta = TeacherChatSourceMeta(
            type = obj.optString("type", ""),
            label = obj.optString("label", "").trim().take(AiContext.MAX_LABEL_CHARS),
            chars = obj.optInt("chars", 0),
            truncated = obj.optBoolean("truncated", false),
        )
        if (meta.isValid()) out.add(meta)
    }
    return out
}
