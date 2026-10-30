package fr.veryslopnynotes.app

import android.util.Base64
import fr.veryslopnynotes.core.AiContext
import fr.veryslopnynotes.core.AiContextEntry
import fr.veryslopnynotes.core.AiContextItem
import fr.veryslopnynotes.core.AiContextType
import fr.veryslopnynotes.core.AiError
import fr.veryslopnynotes.core.ExerciseHelpMode
import fr.veryslopnynotes.core.Exercises
import fr.veryslopnynotes.core.LessonNotes
import fr.veryslopnynotes.core.OutputTooLongException
import fr.veryslopnynotes.core.SecretDetectedException
import fr.veryslopnynotes.core.TeacherChat
import fr.veryslopnynotes.core.TeacherChatMessage
import fr.veryslopnynotes.core.TeacherMode
import fr.veryslopnynotes.core.VisionImage
import fr.veryslopnynotes.core.secretRefusalMessage
import fr.veryslopnynotes.core.transcribeLesson
import fr.veryslopnynotes.data.LlmError
import fr.veryslopnynotes.data.OpenRouterLlm
import fr.veryslopnynotes.data.parseTeacherThreadOrNull
import fr.veryslopnynotes.data.teacherThreadJson
import org.json.JSONArray
import org.json.JSONObject
import fr.veryslopnynotes.core.AiContextResult
import fr.veryslopnynotes.app.VsnBridge.Companion.AWAIT_LLM_MS

/**
 * Exercices du manuel (#632) : proposition LOCALE, sans appel payant.
 *
 * Le texte vient du manuel déjà extrait par le scraper (ou du cahier de
 * cours). On ne fabrique jamais un énoncé : sans marqueur numéroté, la
 * liste est vide et l'UI propose d'ajouter une source. `hint` (page ou
 * chapitre libre) ne fait que FILTRER les énoncés déjà extraits.
 */
internal fun VsnBridge.exercisesPropose(p: JSONObject): JSONObject {
    val subject = bounded(p.string("subject"), TeacherChat.MAX_SUBJECT_CHARS)
    if (subject.isEmpty()) {
        return JSONObject().put("ok", false).put("message", "Choisis une matière.")
    }
    val hint = bounded(p.string("hint"), Exercises.MAX_HINT_CHARS)
    val doc = manualDocFor(subject)
    val subjects = knownSubjects()
    val manualReady = manualAvailableForSubject(subject, subjects)
    val found = mutableListOf<fr.veryslopnynotes.core.Exercise>()
    doc?.let { manual ->
        found.addAll(
            Exercises.extract(
                text = manual.excerpt,
                page = manual.page,
                source = "Manuel : ${manual.title}",
                max = Exercises.MAX_EXERCISES,
            ),
        )
    }
    for (note in LessonNotes.forSubject(lessons.notes(), subject)) {
        found.addAll(
            Exercises.extract(
                text = note.text,
                page = 0,
                source = "Cahier : ${note.title}",
                max = Exercises.MAX_EXERCISES,
            ),
        )
    }
    val unique = found.distinctBy { it.statement.lowercase() }
    val items = Exercises.filter(unique, hint).take(Exercises.MAX_EXERCISES)
    val json = JSONObject()
        .put("ok", true)
        .put("manual", doc != null)
        .put("manualReady", manualReady)
        .put("manualTitle", doc?.title ?: "")
        .put("manualPage", doc?.page ?: 0)
        .put("exercises", JSONArray().apply {
            for (item in items) {
                put(
                    JSONObject()
                        .put("number", item.number)
                        .put("statement", item.statement)
                        .put("page", item.page)
                        .put("difficulty", item.difficulty)
                        .put("source", item.source),
                )
            }
        })
    if (items.isEmpty()) {
        json.put(
            "message",
            if (hint.isNotEmpty()) {
                "Aucun exercice ne correspond à « $hint » dans le manuel ou le cahier."
            } else {
                "Aucun exercice numéroté lisible dans le manuel ou le cahier de cette matière."
            },
        )
        val actions = mutableListOf("add_course")
        if (!manualReady) actions.add(0, "enable_manual")
        json.put("actions", JSONArray(actions))
    }
    return json
}

