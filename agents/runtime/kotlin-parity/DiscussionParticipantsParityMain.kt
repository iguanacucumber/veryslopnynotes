// DiscussionParticipantsParityMain.kt — pilote JSON du coût des participants
// d'un fil (#476).
//
// OUTIL DE TEST uniquement : compilé par
// `tests/unit/kotlin-discussion-participants.test.ts` (jamais par Gradle,
// jamais dans l'APK). Le test compile le VRAI client de production
// (`fr.veryslopnynotes.pronote.Client`) et le pilote ici.
//
// Le pilote fournit un client dont l'ENVOI est un STUB qui compte les
// requêtes : le vrai `post` (enveloppe, mémo des lectures) est rejoué, sans
// réseau et sans établissement.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`).
package fr.veryslopnynotes.discussionparticipants

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

/** Un fil de la messagerie (tous les champs que `Discussion` résout). */
private fun discussion(): JVal = obj(
    "N" to JVal.Str("d-1"),
    "objet" to JVal.Str("Absence du 12/09"),
    "initiateur" to JVal.Str("Vie scolaire"),
    "messagePourParticipants" to obj("V" to obj("N" to JVal.Str("pm-1"))),
    "nbNonLus" to JVal.Num(2.0),
    "ferme" to JVal.Bool(false),
    "listeEtiquettes" to obj("V" to JVal.Arr(emptyList())),
    "listePossessionsMessages" to obj("V" to JVal.Arr(listOf(obj("N" to JVal.Str("poss-1"))))),
    "estUneDiscussion" to JVal.Bool(true),
    "profondeur" to JVal.Num(0.0),
)

/** Un message du fil. */
private fun message(): JVal = obj(
    "possessionMessage" to obj("V" to obj("N" to JVal.Str("poss-1"))),
    "N" to JVal.Str("m-1"),
    "emetteur" to JVal.Bool(false),
    "public_gauche" to JVal.Str("Mme Dupont"),
    "lu" to JVal.Bool(true),
    "date" to obj("V" to JVal.Str("12/09/2026 09:00:00")),
    "estHTML" to JVal.Bool(true),
    "contenu" to obj("V" to JVal.Str("<p>Bonjour</p>")),
    "messageSource" to obj("V" to obj("N" to JVal.Str("m-0"))),
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
        info = ClientInfo(this, obj("N" to JVal.Str("eleve-1")))
    }

    override fun send(functionName: String, postData: Map<String, JVal>): JVal {
        sends++
        functions.add(functionName)
        val data = obj(
            "dataSec" to obj(
                "data" to when (functionName) {
                    "ListeMessagerie" -> obj(
                        "listeEtiquettes" to obj("V" to JVal.Arr(emptyList())),
                        "listeMessagerie" to obj("V" to JVal.Arr(listOf(discussion()))),
                    )
                    "ListeMessages" -> obj(
                        "listeMessages" to obj("V" to JVal.Arr(listOf(message()))),
                    )
                    "SaisiePublicMessage" -> obj(
                        "listeDest" to obj(
                            "V" to JVal.Arr(
                                listOf(
                                    obj("L" to JVal.Str("Mme Dupont")),
                                    obj("L" to JVal.Str("M. Martin")),
                                ),
                            ),
                        ),
                    )
                    else -> obj()
                },
            ),
        )
        return data
    }
}

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // La LISTE des fils : UNE requête (les participants ne sont PAS
        // téléchargés ici).
        "list" -> {
            val client = CountingClient()
            val discussions = client.discussions()
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "functions" to JVal.Arr(client.functions.map { JVal.Str(it) }),
                "subjects" to JVal.Arr(discussions.map { JVal.Str(it.subject) }),
            )
        }
        // Les MESSAGES d'un fil : une requête de plus.
        "thread" -> {
            val client = CountingClient()
            val discussion = client.discussions().first()
            val messages = discussion.messages()
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "functions" to JVal.Arr(client.functions.map { JVal.Str(it) }),
                "messages" to JVal.Num(messages.size.toDouble()),
            )
        }
        // Les PARTICIPANTS d'un fil : une requête de plus, à l'OUVERTURE.
        "participants" -> {
            val client = CountingClient()
            val discussion = client.discussions().first()
            val participants = discussion.participants()
            ok(
                "sends" to JVal.Num(client.sends.toDouble()),
                "functions" to JVal.Arr(client.functions.map { JVal.Str(it) }),
                "participants" to JVal.Arr(participants.map { JVal.Str(it ?: "") }),
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
