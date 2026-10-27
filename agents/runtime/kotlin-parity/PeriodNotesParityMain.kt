// PeriodNotesParityMain.kt — pilote JSON du SNAPSHOT de période (notes).
//
// OUTIL DE TEST uniquement (jamais Gradle, jamais l'APK). Il exécute la VRAIE
// source de production `pronote/DataClasses.kt` (`Period.notes()`,
// `Period.grades()`, `Period.overallAverage()`), avec un client dont l'envoi
// est un STUB : aucun réseau.
//
// Ce que le pilote prouve :
//
//   1. UN SEUL `DernieresNotes` sert notes + moyennes + moyenne générale.
//   2. Une ligne tordue est SAUTÉE, les autres restent (pas de trimestre
//      perdu pour une note illisible).
//   3. Une liste de services ABSENTE = moyenne générale INCONNUE (`null`),
//      pas un trimestre vide publié comme valide.
//   4. L'enveloppe `dataSec.data`, elle, reste STRICTE : sans elle, `notes()`
//      lève (le cache ne doit jamais recevoir un faux trimestre vide).
//   5. `grades()` et `overallAverage()` gardent leur comportement strict
//      historique (parité avec la référence TS).
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`).
package fr.veryslopnynotes.periodnotes

import fr.veryslopnynotes.pronote.ClientBase
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import fr.veryslopnynotes.pronote.Period
import fr.veryslopnynotes.pronote.PeriodNotes
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun o(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun s(value: String): JVal = JVal.Str(value)

private fun v(value: JVal): JVal.Obj = o("V" to value)

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Note Pronote minimale ; `note = null` forge la ligne ILLISIBLE. */
private fun gradeRow(
    n: String,
    note: String? = "15",
    periodId: String? = null,
    subject: String = "Maths",
): JVal.Obj {
    val fields = linkedMapOf<String, JVal>(
        "N" to s(n),
        "bareme" to v(s("20")),
        "date" to v(s("12/10/2025")),
        "service" to v(o("N" to s("s-$subject"), "L" to s(subject))),
    )
    if (note != null) fields["note"] = v(s(note))
    if (periodId != null) fields["periode"] = v(o("N" to s(periodId)))
    return JVal.Obj(fields)
}

/** Moyenne de service minimale ; `moy = null` forge la ligne ILLISIBLE. */
private fun serviceRow(n: String, label: String, moy: String?): JVal.Obj {
    val fields = linkedMapOf<String, JVal>(
        "N" to s(n),
        "L" to s(label),
        "baremeMoyEleve" to v(s("20")),
        "moyClasse" to v(s("11")),
        "moyMin" to v(s("5")),
        "moyMax" to v(s("18")),
    )
    if (moy != null) fields["moyEleve"] = v(s(moy))
    return JVal.Obj(fields)
}

private fun notesResponse(
    grades: List<JVal>,
    services: List<JVal>?,
    overall: String? = null,
): JVal {
    val data = LinkedHashMap<String, JVal>()
    if (grades.isNotEmpty()) data["listeDevoirs"] = o("V" to JVal.Arr(grades))
    if (services != null) data["listeServices"] = o("V" to JVal.Arr(services))
    if (overall != null) data["moyGenerale"] = v(s(overall))
    return o("dataSec" to o("data" to JVal.Obj(data)))
}

private class CountingClient(private val response: JVal) : ClientBase(
    "https://etablissement.example/pronote/eleve.html",
    "eleve",
    "secret",
) {
    var posts: Int = 0

    override fun send(functionName: String, postData: Map<String, JVal>): JVal {
        posts += 1
        return response
    }
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

private fun notesJson(client: CountingClient, notes: PeriodNotes): JVal.Obj = ok(
    "posts" to JVal.Num(client.posts.toDouble()),
    "grades" to JVal.Num(notes.grades.size.toDouble()),
    "gradeIds" to JVal.Arr(notes.grades.map { JVal.Str(it.id) }),
    "averages" to JVal.Num(notes.averages.size.toDouble()),
    "overall" to (notes.overallAverage ?: JVal.Null),
)

private fun catchName(block: () -> Unit): String? = try {
    block()
    null
} catch (e: Exception) {
    e.javaClass.simpleName
}

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // Une réponse complète : un seul POST, tout est publié.
        "onePost" -> {
            val response = notesResponse(
                grades = listOf(gradeRow("g1", periodId = "p-ok"), gradeRow("g2")),
                services = listOf(serviceRow("s1", "Maths", "12,5")),
                overall = "13,25",
            )
            val client = CountingClient(response)
            val notes = periodOf(client, "p-ok").notes()
            ok(
                "posts" to JVal.Num(client.posts.toDouble()),
                "grades" to JVal.Num(notes.grades.size.toDouble()),
                "gradeIds" to JVal.Arr(notes.grades.map { JVal.Str(it.id) }),
                "gradePeriods" to JVal.Arr(notes.grades.map { g -> g.period?.id?.let { JVal.Str(it) } ?: JVal.Null }),
                "averages" to JVal.Num(notes.averages.size.toDouble()),
                "overall" to (notes.overallAverage ?: JVal.Null),
            )
        }

        // Une note tordue + une moyenne tordue : les VALIDES restent.
        "tolerant" -> {
            val response = notesResponse(
                grades = listOf(gradeRow("g1", periodId = "p-tolerant"), gradeRow("g2", note = null)),
                services = listOf(serviceRow("s1", "Maths", "12,5"), serviceRow("s2", "Français", null)),
            )
            val client = CountingClient(response)
            val notes = periodOf(client, "p-tolerant").notes()
            notesJson(client, notes)
        }

        // Aucune `listeServices` : moyenne générale INCONNUE, pas un zéro.
        "missingServices" -> {
            val response = notesResponse(
                grades = listOf(gradeRow("g1", periodId = "p-missing")),
                services = null,
            )
            val client = CountingClient(response)
            val notes = periodOf(client, "p-missing").notes()
            notesJson(client, notes)
        }

        // L'enveloppe manque : le snapshot lève (jamais un trimestre vide).
        "envelope" -> {
            val client = CountingClient(JVal.Obj(linkedMapOf()))
            val name = catchName { periodOf(client, "p-envelope").notes() }
            ok(
                "thrown" to (name?.let { JVal.Str(it) } ?: JVal.Null),
                "posts" to JVal.Num(client.posts.toDouble()),
            )
        }

        // `grades()` reste STRICT : une ligne tordue fait échouer la lecture.
        "strictGrades" -> {
            val response = notesResponse(
                grades = listOf(gradeRow("g1", periodId = "p-strict"), gradeRow("g2", note = null)),
                services = listOf(serviceRow("s1", "Maths", "12,5")),
            )
            val client = CountingClient(response)
            val name = catchName { periodOf(client, "p-strict").grades() }
            ok(
                "thrown" to (name?.let { JVal.Str(it) } ?: JVal.Null),
                "posts" to JVal.Num(client.posts.toDouble()),
            )
        }

        // `overallAverage()` reste STRICT : liste absente = ParsingError.
        "strictOverall" -> {
            val response = notesResponse(
                grades = listOf(gradeRow("g1", periodId = "p-strict-overall")),
                services = null,
            )
            val client = CountingClient(response)
            val name = catchName { periodOf(client, "p-strict-overall").overallAverage() }
            ok(
                "thrown" to (name?.let { JVal.Str(it) } ?: JVal.Null),
                "posts" to JVal.Num(client.posts.toDouble()),
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
