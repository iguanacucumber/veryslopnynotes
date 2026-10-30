package fr.veryslopnynotes.app

import android.util.Base64
import fr.veryslopnynotes.core.AiContext
import fr.veryslopnynotes.core.AiContextEntry
import fr.veryslopnynotes.core.AiContextItem
import fr.veryslopnynotes.core.AiContextResult
import fr.veryslopnynotes.core.AiError
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.ExamCandidate
import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.core.HomeworkAi
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.core.LessonNotes
import fr.veryslopnynotes.core.OutputTooLongException
import fr.veryslopnynotes.core.RevisionAi
import fr.veryslopnynotes.core.RevisionChunk
import fr.veryslopnynotes.core.RevisionExam
import fr.veryslopnynotes.core.SecretDetectedException
import fr.veryslopnynotes.core.VisionImage
import fr.veryslopnynotes.core.assembleRevisionSheet
import fr.veryslopnynotes.core.revisionFailureMessage
import fr.veryslopnynotes.core.saveRevisionSheet
import fr.veryslopnynotes.core.secretRefusalMessage
import fr.veryslopnynotes.core.transcribeLesson
import fr.veryslopnynotes.data.AttachmentText
import fr.veryslopnynotes.data.AttachmentTextResult
import fr.veryslopnynotes.data.DownloadedFiles
import fr.veryslopnynotes.data.LlmError
import fr.veryslopnynotes.data.OpenRouterHomework
import fr.veryslopnynotes.data.OpenRouterLlm
import fr.veryslopnynotes.data.SessionEpoch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import fr.veryslopnynotes.app.VsnBridge.Companion.AWAIT_LLM_MS
import fr.veryslopnynotes.app.VsnBridge.Companion.ATTACHMENT_BUDGET_MS
import fr.veryslopnynotes.app.VsnBridge.Companion.HOMEWORK_LLM_TIMEOUT_MS

// --- LLM -------------------------------------------------------------------

internal fun VsnBridge.saveLlmKey(p: JSONObject): JSONObject {
    val key = p.string("key").trim()
    if (key.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
        return JSONObject().put("ok", false).put("message", "Clé LLM trop courte.")
    }
    if (key.length > fr.veryslopnynotes.core.Homework.MAX_API_KEY_CHARS) {
        return JSONObject().put("ok", false).put("message", "Clé LLM trop longue.")
    }
    // #595 : ASCII imprimable SEUL. OkHttp refuse tout caractère hors
    // 0x20..0x7E dans un en-tête : une clé collée avec NBSP, zéro-largeur
    // ou accent était ENREGISTRÉE puis cassait chaque appel (IAE à
    // l'envoi) — l'élève lisait « Échec de l'assistant. » pour tout,
    // clé « configurée » d'apparence. isWhitespace ne voit PAS le NBSP.
    if (key.any { it.isISOControl() || it.isWhitespace() || it > '~' }) {
        return JSONObject().put("ok", false).put("message", "Caractère interdit dans la clé.")
    }
    return try {
        llmKeys.save(key)
        JSONObject().put("ok", true)
    } catch (_: IllegalArgumentException) {
        JSONObject().put("ok", false).put("message", "Clé LLM refusée.")
    }
}

