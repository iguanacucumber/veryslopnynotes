// NewsBodyParityMain.kt — pilote JSON du corps d'une actualité chargé à la
// demande (#475).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-news-body.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile le VRAI client de
// production (`fr.veryslopnynotes.pronote.Client`) et le pilote ici.
//
// Le pilote fournit un client dont l'ENVOI est un STUB qui compte les
// requêtes : le vrai `post` (enveloppe, mémo des lectures) est rejoué, sans
// réseau et sans établissement.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`).
package fr.veryslopnynotes.newsbody

import fr.veryslopnynotes.pronote.Client
import fr.veryslopnynotes.pronote.ClientInfo
import fr.veryslopnynotes.pronote.ClientOptions
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun obj(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

/** Une actualité de la liste (tous les champs que `Information` résout). */
private fun newsItem(): JVal = obj(
    "N" to JVal.Str("actu-1"),
    "L" to JVal.Str("Semaine de l'orientation"),
    "auteur" to JVal.Str("Mme TOURON D."),
    "lue" to JVal.Bool(false),
    "dateCreation" to obj("V" to JVal.Str("10/09/2026 08:00:00")),
    "dateDebut" to obj("V" to JVal.Str("11/09/2026")),
    "dateFin" to obj("V" to JVal.Str("30/09/2026")),
    "nature" to obj("V" to obj("L" to JVal.Str("Info"))),
    "estSondage" to JVal.Bool(false),
    "estModele" to JVal.Bool(false),
    "estModelePartage" to JVal.Bool(false),
    "reponseAnonyme" to JVal.Bool(false),
)

/** Réponse de la LISTE des actus (`modesAffActus`). */
private fun listResponse(): JVal = obj(
    "dataSec" to obj(
        "data" to obj(
            "listeModesAff" to JVal.Arr(
                listOf(obj("listeActualites" to obj("V" to JVal.Arr(listOf(newsItem()))))),
            ),
        ),
    ),
)

/** Réponse du CORPS d'une actu (`actualite`) : une question, un texte. */
private fun bodyResponse(): JVal = obj(
    "dataSec" to obj(
        "data" to obj(
            "detailsActualite" to obj(
                "listeQuestions" to obj(
                    "V" to JVal.Arr(
                        listOf(obj("texte" to obj("V" to JVal.Str("<p>Ordre du jour</p>")))),
                    ),
                ),
            ),
        ),
    ),
)

/** Client de test : l'envoi est un STUB qui compte les requêtes. */
private class CountingClient : Client(
    "https://etablissement.example/pronote/eleve.html",
    "eleve",
    "secret",
    ClientOptions(),
) {
    var sends: Int = 0
    val functions: MutableList<String> = mutableListOf()

    init {
        // Le client est « connecté » : l'identité de la ressource est connue
        // (c'est elle que le POST `actualite` porte).
        info = ClientInfo(this, obj("N" to JVal.Str("eleve-1")))
    }

    override fun send(functionName: String, postData: Map<String, JVal>): JVal {
        sends++
        functions.add(functionName)
        if (functionName != "PageActualites") return obj()
        // Le corps est demandé par actu (`actualite`), la liste par `modesAffActus`.
        val data = (postData["data"] as? JVal.Obj)?.fields ?: emptyMap()
        return if (data.containsKey("actualite")) bodyResponse() else listResponse()
    }
}

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // La LISTE des actus : une seule requête (le corps n'est PAS téléchargé).
        "list" -> {
            val client = CountingClient()
            val titles = client.informationAndSurveys().map { it.title }
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "functions" to JVal.Arr(client.functions.map { JVal.Str(it) }),
                "titles" to JVal.Arr(titles.map { JVal.Str(it ?: "") }),
            )
        }
        // Le CORPS d'une actu : une seule requête, un texte (le HTML retiré).
        "body" -> {
            val client = CountingClient()
            val body = client.informationContent(op.str("id") ?: "actu-1")
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "functions" to JVal.Arr(client.functions.map { JVal.Str(it) }),
                "body" to JVal.Str(body),
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
