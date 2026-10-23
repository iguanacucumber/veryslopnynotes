// ValidatorsParityMain.kt — pilote JSON des validateurs du noyau (#366).
//
// OUTIL DE TEST uniquement : compilé par `tests/unit/kotlin-validators-parity.test.ts`
// (jamais par Gradle, jamais dans l'APK). Le test compile les VRAIS fichiers de
// production (`core/IsoDates.kt`, `core/Assignment.kt`) et les pilote ici : les
// verdicts comparés à ceux du contrat TS sont ceux du code EXÉCUTÉ, pas un
// miroir reécrit en TypeScript.
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`. Les
// erreurs du PILOTE (op inconnue) sont préfixées `pilote: ` et refusées par le
// test.
package fr.veryslopnynotes.core

import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Double? = (fields[key] as? JVal.Num)?.value

private fun JVal.Obj.strList(key: String): List<String> =
    (fields[key] as? JVal.Arr)?.items?.mapNotNull { (it as? JVal.Str)?.value } ?: emptyList()

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private fun err(name: String, message: String?): JVal.Obj =
    JVal.Obj(linkedMapOf("error" to JVal.Str(name), "message" to JVal.Str(message ?: "inconnu")))

/** Opérations : verdict des validateurs du noyau, tel que l'app les applique. */
private fun driver(op: JVal.Obj): JVal = when (op.str("op")) {
    // Millis d'une date ISO (null = illisible).
    "isoMillis" -> {
        val millis = isoMillis(op.str("text"))
        ok("millis" to (millis?.let { JVal.Num(it.toDouble()) } ?: JVal.Null))
    }
    // Verdict « date lisible » (le même que `isoMillis != null`).
    "isoDateLike" -> ok("ok" to JVal.Bool(isIsoDateLike(op.str("text"))))
    // Verdict « pièce jointe valide » (ref comprise).
    "refValid" -> {
        val att = AssignmentAttachment("id", "label", op.str("ref") ?: "")
        ok("ok" to JVal.Bool(AssignmentAttachment.isValid(att)))
    }
    // `ref` réellement construite par la charge utile (identifiant exotique).
    "homeworkRef" -> {
        val ref = AssignmentAttachment.homeworkRef(
            (op.num("index") ?: 0.0).toInt(),
            (op.num("fileIndex") ?: 0.0).toInt(),
            op.str("fileId") ?: "",
        )
        ok("ref" to (ref?.let { JVal.Str(it) } ?: JVal.Null))
    }
    // Verdict « absence retenue » (le filtre qui excluait l'absence datée en
    // heure locale du calcul — donc de la notification).
    "absenceValid" -> {
        val record = AbsenceRecord(
            id = op.str("id") ?: "",
            accountId = op.str("accountId") ?: "",
            kind = op.str("kind") ?: ABSENCE_KIND_ABSENCE,
            date = op.str("date") ?: "",
        )
        ok("ok" to JVal.Bool(isAbsenceRecord(record)))
    }
    // Adresse du manuel : même verdict que le premier filtre de l'app avant
    // l'envoi au scraper (schéma, hôte, identifiants, bornes).
    "manualUrl" -> when (val result = ManualUrl.validate(op.str("text") ?: "")) {
        is ManualUrlResult.Ok -> ok("ok" to JVal.Bool(true), "url" to JVal.Str(result.url))
        is ManualUrlResult.Rejected -> ok("ok" to JVal.Bool(false), "message" to JVal.Str(result.message))
    }
    // Catalogue lelivrescolaire : choix de l'ouvrage par classe + matière.
    "manualResolve" -> {
        val subjects = op.strList("subjects")
        val url = ManualCatalog.resolve(
            baseUrl = op.str("baseUrl") ?: "",
            classLabel = op.str("classLabel") ?: "",
            subjects = subjects,
            subject = op.str("subject") ?: "",
        )
        ok("url" to (url?.let { JVal.Str(it) } ?: JVal.Null))
    }
    "manualGuess" -> {
        val subjects = op.strList("subjects")
        val level = ManualCatalog.levelOf(op.str("classLabel") ?: "", subjects)
        ok(
            "level" to JVal.Str(ManualCatalog.levelLabel(level)),
            "specialties" to JVal.Arr(ManualCatalog.specialties(op.str("classLabel") ?: "", subjects).map { JVal.Str(it) }),
        )
    }
    "manualIsCatalog" -> ok("ok" to JVal.Bool(ManualCatalog.isCatalog(op.str("text") ?: "")))
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
            stdout.println(Json.stringify(err(name, e.message)))
        }
    }
}
