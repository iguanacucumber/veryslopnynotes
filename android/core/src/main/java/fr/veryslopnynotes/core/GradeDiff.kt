package fr.veryslopnynotes.core

import kotlin.math.abs
import kotlin.math.floor

// Diff structurée des notes (port Kotlin #207).
//
// Port fidèle de `server/jobs/grades.ts`, qui reste la RÉFÉRENCE : les deux
// implémentations sont rejouées sur les mêmes fixtures et comparées (cf.
// `tests/unit/kotlin-jobs-parity.test.ts`). Données structurées uniquement :
// aucun appel LLM, aucune sortie libre ne déclenche d'événement (I7).
// Correction de note = événement dédié (nouvelle information à notifier).
// Les champs de contexte (bonus/facultatif, moyennes de classe, libellé,
// enseignant) entrent dans l'empreinte — repasser une note en facultatif est
// une correction.
//
// Pur : aucun réseau, aucun SQLite, aucun Android (I3). `Grade` est réutilisé
// tel quel (`Averages.kt`, contrat 0.7.0).
//
// ponytail: `fingerprint` rend du JSON à la main (stdlib seule, zéro
// dépendance, même sur le téléphone). Upgrade: sérialiseur partagé si un
// troisième module en a besoin.

/** Notes ajoutées / corrigées / supprimées depuis le dernier snapshot. */
data class GradeDiff(
    val added: List<Grade>,
    /** Même id, contenu différent (correction prof) : à notifier aussi. */
    val changed: List<Grade>,
    val removed: List<String>,
)

/**
 * Rendu d'un `Double` à la `JSON.stringify` : entier si le nombre est entier
 * (`20`, pas `20.0`), décimal le plus court sinon, `null` pour `NaN`/infini.
 * Même contrat que le pilote de parité (l'empreinte est comparée au caractère).
 */
internal fun jsNum(d: Double): String {
    if (d.isNaN() || d.isInfinite()) return "null"
    if (d == floor(d) && abs(d) < 1e21) return d.toLong().toString()
    val java = d.toString()
    val ePos = java.indexOf('E')
    if (ePos < 0) return java
    var digits = java.substring(0, ePos).replace("-", "").replace(".", "")
    val exp = java.substring(ePos + 1).toInt()
    val negative = d < 0
    val ad = abs(d)
    if (ad >= 1e21 || ad < 1e-6) {
        digits = digits.trimEnd('0')
        if (digits.isEmpty()) digits = "0"
        val mantissa = if (digits.length == 1) digits else digits[0] + "." + digits.substring(1)
        return (if (negative) "-" else "") + mantissa + "e" + (if (exp < 0) "-" else "+") + abs(exp)
    }
    val point = 1 + exp
    var body = digits.trimStart('0')
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
    if (s.contains('.')) {
        s = s.trimEnd('0').trimEnd('.')
    }
    return s
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

/** Diff contre empreintes persistées (moteur sync, snapshot versionné). */
fun diffAgainstPrints(previous: Map<String, String>, current: List<Grade>): GradeDiff {
    val added = mutableListOf<Grade>()
    val changed = mutableListOf<Grade>()
    val seen = mutableSetOf<String>()
    for (g in current) {
        seen.add(g.id)
        val print = previous[g.id]
        if (print == null) added.add(g)
        else if (print != fingerprint(g)) changed.add(g)
    }
    val removed = previous.keys.filter { !seen.contains(it) }
    return GradeDiff(added = added, changed = changed, removed = removed)
}

fun diffGrades(previous: List<Grade>, current: List<Grade>): GradeDiff {
    val prints = mutableMapOf<String, String>()
    for (g in previous) prints[g.id] = fingerprint(g)
    return diffAgainstPrints(prints, current)
}