internal fun VsnBridge.askHomework(p: JSONObject, epoch: Long): JSONObject {
    val id = bounded(p.string("assignmentId"), 128)
    if (id.isEmpty()) throw BridgeFailure("bad_request", "Devoir introuvable.")
    // #369 : la semaine AFFICHÉE : le devoir demandé peut venir d'une
    // semaine non courante (le cache ne porte que la dernière lue).
    val week = bounded(p.string("weekStart"), 10)
    val assignment = loadAssignments(id, week).firstOrNull { it.id == id }
        ?: return JSONObject().put("ok", false).put("message", "Devoir introuvable.")
    val context = aiContextFor(assignment, AiContextEntry.HOMEWORK, week, epoch)
    // #628 : corpus vide = refus DÉTERMINISTE avec CTA, AVANT tout appel
    // payant. L'ancien chemin payait un aller-retour pour lire « aucune
    // source » et n'offrait aucune action.
    if (context.sources.isEmpty()) {
        return refusalJson(context)
    }
    val sources = context.sources.map { it.toHomeworkSource() }
    val question = fr.veryslopnynotes.data.HomeworkRepository.questionFor(assignment)
    val result = await<fr.veryslopnynotes.data.HomeworkResult>(AWAIT_LLM_MS) { cb ->
        // Budget fournisseur STRICTEMENT sous l'attente du pont : à budget
        // égal, une réponse produite par la reprise arrive quand `await`
        // abandonne déjà (« L'assistant n'a pas répondu »).
        OpenRouterHomework(OpenRouterLlm(timeoutMs = HOMEWORK_LLM_TIMEOUT_MS), llmKeys)
            .generate(question, sources, cb)
    } ?: return JSONObject().put("ok", false).put("message", "L'assistant n'a pas répondu.")
        .withAiContext(context)
    val outcome = result.outcome
        ?: return JSONObject().put("ok", false)
            .put("message", result.error ?: OpenRouterHomework.GENERIC_ERROR_MESSAGE)
            .withAiContext(context)
    return when (outcome) {
        is HomeworkOutcome.Answer -> homeworkAnswerJson(outcome).withAiContext(context)
        // #416 : le motif du modèle est un texte LIBRE (echo de la consigne
        // possible) : il ne franchit JAMAIS le pont. Le pont rend une
        // phrase française bornée, dans le champ `message` que l'UI lit.
        is HomeworkOutcome.Refused -> homeworkRefusalJson(outcome, context)
    }
}

/**
 * Corrigé validé -> réponse de pont BORNÉE (#629) : le texte, les étapes
 * ordonnées et les sources réellement citées traversent la frontière. Le
 * schéma est déjà validé par `HomeworkAi` ; on borne ici ce que l'UI
 * affiche pour qu'un lot de citations ne fasse pas grossir la réponse.
 */
internal fun VsnBridge.homeworkAnswerJson(outcome: HomeworkOutcome.Answer): JSONObject =
    JSONObject()
        .put("ok", true)
        .put("answer", outcome.answer.trim().take(Homework.MAX_ANSWER_CHARS))
        .put("steps", JSONArray().apply {
            outcome.steps.take(Homework.MAX_STEPS).forEach {
                put(it.trim().take(Homework.MAX_STEP_CHARS))
            }
        })
        .put("sources", JSONArray().apply {
            outcome.sources.map { it.trim() }
                .filter { it.isNotEmpty() }
                .distinct()
                .take(Homework.MAX_SOURCES)
                .forEach { put(it.take(Homework.MAX_LABEL_CHARS)) }
        })

/**
 * Refus du modèle : la phrase bornée du pont, jamais le motif libre. Les
 * CTA ne sont proposés que pour le refus « sources insuffisantes » ; les
 * autres causes ne reçoivent pas un faux diagnostic.
 */
internal fun VsnBridge.homeworkRefusalJson(
    outcome: HomeworkOutcome.Refused,
    context: AiContextResult,
): JSONObject {
    val json = JSONObject()
        .put("ok", true)
        .put("refused", true)
        .put("message", homeworkRefusalMessage(outcome.reason))
        .withAiContext(context)
    if (outcome.reason.trim().equals(Homework.REFUSAL_SOURCES_INSUFFICIENT, ignoreCase = true)) {
        json.put("actions", JSONArray(AiContext.REFUSAL_ACTIONS))
    }
    return json
}

/**
 * Contexte IA unique pour un devoir (#628/#631). TOUS les points d'entrée
 * (aide texte, photo, fiche, futur chat) partent d'ici : consigne, TOUS
 * les cours Pronote, pièces jointes lisibles, cahier, manuel, web,
 * historique.
 *
 * #631 : les pièces jointes du devoir ET de ses cours sont téléchargées
 * avec le client local (I1), bornées, puis extraites LOCALEMENT en texte
 * (I6 : Untrusted au prompt). Une pièce jointe illisible reste une source
 * NOMMÉE, jamais une exception. Le cache passe par [DownloadedFiles] : il
 * est borné et purgé avec le compte (I26).
 *
 * Les pages web ne sont admises que si leur TEXTE est déjà disponible : une
 * URL ne devient jamais une source inventée (#634).
 */
