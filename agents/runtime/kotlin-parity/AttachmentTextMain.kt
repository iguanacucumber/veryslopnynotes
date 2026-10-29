// AttachmentTextMain.kt — pilote JSON de l'extraction du texte des pièces
// jointes (#631).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/attachment-text.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile les VRAIES sources de
// production `fr.veryslopnynotes.data.AttachmentText` (extraction pure, aucun
// import Android) et `fr.veryslopnynotes.core.AssignmentContext` (ordre des
// sources), puis les pilote ici : les assertions portent donc sur du code
// EXÉCUTÉ, sur des fixtures SYNTHÉTIQUES — aucune requête réseau.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`. Les
// erreurs du PILOTE (op inconnue, champ absent) sont préfixées `pilote: ` et
// refusées par le test.
package fr.veryslopnynotes.parity.attachmenttext

import fr.veryslopnynotes.core.AiContext
import fr.veryslopnynotes.core.AiContextEntry
import fr.veryslopnynotes.core.AiContextItem
import fr.veryslopnynotes.core.Assignment
import fr.veryslopnynotes.core.AssignmentAttachment
import fr.veryslopnynotes.core.AssignmentLessonContent
import fr.veryslopnynotes.core.assignmentContextItems
import fr.veryslopnynotes.data.AttachmentText
import fr.veryslopnynotes.data.AttachmentTextResult
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.bool(key: String): Boolean? = (fields[key] as? JVal.Bool)?.value

private fun JVal.Obj.arr(key: String): List<JVal>? = (fields[key] as? JVal.Arr)?.items

private fun JVal.Obj.obj(key: String): JVal.Obj? = fields[key] as? JVal.Obj

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Octets d'une opération : `text` (UTF-8) ou `hex` (fixture binaire). */
private fun bytesOf(op: JVal.Obj): ByteArray {
    val hex = op.str("hex")
    if (hex != null) {
        require(hex.length % 2 == 0) { "pilote: hex impair" }
        val out = ByteArray(hex.length / 2)
        for (i in out.indices) {
            out[i] = hex.substring(i * 2, i * 2 + 2).toInt(16).toByte()
        }
        return out
    }
    return (op.str("text") ?: "").toByteArray(StandardCharsets.UTF_8)
}

private fun resultJson(result: AttachmentTextResult): JVal.Obj = when (result) {
    is AttachmentTextResult.Readable -> ok(
        "kind" to JVal.Str("readable"),
        "text" to JVal.Str(result.text),
        "truncated" to JVal.Bool(result.truncated),
        "originalChars" to JVal.Num(result.originalChars.toDouble()),
    )

    is AttachmentTextResult.Unreadable -> ok(
        "kind" to JVal.Str("unreadable"),
        "reason" to JVal.Str(result.reason),
        "message" to JVal.Str(AttachmentText.unreadableMessage(result.reason)),
    )
}

private fun itemJson(item: AiContextItem): JVal.Obj = ok(
    "type" to JVal.Str(item.type.wire),
    "label" to JVal.Str(item.label),
    "text" to JVal.Str(item.text),
    "truncated" to JVal.Bool(item.truncated),
)

/** Pièce jointe de payload : `{id,label,ref}`. */
private fun attachmentOf(raw: JVal?): AssignmentAttachment? {
    val o = raw as? JVal.Obj ?: return null
    val att = AssignmentAttachment(
        id = o.str("id") ?: "",
        label = o.str("label") ?: "",
        ref = o.str("ref") ?: "",
    )
    return att.takeIf { AssignmentAttachment.isValid(it) }
}

private fun attachmentsOf(raw: JVal?): List<AssignmentAttachment> =
    (raw as? JVal.Arr)?.items.orEmpty().mapNotNull { attachmentOf(it) }

/** Cours de payload : titre, description, pièces jointes. */
private fun lessonOf(raw: JVal?): AssignmentLessonContent? {
    val o = raw as? JVal.Obj ?: return null
    val lesson = AssignmentLessonContent(
        title = o.str("title") ?: "",
        excerpt = o.str("excerpt") ?: "",
        attachments = attachmentsOf(o.fields["attachments"]),
    )
    return lesson.takeIf { AssignmentLessonContent.isValid(it) }
}

