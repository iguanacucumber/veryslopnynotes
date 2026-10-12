package fr.veryslopnynotes.aiparity

import fr.veryslopnynotes.core.AiError
import fr.veryslopnynotes.core.HomeworkAi
import fr.veryslopnynotes.core.HomeworkOutcome
import fr.veryslopnynotes.core.HomeworkSource
import fr.veryslopnynotes.core.Humanize
import fr.veryslopnynotes.core.JsonValue
import fr.veryslopnynotes.core.LlmProvider
import fr.veryslopnynotes.core.RevisionAi
import fr.veryslopnynotes.core.RevisionChunk
import fr.veryslopnynotes.core.RevisionExam
import fr.veryslopnynotes.core.SafePromptProvider
import fr.veryslopnynotes.core.CorrigeStore
import fr.veryslopnynotes.core.HOMEWORK_REFUSAL_REASON
import fr.veryslopnynotes.core.SYSTEM_HOMEWORK
import fr.veryslopnynotes.core.SYSTEM_HOMEWORK_JSON
import fr.veryslopnynotes.core.SYSTEM_REVISION
import fr.veryslopnynotes.core.ValidatedCorrige
import fr.veryslopnynotes.core.assertNoSecretsInPrompt
import fr.veryslopnynotes.core.buildHomeworkPrompt
import fr.veryslopnynotes.core.buildRevisionPrompt
import fr.veryslopnynotes.core.buildSafePrompt
import fr.veryslopnynotes.core.createNonce
import fr.veryslopnynotes.core.generateGuarded
import fr.veryslopnynotes.core.generateGuardedJson
import fr.veryslopnynotes.core.markExternal
import fr.veryslopnynotes.core.parseJsonOutput
import fr.veryslopnynotes.core.parseJsonValue
import fr.veryslopnynotes.core.parseRevisionAnswer
import fr.veryslopnynotes.core.stringifyJson
import fr.veryslopnynotes.core.validateTextOutput
import fr.veryslopnynotes.core.wrapUntrusted
import java.io.BufferedReader
import java.io.InputStreamReader
import java.io.PrintStream
import java.nio.charset.StandardCharsets

// AiParityMain — pilote JSON de la parite IA (#204).
//
// OUTIL DE TEST uniquement (jamais Gradle, jamais l'APK). Meme protocole que
// ParityMain/ClientParityMain (une operation par ligne). Les erreurs metier du
// port (AiError) sont rendues en {"error","message"} pour comparaison du MESSAGE
// avec la reference TS ; une entree malformee rend "pilote: ..." (le harnais
// leve : defaut pilote, pas divergence).
// Compile avec kotlinc seul : que des fichiers core sans dependance.

private fun pilotError(msg: String): Exception = Exception("pilote: " + msg)

private fun fieldsOf(v: JsonValue): Map<String, JsonValue> {
    val o = v as? JsonValue.Obj ?: throw pilotError("objet attendu")
    return o.fields
}

private fun reqStr(fields: Map<String, JsonValue>, key: String): String {
    val s = fields[key] as? JsonValue.Str ?: throw pilotError("champ manquant: " + key)
    return s.value
}

private fun optStr(fields: Map<String, JsonValue>, key: String): String? {
    val v = fields[key] ?: return null
    if (v is JsonValue.Null) return null
    val s = v as? JsonValue.Str ?: throw pilotError("champ non-texte: " + key)
    return s.value
}

private fun reqData(fields: Map<String, JsonValue>): List<fr.veryslopnynotes.core.Untrusted<String>> {
    val arr = fields["data"] as? JsonValue.Arr ?: throw pilotError("champ data manquant")
    return arr.items.map {
        val s = it as? JsonValue.Str ?: throw pilotError("data non-texte")
        markExternal(s.value)
    }
}

private fun reqSources(fields: Map<String, JsonValue>): List<HomeworkSource> {
    val arr = fields["sources"] as? JsonValue.Arr ?: throw pilotError("champ sources manquant")
    return arr.items.map {
        val f = fieldsOf(it)
        HomeworkSource(label = reqStr(f, "label"), text = reqStr(f, "text"))
    }
}

private fun reqExam(fields: Map<String, JsonValue>): RevisionExam {
    val f = fieldsOf(fields["exam"] ?: throw pilotError("champ exam manquant"))
    return RevisionExam(
        id = reqStr(f, "id"),
        subject = reqStr(f, "subject"),
        date = reqStr(f, "date"),
        matched = reqStr(f, "matched"),
    )
}

