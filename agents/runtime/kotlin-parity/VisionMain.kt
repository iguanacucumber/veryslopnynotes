// VisionMain.kt — pilote JSON de la photo de cours.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-vision.test.ts` (jamais Gradle, jamais l'APK).
package fr.veryslopnynotes.core

import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.arr(key: String): List<JVal.Obj> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { it as? JVal.Obj } ?: emptyList()

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun err(name: String, message: String?): JVal.Obj =
    JVal.Obj(linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")))

private fun imageOf(op: JVal.Obj): VisionImage = VisionImage(
    mime = op.str("mime") ?: "image/jpeg",
    base64 = op.str("base64") ?: "",
)

private fun imagesOf(op: JVal.Obj): List<VisionImage> {
    val images = op.arr("images")
    return if (images.isEmpty()) listOf(imageOf(op)) else images.map(::imageOf)
}

/** Fournisseur factice : capture le prompt, renvoie la réponse de l'opération. */
private class FakeProvider(private val response: String) : SafeVisionPromptProvider {
    var sawImage: Boolean = false
    var sawImages: Int = 0
    var sawMarker: Boolean = false
    var sawInterfaceGuard: Boolean = false

    override fun generateVisionSafe(prompt: SafeVisionPrompt, apiKey: String?): String {
        sawImages = prompt.images.size
        sawImage = sawImages > 0
        sawMarker = prompt.prompt.body.contains("UNTRUSTED_DATA")
        sawInterfaceGuard = prompt.prompt.system.contains("Ignore l'interface visible", ignoreCase = true)
        return response
    }
}

private fun driver(op: JVal.Obj): JVal = when (op.str("op")) {
    "imageValid" -> ok("valid" to JVal.Bool(imageOf(op).isValid()))
    "imageListValid" -> {
        val valid = try {
            buildSafeVisionPrompt(SYSTEM_LESSON_TRANSCRIBE, emptyList(), imagesOf(op))
            true
        } catch (_: AiError) {
            false
        }
        ok("valid" to JVal.Bool(valid), "count" to JVal.Num(imagesOf(op).size.toDouble()))
    }
    "decodedSize" -> ok("size" to JVal.Num(VisionImage.decodedSize(op.str("base64") ?: "").toDouble()))
    "parseDraft" -> {
        val raw = parseJsonValue(op.str("json") ?: "{}")
        val draft = parseLessonDraft(raw)
        ok("title" to JVal.Str(draft.title), "text" to JVal.Str(draft.text))
    }
    "transcribe" -> {
        val provider = FakeProvider(op.str("response") ?: "{}")
        val draft = transcribeLesson(provider, imageOf(op), "synthetic-key")
        ok(
            "title" to JVal.Str(draft.title),
            "text" to JVal.Str(draft.text),
            "sawImage" to JVal.Bool(provider.sawImage),
            "sawMarker" to JVal.Bool(provider.sawMarker),
            "sawInterfaceGuard" to JVal.Bool(provider.sawInterfaceGuard),
        )
    }
    "homeworkPhoto" -> {
        val provider = FakeProvider(op.str("response") ?: "{}")
        val sources = op.arr("sources").map {
            HomeworkSource(
                label = it.str("label") ?: "",
                text = it.str("text") ?: "",
            )
        }
        val outcome = HomeworkAi.generateHomeworkFromPhotos(
            provider = provider,
            question = op.str("question") ?: "",
            sources = sources,
            images = imagesOf(op),
            apiKey = "synthetic-key",
        )
        when (outcome) {
            is HomeworkOutcome.Answer -> ok(
                "status" to JVal.Str("ok"),
                "answer" to JVal.Str(outcome.answer),
                "steps" to JVal.Arr(outcome.steps.map { JVal.Str(it) }),
                "sources" to JVal.Arr(outcome.sources.map { JVal.Str(it) }),
                "sawImage" to JVal.Bool(provider.sawImage),
                "sawImages" to JVal.Num(provider.sawImages.toDouble()),
                "sawMarker" to JVal.Bool(provider.sawMarker),
            )
            is HomeworkOutcome.Refused -> ok(
                "status" to JVal.Str("refused"),
                "reason" to JVal.Str(outcome.reason),
                "sources" to JVal.Arr(outcome.sources.map { JVal.Str(it) }),
                "sawImage" to JVal.Bool(provider.sawImage),
                "sawImages" to JVal.Num(provider.sawImages.toDouble()),
                "sawMarker" to JVal.Bool(provider.sawMarker),
            )
        }
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