internal fun VsnBridge.aiContextFor(
    assignment: Assignment,
    entry: AiContextEntry,
    week: String = "",
    epoch: Long = SessionEpoch.current(),
    webPages: List<AiContextItem> = emptyList(),
    history: List<AiContextItem> = emptyList(),
): AiContextResult {
    val items = mutableListOf<AiContextItem>()
    items.addAll(
        fr.veryslopnynotes.data.HomeworkRepository.contextItems(
            assignment,
            attachmentContextItems(assignment, week, epoch),
        ),
    )
    for (note in LessonNotes.forSubject(lessons.notes(), assignment.subject)) {
        items.add(AiContext.note(note.title, note.text))
    }
    manualDocFor(assignment.subject)?.let { doc ->
        items.add(AiContext.manual(doc.title, doc.excerpt))
    }
    items.addAll(webPages)
    items.addAll(history)
    return AiContext.assembleFor(entry, items)
}

/**
 * Sources des pièces jointes d'un devoir, dans l'ordre du payload. Le
 * téléchargement est BORNÉ (nombre, taille) et passe par le cache du
 * compte : une pièce déjà ouverte n'est pas re-téléchargée. Chaque coupe ou
 * échec devient une source nommée, jamais un crash.
 */
internal fun VsnBridge.attachmentContextItems(
    assignment: Assignment,
    week: String,
    epoch: Long,
): List<AiContextItem> {
    val attachments = assignment.allAttachments()
    if (attachments.isEmpty()) return emptyList()
    val out = mutableListOf<AiContextItem>()
    var visionCalls = 0
    // Budget TOTAL : le plafond d'attente natif (100 s) ne doit pas être
    // dépassé par une pile de téléchargements. Passé le budget, les pièces
    // restantes sont NOMMÉES « délai », jamais perdues en silence.
    val deadline = System.nanoTime() + ATTACHMENT_BUDGET_MS * 1_000_000L
    for ((index, att) in attachments.withIndex()) {
        if (index >= AttachmentText.MAX_ATTACHMENTS || System.nanoTime() > deadline) {
            val remaining = attachments.size - index
            out.add(
                AiContext.attachmentUnreadable(
                    "$remaining pièces jointes non lues",
                    if (index >= AttachmentText.MAX_ATTACHMENTS) {
                        "Limite de ${AttachmentText.MAX_ATTACHMENTS} pièces jointes par envoi."
                    } else {
                        "Délai de lecture des pièces jointes dépassé : elles n'ont pas été lues."
                    },
                ),
            )
            break
        }
        val file = attachmentFile(assignment, att, week, epoch)
        if (file == null) {
            out.add(
                AiContext.attachmentUnreadable(
                    att.label,
                    "Téléchargement indisponible : la pièce jointe n'a pas été lue.",
                ),
            )
            continue
        }
        val mime = mimeOf(att.label)
        val result = try {
            if (mime.startsWith("image/")) {
                if (visionCalls >= AttachmentText.MAX_VISION_ATTACHMENTS) {
                    AttachmentTextResult.Unreadable("image_vision")
                } else {
                    visionCalls += 1
                    imageAttachmentText(file)
                }
            } else {
                AttachmentText.extract(att.label, mime, file.readBytes())
            }
        } catch (_: Exception) {
            AttachmentTextResult.Unreadable("extraction_impossible")
        }
        out.add(AttachmentText.toAiContextItem(att.label, result))
    }
    return out
}

/**
 * Fichier de pièce jointe dans le cache du compte, ou téléchargé puis écrit
 * sous la garde d'époque. `null` = session changée ou téléchargement refusé :
 * aucun texte n'est ajouté, donc le cache purgé ne ressuscite pas.
 */
