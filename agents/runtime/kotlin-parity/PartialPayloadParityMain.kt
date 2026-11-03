// PartialPayloadParityMain.kt — pilote JSON des lectures PARTIELLES.
//
// Une section ou une ligne illisible est sautée ; le résultat porte `partial`.
// Aucune donnée lisible = l'erreur typée d'origine, jamais un vide.
package fr.veryslopnynotes.partial

import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.ClientBase
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.PartialRead
import fr.veryslopnynotes.pronote.Period
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets
import java.time.LocalDateTime

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun o(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun s(value: String): JVal = JVal.Str(value)

private fun n(value: Double): JVal = JVal.Num(value)

private fun v(value: JVal): JVal.Obj = o("V" to value)

private fun arr(vararg values: JVal): JVal.Arr = JVal.Arr(values.toList())

private fun err(name: String, message: String?): JVal.Obj =
    o("error" to s(name), "message" to s(message ?: "inconnu"))

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Client scripté : une réponse par POST, la dernière répétée. */
private class ScriptedClient(private val responses: List<JVal>) : Client(
    "https://etablissement.example/pronote/eleve.html",
    "eleve",
    "secret",
) {
    var posts: Int = 0
    init {
        startDay = LocalDateTime.of(2025, 9, 1, 0, 0)
    }

    override fun send(functionName: String, postData: Map<String, JVal>): JVal {
        val response = responses.getOrElse(posts) { responses.lastOrNull() ?: JVal.Obj(linkedMapOf()) }
        posts += 1
        return response
    }
}

private fun catchName(block: () -> Unit): String? = try {
    block()
    null
} catch (e: Exception) {
    e.javaClass.simpleName
}

private fun lesson(id: String, date: String): JVal.Obj = o(
    "N" to s(id),
    "DateDuCours" to v(s(date)),
    "DateDuCoursFin" to v(s(date.replace("08:00", "09:00"))),
    "ListeContenus" to o("V" to arr(o("G" to n(16.0), "N" to s("s-$id"), "L" to s("Maths")))),
)

private fun lessonPage(rows: List<JVal>): JVal = o("dataSec" to o("data" to o("ListeCours" to JVal.Arr(rows))))

private fun homework(id: String, date: String): JVal.Obj = o(
    "N" to s(id),
    "descriptif" to v(s("<p>$id</p>")),
    "TAFFait" to JVal.Bool(false),
    "Matiere" to v(o("N" to s("s-maths"), "L" to s("Maths"))),
    "PourLe" to v(s(date)),
    "CouleurFond" to s("#fff"),
    "ListePieceJointe" to v(arr()),
)

private fun homeworkPage(rows: List<JVal>): JVal = o(
    "dataSec" to o("data" to o("ListeTravauxAFaire" to o("V" to JVal.Arr(rows)))),
)

private fun discussion(id: String, subject: String): JVal.Obj = o(
    "N" to s(id),
    "objet" to s(subject),
    "messagePourParticipants" to v(o("N" to s("pm-$id"))),
    "listePossessionsMessages" to v(arr(o("N" to s("p-$id")))),
    "listeEtiquettes" to v(arr()),
    "estUneDiscussion" to JVal.Bool(true),
    "profondeur" to n(0.0),
)

private fun discussionPage(discussions: List<JVal>, labels: List<JVal> = listOf(o("N" to s("e1"), "G" to n(4.0)))): JVal =
    o(
        "dataSec" to o(
            "data" to o(
                "listeEtiquettes" to o("V" to JVal.Arr(labels)),
                "listeMessagerie" to o("V" to JVal.Arr(discussions)),
            ),
        ),
    )

private fun info(id: String, title: String): JVal.Obj = o(
    "N" to s(id),
    "L" to s(title),
    "auteur" to s("Direction"),
    "lue" to JVal.Bool(false),
    "dateCreation" to v(s("10/09/2025 08:00:00")),
    "nature" to v(o("L" to s("Info"))),
    "estSondage" to JVal.Bool(false),
    "reponseAnonyme" to JVal.Bool(false),
)

private fun newsPage(actualites: List<JVal>?): JVal {
    val mode = LinkedHashMap<String, JVal>()
    if (actualites != null) mode["listeActualites"] = o("V" to JVal.Arr(actualites))
    return o("dataSec" to o("data" to o("listeModesAff" to arr(JVal.Obj(mode)))))
}

private fun menuPage(repas: List<JVal>?): JVal {
    val day = LinkedHashMap<String, JVal>()
    day["Date"] = v(s("21/09/2025"))
    if (repas != null) day["ListeRepas"] = o("V" to JVal.Arr(repas))
    return o("dataSec" to o("data" to o("ListeJours" to o("V" to arr(JVal.Obj(day))))))
}

private fun meal(id: String, name: String, dish: String?): JVal.Obj {
    val dishes = if (dish == null) emptyList() else listOf(
        o(
            "G" to n(1.0),
            "ListeAliments" to o("V" to arr(o("N" to s("p-$id"), "L" to s(dish), "listeLabelsAlimentaires" to v(arr())))),
        ),
    )
    return o(
        "N" to s(id),
        "L" to s(name),
        "G" to n(0.0),
        "ListePlats" to o("V" to JVal.Arr(dishes)),
    )
}

private fun gradeRow(id: String, note: String?): JVal.Obj {
    val row = linkedMapOf<String, JVal>(
        "N" to s(id),
        "bareme" to v(s("20")),
        "date" to v(s("12/09/2025")),
        "service" to v(o("N" to s("s-maths"), "L" to s("Maths"))),
    )
    if (note != null) row["note"] = v(s(note))
    return JVal.Obj(row)
}

private fun serviceRow(id: String, moy: String?): JVal.Obj {
    val row = linkedMapOf<String, JVal>(
        "N" to s(id),
        "L" to s("Maths"),
        "baremeMoyEleve" to v(s("20")),
        "moyClasse" to v(s("11")),
        "moyMin" to v(s("5")),
        "moyMax" to v(s("18")),
    )
    if (moy != null) row["moyEleve"] = v(s(moy))
    return JVal.Obj(row)
}

private fun notesPage(grades: List<JVal>, services: List<JVal>?): JVal {
    val data = linkedMapOf<String, JVal>("listeDevoirs" to o("V" to JVal.Arr(grades)))
    if (services != null) data["listeServices"] = o("V" to JVal.Arr(services))
    return o("dataSec" to o("data" to JVal.Obj(data)))
}

private fun periodOf(client: ClientBase, id: String): Period = Period(
    client,
    o(
        "N" to s(id),
        "L" to s("Trimestre 1"),
        "dateDebut" to v(s("01/09/2025")),
        "dateFin" to v(s("20/12/2025")),
    ),
)

private fun renderLesson(read: PartialRead<List<fr.veryslopnynotes.pronote.Lesson>>): JVal.Obj = ok(
    "partial" to JVal.Bool(read.partial),
    "ids" to JVal.Arr(read.value.map { JVal.Str(it.id) }),
)

private fun renderHomework(read: PartialRead<List<fr.veryslopnynotes.pronote.Homework>>): JVal.Obj = ok(
    "partial" to JVal.Bool(read.partial),
    "ids" to JVal.Arr(read.value.map { JVal.Str(it.id) }),
)

private fun renderDiscussions(read: PartialRead<List<fr.veryslopnynotes.pronote.Discussion>>): JVal.Obj = ok(
    "partial" to JVal.Bool(read.partial),
    "ids" to JVal.Arr(read.value.map { JVal.Str(it.id) }),
)

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        "lessonsNoBad" -> {
            val client = ScriptedClient(
                listOf(
                    lessonPage(listOf(lesson("l1", "01/09/2025 08:00:00"), lesson("l2", "02/09/2025 08:00:00"))),
                    lessonPage(listOf(lesson("l3", "08/09/2025 08:00:00"))),
                ),
            )
            renderLesson(client.lessonsPartial(LocalDateTime.of(2025, 9, 1, 0, 0), LocalDateTime.of(2025, 9, 14, 0, 0)))
        }

        "lessonsOneBadItem" -> {
            val client = ScriptedClient(
                listOf(
                    lessonPage(listOf(lesson("l1", "01/09/2025 08:00:00"), o("N" to s("bad")))),
                    lessonPage(listOf(lesson("l2", "08/09/2025 08:00:00"))),
                ),
            )
            renderLesson(client.lessonsPartial(LocalDateTime.of(2025, 9, 1, 0, 0), LocalDateTime.of(2025, 9, 14, 0, 0)))
        }

        "lessonsOneBadSection" -> {
            val client = ScriptedClient(
                listOf(
                    o("dataSec" to o("data" to o())),
                    lessonPage(listOf(lesson("l2", "08/09/2025 08:00:00"))),
                ),
            )
            renderLesson(client.lessonsPartial(LocalDateTime.of(2025, 9, 1, 0, 0), LocalDateTime.of(2025, 9, 14, 0, 0)))
        }

        "lessonsAllBad" -> {
            val client = ScriptedClient(
                listOf(
                    o("dataSec" to o("data" to o())),
                    o("dataSec" to o("data" to o())),
                ),
            )
            ok(
                "thrown" to (catchName {
                    client.lessonsPartial(LocalDateTime.of(2025, 9, 1, 0, 0), LocalDateTime.of(2025, 9, 14, 0, 0))
                }?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        "homeworkNoBad" -> {
            val client = ScriptedClient(listOf(homeworkPage(listOf(homework("h1", "05/09/2025"), homework("h2", "06/09/2025")))))
            renderHomework(client.homeworkPartial(LocalDateTime.of(2025, 9, 1, 0, 0), LocalDateTime.of(2025, 9, 10, 0, 0)))
        }

        "homeworkOneBad" -> {
            val client = ScriptedClient(listOf(homeworkPage(listOf(homework("h1", "05/09/2025"), o("N" to s("bad"))))))
            renderHomework(client.homeworkPartial(LocalDateTime.of(2025, 9, 1, 0, 0), LocalDateTime.of(2025, 9, 10, 0, 0)))
        }

        "homeworkAllBad" -> {
            val client = ScriptedClient(listOf(homeworkPage(listOf(o("N" to s("bad1")), o("N" to s("bad2"))))))
            ok(
                "thrown" to (catchName {
                    client.homeworkPartial(LocalDateTime.of(2025, 9, 1, 0, 0), LocalDateTime.of(2025, 9, 10, 0, 0))
                }?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        "discussionsNoBad" -> {
            val client = ScriptedClient(
                listOf(
                    discussionPage(
                        listOf(
                            discussion("d1", "Absence"),
                            discussion("d2", "Sortie"),
                            o("N" to s("filtered"), "estUneDiscussion" to JVal.Bool(false), "profondeur" to n(0.0)),
                        ),
                    ),
                ),
            )
            renderDiscussions(client.discussionsPartial())
        }

        "discussionsOneBad" -> {
            val client = ScriptedClient(
                listOf(
                    discussionPage(
                        listOf(
                            discussion("d1", "Absence"),
                            o("N" to s("bad"), "estUneDiscussion" to JVal.Bool(true), "profondeur" to n(0.0)),
                        ),
                    ),
                ),
            )
            renderDiscussions(client.discussionsPartial())
        }

        "discussionsAllBad" -> {
            val client = ScriptedClient(
                listOf(
                    discussionPage(
                        listOf(
                            o("N" to s("bad1"), "estUneDiscussion" to JVal.Bool(true), "profondeur" to n(0.0)),
                            o("N" to s("bad2"), "estUneDiscussion" to JVal.Bool(true), "profondeur" to n(0.0)),
                        ),
                    ),
                ),
            )
            ok(
                "thrown" to (catchName { client.discussionsPartial() }?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        "newsNoBad" -> {
            val client = ScriptedClient(listOf(newsPage(listOf(info("n1", "Conseil"), info("n2", "Sondage")))))
            val read = client.informationAndSurveysPartial()
            ok(
                "partial" to JVal.Bool(read.partial),
                "ids" to JVal.Arr(read.value.map { JVal.Str(it.id) }),
            )
        }

        "newsOneBadSection" -> {
            val client = ScriptedClient(
                listOf(
                    o(
                        "dataSec" to o(
                            "data" to o(
                                "listeModesAff" to arr(
                                    o(),
                                    o("listeActualites" to o("V" to arr(info("n2", "Sondage")))),
                                ),
                            ),
                        ),
                    ),
                ),
            )
            val read = client.informationAndSurveysPartial()
            ok(
                "partial" to JVal.Bool(read.partial),
                "ids" to JVal.Arr(read.value.map { JVal.Str(it.id) }),
            )
        }

        "newsAllBad" -> {
            val client = ScriptedClient(listOf(o("dataSec" to o("data" to o("listeModesAff" to arr(o(), o()))))))
            ok(
                "thrown" to (catchName { client.informationAndSurveysPartial() }?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        "menusOneBadItem" -> {
            val client = ScriptedClient(listOf(menuPage(listOf(meal("m1", "Dejeuner", "Poulet"), o("N" to s("bad"))))))
            val read = client.menusPartial(LocalDateTime.of(2025, 9, 21, 0, 0), LocalDateTime.of(2025, 9, 21, 0, 0))
            ok(
                "partial" to JVal.Bool(read.partial),
                "ids" to JVal.Arr(read.value.map { JVal.Str(it.id) }),
            )
        }

        "menusAllBad" -> {
            val client = ScriptedClient(listOf(menuPage(listOf(o("N" to s("bad1")), o("N" to s("bad2"))))))
            ok(
                "thrown" to (catchName {
                    client.menusPartial(LocalDateTime.of(2025, 9, 21, 0, 0), LocalDateTime.of(2025, 9, 21, 0, 0))
                }?.let { JVal.Str(it) } ?: JVal.Null),
            )
        }

        "gradesNoBad" -> {
            val client = ScriptedClient(
                listOf(notesPage(listOf(gradeRow("g1", "15"), gradeRow("g2", "12")), listOf(serviceRow("s1", "12,5")))),
            )
            val notes = periodOf(client, "p1").notes()
            ok(
                "partial" to JVal.Bool(notes.partial),
                "grades" to n(notes.grades.size.toDouble()),
                "averages" to n(notes.averages.size.toDouble()),
            )
        }

        "gradesOneBad" -> {
            val client = ScriptedClient(
                listOf(notesPage(listOf(gradeRow("g1", "15"), gradeRow("bad", null)), listOf(serviceRow("s1", "12,5")))),
            )
            val notes = periodOf(client, "p1").notes()
            ok(
                "partial" to JVal.Bool(notes.partial),
                "grades" to n(notes.grades.size.toDouble()),
                "averages" to n(notes.averages.size.toDouble()),
            )
        }

        "gradesAllBad" -> {
            val client = ScriptedClient(
                listOf(notesPage(listOf(gradeRow("bad", null)), listOf(serviceRow("bad-s", null)))),
            )
            ok(
                "thrown" to (catchName { periodOf(client, "p1").notes() }?.let { JVal.Str(it) } ?: JVal.Null),
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