/**
 * Aide progressive sur UN exercice (#632) : indice, méthode ou correction
 * complète (choix explicite du web). La réponse de l'élève (texte ou photo)
 * est une DONNÉE Untrusted. Aucun effet Pronote, aucune écriture.
 */
internal fun VsnBridge.exercisesHelp(p: JSONObject): JSONObject {
    val subject = bounded(p.string("subject"), TeacherChat.MAX_SUBJECT_CHARS)
    if (subject.isEmpty()) {
        return JSONObject().put("ok", false).put("message", "Choisis une matière.")
    }
    val number = bounded(p.string("number"), Exercises.MAX_NUMBER_CHARS)
    val statement = bounded(p.string("statement"), Exercises.MAX_STATEMENT_CHARS)
    if (statement.isEmpty()) {
        return JSONObject().put("ok", false).put("message", "Choisis un exercice.")
    }
    val mode = ExerciseHelpMode.fromWire(p.string("mode")) ?: ExerciseHelpMode.HINT
    val apiKey = llmKeys.apiKey()?.trim()
        ?: return JSONObject().put("ok", false)
            .put("code", "key")
            .put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
    if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
        return JSONObject().put("ok", false)
            .put("code", "key")
            .put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
    }
    var studentAnswer = bounded(p.string("answer"), Exercises.MAX_ANSWER_CHARS)
    val photoSource = bounded(p.string("photoSource"), 16)
    if (photoSource == "camera" || photoSource == "gallery") {
        when (val shot = awaitPhoto(photoSource)) {
            is PhotoCapture.Result.Cancelled -> return JSONObject().put("ok", false).put("cancelled", true)
            is PhotoCapture.Result.Error ->
                return JSONObject().put("ok", false).put("message", shot.message)
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
                studentAnswer = try {
                    transcribeLesson(
                        provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
                        image = VisionImage(
                            mime = "image/jpeg",
                            base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                        ),
                        apiKey = apiKey,
                    ).text
                } catch (e: SecretDetectedException) {
                    return JSONObject().put("ok", false).put("code", "secret")
                        .put("message", secretRefusalMessage(e.kind))
                } catch (e: OutputTooLongException) {
                    return JSONObject().put("ok", false).put("code", "format").put("message", e.userMessage)
                } catch (_: Exception) {
                    return JSONObject().put("ok", false).put("code", "format")
                        .put("message", "Photo illisible : reprends-la ou écris ta réponse.")
                }
                if (studentAnswer.isBlank()) {
                    return JSONObject().put("ok", false).put("code", "format")
                        .put("message", "Aucune réponse lisible sur la photo : reprends-la ou écris ta réponse.")
                }
            }
        }
    }
    // L'énoncé est la source la PLUS prioritaire : il vient de la page que
    // l'élève a choisie, pas d'une reconstitution du modèle.
    val label = "Exercice ${number.ifEmpty { "?" }}"
    val items = mutableListOf(
        AiContextItem(AiContextType.ASSIGNMENT, label, statement),
    )
    for (source in aiContextForSubject(subject, emptyList()).sources) {
        items.add(
            AiContextItem(
                type = source.type,
                label = source.label,
                text = source.text,
                truncated = source.truncated,
                originalChars = source.originalChars,
            ),
        )
    }
    val context = AiContext.assembleFor(AiContextEntry.REVISION, items)
    if (context.sources.isEmpty()) return refusalJson(context, ok = false)
    return try {
        val reply = Exercises.requestHelp(
            provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
            mode = mode,
            context = context,
            exerciseNumber = number,
            statement = statement,
            studentAnswer = studentAnswer,
            apiKey = apiKey,
        )
        JSONObject()
            .put("ok", true)
            .put("answer", reply.answer)
            .put("sources", JSONArray(reply.sources))
            .put("unsourced", reply.unsourced)
            .put("mode", mode.wire)
            .withAiContext(context)
    } catch (e: SecretDetectedException) {
        JSONObject().put("ok", false).put("code", "secret").put("message", secretRefusalMessage(e.kind))
            .withAiContext(context)
    } catch (e: OutputTooLongException) {
        JSONObject().put("ok", false).put("code", "format").put("message", e.userMessage)
            .withAiContext(context)
    } catch (e: LlmError) {
        JSONObject().put("ok", false).put("code", teacherFailureCode(e)).put("message", e.userMessage)
            .withAiContext(context)
    } catch (e: AiError) {
        JSONObject().put("ok", false)
            .put("code", teacherFailureCode(e))
            .put("message", "Réponse du professeur illisible ou vide : réessaie.")
            .withAiContext(context)
    } catch (_: Exception) {
        JSONObject().put("ok", false)
            .put("code", "network")
            .put("message", "Le professeur est indisponible : réessaie dans un instant.")
            .withAiContext(context)
    }
}

