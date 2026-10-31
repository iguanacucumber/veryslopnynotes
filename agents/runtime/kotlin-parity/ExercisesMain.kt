// ExercisesMain.kt — pilote JSON des exercices du manuel.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-exercises.test.ts` (jamais Gradle, jamais l'APK).
package fr.veryslopnynotes.exercises

import fr.veryslopnynotes.core.AiContext
import fr.veryslopnynotes.core.AiContextEntry
import fr.veryslopnynotes.core.AiContextItem
import fr.veryslopnynotes.core.AiContextType
import fr.veryslopnynotes.core.Exercise
import fr.veryslopnynotes.core.ExerciseHelpMode
import fr.veryslopnynotes.core.Exercises
import fr.veryslopnynotes.core.TeacherChat
import fr.veryslopnynotes.core.parseJsonValue
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Int =
    ((fields[key] as? JVal.Num)?.value ?: 0.0).toInt()

private fun JVal.Obj.objs(key: String): List<JVal.Obj> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { it as? JVal.Obj } ?: emptyList()

private fun err(name: String, message: String?): JVal.Obj =
    JVal.Obj(linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")))

private fun modeOf(wire: String): ExerciseHelpMode =
    ExerciseHelpMode.fromWire(wire) ?: throw IllegalArgumentException("pilote: mode inconnu : $wire")

private fun typeOf(wire: String): AiContextType =
    AiContextType.entries.firstOrNull { it.wire == wire }
        ?: throw IllegalArgumentException("pilote: type de source inconnu : $wire")

private fun itemOf(o: JVal.Obj): AiContextItem = AiContextItem(
    type = typeOf(o.str("type") ?: "course"),
    label = o.str("label") ?: "",
    text = o.str("text") ?: "",
)

private fun exerciseOf(o: JVal.Obj): Exercise = Exercise(
    number = o.str("number") ?: "",
    statement = o.str("statement") ?: "",
    page = o.num("page"),
    difficulty = o.str("difficulty") ?: "",
    source = o.str("source") ?: "",
)

private fun exerciseJson(exercise: Exercise): JVal.Obj = JVal.Obj(
    linkedMapOf(
        "number" to JVal.Str(exercise.number),
        "statement" to JVal.Str(exercise.statement),
        "page" to JVal.Num(exercise.page.toDouble()),
        "difficulty" to JVal.Str(exercise.difficulty),
        "source" to JVal.Str(exercise.source),
        "valid" to JVal.Bool(exercise.isValid()),
    ),
)

private fun driver(op: JVal.Obj): JVal = when (op.str("op")) {
    "budget" -> JVal.Obj(
        linkedMapOf(
            "maxExercises" to JVal.Num(Exercises.MAX_EXERCISES.toDouble()),
            "maxStatementChars" to JVal.Num(Exercises.MAX_STATEMENT_CHARS.toDouble()),
            "maxNumberChars" to JVal.Num(Exercises.MAX_NUMBER_CHARS.toDouble()),
            "maxPage" to JVal.Num(Exercises.MAX_PAGE.toDouble()),
            "maxDifficultyChars" to JVal.Num(Exercises.MAX_DIFFICULTY_CHARS.toDouble()),
            "maxAnswerChars" to JVal.Num(Exercises.MAX_ANSWER_CHARS.toDouble()),
            "maxHintChars" to JVal.Num(Exercises.MAX_HINT_CHARS.toDouble()),
        ),
    )
    "extract" -> {
        val items = Exercises.extract(
            text = op.str("text") ?: "",
            page = op.num("page"),
            source = op.str("source") ?: "",
            max = op.num("max").takeIf { it > 0 } ?: Exercises.MAX_EXERCISES,
        )
        JVal.Obj(linkedMapOf("exercises" to JVal.Arr(items.map { exerciseJson(it) })))
    }
    "filter" -> {
        val items = op.objs("items").map { exerciseOf(it) }
        val kept = Exercises.filter(items, op.str("hint") ?: "")
        JVal.Obj(
            linkedMapOf(
                "numbers" to JVal.Arr(kept.map { JVal.Str(it.number) }),
                "statements" to JVal.Arr(kept.map { JVal.Str(it.statement) }),
            ),
        )
    }
    "prompt" -> {
        val mode = modeOf(op.str("mode") ?: "hint")
        val context = AiContext.assembleFor(AiContextEntry.REVISION, op.objs("items").map { itemOf(it) })
        val prompt = Exercises.promptFor(
            mode = mode,
            context = context,
            exerciseNumber = op.str("number") ?: "",
            statement = op.str("statement") ?: "",
            studentAnswer = op.str("answer") ?: "",
            nonce = "exercicenonce0001",
        )
        val number = op.str("number") ?: ""
        JVal.Obj(
            linkedMapOf(
                "system" to JVal.Str(prompt.system),
                "body" to JVal.Str(prompt.body),
                "nonce" to JVal.Str(prompt.nonce),
                "sources" to JVal.Num(context.sources.size.toDouble()),
                "allowed" to JVal.Arr(
                    Exercises.citableLabels(context, number).sorted().map { JVal.Str(it) },
                ),
            ),
        )
    }
    "parse" -> {
        val allowed = (op.fields["allowed"] as? JVal.Arr)?.items
            ?.mapNotNull { (it as? JVal.Str)?.value }?.toSet() ?: emptySet()
        val reply = TeacherChat.parseReply(parseJsonValue(op.str("text") ?: ""), allowed)
        JVal.Obj(
            linkedMapOf(
                "ok" to JVal.Bool(true),
                "answer" to JVal.Str(reply.answer),
                "sources" to JVal.Arr(reply.sources.map { JVal.Str(it) }),
                "unsourced" to JVal.Bool(reply.unsourced),
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
