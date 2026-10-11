package fr.veryslopnynotes.pronote

/**
 * JSON minimal du protocole (#200).
 *
 * `org.json` est une API Android, pas du pur JVM : l'utiliser ici empêcherait de
 * compiler et de tester ce module avec `kotlinc` seul (le harnais de parité
 * #202 rejoue ce code sur JVM). D'où ce sous-ensemble strict (RFC 8259),
 * suffisant pour les enveloppes PRONOTE : objets, tableaux, chaînes, nombres,
 * booléens, `null`. Pas de `undefined`, pas de fonctions, pas de dates.
 *
 * `parse`/`stringify` suivent `JSON.parse`/`JSON.stringify` :
 * - clés dupliquées : la DERNIÈRE gagne (ordre d'insertion conservé sinon) ;
 * - `stringify` : ordre d'insertion, échappées courtes (`\n`, `\"`, `\\`…),
 *   `\u00XX` pour les autres contrôles, paires de substitution non-BMP brutes ;
 * - nombres : entier si entier (`20`, pas `20.0`), décimal le plus court sinon,
 *   exponentiel au-delà de `1e21` et sous `1e-6`, `NaN`/`Infini` → `null`.
 * Le harnais le prouve par écho contre `JSON.parse`/`JSON.stringify`.
 */
sealed interface JVal {
    /** `fields` = `LinkedHashMap` : l'ordre d'insertion FAIT le JSON émis. */
    data class Obj(val fields: LinkedHashMap<String, JVal>) : JVal
    data class Arr(val items: List<JVal>) : JVal
    data class Str(val value: String) : JVal
    data class Num(val value: Double) : JVal
    data class Bool(val value: Boolean) : JVal
    data object Null : JVal
}

/** `JSON.parse` qui échoue : le protocole a parlé autre chose que du JSON. */
class JsonError(message: String) : Exception(message)

object Json {
    fun parse(text: String): JVal = Parser(text).parse()

    fun stringify(value: JVal): String = buildString { appendValue(value) }

    private fun StringBuilder.appendValue(value: JVal) {
        when (value) {
            is JVal.Null -> append("null")
            is JVal.Bool -> append(if (value.value) "true" else "false")
            is JVal.Num -> append(jsNumber(value.value))
            is JVal.Str -> {
                append('"')
                appendEscaped(value.value)
                append('"')
            }
            is JVal.Arr -> {
                append('[')
                value.items.forEachIndexed { i, item ->
                    if (i > 0) append(',')
                    appendValue(item)
                }
                append(']')
            }
            is JVal.Obj -> {
                append('{')
                value.fields.entries.forEachIndexed { i, (k, item) ->
                    if (i > 0) append(',')
                    append('"')
                    appendEscaped(k)
                    append('"')
                    append(':')
                    appendValue(item)
                }
                append('}')
            }
            // `RawBytes` (réponse chiffrée en attente d'inflation) ne doit jamais
            // être sérialisé : s'il fuit ici, c'est un défaut, pas du JSON.
            else -> throw IllegalStateException("JVal non sérialisable : ${value.javaClass.simpleName}")
    }
    }

    private fun StringBuilder.appendEscaped(s: String) {
        var i = 0
        while (i < s.length) {
            val c = s[i]
            when (c) {
                '"' -> append("\\\"")
                '\\' -> append("\\\\")
                '\n' -> append("\\n")
                '\r' -> append("\\r")
                '\t' -> append("\\t")
                '\b' -> append("\\b")
                '\u000C' -> append("\\f")
                else -> {
                    // Paire de substitution valide : émise brute, comme JSON.stringify.
                    if (c.isHighSurrogate() && i + 1 < s.length && s[i + 1].isLowSurrogate()) {
                        append(c)
                        append(s[i + 1])
                        i += 2
                        continue
                    }
                    // Contrôle ou surrogate isolé : `\uXXXX` (le surrogate isolé
                    // est ce que JSON.stringify émet aussi, pas du brut).
                    if (c < ' ' || c.isSurrogate()) {
                        append("\\u")
                        append(c.code.toString(16).padStart(4, '0'))
                    } else {
                        append(c)
                    }
                    i++
                    continue
                }
            }
            i++
        }
    }

    private class Parser(private val text: String) {
        private var pos = 0

        fun parse(): JVal {
            skipWs()
            val v = parseValue()
            skipWs()
            if (pos != text.length) throw JsonError("traîne après le JSON à $pos")
            return v
        }

        private fun skipWs() {
            while (pos < text.length && text[pos] in " \t\n\r") pos++
        }

        private fun fail(msg: String): Nothing = throw JsonError("$msg à $pos")

        private fun parseValue(): JVal {
            skipWs()
            if (pos >= text.length) fail("fin inattendue")
            return when (text[pos]) {
                '{' -> parseObj()
                '[' -> parseArr()
                '"' -> JVal.Str(parseStr())
                't' -> {
                    expect("true")
                    JVal.Bool(true)
                }
                'f' -> {
                    expect("false")
                    JVal.Bool(false)
                }
                'n' -> {
                    expect("null")
                    JVal.Null
                }
                '-', in '0'..'9' -> parseNum()
                else -> fail("caractère '${text[pos]}'")
            }
        }

        private fun expect(word: String) {
            if (!text.startsWith(word, pos)) fail("attendu $word")
            pos += word.length
        }

        private fun parseObj(): JVal.Obj {
            pos++ // {
            val map = LinkedHashMap<String, JVal>()
            skipWs()
            if (pos < text.length && text[pos] == '}') {
                pos++
                return JVal.Obj(map)
            }
            while (true) {
                skipWs()
                if (pos >= text.length || text[pos] != '"') fail("clé attendue")
                val key = parseStr()
                skipWs()
                if (pos >= text.length || text[pos] != ':') fail("':' attendu")
                pos++
                map[key] = parseValue()
                skipWs()
                if (pos >= text.length) fail("fin d'objet inattendue")
                if (text[pos] == '}') {
                    pos++
                    return JVal.Obj(map)
                }
                if (text[pos] != ',') fail("',' attendue")
                pos++
            }
        }

