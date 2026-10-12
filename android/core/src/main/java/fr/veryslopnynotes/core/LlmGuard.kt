package fr.veryslopnynotes.core

// Garde LLM I4/I5 : sans outils, sans reseau, sans secrets. Sortie texte/JSON validee.
// Port fidele de server/ai/guard.ts (supprimé en #210 : ce port est la source
// de vérité). Aucun acces reseau/env/outil ici (scan
// check-architecture). Stdlib + java.util uniquement, sans dependance.
// Les appels provider sont BLOQUANTS (pas de coroutines sans dependance,
// meme doctrine que le module pronote) : jamais sur le thread UI.
//
// Motifs secrets fragmentes volontairement : evite auto-match du scan I4
// (check-architecture cherche les formes contigues), detection runtime identique.
// F4 coupe aussi le mot banni par I1 (aucun hote en clair dans android/) :
// reconstitue a l'execution seulement.
const val MAX_OUTPUT_CHARS = 8000

private val SECRET_F1 = "sk-or" + "-v1-"
private val SECRET_F2 = "OPENROUTER_" + "API_KEY"
private val SECRET_F3 = "MASTER_" + "KEY"
private val SECRET_F4 = "PRON" + "OTE_" + "PASSWORD"
private val SECRET_F5 = "BEGIN " + "PRIVATE KEY"
private val SECRET_RE = Regex(listOf(SECRET_F1, SECRET_F2, SECRET_F3, SECRET_F4, SECRET_F5).joinToString("|"))

// JSON minimal pour les sorties LLM validees (I5) : objets, tableaux, chaines,
// nombres, booleens, null. Suffisant pour les schemas devoirs/fiches/corriges.
// Meme semantique que JSON.parse : cles dupliquees = la DERNIERE gagne, nombres
// en Double. Pas de dependance (org.json est une API Android, indisponible sous
// kotlinc seul pour le harnais de parite ; jumeau plus complet : Json du module
// pronote, hors dependance ici pour garder core sans reseau).
sealed interface JsonValue {
    data class Obj(val fields: LinkedHashMap<String, JsonValue>) : JsonValue
    data class Arr(val items: List<JsonValue>) : JsonValue
    data class Str(val value: String) : JsonValue
    data class Num(val value: Double) : JsonValue
    data class Bool(val value: Boolean) : JsonValue
    data object Null : JsonValue
}

fun jsonStrOf(v: JsonValue, key: String): String? {
    val f = (v as? JsonValue.Obj)?.fields?.get(key) ?: return null
    return (f as? JsonValue.Str)?.value
}

private class JsonParser(private val text: String) {
    private var pos = 0

    fun parse(): JsonValue {
        skipWs()
        val v = parseValue()
        skipWs()
        if (pos != text.length) throw AiError("sortie LLM JSON invalide (I5)")
        return v
    }

    private fun skipWs() {
        while (pos < text.length && text[pos] in " \t\n\r") pos++
    }

    private fun parseValue(): JsonValue {
        if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
        return when (text[pos]) {
            '{' -> parseObj()
            '[' -> parseArr()
            '"' -> JsonValue.Str(parseStr())
            't' -> { expect("true"); JsonValue.Bool(true) }
            'f' -> { expect("false"); JsonValue.Bool(false) }
            'n' -> { expect("null"); JsonValue.Null }
            else -> parseNum()
        }
    }

    private fun expect(word: String) {
        if (!text.startsWith(word, pos)) throw AiError("sortie LLM JSON invalide (I5)")
        pos += word.length
    }

    private fun parseObj(): JsonValue.Obj {
        pos++
        val fields = LinkedHashMap<String, JsonValue>()
        skipWs()
        if (pos < text.length && text[pos] == '}') {
            pos++
            return JsonValue.Obj(fields)
        }
        while (true) {
            skipWs()
            if (pos >= text.length || text[pos] != '"') throw AiError("sortie LLM JSON invalide (I5)")
            val key = parseStr()
            skipWs()
            if (pos >= text.length || text[pos] != ':') throw AiError("sortie LLM JSON invalide (I5)")
            pos++
            skipWs()
            fields[key] = parseValue()
            skipWs()
            if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
            if (text[pos] == '}') {
                pos++
                return JsonValue.Obj(fields)
            }
            if (text[pos] != ',') throw AiError("sortie LLM JSON invalide (I5)")
            pos++
        }
    }

