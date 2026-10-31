package fr.veryslopnynotes.pronote

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

/**
 * `org.json` est une API Android : l'utiliser empêcherait de compiler et tester
 * ce module avec `kotlinc` seul (le harnais de parité rejoue ce code sur JVM).
 * Sous-ensemble strict RFC 8259, suffisant pour les enveloppes PRONOTE.
 *
 * `parse`/`stringify` suivent `JSON.parse`/`JSON.stringify` : dernière clé
 * dupliquée gagne, ordre d'insertion, nombres au format JS (`20`, pas `20.0`),
 * profondeur bornée à `MAX_DEPTH` (un `JsonError` attrapable, jamais un
 * `StackOverflowError`).
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
    /**
     * Le parseur est RÉCURSIF : sans borne, une réponse malformée (`[[[[…]]]]`)
     * lève `StackOverflowError`, une `Error` non attrapable par les
     * `catch (e: Exception)` — crash dur au lieu d'un échec de lecture.
     * 512 niveaux couvrent largement les enveloppes PRONOTE (3-4).
     */
    const val MAX_DEPTH = 512

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
            // `RawBytes` ne doit jamais être sérialisé : s'il fuit ici, c'est un
            // défaut, pas du JSON.
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
                    // Contrôle ou surrogate isolé : `\uXXXX`, comme JSON.stringify.
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

        private var depth = 0

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
            val c = text[pos]
            if (c == '{' || c == '[') {
                if (depth >= MAX_DEPTH) fail("profondeur excessive")
                depth++
                try {
                    return if (c == '{') parseObj() else parseArr()
                } finally {
                    depth--
                }
            }
            return when (c) {
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
                else -> fail("caractère '$c'")
            }
        }

        private fun expect(word: String) {
            if (!text.startsWith(word, pos)) fail("attendu $word")
            pos += word.length
        }

        private fun parseObj(): JVal.Obj {
            pos++
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
            pos++
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

        /**
         * 4 chiffres hexadécimaux EXACTEMENT, ou `null`. `toIntOrNull(16)`
         * acceptait un signe (`+41` → 65) que `JSON.parse` refuse.
         */
        private fun hex4(s: String, at: Int): Int? {
            if (at + 4 > s.length) return null
            var v = 0
            for (i in 0 until 4) {
                val c = s[at + i]
                val d = when {
                    c in '0'..'9' -> c - '0'
                    c in 'a'..'f' -> c - 'a' + 10
                    c in 'A'..'F' -> c - 'A' + 10
                    else -> return null
                }
                v = v * 16 + d
            }
            return v
        }

        private fun parseStr(): String {
            pos++
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
                            val hi = hex4(text, pos) ?: fail("\\u invalide")
                            pos += 4
                            if (hi in 0xD800..0xDBFF && pos + 6 <= text.length &&
                                text[pos] == '\\' && text[pos + 1] == 'u'
                            ) {
                                val lo = hex4(text, pos + 2)
                                if (lo != null && lo in 0xDC00..0xDFFF) {
                                    out.appendCodePoint(0x10000 + ((hi - 0xD800) shl 10) + (lo - 0xDC00))
                                    pos += 6
                                    continue
                                }
                            }
                            // Surrogate isolé conservé tel quel (JSON.parse ne
                            // valide pas les paires).
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
            // `01` est invalide en JSON : un seul `0`.
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
 * Rendu d'un `Double` à la `JSON.stringify` : la plus courte décimale qui relit
 * le double, puis les règles ECMAScript (entier si entier, plat de `1e-6` à
 * `1e21`, exponentiel au-delà). `NaN`/`Infini` → `null`.
 *
 * Les chiffres sont cherchés par `BigDecimal` (exact) : `Double.toString` n'est
 * PAS le même partout (JDK 17, JDK 19+, ART), le rendu ne doit pas dépendre de
 * la machine.
 */
internal fun jsNumber(d: Double): String {
    if (d.isNaN() || d.isInfinite()) return "null"
    if (d == 0.0) return "0" // `-0` → `0` (comme `JSON.stringify`)
    val negative = d < 0
    val a = kotlin.math.abs(d)
    // Entier exact pour |x| ≤ 2^53 : l'entier lui-même relit le double.
    if (a <= 9007199254740992.0 && a == kotlin.math.floor(a)) {
        return (if (negative) "-" else "") + a.toLong().toString()
    }
    // 17 chiffres suffisent toujours ; on s'arrête au PREMIER qui relit juste.
    val exact = BigDecimal(a)
    var rounded = exact.round(MathContext(17, RoundingMode.HALF_EVEN))
    for (k in 1..16) {
        val r = exact.round(MathContext(k, RoundingMode.HALF_EVEN))
        if (r.toDouble() == a) {
            rounded = r
            break
        }
    }
    // Les zéros de fin ne sont pas significatifs : ils portent l'exposant.
    var digits = rounded.unscaledValue().toString()
    val scale = rounded.scale()
    var trailing = 0
    while (digits.length > 1 && digits.endsWith("0")) {
        digits = digits.dropLast(1)
        trailing++
    }
    val k = digits.length
    val n = k + trailing - scale // valeur = chiffres × 10^(n − k)
    val body = when {
        k <= n && n <= 21 -> digits + "0".repeat(n - k)
        n in 1..21 -> digits.substring(0, n) + "." + digits.substring(n)
        n in -5..0 -> "0." + "0".repeat(-n) + digits
        else -> {
            val mantissa = if (k == 1) digits else digits[0] + "." + digits.substring(1)
            val e = n - 1
            mantissa + "e" + (if (e >= 0) "+" else "-") + kotlin.math.abs(e)
        }
    }
    return (if (negative) "-" else "") + body
}