/**
 * Professeur IA contextualisé (#633) : un tour de conversation sur le
 * corpus de la matière. Aucun outil, aucun secret dans le prompt, aucun
 * effet métier : le modèle rend un texte + des libellés cités.
 *
 * Le corpus vient de l'assembleur UNIQUE (#628), avec l'historique borné
 * (CHAT). Les tours anciens sont résumés localement, sans appel payant.
 * Une réponse sans citation est marquée `unsourced` (jamais masquée).
 */
internal fun VsnBridge.teacherTurn(p: JSONObject): JSONObject {
    val subject = bounded(p.string("subject"), TeacherChat.MAX_SUBJECT_CHARS)
    if (subject.isEmpty()) {
        return JSONObject().put("ok", false).put("message", "Choisis une matière.")
    }
    val message = bounded(p.string("message"), TeacherChat.MAX_MESSAGE_CHARS)
    if (message.isEmpty()) {
        return JSONObject().put("ok", false).put("message", "Écris ta question.")
    }
    val mode = TeacherMode.fromWire(p.string("mode")) ?: TeacherMode.EXPLAIN
    val history = teacherHistory(p.optJSONArray("history"))
    val summary = TeacherChat.summaryOf(history)
    val context = aiContextForSubject(subject, history)
    // Corpus vide = refus DÉTERMINISTE avec CTA, AVANT tout appel payant.
    // Un contexte qui ne porte QUE l'historique n'est PAS une source : sans
    // matière (cahier, manuel, page web), aucun appel payant n'est lancé.
    if (context.sources.isEmpty() || context.sources.none { it.type != AiContextType.HISTORY }) {
        return refusalJson(context, ok = false).withTeacherHistory(context, summary.length)
    }
    val apiKey = llmKeys.apiKey()?.trim()
        ?: return JSONObject().put("ok", false)
            .put("code", "key")
            .put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
            .withTeacherHistory(context, summary.length)
    if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
        return JSONObject().put("ok", false)
            .put("code", "key")
            .put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
            .withTeacherHistory(context, summary.length)
    }
    return try {
        val reply = TeacherChat.requestTurn(
            provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
            mode = mode,
            context = context,
            message = message,
            summary = summary,
            apiKey = apiKey,
        )
        JSONObject()
            .put("ok", true)
            .put("answer", reply.answer)
            .put("sources", JSONArray(reply.sources))
            .put("unsourced", reply.unsourced)
            .withTeacherHistory(context, summary.length)
    } catch (e: SecretDetectedException) {
        JSONObject().put("ok", false).put("code", "secret").put("message", secretRefusalMessage(e.kind))
            .withTeacherHistory(context, summary.length)
    } catch (e: OutputTooLongException) {
        JSONObject().put("ok", false).put("code", "format").put("message", e.userMessage)
            .withTeacherHistory(context, summary.length)
    } catch (e: LlmError) {
        JSONObject().put("ok", false).put("code", teacherFailureCode(e)).put("message", e.userMessage)
            .withTeacherHistory(context, summary.length)
    } catch (e: AiError) {
        JSONObject().put("ok", false)
            .put("code", teacherFailureCode(e))
            .put("message", "Réponse du professeur illisible ou vide : réessaie.")
            .withTeacherHistory(context, summary.length)
    } catch (_: Exception) {
        JSONObject().put("ok", false)
            .put("code", "network")
            .put("message", "Le professeur est indisponible : réessaie dans un instant.")
            .withTeacherHistory(context, summary.length)
    }
}

/**
 * Code STABLE d'un échec de tour : l'UI choisit le message et le geste
 * (clé, quota, timeout, vide, réseau). Jamais un texte d'exception.
 */
