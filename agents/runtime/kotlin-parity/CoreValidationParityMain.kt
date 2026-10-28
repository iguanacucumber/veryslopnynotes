// CoreValidationParityMain.kt — pilote JSON des validations du noyau (#413).
//
// OUTIL DE TEST uniquement : compilé par
// `tests/unit/kotlin-core-validation-parity.test.ts` et
// `tests/unit/android-server-config.test.ts` (jamais par Gradle, jamais dans
// l'APK). Les tests compilent les VRAIS fichiers de production
// (`core/Humanize.kt`, `core/CapabilityProbe.kt`, `core/Capabilities.kt`,
// `core/ServerConfig.kt`) et les pilotent ici : les verdicts comparés sont
// ceux du code EXÉCUTÉ, pas un miroir réécrit en TypeScript.
//
// DEUX DÉFAUTS COUVERTS (#413) :
// 1. `Humanize.validateAnswerKeyForRender` confondait un champ `sources`
//    MAL FORMÉ ("abc", {}) avec une liste VIDE : la source invalide passait
//    pour « aucune source » et le texte sortait comme un corrigé validé.
// 2. `CapabilityProbe.fromProbe` renvoyait des capacités NON nulles mais
//    SANS onglet pour un contrat invalide : une liste vide signifie « tous
//    les onglets désactivés » (blackout de la navigation), pas « rien n'est
//    affirmé ».
//
// Protocole : une opération JSON par ligne sur stdin, une réponse par ligne sur
// stdout, comme les autres pilotes de `agents/runtime/kotlin-parity/`. Les
// erreurs du PILOTE sont préfixées `pilote: ` et refusées par le test ; un
// REFUS du PORT (AiError) revient en `{"error":…}` : c'est un résultat
// attendu, pas une panne.
package fr.veryslopnynotes.core

import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

private fun JsonValue.Obj.str(key: String): String? = (fields[key] as? JsonValue.Str)?.value

private fun obj(vararg pairs: Pair<String, JsonValue>): JsonValue.Obj =
    JsonValue.Obj(linkedMapOf(*pairs))

/** La table de la sonde : onglet -> actif ? (un booléen non booléen = false). */
private fun JsonValue.Obj.boolMap(key: String): Map<String, Boolean> {
    val holder = fields[key] as? JsonValue.Obj ?: return emptyMap()
    val out = LinkedHashMap<String, Boolean>()
    for ((k, v) in holder.fields) out[k] = (v as? JsonValue.Bool)?.value ?: false
    return out
}

private fun tabsValue(tabs: List<String>): JsonValue =
    JsonValue.Arr(tabs.map { JsonValue.Str(it) })

/** In-memory store for the answer-key persistence ops (test-only). */
private class MemoryAnswerKeyStore : AnswerKeyStore {
    val values = LinkedHashMap<String, ByteArray>()

    override fun set(key: String, value: ByteArray) {
        values[key] = value
    }

    override fun get(key: String): ByteArray? = values[key]
}

private val answerKeys = MemoryAnswerKeyStore()

/** Opérations : le verdict des validateurs du noyau, tel que l'app les applique. */
private fun driver(op: JsonValue.Obj): JsonValue = when (op.str("op")) {
    // VALIDATE du corrigé : sources valides (liste) ou refus.
    "humanize" -> {
        val raw = op.str("answerKey")
            ?: throw IllegalArgumentException("pilote: corrigé absent")
        val answerKey = Humanize.validateAnswerKeyForRender(parseJsonValue(raw))
        obj(
            "ok" to JsonValue.Bool(true),
            "answer" to JsonValue.Str(answerKey.answer),
            "sources" to tabsValue(answerKey.sources),
        )
    }
    // Persistance de la clé de réponse : nouveau préfixe, ancien encore lu.
    "saveAnswerKey" -> {
        val id = op.str("id") ?: "answer-key-1"
        val raw = op.str("answerKey") ?: throw IllegalArgumentException("pilote: answerKey absent")
        val rendered = Humanize.renderAnswerKey(Humanize.validateAnswerKeyForRender(parseJsonValue(raw)))
        val key = Humanize.saveRenderedAnswerKey(answerKeys, id, rendered)
        obj(
            "key" to JsonValue.Str(key),
            "text" to JsonValue.Str(rendered.text),
        )
    }
    "seedLegacyAnswerKey" -> {
        val id = op.str("id") ?: "answer-key-1"
        val payload = "{\"text\":\"legacy rendered\",\"templateVersion\":\"" +
            HUMANIZE_TEMPLATE_VERSION + "\"}"
        answerKeys.set("homework:corrige:" + id, payload.toByteArray(Charsets.UTF_8))
        obj("seeded" to JsonValue.Bool(true))
    }
    "loadAnswerKey" -> {
        val id = op.str("id") ?: "answer-key-1"
        val loaded = Humanize.loadRenderedAnswerKey(answerKeys, id)
        obj(
            "found" to JsonValue.Bool(loaded != null),
            "text" to JsonValue.Str(loaded?.text ?: ""),
        )
    }
    // Sonde -> capacités : un contrat invalide vaut « rien n'est affirmé ».
    "capabilities" -> {
        val caps = CapabilityProbe.fromProbe(
            op.str("accountId") ?: "",
            op.boolMap("probe"),
            op.str("at") ?: "",
        )
        val value = if (caps == null) {
            JsonValue.Null
        } else {
            obj(
                "accountId" to JsonValue.Str(caps.accountId),
                "tabs" to tabsValue(caps.tabs),
                "fetchedAt" to JsonValue.Str(caps.fetchedAt),
            )
        }
        obj(
            "caps" to value,
            // Onglets que l'app masquerait : rien du tout quand les capacités
            // sont INCONNUES (fail-open), la liste des absents sinon.
            "disabled" to tabsValue(CapabilityProbe.disabled(caps)),
        )
    }
    // Adresse de serveur saisie : le verdict de `ServerConfig.validateBaseUrl`,
    // messages français compris (le contrat affiché à l'utilisateur).
    "serverUrl" -> {
        val raw = op.str("raw") ?: throw IllegalArgumentException("pilote: adresse absente")
        val result = ServerConfig.validateBaseUrl(raw)
        if (result is ServerUrlResult.Ok) {
            obj(
                "ok" to JsonValue.Bool(true),
                "baseUrl" to JsonValue.Str(result.baseUrl),
            )
        } else {
            obj(
                "ok" to JsonValue.Bool(false),
                "message" to JsonValue.Str((result as ServerUrlResult.Rejected).message),
            )
        }
    }
    // Allowlist du scraper : même préfixe strict que `ServerConfig.isAllowed`.
    "serverAllowed" -> {
        val url = op.str("url") ?: throw IllegalArgumentException("pilote: url absente")
        val baseUrl = op.str("baseUrl") ?: ""
        obj("allowed" to JsonValue.Bool(ServerConfig.isAllowed(url, baseUrl)))
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
