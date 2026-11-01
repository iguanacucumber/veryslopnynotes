// CompressionMain.kt — pilote JSON de l'inflation deflate bornée.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-inflate-bound.test.ts`
// (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.compression

import fr.veryslopnynotes.pronote.MAX_RESPONSE_BYTES
import fr.veryslopnynotes.pronote.deflateRaw
import fr.veryslopnynotes.pronote.inflateRaw
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Driver {
    fun run(op: JVal.Obj): JVal.Obj = when (op.str("op")) {
        // Aller-retour normal : l'inflation rend EXACTEMENT l'entrée.
        "roundTrip" -> {
            val text = op.str("text") ?: ""
            val bytes = text.toByteArray(Charsets.UTF_8)
            val inflated = inflateRaw(deflateRaw(bytes))
            ok(
                "text" to JVal.Str(inflated.toString(Charsets.UTF_8)),
                "size" to JVal.Num(inflated.size.toDouble()),
            )
        }
        // Flux qui gonfle à `size` octets : au-delà du plafond, l'inflation
        // s'arrête par une ERREUR (jamais un OOM), et le ciphertext reste petit.
        "inflate" -> {
            val size = (op.num("size") ?: 0.0).toInt()
            val packed = deflateRaw(ByteArray(size))
            val answer = try {
                val inflated = inflateRaw(packed)
                ok(
                    "ok" to JVal.Bool(true),
                    "out" to JVal.Num(inflated.size.toDouble()),
                    "packed" to JVal.Num(packed.size.toDouble()),
                    "max" to JVal.Num(MAX_RESPONSE_BYTES.toDouble()),
                )
            } catch (e: Exception) {
                ok(
                    "ok" to JVal.Bool(false),
                    "error" to JVal.Str(e.javaClass.simpleName),
                    "packed" to JVal.Num(packed.size.toDouble()),
                    "max" to JVal.Num(MAX_RESPONSE_BYTES.toDouble()),
                )
            }
            answer
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