    private fun parseArr(): JsonValue.Arr {
        pos++
        val items = ArrayList<JsonValue>()
        skipWs()
        if (pos < text.length && text[pos] == ']') {
            pos++
            return JsonValue.Arr(items)
        }
        while (true) {
            skipWs()
            items.add(parseValue())
            skipWs()
            if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
            if (text[pos] == ']') {
                pos++
                return JsonValue.Arr(items)
            }
            if (text[pos] != ',') throw AiError("sortie LLM JSON invalide (I5)")
            pos++
        }
    }

    private fun parseStr(): String {
        pos++
        val out = StringBuilder()
        while (true) {
            if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
            val c = text[pos++]
            if (c == '"') return out.toString()
            if (c == '\\') {
                if (pos >= text.length) throw AiError("sortie LLM JSON invalide (I5)")
                when (val e = text[pos++]) {
                    '"', '\\', '/' -> out.append(e)
                    'b' -> out.append('\b')
                    'f' -> out.append('\u000C')
                    'n' -> out.append('\n')
                    'r' -> out.append('\r')
                    't' -> out.append('\t')
                    'u' -> {
                        if (pos + 4 > text.length) throw AiError("sortie LLM JSON invalide (I5)")
                        val hex = text.substring(pos, pos + 4)
                        val code = hex.toIntOrNull(16) ?: throw AiError("sortie LLM JSON invalide (I5)")
                        out.append(code.toChar())
                        pos += 4
                    }
                    else -> throw AiError("sortie LLM JSON invalide (I5)")
                }
            } else if (c < ' ') {
                throw AiError("sortie LLM JSON invalide (I5)")
            } else {
                out.append(c)
            }
        }
    }

    private fun parseNum(): JsonValue.Num {
        val start = pos
        if (pos < text.length && text[pos] == '-') pos++
        while (pos < text.length && text[pos] in '0'..'9') pos++
        if (pos < text.length && text[pos] == '.') {
            pos++
            while (pos < text.length && text[pos] in '0'..'9') pos++
        }
        if (pos < text.length && (text[pos] == 'e' || text[pos] == 'E')) {
            pos++
            if (pos < text.length && (text[pos] == '+' || text[pos] == '-')) pos++
            while (pos < text.length && text[pos] in '0'..'9') pos++
        }
        val raw = text.substring(start, pos)
        val num = raw.toDoubleOrNull() ?: throw AiError("sortie LLM JSON invalide (I5)")
        if (!num.isFinite()) throw AiError("sortie LLM JSON invalide (I5)")
        return JsonValue.Num(num)
    }
}

fun parseJsonValue(text: String): JsonValue = JsonParser(text).parse()

private fun jsonEscape(raw: String): String = buildString {
    for (c in raw) {
        when (c) {
            '"' -> append("\\\"")
            '\\' -> append("\\\\")
            '\n' -> append("\\n")
            '\r' -> append("\\r")
            '\t' -> append("\\t")
            '\b' -> append("\\b")
            '\u000C' -> append("\\f")
            else -> if (c < ' ') append("\\u" + c.code.toString(16).padStart(4, '0')) else append(c)
        }
    }
}

// Serialisation canonique (ordre d'insertion) : persistance des corriges
// (Humanize) et reponses du pilote de parite. Nombres entiers sans decimale.
fun stringifyJson(value: JsonValue): String = buildString { appendJson(value) }

