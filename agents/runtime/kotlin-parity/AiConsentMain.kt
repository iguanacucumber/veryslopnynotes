// AiConsentMain.kt — pilote JSON de la politique de consentement IA
// (PRV-04) et de l'attestation d'âge (PRV-05).
//
// OUTIL DE TEST uniquement : jamais Gradle, jamais l'APK. Il exécute le VRAI
// fichier pur `android/core/.../AiConsent.kt` pour prouver qu'un accord est
// versionné et attesté, qu'un refus persiste et qu'un retrait désactive l'IA.
package fr.veryslopnynotes.parity.aiconsent

import fr.veryslopnynotes.core.AI_CONSENT_VERSION
import fr.veryslopnynotes.core.AiConsentDecision
import fr.veryslopnynotes.core.encodeAiConsent
import fr.veryslopnynotes.core.parseAiConsent
import fr.veryslopnynotes.pronote.JVal
import fr.veryslopnynotes.pronote.Json
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JVal.Obj.str(key: String): String? = (fields[key] as? JVal.Str)?.value

private fun JVal.Obj.num(key: String): Int? =
    (fields[key] as? JVal.Num)?.value?.toInt()

private fun JVal.Obj.bool(key: String): Boolean? =
    (fields[key] as? JVal.Bool)?.value

private fun ok(vararg pairs: Pair<String, JVal>): JVal.Obj = JVal.Obj(linkedMapOf(*pairs))

private class Driver {
    fun run(op: JVal.Obj): JVal = when (op.str("op")) {
        // Relit un enregistrement brut : décision, version et verdict.
        "parse" -> {
            val record = parseAiConsent(op.str("raw"))
            ok(
                "decision" to JVal.Str(record.decision.wire),
                "version" to JVal.Num(record.version.toDouble()),
                "allowsAi" to JVal.Bool(record.allowsAi),
                "needsReconsent" to JVal.Bool(record.needsReconsent),
                "ageAttested" to JVal.Bool(record.ageAttested),
            )
        }
        // Écrit puis relit : c'est le stockage versionné, pas un état en mémoire.
        "roundtrip" -> {
            val decision = AiConsentDecision.fromWire(op.str("decision"))
            val version = op.num("version") ?: AI_CONSENT_VERSION
            val ageAttested = op.bool("ageAttested") ?: false
            val encoded = try {
                encodeAiConsent(decision, version, ageAttested)
            } catch (e: Exception) {
                return ok(
                    "error" to JVal.Str(e.javaClass.simpleName),
                    "decision" to JVal.Str(decision.wire),
                )
            }
            val record = parseAiConsent(encoded)
            ok(
                "encoded" to JVal.Str(encoded),
                "decision" to JVal.Str(record.decision.wire),
                "version" to JVal.Num(record.version.toDouble()),
                "allowsAi" to JVal.Bool(record.allowsAi),
                "needsReconsent" to JVal.Bool(record.needsReconsent),
                "ageAttested" to JVal.Bool(record.ageAttested),
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
            stderr.println("port: ${e.javaClass.simpleName}: ${e.message}")
            stdout.println(Json.stringify(ok("error" to JVal.Str(e.javaClass.simpleName))))
        }
    }
}
