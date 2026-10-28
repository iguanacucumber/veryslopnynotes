package fr.veryslopnynotes.core

import java.math.BigDecimal
import java.math.MathContext
import java.math.RoundingMode
import kotlin.math.abs
import kotlin.math.floor

// Empreinte stable des notes et rendu JSON (port Kotlin #207).
//
// Porté de `server/jobs/grades.ts` (supprimé en #210 : ce port est la source
// de vérité). Données structurées uniquement : aucun appel LLM, aucune sortie
// libre ne déclenche d'événement (I7). Les champs de contexte
// (bonus/facultatif, moyennes de classe, libellé, enseignant) entrent dans
// l'empreinte — repasser une note en facultatif change l'empreinte.
//
// Pur : aucun réseau, aucun SQLite, aucun Android (I3). `Grade` est réutilisé
// tel quel (`Averages.kt`, contrat 0.7.0).
//
// ponytail: `fingerprint` rend du JSON à la main (stdlib seule, zéro
// dépendance, même sur le téléphone). Upgrade: sérialiseur partagé si un
// troisième module en a besoin.

/**
 * Rendu d'un `Double` à la `JSON.stringify` : la plus courte décimale qui
 * relit le même double, puis les règles d'écriture d'ECMAScript
 * (`Number::toString`) — entier si entier (`20`, pas `20.0`), plat de `1e-6`
 * à `1e21`, exponentiel au-delà et en dessous (`1e+21`, `1e-7`).
 * `NaN`/`Infini` → `null`.
 *
 * #410 : avant, `toLong()` SATURAIT (`1e19` → `9223372036854775807`) :
 * `1e19` et `5e19` rendaient le MÊME nombre, donc deux moyennes de classe
 * différentes donnaient la MÊME empreinte — une correction de professeur
 * n'était jamais détectée, jamais notifiée. Les chiffres significatifs
 * viennent de `BigDecimal` (exact) et non de `Double.toString`, qui n'est
 * pas le même partout (JDK 17 : `1.23456789012345677E18` là où JS écrit
 * `1.2345678901234568E18` ; Android/ART : l'ancien algorithme) : le rendu
 * d'une empreinte ne doit pas dépendre de la machine.
 *
 * COPIE de `pronote/Json.kt` (`jsNumber`) : `pronote` et `core` sont deux
 * modules Gradle SANS dépendance entre eux (`core` = stdlib seule, I3) — la
 * duplication est structurelle, et les deux rendus doivent rester identiques.
 */
internal fun jsNum(d: Double): String {
    if (d.isNaN() || d.isInfinite()) return "null"
    if (d == 0.0) return "0" // `-0` → `0` (comme `JSON.stringify`)
    val negative = d < 0
    val a = abs(d)
    // Entier exact : pour |x| ≤ 2^53, la seule décimale qui relit le double
    // est l'entier lui-même (l'intervalle de relecture vaut ±0,5) — le rendu
    // est donc l'entier, sans passer par `BigDecimal`.
    if (a <= 9007199254740992.0 && a == floor(a)) {
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
            mantissa + "e" + (if (e >= 0) "+" else "-") + abs(e)
        }
    }
    return (if (negative) "-" else "") + body
}

/** Chaîne entre guillemets à la `JSON.stringify` (échappées + paires valides brutes). */
internal fun jsonStr(s: String): String {
    val out = StringBuilder()
    out.append('"')
    var i = 0
    while (i < s.length) {
        val c = s[i]
        when (c) {
            '"' -> out.append("\\\"")
            '\\' -> out.append("\\\\")
            '\n' -> out.append("\\n")
            '\r' -> out.append("\\r")
            '\t' -> out.append("\\t")
            '\b' -> out.append("\\b")
            '\u000C' -> out.append("\\f")
            in '\uD800'..'\uDBFF' -> {
                val lo = if (i + 1 < s.length) s[i + 1] else '\u0000'
                if (lo in '\uDC00'..'\uDFFF') {
                    out.append(c)
                    out.append(lo)
                    i++
                } else {
                    out.append("\\u%04x".format(c.code))
                }
            }
            in '\uDC00'..'\uDFFF' -> out.append("\\u%04x".format(c.code))
            else -> if (c < ' ') out.append("\\u%04x".format(c.code)) else out.append(c)
        }
        i++
    }
    out.append('"')
    return out.toString()
}

/** Empreinte stable d'une note : tout son contenu publié. */
fun fingerprint(g: Grade): String {
    val parts = listOf(
        jsonStr(g.subject),
        jsNum(g.value),
        jsNum(g.scale),
        g.coefficient?.let { jsNum(it) } ?: "null",
        (g.bonus ?: false).toString(),
        (g.optional ?: false).toString(),
        g.classAverage?.let { jsNum(it) } ?: "null",
        g.classMin?.let { jsNum(it) } ?: "null",
        g.classMax?.let { jsNum(it) } ?: "null",
        g.periodId?.let { jsonStr(it) } ?: "null",
        jsonStr(g.date),
        g.label?.let { jsonStr(it) } ?: "null",
        g.teacher?.let { jsonStr(it) } ?: "null",
    )
    return "[${parts.joinToString(",")}]"
}