internal fun VsnBridge.teacherFailureCode(e: Throwable): String = when (e) {
    is SecretDetectedException -> "secret"
    is OutputTooLongException -> "format"
    is LlmError -> when (e.status) {
        401, 403 -> "key"
        402, 429 -> "quota"
        else -> if (e.userMessage.contains("timeout", ignoreCase = true) ||
            e.userMessage.contains("délai", ignoreCase = true)
        ) {
            "timeout"
        } else {
            "network"
        }
    }
    is AiError -> if (e.message?.contains("vide", ignoreCase = true) == true) "empty" else "format"
    else -> "network"
}

/**
 * Contexte IA d'une MATIÈRE (pas d'un devoir) : cahier de cours, manuel
 * enregistré, puis historique. Même assembleur et mêmes budgets que #628.
 * #631/#634 pourront ajouter pièces jointes/page web via les paramètres.
 */
internal fun VsnBridge.aiContextForSubject(
    subject: String,
    history: List<TeacherChatMessage>,
): AiContextResult {
    val items = mutableListOf<AiContextItem>()
    for (note in LessonNotes.forSubject(lessons.notes(), subject)) {
        items.add(AiContext.note(note.title, note.text))
    }
    manualDocFor(subject)?.let { doc ->
        items.add(AiContext.manual(doc.title, doc.excerpt))
    }
    items.addAll(TeacherChat.historyItems(history))
    return AiContext.assembleFor(AiContextEntry.CHAT, items)
}

/** Historique reçu du web : borné, validé, jamais une écriture. */
internal fun VsnBridge.teacherHistory(raw: JSONArray?): List<TeacherChatMessage> {
    if (raw == null) return emptyList()
    val payload = JSONObject().put("subject", "").put("messages", raw)
    return try {
        parseTeacherThreadOrNull(payload.toString())?.messages ?: emptyList()
    } catch (_: Exception) {
        emptyList()
    }
}

internal fun JSONObject.withTeacherHistory(context: AiContextResult, summaryChars: Int): JSONObject {
    val historySources = context.sources.filter { it.type == AiContextType.HISTORY }
    return withAiContext(context)
        .put("historyCount", historySources.size)
        .put("historyChars", historySources.sumOf { it.text.length })
        .put("summaryChars", summaryChars)
}

/** Fil local : lecture seule, aucune donnée scolaire hors de l'appareil. */
internal fun VsnBridge.teacherLoad(): JSONObject = try {
    JSONObject(teacherThreadJson(teacherChat.load()))
} catch (_: Exception) {
    JSONObject().put("subject", "").put("messages", JSONArray())
}

/**
 * Sauvegarde du fil local. Le web envoie la matière + les tours ; le pont
 * borne, valide, puis écrit sous la garde d'époque. Un refus d'écriture
 * n'est JAMAIS un « ok » (I10) : le répertoire purgé ne ressuscite pas.
 */
internal fun VsnBridge.teacherSave(p: JSONObject, epoch: Long): JSONObject {
    val rawCount = p.optJSONArray("messages")?.length() ?: 0
    val thread = try {
        parseTeacherThreadOrNull(p.toString())
    } catch (_: Exception) {
        null
    } ?: return JSONObject().put("ok", false).put("message", "Discussion invalide.")
    if (!TeacherChat.isThreadValid(thread)) {
        return JSONObject().put("ok", false).put("message", "Discussion invalide.")
    }
    // Un tour invalide a été ÉCARTÉ par le parseur : ne pas l'enregistrer
    // en silence (le web doit savoir que rien n'a été écrit tel quel).
    val expected = minOf(rawCount, TeacherChat.MAX_STORED_MESSAGES)
    if (thread.messages.size != expected) {
        return JSONObject().put("ok", false).put("message", "Discussion invalide.")
    }
    val bounded = TeacherChat.trimThread(thread)
    if (!teacherChat.save(bounded, epoch)) {
        return JSONObject().put("ok", false)
            .put("message", "Session modifiée : discussion non enregistrée.")
    }
    return JSONObject().put("ok", true).put("count", bounded.messages.size)
}

/** Suppression du fil local sous la garde d'époque. */
internal fun VsnBridge.teacherDelete(epoch: Long): JSONObject =
    if (!teacherChat.delete(epoch)) {
        JSONObject().put("ok", false).put("message", "Session modifiée : discussion non supprimée.")
    } else {
        JSONObject().put("ok", true)
    }