private fun reqChunks(fields: Map<String, JsonValue>): List<RevisionChunk> {
    val arr = fields["chunks"] as? JsonValue.Arr ?: throw pilotError("champ chunks manquant")
    return arr.items.map {
        val f = fieldsOf(it)
        RevisionChunk(text = reqStr(f, "text"), source = reqStr(f, "source"))
    }
}

private fun cannedProvider(fields: Map<String, JsonValue>): LlmProvider {
    val canned = reqStr(fields, "canned")
    val kind = optStr(fields, "provider") ?: "plain"
    if (kind == "safe") {
        return object : SafePromptProvider {
            override fun generate(
                system: String,
                data: List<fr.veryslopnynotes.core.Untrusted<String>>,
                apiKey: String?,
            ): String = canned
            override fun generateSafe(safe: fr.veryslopnynotes.core.SafePrompt, apiKey: String?): String = canned
        }
    }
    if (kind != "plain") throw pilotError("provider inconnu: " + kind)
    return LlmProvider { _, _, _ -> canned }
}

private fun outcomeJson(o: HomeworkOutcome): JsonValue {
    val f = LinkedHashMap<String, JsonValue>()
    when (o) {
        is HomeworkOutcome.Answer -> {
            f["status"] = JsonValue.Str("ok")
            f["answer"] = JsonValue.Str(o.answer)
            f["steps"] = JsonValue.Arr(o.steps.map { JsonValue.Str(it) })
            f["sources"] = JsonValue.Arr(o.sources.map { JsonValue.Str(it) })
        }
        is HomeworkOutcome.Refused -> {
            f["status"] = JsonValue.Str("refused")
            f["reason"] = JsonValue.Str(o.reason)
            f["sources"] = JsonValue.Arr(o.sources.map { JsonValue.Str(it) })
        }
    }
    return JsonValue.Obj(f)
}

private fun ok(vararg pairs: Pair<String, JsonValue>): JsonValue.Obj {
    val f = LinkedHashMap<String, JsonValue>()
    for ((k, v) in pairs) f[k] = v
    return JsonValue.Obj(f)
}

private class MemStore : CorrigeStore {
    val map = HashMap<String, ByteArray>()
    override fun set(key: String, value: ByteArray) {
        map[key] = value
    }
    override fun get(key: String): ByteArray? = map[key]
}

private val memStore = MemStore()

