// QrHandleMain.kt — pilote JSON du QR gardé côté natif (I10).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/android-pairing-handle.test.ts` (jamais Gradle, jamais l'APK).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur stdout.
package fr.veryslopnynotes.qrhandle

import fr.veryslopnynotes.app.QrHandle
import fr.veryslopnynotes.app.maskLogin
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private class Driver {
    private var nextId = 1
    private val slots = mutableMapOf<Int, QrHandle<String>>()
    private val handles = mutableMapOf<Int, String>()

    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "new" -> {
            val qid = nextId++
            var minted = 0
            slots[qid] = QrHandle { "h${qid}-${++minted}" }
            ok("qid" to JVal.Num(qid.toDouble()))
        }
        "remember" -> {
            val qid = slotId(op)
            val handle = slots.getValue(qid).remember(op.str("qr") ?: "")
            handles[qid] = handle
            ok("handle" to JVal.Str(handle))
        }
        "lookup" -> {
            val qid = slotId(op)
            val found = slots.getValue(qid).lookup(op.str("handle") ?: "")
            ok("found" to JVal.Bool(found != null), "value" to JVal.Str(found ?: ""))
        }
        "clear" -> {
            slots.getValue(slotId(op)).clear()
            ok("ok" to JVal.Bool(true))
        }
        "mask" -> ok("masked" to JVal.Str(maskLogin(op.str("login") ?: "")))
        else -> throw IllegalArgumentException("pilote: opération inconnue : ${op.str("op")}")
    }

    private fun slotId(op: JVal.Obj): Int =
        (op.num("qid") ?: 0.0).toInt().also {
            if (!slots.containsKey(it)) throw IllegalArgumentException("pilote: qid inconnu")
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
