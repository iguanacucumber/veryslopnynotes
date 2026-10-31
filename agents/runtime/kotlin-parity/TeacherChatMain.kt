// TeacherChatMain.kt — pilote JSON du professeur IA.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-teacher-chat.test.ts` (jamais Gradle, jamais l'APK).
package fr.veryslopnynotes.teacher

import fr.veryslopnynotes.core.AiContext
import fr.veryslopnynotes.core.AiContextEntry
import fr.veryslopnynotes.core.AiContextItem
import fr.veryslopnynotes.core.AiContextType
import fr.veryslopnynotes.core.AiProceed
import fr.veryslopnynotes.core.TeacherChat
import fr.veryslopnynotes.core.TeacherChatMessage
import fr.veryslopnynotes.core.TeacherMode
import fr.veryslopnynotes.core.TeacherThread
import fr.veryslopnynotes.core.parseJsonValue
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.objs(key: String): List<JVal.Obj> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { it as? JVal.Obj } ?: emptyList()

private fun err(name: String, message: String?): JVal.Obj =
    JVal.Obj(linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")))

private fun typeOf(wire: String): AiContextType =
    AiContextType.entries.firstOrNull { it.wire == wire }
        ?: throw IllegalArgumentException("pilote: type de source inconnu : $wire")

private fun modeOf(wire: String): TeacherMode =
    TeacherMode.fromWire(wire) ?: throw IllegalArgumentException("pilote: mode inconnu : $wire")

private fun itemOf(o: JVal.Obj): AiContextItem = AiContextItem(
    type = typeOf(o.str("type") ?: "course"),
    label = o.str("label") ?: "",
    text = o.str("text") ?: "",
)

private fun messageOf(o: JVal.Obj): TeacherChatMessage = TeacherChatMessage(
    role = o.str("role") ?: "student",
    text = o.str("text") ?: "",
    sources = (o.fields["sources"] as? JVal.Arr)?.items?.mapNotNull { (it as? JVal.Str)?.value } ?: emptyList(),
    unsourced = (o.fields["unsourced"] as? JVal.Bool)?.value ?: false,
    summaryChars = ((o.fields["summaryChars"] as? JVal.Num)?.value ?: 0.0).toInt(),
)

private fun driver(op: JVal.Obj): JVal = when (op.str("op")) {
    "budget" -> JVal.Obj(
        linkedMapOf(
            "maxSubjectChars" to JVal.Num(TeacherChat.MAX_SUBJECT_CHARS.toDouble()),
            "maxMessageChars" to JVal.Num(TeacherChat.MAX_MESSAGE_CHARS.toDouble()),
            "maxAnswerChars" to JVal.Num(TeacherChat.MAX_ANSWER_CHARS.toDouble()),
            "maxCitedSources" to JVal.Num(TeacherChat.MAX_CITED_SOURCES.toDouble()),
            "maxHistoryItems" to JVal.Num(TeacherChat.MAX_HISTORY_ITEMS.toDouble()),
            "maxStoredMessages" to JVal.Num(TeacherChat.MAX_STORED_MESSAGES.toDouble()),
            "maxSummaryChars" to JVal.Num(TeacherChat.MAX_SUMMARY_CHARS.toDouble()),
        ),
    )
    "prompt" -> {
        val mode = modeOf(op.str("mode") ?: "explain")
        val context = AiContext.assembleFor(AiContextEntry.CHAT, op.objs("items").map { itemOf(it) })
        val prompt = TeacherChat.promptFor(
            mode = mode,
            context = context,
            message = op.str("message") ?: "",
            summary = op.str("summary") ?: "",
            nonce = "teachernonce00001",
            proceedAnyway = (op.fields["proceedAnyway"] as? JVal.Bool)?.value ?: false,
        )
        JVal.Obj(
            linkedMapOf(
                "system" to JVal.Str(prompt.system),
                "body" to JVal.Str(prompt.body),
                "nonce" to JVal.Str(prompt.nonce),
                "sources" to JVal.Num(context.sources.size.toDouble()),
            ),
        )
    }
    "parse" -> {
        val allowed = (op.fields["allowed"] as? JVal.Arr)?.items?.mapNotNull { (it as? JVal.Str)?.value }?.toSet()
            ?: emptySet()
        val reply = TeacherChat.parseReply(
            parseJsonValue(op.str("text") ?: ""),
            allowed,
            allowUnsourced = (op.fields["allowUnsourced"] as? JVal.Bool)?.value ?: false,
        )
        JVal.Obj(
            linkedMapOf(
                "ok" to JVal.Bool(true),
                "answer" to JVal.Str(reply.answer),
                "sources" to JVal.Arr(reply.sources.map { JVal.Str(it) }),
                "unsourced" to JVal.Bool(reply.unsourced),
            ),
        )
    }
    "proceedIntro" -> {
        val missing = (op.fields["missing"] as? JVal.Arr)?.items
            ?.mapNotNull { (it as? JVal.Str)?.value }
            ?: emptyList()
        JVal.Obj(linkedMapOf("intro" to JVal.Str(AiProceed.intro(missing))))
    }
    "history" -> {
        val messages = op.objs("messages").map { messageOf(it) }
        val items = TeacherChat.historyItems(messages)
        JVal.Obj(
            linkedMapOf(
                "labels" to JVal.Arr(items.map { JVal.Str(it.label) }),
                "texts" to JVal.Arr(items.map { JVal.Str(it.text) }),
                "summary" to JVal.Str(TeacherChat.summaryOf(messages)),
            ),
        )
    }
    "thread" -> {
        val messages = op.objs("messages").map { messageOf(it) }
        val thread = TeacherChat.trimThread(TeacherThread(op.str("subject") ?: "", messages))
        JVal.Obj(
            linkedMapOf(
                "valid" to JVal.Bool(TeacherChat.isThreadValid(thread)),
                "subject" to JVal.Str(thread.subject),
                "count" to JVal.Num(thread.messages.size.toDouble()),
                "roles" to JVal.Arr(thread.messages.map { JVal.Str(it.role) }),
            ),
        )
    }
    else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
}

fun main() {
    val stdin = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val stdout = PrintStream(System.out, true, StandardCharsets.UTF_8.name())
    val stderr = PrintStream(System.err, true, StandardCharsets.UTF_8.name())
    while (true) {
        val line = stdin.readLine() ?: break
        if (line.isBlank()) continue
        try {
            stdout.println(Json.stringify(driver(Json.parse(line) as JVal.Obj)))
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