internal fun VsnBridge.attachmentFile(
    assignment: Assignment,
    att: AssignmentAttachment,
    week: String,
    epoch: Long,
): File? {
    val root = File(ctx.cacheDir, DownloadedFiles.ATTACHMENTS)
    DownloadedFiles.cachedFor(root, assignment.id, att.id, att.label)?.let { return it }
    val data = await<fr.veryslopnynotes.data.AttachmentData?> { cb ->
        assignments.fetchAttachment(assignment.id, att.id, week, cb)
    } ?: return null
    if (data.bytes.isEmpty() || data.bytes.size > DownloadedFiles.MAX_BYTES) return null
    return DownloadedFiles.write(root, assignment.id, att.id, att.label, data.bytes, epoch)
}

/**
 * Image de pièce jointe -> texte par le MÊME chemin vision que la photo de
 * cours (#587) : ré-encodage JPEG borné (métadonnées retirées), prompt
 * gardé, sortie validée. Aucune clé = source illisible explicite.
 */
internal fun VsnBridge.imageAttachmentText(file: File): AttachmentTextResult {
    val apiKey = llmKeys.apiKey()?.trim().orEmpty()
    if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
        return AttachmentTextResult.Unreadable("image_vision_indisponible")
    }
    val bytes = PhotoPrep.prepare(file)
        ?: return AttachmentTextResult.Unreadable("image_vision")
    return try {
        val draft = transcribeLesson(
            provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
            image = VisionImage(
                mime = "image/jpeg",
                base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
            ),
            apiKey = apiKey,
        )
        if (draft.text.isBlank()) {
            AttachmentTextResult.Unreadable("image_vision")
        } else {
            AttachmentTextResult.Readable(draft.text, false)
        }
    } catch (_: Exception) {
        AttachmentTextResult.Unreadable("image_vision")
    }
}

/** Métadonnées « Ce qui est envoyé » : type, libellé, taille, troncature. */
internal fun aiContextJson(context: AiContextResult): JSONArray = JSONArray().apply {
    for (source in context.sources) {
        put(
            JSONObject()
                .put("type", source.type.wire)
                .put("label", source.label)
                .put("chars", source.text.length)
                .put("truncated", source.truncated),
        )
    }
}

internal fun JSONObject.withAiContext(context: AiContextResult): JSONObject =
    put("context", aiContextJson(context))
        .put("contextChars", context.totalChars)
        .put("contextOmitted", context.omitted.size)

/** Refus déterministe du corpus vide, avec CTA stables (jamais de motif libre). */
internal fun VsnBridge.refusalJson(context: AiContextResult, ok: Boolean = true): JSONObject {
    val refusal = context.refusal
    return JSONObject()
        .put("ok", ok)
        .put("refused", true)
        .put("message", refusal?.message ?: AiContext.REFUSAL_MESSAGE)
        .put("refusal", refusal?.code ?: AiContext.REFUSAL_CODE)
        .put("actions", JSONArray(refusal?.actions ?: AiContext.REFUSAL_ACTIONS))
        .withAiContext(context)
}

/**
 * Photo d'énoncé -> corrigé (#588). Même schéma et mêmes citations que
 * l'aide texte ; la photo est une source citable supplémentaire. Aucun
 * enregistrement du corrigé, aucun effet métier (I7).
 */