private fun handle(op: JsonValue): JsonValue {
    val fields = fieldsOf(op)
    return when (reqStr(fields, "op")) {
        "nonce" -> ok("nonce" to JsonValue.Str(createNonce()))
        "wrap" -> {
            val out = wrapUntrusted(markExternal(reqStr(fields, "text")), reqStr(fields, "nonce"))
            ok("text" to JsonValue.Str(out))
        }
        "safePrompt" -> {
            val p = buildSafePrompt(reqStr(fields, "system"), reqData(fields), optStr(fields, "nonce"))
            ok(
                "system" to JsonValue.Str(p.system),
                "body" to JsonValue.Str(p.body),
                "nonce" to JsonValue.Str(p.nonce),
            )
        }
        "assertNoSecrets" -> {
            val safe = fr.veryslopnynotes.core.SafePrompt(
                system = reqStr(fields, "system"),
                body = reqStr(fields, "body"),
                nonce = reqStr(fields, "nonce"),
            )
            assertNoSecretsInPrompt(safe, reqData(fields))
            ok("ok" to JsonValue.Bool(true))
        }
        "validateText" -> {
            ok("text" to JsonValue.Str(validateTextOutput(reqStr(fields, "text"))))
        }
        "parseJson" -> {
            ok("value" to parseJsonOutput(reqStr(fields, "text")))
        }
        "guardedText" -> {
            val p = cannedProvider(fields)
            val out = generateGuarded(p, reqStr(fields, "system"), reqData(fields), optStr(fields, "nonce"))
            ok("text" to JsonValue.Str(out))
        }
        "guardedJson" -> {
            val p = cannedProvider(fields)
            val out = generateGuardedJson(p, reqStr(fields, "system"), reqData(fields), optStr(fields, "nonce"))
            ok("value" to out)
        }
        "homework" -> {
            val sources = reqSources(fields)
            val apiKey = reqStr(fields, "apiKey")
            val provider = if (fields.containsKey("canned")) {
                cannedProvider(fields)
            } else {
                LlmProvider { _, _, _ -> throw pilotError("provider appele sans canned") }
            }
            val outcome = HomeworkAi.generateHomework(
                provider,
                reqStr(fields, "question"),
                sources,
                apiKey,
                optStr(fields, "nonce"),
            )
            ok("outcome" to outcomeJson(outcome))
        }
        "revisionDocs" -> {
            val docs = RevisionAi.buildRevisionDocs(reqExam(fields), reqChunks(fields))
            ok("docs" to JsonValue.Arr(docs.map { JsonValue.Str(it) }))
        }
        "revisionPrompt" -> {
            val p = RevisionAi.revisionPromptFor(reqExam(fields), reqChunks(fields), optStr(fields, "nonce"))
            ok(
                "system" to JsonValue.Str(p.system),
                "body" to JsonValue.Str(p.body),
                "nonce" to JsonValue.Str(p.nonce),
            )
        }
        "revisionParse" -> {
            val v = parseJsonValue(reqStr(fields, "json"))
            ok("fiche" to JsonValue.Str(parseRevisionAnswer(v)))
        }
        "revisionRequest" -> {
            val p = cannedProvider(fields)
            val fiche = RevisionAi.requestRevisionFiche(p, reqExam(fields), reqChunks(fields), optStr(fields, "nonce"))
            ok("fiche" to JsonValue.Str(fiche))
        }
        "prompts" -> {
            val rev = buildRevisionPrompt(listOf(reqStr(fields, "doc")), optStr(fields, "nonce"))
            val hw = buildHomeworkPrompt(listOf(reqStr(fields, "doc")), optStr(fields, "nonce"))
            ok(
                "revision" to JsonValue.Str(SYSTEM_REVISION),
                "homework" to JsonValue.Str(SYSTEM_HOMEWORK),
                "homeworkJson" to JsonValue.Str(SYSTEM_HOMEWORK_JSON),
                "revBody" to JsonValue.Str(rev.body),
                "hwBody" to JsonValue.Str(hw.body),
            )
        }
        "humanizeValidate" -> {
            val c = Humanize.validateCorrigeForRender(parseJsonValue(reqStr(fields, "json")))
            ok(
                "answer" to JsonValue.Str(c.answer),
                "sources" to JsonValue.Arr(c.sources.map { JsonValue.Str(it) }),
            )
        }
        "humanizeRender" -> {
            val arr = fields["sources"] as? JsonValue.Arr ?: throw pilotError("champ sources manquant")
            val c = ValidatedCorrige(
                answer = reqStr(fields, "answer"),
                sources = arr.items.map {
                    (it as? JsonValue.Str)?.value ?: throw pilotError("source non-texte")
                },
            )
            val r = Humanize.renderCorrige(c, optStr(fields, "version") ?: fr.veryslopnynotes.core.HUMANIZE_TEMPLATE_VERSION)
            ok("text" to JsonValue.Str(r.text), "templateVersion" to JsonValue.Str(r.templateVersion))
        }
        "humanizeCorrige" -> {
            val r = Humanize.humanizeCorrige(parseJsonValue(reqStr(fields, "json")), optStr(fields, "version") ?: fr.veryslopnynotes.core.HUMANIZE_TEMPLATE_VERSION)
            ok("text" to JsonValue.Str(r.text), "templateVersion" to JsonValue.Str(r.templateVersion))
        }
        "corrigeRoundtrip" -> {
            val arr = fields["sources"] as? JsonValue.Arr ?: throw pilotError("champ sources manquant")
            val c = ValidatedCorrige(
                answer = reqStr(fields, "answer"),
                sources = arr.items.map {
                    (it as? JsonValue.Str)?.value ?: throw pilotError("source non-texte")
                },
            )
            val rendered = Humanize.renderCorrige(c)
            Humanize.saveRenderedCorrige(memStore, reqStr(fields, "id"), rendered)
            val loaded = Humanize.loadRenderedCorrige(memStore, reqStr(fields, "id"))
                ?: throw pilotError("roundtrip a perdu le corrige")
            ok("text" to JsonValue.Str(loaded.text), "templateVersion" to JsonValue.Str(loaded.templateVersion))
        }
        else -> throw pilotError("operation inconnue")
    }
}

fun main() {
    val reader = BufferedReader(InputStreamReader(System.`in`, StandardCharsets.UTF_8))
    val out = PrintStream(System.out, true, "UTF-8")
    while (true) {
        val line = reader.readLine() ?: break
        if (line.isBlank()) continue
        val response = try {
            handle(parseJsonValue(line))
        } catch (e: AiError) {
            ok("error" to JsonValue.Str("ai"), "message" to JsonValue.Str(e.message ?: ""))
        } catch (e: Exception) {
            val msg = e.message ?: ""
            if (msg.startsWith("pilote: ")) {
                ok("error" to JsonValue.Str("pilot"), "message" to JsonValue.Str(msg))
            } else {
                ok("error" to JsonValue.Str("pilot"), "message" to JsonValue.Str("pilote: " + msg))
            }
        }
        out.println(stringifyJson(response))
    }
}
