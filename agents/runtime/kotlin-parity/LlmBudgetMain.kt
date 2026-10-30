// LlmBudgetMain.kt — pilote JSON du plafond de sortie I5 (#411).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-llm-budget.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile les VRAIES sources
// de production (`core/LlmGuard.kt`, `core/Homework.kt`, `core/HomeworkAi.kt`)
// et la pilote ici : les assertions portent donc sur du code EXÉCUTÉ, pas sur
// un miroir TS.
//
// Opérations :
//   - `budget` : les bornes du plafond (caractères, densité, tokens, corrigé) ;
//   - `output` : la garde de sortie (`validateTextOutput`) sur un texte ;
//   - `homeworkData` : les blocs DONNEE des libellés citables ;
//   - `homeworkSystem` : les consignes fixes des deux chemins (texte, photo) ;
//   - `homework` : la CHAÎNE COMPLÈTE (JSON du fournisseur → `parseJsonOutput`
//     → `HomeworkAi.parseHomeworkResponse`), pour prouver que le corrigé
//     maximal reste productible et accepté.
//
// Les REFUS du PORT reviennent en `{"ok":false,…}` : c'est un résultat
// attendu, pas une panne. Aucun secret n'est écrit en clair ici.
package fr.veryslopnynotes.llmbudget

import fr.veryslopnynotes.core.CHARS_PER_TOKEN
import fr.veryslopnynotes.core.Homework
import fr.veryslopnynotes.core.HomeworkAi
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.core.HomeworkSource
import fr.veryslopnynotes.core.JsonValue
import fr.veryslopnynotes.core.MAX_OUTPUT_CHARS
import fr.veryslopnynotes.core.MAX_OUTPUT_TOKENS
import fr.veryslopnynotes.core.SYSTEM_HOMEWORK_JSON
import fr.veryslopnynotes.core.SYSTEM_HOMEWORK_PHOTO_JSON
import fr.veryslopnynotes.core.parseJsonOutput
import fr.veryslopnynotes.core.parseJsonValue
import fr.veryslopnynotes.core.stringifyJson
import fr.veryslopnynotes.core.validateTextOutput
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JsonValue.Obj.str(key: String): String? = (fields[key] as? JsonValue.Str)?.value

private fun obj(vararg pairs: Pair<String, JsonValue>): JsonValue.Obj =
    JsonValue.Obj(linkedMapOf(*pairs))

/** Un refus du port : la cause et son message, jamais la sortie brute. */
private fun refus(e: Exception): JsonValue.Obj = obj(
    "ok" to JsonValue.Bool(false),
    "error" to JsonValue.Str(e.javaClass.simpleName),
    "message" to JsonValue.Str(e.message ?: ""),
)

private fun driver(op: JsonValue.Obj): JsonValue = when (op.str("op")) {
    "budget" -> obj(
        "maxOutputChars" to JsonValue.Num(MAX_OUTPUT_CHARS.toDouble()),
        "charsPerToken" to JsonValue.Num(CHARS_PER_TOKEN.toDouble()),
        "maxOutputTokens" to JsonValue.Num(MAX_OUTPUT_TOKENS.toDouble()),
        "maxAnswerChars" to JsonValue.Num(Homework.MAX_ANSWER_CHARS.toDouble()),
        "envelopeReserveChars" to JsonValue.Num(Homework.JSON_ENVELOPE_RESERVE_CHARS.toDouble()),
    )
    "output" -> {
        val text = op.str("text") ?: throw IllegalArgumentException("pilote: text absent")
        try {
            validateTextOutput(text)
            obj("ok" to JsonValue.Bool(true), "chars" to JsonValue.Num(text.length.toDouble()))
        } catch (e: Exception) {
            refus(e)
        }
    }
    "homeworkData" -> {
        // Les blocs DONNEE réellement envoyés au modèle (#604) : le test vérifie
        // que le libellé citable y apparaît TEL QUEL, sans préfixe qui ressemble
        // à une citation.
        val question = op.str("question") ?: throw IllegalArgumentException("pilote: question absente")
        val labels = (op.fields["labels"] as? JsonValue.Arr)?.items
            ?.mapNotNull { (it as? JsonValue.Str)?.value }
            ?: emptyList()
        val texts = (op.fields["texts"] as? JsonValue.Arr)?.items
            ?.mapNotNull { (it as? JsonValue.Str)?.value }
            ?: emptyList()
        val sources = labels.mapIndexed { i, label -> HomeworkSource(label, texts.getOrElse(i) { "" }) }
        val blocks = HomeworkAi.homeworkData(question, sources)
        obj("blocks" to JsonValue.Arr(blocks.map { JsonValue.Str(it.value) }))
    }
    "homeworkSystem" -> obj(
        // Consignes fixes RÉELLEMENT envoyées au modèle : la règle de citation
        // partagée doit être dans les DEUX entrées (texte et photo).
        "text" to JsonValue.Str(SYSTEM_HOMEWORK_JSON),
        "photo" to JsonValue.Str(SYSTEM_HOMEWORK_PHOTO_JSON),
    )
    "homework" -> {
        val raw = op.str("raw") ?: throw IllegalArgumentException("pilote: raw absent")
        val labels = (op.fields["labels"] as? JsonValue.Arr)?.items
            ?.mapNotNull { (it as? JsonValue.Str)?.value }
            ?: emptyList()
        try {
            // La garde I5 (longueur + JSON) puis le schéma du corrige.
            val parsed = parseJsonOutput(raw)
            when (val outcome = HomeworkAi.parseHomeworkResponse(parsed, labels.toSet())) {
                is HomeworkOutcome.Answer -> obj(
                    "ok" to JsonValue.Bool(true),
                    "status" to JsonValue.Str("ok"),
                    "answerChars" to JsonValue.Num(outcome.answer.length.toDouble()),
                    "steps" to JsonValue.Num(outcome.steps.size.toDouble()),
                    "sources" to JsonValue.Num(outcome.sources.size.toDouble()),
                    // Libellés CANONIQUES rendus par le port : la parité vérifie
                    // qu'une citation préfixée est bien ramenée au libellé fourni.
                    "cited" to JsonValue.Arr(outcome.sources.map { JsonValue.Str(it) }),
                )
                is HomeworkOutcome.Refused -> obj(
                    "ok" to JsonValue.Bool(true),
                    "status" to JsonValue.Str("refused"),
                    "reason" to JsonValue.Str(outcome.reason),
                    "cited" to JsonValue.Arr(outcome.sources.map { JsonValue.Str(it) }),
                )
            }
        } catch (e: Exception) {
            refus(e)
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
            stdout.println(stringifyJson(driver(parseJsonValue(line) as JsonValue.Obj)))
        } catch (e: Exception) {
            val name = e.javaClass.simpleName
            stderr.println("port: $name: ${e.message}")
            stdout.println(
                stringifyJson(
                    obj(
                        "error" to JsonValue.Str(name),
                        "message" to JsonValue.Str(e.message ?: "inconnu"),
                    ),
                ),
            )
        }
    }
}
