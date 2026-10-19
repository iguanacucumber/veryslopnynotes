package fr.veryslopnynotes.pronote

import java.util.Base64

/**
 * Hexadécimal et base64 du protocole (#200).
 *
 * Le protocole mélange les deux : corps chiffrés en hex MAJUSCULE, `Uuid`
 * en base64 standard (avec bourrage, comme `Buffer.toString("base64")`).
 * `hexToBytes` est STRICT (longueur paire, chiffres hexadécimaux) : le
 * protocole n'émet jamais autre chose, et un hex tronqué doit hurler, pas
 * deviner — contrairement à `Buffer.from(hex, "hex")`, qui tronque en silence.
 */

/** Hexadécimal minuscule (le `.toUpperCase()` éventuel est au cas par cas). */
fun ByteArray.toHexLower(): String {
    val out = StringBuilder(size * 2)
    for (b in this) {
        out.append(Character.forDigit((b.toInt() shr 4) and 0xF, 16))
        out.append(Character.forDigit(b.toInt() and 0xF, 16))
    }
    return out.toString()
}

/**
 * Chiffre hexadécimal ASCII, ou -1.
 *
 * `Character.digit` acceptait les chiffres Unicode non ASCII (`０１`, `٠١`) :
 * le port décodait `0x01` là où le contrat annonce un hex STRICT.
 */
private fun hexDigit(c: Char): Int = when (c) {
    in '0'..'9' -> c - '0'
    in 'a'..'f' -> c - 'a' + 10
    in 'A'..'F' -> c - 'A' + 10
    else -> -1
}

/** Strict : longueur paire, uniquement `[0-9a-fA-F]`, sinon `IllegalArgumentException`. */
fun String.hexToBytes(): ByteArray {
    if (length % 2 != 0) throw IllegalArgumentException("hex de longueur impaire ($length)")
    val out = ByteArray(length / 2)
    for (i in out.indices) {
        val hi = hexDigit(this[i * 2])
        val lo = hexDigit(this[i * 2 + 1])
        if (hi < 0 || lo < 0) throw IllegalArgumentException("hex invalide à l'octet $i")
        out[i] = ((hi shl 4) or lo).toByte()
    }
    return out
}

/** Base64 standard avec bourrage, comme `Buffer.toString("base64")`. */
fun ByteArray.toBase64(): String = Base64.getEncoder().encodeToString(this)

fun String.base64ToBytes(): ByteArray = Base64.getDecoder().decode(this)
