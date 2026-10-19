package fr.veryslopnynotes.pronote

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode

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
 * - nombres : entier si entier (`20`, pas `20.0`), la plus courte décimale
 *   qui relit le double sinon (`0.30000000000000004`), exponentiel au-delà
 *   de `1e21` et sous `1e-6`, `NaN`/`Infini` → `null`.
 * - `parse` : profondeur d'imbrication bornée (`MAX_DEPTH`) — une entrée trop
 *   profonde échoue par un `JsonError` RATRAPABLE, jamais par le
 *   `StackOverflowError` (une `Error` : crash dur) du parseur non borné.
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
    /**
     * Profondeur d'imbrication maximale acceptée par `parse` (conteneurs
     * imbriqués : objets ET tableaux).
     *
     * Le parseur est RÉCURSIF : sans borne, une réponse serveur malformée
     * (`[[[[…]]]]`) épuise la pile et lève `StackOverflowError` — une `Error`,
     * donc NON attrapable par les `catch (e: Exception)` des dépôts, de
     * `PeriodicSyncWorker` et du pilote de parité : crash dur de l'app au
     * lieu d'un échec de lecture. `JSON.parse` de V8, lui, lève un `RangeError`
     * attrapable. Au-delà de la borne, on refuse donc par un `JsonError`.
     *
     * 512 niveaux couvrent largement les enveloppes PRONOTE (3-4) et restent
     * très en dessous de la limite de pile.
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

        /** Conteneurs ouverts à cet instant (objets + tableaux). */
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
                // Un conteneur de plus. Au-delà de la borne : `JsonError`
                // (rattrapable), jamais le `StackOverflowError` du parseur non
                // borné (crash dur : une `Error` n'est pas une `Exception`).
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
 * Rendu d'un `Double` à la `JSON.stringify` : la plus courte décimale qui
 * relit le même double, puis les règles d'écriture d'ECMAScript
 * (`Number::toString`) — entier si entier (`20`, pas `20.0`), plat de `1e-6`
 * à `1e21`, exponentiel au-delà et en dessous (`1e+21`, `1e-7`).
 * `NaN`/`Infini` → `null`. Prouvé par la parité (`num`, extrêmes inclus).
 *
 * #410 : le rendu ne doit PAS dépendre de la machine. Les chiffres
 * significatifs sont donc cherchés par `BigDecimal` (exact) et non par
 * `Double.toString`, qui n'est PAS le même partout : JDK 17 écrivait
 * `1.23456789012345677E18` là où JS (et JDK 19+) écrivent
 * `1.2345678901234568E18`, et Android (ART) a encore l'ancien algorithme.
 * Un `toLong()` saturant (`1e19` → `9223372036854775807`) donnerait en plus
 * le MÊME nombre pour `1e19` et `5e19` : deux moyennes de classe
 * différentes, une seule empreinte de note.
 *
 * COPIE de `core/GradeDiff.kt` (`jsNum`) : `pronote` et `core` sont deux
 * modules Gradle SANS dépendance entre eux (`core` = stdlib seule, I3) — la
 * duplication est structurelle, et les deux rendus doivent rester identiques.
 */
internal fun jsNumber(d: Double): String {
    if (d.isNaN() || d.isInfinite()) return "null"
    if (d == 0.0) return "0" // `-0` → `0` (comme `JSON.stringify`)
    val negative = d < 0
    val a = kotlin.math.abs(d)
    // Entier exact : pour |x| ≤ 2^53, la seule décimale qui relit le double
    // est l'entier lui-même (l'intervalle de relecture vaut ±0,5) — le rendu
    // est donc l'entier, sans passer par `BigDecimal`.
    if (a <= 9007199254740992.0 && a == kotlin.math.floor(a)) {
        return (if (negative) "-" else "") + a.toLong().toString()
    }
    // Sinon : la plus courte suite de chiffres significatifs qui relit le
    // même double. 17 chiffres suffisent toujours (le round-trip le plus court
    // en tient 17 au plus) ; on s'arrête au PREMIER qui relit juste.
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