        private fun parseArr(): JVal.Arr {
            pos++ // [
            val list = mutableListOf<JVal>()
            skipWs()
            if (pos < text.length && text[pos] == ']') {
                pos++
                return JVal.Arr(list)
            }
            while (true) {
                list.add(parseValue())
                skipWs()
                if (pos >= text.length) fail("fin de tableau inattendue")
                if (text[pos] == ']') {
                    pos++
                    return JVal.Arr(list)
                }
                if (text[pos] != ',') fail("',' attendue")
                pos++
            }
        }

        private fun parseStr(): String {
            pos++ // "
            val out = StringBuilder()
            while (true) {
                if (pos >= text.length) fail("chaîne non fermée")
                val c = text[pos++]
                if (c == '"') return out.toString()
                if (c == '\\') {
                    if (pos >= text.length) fail("échapée tronquée")
                    when (val e = text[pos++]) {
                        '"', '\\', '/' -> out.append(e)
                        'b' -> out.append('\b')
                        'f' -> out.append('\u000C')
                        'n' -> out.append('\n')
                        'r' -> out.append('\r')
                        't' -> out.append('\t')
                        'u' -> {
                            if (pos + 4 > text.length) fail("\\u tronqué")
                            val hi = text.substring(pos, pos + 4).toIntOrNull(16) ?: fail("\\u invalide")
                            pos += 4
                            if (hi in 0xD800..0xDBFF && pos + 6 <= text.length &&
                                text[pos] == '\\' && text[pos + 1] == 'u'
                            ) {
                                val lo = text.substring(pos + 2, pos + 6).toIntOrNull(16)
                                if (lo != null && lo in 0xDC00..0xDFFF) {
                                    out.appendCodePoint(0x10000 + ((hi - 0xD800) shl 10) + (lo - 0xDC00))
                                    pos += 6
                                    continue
                                }
                            }
                            // Surrogate isolé : conservé tel quel (comme JSON.parse,
                            // qui ne valide pas les paires) — `stringify` le rééchappera.
                            out.append(hi.toChar())
                        }
                        else -> fail("échapée '\\$e'")
                    }
                    continue
                }
                if (c < ' ') fail("contrôle brut en chaîne")
                out.append(c)
            }
        }

        private fun parseNum(): JVal.Num {
            val start = pos
            if (pos < text.length && text[pos] == '-') pos++
            // `01` est invalide en JSON (JSON.parse le refuse) : un seul `0`.
            if (pos < text.length && text[pos] == '0') {
                pos++
            } else {
                if (pos >= text.length || text[pos] !in '1'..'9') fail("nombre invalide")
                while (pos < text.length && text[pos] in '0'..'9') pos++
            }
            if (pos < text.length && text[pos] == '.') {
                pos++
                if (pos >= text.length || text[pos] !in '0'..'9') fail("décimales attendues")
                while (pos < text.length && text[pos] in '0'..'9') pos++
            }
            if (pos < text.length && (text[pos] == 'e' || text[pos] == 'E')) {
                pos++
                if (pos < text.length && (text[pos] == '+' || text[pos] == '-')) pos++
                if (pos >= text.length || text[pos] !in '0'..'9') fail("exposant attendu")
                while (pos < text.length && text[pos] in '0'..'9') pos++
            }
            return JVal.Num(text.substring(start, pos).toDouble())
        }
    }
}

/**
 * Rendu d'un `Double` à la `JSON.stringify` : entier si entier (`20`, pas
 * `20.0`), décimal le plus court sinon (`0.30000000000000004`), exponentiel
 * au-delà de `1e21` et sous `1e-6` (`1e+21`, pas `1.0E21`). `NaN`/`Infini` →
 * `null`. Prouvé par la parité (`num`, extrêmes inclus).
 */
internal fun jsNumber(d: Double): String {
    if (d.isNaN() || d.isInfinite()) return "null"
    if (d == kotlin.math.floor(d) && kotlin.math.abs(d) < 1e21) return d.toLong().toString()
    val java = d.toString()
    val ePos = java.indexOf('E')
    if (ePos < 0) return java
    var digits = java.substring(0, ePos).replace("-", "").replace(".", "")
    val exp = java.substring(ePos + 1).toInt()
    val negative = d < 0
    val ad = kotlin.math.abs(d)
    if (ad >= 1e21 || ad < 1e-6) {
        digits = digits.trimEnd('0')
        if (digits.isEmpty()) digits = "0"
        val mantissa = if (digits.length == 1) digits else "${digits[0]}.${digits.substring(1)}"
        return (if (negative) "-" else "") + mantissa + "e" + (if (exp < 0) "-" else "+") + kotlin.math.abs(exp)
    }
    // Entre 1e-6 et 1e-3 : `Double.toString` écrit `1.0E-4`, JS `0.0001`.
    val point = 1 + exp
    val body = digits.trimStart('0')
    if (body.isEmpty()) return "0"
    val out = StringBuilder()
    if (negative) out.append('-')
    if (point <= 0) {
        out.append("0.")
        repeat(-point) { out.append('0') }
        out.append(body)
    } else if (point >= body.length) {
        out.append(body)
        repeat(point - body.length) { out.append('0') }
    } else {
        out.append(body.substring(0, point))
        out.append('.')
        out.append(body.substring(point))
    }
    var s = out.toString()
    if (s.contains('.')) s = s.trimEnd('0').trimEnd('.')
    return s
}