private fun StringBuilder.appendJson(value: JsonValue) {
    when (value) {
        is JsonValue.Null -> append("null")
        is JsonValue.Bool -> append(if (value.value) "true" else "false")
        is JsonValue.Num -> {
            val v = value.value
            if (v == kotlin.math.floor(v) && v.isFinite() && kotlin.math.abs(v) < 1e21) {
                append(v.toLong().toString())
            } else {
                append(v.toString())
            }
        }
        is JsonValue.Str -> append('"').append(jsonEscape(value.value)).append('"')
        is JsonValue.Arr -> {
            append('[')
            value.items.forEachIndexed { i, item ->
                if (i > 0) append(',')
                appendJson(item)
            }
            append(']')
        }
        is JsonValue.Obj -> {
            append('{')
            value.fields.entries.forEachIndexed { i, (k, item) ->
                if (i > 0) append(',')
                append('"').append(jsonEscape(k)).append('"').append(':')
                appendJson(item)
            }
            append('}')
        }
    }
}

// Rejette tout prompt (system + donnees + body) contenant un secret.
fun assertNoSecretsInPrompt(safe: SafePrompt, data: List<Untrusted<String>> = emptyList()) {
    val hay = (listOf(safe.system, safe.body) + data.map { it.value }).joinToString("\n")
    if (SECRET_RE.containsMatchIn(hay)) throw AiError("secret dans prompt LLM (I4)")
}

// Sortie texte : non-vide, bornee, sans secret. Retourne l'original (espaces gardes).
fun validateTextOutput(out: String): String {
    if (out.trim().isEmpty()) throw AiError("sortie LLM vide (I5)")
    if (out.length > MAX_OUTPUT_CHARS) throw AiError("sortie LLM trop longue (I5)")
    if (SECRET_RE.containsMatchIn(out)) throw AiError("secret dans sortie LLM (I4)")
    return out
}

// Sortie JSON : texte valide + objet/tableau.
fun parseJsonOutput(out: String): JsonValue {
    val text = validateTextOutput(out)
    val parsed = try {
        parseJsonValue(text)
    } catch (e: AiError) {
        throw AiError("sortie LLM JSON invalide (I5)")
    }
    if (parsed !is JsonValue.Obj && parsed !is JsonValue.Arr) {
        throw AiError("sortie LLM JSON invalide (I5)")
    }
    return parsed
}

// Fournisseur qui sait envoyer un SafePrompt deja valide (nonce de l'appelant
// preserve). Meme repli que cote TS : sinon generate(), qui reconstruit.
fun interface LlmProvider {
    fun generate(system: String, data: List<Untrusted<String>>, apiKey: String?): String
}

interface SafePromptProvider : LlmProvider {
    fun generateSafe(safe: SafePrompt, apiKey: String?): String
}

// Envoie le prompt VALIDE ici (jamais une reconstruction) : le corps controle par
// assertNoSecretsInPrompt est exactement celui transmis.
private fun callProvider(
    provider: LlmProvider,
    safe: SafePrompt,
    data: List<Untrusted<String>>,
    apiKey: String?,
): String {
    val p = provider as? SafePromptProvider
    if (p != null) return p.generateSafe(safe, apiKey)
    return provider.generate(safe.system, data, apiKey)
}

// Pont SafePrompt (body nonce) -> LlmProvider (system + data Untrusted).
// Valide prompt avant appel, valide sortie apres. Aucun outil/reseau ici.
// apiKey = credential de l'APP, relayee telle quelle vers l'adaptateur. Elle
// n'entre JAMAIS dans le prompt (donc jamais dans assertNoSecretsInPrompt) et
// n'est jamais journalisee ici.
fun generateGuarded(
    provider: LlmProvider,
    system: String,
    data: List<Untrusted<String>>,
    nonce: String? = null,
    apiKey: String? = null,
): String {
    val safe = buildSafePrompt(system, data, nonce)
    assertNoSecretsInPrompt(safe, data)
    val out = callProvider(provider, safe, data, apiKey)
    return validateTextOutput(out)
}

fun generateGuardedJson(
    provider: LlmProvider,
    system: String,
    data: List<Untrusted<String>>,
    nonce: String? = null,
    apiKey: String? = null,
): JsonValue {
    val safe = buildSafePrompt(system, data, nonce)
    assertNoSecretsInPrompt(safe, data)
    val out = callProvider(provider, safe, data, apiKey)
    return parseJsonOutput(out)
}