internal fun VsnBridge.solveHomeworkPhoto(p: JSONObject, epoch: Long): JSONObject {
    val id = bounded(p.string("assignmentId"), 128)
    if (id.isEmpty()) throw BridgeFailure("bad_request", "Devoir introuvable.")
    val week = bounded(p.string("weekStart"), 10)
    val assignment = loadAssignments(id, week).firstOrNull { it.id == id }
        ?: return JSONObject().put("ok", false).put("message", "Devoir introuvable.")
    val apiKey = llmKeys.apiKey()?.trim()
        ?: return JSONObject().put("ok", false)
            .put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
    if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
        return JSONObject().put("ok", false)
            .put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
    }
    // Même corpus que l'aide texte. Une photo est une source à part entière :
    // un corpus texte vide reste valide pour ce chemin (allowEmpty).
    val context = aiContextFor(assignment, AiContextEntry.PHOTO, week, epoch)
    return when (val shot = awaitPhoto(bounded(p.string("source"), 16).ifEmpty { "camera" })) {
        is PhotoCapture.Result.Cancelled -> JSONObject().put("ok", false).put("cancelled", true)
            .withAiContext(context)
        is PhotoCapture.Result.Error -> JSONObject().put("ok", false).put("message", shot.message)
            .withAiContext(context)
        is PhotoCapture.Result.Ok -> {
            val bytes = try {
                PhotoPrep.prepare(shot.file)
            } finally {
                photos.discard(shot.file)
            }
            if (bytes == null) {
                return JSONObject().put("ok", false)
                    .put("message", "Photo illisible ou trop lourde : reprends-la.")
                    .withAiContext(context)
            }
            try {
                val outcome = HomeworkAi.generateHomeworkFromPhoto(
                    provider = OpenRouterLlm(timeoutMs = AWAIT_LLM_MS),
                    question = fr.veryslopnynotes.data.HomeworkRepository.questionFor(assignment),
                    sources = context.sources.map { it.toHomeworkSource() },
                    image = VisionImage(
                        mime = "image/jpeg",
                        base64 = Base64.encodeToString(bytes, Base64.NO_WRAP),
                    ),
                    apiKey = apiKey,
                )
                when (outcome) {
                    is HomeworkOutcome.Answer ->
                        homeworkAnswerJson(outcome).withAiContext(context)
                    is HomeworkOutcome.Refused ->
                        homeworkRefusalJson(outcome, context)
                }
            } catch (e: SecretDetectedException) {
                JSONObject().put("ok", false).put("message", secretRefusalMessage(e.kind))
                    .withAiContext(context)
            } catch (e: OutputTooLongException) {
                JSONObject().put("ok", false).put("message", e.userMessage)
                    .withAiContext(context)
            } catch (e: LlmError) {
                JSONObject().put("ok", false).put("message", e.userMessage)
                    .withAiContext(context)
            } catch (_: AiError) {
                JSONObject().put("ok", false)
                    .put("message", "Réponse de l'assistant hors format : réessaie avec une photo plus nette.")
                    .withAiContext(context)
            } catch (_: Exception) {
                JSONObject().put("ok", false).put("message", "Aide photo indisponible : réessaie dans un instant.")
                    .withAiContext(context)
            }
        }
    }
}

/**
 * Fiche de révision locale : même pipeline validé que le reste de l'app
 * (`RevisionAi.requestRevisionSheet` + `assembleRevisionSheet`), clé lue à
 * l'appel, sortie contrôlée par core (I4/I5). Aucune donnée du devoir ne
 * sort de l'appareil ailleurs que dans ce prompt OpenRouter déclaré comme
 * donnée (I6).
 */
