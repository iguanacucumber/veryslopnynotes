// SchoolTimeMain.kt — pilote JSON du fuseau scolaire et de l'horloge injectée.
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-school-time.test.ts`
// (jamais Gradle, jamais l'APK). Une horloge FIXE rend les tests déterministes :
// minuit, passage d'heure d'été/hiver, frontière d'année.
package fr.veryslopnynotes.schooltime

import fr.veryslopnynotes.data.SCHOOL_ZONE
import fr.veryslopnynotes.data.assignmentWindow
import fr.veryslopnynotes.data.currentWeekLocal
import fr.veryslopnynotes.data.parisIso
import fr.veryslopnynotes.data.parisNowIso
import fr.veryslopnynotes.data.schoolNow
import fr.veryslopnynotes.data.schoolToday
import fr.veryslopnynotes.data.weekWindow
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.dateParse
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.time.Clock
import java.time.Instant
import java.time.LocalDateTime

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun fixed(instant: String): Clock = Clock.fixed(Instant.parse(instant), SCHOOL_ZONE)

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "now" -> ok("local" to JVal.Str(schoolNow(fixed(op.str("instant")!!)).toString()))
        "today" -> ok("day" to JVal.Str(schoolToday(fixed(op.str("instant")!!)).toString()))
        "nowIso" -> ok("iso" to JVal.Str(parisNowIso(fixed(op.str("instant")!!))))
        "parisIso" -> ok("iso" to JVal.Str(LocalDateTime.parse(op.str("local")!!).parisIso()))
        "weekWindow" -> {
            val win = weekWindow(op.str("weekStart"))
                ?: throw IllegalArgumentException("pilote: semaine illisible")
            ok(
                "from" to JVal.Str(Instant.ofEpochMilli(win.first).toString()),
                "to" to JVal.Str(Instant.ofEpochMilli(win.second).toString()),
            )
        }
        "assignmentWindow" -> {
            val (from, to) = assignmentWindow(op.str("weekStart"), fixed(op.str("instant")!!))
            ok(
                "from" to JVal.Str(from.toString()),
                "to" to JVal.Str(to.toString()),
            )
        }
        "currentWeek" -> {
            val (from, to) = currentWeekLocal(fixed(op.str("instant")!!))
            ok(
                "from" to JVal.Str(from.toString()),
                "to" to JVal.Str(to.toString()),
            )
        }
        // Dates Pronote partielles : l'année/jour de repli vient de l'horloge
        // fixe, et le trou DST est résolu à Paris.
        "dateParse" -> {
            val parsed = dateParse(JVal.Str(op.str("text")!!), fixed(op.str("instant")!!))
            ok("local" to JVal.Str(parsed.toString()))
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
