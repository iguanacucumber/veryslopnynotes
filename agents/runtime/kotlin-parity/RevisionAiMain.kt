// RevisionAiMain.kt — pilote JSON du core IA « fiche de revision » (#367).
//
// OUTIL DE TEST uniquement : compile par `tests/unit/android-revision.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile les VRAIES sources
// de production (`android/core/.../Untrusted.kt`, `LlmGuard.kt`, `AiPrompts.kt`,
// `RevisionAi.kt` — stdlib Kotlin seul, aucun import Android) et la pilote
// ici : les assertions portent donc sur du code execute, pas sur un miroir TS.
//
// Protocole : une operation JSON par ligne sur stdin, une reponse par ligne
// sur stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`).
// Les erreurs du PILOTE (op inconnue) sont prefixees `pilote: ` et refusees
// par le test.
package fr.veryslopnynotes.revision

import fr.veryslopnynotes.core.AiError
import fr.veryslopnynotes.core.LlmProvider
import fr.veryslopnynotes.core.RevisionAi
import fr.veryslopnynotes.core.RevisionChunk
import fr.veryslopnynotes.core.RevisionExam
import fr.veryslopnynotes.core.RevisionFailure
import fr.veryslopnynotes.core.parseJsonOutput
import fr.veryslopnynotes.core.parseRevisionAnswer
import fr.veryslopnynotes.core.revisionFailureMessage
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

// Nonce fixe : le test peut alors verifier les delimiteurs I6 dans le corps.
private const val NONCE = "revisionnonce000001"

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun err(name: String, message: String?): JVal.Obj = JVal.Obj(
    linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")),
)

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun exam(): RevisionExam = RevisionExam(
    id = "devoir-1",
    subject = "Mathematiques",
    date = "2026-10-19",
    matched = "Devoir dérivées",
)

private fun chunks(): List<RevisionChunk> = listOf(
    RevisionChunk("Derivee de x^2 = 2x.", "Cours : Chapitre 4"),
)

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // Le prompt ASSEMBLE par le core : consigne systeme + corps delimite.
        "prompt" -> {
            val safe = RevisionAi.revisionPromptFor(exam(), chunks(), NONCE)
            ok(
                "system" to JVal.Str(safe.system),
                "body" to JVal.Str(safe.body),
                "nonce" to JVal.Str(safe.nonce),
            )
        }
        // La sortie du modele passe par la garde I5 : parseJsonOutput puis
        // parseRevisionAnswer. Une reponse invalide = refus (message borne).
        "parse" -> {
            val text = op.str("text") ?: throw IllegalArgumentException("pilote: text absent")
            try {
                val fiche = parseRevisionAnswer(parseJsonOutput(text))
                ok("ok" to JVal.Bool(true), "fiche" to JVal.Str(fiche))
            } catch (e: AiError) {
                ok("ok" to JVal.Bool(false), "error" to JVal.Str(e.message ?: "inconnu"))
            }
        }
        // Le point d'entree PUBLIC de la fiche (#428) : la cle de l'app doit
        // etre RELAYEE au fournisseur. Le faux provider imite OpenRouterLlm :
        // sans cle, il refuse l'appel (c'est le bug observe — la cle n'etait
        // pas transmise, donc l'adaptateur reel levait « clé LLM absente »
        // avant tout appel HTTP). `calls` prouve que le fournisseur a vu
        // l'appel, `apiKey` ce qu'il a recu.
        "fiche" -> {
            val key = op.str("key")
            val body = op.str("body") ?: "{\"fiche\":\"Rappel : derivé de x^2 = 2x.\"}"
            var seenKey: String? = null
            var calls = 0
            val provider = LlmProvider { _, _, apiKey ->
                calls += 1
                seenKey = apiKey
                if (apiKey.isNullOrBlank()) throw IllegalStateException("clé LLM absente")
                body
            }
            try {
                val fiche = RevisionAi.requestRevisionFiche(
                    provider,
                    exam(),
                    chunks(),
                    apiKey = key,
                    nonce = NONCE,
                )
                ok(
                    "ok" to JVal.Bool(true),
                    "fiche" to JVal.Str(fiche),
                    "apiKey" to (seenKey?.let { JVal.Str(it) } ?: JVal.Null),
                    "calls" to JVal.Num(calls.toDouble()),
                )
            } catch (e: Exception) {
                ok(
                    "ok" to JVal.Bool(false),
                    "error" to JVal.Str(e.message ?: "inconnu"),
                    "apiKey" to (seenKey?.let { JVal.Str(it) } ?: JVal.Null),
                    "calls" to JVal.Num(calls.toDouble()),
                )
            }
        }
        // Message utilisateur d'un echec : francais, borne, sans secret.
        "failure" -> {
            val name = op.str("failure") ?: throw IllegalArgumentException("pilote: failure absent")
            val failure = RevisionFailure.valueOf(name)
            ok("message" to JVal.Str(revisionFailureMessage(failure)))
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
