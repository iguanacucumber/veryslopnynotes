// RevisionSheetMain.kt — pilote JSON des fiches de révision (export PDF) (#412).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-revision-sheet.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile les VRAIES sources
// de production (`core/RevisionSheet.kt` et ses dépendances pures — stdlib
// Kotlin seul, aucun import Android) et la pilote ici : les assertions
// portent donc sur du code exécuté, pas sur un miroir TS.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne
// sur stdout (comme les autres pilotes de `agents/runtime/kotlin-parity/`).
// Les erreurs du PILOTE (op inconnue) sont préfixées `pilote: ` et refusées
// par le test ; les erreurs du PORT (fiche invalide) sortent en
// `{"error", "message"}`.
package fr.veryslopnynotes.core

import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.strList(key: String): List<String> {
    val arr = fields[key] as? JVal.Arr ?: return emptyList()
    return arr.items.mapNotNull { (it as? JVal.Str)?.value }
}

private fun sheetOk(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun sheetErr(name: String, message: String?): JVal.Obj =
    JVal.Obj(linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")))

/** Examen de test : la fiche porte toujours des données STRUCTURÉES. */
private fun sheetExam(): ExamCandidate = ExamCandidate(
    source = "assignment",
    id = "devoir-1",
    subject = "Mathematiques",
    date = "2026-10-19",
    confidence = "needs_confirm",
    matched = "Devoir derivees",
)

/** Fiche de test : le corps et les sources viennent de l'opération. */
private fun sheetFrom(op: JVal.Obj): RevisionSheet = RevisionSheet(
    id = "fiche-devoir-1",
    examId = "devoir-1",
    subject = op.str("subject") ?: "Mathematiques",
    date = op.str("date") ?: "2026-10-19",
    title = op.str("title") ?: "Fiche revision Mathematiques",
    body = op.str("body") ?: "",
    sources = op.strList("sources"),
    templateVersion = REVISION_TEMPLATE_VERSION,
    createdAt = op.str("createdAt") ?: "2026-10-19T08:00:00Z",
)

private fun driver(op: JVal.Obj): JVal = when (op.str("op")) {
    // Les lignes que l'export dessine (le PDF les pagine).
    "pdfLines" -> {
        val lines = revisionPdfLines(sheetFrom(op))
        sheetOk("lines" to JVal.Arr(lines.map { JVal.Str(it) }))
    }
    // Le corps assemblé depuis un texte de modèle + les sources canoniques.
    "assemble" -> {
        val sheet = assembleRevisionSheet(
            sheetExam(),
            op.str("fiche") ?: "",
            op.strList("sources"),
            now = op.str("createdAt") ?: "2026-10-19T08:00:00Z",
        )
        sheetOk(
            "body" to JVal.Str(sheet.body),
            "sources" to JVal.Arr(sheet.sources.map { JVal.Str(it) }),
        )
    }
    // Les sources retenues : citations du modèle validées + sources canoniques.
    "sources" -> {
        val sources = revisionSheetSources(op.str("fiche") ?: "", op.strList("canonical"))
        sheetOk("sources" to JVal.Arr(sources.map { JVal.Str(it) }))
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
            stdout.println(Json.stringify(sheetErr(name, e.message)))
        }
    }
}