/** Devoir de payload (champs du contrat, valeurs par défaut sûres). */
private fun assignmentOf(o: JVal.Obj): Assignment? {
    val assignment = Assignment(
        id = o.str("id") ?: "a-1",
        subject = o.str("subject") ?: "Mathématiques",
        title = o.str("title") ?: "Devoir",
        dueDate = o.str("dueDate") ?: "2026-09-21T00:00:00.000Z",
        done = o.bool("done") ?: false,
        description = o.str("description") ?: "",
        lessonContent = lessonOf(o.fields["lessonContent"]),
        attachments = attachmentsOf(o.fields["attachments"]),
        lessonContents = (o.fields["lessonContents"] as? JVal.Arr)?.items.orEmpty().mapNotNull { lessonOf(it) },
    )
    return assignment.takeIf { Assignment.isValid(it) }
}

/** Sources déjà extraites, fournies par le test (texte ou « illisible »). */
private fun attachmentItemsOf(o: JVal.Obj): List<AiContextItem> {
    val out = mutableListOf<AiContextItem>()
    for (raw in o.arr("attachments").orEmpty()) {
        val item = raw as? JVal.Obj ?: continue
        val label = item.str("label") ?: ""
        val reason = item.str("reason")
        out.add(
            if (reason != null) {
                AiContext.attachmentUnreadable(label, reason)
            } else {
                AiContext.attachment(
                    label,
                    item.str("text") ?: "",
                    truncated = item.bool("truncated") ?: false,
                )
            },
        )
    }
    return out
}

private class Driver {
    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        "limits" -> ok(
            "maxChars" to JVal.Num(AttachmentText.MAX_CHARS.toDouble()),
            "maxBytes" to JVal.Num(AttachmentText.MAX_BYTES.toDouble()),
            "maxPdfPages" to JVal.Num(AttachmentText.MAX_PDF_PAGES.toDouble()),
            "maxAttachments" to JVal.Num(AttachmentText.MAX_ATTACHMENTS.toDouble()),
            "maxVisionAttachments" to JVal.Num(AttachmentText.MAX_VISION_ATTACHMENTS.toDouble()),
        )
        // Extraction BRUTE : c'est le code de production qui lit les octets.
        "extract" -> {
            val name = op.str("name") ?: "piece.txt"
            val mime = op.str("mime") ?: "text/plain"
            val maxChars = (op.num("maxChars") ?: AttachmentText.MAX_CHARS.toDouble()).toInt()
            val maxPages = (op.num("maxPages") ?: AttachmentText.MAX_PDF_PAGES.toDouble()).toInt()
            resultJson(AttachmentText.extract(name, mime, bytesOf(op), maxChars, maxPages))
        }
        // Même extraction, convertie en source citable (libellé « illisible »).
        "extractItem" -> {
            val name = op.str("name") ?: "piece.txt"
            val mime = op.str("mime") ?: "text/plain"
            itemJson(AttachmentText.toAiContextItem(name, AttachmentText.extract(name, mime, bytesOf(op))))
        }
        "unreadableItem" -> {
            val label = op.str("label") ?: "piece"
            val reason = op.str("reason") ?: "format_non_lisible"
            itemJson(AttachmentText.toAiContextItem(label, AttachmentTextResult.Unreadable(reason)))
        }
        // Assembleur #628 sur un devoir complet : ordre, priorité, troncature.
        "context" -> {
            val assignment = assignmentOf(op.obj("assignment") ?: throw IllegalArgumentException("pilote: assignment absent"))
                ?: throw IllegalArgumentException("pilote: assignment hors contrat")
            val result = AiContext.assembleFor(
                AiContextEntry.HOMEWORK,
                assignmentContextItems(assignment, attachmentItemsOf(op)),
            )
            ok(
                "sources" to JVal.Arr(
                    result.sources.map {
                        JVal.Obj(
                            linkedMapOf(
                                "type" to JVal.Str(it.type.wire),
                                "label" to JVal.Str(it.label),
                                "chars" to JVal.Num(it.text.length.toDouble()),
                                "originalChars" to JVal.Num(it.originalChars.toDouble()),
                                "truncated" to JVal.Bool(it.truncated),
                            ),
                        )
                    },
                ),
                "omitted" to JVal.Arr(
                    result.omitted.map {
                        JVal.Obj(
                            linkedMapOf(
                                "type" to JVal.Str(it.type.wire),
                                "label" to JVal.Str(it.label),
                                "reason" to JVal.Str(it.reason.wire),
                            ),
                        )
                    },
                ),
                "totalChars" to JVal.Num(result.totalChars.toDouble()),
                "allLessons" to JVal.Num(assignment.allLessonContents().size.toDouble()),
                "allAttachments" to JVal.Num(assignment.allAttachments().size.toDouble()),
            )
        }
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
    }
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    val driver = Driver()
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(Json.stringify(driver.run(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