internal fun VsnBridge.generateRevision(p: JSONObject, epoch: Long): JSONObject {
    val id = bounded(p.string("assignmentId"), 128)
    val store = revisions ?: throw BridgeFailure("unavailable", "Stockage des fiches indisponible.")
    // #369 comme l'aide devoirs (#596) : la semaine AFFICHÉE. Le repli
    // réseau sans semaine ne couvre que now−7 j / now+21 j — un devoir
    // affiché hors de cette fenêtre était « introuvable ».
    val week = bounded(p.string("weekStart"), 10)
    val assignment = loadAssignments(id, week).firstOrNull { it.id == id }
        ?: return JSONObject().put("ok", false).put("message", "Devoir introuvable.")
    // #628 : la fiche part du MÊME assembleur que l'aide texte et la photo.
    // Le corpus est évalué AVANT la clé : un devoir sans source refuse avec
    // CTA de façon déterministe, même sans clé configurée.
    val context = aiContextFor(assignment, AiContextEntry.REVISION, week, epoch)
    val chunks = context.sources.map { RevisionChunk(it.text, it.label) }
    if (chunks.isEmpty()) {
        // Corpus vide : refus déterministe + CTA, aucun appel payant.
        return refusalJson(context, ok = false)
    }
    val apiKey = llmKeys.apiKey()?.trim()
        ?: return JSONObject().put("ok", false)
            .put("message", fr.veryslopnynotes.data.HomeworkRepository.NO_KEY_MESSAGE)
    // Clé trop courte = refus AVANT l'appel : pas d'aller-retour inutile,
    // et un message qui dit la vraie cause (« clé absente »).
    if (apiKey.length < OpenRouterLlm.MIN_API_KEY_CHARS) {
        return JSONObject().put("ok", false)
            .put("message", "Clé LLM trop courte : renseigne-la dans Réglages.")
    }
    val date = assignment.dueDate.take(10)
    if (date.length != 10) {
        return JSONObject().put("ok", false).put("message", "Devoir sans date exploitable.")
            .withAiContext(context)
    }
    val exam = RevisionExam(
        id = assignment.id,
        subject = assignment.subject.ifBlank { "matière" },
        date = date,
        matched = assignment.title.ifBlank { "devoir" },
    )
    return try {
        // #428 : le point d'entree PUBLIC du core (prompt + schema + cle
        // relayee). Le pont ne forge plus son propre appel fournisseur :
        // un seul endroit decide du prompt et du schema.
        // #594 : même délai que l'aide photo — la fiche (manuel + consigne)
        // prend souvent plus de 20 s sur un modèle gratuit.
        val sheet = RevisionAi.requestRevisionSheet(OpenRouterLlm(timeoutMs = AWAIT_LLM_MS), exam, chunks, apiKey)
        val candidate = ExamCandidate(
            source = "assignment",
            id = assignment.id,
            subject = exam.subject,
            date = date,
            confidence = "needs_confirm",
            matched = exam.matched,
        )
        // #404 : l'écriture de la fiche passe par la garde d'époque (la
        // fiche est générée par le modèle : l'appel dure plusieurs
        // secondes, une déconnexion peut survenir entre-temps). Refusée =
        // la session a changé : rien n'est écrit, le répertoire purgé ne
        // ressuscite pas (le contenu scolaire du compte déconnecté ne
        // reste pas sur le disque).
        val saved = saveRevisionSheet(
            store,
            assembleRevisionSheet(candidate, sheet, chunks.map { it.source }),
            epoch,
        )
        if (!saved) {
            return JSONObject().put("ok", false)
                .put("message", "Session modifiée : fiche non enregistrée.")
                .withAiContext(context)
        }
        JSONObject().put("ok", true).withAiContext(context)
    } catch (e: SecretDetectedException) {
        // #409 : un SECRET dans le cours (forme detectee par la garde I4).
        // On dit POURQUOI (le type), jamais le secret. Cette branche passe
        // AVANT le repli generique, sinon un secret serait affiche comme
        // une sortie hors format.
        JSONObject().put("ok", false).put("message", secretRefusalMessage(e.kind))
            .withAiContext(context)
    } catch (e: OutputTooLongException) {
        // #411 : la sortie depasse la garde I5. « Format attendu » serait
        // un diagnostic FAUX (la fiche est bien formee, juste trop longue) :
        // on nomme la LIMITE REELLE.
        JSONObject().put("ok", false).put("message", e.userMessage)
            .withAiContext(context)
    } catch (e: LlmError) {
        // Cause identifiée (clé, crédits, modèle, quota, réseau) : message
        // précis, distinct du repli « fiche non générée » (#359).
        JSONObject().put("ok", false).put("message", e.userMessage)
            .withAiContext(context)
    } catch (e: Exception) {
        // La cause RÉELLE, en français et bornée : « Fiche non générée. »
        // avalait tout, sortie invalide comprise (#367). Jamais le message
        // brut de l'exception : il peut nommer un compte ou un hôte.
        JSONObject().put("ok", false)
            .put("message", revisionFailureMessage(revisionFailure(e)))
            .withAiContext(context)
    }
}

